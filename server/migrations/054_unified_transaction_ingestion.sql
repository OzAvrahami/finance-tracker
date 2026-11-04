-- Unified v1 ingestion. Forward only; no historical cash/receipt rewrite.
-- Apply only after separately authorized deployment planning. Requires 053.
BEGIN;
LOCK TABLE public.transactions IN EXCLUSIVE MODE;

ALTER TABLE public.transaction_ingestion_sources DROP CONSTRAINT transaction_ingestion_sources_source_kind_check;
ALTER TABLE public.transaction_ingestion_sources ADD CONSTRAINT transaction_ingestion_sources_source_kind_check
 CHECK (source_kind IN ('apple_pay','cal','legacy_api','file_import','external_api','manual'));
INSERT INTO public.transaction_ingestion_sources(source_kind,instance_key,configuration)
 VALUES ('external_api','unified:v1','{}'),('manual','unified:manual','{}'),('file_import','unified:csv','{}');

-- Unresolved observations can be retained without inventing a payment source.
-- Only the private posting command may promote complete evidence to cash.
ALTER TABLE public.transaction_source_observations DROP CONSTRAINT transaction_source_observations_check1;
ALTER TABLE public.transaction_source_observations ADD CONSTRAINT transaction_source_observations_check1 CHECK (
 evidence_origin<>'source' OR outcome IN ('ambiguous','conflict') OR
 (amount_minor>0 AND currency_code='ILS' AND amount_basis='accounting'
  AND movement_type IN ('expense','income') AND source_transaction_date IS NOT NULL
  AND payment_source_id IS NOT NULL AND merchant IS NOT NULL AND normalized_merchant<>''));

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
 IF o.amount_minor IS NULL OR o.amount_minor<=0 OR o.source_transaction_date IS NULL THEN
  RAISE EXCEPTION 'incomplete_accounting_evidence' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.payment_sources WHERE id=o.payment_source_id AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payment_source_not_found' USING ERRCODE='22023'; END IF;
 IF o.accepted_payload->>'category_id' IS NOT NULL THEN
  PERFORM 1 FROM public.categories WHERE id=(o.accepted_payload->>'category_id')::bigint
   AND is_active AND savings_role IS NULL AND type=o.movement_type FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
 END IF;
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
   installments_info,global_discount,global_discount_source,parent_transaction_id)
  VALUES(row_data->>'description',o.movement_type,o.amount_minor/100,o.source_transaction_date,
   coalesce(charge,o.source_transaction_date),o.payment_source_id,(row_data->>'category_id')::bigint,
   coalesce(row_data->>'currency','ILS'),(row_data->>'original_amount')::numeric,(row_data->>'exchange_rate')::numeric,
   row_data->>'notes',row_data->>'tags',row_data->>'external_id',(row_data->>'installment_number')::integer,
   (row_data->>'installment_count')::integer,row_data->>'installments_info',coalesce((row_data->>'global_discount')::numeric,0),
   row_data->>'global_discount_source',(row_data->>'parent_transaction_id')::bigint) RETURNING * INTO t;
 END IF;
 UPDATE public.transaction_source_observations SET transaction_id=t.id,initial_identity=public.apy_identity(t),
  charge_date_origin=CASE WHEN charge IS NULL THEN 'provisional_purchase_date' ELSE 'source_supplied' END WHERE id=o.id;
 RETURN t.id;
END $$;

-- Generic guard replaces routing-by-card, without opening a direct-write bypass.
CREATE FUNCTION public.unified_external_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.external_id IS NOT DISTINCT FROM OLD.external_id THEN RETURN NEW; END IF;
 IF nullif(NEW.external_id,'') IS NULL THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.cal_ingestion_receipts r JOIN public.transaction_source_observations o ON o.id=r.observation_id
    WHERE r.external_id=NEW.external_id AND o.transaction_id IS DISTINCT FROM NEW.id)
 OR EXISTS(SELECT 1 FROM public.transaction_api_receipts r WHERE r.item_key=NEW.external_id)
 OR EXISTS(SELECT 1 FROM public.transaction_source_observations o JOIN public.transaction_ingestion_sources s ON s.id=o.source_id
    WHERE s.source_kind='external_api' AND o.idempotency_key=NEW.external_id AND o.transaction_id IS NOT NULL AND o.transaction_id<>NEW.id) THEN
  RAISE EXCEPTION 'external_identity_reserved' USING ERRCODE='23505'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.transaction_source_observations o JOIN public.transaction_ingestion_sources s ON s.id=o.source_id
   WHERE s.source_kind='external_api' AND o.idempotency_key=NEW.external_id AND o.transaction_id IS NULL
    AND o.xmin::text=pg_current_xact_id()::text AND o.payment_source_id=NEW.payment_source_id
    AND o.amount_minor=NEW.total_amount*100 AND o.movement_type=NEW.movement_type
    AND o.accepted_payload#>>'{_creation,external_id}'=NEW.external_id) THEN
  RAISE EXCEPTION 'unified_ingestion_required' USING ERRCODE='PING1'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER cal_external_identity ON public.transactions;
DROP TRIGGER general_external_identity ON public.transactions;
CREATE TRIGGER unified_external_identity BEFORE INSERT OR UPDATE OF external_id ON public.transactions
 FOR EACH ROW EXECUTE FUNCTION public.unified_external_guard();
REVOKE ALL ON FUNCTION public.unified_external_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.unified_ingest(p_source_id BIGINT,p_observation JSONB,p_creation JSONB DEFAULT NULL,p_request JSONB DEFAULT NULL,p_hold TEXT DEFAULT NULL,p_domain JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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

-- Existing Wallet/APY callers keep their signature and original retry hash.
CREATE OR REPLACE FUNCTION public.ingest_observation(p_source_id BIGINT,p_observation JSONB) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.unified_ingest(p_source_id,p_observation);
$$;
REVOKE ALL ON FUNCTION public.unified_ingest(BIGINT,JSONB,JSONB,JSONB,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ingest_external_transaction(p_request JSONB,p_dry_run BOOLEAN DEFAULT false) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sid BIGINT; payment BIGINT; matches BIGINT[]; category BIGINT; key TEXT; hold TEXT; row_data JSONB;
 obs JSONB; result JSONB; selector_name TEXT=p_request->>'payment_source_name'; digits TEXT; old public.cal_ingestion_receipts%ROWTYPE;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 PERFORM public.apy_keys(p_request,ARRAY['type','amount','date','charge_date','description','category_id','payment_source_id',
  'payment_source_name','currency','original_amount','exchange_rate','notes','tags','external_id','installment_number','installment_count']);
 IF octet_length(p_request::text)>20000 OR coalesce(p_request->>'type','') NOT IN ('expense','income')
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
  SELECT c.id INTO category FROM public.categories c WHERE c.is_active AND c.savings_role IS NULL AND c.type=p_request->>'type'
   AND EXISTS(SELECT 1 FROM unnest(c.keywords) k WHERE position(lower(k) in lower(p_request->>'description'))>0) ORDER BY c.id LIMIT 1;
 END IF;
 IF category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=category AND is_active AND savings_role IS NULL AND type=p_request->>'type') THEN
  RETURN public.apy_rejected('invalid_category'); END IF;
 IF EXISTS(SELECT 1 FROM public.payment_sources WHERE id=payment AND method IN ('bank_transfer','check')) THEN hold=coalesce(hold,'bank_event_semantics_required'); END IF;
 IF p_request->>'type'='income' THEN hold=coalesce(hold,'refund_semantics_required'); END IF;
 IF p_request ? 'installment_number' THEN hold=coalesce(hold,'installment_series_required'); END IF;
 IF coalesce(p_request->>'currency','ILS')<>'ILS' AND NOT p_request ? 'original_amount' THEN hold=coalesce(hold,'original_amount_required'); END IF;
 -- Historical identities are consulted before a new namespace can claim them.
 SELECT * INTO old FROM public.cal_ingestion_receipts WHERE external_id=key;
 IF FOUND AND old.request_hash=public.apy_hash(p_request) AND NOT p_dry_run THEN RETURN public.apy_result(old.observation_id,true); END IF;
 IF old.external_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.transactions WHERE external_id=key)
  OR EXISTS(SELECT 1 FROM public.transaction_api_receipts WHERE item_key=key) THEN hold=coalesce(hold,'historical_identity_reserved'); END IF;
 row_data=jsonb_strip_nulls(jsonb_build_object('description',p_request->>'description','movement_type',p_request->>'type',
  'total_amount',p_request->'amount','transaction_date',p_request->>'date','charge_date',coalesce(p_request->>'charge_date',p_request->>'date'),
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
  'accounting_amount',p_request->>'amount','currency','ILS','movement_type',p_request->>'type','transaction_date',p_request->>'date',
  'charge_date',p_request->>'charge_date','payment_source_id',payment::text,'category_id',category::text,
  'source_metadata',jsonb_build_object('channel','external_v1')));
 RETURN public.unified_ingest(sid,obs,row_data,p_request,hold);
END $$;
REVOKE ALL ON FUNCTION public.ingest_external_transaction(JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_external_transaction(JSONB,BOOLEAN) TO service_role;

-- JWT-owned adapters supply an internal delivery key. No new public v1 fields.
CREATE FUNCTION public.ingest_owned_transaction(p_channel TEXT,p_key TEXT,p_row JSONB,p_evidence JSONB,p_domain JSONB DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE sid BIGINT; obs JSONB; hold TEXT;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 IF p_channel NOT IN ('manual','csv') OR octet_length(p_evidence::text)>65536 THEN RETURN public.apy_rejected('invalid_owned_request'); END IF;
 PERFORM public.apy_keys(p_row,ARRAY['description','movement_type','total_amount','transaction_date','charge_date','payment_source_id','category_id',
  'currency','original_amount','exchange_rate','notes','tags','installment_number','installment_count','installments_info',
  'global_discount','global_discount_source','parent_transaction_id','loan_id']);
 IF p_domain IS NOT NULL THEN PERFORM public.apy_keys(p_domain,ARRAY['loan_payment']); END IF;
 IF p_channel='csv' AND (p_domain IS NOT NULL OR p_row->>'loan_id' IS NOT NULL) THEN RETURN public.apy_rejected('unsupported_domain'); END IF;
 IF p_channel='csv' THEN
  IF coalesce(p_row->>'currency','ILS')<>'ILS' AND (nullif(p_row->>'original_amount','') IS NULL OR (p_row->>'original_amount')::numeric<=0) THEN hold='original_amount_required'; END IF;
  IF p_row->>'movement_type'='income' THEN hold='refund_semantics_required'; END IF;
  IF EXISTS(SELECT 1 FROM public.payment_sources WHERE id=(p_row->>'payment_source_id')::bigint AND method IN ('bank_transfer','check')) THEN hold='bank_event_semantics_required'; END IF;
  IF p_row->>'installments_info' IS NOT NULL OR (p_row->>'installment_count')::integer>1 THEN hold=coalesce(hold,'installment_series_required'); END IF;
 END IF;
 SELECT id INTO STRICT sid FROM public.transaction_ingestion_sources WHERE instance_key='unified:'||p_channel;
 IF p_channel='manual' THEN
  -- Resume the unchanged, owner-approved draft through its original domain writer.
  SELECT coalesce((SELECT idempotency_key FROM public.transaction_source_observations WHERE source_id=sid
   AND payload_fingerprint=public.apy_hash(p_evidence) AND transaction_id IS NULL AND reason_code='manual_domain_approved'
   ORDER BY id LIMIT 1),p_key) INTO p_key;
 END IF;
 obs=jsonb_strip_nulls(jsonb_build_object('idempotency_key',p_key,'merchant',coalesce(nullif(p_row->>'description',''),'(description not supplied)'),
  'accounting_amount',p_row->>'total_amount','currency','ILS','movement_type',p_row->>'movement_type',
  'transaction_date',p_row->>'transaction_date','charge_date',p_row->>'charge_date','payment_source_id',p_row->>'payment_source_id',
  'category_id',p_row->>'category_id','source_metadata',jsonb_build_object('channel',p_channel,
   'terminal_reference',CASE WHEN p_channel='csv' THEN split_part(p_key,':',2) ELSE '' END)));
 RETURN public.unified_ingest(sid,obs,p_row,p_evidence,hold,p_domain);
END $$;
REVOKE ALL ON FUNCTION public.ingest_owned_transaction(TEXT,TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_owned_transaction(TEXT,TEXT,JSONB,JSONB,JSONB) TO service_role;

-- Obsolete producer-specific entry points cannot remain alternate financial writers.
REVOKE EXECUTE ON FUNCTION public.ingest_cal_v1(UUID,JSONB,JSONB,JSONB),public.ingest_general_transaction(TEXT,JSONB) FROM service_role;
-- Their immutable receipts and historical resolution helpers remain available.

-- Generalize the existing owner review surface; retain revisions and authority.
CREATE OR REPLACE FUNCTION public.apy_ui_observation(p_id BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',o.id::text,'source',s.source_kind,'merchant',o.merchant,
 'amount',(o.amount_minor/100)::numeric(30,2)::text,'currency',o.currency_code,
 'transaction_date',o.source_transaction_date,'charge_date',o.source_charge_date,
 'occurred_at',o.occurred_at_raw,'time_precision',o.time_precision,'observed_at',o.observed_at,
 'payment_context',coalesce(p.method,'')||CASE WHEN p.last4 ~ '^[0-9]{4}$' THEN ' •••• '||p.last4 ELSE '' END,
 'transaction_id',o.transaction_id::text,'outcome',o.outcome,'review_required',o.review_required,
 'reason_code',o.reason_code,'revision',o.decision_revision::text)
 FROM public.transaction_source_observations o JOIN public.transaction_ingestion_sources s ON s.id=o.source_id
 LEFT JOIN public.payment_sources p ON p.id=o.payment_source_id
 WHERE o.id=p_id AND o.evidence_origin='source' AND s.source_kind IN ('apple_pay','cal','external_api','manual','file_import');
$$;
CREATE OR REPLACE FUNCTION public.apy_ui_transaction(p_id INTEGER) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',t.id::text,'description',t.description,'amount',t.total_amount::numeric(30,2)::text,
 'transaction_date',t.transaction_date,'charge_date',t.charge_date,'cancelled',t.voided_at IS NOT NULL,
 'protected',public.apy_protected(t.id) OR public.apy_captured(t.id),
 'fingerprint',public.apy_cash_fingerprint(t.id),
 'observations',coalesce((SELECT jsonb_agg(public.apy_ui_observation(o.id) ORDER BY o.id)
 FROM public.transaction_source_observations o JOIN public.transaction_ingestion_sources s ON s.id=o.source_id
 WHERE o.transaction_id=t.id AND o.evidence_origin='source' AND s.source_kind IN ('apple_pay','cal','external_api','manual','file_import')),'[]'))
 FROM public.transactions t WHERE t.id=p_id;
$$;
CREATE OR REPLACE FUNCTION public.read_reconciliation(p_mode TEXT,p_ids INTEGER[] DEFAULT '{}',p_id BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result JSONB; review_observation public.transaction_source_observations%ROWTYPE; fingerprints JSONB;
BEGIN
 IF cardinality(p_ids)>100 OR p_id<=0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 IF p_mode='summary' THEN
  SELECT jsonb_build_object('transactions',coalesce(jsonb_object_agg(id::text,jsonb_build_object(
   'status',CASE WHEN voided THEN 'cancelled' WHEN channel_count>1 THEN 'reconciled' ELSE 'observed' END,
   'review_required',review)),'{}'),'pending_count',(SELECT count(*) FROM public.transaction_source_observations ob
   JOIN public.transaction_ingestion_sources src ON src.id=ob.source_id WHERE ob.evidence_origin='source'
   AND src.source_kind IN ('apple_pay','cal','external_api','manual','file_import') AND ob.review_required)) INTO result
  FROM (SELECT t.id,t.voided_at IS NOT NULL AS voided,bool_or(s.source_kind='apple_pay') apple,bool_or(s.source_kind='cal') cal,
   count(DISTINCT s.source_kind) channel_count,bool_or(o.review_required) review FROM public.transactions t JOIN public.transaction_source_observations o ON o.transaction_id=t.id
   JOIN public.transaction_ingestion_sources s ON s.id=o.source_id WHERE t.id=ANY(p_ids)
   AND o.evidence_origin='source' AND s.source_kind IN ('apple_pay','cal','external_api','manual','file_import') GROUP BY t.id) q;
  RETURN result;
 ELSIF p_mode='pending' THEN
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(public.apy_ui_observation(id) ORDER BY id DESC),'[]'),
   'next_cursor',CASE WHEN count(*)=50 THEN min(id)::text ELSE NULL END) INTO result
  FROM (SELECT o.id FROM public.transaction_source_observations o JOIN public.transaction_ingestion_sources s ON s.id=o.source_id
   WHERE o.evidence_origin='source' AND s.source_kind IN ('apple_pay','cal','external_api','manual','file_import') AND o.review_required AND (p_id IS NULL OR o.id<p_id)
   ORDER BY o.id DESC LIMIT 50) q; RETURN result;
 ELSIF p_mode='transaction' THEN RETURN public.apy_ui_transaction(p_id::integer);
 ELSIF p_mode='observation' THEN
  SELECT * INTO review_observation FROM public.transaction_source_observations WHERE id=p_id;
  result=public.apy_ui_observation(p_id); IF result IS NULL THEN RETURN NULL; END IF;
  fingerprints=public.apy_review_fingerprints(review_observation.id);
  RETURN jsonb_build_object('observation',result,'candidate_fingerprints',fingerprints,
   'review_limited',(SELECT count(*) FROM jsonb_object_keys(fingerprints))>100,
   'can_separate',review_observation.transaction_id IS NULL AND review_observation.outcome='ambiguous' AND review_observation.reason_code NOT IN ('payment_source_not_found','payment_source_ambiguous','historical_identity_reserved','bank_event_semantics_required','refund_semantics_required','original_amount_required') AND (SELECT count(*) FROM jsonb_object_keys(fingerprints))<=100,
   'candidates',coalesce((SELECT jsonb_agg(public.apy_ui_transaction(k::integer)||jsonb_build_object('can_link',
    (SELECT count(*) FROM jsonb_object_keys(fingerprints))<=100
    AND review_observation.transaction_id IS NULL AND t.voided_at IS NULL AND NOT public.apy_protected(t.id) AND NOT public.apy_captured(t.id)
    AND t.payment_source_id=review_observation.payment_source_id AND t.total_amount*100=review_observation.amount_minor AND t.movement_type=review_observation.movement_type
    AND abs(t.transaction_date-review_observation.source_transaction_date)<=1
    AND NOT EXISTS(SELECT 1 FROM public.transaction_source_observations x WHERE x.source_id=review_observation.source_id AND x.transaction_id=t.id)) ORDER BY t.id)
    FROM (SELECT key k FROM jsonb_object_keys(fingerprints) key ORDER BY key::bigint LIMIT 100) keys
    JOIN public.transactions t ON t.id=k::integer),'[]'));
 END IF;
 RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
END $$;
CREATE OR REPLACE FUNCTION public.review_reconciliation(p_request_key UUID,p_command JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior JSONB; current_fingerprints JSONB; o public.transaction_source_observations%ROWTYPE; result JSONB;
BEGIN
 -- Preserve APY lock order, replay identity and command implementation.
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 prior=public.apy_receipt(p_request_key,public.apy_hash(jsonb_build_object('command','resolve','payload',p_command)));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 current_fingerprints=public.apy_review_fingerprints((p_command->>'observation_id')::bigint);
 IF p_command->'expected_candidate_fingerprints' IS DISTINCT FROM current_fingerprints
 OR (p_command->>'action'='link' AND NOT current_fingerprints ? (p_command->>'transaction_id'))
 THEN RETURN public.apy_rejected('stale_review'); END IF;
 SELECT ob.* INTO o FROM public.transaction_source_observations ob JOIN public.transaction_ingestion_sources src ON src.id=ob.source_id
  WHERE ob.id=(p_command->>'observation_id')::bigint AND src.source_kind='manual' FOR UPDATE OF ob;
 IF FOUND AND p_command->>'action'='separate' THEN
  IF o.transaction_id IS NOT NULL OR o.decision_revision IS DISTINCT FROM (p_command->>'expected_revision')::bigint THEN RETURN public.apy_rejected('stale_review'); END IF;
  IF o.outcome<>'ambiguous' OR o.reason_code IN ('payment_source_not_found','payment_source_ambiguous','historical_identity_reserved','original_amount_required') THEN RETURN public.apy_rejected('evidence_correction_required'); END IF;
  UPDATE public.transaction_source_observations SET reason_code='manual_domain_approved',decision_revision=decision_revision+1 WHERE id=o.id;
  result=public.apy_result(o.id);
  INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,request_key,command_fingerprint,actor,reason_code,decision_revision,evidence,result)
   VALUES(o.source_id,o.id,'review',p_request_key,public.apy_hash(jsonb_build_object('command','resolve','payload',p_command)),p_command->>'actor',
    'manual_domain_approved',o.decision_revision+1,jsonb_build_object('candidate_fingerprints',current_fingerprints),result);
  RETURN result;
 END IF;
 RETURN public.resolve_observation(p_request_key,p_command);
END $$;
REVOKE ALL ON FUNCTION public.apy_ui_observation(BIGINT),public.apy_ui_transaction(INTEGER) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_reconciliation(TEXT,INTEGER[],BIGINT),public.review_reconciliation(UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_reconciliation(TEXT,INTEGER[],BIGINT),public.review_reconciliation(UUID,JSONB) TO service_role;


-- Preserve domain reversal, retaining managed identities as cancelled history.
CREATE OR REPLACE FUNCTION public.delete_transaction_with_loan_payment(
  p_transaction_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_transaction public.transactions%ROWTYPE;
  v_existing public.loan_payments%ROWTYPE;
  v_old_loan_id BIGINT;
  v_old_scheduled_due_date DATE;
  v_old_auto_payment_enabled BOOLEAN;
  v_has_later_covered BOOLEAN := false;
  obs public.transaction_source_observations%ROWTYPE; cancel_key UUID; cancel_hash TEXT;
BEGIN
  LOCK TABLE public.transactions IN EXCLUSIVE MODE;
  SELECT * INTO v_transaction
  FROM public.transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % does not exist', p_transaction_id;
  END IF;
  IF v_transaction.voided_at IS NOT NULL THEN RETURN p_transaction_id; END IF;
  SELECT * INTO v_existing
  FROM public.loan_payments
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.payment_kind <> 'installment'
      OR v_existing.source_kind NOT IN ('manual', 'existing_transaction') THEN
      RAISE EXCEPTION
        'Transaction % is linked to protected %/% loan payment % and cannot be deleted',
        p_transaction_id, v_existing.source_kind, v_existing.payment_kind, v_existing.id;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.loan_payments later
      WHERE later.loan_id = v_existing.loan_id
        AND later.id <> v_existing.id
        AND later.payment_kind IN ('installment', 'catch_up')
        AND (
          (later.payment_kind = 'installment'
            AND later.installment_number > v_existing.installment_number)
          OR later.payment_date > v_existing.payment_date
        )
    ) INTO v_has_later_covered;
    IF v_has_later_covered THEN
      RAISE EXCEPTION 'Cannot delete installment % while later covered payments exist',
        v_existing.installment_number;
    END IF;

    IF v_existing.source_kind <> 'manual'
      AND v_existing.scheduled_due_date IS NULL THEN
      RAISE EXCEPTION
        'Cannot delete loan payment % without a reversible schedule anchor',
        v_existing.id;
    END IF;

    v_old_loan_id := v_existing.loan_id;
    v_old_scheduled_due_date := v_existing.scheduled_due_date;
    v_old_auto_payment_enabled := v_existing.auto_payment_enabled_before;
    DELETE FROM public.loan_payments WHERE id = v_existing.id;
  END IF;

  DELETE FROM public.lego_sets WHERE transaction_id = p_transaction_id;
  DELETE FROM public.transaction_items WHERE transaction_id = p_transaction_id;
  SELECT * INTO obs FROM public.transaction_source_observations WHERE transaction_id=p_transaction_id AND evidence_origin='source' ORDER BY id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF public.apy_captured(p_transaction_id::integer) OR EXISTS(SELECT 1 FROM public.savings_entries WHERE transaction_id=p_transaction_id)
      OR EXISTS(SELECT 1 FROM public.transactions WHERE parent_transaction_id=p_transaction_id)
      OR (public.apy_protected(p_transaction_id::integer) AND NOT EXISTS(SELECT 1 FROM public.transaction_ingestion_sources WHERE id=obs.source_id AND source_kind='manual')) THEN
      RAISE EXCEPTION 'protected_transaction' USING ERRCODE='23514'; END IF;
    cancel_key=gen_random_uuid();cancel_hash=public.apy_cash_fingerprint(p_transaction_id::integer);
    INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,transaction_id,actor,reason_code,request_key,command_fingerprint)
     VALUES(obs.source_id,obs.id,'cancel',p_transaction_id,'manual_domain_delete','owner_cancelled',cancel_key,cancel_hash);
    UPDATE public.transaction_source_observations SET decision_revision=decision_revision+1 WHERE transaction_id=p_transaction_id;
    UPDATE public.transactions SET voided_at=clock_timestamp(),void_request_key=cancel_key,void_fingerprint=cancel_hash,void_reason='Owner deleted transaction' WHERE id=p_transaction_id;
  ELSE
    DELETE FROM public.transactions WHERE id = p_transaction_id;
  END IF;

  IF v_old_loan_id IS NOT NULL THEN
    UPDATE public.loans
    SET next_payment_date = CASE
          WHEN current_balance <= 0.005 OR remaining_installments <= 0 THEN NULL
          ELSE v_old_scheduled_due_date
        END,
        auto_payment_enabled = CASE
          WHEN current_balance <= 0.005 THEN false
          ELSE coalesce(v_old_auto_payment_enabled, auto_payment_enabled)
        END
    WHERE id = v_old_loan_id
      AND NOT v_has_later_covered;
  END IF;
  RETURN p_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_manual_loan_payment_from_transaction(BIGINT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.apy_cancel_authorized(p_id INTEGER,p_key UUID,p_hash TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT NOT public.apy_captured(p_id) AND NOT EXISTS(SELECT 1 FROM public.savings_entries WHERE transaction_id=p_id)
 AND EXISTS(SELECT 1 FROM public.transaction_reconciliation_events e
  JOIN public.transaction_source_observations o ON o.id=e.observation_id
  JOIN public.transaction_ingestion_sources s ON s.id=o.source_id
  WHERE e.transaction_id=p_id AND e.event_kind='cancel' AND e.request_key=p_key AND e.command_fingerprint=p_hash
   AND e.xmin::text=pg_current_xact_id()::text AND o.transaction_id=p_id AND o.evidence_origin='source'
   AND (NOT public.apy_protected(p_id) OR (e.actor='manual_domain_delete' AND s.source_kind='manual')));
$$;
COMMIT;
