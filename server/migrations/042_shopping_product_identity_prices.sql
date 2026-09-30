-- 042: Shopping product identifiers, lookup cache and durable review drafts (#92).
-- Forward-only. No backfill, OCR, attempt reset, purchase confirmation or cash write.
BEGIN;
CREATE FUNCTION public.shopping_gtin_valid(code text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path=public AS $$
 SELECT code ~ '^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$' AND
  (SELECT mod(10-mod(sum(substring(code,length(code)-n,1)::int * CASE WHEN n%2=1 THEN 3 ELSE 1 END),10),10)
   FROM generate_series(1,length(code)-1) n) = right(code,1)::int;
$$;
CREATE TABLE public.shopping_product_identifiers (
 kind text NOT NULL CHECK(kind IN ('gtin','retailer')),
 retailer_scope text NOT NULL DEFAULT '',
 code text NOT NULL CHECK(code ~ '^[0-9]{3,20}$'),
 catalog_item_id bigint NOT NULL REFERENCES public.shopping_catalog_items(id),
 approved_name text NOT NULL CHECK(length(approved_name) BETWEEN 1 AND 200),
 lookup_source text NOT NULL CHECK(lookup_source IN ('owner','open_food_facts','local_catalog')),
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(kind,retailer_scope,code),
 CHECK((kind='gtin' AND retailer_scope='' AND public.shopping_gtin_valid(code)) OR
       (kind='retailer' AND length(retailer_scope) BETWEEN 1 AND 120))
);
CREATE INDEX shopping_identifier_catalog ON public.shopping_product_identifiers(catalog_item_id);
-- External licensed data is a separate cache, not automatically copied into the owner's catalog.
CREATE TABLE public.shopping_product_lookup_cache (
 code text NOT NULL CHECK(code ~ '^[0-9]{8,14}$'),
 environment text NOT NULL CHECK(environment IN ('staging','production')),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 requested_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 PRIMARY KEY(code,environment)
);
CREATE INDEX shopping_lookup_request_time ON public.shopping_product_lookup_cache(requested_at);
ALTER TABLE public.shopping_receipts ADD COLUMN review_draft jsonb,
 ADD COLUMN draft_revision integer NOT NULL DEFAULT 0 CHECK(draft_revision>=0),
 ADD CONSTRAINT shopping_review_draft_bounded CHECK(review_draft IS NULL OR
  (jsonb_typeof(review_draft)='object' AND octet_length(review_draft::text)<=262144));
CREATE FUNCTION public.shopping_claim_product_lookup(p_code text,p_environment text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.shopping_product_lookup_cache;
BEGIN
 IF p_code !~ '^[0-9]{8,14}$' OR p_environment NOT IN ('staging','production') THEN RAISE EXCEPTION 'shopping_input_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(420092);
 SELECT * INTO c FROM shopping_product_lookup_cache WHERE code=p_code AND environment=p_environment;
 IF FOUND AND c.expires_at>now() THEN RETURN jsonb_build_object('claimed',false,'result',c.result); END IF;
 IF (SELECT count(*) FROM shopping_product_lookup_cache WHERE requested_at>now()-interval '1 minute')>=12 THEN
  RETURN jsonb_build_object('claimed',false,'result',jsonb_build_object('status','rate_limited')); END IF;
 INSERT INTO shopping_product_lookup_cache(code,environment,result,expires_at) VALUES(p_code,p_environment,'{"status":"pending"}',now()+interval '5 minutes')
 ON CONFLICT(code,environment) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at,requested_at=now();
 RETURN jsonb_build_object('claimed',true);
END $$;
CREATE FUNCTION public.shopping_save_receipt_draft(p_list bigint,p_attempt integer,p_revision integer,p_draft jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shopping_receipts;
BEGIN
 PERFORM pg_advisory_xact_lock(390092);
 PERFORM 1 FROM shopping_lists WHERE id=p_list FOR UPDATE;
 SELECT * INTO r FROM shopping_receipts WHERE list_id=p_list FOR UPDATE;
 IF r.id IS NULL OR r.state<>'review' OR r.attempts<>p_attempt THEN RAISE EXCEPTION 'receipt_stale'; END IF;
 IF r.review_draft=p_draft THEN RETURN jsonb_build_object('revision',r.draft_revision); END IF;
 IF r.draft_revision<>p_revision THEN RAISE EXCEPTION 'receipt_stale'; END IF;
 IF jsonb_typeof(p_draft)<>'object' OR jsonb_typeof(p_draft->'items')<>'array' OR jsonb_array_length(p_draft->'items')>200 THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
 UPDATE shopping_receipts SET review_draft=p_draft,draft_revision=draft_revision+1 WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('revision',r.draft_revision);
END $$;
CREATE FUNCTION public.shopping_approve_product_identifier(p_data jsonb,p_owner uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id bigint; k text=p_data->>'kind'; scope text=p_data->>'retailer_scope'; c text=p_data->>'code';
BEGIN
 IF p_owner IS NULL THEN RAISE EXCEPTION 'shopping_input_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(420093);
 SELECT catalog_item_id INTO v_id FROM shopping_product_identifiers WHERE kind=k AND retailer_scope=scope AND code=c;
 IF p_data->>'catalog_item_id' IS NOT NULL THEN
  IF v_id IS NOT NULL AND v_id<>(p_data->>'catalog_item_id')::bigint THEN RAISE EXCEPTION 'shopping_identifier_conflict'; END IF;
  v_id=(p_data->>'catalog_item_id')::bigint;
 END IF;
 IF v_id IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM shopping_catalog_categories WHERE id=(p_data->>'category_id')::bigint AND is_active) THEN RAISE EXCEPTION 'shopping_category_invalid'; END IF;
  INSERT INTO shopping_catalog_items(category_id,name,default_unit,is_active)
   VALUES((p_data->>'category_id')::bigint,p_data->>'name',p_data->>'unit',true) RETURNING id INTO v_id;
 ELSE
  PERFORM 1 FROM shopping_catalog_items WHERE id=v_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shopping_product_invalid'; END IF;
  -- Do not rename a catalog product already bound to a different code/variant.
  IF EXISTS(SELECT 1 FROM shopping_product_identifiers WHERE catalog_item_id=v_id AND (kind,retailer_scope,code)<>(k,scope,c)) THEN RAISE EXCEPTION 'shopping_identifier_conflict'; END IF;
  UPDATE shopping_catalog_items SET name=p_data->>'name' WHERE id=v_id;
 END IF;
 INSERT INTO shopping_product_identifiers(kind,retailer_scope,code,catalog_item_id,approved_name,lookup_source,approved_by)
 VALUES(k,scope,c,v_id,p_data->>'name',p_data->>'lookup_source',p_owner)
 ON CONFLICT(kind,retailer_scope,code) DO UPDATE SET approved_name=excluded.approved_name,lookup_source=excluded.lookup_source,approved_by=excluded.approved_by,approved_at=now();
 RETURN jsonb_build_object('catalog_item_id',v_id::text,'full_name',p_data->>'name','source','owner_catalog','owner_approved',true,'kind',k,'code',c,'retailer_scope',scope);
END $$;
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
  IF r.review_draft IS NOT NULL AND p_data->>'reprocess'='true' THEN
   IF (p_data->>'draft_revision')::int IS DISTINCT FROM r.draft_revision THEN RAISE EXCEPTION 'receipt_stale'; END IF;
   p_data=jsonb_set(p_data,'{review_draft}',r.review_draft);
  END IF;
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
CREATE OR REPLACE FUNCTION public.shopping_checkout(p_list bigint,p_category bigint DEFAULT NULL,p_source bigint DEFAULT NULL,p_duplicate_reviewed_ids jsonb DEFAULT '[]') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l public.shopping_lists; c public.shopping_checkouts; v_items jsonb; v_total numeric; v_transaction bigint; v_date date=(now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(390092);
 SELECT * INTO l FROM public.shopping_lists WHERE id=p_list FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 SELECT * INTO c FROM public.shopping_checkouts WHERE list_id=p_list;
 IF FOUND THEN
  IF c.category_id IS DISTINCT FROM p_category OR c.payment_source_id IS DISTINCT FROM p_source THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  RETURN jsonb_build_object('checkout',to_jsonb(c),'transaction_id',c.transaction_id,'total_amount',c.total_amount,'replay',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.shopping_receipts WHERE list_id=p_list AND state='extracting') THEN RAISE EXCEPTION 'receipt_processing'; END IF;
 PERFORM public.shopping_require_duplicate_review(p_list,NULL,p_duplicate_reviewed_ids);
 IF l.status IN ('checked_out','archived') THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
 IF p_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=p_category AND is_active AND type='expense' AND savings_role IS NULL) THEN RAISE EXCEPTION 'checkout_category_invalid'; END IF;
 IF p_source IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payment_sources WHERE id=p_source AND is_active) THEN RAISE EXCEPTION 'checkout_source_invalid'; END IF;
 INSERT INTO public.shopping_purchase_plans(list_id,items) VALUES(p_list,public.shopping_snapshot(p_list)) ON CONFLICT DO NOTHING;
 SELECT items,purchase_date INTO v_items,v_date FROM public.shopping_confirmed_purchases WHERE list_id=p_list;
 IF FOUND AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) WHERE value->>'price' IS NULL AND value->>'final_total' IS NULL) THEN RAISE EXCEPTION 'checkout_receipt_price_required'; END IF;
 IF v_items IS NULL THEN
  v_date=(now() AT TIME ZONE 'Asia/Jerusalem')::date;
  SELECT COALESCE(jsonb_agg(value),'[]') INTO v_items FROM jsonb_array_elements(public.shopping_snapshot(p_list)) WHERE (value->>'is_purchased')::boolean;
 END IF;
 IF jsonb_array_length(v_items)=0 THEN RAISE EXCEPTION 'checkout_empty'; END IF;
 SELECT round(sum(CASE WHEN value->>'price_basis'='line_discount' THEN (value->>'final_total')::numeric ELSE (value->>'quantity')::numeric * COALESCE((value->>'price')::numeric,0) END),2) INTO v_total FROM jsonb_array_elements(v_items);
 IF v_total<0 THEN RAISE EXCEPTION 'checkout_total_invalid'; END IF;
 INSERT INTO public.transactions(description,movement_type,category_id,payment_source_id,total_amount,transaction_date,charge_date)
 VALUES(l.title,'expense',p_category,p_source,v_total,v_date,v_date) RETURNING id INTO v_transaction;
 INSERT INTO public.shopping_checkouts(list_id,checkout_date,total_amount,payment_source_id,category_id,transaction_id)
 VALUES(p_list,v_date,v_total,p_source,p_category,v_transaction) RETURNING * INTO c;
 INSERT INTO public.shopping_confirmed_purchases(list_id,purchase_date,items,basis) VALUES(p_list,v_date,v_items,'checkout') ON CONFLICT DO NOTHING;
 UPDATE public.shopping_lists SET status='checked_out',updated_at=now() WHERE id=p_list;
 RETURN jsonb_build_object('checkout',to_jsonb(c),'transaction_id',v_transaction,'total_amount',v_total,'replay',false);
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['shopping_product_identifiers','shopping_product_lookup_cache'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.shopping_claim_product_lookup(text,text),public.shopping_save_receipt_draft(bigint,integer,integer,jsonb),public.shopping_approve_product_identifier(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_claim_product_lookup(text,text),public.shopping_save_receipt_draft(bigint,integer,integer,jsonb),public.shopping_approve_product_identifier(jsonb,uuid) TO service_role;
COMMIT;
