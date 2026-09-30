-- Migration 039: Shopping habits, immutable plans, reviewed receipts and atomic checkout (#92).
-- Additive; no historical checkbox backfill. Run as one transaction, never edit prior migrations.
BEGIN;
CREATE TABLE public.shopping_regular_products (
 catalog_item_id bigint PRIMARY KEY REFERENCES public.shopping_catalog_items(id),
 quantity numeric NOT NULL CHECK(quantity > 0 AND quantity <= 10000),
 unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.shopping_purchase_plans (
 list_id bigint PRIMARY KEY REFERENCES public.shopping_lists(id),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array'),
 captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.shopping_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 list_id bigint NOT NULL UNIQUE REFERENCES public.shopping_lists(id),
 image_hash text NOT NULL UNIQUE CHECK(image_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('extracting','failed','review','confirmed')),
 extracted jsonb, confirmed jsonb,
 attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 5),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(confirmed IS NULL OR state='confirmed')
);
CREATE TABLE public.shopping_confirmed_purchases (
 list_id bigint PRIMARY KEY REFERENCES public.shopping_lists(id),
 purchase_date date NOT NULL,
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array'),
 basis text NOT NULL CHECK(basis IN ('checkout','receipt')),
 receipt_id uuid UNIQUE REFERENCES public.shopping_receipts(id),
 confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shopping_purchase_date ON public.shopping_confirmed_purchases(purchase_date DESC);

-- Item writes and checkout serialize on the SAME parent. A checkbox is not purchase history.
CREATE FUNCTION public.shopping_lock_item() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE s text;
BEGIN
 SELECT status INTO s FROM public.shopping_lists WHERE id=COALESCE(NEW.list_id,OLD.list_id) FOR UPDATE;
 IF s IN ('checked_out','archived') OR EXISTS(SELECT 1 FROM public.shopping_checkouts WHERE list_id=COALESCE(NEW.list_id,OLD.list_id)) THEN
  RAISE EXCEPTION 'shopping_list_closed' USING ERRCODE='P0001';
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER shopping_item_write_lock BEFORE INSERT OR UPDATE OR DELETE ON public.shopping_list_items
 FOR EACH ROW EXECUTE FUNCTION public.shopping_lock_item();

CREATE FUNCTION public.shopping_snapshot(p_list bigint) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('catalog_item_id',i.catalog_item_id::text,
 'name',COALESCE(c.name,i.custom_name),'quantity',COALESCE(i.quantity,1)::text,
 'unit',COALESCE(i.unit,'יח׳'),'price',i.price::text,'is_purchased',i.is_purchased) ORDER BY i.id),'[]')
 FROM public.shopping_list_items i LEFT JOIN public.shopping_catalog_items c ON c.id=i.catalog_item_id WHERE i.list_id=p_list;
$$;

-- Receipt identifiers are review evidence, never unique purchase identity. No amount-only matching.
CREATE FUNCTION public.shopping_receipt_duplicates(p_list bigint,p_identity jsonb DEFAULT NULL) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH input AS (SELECT COALESCE(p_identity,(SELECT COALESCE(confirmed->'identity',extracted->'identity') FROM shopping_receipts WHERE list_id=p_list)) AS i),
 candidates AS (SELECT r.*,COALESCE(r.confirmed->'identity',r.extracted->'identity') AS i FROM shopping_receipts r WHERE r.list_id<>p_list AND r.state IN ('review','confirmed'))
 SELECT COALESCE(jsonb_agg(jsonb_build_object('receipt_id',r.id,'list_id',r.list_id::text,'list_title',l.title,
 'identity',r.i,'state',r.state,'history_confirmed',h.list_id IS NOT NULL,'transaction_id',c.transaction_id::text,'checkout_total',c.total_amount) ORDER BY r.created_at),'[]'::jsonb)
 FROM candidates r CROSS JOIN input x JOIN shopping_lists l ON l.id=r.list_id
 LEFT JOIN shopping_checkouts c ON c.list_id=r.list_id LEFT JOIN shopping_confirmed_purchases h ON h.list_id=r.list_id
 WHERE nullif(btrim(x.i->>'receipt_number'),'') IS NOT NULL AND nullif(btrim(x.i->>'merchant'),'') IS NOT NULL AND nullif(x.i->>'purchase_date','') IS NOT NULL
 AND lower(btrim(r.i->>'receipt_number'))=lower(btrim(x.i->>'receipt_number'))
 AND lower(regexp_replace(btrim(r.i->>'merchant'),'\s+',' ','g'))=lower(regexp_replace(btrim(x.i->>'merchant'),'\s+',' ','g'))
 AND r.i->>'purchase_date'=x.i->>'purchase_date';
$$;
CREATE FUNCTION public.shopping_require_duplicate_review(p_list bigint,p_identity jsonb,p_reviewed jsonb) RETURNS void
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.shopping_receipt_duplicates(p_list,p_identity)) d
 WHERE NOT COALESCE(p_reviewed,'[]'::jsonb) @> jsonb_build_array(d->>'receipt_id')) THEN
  RAISE EXCEPTION 'receipt_duplicate_review_required';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.shopping_receipt_duplicates(bigint,jsonb),public.shopping_require_duplicate_review(bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_receipt_duplicates(bigint,jsonb) TO service_role;

CREATE FUNCTION public.shopping_receipt_command(p_list bigint,p_action text,p_data jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.shopping_receipts; v_items jsonb; v_item jsonb; v_date date;
BEGIN
 -- Cross-list receipt decisions serialize before parent locks; no network inside this transaction.
 PERFORM pg_advisory_xact_lock(390092);
 PERFORM 1 FROM public.shopping_lists WHERE id=p_list FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 SELECT * INTO r FROM public.shopping_receipts WHERE list_id=p_list FOR UPDATE;
 IF p_action='begin' THEN
  IF r.id IS NOT NULL THEN
   IF r.image_hash<>p_data->>'image_hash' AND r.state<>'failed' THEN RAISE EXCEPTION 'receipt_already_exists'; END IF;
   IF r.state IN ('review','confirmed') THEN RETURN to_jsonb(r); END IF;
   IF r.state='extracting' AND r.updated_at>now()-interval '2 minutes' THEN RAISE EXCEPTION 'receipt_processing'; END IF;
   IF r.attempts>=5 THEN RAISE EXCEPTION 'receipt_attempt_limit'; END IF;
   UPDATE public.shopping_receipts SET image_hash=p_data->>'image_hash',state='extracting',attempts=attempts+1,updated_at=now(),error_code=NULL WHERE id=r.id RETURNING * INTO r;
  ELSE
   INSERT INTO public.shopping_purchase_plans(list_id,items) VALUES(p_list,public.shopping_snapshot(p_list)) ON CONFLICT DO NOTHING;
   INSERT INTO public.shopping_receipts(list_id,image_hash,state) VALUES(p_list,p_data->>'image_hash','extracting') RETURNING * INTO r;
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

CREATE FUNCTION public.shopping_checkout(p_list bigint,p_category bigint DEFAULT NULL,p_source bigint DEFAULT NULL,p_duplicate_reviewed_ids jsonb DEFAULT '[]') RETURNS jsonb
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
 IF FOUND AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) WHERE value->>'price' IS NULL) THEN RAISE EXCEPTION 'checkout_receipt_price_required'; END IF;
 IF v_items IS NULL THEN
  v_date=(now() AT TIME ZONE 'Asia/Jerusalem')::date;
  SELECT COALESCE(jsonb_agg(value),'[]') INTO v_items FROM jsonb_array_elements(public.shopping_snapshot(p_list)) WHERE (value->>'is_purchased')::boolean;
 END IF;
 IF jsonb_array_length(v_items)=0 THEN RAISE EXCEPTION 'checkout_empty'; END IF;
 SELECT round(sum((value->>'quantity')::numeric * COALESCE((value->>'price')::numeric,0)),2) INTO v_total FROM jsonb_array_elements(v_items);
 IF v_total<0 THEN RAISE EXCEPTION 'checkout_total_invalid'; END IF;
 INSERT INTO public.transactions(description,movement_type,category_id,payment_source_id,total_amount,transaction_date,charge_date)
 VALUES(l.title,'expense',p_category,p_source,v_total,v_date,v_date) RETURNING id INTO v_transaction;
 INSERT INTO public.shopping_checkouts(list_id,checkout_date,total_amount,payment_source_id,category_id,transaction_id)
 VALUES(p_list,v_date,v_total,p_source,p_category,v_transaction) RETURNING * INTO c;
 INSERT INTO public.shopping_confirmed_purchases(list_id,purchase_date,items,basis) VALUES(p_list,v_date,v_items,'checkout') ON CONFLICT DO NOTHING;
 UPDATE public.shopping_lists SET status='checked_out',updated_at=now() WHERE id=p_list;
 RETURN jsonb_build_object('checkout',to_jsonb(c),'transaction_id',v_transaction,'total_amount',v_total,'replay',false);
END $$;

CREATE FUNCTION public.shopping_accept_suggestion(p_list bigint,p_product bigint,p_quantity numeric,p_unit text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.shopping_catalog_items; v_id bigint;
BEGIN
 PERFORM 1 FROM public.shopping_lists WHERE id=p_list AND status IN ('draft','active') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
 SELECT * INTO c FROM public.shopping_catalog_items WHERE id=p_product AND is_active;
 IF NOT FOUND OR p_quantity IS NULL OR p_quantity<=0 OR p_quantity>10000 OR length(p_unit) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'suggestion_invalid'; END IF;
 SELECT id INTO v_id FROM public.shopping_list_items WHERE list_id=p_list AND catalog_item_id=p_product ORDER BY id LIMIT 1;
 IF v_id IS NULL THEN
  INSERT INTO public.shopping_list_items(list_id,catalog_item_id,category_id,quantity,unit,price)
  VALUES(p_list,p_product,c.category_id,p_quantity,p_unit,c.default_price) RETURNING id INTO v_id;
 END IF;
 RETURN jsonb_build_object('item_id',v_id);
END $$;

CREATE FUNCTION public.shopping_delete_draft(p_list bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.shopping_lists WHERE id=p_list FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.shopping_checkouts WHERE list_id=p_list)
 OR EXISTS(SELECT 1 FROM public.shopping_purchase_plans WHERE list_id=p_list) THEN RAISE EXCEPTION 'shopping_history_archive_instead'; END IF;
 DELETE FROM public.shopping_list_items WHERE list_id=p_list;
 DELETE FROM public.shopping_lists WHERE id=p_list;
END $$;
REVOKE ALL ON FUNCTION public.shopping_delete_draft(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_delete_draft(bigint) TO service_role;

-- Prevent plan/history deletion. Archive lists once evidence exists; never partially delete checkout history.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['shopping_regular_products','shopping_purchase_plans','shopping_receipts','shopping_confirmed_purchases'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.shopping_lock_item(),public.shopping_snapshot(bigint),public.shopping_receipt_command(bigint,text,jsonb),public.shopping_checkout(bigint,bigint,bigint,jsonb),public.shopping_accept_suggestion(bigint,bigint,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_receipt_command(bigint,text,jsonb),public.shopping_checkout(bigint,bigint,bigint,jsonb),public.shopping_accept_suggestion(bigint,bigint,numeric,text) TO service_role;
GRANT DELETE ON public.shopping_regular_products TO service_role;
COMMIT;
