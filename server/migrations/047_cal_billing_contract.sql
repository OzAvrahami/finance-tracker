-- CAL v2 billing evidence. Existing immutable receipts/observations are never rewritten.
BEGIN;
LOCK TABLE public.transactions IN EXCLUSIVE MODE;
ALTER TABLE public.cal_ingestion_receipts ADD COLUMN IF NOT EXISTS legacy_request_hash TEXT CHECK (length(legacy_request_hash)=64);
ALTER TABLE public.cal_ingestion_receipts ADD COLUMN IF NOT EXISTS contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version IN (1,2));
ALTER TABLE public.cal_ingestion_receipts ADD COLUMN IF NOT EXISTS billing_evidence JSONB CHECK (jsonb_typeof(billing_evidence)='object' AND octet_length(billing_evidence::text)<=4096);
CREATE OR REPLACE FUNCTION public.ingest_cal_v1(p_request_key UUID,p_source JSONB,p_observation JSONB,p_request JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt public.cal_ingestion_receipts%ROWTYPE; source public.transaction_ingestion_sources%ROWTYPE;
 c JSONB=p_request->'cal_contract'; original JSONB;
 result JSONB; setup JSONB; h TEXT; tid INTEGER; key TEXT=p_request->>'external_id';
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 PERFORM public.apy_keys(p_request,ARRAY['type','amount','date','description','charge_date','category_id','payment_source_id',
  'payment_source_name','currency','original_amount','exchange_rate','notes','tags','external_id','cal_contract']);
 IF c IS NOT NULL THEN
  PERFORM public.apy_keys(c,ARRAY['version','billed','original','event']);
  PERFORM public.apy_keys(c->'billed',ARRAY['amount','currency','scale']);
  PERFORM public.apy_keys(c->'event',ARRAY['kind','basis','provider_type','installment']);
  IF c->'version' IS DISTINCT FROM '2'::jsonb OR c#>>'{billed,currency}' IS DISTINCT FROM 'ILS'
   OR jsonb_typeof(c#>'{billed,amount}') IS DISTINCT FROM 'string'
   OR (c#>>'{billed,amount}') !~ '^\d{1,28}(\.\d{1,2})?$'
   OR (c#>>'{billed,amount}')::numeric<=0
   OR c#>'{billed,scale}' IS DISTINCT FROM to_jsonb(length(split_part(c#>>'{billed,amount}','.',2)))
   OR c#>>'{event,kind}' IS DISTINCT FROM 'purchase'
   OR c#>>'{event,basis}' IS DISTINCT FROM 'full_purchase'
   OR c->'event' ? 'installment'
   OR jsonb_typeof(c#>'{event,provider_type}') IS DISTINCT FROM 'string'
   OR length(c#>>'{event,provider_type}')>100
   OR p_request->>'type' IS DISTINCT FROM 'expense' OR p_request ? 'exchange_rate'
   OR p_observation->>'currency' IS DISTINCT FROM 'ILS'
   OR p_observation->>'movement_type' IS DISTINCT FROM 'expense'
   OR p_observation#>>'{source_metadata,channel}' IS DISTINCT FROM 'financial_data_bridge_v2'
   OR p_observation#>>'{source_metadata,provider_status}' IS DISTINCT FROM c#>>'{event,provider_type}'
   OR (p_observation->>'accounting_amount')::numeric IS DISTINCT FROM (c#>>'{billed,amount}')::numeric
   THEN RETURN public.apy_rejected('invalid_cal_contract'); END IF;
  original=c->'original';
  IF original IS DISTINCT FROM 'null'::jsonb THEN
   PERFORM public.apy_keys(original,ARRAY['amount','currency','scale']);
   IF original IS NULL OR p_observation->>'original_amount' IS DISTINCT FROM original->>'amount'
    OR p_observation->>'original_currency' IS DISTINCT FROM original->>'currency'
    OR p_observation->'original_scale' IS DISTINCT FROM original->'scale'
    THEN RETURN public.apy_rejected('invalid_cal_contract'); END IF;
  ELSIF p_observation ?| ARRAY['original_amount','original_currency','original_scale'] THEN
   RETURN public.apy_rejected('invalid_cal_contract');
  END IF;
  -- APY independently validates exact original evidence and all ordinary observation fields.
  PERFORM public.apy_normalize(p_observation);
 END IF;

 IF p_source->>'source_kind' IS DISTINCT FROM 'cal' OR p_source->>'instance_key' NOT LIKE 'v1-cal:%'
 OR length(key) NOT BETWEEN 1 AND 255 OR key IS NULL OR key<>btrim(key)
 OR p_observation->>'idempotency_key' IS DISTINCT FROM key
 OR p_observation->>'movement_type' IS DISTINCT FROM 'expense'
 OR (c IS NULL AND coalesce(p_request->>'currency','ILS')<>'ILS') OR p_request->>'type'<>'expense'
 OR octet_length(p_request::text)>16384 THEN RETURN public.apy_rejected('invalid_cal_input'); END IF;
 IF p_observation->>'merchant' IS DISTINCT FROM p_request->>'description'
 OR p_observation->>'transaction_date' IS DISTINCT FROM p_request->>'date'
 OR p_observation->>'charge_date' IS DISTINCT FROM p_request->>'charge_date'
 OR (p_observation->>'accounting_amount')::numeric IS DISTINCT FROM coalesce(c#>>'{billed,amount}',p_request->>'amount')::numeric
 OR (p_request->>'payment_source_id' IS NOT NULL AND p_request->>'payment_source_id'<>p_observation->>'payment_source_id')
 THEN RETURN public.apy_rejected('invalid_cal_input'); END IF;
 h=public.apy_hash(p_request);
 SELECT * INTO receipt FROM public.cal_ingestion_receipts WHERE external_id=key;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.transaction_ingestion_sources s WHERE s.id=receipt.source_id AND s.is_active) THEN RETURN public.apy_rejected('source_unavailable'); END IF;
  IF NOT coalesce((receipt.request_hash=h OR (c IS NULL AND receipt.legacy_request_hash=h)
   OR (c IS NOT NULL AND receipt.contract_version=1 AND receipt.request_hash=public.apy_hash(p_request-'cal_contract')
    AND EXISTS(SELECT 1 FROM public.transaction_source_observations o WHERE o.id=receipt.observation_id
     AND o.amount_minor=(c#>>'{billed,amount}')::numeric*100))),false) OR NOT EXISTS(SELECT 1 FROM public.transaction_ingestion_sources s WHERE s.id=receipt.source_id
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
 INSERT INTO public.cal_ingestion_receipts(external_id,source_id,observation_id,request_hash,creation_fields,legacy_request_hash,contract_version,billing_evidence)
 VALUES(key,source.id,(result->>'observation_id')::bigint,h,jsonb_build_object('notes',p_request->>'notes','tags',coalesce(p_request->'tags','[]')),
  CASE WHEN c IS NOT NULL AND (p_request->>'amount')::numeric=(c#>>'{billed,amount}')::numeric THEN public.apy_hash(p_request-'cal_contract') END,CASE WHEN c IS NULL THEN 1 ELSE 2 END,c);
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
COMMIT;
