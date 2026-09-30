-- 043: Preserve current corrections when archiving a durable receipt draft.
-- Same-key replay precedes revision checks; no rows/attempts/financial state changed.
BEGIN;
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
  IF p_data ? 'reprocess_key' AND r.id IS NOT NULL AND r.reprocess_key=(p_data->>'reprocess_key')::uuid THEN
   IF r.image_hash IS DISTINCT FROM p_data->>'image_hash' OR (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts-1 THEN RAISE EXCEPTION 'receipt_reprocess_conflict'; END IF;
   RETURN to_jsonb(r)||jsonb_build_object('processing_replay',true);
  END IF;
  IF p_data->>'reprocess'='true' AND (r.id IS NULL OR p_data->>'reprocess_key' IS NULL OR (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts) THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  IF p_data ? 'review_draft' AND (jsonb_typeof(p_data->'review_draft')<>'object' OR octet_length((p_data->'review_draft')::text)>131072) THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
  SELECT array_agg(value) INTO v_hashes FROM jsonb_array_elements_text(p_data->'image_hashes');
  IF v_hashes IS NULL THEN v_hashes=ARRAY[p_data->>'image_hash']; END IF;
  IF cardinality(v_hashes) NOT BETWEEN 1 AND 6 OR EXISTS(SELECT 1 FROM unnest(v_hashes) h WHERE h IS NULL OR h !~ '^[a-f0-9]{64}$')
   OR (SELECT count(DISTINCT h) FROM unnest(v_hashes) h)<>cardinality(v_hashes) THEN RAISE EXCEPTION 'receipt_images_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM shopping_receipts WHERE list_id<>p_list AND image_hashes && v_hashes) THEN RAISE EXCEPTION 'receipt_duplicate'; END IF;
  IF r.id IS NOT NULL THEN
   IF r.image_hash=p_data->>'image_hash' AND r.state IN ('review','confirmed') AND p_data->>'reprocess' IS DISTINCT FROM 'true' THEN RETURN to_jsonb(r); END IF;
   IF r.state='confirmed' THEN RAISE EXCEPTION 'receipt_already_exists'; END IF;
   IF r.state='extracting' AND r.updated_at>now()-interval '2 minutes' THEN RAISE EXCEPTION 'receipt_processing'; END IF;
   IF r.image_hash<>p_data->>'image_hash' AND (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts THEN RAISE EXCEPTION 'receipt_stale'; END IF;
   IF r.attempts>=5 THEN RAISE EXCEPTION 'receipt_attempt_limit'; END IF;
   IF r.review_draft IS NOT NULL THEN
    IF (p_data->>'draft_revision')::int IS DISTINCT FROM r.draft_revision THEN RAISE EXCEPTION 'receipt_stale'; END IF;
    -- The submitted live draft may contain newer edits than the last saved draft.
    -- Fall back to durable state only when no current draft was submitted.
    IF NOT (p_data ? 'review_draft') THEN p_data=jsonb_set(p_data,'{review_draft}',r.review_draft); END IF;
   END IF;
   UPDATE public.shopping_receipts SET
    previous_drafts=previous_drafts||jsonb_build_array(jsonb_build_object('attempt',r.attempts,'extracted',r.extracted,'review_draft',p_data->'review_draft','image_hashes',r.image_hashes,'saved_at',now())),
    review_draft=NULL,draft_revision=draft_revision+1,reprocess_key=(p_data->>'reprocess_key')::uuid,
    image_hash=p_data->>'image_hash',image_hashes=v_hashes,state='extracting',extracted=NULL,
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
  IF r.state<>'confirmed' AND r.review_draft IS NOT NULL AND (p_data->>'draft_revision')::int IS DISTINCT FROM r.draft_revision THEN RAISE EXCEPTION 'receipt_stale'; END IF;
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
   IF (v_item->>'price' IS NULL AND NOT (v_item->>'price_basis'='line_discount' AND v_item->>'final_total' IS NOT NULL)) OR v_item->>'quantity' IS NULL OR COALESCE(v_item->>'name','')='' OR (v_item->>'quantity')::numeric<=0 OR (v_item->>'price')::numeric<0 THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
   IF v_item->>'price_basis'='line_discount' THEN
    IF v_item->>'row_discount' IS NULL OR v_item->>'final_total' IS NULL OR
      (v_item->>'final_total')::numeric<0 OR
      (v_item->>'final_total')::numeric IS DISTINCT FROM round((v_item->>'calculated_gross_total')::numeric,2)-(v_item->>'row_discount')::numeric THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
   END IF;
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
COMMIT;
