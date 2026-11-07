-- Classified bank-account credits through the existing unified writer. Requires 056.
-- Refund API amounts remain positive. A separate contra-expense ledger row makes
-- cash positive without classifying a refund as ordinary income or inventing a link.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.transactions IN EXCLUSIVE MODE;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS bank_movement TEXT;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_bank_movement_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_bank_movement_check CHECK (
 bank_movement IS NULL OR (bank_movement='refund' AND movement_type='expense' AND total_amount<0
 AND loan_id IS NULL AND parent_transaction_id IS NULL AND installment_number IS NULL AND installment_count IS NULL));
ALTER TABLE public.transaction_source_observations DROP CONSTRAINT transaction_source_observations_check1;
ALTER TABLE public.transaction_source_observations ADD CONSTRAINT transaction_source_observations_check1 CHECK (
 evidence_origin<>'source' OR outcome IN ('ambiguous','conflict') OR
 ((amount_minor>0 OR coalesce((amount_minor<0 AND movement_type='expense' AND accepted_payload#>>'{_request,type}'='refund'
 AND source_metadata->>'bank_movement'='refund'),false)) AND currency_code='ILS' AND amount_basis='accounting'
 AND movement_type IN ('expense','income') AND source_transaction_date IS NOT NULL
 AND payment_source_id IS NOT NULL AND merchant IS NOT NULL AND normalized_merchant<>''));
CREATE OR REPLACE FUNCTION public.apy_identity(t public.transactions) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('amount',t.total_amount,'movement_type',t.movement_type,'currency',t.currency,
 'original_amount',t.original_amount,'exchange_rate',t.exchange_rate,'transaction_date',t.transaction_date,
 'payment_source_id',t.payment_source_id::text)||CASE WHEN t.bank_movement IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('bank_movement',t.bank_movement) END;
$$;

-- Preserve fingerprints of legacy rows; refund markers are evidence for new rows.
CREATE OR REPLACE FUNCTION public.apy_cash_fingerprint(p_id INTEGER) RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT md5(((CASE WHEN t.bank_movement IS NULL THEN to_jsonb(t)-'bank_movement' ELSE to_jsonb(t) END)-ARRAY['updated_at','voided_at','void_request_key','void_fingerprint','void_reason'])::text) FROM public.transactions t WHERE id=p_id;
$$;

CREATE OR REPLACE FUNCTION public.apy_review_fingerprints(p_id BIGINT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(jsonb_object_agg(t.id::text,md5((CASE WHEN t.bank_movement IS NULL THEN to_jsonb(t)-'bank_movement' ELSE to_jsonb(t) END)::text)),'{}') FROM public.transactions t WHERE t.id IN (
 SELECT unnest(o.candidate_ids) FROM public.transaction_source_observations o WHERE o.id=p_id
 UNION SELECT other.transaction_id FROM public.transaction_source_observations o JOIN public.transaction_source_observations other
 ON other.payment_source_id=o.payment_source_id AND other.amount_minor=o.amount_minor AND other.movement_type=o.movement_type
 AND abs(other.source_transaction_date-o.source_transaction_date)<=1
 WHERE o.id=p_id AND other.transaction_id IS NOT NULL
 UNION SELECT tx.id FROM public.transactions tx JOIN public.transaction_source_observations o
 ON tx.payment_source_id=o.payment_source_id AND tx.total_amount*100=o.amount_minor AND tx.movement_type=o.movement_type
 AND abs(tx.transaction_date-o.source_transaction_date)<=1 WHERE o.id=p_id);
$$;

CREATE OR REPLACE FUNCTION public.apy_normalize(p JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n JSONB; k TEXT; v JSONB; ts TEXT; r TEXT[]; precision TEXT; width TEXT; instant TIMESTAMPTZ; d DATE; amount NUMERIC;
BEGIN
 PERFORM public.apy_keys(p,ARRAY['idempotency_key','provider_reference','merchant','accounting_amount','currency','movement_type','transaction_date',
 'occurred_at','charge_date','payment_source_id','payment_evidence','category_id','source_metadata','original_amount','original_currency','original_scale']);
 IF jsonb_typeof(p->'idempotency_key') IS DISTINCT FROM 'string' OR length(p->>'idempotency_key') NOT BETWEEN 1 AND 255
 OR p->>'idempotency_key'<>btrim(p->>'idempotency_key') THEN RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p->'accounting_amount') IS DISTINCT FROM 'string' OR p->>'accounting_amount' !~ '^-?\d{1,28}(\.\d{1,2})?$' THEN RAISE EXCEPTION 'invalid_accounting_amount' USING ERRCODE='22023'; END IF;
 amount=(p->>'accounting_amount')::numeric;
 IF amount=0 OR (amount<0 AND NOT coalesce(p->>'movement_type'='expense' AND p#>>'{source_metadata,bank_movement}'='refund',false)) OR (amount>0 AND p#>>'{source_metadata,bank_movement}'='refund') THEN RAISE EXCEPTION 'invalid_accounting_amount' USING ERRCODE='22023'; END IF;
 IF p->>'currency' IS DISTINCT FROM 'ILS' THEN RAISE EXCEPTION 'accounting_amount_required' USING ERRCODE='22023'; END IF;
 IF coalesce(p->>'movement_type','') NOT IN ('expense','income') THEN RAISE EXCEPTION 'unsupported_event_kind' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p->'merchant') IS DISTINCT FROM 'string' OR length(p->>'merchant') NOT BETWEEN 1 AND 512 OR public.apy_merchant(p->>'merchant')='' THEN RAISE EXCEPTION 'invalid_merchant' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['payment_source_id','category_id'] LOOP
  IF p->>k IS NOT NULL AND (jsonb_typeof(p->k)<>'string' OR p->>k !~ '^[1-9]\d{0,18}$') THEN RAISE EXCEPTION 'invalid_identifier' USING ERRCODE='22023'; END IF;
  IF p->>k IS NOT NULL THEN PERFORM (p->>k)::bigint; END IF;
 END LOOP;
 IF p->>'provider_reference' IS NOT NULL THEN
  PERFORM public.apy_keys(p->'provider_reference',ARRAY['provider','type','scope','value']);
  FOREACH k IN ARRAY ARRAY['provider','type','scope','value'] LOOP
   IF jsonb_typeof(p->'provider_reference'->k) IS DISTINCT FROM 'string' OR length(p->'provider_reference'->>k) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'invalid_provider_reference' USING ERRCODE='22023'; END IF;
  END LOOP;
 END IF;
 PERFORM public.apy_keys(coalesce(nullif(p->'payment_evidence','null'),'{}'),ARRAY['card_reference','last4','issuer','method','owner','name']);
 FOR k,v IN SELECT * FROM jsonb_each(coalesce(nullif(p->'payment_evidence','null'),'{}')) LOOP
  IF jsonb_typeof(v)<>'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 255 OR (k='last4' AND v#>>'{}' !~ '^\d{4}$') THEN RAISE EXCEPTION 'invalid_payment_evidence' USING ERRCODE='22023'; END IF;
 END LOOP;
 PERFORM public.apy_keys(coalesce(nullif(p->'source_metadata','null'),'{}'),ARRAY['provider_status','channel','terminal_reference','bank_movement']);
 IF octet_length(coalesce(p->'source_metadata','{}')::text)>8192 THEN RAISE EXCEPTION 'metadata_too_large' USING ERRCODE='22023'; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(coalesce(nullif(p->'source_metadata','null'),'{}')) LOOP
  IF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>255 THEN RAISE EXCEPTION 'invalid_metadata' USING ERRCODE='22023'; END IF;
 END LOOP;
 ts=p->>'occurred_at';
 IF ts IS NOT NULL THEN
  r=regexp_match(ts,'^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d)(\.(\d{1,6}))?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)?$');
  IF r IS NULL OR length(ts)>80 OR ts~'[+-]14:(?!00)' THEN RAISE EXCEPTION 'invalid_occurred_at' USING ERRCODE='22023'; END IF;
  PERFORM public.apy_date(r[1]);
  precision=CASE WHEN r[7] IS NOT NULL THEN 'fractional_'||length(r[7]) WHEN r[5] IS NOT NULL THEN 'second' ELSE 'minute' END;
  width=CASE WHEN r[7] IS NOT NULL THEN (1/power(10::numeric,length(r[7])))::text||' seconds' WHEN r[5] IS NOT NULL THEN '1 second' ELSE '1 minute' END;
  IF r[8] IS NOT NULL THEN instant=ts::timestamptz; END IF;
 END IF;
 d=CASE WHEN p->>'transaction_date' IS NOT NULL THEN public.apy_date(p->>'transaction_date') ELSE (instant AT TIME ZONE 'Asia/Jerusalem')::date END;
 IF d IS NULL THEN RAISE EXCEPTION 'transaction_date_required' USING ERRCODE='22023'; END IF;
 IF p->>'charge_date' IS NOT NULL THEN PERFORM public.apy_date(p->>'charge_date'); END IF;
 IF p->>'original_amount' IS NOT NULL THEN
  IF jsonb_typeof(p->'original_amount')<>'string' OR p->>'original_amount' !~ '^\d{1,28}(\.\d{1,6})?$'
  OR (p->>'original_amount')::numeric<=0 OR coalesce(p->>'original_currency','') !~ '^[A-Z]{3}$'
  OR coalesce(p->>'original_scale','') !~ '^[0-6]$' THEN RAISE EXCEPTION 'invalid_original_amount' USING ERRCODE='22023'; END IF;
  IF length(split_part(p->>'original_amount','.',2))>(p->>'original_scale')::integer THEN RAISE EXCEPTION 'invalid_original_amount' USING ERRCODE='22023'; END IF;
 ELSIF p->>'original_currency' IS NOT NULL OR p->>'original_scale' IS NOT NULL THEN RAISE EXCEPTION 'invalid_original_amount' USING ERRCODE='22023'; END IF;
 n=jsonb_build_object('idempotency_key',p->>'idempotency_key','provider_reference',p->'provider_reference','merchant',p->>'merchant',
 'accounting_amount',CASE WHEN amount<0 THEN '-' ELSE '' END||trunc(abs(amount))::text||'.'||lpad(mod(abs(amount)*100,100)::integer::text,2,'0'),'currency','ILS','movement_type',p->>'movement_type',
 'transaction_date',p->>'transaction_date','occurred_at',ts,'charge_date',p->>'charge_date','payment_source_id',p->>'payment_source_id',
 'category_id',p->>'category_id','payment_evidence',coalesce(nullif(p->'payment_evidence','null'),'{}'),'source_metadata',coalesce(nullif(p->'source_metadata','null'),'{}'),
 'original_amount',p->>'original_amount','original_currency',p->>'original_currency','original_scale',p->>'original_scale');
 RETURN jsonb_build_object('input',n,'amount_minor',trunc(amount*100)::text,'date',d,'instant',instant,'precision',precision,'width',width,'merchant',public.apy_merchant(p->>'merchant'));
END $$;

CREATE OR REPLACE FUNCTION public.apy_create_cash(p_observation_id BIGINT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE o public.transaction_source_observations%ROWTYPE; t public.transactions%ROWTYPE;
 r JSONB; row_data JSONB; charge DATE;
BEGIN
 SELECT * INTO STRICT o FROM public.transaction_source_observations WHERE id=p_observation_id FOR UPDATE;
 IF o.transaction_id IS NOT NULL OR o.evidence_origin<>'source' THEN
  RAISE EXCEPTION 'observation_already_linked' USING ERRCODE='22023'; END IF;
 IF o.outcome<>'created' AND o.reason_code<>'no_candidate' AND EXISTS(SELECT 1 FROM public.transaction_ingestion_sources WHERE id=o.source_id AND source_kind='manual') THEN
  RAISE EXCEPTION 'manual_domain_resume_required' USING ERRCODE='22023'; END IF;
 IF o.reason_code IN ('payment_source_not_found','payment_source_ambiguous','historical_identity_reserved',
  'bank_event_semantics_required','refund_semantics_required','original_amount_required','identity_evidence_required') THEN
  RAISE EXCEPTION 'evidence_correction_required' USING ERRCODE='22023'; END IF;
 IF o.amount_minor IS NULL OR o.amount_minor=0 OR o.source_transaction_date IS NULL THEN
  RAISE EXCEPTION 'incomplete_accounting_evidence' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.payment_sources WHERE id=o.payment_source_id AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payment_source_not_found' USING ERRCODE='22023'; END IF;
 IF o.accepted_payload->>'category_id' IS NOT NULL THEN
  PERFORM 1 FROM public.categories WHERE id=(o.accepted_payload->>'category_id')::bigint
   AND is_active AND savings_role IS NULL AND type=o.movement_type FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
 END IF;
 IF o.amount_minor<0 AND NOT coalesce(o.movement_type='expense'
  AND o.accepted_payload#>>'{_request,type}'='refund' AND o.accepted_payload#>>'{_creation,bank_movement}'='refund'
  AND EXISTS(SELECT 1 FROM public.transaction_ingestion_sources WHERE id=o.source_id AND source_kind='external_api' AND instance_key='unified:v1')
  AND EXISTS(SELECT 1 FROM public.payment_sources WHERE id=o.payment_source_id AND method='bank_account' AND is_active),false) THEN
  RAISE EXCEPTION 'refund_source_unsupported' USING ERRCODE='22023'; END IF;
 charge=public.apy_charge_evidence(o.id);
 -- Private posting authorization: a locked observation touched by this command
 -- in this transaction. Callers cannot manufacture it through a session setting.
 UPDATE public.transaction_source_observations SET decision_revision=decision_revision WHERE id=o.id;
 row_data=o.accepted_payload->'_creation';
 IF row_data IS NULL THEN
  -- Old immutable observations still use their original projection.
  INSERT INTO public.transactions(description,total_amount,currency,movement_type,transaction_date,charge_date,payment_source_id,category_id)
  VALUES(o.merchant,o.amount_minor/100,'ILS',o.movement_type,o.source_transaction_date,
   coalesce(charge,o.source_transaction_date),o.payment_source_id,(o.accepted_payload->>'category_id')::bigint) RETURNING * INTO t;
  UPDATE public.transactions tx SET notes=r.creation_fields->>'notes',
   tags=(SELECT string_agg(value,',' ORDER BY ordinal) FROM jsonb_array_elements_text(r.creation_fields->'tags') WITH ORDINALITY a(value,ordinal))
  FROM public.cal_ingestion_receipts r WHERE r.observation_id=o.id AND tx.id=t.id;
 ELSIF row_data->>'loan_id' IS NOT NULL THEN
  -- Preserve the authoritative Loan writer and its single atomic cash/payment action.
  r=public.create_transaction_with_manual_loan_payment(row_data,o.accepted_payload#>'{_domain,loan_payment}');
  SELECT * INTO STRICT t FROM public.transactions WHERE id=(r#>>'{transaction,id}')::integer;
  INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,transaction_id,actor,reason_code,result)
   VALUES(o.source_id,o.id,'created',t.id,'domain','manual_loan',r);
 ELSE
  INSERT INTO public.transactions(description,movement_type,total_amount,transaction_date,charge_date,payment_source_id,
   category_id,currency,original_amount,exchange_rate,notes,tags,external_id,installment_number,installment_count,
   installments_info,global_discount,global_discount_source,parent_transaction_id,bank_movement)
  VALUES(row_data->>'description',o.movement_type,o.amount_minor/100,o.source_transaction_date,
   coalesce(charge,o.source_transaction_date),o.payment_source_id,(row_data->>'category_id')::bigint,
   coalesce(row_data->>'currency','ILS'),(row_data->>'original_amount')::numeric,(row_data->>'exchange_rate')::numeric,
   row_data->>'notes',row_data->>'tags',row_data->>'external_id',(row_data->>'installment_number')::integer,
   (row_data->>'installment_count')::integer,row_data->>'installments_info',coalesce((row_data->>'global_discount')::numeric,0),
   row_data->>'global_discount_source',(row_data->>'parent_transaction_id')::bigint,row_data->>'bank_movement') RETURNING * INTO t;
 END IF;
 UPDATE public.transaction_source_observations SET transaction_id=t.id,initial_identity=public.apy_identity(t),
  charge_date_origin=CASE WHEN charge IS NULL THEN 'provisional_purchase_date' ELSE 'source_supplied' END WHERE id=o.id;
 RETURN t.id;
END $$;

CREATE OR REPLACE FUNCTION public.unified_ingest(p_source_id BIGINT,p_observation JSONB,p_creation JSONB DEFAULT NULL,p_request JSONB DEFAULT NULL,p_hold TEXT DEFAULT NULL,p_domain JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
 IF n#>>'{input,source_metadata,bank_movement}'='refund' AND NOT coalesce(
  s.source_kind='external_api' AND s.instance_key='unified:v1' AND p_request->>'type'='refund'
  AND p_creation->>'bank_movement'='refund',false) THEN RETURN public.apy_rejected('refund_source_unsupported'); END IF;
 p=n->'input'; hash=public.apy_hash(coalesce(p_request,p));
 SELECT * INTO old FROM public.transaction_source_observations WHERE source_id=s.id AND idempotency_key=p->>'idempotency_key' FOR UPDATE;
 IF FOUND THEN
  IF old.payload_fingerprint=hash THEN
   IF s.source_kind='manual' AND old.transaction_id IS NULL AND old.reason_code='manual_domain_approved' THEN
    IF public.apy_review_fingerprints(old.id) IS DISTINCT FROM (SELECT evidence->'candidate_fingerprints'
      FROM public.transaction_reconciliation_events WHERE observation_id=old.id AND reason_code='manual_domain_approved' ORDER BY id DESC LIMIT 1) THEN
     RETURN public.apy_result(old.id)||jsonb_build_object('reason_code','stale_review','review_required',true);
    END IF;
    UPDATE public.transaction_source_observations SET reason_code='no_candidate' WHERE id=old.id;
    target=public.apy_create_cash(old.id);
    UPDATE public.transaction_source_observations SET outcome='created',review_required=false,reason_code='owner_separate',decision_revision=decision_revision+1 WHERE id=old.id;
    INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,transaction_id,actor,reason_code)
     VALUES(s.id,old.id,'created',target,'manual','owner_separate');
    RETURN public.apy_result(old.id)||jsonb_build_object('accounting',(SELECT result FROM public.transaction_reconciliation_events WHERE observation_id=old.id AND actor='domain' ORDER BY id DESC LIMIT 1));
   END IF;
   RETURN public.apy_result(old.id,true);
  END IF;
  INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,transaction_id,actor,reason_code,evidence)
  VALUES(s.id,old.id,'conflict',old.transaction_id,'source','idempotency_key_conflict',jsonb_build_object('received_fingerprint',hash));
  RETURN public.apy_result(old.id)||jsonb_build_object('outcome','conflict','review_required',true,'reason_code','idempotency_key_conflict');
 END IF;
 BEGIN
  IF s.instance_key IN ('unified:v1','unified:manual','unified:csv') THEN
   payment=(p->>'payment_source_id')::bigint;
   PERFORM 1 FROM public.payment_sources WHERE id=payment AND is_active FOR SHARE;
   IF NOT FOUND THEN p_hold=coalesce(p_hold,'payment_source_not_found');payment=NULL; END IF;
  ELSE payment=public.apy_payment_source(s.configuration,p); END IF;
  category=(p->>'category_id')::bigint;
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
 WHERE ob.evidence_origin='source' AND ob.transaction_id IS NOT NULL AND (ob.source_id<>s.id OR s.source_kind='manual'
   OR (s.source_kind='external_api' AND p_creation->>'external_id' IS NULL)
   OR (s.source_kind='file_import' AND ob.source_metadata->>'terminal_reference' IS DISTINCT FROM p#>>'{source_metadata,terminal_reference}'))
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
  ELSIF count_candidates>0 THEN outcome='ambiguous';reason='competing_candidates';
  ELSE outcome='created';reason='no_candidate'; END IF;
 END IF;
 IF target IS NOT NULL THEN outcome='reconciled'; END IF;
 -- Without a series reference the public contract cannot distinguish whole
 -- purchases from installments. Keep both arrival orders out of automatic cash.
 IF EXISTS(SELECT 1 FROM public.transaction_source_observations ob
  WHERE ob.payment_source_id=payment AND ob.idempotency_key<>p->>'idempotency_key'
   AND ((ob.accepted_payload#>>'{_creation,installment_count}')::integer>1
    OR ob.source_metadata->>'channel'='general_v1_installment'))
 OR EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.payment_source_id=payment AND coalesce(tx.installment_count,1)>1)
 OR (s.source_kind='manual' AND (p_creation->>'installment_count')::integer>1
  AND EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.payment_source_id=payment
   AND abs(tx.transaction_date-(n->>'date')::date)<=1)) THEN
  p_hold=coalesce(p_hold,'installment_series_review');
 END IF;
 IF EXISTS(SELECT 1 FROM public.transaction_source_observations ob
  WHERE ob.transaction_id IS NULL AND ob.source_id<>s.id AND ob.payment_source_id=payment
   AND ob.amount_minor=(n->>'amount_minor')::numeric AND ob.movement_type=p->>'movement_type'
   AND abs(ob.source_transaction_date-(n->>'date')::date)<=1) THEN
  p_hold=coalesce(p_hold,'pending_observation_review');
 END IF;
 IF p_hold IS NOT NULL THEN target=NULL;outcome='ambiguous';reason=p_hold; END IF;

 INSERT INTO public.transaction_source_observations(source_id,idempotency_key,provider_reference,transaction_id,evidence_origin,accepted_payload,payload_fingerprint,source_revision,
 merchant,normalized_merchant,merchant_key,amount_minor,currency_code,amount_basis,movement_type,source_transaction_date,source_charge_date,occurred_at,occurred_at_raw,time_precision,time_width,
 time_verified,reference_verified,date_discrepancy,payment_source_id,source_metadata,outcome,reason_code,review_required,candidate_ids,initial_identity)
 VALUES(s.id,p->>'idempotency_key',nullif(p->'provider_reference','null'),target,'source',p || CASE WHEN p_creation IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('_creation',p_creation,'_request',p_request,'_domain',p_domain) END,hash,s.revision,p->>'merchant',n->>'merchant',merchant_key,(n->>'amount_minor')::numeric,'ILS','accounting',p->>'movement_type',
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
 RETURN public.apy_result(o.id)||jsonb_build_object('created_at',(SELECT created_at FROM public.transactions WHERE id=target),
  'accounting',(SELECT result FROM public.transaction_reconciliation_events WHERE observation_id=o.id AND actor='domain' ORDER BY id DESC LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.ingest_external_transaction(p_request JSONB,p_dry_run BOOLEAN DEFAULT false) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sid BIGINT; payment BIGINT; matches BIGINT[]; category BIGINT; key TEXT; hold TEXT; row_data JSONB; ledger_kind TEXT; ledger_amount NUMERIC;
 obs JSONB; result JSONB; selector_name TEXT=p_request->>'payment_source_name'; digits TEXT; old public.cal_ingestion_receipts%ROWTYPE;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 PERFORM public.apy_keys(p_request,ARRAY['type','amount','date','charge_date','description','category_id','payment_source_id',
  'payment_source_name','currency','original_amount','exchange_rate','notes','tags','external_id','installment_number','installment_count']);
 IF octet_length(p_request::text)>20000 OR coalesce(p_request->>'type','') NOT IN ('expense','income','refund')
  OR jsonb_typeof(p_request->'amount') IS DISTINCT FROM 'number'
  OR coalesce(p_request->>'amount','') !~ '^\d+(\.\d{1,2})?$' OR (p_request->>'amount')::numeric<=0
  OR (p_request->>'amount')::numeric>90071992547409.91 THEN RETURN public.apy_rejected('invalid_accounting_amount'); END IF;
 PERFORM public.apy_date(p_request->>'date');
 IF p_request->>'charge_date' IS NOT NULL THEN PERFORM public.apy_date(p_request->>'charge_date'); END IF;
 IF coalesce(p_request->>'currency','ILS') !~ '^[A-Z]{3}$' THEN RETURN public.apy_rejected('invalid_currency'); END IF;
 IF (p_request ? 'original_amount' AND (jsonb_typeof(p_request->'original_amount')<>'number' OR (p_request->>'original_amount')::numeric<=0))
 OR (p_request ? 'exchange_rate' AND (jsonb_typeof(p_request->'exchange_rate')<>'number' OR (p_request->>'exchange_rate')::numeric<=0)) THEN
  RETURN public.apy_rejected('invalid_numeric_evidence'); END IF;
 IF (p_request ? 'installment_number')<>(p_request ? 'installment_count')
 OR (p_request ? 'installment_number' AND (p_request->>'type'<>'expense'
  OR p_request->>'installment_number' !~ '^[1-9]\d{0,2}$' OR p_request->>'installment_count' !~ '^[1-9]\d{0,2}$'
  OR (p_request->>'installment_count')::integer<2 OR (p_request->>'installment_number')::integer>(p_request->>'installment_count')::integer)) THEN
  RETURN public.apy_rejected('invalid_installment'); END IF;
 ledger_kind=CASE WHEN p_request->>'type'='refund' THEN 'expense' ELSE p_request->>'type' END;
 ledger_amount=(p_request->>'amount')::numeric*CASE WHEN p_request->>'type'='refund' THEN -1 ELSE 1 END;
 key=p_request->>'external_id';
 IF key IS NOT NULL AND (jsonb_typeof(p_request->'external_id')<>'string' OR length(key) NOT BETWEEN 1 AND 255 OR key<>btrim(key)) THEN
  RETURN public.apy_rejected('invalid_external_id'); END IF;
 IF p_request->>'payment_source_id' IS NOT NULL THEN
  payment=(p_request->>'payment_source_id')::bigint;
  PERFORM 1 FROM public.payment_sources WHERE id=payment AND is_active FOR SHARE;
  IF NOT FOUND THEN payment=NULL;hold='payment_source_not_found'; END IF;
 ELSE
  digits=regexp_replace(coalesce(selector_name,''),'\D','','g');
  SELECT array_agg(id ORDER BY id) INTO matches FROM public.payment_sources WHERE is_active AND selector_name IS NOT NULL
   AND CASE WHEN length(digits)>=4 THEN last4=right(digits,4) ELSE lower(payment_sources.name)=lower(selector_name) END;
  IF cardinality(matches)=1 THEN payment=matches[1];
  ELSE hold=CASE WHEN cardinality(matches)>1 THEN 'payment_source_ambiguous' ELSE 'payment_source_not_found' END; END IF;
 END IF;
 category=(p_request->>'category_id')::bigint;
 IF category IS NULL AND p_request->>'description' IS NOT NULL THEN
  SELECT c.id INTO category FROM public.categories c WHERE c.is_active AND c.savings_role IS NULL AND c.type=ledger_kind
   AND EXISTS(SELECT 1 FROM unnest(c.keywords) k WHERE position(lower(k) in lower(p_request->>'description'))>0) ORDER BY c.id LIMIT 1;
 END IF;
 IF category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=category AND is_active AND savings_role IS NULL AND type=ledger_kind) THEN
  RETURN public.apy_rejected('invalid_category'); END IF;
 IF EXISTS(SELECT 1 FROM public.payment_sources WHERE id=payment AND method IN ('bank_transfer','check')) THEN hold=coalesce(hold,'bank_event_semantics_required'); END IF;
 IF p_request->>'type' IN ('income','refund') AND NOT EXISTS(SELECT 1 FROM public.payment_sources WHERE id=payment AND method='bank_account') THEN hold=coalesce(hold,'refund_semantics_required'); END IF;
 IF p_request->>'type'='refund' AND coalesce(p_request->>'currency','ILS')<>'ILS' THEN RETURN public.apy_rejected('refund_currency_unsupported'); END IF;
 IF p_request->>'type' IN ('income','refund') AND key IS NULL THEN hold=coalesce(hold,'identity_evidence_required'); END IF;
 IF p_request ? 'installment_number' THEN hold=coalesce(hold,'installment_series_required'); END IF;
 IF coalesce(p_request->>'currency','ILS')<>'ILS' AND NOT p_request ? 'original_amount' THEN hold=coalesce(hold,'original_amount_required'); END IF;
 -- Historical identities are consulted before a new namespace can claim them.
 SELECT * INTO old FROM public.cal_ingestion_receipts WHERE external_id=key;
 IF FOUND AND old.request_hash=public.apy_hash(p_request) AND NOT p_dry_run THEN RETURN public.apy_result(old.observation_id,true); END IF;
 IF old.external_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.transactions WHERE external_id=key)
  OR EXISTS(SELECT 1 FROM public.transaction_api_receipts WHERE item_key=key) THEN hold=coalesce(hold,'historical_identity_reserved'); END IF;
 row_data=jsonb_strip_nulls(jsonb_build_object('description',p_request->>'description','movement_type',ledger_kind,'bank_movement',CASE WHEN p_request->>'type'='refund' THEN 'refund' END,
  'total_amount',ledger_amount,'transaction_date',p_request->>'date','charge_date',coalesce(p_request->>'charge_date',p_request->>'date'),
  'payment_source_id',payment,'category_id',category,'currency',coalesce(p_request->>'currency','ILS'),
  'original_amount',p_request->'original_amount','exchange_rate',p_request->'exchange_rate','external_id',key,
  'notes',p_request->>'notes','tags',(SELECT string_agg(value,',' ORDER BY ordinal) FROM jsonb_array_elements_text(coalesce(p_request->'tags','[]')) WITH ORDINALITY a(value,ordinal)),
  'installment_number',p_request->'installment_number','installment_count',p_request->'installment_count',
  'installments_info',CASE WHEN p_request ? 'installment_number' THEN (p_request->>'installment_number')||'/'||(p_request->>'installment_count') END));
 IF p_dry_run THEN RETURN jsonb_build_object('dry_run',true,'would_insert',row_data,'matching_deferred',true,
  'resolved',jsonb_build_object('payment_source_id',payment,'category_id',category),
  'duplicate',CASE WHEN hold='historical_identity_reserved' THEN jsonb_build_object('exists',true) ELSE 'null'::jsonb END,
  'review_reason',hold); END IF;
 SELECT id INTO STRICT sid FROM public.transaction_ingestion_sources WHERE source_kind='external_api' AND instance_key='unified:v1';
 obs=jsonb_strip_nulls(jsonb_build_object('idempotency_key',coalesce(key,gen_random_uuid()::text),
  'merchant',coalesce(nullif(p_request->>'description',''),'(description not supplied)'),
  'accounting_amount',ledger_amount::text,'currency','ILS','movement_type',ledger_kind,'transaction_date',p_request->>'date',
  'charge_date',p_request->>'charge_date','payment_source_id',payment::text,'category_id',category::text,
  'source_metadata',jsonb_strip_nulls(jsonb_build_object('channel','external_v1','bank_movement',CASE WHEN p_request->>'type'='refund' THEN 'refund' END))));
 RETURN public.unified_ingest(sid,obs,row_data,p_request,hold);
END $$;
REVOKE ALL ON FUNCTION public.apy_normalize(JSONB),public.apy_create_cash(BIGINT),public.unified_ingest(BIGINT,JSONB,JSONB,JSONB,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ingest_external_transaction(JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_external_transaction(JSONB,BOOLEAN) TO service_role;
-- The nullable marker must not invalidate existing owner previews or mutation
-- checks. Retain the exact legacy hash material when absent; include it on refunds.
-- These existing definitions change only their transaction hash expressions.
CREATE OR REPLACE FUNCTION public.transactions_filtered(
  p_from                date    DEFAULT NULL,
  p_to                  date    DEFAULT NULL,
  p_category_id         bigint  DEFAULT NULL,
  p_payment_source_id   bigint  DEFAULT NULL,
  p_uncategorized_only  boolean DEFAULT false,
  p_search              text    DEFAULT NULL,
  p_savings_account_id bigint DEFAULT NULL,
  p_transaction_id integer DEFAULT NULL,
  p_savings_flow text DEFAULT NULL
)
RETURNS TABLE (
  id                integer,
  transaction_date  date,
  description       text,
  movement_type     text,
  total_amount      numeric,
  row_json          jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT
    t.id,
    t.transaction_date,
    t.description::text,
    t.movement_type::text,
    t.total_amount,
    pg_catalog.to_jsonb(t) || pg_catalog.jsonb_build_object(
      'total_amount',t.total_amount::text, 'category_id',t.category_id::text,'payment_source_id',t.payment_source_id::text,
      'cash_flow',cf.kind,
      'transaction_fingerprint',md5(((CASE WHEN t.bank_movement IS NULL THEN to_jsonb(t)-'bank_movement' ELSE to_jsonb(t) END)-ARRAY['updated_at','voided_at','void_request_key','void_fingerprint','void_reason'])::text),
      'savings',CASE WHEN se.id IS NULL THEN NULL ELSE jsonb_build_object('entry_id',se.id::text,'account_id',sa.id::text,'name',sa.name,'status',sa.status,'revision',sa.revision::text,'event_kind',se.event_kind,'source_kind',se.source_kind,'active',se.reversed_by_entry_id IS NULL,'reinstatable',se.reversed_by_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.savings_entries replacement WHERE replacement.supersedes_entry_id=se.id)) END,
      'categories',
      CASE WHEN c.id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object('name', c.name, 'icon', c.icon, 'savings_role',c.savings_role) END,
      'payment_sources',
      CASE WHEN ps.id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object(
             'id',     ps.id,
             'name',   ps.name,
             'method', ps.method,
             'slug',   ps.slug,
             'issuer', ps.issuer,
             'last4',  ps.last4
           ) END
    )
  FROM public.transactions t
  -- LEFT JOIN is required: transactions with no category or no payment source
  -- must still appear (the "uncategorized only" filter depends on it).
  LEFT JOIN public.categories      c  ON c.id  = t.category_id
  LEFT JOIN public.payment_sources ps ON ps.id = t.payment_source_id
  LEFT JOIN LATERAL (SELECT e.* FROM public.savings_entries e WHERE e.transaction_id=t.id AND e.entry_action='post' ORDER BY (e.reversed_by_entry_id IS NULL) DESC,e.id DESC LIMIT 1) se ON true
  LEFT JOIN public.savings_accounts sa ON sa.id=se.account_id
  CROSS JOIN LATERAL (SELECT CASE
    WHEN t.voided_at IS NOT NULL THEN 'cancelled'
    WHEN se.reversed_by_entry_id IS NULL AND c.savings_role=se.event_kind
      AND ((se.event_kind='deposit' AND t.movement_type='expense')
        OR (se.event_kind IN ('withdrawal','interest_payout') AND t.movement_type='income')) THEN se.event_kind
    WHEN t.movement_type='expense' THEN 'ordinary_expense' ELSE 'ordinary_income' END AS kind) cf
  WHERE (p_savings_flow IS NULL OR cf.kind=p_savings_flow)
    AND (t.voided_at IS NULL OR p_transaction_id=t.id)
    AND (p_transaction_id IS NULL OR p_transaction_id=t.id)
    AND (p_savings_account_id IS NULL OR se.account_id=p_savings_account_id)
    AND (p_from IS NULL OR t.transaction_date >= p_from)
    AND (p_to   IS NULL OR t.transaction_date <= p_to)
    AND (p_category_id IS NULL OR t.category_id = p_category_id)
    AND (p_payment_source_id IS NULL OR t.payment_source_id = p_payment_source_id)
    AND (NOT COALESCE(p_uncategorized_only, false) OR t.category_id IS NULL)
    AND (
      public.transactions_search_pattern(p_search) IS NULL
      -- Mirrors the previous client-side search exactly: description,
      -- amount-as-text, category name, payment source name. Notes are NOT
      -- searched, because the old implementation did not search them.
      OR t.description        ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR t.total_amount::text ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR sa.name              ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR c.name               ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR ps.name              ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
    );
$$;

CREATE OR REPLACE FUNCTION public.savings_post_event_locked(p_request_key UUID,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
<<cmd>>
DECLARE
  op TEXT=p_command->>'operation'; c JSONB=coalesce(p_command->'payload','{}');
  k TEXT; value JSONB; fp TEXT; reason TEXT=nullif(btrim(p_command->>'reason'),'');
  a public.savings_accounts%ROWTYPE; old_a public.savings_accounts%ROWTYPE;
  e public.savings_entries%ROWTYPE; t public.transactions%ROWTYPE;
  category public.categories%ROWTYPE; source public.payment_sources%ROWTYPE;
  account_id BIGINT; transaction_id INTEGER; category_id BIGINT; source_id BIGINT;
  amount NUMERIC; effective DATE; charge DATE; kind TEXT; action TEXT; revision BIGINT;
  reversed_id BIGINT; entry_id BIGINT; entry_index INTEGER=0; cash_fp TEXT;
  receipt JSONB; result JSONB; affected JSONB; months JSONB; reinstate BOOLEAN=false;
  occurrence DATE; due DATE; captured_plan BIGINT; fulfillment BOOLEAN=false; restore_skip BOOLEAN=false;
  claim public.savings_entries%ROWTYPE;
  old_overlap NUMERIC=0; new_overlap NUMERIC; reserve_balance NUMERIC;
  old_item public.budget_operation_items%ROWTYPE; month_id BIGINT; operation_id BIGINT; reserve_id BIGINT;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'יש לנסות שוב בבידוד READ COMMITTED' USING ERRCODE='22023';
  END IF;
  IF p_request_key IS NULL OR jsonb_typeof(c) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'חסרים פרטי פעולה ומזהה בקשה' USING ERRCODE='22023';
  END IF;
  FOR k,value IN SELECT j.key,j.value FROM jsonb_each(c) j LOOP
    IF NOT k=ANY(ARRAY['action','account_id','expected_revision','event_kind','amount','effective_date','transaction_id','expected_transaction_fingerprint','description','category_id','payment_source_id','charge_date','notes','reinstate','expected_destination_revision','cutoff_confirmed','legacy_overlap_amount','overlap_reason','expected_reserve_fingerprint','occurrence_month','expected_due_date','plan_revision','plan_override','reason']) THEN
      RAISE EXCEPTION 'שדה שאינו נתמך בפעולת חיסכון: %',k USING ERRCODE='22023';
    END IF;
    IF value='null'::jsonb THEN CONTINUE; END IF;
    IF k IN ('amount','legacy_overlap_amount') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' OR (value#>>'{}')::numeric>9999999999999999.99 THEN
        RAISE EXCEPTION 'יש להזין סכום מדויק בשקלים עם עד שתי ספרות עשרוניות' USING ERRCODE='22023',DETAIL='SAVINGS_EXACT_MONEY_REQUIRED';
      END IF;
      c=jsonb_set(c,ARRAY[k],to_jsonb(((value#>>'{}')::numeric(18,2))::text));
    ELSIF k IN ('account_id','expected_revision','transaction_id','category_id','payment_source_id','expected_destination_revision') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'מזהה או גרסה אינם תקינים' USING ERRCODE='22023';
      END IF;
    ELSIF k='plan_revision' THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'גרסת התוכנית אינה תקינה' USING ERRCODE='22023'; END IF;
    ELSIF k IN ('effective_date','charge_date','occurrence_month','expected_due_date') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR ((value#>>'{}')::date)::text<>(value#>>'{}') THEN
        RAISE EXCEPTION 'יש להזין תאריך לוח שנה תקין' USING ERRCODE='22023';
      END IF;
    ELSIF k IN ('reinstate','cutoff_confirmed','plan_override') THEN
      IF jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'חסר אישור מפורש לפעולה' USING ERRCODE='22023'; END IF;
    ELSIF jsonb_typeof(value)<>'string' THEN RAISE EXCEPTION 'ערך טקסט אינו תקין' USING ERRCODE='22023';
    ELSE c=jsonb_set(c,ARRAY[k],coalesce(to_jsonb(nullif(btrim(value#>>'{}'),'')),'null'::jsonb)); END IF;
  END LOOP;
  IF op='post_savings_event' THEN reason=nullif(btrim(c->>'reason'),''); END IF;
  IF op NOT IN ('post_savings_event','correct_savings_event','cancel_savings_event','void_detached_savings_transaction') THEN RAISE EXCEPTION 'פעולה לא נתמכת' USING ERRCODE='22023'; END IF;
  IF op<>'post_savings_event' AND (reason IS NULL OR length(reason)>2000) THEN RAISE EXCEPTION 'יש להזין סיבה לתיקון או לביטול, עד 2000 תווים' USING ERRCODE='22023'; END IF;
  LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;
  -- Reserve operations precede row locks, including an opening correction.
  IF op='correct_savings_event' AND EXISTS(SELECT 1 FROM public.savings_entries WHERE id=(p_command->>'entry_id')::bigint AND event_kind='opening') THEN
    LOCK TABLE public.budget_unused_balance_policies IN SHARE ROW EXCLUSIVE MODE;
    PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
  fp=md5((p_command||jsonb_build_object('payload',c,'reason',reason))::text);
  SELECT jsonb_agg(id::text ORDER BY command_index) INTO receipt FROM public.savings_entries WHERE command_id=p_request_key;
  IF receipt IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.savings_entries WHERE command_id=p_request_key AND (command_kind<>op OR command_fingerprint<>fp)) THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר שימש לפרטים אחרים' USING ERRCODE='40001',DETAIL='SAVINGS_LINK_CONFLICT';
    END IF;
    SELECT jsonb_agg(DISTINCT se.account_id::text) INTO affected FROM public.savings_entries se WHERE command_id=p_request_key;
    RETURN jsonb_build_object('entry_ids',receipt,'replayed',true,'affected_account_ids',affected,
      'affected_transaction_ids',(SELECT coalesce(jsonb_agg(DISTINCT se.transaction_id::text) FILTER(WHERE se.transaction_id IS NOT NULL),'[]') FROM public.savings_entries se WHERE command_id=p_request_key),
      'affected_months',(SELECT jsonb_agg(DISTINCT to_char(se.effective_date,'YYYY-MM')) FROM public.savings_entries se WHERE command_id=p_request_key));
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions WHERE void_request_key=p_request_key) AND op<>'void_detached_savings_transaction' THEN
    RAISE EXCEPTION 'מזהה הבקשה כבר שימש לביטול תנועה' USING ERRCODE='40001';
  END IF;
  IF op IN ('correct_savings_event','cancel_savings_event') THEN
    SELECT * INTO e FROM public.savings_entries WHERE id=(p_command->>'entry_id')::bigint;
    IF NOT FOUND OR e.entry_action<>'post' THEN RAISE EXCEPTION 'אירוע החיסכון לא נמצא' USING ERRCODE='P0002'; END IF;
    IF e.event_kind NOT IN ('opening','deposit','withdrawal','interest_capitalized','interest_payout','occurrence_skip') OR e.source_kind='budget_surplus' THEN
      RAISE EXCEPTION 'אירוע זה מחייב את פעולת הריבית, המועד או העודף הייעודית' USING ERRCODE='22023';
    END IF;
    reinstate=coalesce((c->>'reinstate')::boolean,false);
    restore_skip=reinstate AND e.event_kind='occurrence_skip';
    IF ((NOT restore_skip) AND ((e.reversed_by_entry_id IS NOT NULL) IS DISTINCT FROM reinstate)) OR EXISTS(SELECT 1 FROM public.savings_entries WHERE supersedes_entry_id=e.id) THEN
      RAISE EXCEPTION 'האירוע השתנה או כבר הוחלף; יש לרענן' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE';
    END IF;
    IF op='cancel_savings_event' AND (reinstate OR e.event_kind='opening') THEN RAISE EXCEPTION 'אין לבטל יתרת פתיחה או אירוע שכבר בוטל' USING ERRCODE='22023'; END IF;
    account_id=coalesce((c->>'account_id')::bigint,e.account_id);
    transaction_id=e.transaction_id;
  ELSE account_id=(c->>'account_id')::bigint; transaction_id=(c->>'transaction_id')::integer; END IF;
  action=c->>'action';
  IF op='post_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash','noncash','due','skip')) THEN RAISE EXCEPTION 'יש לבחור רישום כספי, קישור או ריבית בחיסכון' USING ERRCODE='22023'; END IF;
  IF op='correct_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash','detach','noncash')) THEN RAISE EXCEPTION 'יש לבחור תיקון, ניתוק או החזרה מפורשת' USING ERRCODE='22023'; END IF;
  IF op='cancel_savings_event' AND action IS DISTINCT FROM (CASE WHEN e.event_kind IN ('interest_capitalized','occurrence_skip') THEN 'none' ELSE 'void' END) THEN
    RAISE EXCEPTION 'לניתוק ללא ביטול הכסף יש לבחור קטגוריה רגילה בטופס התיקון' USING ERRCODE='22023';
  END IF;
  category_id=(c->>'category_id')::bigint; source_id=(c->>'payment_source_id')::bigint;
  kind=coalesce(c->>'event_kind',e.event_kind); amount=(c->>'amount')::numeric;
  effective=(c->>'effective_date')::date; charge=(c->>'charge_date')::date;
  -- Consistent coarse-to-fine lock order. The complete set is intentionally
  -- conservative for the single-user database and foundation deferred scans.
  PERFORM id FROM public.budget_months ORDER BY id FOR UPDATE;
  PERFORM id FROM public.budgets ORDER BY id FOR UPDATE;
  PERFORM id FROM public.categories ORDER BY id FOR UPDATE;
  PERFORM id FROM public.payment_sources ORDER BY id FOR UPDATE;
  IF op<>'void_detached_savings_transaction' THEN PERFORM id FROM public.savings_accounts ORDER BY id FOR UPDATE; END IF;
  IF transaction_id IS NOT NULL THEN
    PERFORM id FROM public.transactions WHERE id=transaction_id FOR UPDATE;
    SELECT * INTO t FROM public.transactions WHERE id=transaction_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'התנועה לא נמצאה' USING ERRCODE='P0002'; END IF;
    cash_fp=md5(((CASE WHEN t.bank_movement IS NULL THEN to_jsonb(t)-'bank_movement' ELSE to_jsonb(t) END)-ARRAY['updated_at','voided_at','void_request_key','void_fingerprint','void_reason'])::text);
  END IF;
  IF op='void_detached_savings_transaction' THEN
    IF t.void_request_key=p_request_key THEN
      IF t.void_fingerprint<>fp THEN RAISE EXCEPTION 'קבלת הביטול אינה תואמת לבקשה' USING ERRCODE='40001'; END IF;
      RETURN jsonb_build_object('replayed',true,'transaction_id',t.id::text,'affected_transaction_ids',jsonb_build_array(t.id::text),'affected_account_ids','[]'::jsonb,'affected_months',jsonb_build_array(to_char(t.transaction_date,'YYYY-MM')));
    END IF;
    IF t.voided_at IS NOT NULL OR cash_fp IS DISTINCT FROM c->>'expected_transaction_fingerprint'
      OR NOT EXISTS(SELECT 1 FROM public.savings_entries WHERE savings_entries.transaction_id=t.id)
      OR EXISTS(SELECT 1 FROM public.savings_entries WHERE savings_entries.transaction_id=t.id AND entry_action='post' AND reversed_by_entry_id IS NULL)
      OR EXISTS(SELECT 1 FROM public.categories WHERE id=t.category_id AND savings_role IS NOT NULL) THEN
      RAISE EXCEPTION 'התנועה אינה מנותקת וחיה או השתנתה; יש לרענן' USING ERRCODE='40001',DETAIL='SAVINGS_LINK_CONFLICT';
    END IF;
  ELSE
    SELECT * INTO a FROM public.savings_accounts WHERE id=account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'חשבון החיסכון לא נמצא' USING ERRCODE='P0002'; END IF;
    IF op='post_savings_event' AND (c->>'occurrence_month' IS NOT NULL OR action IN ('due','skip')) THEN
      occurrence=(c->>'occurrence_month')::date; due=(c->>'expected_due_date')::date; captured_plan=(c->>'plan_revision')::bigint;
      IF occurrence IS NULL OR due IS NULL OR captured_plan IS NULL OR occurrence<>date_trunc('month',due)::date THEN
        RAISE EXCEPTION 'חסרים חודש מתוכנן, מועד וגרסת תוכנית' USING ERRCODE='22023';
      END IF;
      SELECT * INTO claim FROM public.savings_entries se WHERE se.account_id=a.id AND se.occurrence_month=occurrence AND se.entry_action='post' AND se.occurrence_root_id IS NULL;
      IF FOUND THEN
        IF action='due' THEN RETURN jsonb_build_object('status','already_claimed','entry_id',claim.id::text,'affected_account_ids',jsonb_build_array(a.id::text),'affected_transaction_ids','[]'::jsonb,'affected_months','[]'::jsonb); END IF;
        RAISE EXCEPTION 'המועד כבר הוסדר, גם אם ההפקדה בוטלה; להחזרה יש לבחור את האירוע בהיסטוריה' USING ERRCODE='40001',DETAIL='SAVINGS_OCCURRENCE_CLAIMED';
      END IF;
      IF a.status<>'active' OR a.next_due_date IS DISTINCT FROM due OR a.plan_revision<>captured_plan
        OR due>timezone('Asia/Jerusalem',statement_timestamp())::date OR (action='due' AND NOT a.auto_deposit_enabled) THEN
        RAISE EXCEPTION 'המועד, מצב החשבון או התוכנית השתנו או טרם הגיעו; יש לרענן' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE';
      END IF;
      IF action='due' THEN
        IF c ?| ARRAY['amount','effective_date','transaction_id','category_id','payment_source_id','charge_date','event_kind','description','notes','plan_override','cutoff_confirmed'] THEN RAISE EXCEPTION 'הרישום האוטומטי נגזר מהתוכנית בלבד' USING ERRCODE='22023'; END IF;
        kind='deposit'; amount=a.monthly_amount; effective=timezone('Asia/Jerusalem',statement_timestamp())::date; charge=effective; source_id=a.default_payment_source_id;
        SELECT id INTO category_id FROM public.categories WHERE savings_role='deposit' AND is_active;
        c=c||jsonb_build_object('description','הפקדה חודשית — '||a.name,'cutoff_confirmed',true);
        action='create_cash';
      ELSIF action='skip' THEN
        IF a.revision IS DISTINCT FROM (c->>'expected_revision')::bigint THEN RAISE EXCEPTION 'יש לרענן את החיסכון' USING ERRCODE='40001'; END IF;
        IF reason IS NULL OR length(reason)>2000 OR c ?| ARRAY['transaction_id','amount','effective_date','category_id','payment_source_id','charge_date','event_kind'] THEN RAISE EXCEPTION 'דילוג מחייב סיבה וללא פרטי כסף' USING ERRCODE='22023'; END IF;
        INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,occurrence_month,scheduled_due_date,plan_revision,reason)
        VALUES(a.id,p_request_key,0,op,fp,'occurrence_skip',0,due,'schedule_control',occurrence,due,captured_plan,reason) RETURNING id INTO entry_id;
        UPDATE public.savings_accounts SET revision=savings_accounts.revision+1 WHERE id=a.id;
        RETURN jsonb_build_object('status','skipped','entry_id',entry_id::text,'affected_account_ids',jsonb_build_array(a.id::text),'affected_transaction_ids','[]'::jsonb,'affected_months','[]'::jsonb);
      ELSE
        IF action NOT IN ('create_cash','link_cash') OR kind IS DISTINCT FROM 'deposit' THEN RAISE EXCEPTION 'רק הפקדה מפורשת יכולה להסדיר מועד' USING ERRCODE='22023'; END IF;
        IF (amount,source_id) IS DISTINCT FROM (a.monthly_amount,a.default_payment_source_id) AND (c->'plan_override' IS DISTINCT FROM 'true'::jsonb OR reason IS NULL OR length(reason)>2000) THEN
          RAISE EXCEPTION 'הסכום או המקור שונים מהתוכנית; נדרש אישור חריגה מפורש וסיבה' USING ERRCODE='22023';
        END IF;
        IF action='link_cash' THEN
          SELECT * INTO e FROM public.savings_entries se WHERE se.transaction_id=t.id AND se.entry_action='post' AND se.reversed_by_entry_id IS NULL;
          IF FOUND THEN
            IF e.account_id<>a.id OR e.event_kind<>'deposit' OR e.occurrence_month IS NOT NULL OR e.source_kind NOT IN ('manual','existing_transaction') OR (e.amount,e.effective_date,e.cash_payment_source_id,e.cash_category_id,e.cash_charge_date) IS DISTINCT FROM (amount,effective,source_id,category_id,charge) THEN
              RAISE EXCEPTION 'ההפקדה המקושרת אינה מתאימה להסדרת המועד הזה' USING ERRCODE='22023',DETAIL='SAVINGS_LINK_CONFLICT';
            END IF;
            fulfillment=true; reason=coalesce(reason,'שיוך מפורש של הפקדה קיימת למועד החודשי');
          END IF;
        END IF;
      END IF;
    ELSIF c ?| ARRAY['occurrence_month','expected_due_date','plan_revision','plan_override'] THEN
      RAISE EXCEPTION 'מועד מתוכנן נבחר רק בפעולת הסדרה מפורשת' USING ERRCODE='22023';
    END IF;
    IF e.occurrence_month IS NOT NULL THEN
      IF account_id<>e.account_id THEN RAISE EXCEPTION 'אין להעביר מועד מתוכנן לחשבון אחר' USING ERRCODE='22023'; END IF;
      occurrence=e.occurrence_month; due=e.scheduled_due_date; captured_plan=e.plan_revision;
    END IF;
    IF e.id IS NOT NULL THEN
      SELECT * INTO old_a FROM public.savings_accounts WHERE id=e.account_id;
      IF old_a.revision IS DISTINCT FROM (CASE WHEN fulfillment THEN c->>'expected_revision' ELSE p_command->>'expected_revision' END)::bigint THEN RAISE EXCEPTION 'החיסכון השתנה; יש לרענן לפני התיקון' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
      IF account_id<>e.account_id AND a.revision IS DISTINCT FROM (c->>'expected_destination_revision')::bigint THEN RAISE EXCEPTION 'חשבון היעד השתנה; יש לרענן' USING ERRCODE='40001'; END IF;
    ELSIF c->>'action' IS DISTINCT FROM 'due' AND a.revision IS DISTINCT FROM (c->>'expected_revision')::bigint THEN RAISE EXCEPTION 'החיסכון השתנה; יש לרענן לפני הרישום' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
    IF (e.id IS NULL OR reinstate OR account_id<>e.account_id) AND a.status<>'active' THEN RAISE EXCEPTION 'יש לבחור חשבון פעיל לפעילות חדשה' USING ERRCODE='22023',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
    IF op<>'cancel_savings_event' THEN
      IF amount IS NULL OR amount<0 OR (kind<>'opening' AND amount=0) OR kind IS NULL OR kind NOT IN ('deposit','withdrawal','opening','interest_capitalized','interest_payout') THEN RAISE EXCEPTION 'סכום או סוג אירוע אינם תקינים' USING ERRCODE='22023'; END IF;
      IF effective IS NULL OR effective<a.tracking_start_date OR effective>timezone('Asia/Jerusalem',statement_timestamp())::date
        OR (kind<>'opening' AND effective=a.tracking_start_date AND c->'cutoff_confirmed' IS DISTINCT FROM 'true'::jsonb) THEN
        RAISE EXCEPTION 'התאריך חייב להיות בתחום המעקב; ביום הפתיחה יש לאשר שהכסף אינו כלול ביתרת הפתיחה' USING ERRCODE='22023',DETAIL='SAVINGS_CUTOFF_VIOLATION';
      END IF;
      IF e.id IS NULL AND kind='opening' THEN RAISE EXCEPTION 'יתרת פתיחה נוצרת רק עם החשבון' USING ERRCODE='22023'; END IF;
      IF e.id IS NOT NULL AND kind<>e.event_kind AND NOT (kind IN ('interest_capitalized','interest_payout') AND e.event_kind IN ('interest_capitalized','interest_payout')) AND NOT (restore_skip AND kind='deposit') THEN RAISE EXCEPTION 'אין להפוך הפקדה למשיכה; יש לבטל ולרשום אירוע נפרד' USING ERRCODE='22023'; END IF;
      IF reinstate AND kind<>e.event_kind AND NOT (restore_skip AND kind='deposit') THEN RAISE EXCEPTION 'החזרה משחזרת את יעד האירוע המקורי; תיקון יעד נעשה לאחר מכן בנפרד' USING ERRCODE='22023'; END IF;
      IF e.transaction_id IS NULL AND e.id IS NOT NULL AND c->>'transaction_id' IS NOT NULL THEN RAISE EXCEPTION 'המרת ריבית מהחיסכון אינה מקשרת כסף אחר' USING ERRCODE='22023'; END IF;
      IF kind='opening' THEN
        IF action<>'noncash' OR account_id<>e.account_id OR effective<>a.tracking_start_date OR reinstate OR c ?| ARRAY['transaction_id','category_id','payment_source_id','charge_date'] THEN RAISE EXCEPTION 'תיקון פתיחה שומר על החשבון והגבול וללא תנועה כספית' USING ERRCODE='22023'; END IF;
      ELSIF kind='interest_capitalized' THEN
        IF action<>'noncash' OR category_id IS NOT NULL OR source_id IS NOT NULL OR charge IS NOT NULL
          OR (e.transaction_id IS NULL AND transaction_id IS NOT NULL) THEN
          RAISE EXCEPTION 'ריבית שנשארה בחיסכון נרשמת ללא תנועת כסף או פרטי תשלום' USING ERRCODE='22023';
        END IF;
      ELSE
        IF action='noncash' OR (e.event_kind='interest_capitalized' AND action<>'create_cash') THEN
          RAISE EXCEPTION 'ריבית לעו״ש מחייבת פרטי הכנסה; המרת ריבית מהחיסכון יוצרת הכנסה חדשה אחת' USING ERRCODE='22023';
        END IF;
        SELECT * INTO category FROM public.categories WHERE id=category_id;
        SELECT * INTO source FROM public.payment_sources WHERE id=source_id;
        IF category.id IS NULL OR source.id IS NULL OR NOT category.is_active OR NOT source.is_active THEN RAISE EXCEPTION 'יש לבחור קטגוריה ואמצעי תשלום פעילים' USING ERRCODE='22023',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
        IF charge IS NULL OR category.type<>(CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END)
          OR (action='detach' AND category.savings_role IS NOT NULL)
          OR (action<>'detach' AND category.savings_role IS DISTINCT FROM kind) THEN RAISE EXCEPTION 'הקטגוריה אינה מתאימה לכיוון התנועה בחיסכון' USING ERRCODE='22023'; END IF;
        IF nullif(btrim(c->>'description'),'') IS NULL OR length(c->>'description')>2000 OR length(c->>'notes')>10000 THEN RAISE EXCEPTION 'יש להזין תיאור תקין לתנועה' USING ERRCODE='22023'; END IF;
      END IF;
    END IF;
  END IF;
  -- Every old/new cash period must remain free of captured Budget history.
  -- Use typed operation provenance, not merely current-month UI restrictions.
  IF kind IS DISTINCT FROM 'opening' THEN
    IF EXISTS(SELECT 1 FROM public.budget_operations bo JOIN public.budget_months bm ON bm.id=bo.budget_month_id
      WHERE bm.month_start IN (date_trunc('month',t.transaction_date)::date,CASE WHEN kind IN ('deposit','withdrawal','interest_payout') THEN date_trunc('month',effective)::date END)
        AND bo.operation_type IN ('month_close','carryover','unused_disposition','month_disposition'))
      OR EXISTS(SELECT 1 FROM public.budget_operation_items bi JOIN public.budget_months bm ON bm.id=bi.budget_month_id
        WHERE bm.month_start IN (date_trunc('month',t.transaction_date)::date,CASE WHEN kind IN ('deposit','withdrawal','interest_payout') THEN date_trunc('month',effective)::date END)
          AND bi.item_kind IN ('carryover','unused_disposition')) THEN
      RAISE EXCEPTION 'החודש כבר נסגר או נכלל בהעברה תקציבית; נדרש תיקון היסטורי מפורש' USING ERRCODE='22023',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED';
    END IF;
  END IF;
  IF op='void_detached_savings_transaction' THEN
    UPDATE public.transactions SET voided_at=now(),void_request_key=p_request_key,void_fingerprint=fp,void_reason=reason WHERE id=t.id;
    RETURN jsonb_build_object('transaction_id',t.id::text,'affected_transaction_ids',jsonb_build_array(t.id::text),'affected_account_ids','[]'::jsonb,'affected_months',jsonb_build_array(to_char(t.transaction_date,'YYYY-MM')));
  END IF;
  IF transaction_id IS NOT NULL AND op<>'cancel_savings_event' THEN
    IF nullif(btrim(t.installments_info),'') IS NOT NULL OR coalesce(t.installment_number,1)>1 THEN
      RAISE EXCEPTION 'תנועה מיובאת עם פירוט תשלומים אינה מתאימה לקישור ישיר לחיסכון' USING ERRCODE='22023',DETAIL='SAVINGS_LINK_CONFLICT';
    END IF;
    IF c->>'expected_transaction_fingerprint' IS DISTINCT FROM cash_fp OR (c->>'transaction_id')::integer IS DISTINCT FROM t.id THEN RAISE EXCEPTION 'התנועה השתנתה; יש לרענן ולאשר מחדש' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
    IF t.voided_at IS NOT NULL AND NOT (reinstate AND action='create_cash') THEN RAISE EXCEPTION 'אין להשתמש שוב בתנועה שבוטלה' USING ERRCODE='22023'; END IF;
    IF reinstate AND t.voided_at IS NULL AND action<>'link_cash' THEN RAISE EXCEPTION 'להחזרה לאחר ניתוק יש לקשר במפורש את הכסף הקיים' USING ERRCODE='22023'; END IF;
    IF e.id IS NULL AND EXISTS(SELECT 1 FROM public.savings_entries WHERE savings_entries.transaction_id=t.id) THEN RAISE EXCEPTION 'לתנועה היסטוריית חיסכון; יש להשתמש בהחזרה המפורשת של האירוע המקורי' USING ERRCODE='22023',DETAIL='SAVINGS_LINK_CONFLICT'; END IF;
    IF action='link_cash' AND (amount,effective,source_id,charge,CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END) IS DISTINCT FROM (t.total_amount,t.transaction_date,t.payment_source_id,t.charge_date,t.movement_type) THEN RAISE EXCEPTION 'קישור חייב לשמר את סכום הכסף, התאריכים, הכיוון ומקור התשלום הקיימים' USING ERRCODE='22023'; END IF;
  END IF;
  IF op='post_savings_event' AND ((action='create_cash' AND transaction_id IS NOT NULL) OR (action='link_cash' AND transaction_id IS NULL)) THEN RAISE EXCEPTION 'יש לבחור יצירה חדשה או קישור של תנועה קיימת בלבד' USING ERRCODE='22023'; END IF;
  IF action='detach' AND (e.id IS NULL OR reinstate OR account_id<>e.account_id) THEN RAISE EXCEPTION 'ניתוק משנה סיווג של אותה תנועה ואינו מעביר או מחזיר אירוע לחשבון אחר' USING ERRCODE='22023'; END IF;
  IF e.id IS NOT NULL AND (NOT reinstate OR (restore_skip AND e.reversed_by_entry_id IS NULL)) THEN
    INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,entry_action,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,reverses_entry_id,reason)
      VALUES(e.account_id,p_request_key,0,op,fp,e.event_kind,'reverse',e.amount,e.effective_date,e.source_kind,e.transaction_id,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date,e.id,reason) RETURNING id INTO reversed_id;
    UPDATE public.savings_entries SET reversed_by_entry_id=reversed_id WHERE id=e.id;
    entry_index=1;
  END IF;
  IF op='cancel_savings_event' OR (kind='interest_capitalized' AND t.id IS NOT NULL) THEN
    UPDATE public.transactions SET voided_at=now(),void_request_key=public.budget_derived_request_key(p_request_key,'savings-void-'||t.id),void_fingerprint=fp,void_reason=reason WHERE id=t.id;
  ELSIF kind IN ('deposit','withdrawal','interest_payout') THEN
    IF t.id IS NULL OR t.voided_at IS NOT NULL THEN
      INSERT INTO public.transactions(description,movement_type,total_amount,transaction_date,charge_date,category_id,payment_source_id,currency,notes)
        VALUES(c->>'description',CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END,amount,effective,charge,category_id,source_id,'ILS',c->>'notes') RETURNING id INTO transaction_id;
    ELSE
      UPDATE public.transactions SET description=c->>'description',total_amount=amount,transaction_date=effective,charge_date=charge,category_id=cmd.category_id,payment_source_id=source_id,notes=c->>'notes' WHERE id=t.id;
    END IF;
  END IF;
  IF kind='interest_capitalized' THEN transaction_id=NULL; END IF;
  IF op<>'cancel_savings_event' AND action<>'detach' THEN
    INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,supersedes_entry_id,reason,occurrence_month,scheduled_due_date,plan_revision,occurrence_root_id)
      VALUES(account_id,p_request_key,entry_index,op,fp,kind,amount,effective,CASE WHEN kind='opening' THEN 'opening' WHEN occurrence IS NOT NULL THEN 'recurring' WHEN e.id IS NOT NULL THEN e.source_kind WHEN action='link_cash' THEN 'existing_transaction' ELSE 'manual' END,
        transaction_id,CASE WHEN kind IN ('opening','interest_capitalized') THEN NULL WHEN kind='deposit' THEN 'expense' ELSE 'income' END,category_id,source_id,charge,e.id,reason,occurrence,due,captured_plan,CASE WHEN e.occurrence_month IS NOT NULL THEN coalesce(e.occurrence_root_id,e.id) END) RETURNING id INTO entry_id;
  END IF;
  IF kind='opening' THEN
    SELECT * INTO old_item FROM public.budget_operation_items WHERE savings_event_id=e.id AND item_kind='reserve_retirement';
    old_overlap=coalesce(old_item.amount,0); new_overlap=(c->>'legacy_overlap_amount')::numeric;
    SELECT coalesce(sum(amount_delta),0) INTO reserve_balance FROM public.budget_savings_entries;
    IF new_overlap IS NULL OR new_overlap>amount OR new_overlap>reserve_balance+old_overlap OR c->>'expected_reserve_fingerprint' IS DISTINCT FROM
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]')::text) FROM public.budget_savings_entries b) THEN RAISE EXCEPTION 'יש לרענן ולאשר יתרת פתיחה וחפיפה לרזרבה לפני התיקון' USING ERRCODE='40001'; END IF;
    IF (old_overlap>0 OR new_overlap>0) AND nullif(btrim(c->>'overlap_reason'),'') IS NULL THEN RAISE EXCEPTION 'יש לאשר שהרזרבה המשוחררת זמינה מחוץ לחיסכון' USING ERRCODE='22023'; END IF;
    IF old_overlap>0 OR new_overlap>0 THEN
      INSERT INTO public.budget_months(month_start) VALUES(date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date) ON CONFLICT DO NOTHING;
      SELECT id INTO month_id FROM public.budget_months WHERE month_start=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
      SELECT id INTO category_id FROM public.categories WHERE savings_role='deposit' AND is_active;
      IF category_id IS NULL THEN RAISE EXCEPTION 'קטגוריית הפקדה אינה פעילה' USING ERRCODE='22023'; END IF;
      IF old_overlap>0 THEN
        INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reverses_operation_id)
          VALUES(month_id,public.budget_derived_request_key(p_request_key,'opening-reserve-reversal'),fp,'savings_reserve_retirement_reversal',date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date,old_item.operation_id) RETURNING id INTO operation_id;
        INSERT INTO public.budget_savings_entries(operation_id,category_id,entry_kind,amount_delta,reverses_entry_id) VALUES(operation_id,category_id,'account_opening_retirement_reversal',old_overlap,old_item.savings_entry_id) RETURNING id INTO reserve_id;
        INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,category_id,savings_event_id,savings_entry_id,amount,reversed_item_id)
          VALUES(operation_id,'reserve_retirement','reversal',month_id,category_id,reversed_id,reserve_id,old_overlap,old_item.id);
      END IF;
      IF new_overlap>0 THEN
        INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date)
          VALUES(month_id,public.budget_derived_request_key(p_request_key,'opening-reserve-retirement'),fp,'savings_reserve_retirement',date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date) RETURNING id INTO operation_id;
        INSERT INTO public.budget_savings_entries(operation_id,category_id,entry_kind,amount_delta) VALUES(operation_id,category_id,'account_opening_retirement',-new_overlap) RETURNING id INTO reserve_id;
        INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,category_id,savings_event_id,savings_entry_id,amount)
          VALUES(operation_id,'reserve_retirement','apply',month_id,category_id,entry_id,reserve_id,new_overlap);
      END IF;
    END IF;
  END IF;
  UPDATE public.savings_accounts sa SET revision=sa.revision+1 WHERE sa.id IN (account_id,e.account_id);
  FOR revision IN SELECT id FROM public.savings_accounts WHERE id IN (account_id,e.account_id) ORDER BY id LOOP
    BEGIN
      PERFORM public.savings_assert_account(revision);
      IF (SELECT coalesce(sum(se.amount),0) FROM public.savings_entries se WHERE se.account_id=revision AND se.entry_action='post' AND se.reversed_by_entry_id IS NULL AND se.event_kind IN ('interest_capitalized','interest_payout'))>9999999999999999.99 THEN
        RAISE EXCEPTION 'סך הריבית חורג מטווח הסכומים' USING ERRCODE='23514';
      END IF;
    EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'לא ניתן להשלים את הפעולה: תיווצר יתרה שלילית או חריגה מהטווח בהיסטוריית החיסכון' USING ERRCODE='23514',DETAIL='SAVINGS_INSUFFICIENT_BALANCE'; END;
  END LOOP;
  SELECT jsonb_agg(se.id::text ORDER BY command_index),jsonb_agg(DISTINCT se.account_id::text),jsonb_agg(DISTINCT to_char(se.effective_date,'YYYY-MM')) INTO receipt,affected,months FROM public.savings_entries se WHERE command_id=p_request_key;
  RETURN jsonb_build_object('entry_ids',receipt,'transaction_id',transaction_id::text,'affected_account_ids',affected,'affected_months',months,'affected_transaction_ids',(SELECT coalesce(jsonb_agg(DISTINCT se.transaction_id::text) FILTER(WHERE se.transaction_id IS NOT NULL),'[]') FROM public.savings_entries se WHERE command_id=p_request_key));
END $$;

CREATE OR REPLACE FUNCTION public.get_savings_surplus_preview(p_source_month TEXT,p_category_id BIGINT,p_account_id BIGINT,p_amount TEXT,p_payment_source_id BIGINT,p_cash_date DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE start_date DATE=public.budget_month_start_from_key(p_source_month); today DATE=timezone('Asia/Jerusalem',statement_timestamp())::date;
 a public.savings_accounts%ROWTYPE; c public.categories%ROWTYPE; ps public.payment_sources%ROWTYPE; cs public.budget_category_state%ROWTYPE;
 amount NUMERIC; actual NUMERIC; capacity NUMERIC; material JSONB; blockers JSONB; result JSONB; deposit_category BIGINT;
BEGIN
 IF p_amount IS NULL OR p_amount !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' OR p_amount::numeric<=0 OR p_amount::numeric>9999999999999999.99 THEN RAISE EXCEPTION 'הזינו סכום חיובי מדויק בשקלים, עד שתי ספרות עשרוניות' USING ERRCODE='22023',DETAIL='SAVINGS_EXACT_MONEY_REQUIRED'; END IF;
 amount=p_amount::numeric(18,2);
 SELECT * INTO a FROM public.savings_accounts WHERE id=p_account_id;
 SELECT * INTO c FROM public.categories WHERE id=p_category_id;
 SELECT * INTO ps FROM public.payment_sources WHERE id=p_payment_source_id;
 SELECT id INTO deposit_category FROM public.categories WHERE savings_role='deposit' AND is_active;
 IF a.id IS NULL OR a.status<>'active' OR ps.id IS NULL OR NOT ps.is_active OR deposit_category IS NULL THEN RAISE EXCEPTION 'יש לבחור חשבון חיסכון ואמצעי תשלום פעילים; בדקו גם את קטגוריית ההפקדה' USING ERRCODE='22023',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
 IF c.id IS NULL OR c.type<>'expense' OR NOT c.is_active OR c.savings_role IS NOT NULL THEN RAISE EXCEPTION 'מקור העודף חייב להיות קטגוריית הוצאה פעילה שאינה חיסכון' USING ERRCODE='22023'; END IF;
 IF start_date NOT IN (date_trunc('month',today)::date,(date_trunc('month',today)-interval '1 month')::date) THEN RAISE EXCEPTION 'העברה זמינה בחודש הנוכחי או בחודש הקודם שטרם נסגר' USING ERRCODE='22023',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED'; END IF;
 IF p_cash_date IS NULL OR NOT isfinite(p_cash_date) OR p_cash_date<a.tracking_start_date OR p_cash_date>today OR date_trunc('month',p_cash_date)::date NOT IN (start_date,(start_date+interval '1 month')::date) THEN RAISE EXCEPTION 'תאריך הכסף חייב להיות בחודש המקור או בחודש הבא, בתחום המעקב ולא בעתיד' USING ERRCODE='22023',DETAIL='SAVINGS_CUTOFF_VIOLATION'; END IF;
 IF EXISTS(SELECT 1 FROM public.budget_operations o JOIN public.budget_months m ON m.id=o.budget_month_id WHERE m.month_start IN (start_date,date_trunc('month',p_cash_date)::date) AND o.operation_type='month_close')
 OR EXISTS(SELECT 1 FROM public.budget_operation_items i JOIN public.budget_months m ON m.id=i.budget_month_id WHERE m.month_start=start_date AND i.item_kind IN ('carryover','unused_disposition')) THEN RAISE EXCEPTION 'החודש כבר נסגר או נכלל בהעברה תקציבית; אין לשכתב היסטוריה' USING ERRCODE='22023',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED'; END IF;
 SELECT state.* INTO cs FROM public.budget_category_state state JOIN public.budget_months m ON m.id=state.budget_month_id WHERE m.month_start=start_date AND state.category_id=p_category_id;
 IF cs.budget_id IS NULL OR cs.lifecycle_state<>'active' THEN RAISE EXCEPTION 'לקטגוריה אין תקציב פעיל בחודש המקור' USING ERRCODE='22023'; END IF;
 SELECT coalesce(sum(t.total_amount),0) INTO actual FROM public.budget_actual_transactions(start_date,(start_date+interval '1 month -1 day')::date) t WHERE t.category_id=p_category_id;
 capacity=greatest(cs.final_funded-greatest(actual,0),0);
 blockers=public.get_budget_month_disposition_preview(p_source_month);
 IF jsonb_array_length(blockers->'deficit_blockers')>0 OR jsonb_array_length(blockers->'unbudgeted_expense_blockers')>0 THEN RAISE EXCEPTION 'לפני העברה יש לפתור חריגות והוצאות ללא תקציב בחודש המקור' USING ERRCODE='22023'; END IF;
 IF amount>capacity THEN RAISE EXCEPTION 'הסכום גבוה מהעודף הממומן הפנוי; רעננו ובחרו סכום מתאים' USING ERRCODE='22023',DETAIL='SAVINGS_INSUFFICIENT_BALANCE'; END IF;
 result=jsonb_build_object('source_month',p_source_month,'category_id',p_category_id::text,'category_name',c.name,'source_budget_id',cs.budget_id::text,'source_month_id',cs.budget_month_id::text,
 'account_id',a.id::text,'account_name',a.name,'account_revision',a.revision::text,'amount',amount::numeric(18,2)::text,'payment_source_id',ps.id::text,'payment_source_name',ps.name,'cash_date',p_cash_date,
 'deposit_category_id',deposit_category::text,'eligible_surplus',capacity::numeric(18,2)::text,'raw_actual',actual::numeric(18,2)::text,'funded_before',cs.final_funded::numeric(18,2)::text,
 'funded_after',(cs.final_funded-amount)::numeric(18,2)::text,'savings_before',(SELECT current_balance FROM public.savings_account_summary WHERE account_id=a.id),
 'savings_after',((SELECT current_balance::numeric FROM public.savings_account_summary WHERE account_id=a.id)+amount)::numeric(18,2)::text,'opening_cutoff_confirmation_required',p_cash_date=a.tracking_start_date);
 material=jsonb_build_object('preview',result,'account',to_jsonb(a),'category',to_jsonb(c),'payment_source',to_jsonb(ps),'budget',to_jsonb(cs),'blockers',blockers,
 'policy',(SELECT to_jsonb(p) FROM public.budget_unused_balance_policies p WHERE category_id=p_category_id),
 'cash', (SELECT md5(coalesce(jsonb_agg((CASE WHEN t.bank_movement IS NULL THEN to_jsonb(t)-'bank_movement' ELSE to_jsonb(t) END) ORDER BY t.id),'[]')::text) FROM public.transactions t WHERE t.transaction_date>=start_date AND t.transaction_date<(start_date+interval '1 month')));
 RETURN result||jsonb_build_object('fingerprint',md5(material::text));
END $$;

CREATE OR REPLACE FUNCTION public.savings_apply_surplus_locked(p_request_key UUID,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE mode TEXT=p_command->>'mode'; v JSONB=p_command->'preview'; o public.budget_operations%ROWTYPE; i public.budget_operation_items%ROWTYPE;
 e public.savings_entries%ROWTYPE; a public.savings_accounts%ROWTYPE; t public.transactions%ROWTYPE; m public.budget_months%ROWTYPE;
 root_id BIGINT; posting_id BIGINT; funding_id BIGINT; movement_id BIGINT; cash_month_id BIGINT; cash_id INTEGER; entry_id BIGINT; ledger_key UUID; result JSONB; blocked BOOLEAN; fp TEXT;
BEGIN
 IF mode IN ('reverse_preview','reverse') THEN
  SELECT * INTO o FROM public.budget_operations WHERE id=(p_command->>'operation_id')::bigint;
  SELECT * INTO i FROM public.budget_operation_items WHERE source_operation_id=o.id AND item_kind='savings_transfer' AND action_kind='apply';
  SELECT * INTO e FROM public.savings_entries WHERE id=i.savings_event_id;
  SELECT * INTO a FROM public.savings_accounts WHERE id=e.account_id;
  SELECT * INTO t FROM public.transactions WHERE id=e.transaction_id;
  SELECT * INTO m FROM public.budget_months WHERE id=o.budget_month_id;
  IF i.id IS NULL THEN RAISE EXCEPTION 'העברת העודף לא נמצאה' USING ERRCODE='P0002'; END IF;
  blocked=o.parent_operation_id IS NOT NULL OR e.reversed_by_entry_id IS NOT NULL OR t.voided_at IS NOT NULL
   OR m.month_start NOT IN (date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date,(date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))-interval '1 month')::date)
   OR EXISTS(SELECT 1 FROM public.budget_operations bo JOIN public.budget_months bm ON bm.id=bo.budget_month_id WHERE bm.month_start IN (m.month_start,date_trunc('month',t.transaction_date)::date) AND bo.operation_type='month_close')
   OR EXISTS(SELECT 1 FROM public.budget_operation_items bi JOIN public.budget_months bm ON bm.id=bi.budget_month_id WHERE bm.month_start IN (m.month_start,date_trunc('month',t.transaction_date)::date) AND bi.item_kind IN ('carryover','unused_disposition'))
   OR NOT EXISTS(SELECT 1 FROM public.budget_category_state WHERE budget_id=i.source_budget_id AND lifecycle_state='active');
  result=jsonb_build_object('operation_id',o.id::text,'source_month',to_char(m.month_start,'YYYY-MM'),'category_id',i.category_id::text,'category_name',(SELECT name FROM public.categories WHERE id=i.category_id),'account_id',a.id::text,'account_name',a.name,'amount',e.amount::text,'cash_date',e.effective_date,'transaction_id',t.id::text,'reversible',NOT blocked,'reason',CASE WHEN blocked THEN 'אין לבטל העברה שכבר בוטלה או נכללה בסגירה/היסטוריה תקציבית' END);
  fp=md5(jsonb_build_object('operation',to_jsonb(o),'item',to_jsonb(i),'entry',to_jsonb(e),'account',to_jsonb(a),'cash',(CASE WHEN t.bank_movement IS NULL THEN to_jsonb(t)-'bank_movement' ELSE to_jsonb(t) END),'source',(SELECT to_jsonb(cs) FROM public.budget_category_state cs WHERE budget_id=i.source_budget_id),'result',result)::text);
  IF mode='reverse_preview' THEN RETURN result||jsonb_build_object('fingerprint',fp); END IF;
  IF blocked THEN RAISE EXCEPTION 'לא ניתן לבטל העברה היסטורית; החזרת כסף אמיתית נרשמת כמשיכה חדשה' USING ERRCODE='22023',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED'; END IF;
  IF p_command->>'fingerprint' IS DISTINCT FROM fp THEN RAISE EXCEPTION 'נתוני ההעברה השתנו; רעננו את ההיסטוריה לפני הביטול' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
  root_id=public.budget_create_action_root(o.budget_month_id,p_request_key,p_command->>'request_fingerprint','savings_account_transfer_reversal',m.month_start,p_command->>'reason',o.id);
  ledger_key=public.budget_derived_request_key(p_request_key,'savings-surplus-event');
  INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,entry_action,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,reverses_entry_id,reason)
   VALUES(e.account_id,ledger_key,0,'reverse_savings_surplus',p_command->>'request_fingerprint','deposit','reverse',e.amount,e.effective_date,'budget_surplus',e.transaction_id,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date,e.id,p_command->>'reason') RETURNING id INTO entry_id;
  UPDATE public.savings_entries SET reversed_by_entry_id=entry_id WHERE id=e.id;
  INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id) VALUES(root_id,e.amount,'savings_transfer','ביטול העברת עודף לחיסכון',i.source_funding_entry_id) RETURNING id INTO funding_id;
  INSERT INTO public.budget_movements(operation_id,destination_budget_id,amount) VALUES(root_id,i.source_budget_id,e.amount) RETURNING id INTO movement_id;
  INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,category_id,source_budget_id,source_operation_id,source_funding_entry_id,source_movement_id,savings_event_id,amount,raw_actual_snapshot,funded_before,reversed_item_id)
   VALUES(root_id,'savings_transfer','reversal',o.budget_month_id,i.destination_budget_month_id,i.category_id,i.source_budget_id,root_id,funding_id,movement_id,entry_id,e.amount,i.raw_actual_snapshot,i.funded_before,i.id);
  UPDATE public.transactions SET voided_at=now(),void_request_key=public.budget_derived_request_key(p_request_key,'savings-void-'||t.id),void_fingerprint=p_command->>'request_fingerprint',void_reason=p_command->>'reason' WHERE id=t.id;
  UPDATE public.savings_accounts SET revision=revision+1 WHERE id=a.id;
  PERFORM public.savings_assert_account(a.id);PERFORM public.budget_assert_reconciled(o.budget_month_id);
  RETURN result||jsonb_build_object('reversal_operation_id',root_id::text,'affected_account_ids',jsonb_build_array(a.id::text),'affected_transaction_ids',jsonb_build_array(t.id::text),'affected_months',jsonb_build_array(to_char(m.month_start,'YYYY-MM'),to_char(e.effective_date,'YYYY-MM')));
 END IF;
 IF mode IS DISTINCT FROM 'post_locked' THEN RAISE EXCEPTION 'פעולת עודף פנימית אינה תקינה' USING ERRCODE='22023'; END IF;
 root_id=(p_command->>'root_id')::bigint;
 IF root_id IS NULL THEN
  root_id=public.budget_create_action_root((v->>'source_month_id')::bigint,p_request_key,p_command->>'request_fingerprint','savings_account_transfer',public.budget_month_start_from_key(v->>'source_month'),'העברת עודף ממומן לחיסכון',NULL);posting_id=root_id;
 ELSE
  INSERT INTO public.budget_operations(budget_month_id,parent_operation_id,request_key,request_fingerprint,operation_type,effective_date,reason)
   VALUES((v->>'source_month_id')::bigint,root_id,p_request_key,p_command->>'request_fingerprint','savings_account_transfer',public.budget_month_start_from_key(v->>'source_month'),'סגירת חודש: הפקדה לחיסכון') RETURNING id INTO posting_id;
 END IF;
 INSERT INTO public.budget_months(month_start) VALUES(date_trunc('month',(v->>'cash_date')::date)::date) ON CONFLICT DO NOTHING;
 SELECT id INTO cash_month_id FROM public.budget_months WHERE month_start=date_trunc('month',(v->>'cash_date')::date)::date;
 INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label) VALUES(posting_id,-(v->>'amount')::numeric,'savings_transfer','עודף ממומן לחשבון '||(v->>'account_name')) RETURNING id INTO funding_id;
 INSERT INTO public.budget_movements(operation_id,source_budget_id,amount) VALUES(posting_id,(v->>'source_budget_id')::bigint,(v->>'amount')::numeric) RETURNING id INTO movement_id;
 INSERT INTO public.transactions(description,movement_type,total_amount,transaction_date,charge_date,category_id,payment_source_id,currency)
  VALUES('העברת עודף: '||(v->>'category_name')||' → '||(v->>'account_name'),'expense',(v->>'amount')::numeric,(v->>'cash_date')::date,(v->>'cash_date')::date,(v->>'deposit_category_id')::bigint,(v->>'payment_source_id')::bigint,'ILS') RETURNING id INTO cash_id;
 ledger_key=public.budget_derived_request_key(p_request_key,'savings-surplus-event');
 INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date)
  VALUES((v->>'account_id')::bigint,ledger_key,0,'apply_savings_surplus',p_command->>'request_fingerprint','deposit',(v->>'amount')::numeric,(v->>'cash_date')::date,'budget_surplus',cash_id,'expense',(v->>'deposit_category_id')::bigint,(v->>'payment_source_id')::bigint,(v->>'cash_date')::date) RETURNING id INTO entry_id;
 INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,category_id,source_budget_id,source_operation_id,source_funding_entry_id,source_movement_id,savings_event_id,amount,raw_actual_snapshot,funded_before)
 VALUES(root_id,'savings_transfer','apply',(v->>'source_month_id')::bigint,cash_month_id,(v->>'category_id')::bigint,(v->>'source_budget_id')::bigint,posting_id,funding_id,movement_id,entry_id,(v->>'amount')::numeric,(v->>'raw_actual')::numeric,(v->>'funded_before')::numeric);
 UPDATE public.savings_accounts SET revision=revision+1 WHERE id=(v->>'account_id')::bigint;
 PERFORM public.savings_assert_account((v->>'account_id')::bigint);PERFORM public.budget_assert_reconciled((v->>'source_month_id')::bigint);
 RETURN jsonb_build_object('operation_id',posting_id::text,'entry_id',entry_id::text,'transaction_id',cash_id::text,'affected_account_ids',jsonb_build_array(v->>'account_id'),'affected_transaction_ids',jsonb_build_array(cash_id::text),'affected_months',jsonb_build_array(v->>'source_month',to_char((v->>'cash_date')::date,'YYYY-MM')));
END $$;
COMMIT;
