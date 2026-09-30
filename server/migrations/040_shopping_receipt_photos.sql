-- 040: ordered multi-photo receipt sets and stale-review protection (#92).
-- Forward-only extension of applied 039. Does not change canonical cash or purchase history.
BEGIN;
ALTER TABLE public.shopping_receipts ADD COLUMN image_hashes text[];
UPDATE public.shopping_receipts SET image_hashes=ARRAY[image_hash];
ALTER TABLE public.shopping_receipts ALTER COLUMN image_hashes SET NOT NULL;
ALTER TABLE public.shopping_receipts ADD CONSTRAINT shopping_receipt_photo_count CHECK(cardinality(image_hashes) BETWEEN 1 AND 6);
CREATE INDEX shopping_receipt_image_hashes ON public.shopping_receipts USING gin(image_hashes);
CREATE OR REPLACE FUNCTION public.shopping_receipt_command(p_list bigint,p_action text,p_data jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shopping_receipts; v_items jsonb; v_item jsonb; v_date date; v_hashes text[];
BEGIN
 -- Cross-list receipt decisions serialize before parent locks; no network inside this transaction.
 PERFORM pg_advisory_xact_lock(390092);
 PERFORM 1 FROM public.shopping_lists WHERE id=p_list FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 SELECT * INTO r FROM public.shopping_receipts WHERE list_id=p_list FOR UPDATE;
 IF p_action='begin' THEN
  SELECT array_agg(value) INTO v_hashes FROM jsonb_array_elements_text(p_data->'image_hashes');
  IF v_hashes IS NULL THEN v_hashes=ARRAY[p_data->>'image_hash']; END IF;
  IF cardinality(v_hashes) NOT BETWEEN 1 AND 6 OR EXISTS(SELECT 1 FROM unnest(v_hashes) h WHERE h IS NULL OR h !~ '^[a-f0-9]{64}$')
   OR (SELECT count(DISTINCT h) FROM unnest(v_hashes) h)<>cardinality(v_hashes) THEN RAISE EXCEPTION 'receipt_images_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM shopping_receipts WHERE list_id<>p_list AND image_hashes && v_hashes) THEN RAISE EXCEPTION 'receipt_duplicate'; END IF;
  IF r.id IS NOT NULL THEN
   IF r.image_hash=p_data->>'image_hash' AND r.state IN ('review','confirmed') THEN RETURN to_jsonb(r); END IF;
   IF r.state='confirmed' THEN RAISE EXCEPTION 'receipt_already_exists'; END IF;
   IF r.state='extracting' AND r.updated_at>now()-interval '2 minutes' THEN RAISE EXCEPTION 'receipt_processing'; END IF;
   IF r.image_hash<>p_data->>'image_hash' AND (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts THEN RAISE EXCEPTION 'receipt_stale'; END IF;
   IF r.attempts>=5 THEN RAISE EXCEPTION 'receipt_attempt_limit'; END IF;
   UPDATE public.shopping_receipts SET image_hash=p_data->>'image_hash',image_hashes=v_hashes,state='extracting',extracted=NULL,
    attempts=attempts+1,updated_at=now(),error_code=NULL WHERE id=r.id RETURNING * INTO r;
  ELSE
   IF COALESCE((p_data->>'expected_attempt')::int,0)<>0 THEN RAISE EXCEPTION 'receipt_stale'; END IF;
   INSERT INTO public.shopping_purchase_plans(list_id,items) VALUES(p_list,public.shopping_snapshot(p_list)) ON CONFLICT DO NOTHING;
   INSERT INTO public.shopping_receipts(list_id,image_hash,image_hashes,state) VALUES(p_list,p_data->>'image_hash',v_hashes,'extracting') RETURNING * INTO r;
  END IF;
 ELSIF p_action IN ('extracted','failed') THEN
  IF r.id IS NULL OR r.state<>'extracting' OR r.attempts<>(p_data->>'attempt')::int THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  UPDATE public.shopping_receipts SET state=CASE WHEN p_action='extracted' THEN 'review' ELSE 'failed' END,
   extracted=CASE WHEN p_action='extracted' THEN p_data->'extracted' ELSE NULL END,
   error_code=CASE WHEN p_action='failed' THEN 'extraction_failed' ELSE NULL END,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 ELSIF p_action='confirm' THEN
  IF p_data->>'reviewed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'receipt_review_required'; END IF;
  IF r.state='confirmed' THEN
   IF r.confirmed<>p_data THEN RAISE EXCEPTION 'receipt_confirmation_conflict'; END IF;
   RETURN to_jsonb(r);
  END IF;
  IF r.id IS NULL OR r.state<>'review' THEN RAISE EXCEPTION 'receipt_not_reviewable'; END IF;
  PERFORM public.shopping_require_duplicate_review(p_list,COALESCE(p_data->'identity',r.extracted->'identity'),p_data->'duplicate_reviewed_ids');
  IF (p_data->>'extraction_attempt')::int IS DISTINCT FROM r.attempts THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  v_items=p_data->'items'; v_date=(p_data->>'purchase_date')::date;
  IF v_date IS NULL OR jsonb_typeof(v_items)<>'array' OR jsonb_array_length(v_items) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
   IF v_item->>'price' IS NULL OR v_item->>'quantity' IS NULL OR COALESCE(v_item->>'name','')='' OR (v_item->>'quantity')::numeric<=0 OR (v_item->>'price')::numeric<0 THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
   IF v_item->>'catalog_item_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.shopping_catalog_items WHERE id=(v_item->>'catalog_item_id')::bigint AND is_active) THEN RAISE EXCEPTION 'receipt_product_invalid'; END IF;
  END LOOP;
  UPDATE public.shopping_receipts SET state='confirmed',confirmed=p_data,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  -- Replace a checkout snapshot, never append a second shopping event or change financial cash.
  INSERT INTO public.shopping_confirmed_purchases(list_id,purchase_date,items,basis,receipt_id)
   VALUES(p_list,v_date,v_items,'receipt',r.id)
   ON CONFLICT(list_id) DO UPDATE SET purchase_date=excluded.purchase_date,items=excluded.items,basis='receipt',receipt_id=excluded.receipt_id,confirmed_at=now();
 ELSE RAISE EXCEPTION 'receipt_action_invalid'; END IF;
 RETURN to_jsonb(r);
END $$;
-- CREATE OR REPLACE retains the service-only grants from 039.
COMMIT;
