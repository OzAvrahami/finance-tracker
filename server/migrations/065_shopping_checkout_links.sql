-- Requires the activated 063 Shopping workflow. Apply before the matching server.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
 IF EXISTS (SELECT FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='shopping_checkout') THEN
  RAISE EXCEPTION 'Legacy Shopping checkout RPC still installed';
 END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='shopping_private.workflow_lock(uuid,uuid,jsonb,jsonb)'::regprocedure) IS DISTINCT FROM 'dfe0b47b9e3e9705917fb4024e2e68fa' THEN
  RAISE EXCEPTION 'Unexpected baseline for shopping_private.workflow_lock';
 END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='shopping_private.checkout_financial(bigint,bigint,bigint,jsonb,jsonb)'::regprocedure) IS DISTINCT FROM 'becb3eda227705ac6721f4dcd1b2b500' THEN
  RAISE EXCEPTION 'Unexpected baseline for shopping_private.checkout_financial';
 END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.shopping_checkout_commit(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure) IS DISTINCT FROM '2385d02ba2624ec41d0fda7e31c827a5' THEN
  RAISE EXCEPTION 'Unexpected baseline for public.shopping_checkout_commit';
 END IF;
END $guard$;

-- Historical rows retain their stored metadata. A new unlinked purchase
-- has no known payment method. Protect new references without backfilling
-- or rewriting historical orphans.
ALTER TABLE public.shopping_checkouts
 ALTER COLUMN payment_method DROP DEFAULT,
 ALTER COLUMN payment_method DROP NOT NULL,
 ADD CONSTRAINT shopping_checkout_expense_fk FOREIGN KEY(transaction_id)
 REFERENCES public.transactions(id) ON DELETE RESTRICT NOT VALID;

CREATE UNIQUE INDEX shopping_checkouts_one_per_expense
 ON public.shopping_checkouts(transaction_id) WHERE transaction_id IS NOT NULL;

-- Household reads are authorized by Express. Expose only recognition and
-- concurrency fields to the backend. Browser roles cannot access this view.
CREATE VIEW public.shopping_checkout_expenses AS
 SELECT t.id, t.id::text AS transaction_id, t.description, t.transaction_date, t.total_amount, t.movement_type, t.voided_at,
        s.name AS payment_source, s.last4, c.list_id AS linked_list_id,
        md5(to_jsonb(t)::text) AS fingerprint,
        concat_ws(' ',t.description,t.transaction_date,t.total_amount,s.name,s.last4) AS search_text
 FROM public.transactions t LEFT JOIN public.payment_sources s ON s.id=t.payment_source_id
 LEFT JOIN public.shopping_checkouts c ON c.transaction_id=t.id;
REVOKE ALL ON public.shopping_checkout_expenses FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.shopping_checkout_expenses TO service_role;

CREATE OR REPLACE FUNCTION shopping_private.workflow_lock(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE op text=p_intent->>'operation';p_id bigint=(p_intent->>'id')::bigint;p_target bigint;f jsonb;s jsonb;c shopping_private.commands;prior public.shopping_checkouts;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'shopping_actor_required' USING ERRCODE='42501'; END IF;
 PERFORM shopping_private.keys(p_intent,ARRAY['operation','id','body'],ARRAY['operation','id','body']);
 IF op='receipt.move' THEN p_target=(p_intent#>>'{body,target_list_id}')::bigint; END IF;
 -- F first: the approved existing financial lock precedes Shopping locks.
 IF op='checkout' AND p_intent#>>'{body,transaction_id}' IS NOT NULL THEN
  PERFORM 1 FROM public.transactions WHERE id=(p_intent#>>'{body,transaction_id}')::bigint FOR SHARE;
 END IF;
 IF p_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_key::text,102060)); END IF;
 IF op LIKE 'lookup.%' THEN PERFORM pg_advisory_xact_lock(420092);
 ELSIF op IN ('commercial.approve','commercial.map','regular.set','regular.remove','receipt.confirm','type.create','type.edit','type.deactivate','entry.category') THEN
  PERFORM 1 FROM shopping_private.catalog_state WHERE singleton FOR UPDATE;
 ELSE PERFORM 1 FROM shopping_private.catalog_state WHERE singleton FOR SHARE; END IF;
 IF op LIKE 'receipt.%' OR op='checkout' THEN
  PERFORM pg_advisory_xact_lock(390092);
  PERFORM 1 FROM public.shopping_lists WHERE id IN(p_id,p_target) ORDER BY id FOR UPDATE;
 END IF;
 SELECT * INTO c FROM shopping_private.commands WHERE actor=p_actor AND request_key=p_key;
 IF FOUND THEN
  IF c.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'shopping_key_conflict'; END IF;
  IF c.http IS NULL THEN RAISE EXCEPTION 'shopping_legacy_result_unavailable'; END IF;
  RETURN jsonb_build_object('replay',jsonb_build_object('committed',true,'replayed',true,'result',c.result,'http',c.http));
 END IF;
 IF op='checkout' THEN
  SELECT * INTO prior FROM public.shopping_checkouts WHERE list_id=p_id;
  IF FOUND THEN
   IF prior.transaction_id IS DISTINCT FROM (p_intent#>>'{body,transaction_id}')::bigint THEN
    RAISE EXCEPTION 'checkout_conflict';
   END IF;
   RETURN jsonb_build_object('replay',shopping_private.workflow_result(p_actor,p_key,p_intent,
    jsonb_build_object('checkout',to_jsonb(prior),'transaction_id',prior.transaction_id,'total_amount',prior.total_amount,'replay',true)));
  END IF;
 END IF;
 f=shopping_private.workflow_facts(op,p_id,p_target);s=shopping_private.list_scope(p_actor,op,p_intent->>'id',p_target::text);
 PERFORM shopping_private.keys(p_expected,ARRAY['token'],ARRAY['token']);
 IF p_expected->>'token' IS DISTINCT FROM shopping_private.token(f,s) THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
 RETURN jsonb_build_object('facts',f);
END $$;

DROP FUNCTION shopping_private.checkout_financial(bigint,bigint,bigint,jsonb,jsonb);
-- Only the service-role facade can accept a server-planned checkout.
CREATE OR REPLACE FUNCTION public.shopping_checkout_commit(
 p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE
 state jsonb;
 target bigint=(p_intent->>'id')::bigint;
 selected_id bigint;
 expense public.transactions;
 saved public.shopping_checkouts;
 history_items jsonb=p_decision->'history_items';
 result jsonb;
BEGIN
 IF p_intent->>'operation' IS DISTINCT FROM 'checkout' THEN RAISE EXCEPTION 'shopping_invalid_operation' USING ERRCODE='23514'; END IF;
 PERFORM shopping_private.keys(p_intent->'body',ARRAY['mode','transaction_id','fingerprint','duplicate_reviewed_ids'],ARRAY['mode']);
 IF p_intent#>>'{body,mode}' = 'linked' THEN
  IF coalesce(p_intent#>>'{body,transaction_id}','') !~ '^[1-9][0-9]*$'
     OR coalesce(p_intent#>>'{body,fingerprint}','') !~ '^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'checkout_selection_invalid'; END IF;
 ELSIF p_intent#>>'{body,mode}' IS DISTINCT FROM 'unlinked' OR (p_intent->'body') ?| ARRAY['transaction_id','fingerprint'] THEN
  RAISE EXCEPTION 'checkout_selection_invalid';
 END IF;
 state=shopping_private.workflow_lock(p_actor,p_key,p_intent,p_expected);IF state?'replay' THEN RETURN state->'replay'; END IF;
 PERFORM shopping_private.keys(p_decision,
  ARRAY['transaction_id','projection','history_items','purchase_date','total_amount'],
  ARRAY['transaction_id','projection','history_items','purchase_date','total_amount']);
 IF p_decision->>'transaction_id' IS DISTINCT FROM p_intent#>>'{body,transaction_id}'
    OR coalesce(p_decision->>'purchase_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR coalesce(p_decision->>'total_amount','') !~ '^[0-9]+[.][0-9]{2}$' THEN
  RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514';
 END IF;
 PERFORM shopping_private.assert_projection(target,p_decision->'projection');
 selected_id=(p_decision->>'transaction_id')::bigint;
 IF selected_id IS NOT NULL THEN
  SELECT * INTO expense FROM public.transactions WHERE id=selected_id FOR SHARE;
  IF NOT FOUND OR md5(to_jsonb(expense)::text) IS DISTINCT FROM p_intent#>>'{body,fingerprint}' THEN
   RAISE EXCEPTION 'checkout_transaction_conflict';
  END IF;
 END IF;

 -- workflow_lock bound the actor, request and complete list/receipt snapshot.
 -- Recheck cross-list acknowledgements under the shared receipt lock.
 PERFORM public.shopping_require_duplicate_review(target,NULL,p_intent#>'{body,duplicate_reviewed_ids}');
 IF jsonb_array_length(state#>'{facts,lists}') <> 1 THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 IF state#>>'{facts,lists,0,status}' NOT IN ('draft','active') THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
 IF (history_items = 'null'::jsonb) IS DISTINCT FROM (jsonb_array_length(state#>'{facts,confirmed}') > 0) THEN
  RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514';
 END IF;

 INSERT INTO public.shopping_purchase_plans(list_id,items) VALUES(target,p_decision->'projection') ON CONFLICT DO NOTHING;
 IF history_items <> 'null'::jsonb THEN
  -- Verify the submitted history against locked checklist evidence. Persist
  -- the JS payload itself. Neither purchase_date nor total_amount is derived here.
  IF history_items = '[]'::jsonb OR history_items IS DISTINCT FROM (
    SELECT coalesce(jsonb_agg(p.value || jsonb_build_object(
      'quantity',coalesce(i.quantity,1)::text,'price',i.price::text,'is_purchased',i.is_purchased)
      ORDER BY i.id),'[]'::jsonb)
    FROM jsonb_array_elements(p_decision->'projection') p
    JOIN public.shopping_list_items i ON i.id=(p.value->>'list_item_id')::bigint
    WHERE i.list_id=target AND i.is_purchased
  ) THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  INSERT INTO public.shopping_confirmed_purchases(list_id,purchase_date,items,basis)
  VALUES(target,(p_decision->>'purchase_date')::date,history_items,'checkout');
 ELSIF p_decision->>'purchase_date' IS DISTINCT FROM state#>>'{facts,confirmed,0,purchase_date}' THEN
  RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514';
 END IF;

 INSERT INTO public.shopping_checkouts(list_id,checkout_date,total_amount,payment_source_id,category_id,transaction_id)
 VALUES(target,(p_decision->>'purchase_date')::date,(p_decision->>'total_amount')::numeric,
        expense.payment_source_id,expense.category_id,selected_id) RETURNING * INTO saved;
 UPDATE public.shopping_lists SET status='checked_out',updated_at=now(),revision=revision+1 WHERE id=target;
 result=jsonb_build_object('checkout',to_jsonb(saved),'transaction_id',saved.transaction_id,'total_amount',saved.total_amount,'replay',false);
 RETURN shopping_private.workflow_result(p_actor,p_key,p_intent,result);
END $$;
REVOKE ALL ON FUNCTION public.shopping_checkout_commit(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_checkout_commit(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
