-- Allow ordinary external bank-account expenses. Requires migration 055.
-- Only the external bank-event guard changes; CSV, income/refund, identity,
-- installment and shared reconciliation protections remain unchanged.
-- Existing observations and financial history are not rewritten or reprocessed.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.ingest_external_transaction(p_request JSONB,p_dry_run BOOLEAN DEFAULT false) RETURNS JSONB
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

COMMIT;
