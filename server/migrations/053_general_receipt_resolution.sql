-- #96: guarded owner resolution of immutable receipt-only evidence. Requires 052.
BEGIN;
LOCK TABLE public.transactions IN EXCLUSIVE MODE;
CREATE TABLE public.transaction_api_resolutions (
 receipt_id BIGINT NOT NULL REFERENCES public.transaction_api_receipts(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 50),
 request_key UUID NOT NULL UNIQUE,
 command_hash TEXT NOT NULL CHECK (length(command_hash)=64),
 request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
 evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=20000),
 observation_id BIGINT UNIQUE REFERENCES public.transaction_source_observations(id) ON DELETE RESTRICT,
 result JSONB NOT NULL,
 actor TEXT NOT NULL,
 reason TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
 relationship JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(receipt_id,revision)
);
ALTER TABLE public.transaction_api_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_api_resolutions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER transaction_api_resolutions_immutable BEFORE UPDATE OR DELETE ON public.transaction_api_resolutions
 FOR EACH ROW EXECUTE FUNCTION public.apy_append_only();
-- Same shape as the original receipt, for shared reconciliation safeguards.
CREATE VIEW public.transaction_api_current AS
 SELECT r.id,r.source_id,r.item_key,coalesce(v.request_hash,r.request_hash) request_hash,
 coalesce(v.evidence,r.evidence) evidence,coalesce(v.observation_id,r.observation_id) observation_id,
 coalesce(v.result,r.result) result,r.created_at
 FROM public.transaction_api_receipts r LEFT JOIN LATERAL
 (SELECT * FROM public.transaction_api_resolutions WHERE receipt_id=r.id ORDER BY revision DESC LIMIT 1) v ON true;
REVOKE ALL ON public.transaction_api_current FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_general_receipt(p_receipt BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.transaction_api_current%ROWTYPE; facts JSONB; history JSONB; rev INTEGER;
BEGIN
 SELECT * INTO r FROM public.transaction_api_current WHERE id=p_receipt;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT coalesce(max(revision),0),coalesce(jsonb_agg(to_jsonb(v) ORDER BY revision),'[]') INTO rev,history
 FROM public.transaction_api_resolutions v WHERE receipt_id=p_receipt;
 SELECT jsonb_build_object('registration',to_jsonb(g),'source',to_jsonb(s),'payments',
  (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.payment_sources p
   WHERE coalesce(s.configuration->'payment_source_ids','[]') ? p.id::text)) INTO facts
 FROM public.transaction_api_registrations g JOIN public.transaction_ingestion_sources s ON s.id=g.source_id WHERE g.source_id=r.source_id;
 RETURN jsonb_build_object('receipt_id',r.id::text,'revision',rev,'review_token',public.apy_hash(jsonb_build_array(to_jsonb(r),rev,facts)),
  'account',(SELECT account_key FROM public.transaction_api_registrations WHERE source_id=r.source_id),
  'original_evidence',(SELECT evidence FROM public.transaction_api_receipts WHERE id=r.id),
  'evidence',r.evidence,'history',history,'result',public.transaction_api_result(r.id));
END $$;
REVOKE ALL ON FUNCTION public.get_general_receipt(BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_general_receipt(BIGINT) TO service_role;

-- Shared evaluator and revised replay reader are defined below before deployment.
CREATE FUNCTION public.resolve_general_receipt(p_request_key UUID,p_command JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.transaction_api_current%ROWTYPE; previous public.transaction_api_resolutions%ROWTYPE;
 review JSONB; item JSONB=p_command->'item'; rel JSONB=p_command->'relationship'; result JSONB; n INTEGER; k TEXT;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 PERFORM public.apy_keys(p_command,ARRAY['receipt_id','expected_revision','review_token','item','reason','relationship','actor']);
 PERFORM public.apy_keys(rel,ARRAY['kind','evidence_reference']);
 IF p_request_key IS NULL OR coalesce(p_command->>'receipt_id','') !~ '^[1-9][0-9]{0,18}$'
  OR coalesce(p_command->>'expected_revision','') !~ '^([0-9]|[1-4][0-9]|50)$'
  OR coalesce(p_command->>'review_token','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_command->>'actor','') !~ '^owner:[a-f0-9-]{36}$'
  OR coalesce(length(p_command->>'reason'),0) NOT BETWEEN 10 AND 500
  OR coalesce(rel->>'kind','') NOT IN ('same_identity','provider_link')
  OR (rel->>'kind'='provider_link' AND coalesce(length(rel->>'evidence_reference'),0) NOT BETWEEN 10 AND 500)
  THEN RAISE EXCEPTION 'invalid_resolution' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous FROM public.transaction_api_resolutions WHERE request_key=p_request_key;
 IF FOUND THEN
  IF previous.command_hash<>public.apy_hash(p_command) THEN RETURN public.apy_rejected('command_key_conflict'); END IF;
  RETURN public.transaction_api_result(previous.receipt_id,true)||jsonb_build_object('resolved_revision',previous.revision);
 END IF;
 SELECT * INTO r FROM public.transaction_api_current WHERE id=(p_command->>'receipt_id')::bigint;
 IF NOT FOUND THEN RETURN public.apy_rejected('receipt_not_found'); END IF;
 PERFORM 1 FROM public.transaction_api_registrations WHERE source_id=r.source_id FOR SHARE;
 PERFORM 1 FROM public.transaction_ingestion_sources WHERE id=r.source_id FOR UPDATE;
 PERFORM 1 FROM public.payment_sources p JOIN public.transaction_ingestion_sources s ON s.id=r.source_id
  WHERE coalesce(s.configuration->'payment_source_ids','[]') ? p.id::text FOR SHARE OF p;
 review=public.get_general_receipt(r.id);
 IF review->>'review_token'<>p_command->>'review_token' OR review->>'revision'<>p_command->>'expected_revision'
  THEN RETURN public.apy_rejected('stale_review'); END IF;
 IF r.observation_id IS NOT NULL THEN RETURN public.apy_rejected('observation_review_required'); END IF;
 n=(review->>'revision')::integer+1;
 IF n>50 THEN RETURN public.apy_rejected('resolution_limit'); END IF;
 -- This is a revision of the reserved occurrence, never a new delivery identity.
 IF item->>'key' IS DISTINCT FROM r.item_key THEN RETURN public.apy_rejected('delivery_key_change_forbidden'); END IF;
 IF (r.evidence->'provider_reference' IS DISTINCT FROM item->'provider_reference'
   OR r.evidence->>'identity_basis' IS DISTINCT FROM item->>'identity_basis') AND rel->>'kind'<>'provider_link'
  THEN RETURN public.apy_rejected('identity_relationship_required'); END IF;
 -- No owner command may turn a known refund/FX observation into an ordinary ILS expense.
 FOREACH k IN ARRAY ARRAY['kind','basis','purchase_key'] LOOP
  IF nullif(r.evidence#>>ARRAY['event',k],'unknown') IS NOT NULL
   AND r.evidence#>ARRAY['event',k] IS DISTINCT FROM item#>ARRAY['event',k]
   THEN RETURN public.apy_rejected('known_event_change_forbidden'); END IF;
 END LOOP;
 IF r.evidence#>>'{charged,currency}' IS NOT NULL AND r.evidence#>>'{charged,currency}' IS DISTINCT FROM item#>>'{charged,currency}'
  THEN RETURN public.apy_rejected('known_currency_change_forbidden'); END IF;
 IF r.evidence->>'legacy_external_id' IS DISTINCT FROM item->>'legacy_external_id'
  THEN RETURN public.apy_rejected('historical_identity_change_forbidden'); END IF;
 result=public.evaluate_general_transaction(review->>'account',item,r.id);
 IF NOT coalesce((result->>'accepted')::boolean,false) THEN RETURN result; END IF;
 INSERT INTO public.transaction_api_resolutions(receipt_id,revision,request_key,command_hash,request_hash,evidence,observation_id,result,actor,reason,relationship)
 VALUES(r.id,n,p_request_key,public.apy_hash(p_command),public.apy_hash(item),item,(result->>'observation_id')::bigint,result,
  p_command->>'actor',p_command->>'reason',rel);
 RETURN public.transaction_api_result(r.id)||jsonb_build_object('resolved_revision',n);
END $$;
REVOKE ALL ON FUNCTION public.resolve_general_receipt(UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_general_receipt(UUID,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.transaction_api_result(p_receipt BIGINT,p_replay BOOLEAN DEFAULT false) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.transaction_api_receipts%ROWTYPE; a JSONB; result JSONB;
BEGIN
 SELECT * INTO STRICT r FROM public.transaction_api_current WHERE id=p_receipt;
 result=r.result;
 IF r.observation_id IS NOT NULL THEN
  a=public.apy_result(r.observation_id);
  result=result||jsonb_build_object('observation_id',a->>'observation_id','transaction_id',a->>'transaction_id',
   'financial_posted',a->>'transaction_id' IS NOT NULL AND a->>'disposition'<>'cancelled',
   'review_required',a->'review_required','disposition',a->>'disposition','reason_code',a->>'reason_code',
   'decision_revision',a->>'decision_revision');
 END IF;
 RETURN result||jsonb_build_object('receipt_id',r.id::text,'revision',(SELECT coalesce(max(revision),0) FROM public.transaction_api_resolutions WHERE receipt_id=r.id),'replayed',p_replay,
  'outcome',CASE WHEN p_replay THEN 'replay' ELSE result->>'outcome' END,'original_outcome',(SELECT original.result->>'outcome' FROM public.transaction_api_receipts original WHERE original.id=r.id));
END $$;

CREATE FUNCTION public.evaluate_general_transaction(p_account TEXT,p_item JSONB,p_receipt BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reg public.transaction_api_registrations%ROWTYPE; src public.transaction_ingestion_sources%ROWTYPE;
 old public.transaction_api_receipts%ROWTYPE; other public.transaction_api_receipts%ROWTYPE;
 e JSONB=p_item->'event'; d JSONB=p_item->'dates'; m JSONB=p_item->'charged'; value JSONB; k TEXT;
 reason TEXT; payment BIGINT; payments BIGINT[]; h TEXT; obs JSONB; result JSONB; receipt BIGINT; accounting_date DATE;
 current_number INTEGER; total_number INTEGER; purchase_key TEXT=e->>'purchase_key'; a JSONB;
BEGIN
 -- Same lock order as APY and legacy reservations: one item is one DB transaction.
 PERFORM set_config('lock_timeout','3s',true);
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 SELECT * INTO reg FROM public.transaction_api_registrations WHERE account_key=p_account FOR SHARE;
 IF NOT FOUND OR NOT reg.enabled THEN RETURN jsonb_build_object('outcome','rejected','accepted',false,'financial_posted',false,'review_required',false,'retryable',false,'reason_code','registration_required'); END IF;
 SELECT * INTO src FROM public.transaction_ingestion_sources WHERE id=reg.source_id FOR UPDATE;
 IF NOT FOUND OR NOT src.is_active OR src.source_kind<>'cal' THEN
  RETURN jsonb_build_object('outcome','rejected','accepted',false,'financial_posted',false,'review_required',false,'retryable',false,'reason_code','source_unavailable'); END IF;
 -- Service-role only, but independently reject unsupported fields and unsafe primitives.
 PERFORM public.apy_keys(p_item,ARRAY['key','identity_basis','legacy_external_id','merchant','event','dates','charged','original','provider_reference','related_provider_reference','hints']);
 PERFORM public.apy_keys(e,ARRAY['kind','status','basis','purchase_key','installment','provider_type']);
 PERFORM public.apy_keys(d,ARRAY['purchase','mapped','billing','occurred_at','timezone']);
 IF octet_length(p_item::text)>20000 OR jsonb_typeof(p_item->'key') IS DISTINCT FROM 'string'
  OR length(p_item->>'key') NOT BETWEEN 1 AND 255 OR p_item->>'key'<>btrim(p_item->>'key')
  OR coalesce(p_item->>'identity_basis','') NOT IN ('provider','durable_delivery','unresolved')
  OR coalesce(e->>'kind','') NOT IN ('expense','income','refund','unknown') OR coalesce(e->>'status','') NOT IN ('pending','completed','unknown')
  OR coalesce(e->>'basis','') NOT IN ('single','installment','whole_purchase','unknown')
  OR coalesce(length(p_item->>'merchant'),0) NOT BETWEEN 1 AND 200 OR public.apy_merchant(p_item->>'merchant')=''
  THEN RAISE EXCEPTION 'invalid_general_evidence' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['purchase','mapped','billing'] LOOP
  IF NOT d ? k THEN RAISE EXCEPTION 'missing_date_evidence' USING ERRCODE='22023'; END IF;
  IF d->>k IS NOT NULL THEN PERFORM public.apy_date(d->>k); END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['charged','original'] LOOP
  IF NOT p_item ? k THEN RAISE EXCEPTION 'missing_money_evidence' USING ERRCODE='22023'; END IF;
  value=p_item->k;
  IF value<>'null'::jsonb THEN
   PERFORM public.apy_keys(value,ARRAY['amount','currency','scale']);
   IF jsonb_typeof(value->'amount') IS DISTINCT FROM 'string' OR value->>'amount' !~ '^-?\d{1,28}(\.\d{1,6})?$'
    OR coalesce(value->>'currency','') !~ '^[A-Z]{3}$' OR coalesce(value->>'scale','') !~ '^[0-6]$'
    OR length(split_part(value->>'amount','.',2))<>(value->>'scale')::integer
    OR (e->>'kind' IN ('expense','income') AND (value->>'amount')::numeric<0)
    OR (e->>'kind'='refund' AND (value->>'amount')::numeric>0)
    THEN RAISE EXCEPTION 'invalid_money_evidence' USING ERRCODE='22023'; END IF;
  END IF;
 END LOOP;
 IF e->>'installment' IS NOT NULL THEN
  PERFORM public.apy_keys(e->'installment',ARRAY['current','total']);
  IF (e#>>'{installment,current}' IS NOT NULL AND e#>>'{installment,current}' !~ '^\d{1,3}$')
   OR (e#>>'{installment,total}' IS NOT NULL AND e#>>'{installment,total}' !~ '^\d{1,3}$') THEN RAISE EXCEPTION 'invalid_installments' USING ERRCODE='22023'; END IF;
  current_number=(e#>>'{installment,current}')::integer; total_number=(e#>>'{installment,total}')::integer;
  IF current_number>total_number OR (e->>'basis'='single' AND (current_number IS DISTINCT FROM 0 OR total_number IS DISTINCT FROM 0)) THEN RAISE EXCEPTION 'contradictory_installments' USING ERRCODE='22023'; END IF;
 END IF;
 h=public.apy_hash(p_item);
 SELECT * INTO old FROM public.transaction_api_receipts WHERE source_id=src.id AND item_key=p_item->>'key';
 IF FOUND AND p_receipt IS NULL THEN
  IF old.request_hash=h OR EXISTS(SELECT 1 FROM public.transaction_api_resolutions WHERE receipt_id=old.id AND request_hash=h) THEN
   RETURN public.transaction_api_result(old.id,true)||jsonb_build_object('matched_revision',CASE WHEN old.request_hash=h THEN 0 ELSE
    (SELECT min(revision) FROM public.transaction_api_resolutions WHERE receipt_id=old.id AND request_hash=h) END); END IF;
  RETURN jsonb_build_object('outcome','conflict','accepted',false,'financial_posted',NULL,'review_required',true,'retryable',false,
   'reason_code','identity_content_changed','receipt_id',old.id::text,'replayed',false);
 END IF;
 -- Last4/name never choose an account. Registration must designate exactly one existing source.
 SELECT array_agg(p.id ORDER BY p.id) INTO payments FROM public.payment_sources p
  WHERE coalesce(src.configuration->'payment_source_ids','[]') ? p.id::text;
 IF coalesce(cardinality(payments),0)=0 THEN reason='mapping_missing';
 ELSIF cardinality(payments)>1 THEN reason='mapping_ambiguous';
 ELSE
  payment=payments[1];
  PERFORM 1 FROM public.payment_sources WHERE id=payment AND is_active FOR SHARE;
  IF NOT FOUND THEN reason='inactive_card_review'; END IF;
 END IF;
 IF reason IS NULL AND NOT reg.history_reviewed THEN reason='historical_transition_review'; END IF;
 IF reason IS NULL AND (EXISTS(SELECT 1 FROM public.transactions WHERE external_id=coalesce(p_item->>'legacy_external_id',p_item->>'key'))
  OR EXISTS(SELECT 1 FROM public.cal_ingestion_receipts WHERE external_id=coalesce(p_item->>'legacy_external_id',p_item->>'key'))
  OR EXISTS(SELECT 1 FROM public.transaction_source_observations WHERE source_id=src.id AND idempotency_key=p_item->>'key')) THEN reason='historical_identity_reserved'; END IF;
 IF reason IS NULL AND p_item->>'identity_basis'='unresolved' THEN reason='identity_unresolved'; END IF;
 IF reason IS NULL AND e->>'status'<>'completed' THEN reason='source_not_completed'; END IF;
 IF reason IS NULL AND e->>'kind' NOT IN ('expense','income') THEN reason='unsupported_event_kind'; END IF;
 IF reason IS NULL AND (m->>'currency' IS DISTINCT FROM 'ILS' OR m->>'amount' IS NULL OR (m->>'amount')::numeric<=0
  OR m->>'scale' IS DISTINCT FROM '2') THEN reason='exact_ils_charge_required'; END IF;
 IF reason IS NULL AND e->>'basis'='unknown' THEN reason='event_basis_unresolved'; END IF;
 IF reason IS NULL AND e->>'basis'='whole_purchase' THEN reason='whole_purchase_not_posted'; END IF;
 IF reason IS NULL AND e->>'basis'='installment' THEN
  IF current_number IS NULL OR total_number IS NULL OR current_number<1 OR total_number<2 OR purchase_key IS NULL THEN reason='installment_evidence_required';
  ELSIF d->>'purchase' IS NULL THEN reason='installment_purchase_date_required';
  ELSIF reg.installment_date_policy='review' THEN reason='installment_policy_required'; END IF;
 END IF;
 -- Purchase group and ordinal are scoped producer evidence, never merchant/amount hashes.
 IF reason IS NULL AND purchase_key IS NOT NULL THEN
  FOR other IN SELECT * FROM public.transaction_api_current r WHERE r.id IS DISTINCT FROM p_receipt AND r.source_id=src.id AND r.evidence#>>'{event,purchase_key}'=purchase_key LOOP
   IF (other.evidence#>>'{event,basis}'='single' OR e->>'basis'='single')
    OR (e->>'basis'='installment' AND other.evidence#>>'{event,basis}'='installment'
     AND (other.evidence#>>'{event,installment,current}')::integer=current_number)
    THEN reason='purchase_identity_reserved'; EXIT;
   END IF;
   IF e->>'basis'='installment' AND other.evidence#>>'{event,installment,total}' IS NOT NULL
    AND (other.evidence#>>'{event,installment,total}')::integer<>total_number THEN reason='installment_count_conflict'; EXIT; END IF;
  END LOOP;
 END IF;
 accounting_date=CASE WHEN e->>'basis'='installment' THEN (d->>'billing')::date ELSE (d->>'purchase')::date END;
 IF reason IS NULL AND accounting_date IS NULL THEN reason='accounting_date_evidence_required'; END IF;
 IF reason IS NULL AND e->>'basis'='installment' THEN
  -- A Wallet/legacy whole-purchase observation may have a DIFFERENT amount.
  -- Do not let the simple APY amount matcher create installment cash beside it.
  IF EXISTS(SELECT 1 FROM public.transactions t WHERE t.payment_source_id=payment
   AND (abs(t.transaction_date-(d->>'purchase')::date)<=1 OR abs(t.transaction_date-accounting_date)<=1)
   AND NOT EXISTS(SELECT 1 FROM public.transaction_api_current r JOIN public.transaction_source_observations o ON o.id=r.observation_id
    WHERE o.transaction_id=t.id AND r.source_id=src.id AND r.evidence#>>'{event,basis}'='installment')) THEN reason='installment_existing_purchase_review'; END IF;
 END IF;
 IF reason IS NULL THEN
  obs=jsonb_strip_nulls(jsonb_build_object('idempotency_key',p_item->>'key','merchant',p_item->>'merchant',
   'accounting_amount',m->>'amount','currency','ILS','movement_type',e->>'kind','transaction_date',accounting_date::text,
   'charge_date',d->>'billing','occurred_at',d->>'occurred_at','payment_source_id',payment::text,
   'provider_reference',p_item->'provider_reference','source_metadata',jsonb_build_object('channel',
    CASE WHEN e->>'basis'='installment' THEN 'general_v1_installment' ELSE 'general_v1' END,'provider_status',e->>'status'),
   'original_amount',p_item#>>'{original,amount}','original_currency',p_item#>>'{original,currency}','original_scale',p_item#>'{original,scale}'));
  a=public.ingest_observation(src.id,obs);
  IF a->>'observation_id' IS NULL THEN reason=coalesce(a->>'reason_code','ingestion_rejected');
  ELSE
   result=jsonb_build_object('outcome',CASE WHEN (a->>'review_required')::boolean THEN 'review_required' ELSE a->>'outcome' END,
    'accepted',true,'retryable',false,'review_required',a->'review_required','financial_posted',a->>'transaction_id' IS NOT NULL,'reason_code',a->>'reason_code');
  END IF;
 END IF;
 IF reason IS NOT NULL THEN result=jsonb_build_object('outcome','review_required','accepted',true,'retryable',false,
  'review_required',true,'financial_posted',false,'reason_code',reason); END IF;
 IF p_receipt IS NOT NULL THEN RETURN result||jsonb_build_object('observation_id',a->>'observation_id'); END IF;
 INSERT INTO public.transaction_api_receipts(source_id,item_key,request_hash,evidence,observation_id,result)
 VALUES(src.id,p_item->>'key',h,p_item,(a->>'observation_id')::bigint,result) RETURNING id INTO receipt;
 RETURN public.transaction_api_result(receipt);
END $$;
REVOKE ALL ON FUNCTION public.evaluate_general_transaction(TEXT,JSONB,BIGINT) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ingest_general_transaction(p_account TEXT,p_item JSONB) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.evaluate_general_transaction(p_account,p_item,NULL);
$$;
CREATE OR REPLACE FUNCTION public.ingest_observation(p_source_id BIGINT,p_observation JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
<<ingestion>>
DECLARE s public.transaction_ingestion_sources%ROWTYPE; old public.transaction_source_observations%ROWTYPE; o public.transaction_source_observations%ROWTYPE;
 n JSONB; p JSONB; hash TEXT; payment BIGINT; merchant_key TEXT; category BIGINT; ref_verified BOOLEAN; time_valid BOOLEAN;
 c RECORD; t public.transactions%ROWTYPE; candidates JSONB='{}'; entry JSONB; candidate_ids INTEGER[]='{}'; refs INTEGER[]='{}'; times INTEGER[]='{}'; unknowns INTEGER[]='{}';
 target INTEGER; reason TEXT; outcome TEXT; sentinel TEXT; strong_ref BOOLEAN; comparable BOOLEAN; compatible BOOLEAN; saturated BOOLEAN; v RECORD; count_candidates INTEGER; merchant_compatible BOOLEAN;
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 SELECT * INTO s FROM public.transaction_ingestion_sources WHERE id=p_source_id FOR UPDATE;
 IF NOT FOUND OR NOT s.is_active OR s.source_kind='legacy_api' THEN RETURN public.apy_rejected('source_unavailable'); END IF;
 BEGIN n=public.apy_normalize(p_observation);
 EXCEPTION WHEN SQLSTATE '22023' OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN public.apy_rejected(CASE WHEN SQLSTATE='22023' THEN SQLERRM ELSE 'invalid_input' END); END;
 p=n->'input'; hash=public.apy_hash(p);
 SELECT * INTO old FROM public.transaction_source_observations WHERE source_id=s.id AND idempotency_key=p->>'idempotency_key' FOR UPDATE;
 IF FOUND THEN
  IF old.payload_fingerprint=hash THEN RETURN public.apy_result(old.id,true); END IF;
  INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,transaction_id,actor,reason_code,evidence)
  VALUES(s.id,old.id,'conflict',old.transaction_id,'source','idempotency_key_conflict',jsonb_build_object('received_fingerprint',hash));
  RETURN public.apy_result(old.id)||jsonb_build_object('outcome','conflict','review_required',true,'reason_code','idempotency_key_conflict');
 END IF;
 BEGIN
  payment=public.apy_payment_source(s.configuration,p); category=(p->>'category_id')::bigint;
  IF category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=category AND is_active AND savings_role IS NULL AND type=p->>'movement_type') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  IF category IS NOT NULL THEN
   PERFORM 1 FROM public.categories WHERE id=category AND is_active AND savings_role IS NULL AND type=p->>'movement_type' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  END IF;
 EXCEPTION WHEN SQLSTATE '22023' THEN RETURN public.apy_rejected(SQLERRM); END;
 SELECT 'alias:'||(a->>'key') INTO merchant_key FROM jsonb_array_elements(coalesce(s.configuration->'aliases','[]')) a
 WHERE public.apy_merchant(a->>'merchant')=n->>'merchant' AND (a->>'payment_source_id' IS NULL OR a->>'payment_source_id'=payment::text) LIMIT 1;
 merchant_key=coalesce(merchant_key,'raw:'||(n->>'merchant'));
 ref_verified=p->>'provider_reference' IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(s.configuration->'verified_references','[]')) r WHERE r=(p->'provider_reference')-'value');
 time_valid=coalesce((s.configuration->>'time_verified')::boolean,false) AND n->>'instant' IS NOT NULL;
 FOR c IN SELECT ob.*,other.source_kind FROM public.transaction_source_observations ob JOIN public.transaction_ingestion_sources other ON other.id=ob.source_id
 WHERE ob.evidence_origin='source' AND ob.transaction_id IS NOT NULL AND ((s.source_kind='apple_pay' AND other.source_kind='cal') OR (s.source_kind='cal' AND other.source_kind='apple_pay'))
 AND ((ob.payment_source_id=payment AND ob.amount_minor=(n->>'amount_minor')::numeric AND ob.currency_code='ILS' AND ob.amount_basis='accounting' AND ob.movement_type=p->>'movement_type'
 AND abs(ob.source_transaction_date-(n->>'date')::date)<=1)
 OR (ref_verified AND ob.reference_verified AND ob.provider_reference=p->'provider_reference')) ORDER BY ob.id LOOP
  SELECT * INTO t FROM public.transactions WHERE id=c.transaction_id;
  merchant_compatible=c.merchant_key=ingestion.merchant_key OR c.normalized_merchant=n->>'merchant';
  strong_ref=ref_verified AND c.reference_verified AND c.provider_reference=p->'provider_reference';
  comparable=time_valid AND c.time_verified AND c.occurred_at IS NOT NULL;
  compatible=comparable AND c.occurred_at<=(n->>'instant')::timestamptz+(n->>'width')::interval AND (n->>'instant')::timestamptz<=c.occurred_at+c.time_width;
  -- Distinct known times can identify separate purchases, including after an old void.
  IF comparable AND NOT compatible AND NOT strong_ref THEN CONTINUE; END IF;
  IF t.voided_at IS NOT NULL THEN sentinel='cancelled_record_exists';
  ELSIF public.apy_protected(t.id) THEN sentinel='protected_transaction';
  ELSIF c.identity_overridden OR c.initial_identity IS DISTINCT FROM public.apy_identity(t) THEN sentinel='identity_edited';
  ELSIF strong_ref AND (c.payment_source_id<>payment OR c.amount_minor<>(n->>'amount_minor')::numeric OR c.movement_type<>p->>'movement_type') THEN sentinel='reference_conflict'; END IF;
  saturated=EXISTS(SELECT 1 FROM public.transaction_source_observations ob WHERE ob.transaction_id=t.id AND ob.source_id=s.id);
  entry=coalesce(candidates->t.id::text,'{}');
  candidates=jsonb_set(candidates,ARRAY[t.id::text],jsonb_build_object('reference',coalesce((entry->>'reference')::boolean,false) OR (strong_ref AND abs(c.source_transaction_date-(n->>'date')::date)<=1 AND NOT saturated),
   'time',coalesce((entry->>'time')::boolean,false) OR (compatible AND merchant_compatible AND NOT saturated),'unknown',coalesce((entry->>'unknown')::boolean,false) OR NOT comparable OR NOT merchant_compatible,
   'merchant',coalesce((entry->>'merchant')::boolean,false) OR merchant_compatible,
   'same_date',coalesce((entry->>'same_date')::boolean,false) OR c.source_transaction_date=(n->>'date')::date,'saturated',coalesce((entry->>'saturated')::boolean,false) OR saturated));
  IF (SELECT count(*) FROM jsonb_object_keys(candidates))>100 THEN EXIT; END IF;
 END LOOP;
 -- Historical/unregistered/manual cash is weak review evidence only. Never auto-enroll it.
 -- Exclude all source-managed rows here: same-source independent purchases stay independent.
 FOR t IN SELECT tx.* FROM public.transactions tx WHERE
  ((tx.payment_source_id=payment AND tx.movement_type=p->>'movement_type'
    AND tx.total_amount*100=(n->>'amount_minor')::numeric AND abs(tx.transaction_date-(n->>'date')::date)<=1)
   OR EXISTS(SELECT 1 FROM public.transaction_source_observations legacy WHERE legacy.transaction_id=tx.id
     AND legacy.evidence_origin IN ('legacy_insert','legacy_backfill') AND legacy.payment_source_id=payment
     AND legacy.movement_type=p->>'movement_type' AND legacy.amount_minor=(n->>'amount_minor')::numeric
     AND abs(legacy.source_transaction_date-(n->>'date')::date)<=1))
  AND NOT EXISTS(SELECT 1 FROM public.transaction_source_observations ob WHERE ob.transaction_id=tx.id AND ob.evidence_origin='source')
  ORDER BY tx.id LIMIT 101 LOOP
  candidates=jsonb_set(candidates,ARRAY[t.id::text],jsonb_build_object('reference',false,'time',false,'unknown',true,
   'merchant',false,'same_date',t.transaction_date=(n->>'date')::date,'saturated',false));
  IF t.voided_at IS NOT NULL THEN sentinel='cancelled_record_exists';
  ELSIF public.apy_protected(t.id) THEN sentinel='protected_transaction';
  ELSIF EXISTS(SELECT 1 FROM public.transaction_source_observations legacy WHERE legacy.transaction_id=t.id
    AND legacy.evidence_origin IN ('legacy_insert','legacy_backfill') AND legacy.initial_identity IS DISTINCT FROM public.apy_identity(t))
    THEN sentinel='identity_edited'; END IF;
 END LOOP;
 count_candidates=(SELECT count(*) FROM jsonb_object_keys(candidates));
 IF count_candidates>100 THEN outcome='ambiguous'; reason='candidate_overflow';
 ELSE
  FOR v IN SELECT * FROM jsonb_each(candidates) LOOP
   candidate_ids=array_append(candidate_ids,v.key::integer);
   IF (v.value->>'reference')::boolean THEN refs=array_append(refs,v.key::integer); END IF;
   IF (v.value->>'time')::boolean THEN times=array_append(times,v.key::integer); END IF;
   IF (v.value->>'unknown')::boolean THEN unknowns=array_append(unknowns,v.key::integer); END IF;
  END LOOP;
  IF sentinel IS NOT NULL THEN outcome='conflict';reason=sentinel;
  ELSIF cardinality(refs)=1 THEN target=refs[1];reason='verified_reference';
  ELSIF cardinality(refs)>1 THEN outcome='ambiguous';reason='competing_references';
  ELSIF cardinality(times)=1 AND NOT EXISTS(SELECT 1 FROM unnest(unknowns) id WHERE id<>times[1]) THEN target=times[1];reason='precision_time';
  ELSIF count_candidates=1 AND cardinality(unknowns)=1 AND (candidates->candidate_ids[1]::text->>'same_date')::boolean
   AND (candidates->candidate_ids[1]::text->>'merchant')::boolean
   AND NOT (candidates->candidate_ids[1]::text->>'saturated')::boolean
   AND NOT EXISTS(SELECT 1 FROM public.transaction_source_observations pending WHERE pending.transaction_id IS NULL AND pending.evidence_origin='source' AND pending.payment_source_id=payment
    AND pending.amount_minor=(n->>'amount_minor')::numeric AND pending.movement_type=p->>'movement_type' AND abs(pending.source_transaction_date-(n->>'date')::date)<=1) THEN target=candidate_ids[1];reason='unique_purchase_tuple';
  ELSIF count_candidates>0 THEN outcome='ambiguous';reason='competing_candidates';
  ELSE outcome='created';reason='no_candidate'; END IF;
 END IF;
 IF target IS NOT NULL THEN outcome='reconciled'; END IF;
 -- General individual-installment evidence must also protect the opposite arrival order.
 -- This is a hold in the existing matcher, not a second reconciliation algorithm.
 IF EXISTS(SELECT 1 FROM public.transaction_api_current r
  JOIN public.transaction_source_observations ob ON ob.id=r.observation_id
  WHERE ob.payment_source_id=payment AND r.evidence#>>'{event,basis}'='installment'
   AND (r.source_id<>s.id OR p#>>'{source_metadata,channel}' IS DISTINCT FROM 'general_v1_installment')
   AND (abs((r.evidence#>>'{dates,purchase}')::date-(n->>'date')::date)<=1
    OR abs(ob.source_transaction_date-(n->>'date')::date)<=1)) THEN
  target=NULL;outcome='conflict';reason='general_installment_purchase_review';
 END IF;

 INSERT INTO public.transaction_source_observations(source_id,idempotency_key,provider_reference,transaction_id,evidence_origin,accepted_payload,payload_fingerprint,source_revision,
 merchant,normalized_merchant,merchant_key,amount_minor,currency_code,amount_basis,movement_type,source_transaction_date,source_charge_date,occurred_at,occurred_at_raw,time_precision,time_width,
 time_verified,reference_verified,date_discrepancy,payment_source_id,source_metadata,outcome,reason_code,review_required,candidate_ids,initial_identity)
 VALUES(s.id,p->>'idempotency_key',nullif(p->'provider_reference','null'),target,'source',p,hash,s.revision,p->>'merchant',n->>'merchant',merchant_key,(n->>'amount_minor')::numeric,'ILS','accounting',p->>'movement_type',
 (n->>'date')::date,(p->>'charge_date')::date,(n->>'instant')::timestamptz,p->>'occurred_at',n->>'precision',(n->>'width')::interval,time_valid,ref_verified,
 coalesce(((n->>'instant')::timestamptz AT TIME ZONE 'Asia/Jerusalem')::date<>(n->>'date')::date,false),payment,p->'source_metadata',
 CASE WHEN outcome='created' THEN 'ambiguous' ELSE outcome END,reason,outcome IN ('ambiguous','conflict'),candidate_ids,
 CASE WHEN target IS NOT NULL THEN (SELECT public.apy_identity(tx) FROM public.transactions tx WHERE tx.id=target) END) RETURNING * INTO o;
 IF outcome='created' THEN target=public.apy_create_cash(o.id); UPDATE public.transaction_source_observations SET outcome='created' WHERE id=o.id;
 ELSIF outcome='reconciled' AND s.source_kind='cal' AND NOT public.apy_enrich(o.id,(p->>'charge_date')::date) THEN
  UPDATE public.transaction_source_observations SET review_required=true,reason_code='enrichment_conflict' WHERE id=o.id;
 END IF;
 INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,transaction_id,actor,reason_code,decision_revision,evidence)
 VALUES(s.id,o.id,outcome,target,'source',reason,1,jsonb_build_object('candidate_ids',candidate_ids,'source_revision',s.revision::text));
 RETURN public.apy_result(o.id);
END $$;



COMMIT;
