-- 049: Receipt workflow expansion (#95). Forward migration; no financial writes.
BEGIN;
ALTER TABLE shopping_receipts ADD COLUMN progress jsonb, ADD COLUMN lease_expires_at timestamptz,
 ADD COLUMN confirmation_request jsonb, ADD COLUMN origin_plan jsonb;
ALTER TABLE shopping_receipts DROP CONSTRAINT shopping_receipt_photo_count;
ALTER TABLE shopping_receipts ADD CONSTRAINT shopping_receipt_photo_count CHECK(cardinality(image_hashes) BETWEEN 1 AND 24);
ALTER TABLE shopping_receipts DROP CONSTRAINT shopping_review_draft_bounded;
ALTER TABLE shopping_receipts ADD CONSTRAINT shopping_review_draft_bounded CHECK(review_draft IS NULL OR
 (jsonb_typeof(review_draft)='object' AND octet_length(review_draft::text)<=2097152));
CREATE OR REPLACE FUNCTION public.shopping_snapshot(p_list bigint) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('list_item_id',i.id::text,'catalog_item_id',i.catalog_item_id::text,
 'notes',i.notes,'name',COALESCE(c.name,i.custom_name),'quantity',COALESCE(i.quantity,1)::text,
 'unit',COALESCE(i.unit,'יח׳'),'price',i.price::text,'is_purchased',i.is_purchased) ORDER BY i.id),'[]')
 FROM shopping_list_items i LEFT JOIN shopping_catalog_items c ON c.id=i.catalog_item_id WHERE i.list_id=p_list;
$$;
CREATE FUNCTION public.shopping_receipt_context(p_list bigint) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('store',l.store,'current_items',shopping_snapshot(p_list),'plan',p.items,'receipt',to_jsonb(r),
 'token',md5(jsonb_build_array(l.id,l.store,l.status,shopping_snapshot(p_list),p.items,r.attempts,r.draft_revision,r.extracted)::text))
 FROM shopping_lists l LEFT JOIN shopping_receipts r ON r.list_id=l.id LEFT JOIN shopping_purchase_plans p ON p.list_id=l.id WHERE l.id=p_list;
$$;
CREATE OR REPLACE FUNCTION public.shopping_save_receipt_draft(p_list bigint,p_attempt integer,p_revision integer,p_draft jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shopping_receipts;
BEGIN
 PERFORM pg_advisory_xact_lock(390092);
 PERFORM 1 FROM shopping_lists WHERE id=p_list FOR UPDATE;
 SELECT * INTO r FROM shopping_receipts WHERE list_id=p_list FOR UPDATE;
 IF r.id IS NULL OR r.state<>'review' OR r.attempts<>p_attempt THEN RAISE EXCEPTION 'receipt_stale'; END IF;
 IF r.review_draft=p_draft THEN RETURN jsonb_build_object('revision',r.draft_revision); END IF;
 IF r.draft_revision<>p_revision THEN RAISE EXCEPTION 'receipt_stale'; END IF;
 IF jsonb_typeof(p_draft)<>'object' OR jsonb_typeof(p_draft->'items')<>'array' OR jsonb_array_length(p_draft->'items')>1000 THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
 UPDATE shopping_receipts SET review_draft=p_draft,draft_revision=draft_revision+1 WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('revision',r.draft_revision);
END $$;
CREATE OR REPLACE FUNCTION public.shopping_receipt_command(p_list bigint,p_action text,p_data jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shopping_receipts; v_items jsonb; v_item jsonb; v_date date; v_hashes text[]; v_product jsonb; v_mapping jsonb; v_final jsonb; v_seen jsonb='{}'; v_key text;
BEGIN
 -- Cross-list receipt decisions serialize before parent locks; no network inside this transaction.
 PERFORM pg_advisory_xact_lock(390092);
 PERFORM 1 FROM public.shopping_lists WHERE id=p_list FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 SELECT * INTO r FROM public.shopping_receipts WHERE list_id=p_list FOR UPDATE;
 IF p_action='begin' THEN
  IF NOT EXISTS(SELECT 1 FROM shopping_list_items WHERE list_id=p_list) THEN RAISE EXCEPTION 'receipt_list_empty'; END IF;
  IF EXISTS(SELECT 1 FROM shopping_lists WHERE id=p_list AND status IN ('archived','checked_out')) THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
  IF p_data ? 'reprocess_key' AND r.id IS NOT NULL AND r.reprocess_key=(p_data->>'reprocess_key')::uuid THEN
   IF r.image_hash IS DISTINCT FROM p_data->>'image_hash' OR (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts-1 THEN RAISE EXCEPTION 'receipt_reprocess_conflict'; END IF;
   RETURN to_jsonb(r)||jsonb_build_object('processing_replay',true);
  END IF;
  IF p_data->>'reprocess'='true' AND (r.id IS NULL OR p_data->>'reprocess_key' IS NULL OR (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts) THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  IF p_data ? 'review_draft' AND (jsonb_typeof(p_data->'review_draft')<>'object' OR octet_length((p_data->'review_draft')::text)>2097152) THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
  SELECT array_agg(value) INTO v_hashes FROM jsonb_array_elements_text(p_data->'image_hashes');
  IF v_hashes IS NULL THEN v_hashes=ARRAY[p_data->>'image_hash']; END IF;
  IF cardinality(v_hashes) NOT BETWEEN 1 AND 24 OR EXISTS(SELECT 1 FROM unnest(v_hashes) h WHERE h IS NULL OR h !~ '^[a-f0-9]{64}$')
   OR (SELECT count(DISTINCT h) FROM unnest(v_hashes) h)<>cardinality(v_hashes) THEN RAISE EXCEPTION 'receipt_images_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM shopping_receipts WHERE list_id<>p_list AND image_hashes && v_hashes) THEN RAISE EXCEPTION 'receipt_duplicate'; END IF;
  IF r.id IS NOT NULL THEN
   IF r.image_hash=p_data->>'image_hash' AND r.state IN ('review','confirmed') AND p_data->>'reprocess' IS DISTINCT FROM 'true' THEN RETURN to_jsonb(r); END IF;
   IF r.state='confirmed' THEN RAISE EXCEPTION 'receipt_already_exists'; END IF;
   IF r.state='extracting' AND COALESCE(r.lease_expires_at,r.updated_at+interval '2 minutes')>now() THEN RAISE EXCEPTION 'receipt_processing'; END IF;
   IF r.image_hash<>p_data->>'image_hash' AND (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts THEN RAISE EXCEPTION 'receipt_stale'; END IF;
   IF r.attempts>=5 THEN RAISE EXCEPTION 'receipt_attempt_limit'; END IF;
   IF r.review_draft IS NOT NULL THEN
    IF (p_data->>'draft_revision')::int IS DISTINCT FROM r.draft_revision THEN RAISE EXCEPTION 'receipt_stale'; END IF;
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
  UPDATE shopping_receipts SET lease_expires_at=now()+make_interval(secs=>LEAST(660,GREATEST(60,COALESCE((p_data->>'duration_ms')::int,480000)/1000+60))),
   progress='{"stage":"preparing","completed":0,"total":0}' WHERE id=r.id RETURNING * INTO r;
 ELSIF p_action='progress' THEN
  IF r.state<>'extracting' OR r.attempts IS DISTINCT FROM (p_data->>'attempt')::int THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  UPDATE shopping_receipts SET progress=p_data->'progress' WHERE id=r.id RETURNING * INTO r;
 ELSIF p_action IN ('extracted','failed') THEN
  IF r.id IS NULL OR r.state<>'extracting' OR r.attempts<>(p_data->>'attempt')::int THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  UPDATE public.shopping_receipts SET state=CASE WHEN p_action='extracted' THEN 'review' ELSE 'failed' END,
   extracted=CASE WHEN p_action='extracted' THEN p_data->'extracted' ELSE NULL END,
   error_code=CASE WHEN p_action='failed' THEN 'extraction_failed' ELSE NULL END,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 ELSIF p_action='confirm' THEN
  IF r.state='confirmed' AND r.confirmation_request IS NOT NULL THEN
   IF r.confirmation_request IS DISTINCT FROM p_data->'_request' THEN RAISE EXCEPTION 'receipt_confirmation_conflict'; END IF;
   RETURN to_jsonb(r);
  END IF;
  IF p_data->>'context_token' IS DISTINCT FROM shopping_receipt_context(p_list)->>'token' OR p_data->>'_owner' IS NULL THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  IF NOT EXISTS(SELECT 1 FROM shopping_list_items WHERE list_id=p_list) THEN RAISE EXCEPTION 'receipt_list_empty'; END IF;
  IF EXISTS(SELECT 1 FROM shopping_lists WHERE id=p_list AND status IN ('archived','checked_out')) THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
  IF p_data->>'_merchant_state' IS NULL THEN RAISE EXCEPTION 'receipt_merchant_review_required'; END IF;
  UPDATE shopping_receipts SET confirmation_request=p_data->'_request' WHERE id=r.id;
  v_final='[]';
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'items') LOOP
   IF v_item ? '_mapping' THEN
    v_key=md5(jsonb_build_array(v_item->'_mapping'->>'kind',v_item->'_mapping'->>'retailer_scope',v_item->'_mapping'->>'code',v_item->'_mapping'->>'personal_item_id',v_item->'_mapping'->>'factor',v_item->'_mapping'->>'receipt_unit',v_item->'_mapping'->>'planning_unit')::text);
    v_product=v_seen->v_key;
    IF v_product IS NULL THEN
     v_product=shopping_commercial_command(v_item->'_mapping',(p_data->>'_owner')::uuid);
     v_seen=jsonb_set(v_seen,ARRAY[v_key],v_product);
    END IF;
    v_mapping=v_product->'mapping';
    v_item=(v_item-'_mapping')||jsonb_build_object('commercial_product_id',v_product->>'id','mapping_snapshot',
     jsonb_build_object('commercial_product_id',v_product->>'id','revision',v_mapping->'revision','personal_item_id',v_mapping->>'personal_item_id',
     'personal_name',v_mapping->>'personal_name','planning_unit',v_mapping->>'planning_unit','receipt_unit',v_mapping->>'receipt_unit','factor',v_mapping->>'factor'));
   END IF;
   v_final=v_final||jsonb_build_array(v_item);
  END LOOP;
  UPDATE shopping_list_items SET is_purchased=true WHERE list_id=p_list AND id IN (SELECT value::bigint FROM jsonb_array_elements_text(p_data->'_fulfilled')) AND NOT is_purchased;
  p_data=jsonb_set(p_data-'_owner'-'_request'-'_fulfilled'-'_merchant_state','{items}',v_final);
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
  IF v_date IS NULL OR jsonb_typeof(v_items)<>'array' OR jsonb_array_length(v_items) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
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

CREATE FUNCTION public.shopping_move_receipt(p_list bigint,p_target bigint,p_token text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r shopping_receipts;
BEGIN
 PERFORM pg_advisory_xact_lock(390092);
 PERFORM 1 FROM shopping_lists WHERE id IN (p_list,p_target) ORDER BY id FOR UPDATE;
 IF p_token IS DISTINCT FROM shopping_receipt_context(p_list)->>'token' THEN RAISE EXCEPTION 'receipt_stale'; END IF;
 SELECT * INTO r FROM shopping_receipts WHERE list_id=p_list FOR UPDATE;
 IF r.state IS DISTINCT FROM 'review' THEN RAISE EXCEPTION 'receipt_not_reviewable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shopping_lists WHERE id=p_target AND status NOT IN ('checked_out','archived')) THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shopping_list_items WHERE list_id=p_target) THEN RAISE EXCEPTION 'receipt_list_empty'; END IF;
 IF EXISTS(SELECT 1 FROM shopping_receipts WHERE list_id=p_target) OR EXISTS(SELECT 1 FROM shopping_checkouts WHERE list_id=p_target) THEN RAISE EXCEPTION 'receipt_already_exists'; END IF;
 INSERT INTO shopping_purchase_plans(list_id,items) VALUES(p_target,shopping_snapshot(p_target)) ON CONFLICT DO NOTHING;
 UPDATE shopping_receipts SET list_id=p_target,origin_plan=COALESCE(origin_plan,jsonb_build_object('list_id',p_list,'items',(SELECT items FROM shopping_purchase_plans WHERE list_id=p_list))),
  draft_revision=draft_revision+1 WHERE id=r.id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.shopping_receipt_context(bigint),public.shopping_move_receipt(bigint,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_receipt_context(bigint),public.shopping_move_receipt(bigint,bigint,text) TO service_role;

COMMIT;
