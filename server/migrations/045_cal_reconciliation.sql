-- APY-04: opt-in CAL v1 compatibility adapter and conservative cross-source review.
-- No historical source inference, financial backfill, or production activation.
BEGIN;
LOCK TABLE public.transactions IN EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS public.cal_ingestion_receipts (
 external_id TEXT COLLATE "C" PRIMARY KEY CHECK(length(external_id) BETWEEN 1 AND 255 AND external_id=btrim(external_id)),
 source_id BIGINT NOT NULL REFERENCES public.transaction_ingestion_sources(id) ON DELETE RESTRICT,
 observation_id BIGINT NOT NULL UNIQUE REFERENCES public.transaction_source_observations(id) ON DELETE RESTRICT,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 creation_fields JSONB NOT NULL CHECK(jsonb_typeof(creation_fields)='object' AND octet_length(creation_fields::text)<=8192),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_transactions_apy_weak_candidates ON public.transactions
 (payment_source_id,movement_type,total_amount,transaction_date);
ALTER TABLE public.cal_ingestion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cal_ingestion_receipts FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS cal_receipts_immutable ON public.cal_ingestion_receipts;
CREATE TRIGGER cal_receipts_immutable BEFORE UPDATE OR DELETE ON public.cal_ingestion_receipts
 FOR EACH ROW EXECUTE FUNCTION public.apy_append_only();

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

CREATE OR REPLACE FUNCTION public.apy_review_fingerprints(p_id BIGINT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(jsonb_object_agg(t.id::text,md5(to_jsonb(t)::text)),'{}') FROM public.transactions t WHERE t.id IN (
 SELECT unnest(o.candidate_ids) FROM public.transaction_source_observations o WHERE o.id=p_id
 UNION SELECT other.transaction_id FROM public.transaction_source_observations o JOIN public.transaction_source_observations other
 ON other.payment_source_id=o.payment_source_id AND other.amount_minor=o.amount_minor AND other.movement_type=o.movement_type
 AND abs(other.source_transaction_date-o.source_transaction_date)<=1
 WHERE o.id=p_id AND other.transaction_id IS NOT NULL
 UNION SELECT tx.id FROM public.transactions tx JOIN public.transaction_source_observations o
 ON tx.payment_source_id=o.payment_source_id AND tx.total_amount*100=o.amount_minor AND tx.movement_type=o.movement_type
 AND abs(tx.transaction_date-o.source_transaction_date)<=1 WHERE o.id=p_id);
$$;
CREATE OR REPLACE FUNCTION public.apy_create_cash(p_observation_id BIGINT) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE o public.transaction_source_observations%ROWTYPE; t public.transactions%ROWTYPE; charge DATE;
BEGIN
 SELECT * INTO STRICT o FROM public.transaction_source_observations WHERE id=p_observation_id;
 IF o.transaction_id IS NOT NULL OR o.evidence_origin<>'source' THEN RAISE EXCEPTION 'observation_already_linked' USING ERRCODE='22023'; END IF;
 IF o.accepted_payload->>'category_id' IS NOT NULL THEN
  PERFORM 1 FROM public.categories WHERE id=(o.accepted_payload->>'category_id')::bigint AND is_active AND savings_role IS NULL AND type=o.movement_type FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
 END IF;
 PERFORM 1 FROM public.payment_sources WHERE id=o.payment_source_id AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payment_source_not_found' USING ERRCODE='22023'; END IF;
 charge=public.apy_charge_evidence(o.id);
 INSERT INTO public.transactions(description,total_amount,currency,movement_type,transaction_date,charge_date,payment_source_id,category_id)
 VALUES(o.merchant,o.amount_minor/100,'ILS',o.movement_type,o.source_transaction_date,coalesce(charge,o.source_transaction_date),o.payment_source_id,(o.accepted_payload->>'category_id')::bigint) RETURNING * INTO t;
 UPDATE public.transaction_source_observations SET transaction_id=t.id,initial_identity=public.apy_identity(t),charge_date_origin=CASE WHEN charge IS NULL THEN 'provisional_purchase_date' ELSE 'source_supplied' END WHERE id=o.id;
 -- Creation-only compatibility fields for a later explicit owner 'separate' review.
 UPDATE public.transactions tx SET notes=r.creation_fields->>'notes',
  tags=(SELECT string_agg(value,',' ORDER BY ordinal) FROM jsonb_array_elements_text(r.creation_fields->'tags') WITH ORDINALITY a(value,ordinal))
 FROM public.cal_ingestion_receipts r WHERE r.observation_id=o.id AND tx.id=t.id;
 RETURN t.id;
END $$;

-- Reserve v1 identities even while pending or when multiple source IDs attach to one cash row.
CREATE OR REPLACE FUNCTION public.cal_external_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.external_id IS NOT NULL AND NEW.external_id<>'' THEN
  IF EXISTS(SELECT 1 FROM public.cal_ingestion_receipts r JOIN public.transaction_source_observations o ON o.id=r.observation_id
    WHERE r.external_id=NEW.external_id AND o.transaction_id IS DISTINCT FROM NEW.id) THEN
   RAISE EXCEPTION 'CAL external identity reserved' USING ERRCODE='23505';
  END IF;
  -- Fail closed after opt-in even if environment configuration is accidentally removed.
  -- Ordinary manual cash (no external ID) and unrelated payment sources are unchanged.
  IF NEW.movement_type='expense' AND EXISTS(SELECT 1 FROM public.transaction_ingestion_sources s
    WHERE s.source_kind='cal' AND s.instance_key LIKE 'v1-cal:%'
    AND s.configuration->'payment_source_ids' ? NEW.payment_source_id::text)
    AND NOT EXISTS(SELECT 1 FROM public.cal_ingestion_receipts r JOIN public.transaction_source_observations o ON o.id=r.observation_id
      WHERE r.external_id=NEW.external_id AND o.transaction_id=NEW.id) THEN
   RAISE EXCEPTION 'cal_adapter_required' USING ERRCODE='PCAL1';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cal_external_identity ON public.transactions;
CREATE TRIGGER cal_external_identity BEFORE INSERT OR UPDATE OF external_id ON public.transactions
 FOR EACH ROW EXECUTE FUNCTION public.cal_external_guard();

CREATE OR REPLACE FUNCTION public.ingest_cal_v1(p_request_key UUID,p_source JSONB,p_observation JSONB,p_request JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt public.cal_ingestion_receipts%ROWTYPE; source public.transaction_ingestion_sources%ROWTYPE;
 result JSONB; setup JSONB; h TEXT; tid INTEGER; key TEXT=p_request->>'external_id';
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 PERFORM public.apy_keys(p_request,ARRAY['type','amount','date','description','charge_date','category_id','payment_source_id',
  'payment_source_name','currency','original_amount','exchange_rate','notes','tags','external_id']);
 IF p_source->>'source_kind' IS DISTINCT FROM 'cal' OR p_source->>'instance_key' NOT LIKE 'v1-cal:%'
 OR length(key) NOT BETWEEN 1 AND 255 OR key IS NULL OR key<>btrim(key)
 OR p_observation->>'idempotency_key' IS DISTINCT FROM key
 OR p_observation->>'movement_type' IS DISTINCT FROM 'expense'
 OR coalesce(p_request->>'currency','ILS')<>'ILS' OR p_request->>'type'<>'expense'
 OR octet_length(p_request::text)>16384 THEN RETURN public.apy_rejected('invalid_cal_input'); END IF;
 IF p_observation->>'merchant' IS DISTINCT FROM p_request->>'description'
 OR p_observation->>'transaction_date' IS DISTINCT FROM p_request->>'date'
 OR p_observation->>'charge_date' IS DISTINCT FROM p_request->>'charge_date'
 OR (p_observation->>'accounting_amount')::numeric IS DISTINCT FROM (p_request->>'amount')::numeric
 OR (p_request->>'payment_source_id' IS NOT NULL AND p_request->>'payment_source_id'<>p_observation->>'payment_source_id')
 THEN RETURN public.apy_rejected('invalid_cal_input'); END IF;
 h=public.apy_hash(p_request);
 SELECT * INTO receipt FROM public.cal_ingestion_receipts WHERE external_id=key;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.transaction_ingestion_sources s WHERE s.id=receipt.source_id AND s.is_active) THEN RETURN public.apy_rejected('source_unavailable'); END IF;
  IF receipt.request_hash<>h OR NOT EXISTS(SELECT 1 FROM public.transaction_ingestion_sources s WHERE s.id=receipt.source_id
   AND s.instance_key=p_source->>'instance_key' AND s.source_kind='cal') THEN
   RETURN public.apy_rejected('cal_payload_changed');
  END IF;
  RETURN public.apy_result(receipt.observation_id,true);
 END IF;
 SELECT id INTO tid FROM public.transactions WHERE external_id=key;
 IF FOUND THEN
  -- Existing unverified legacy history is never silently converted into a CAL source assertion.
  RETURN jsonb_build_object('legacy_existing',true,'transaction_id',tid::text,
   'cancelled',(SELECT voided_at IS NOT NULL FROM public.transactions WHERE id=tid));
 END IF;
 setup=public.configure_ingestion_source(p_request_key,p_source);
 SELECT * INTO source FROM public.transaction_ingestion_sources WHERE id=(setup->>'source_id')::bigint FOR UPDATE;
 IF source.id IS NULL OR NOT source.is_active OR source.configuration IS DISTINCT FROM p_source->'configuration'
 OR source.instance_key IS DISTINCT FROM p_source->>'instance_key' THEN RETURN public.apy_rejected('source_unavailable'); END IF;
 result=public.ingest_observation(source.id,p_observation);
 IF result->>'observation_id' IS NULL THEN RETURN result; END IF;
 INSERT INTO public.cal_ingestion_receipts(external_id,source_id,observation_id,request_hash,creation_fields)
 VALUES(key,source.id,(result->>'observation_id')::bigint,h,jsonb_build_object('notes',p_request->>'notes','tags',coalesce(p_request->'tags','[]')));
 -- Initial category is part of APY creation. Notes/tags are creation-only v1 compatibility fields.
 IF result->>'outcome'='created' THEN
  UPDATE public.transactions SET notes=p_request->>'notes',
   tags=(SELECT string_agg(value,',' ORDER BY ordinal) FROM jsonb_array_elements_text(coalesce(p_request->'tags','[]')) WITH ORDINALITY a(value,ordinal))
  WHERE id=(result->>'transaction_id')::integer;
 END IF;
 RETURN result||jsonb_build_object('created_at',(SELECT created_at FROM public.transactions WHERE id=(result->>'transaction_id')::integer));
END $$;
REVOKE ALL ON FUNCTION public.ingest_cal_v1(UUID,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_cal_v1(UUID,JSONB,JSONB,JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.cal_external_guard()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
