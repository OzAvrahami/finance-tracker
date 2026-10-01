-- APY-05: private safe read projections and owner review boundary. No financial backfill.
BEGIN;
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
 WHERE o.id=p_id AND o.evidence_origin='source' AND s.source_kind IN ('apple_pay','cal');
$$;
CREATE OR REPLACE FUNCTION public.apy_ui_transaction(p_id INTEGER) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',t.id::text,'description',t.description,'amount',t.total_amount::numeric(30,2)::text,
 'transaction_date',t.transaction_date,'charge_date',t.charge_date,'cancelled',t.voided_at IS NOT NULL,
 'protected',public.apy_protected(t.id) OR public.apy_captured(t.id),
 'fingerprint',public.apy_cash_fingerprint(t.id),
 'observations',coalesce((SELECT jsonb_agg(public.apy_ui_observation(o.id) ORDER BY o.id)
 FROM public.transaction_source_observations o JOIN public.transaction_ingestion_sources s ON s.id=o.source_id
 WHERE o.transaction_id=t.id AND o.evidence_origin='source' AND s.source_kind IN ('apple_pay','cal')),'[]'))
 FROM public.transactions t WHERE t.id=p_id;
$$;
CREATE OR REPLACE FUNCTION public.read_reconciliation(p_mode TEXT,p_ids INTEGER[] DEFAULT '{}',p_id BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result JSONB; review_observation public.transaction_source_observations%ROWTYPE; fingerprints JSONB;
BEGIN
 IF cardinality(p_ids)>100 OR p_id<=0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 IF p_mode='summary' THEN
  SELECT jsonb_build_object('transactions',coalesce(jsonb_object_agg(id::text,jsonb_build_object(
   'status',CASE WHEN voided THEN 'cancelled' WHEN apple AND cal THEN 'reconciled' WHEN apple THEN 'awaiting_cal' ELSE 'cal_only' END,
   'review_required',review)),'{}'),'pending_count',(SELECT count(*) FROM public.transaction_source_observations ob
   JOIN public.transaction_ingestion_sources src ON src.id=ob.source_id WHERE ob.evidence_origin='source'
   AND src.source_kind IN ('apple_pay','cal') AND ob.review_required)) INTO result
  FROM (SELECT t.id,t.voided_at IS NOT NULL AS voided,bool_or(s.source_kind='apple_pay') apple,bool_or(s.source_kind='cal') cal,
   bool_or(o.review_required) review FROM public.transactions t JOIN public.transaction_source_observations o ON o.transaction_id=t.id
   JOIN public.transaction_ingestion_sources s ON s.id=o.source_id WHERE t.id=ANY(p_ids)
   AND o.evidence_origin='source' AND s.source_kind IN ('apple_pay','cal') GROUP BY t.id) q;
  RETURN result;
 ELSIF p_mode='pending' THEN
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(public.apy_ui_observation(id) ORDER BY id DESC),'[]'),
   'next_cursor',CASE WHEN count(*)=50 THEN min(id)::text ELSE NULL END) INTO result
  FROM (SELECT o.id FROM public.transaction_source_observations o JOIN public.transaction_ingestion_sources s ON s.id=o.source_id
   WHERE o.evidence_origin='source' AND s.source_kind IN ('apple_pay','cal') AND o.review_required AND (p_id IS NULL OR o.id<p_id)
   ORDER BY o.id DESC LIMIT 50) q; RETURN result;
 ELSIF p_mode='transaction' THEN RETURN public.apy_ui_transaction(p_id::integer);
 ELSIF p_mode='observation' THEN
  SELECT * INTO review_observation FROM public.transaction_source_observations WHERE id=p_id;
  result=public.apy_ui_observation(p_id); IF result IS NULL THEN RETURN NULL; END IF;
  fingerprints=public.apy_review_fingerprints(review_observation.id);
  RETURN jsonb_build_object('observation',result,'candidate_fingerprints',fingerprints,
   'review_limited',(SELECT count(*) FROM jsonb_object_keys(fingerprints))>100,
   'can_separate',review_observation.transaction_id IS NULL AND review_observation.outcome='ambiguous' AND (SELECT count(*) FROM jsonb_object_keys(fingerprints))<=100,
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
DECLARE prior JSONB; current_fingerprints JSONB;
BEGIN
 -- Preserve APY lock order, replay identity and command implementation.
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 prior=public.apy_receipt(p_request_key,public.apy_hash(jsonb_build_object('command','resolve','payload',p_command)));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 current_fingerprints=public.apy_review_fingerprints((p_command->>'observation_id')::bigint);
 IF p_command->'expected_candidate_fingerprints' IS DISTINCT FROM current_fingerprints
 OR (p_command->>'action'='link' AND NOT current_fingerprints ? (p_command->>'transaction_id'))
 THEN RETURN public.apy_rejected('stale_review'); END IF;
 RETURN public.resolve_observation(p_request_key,p_command);
END $$;
REVOKE ALL ON FUNCTION public.apy_ui_observation(BIGINT),public.apy_ui_transaction(INTEGER) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_reconciliation(TEXT,INTEGER[],BIGINT),public.review_reconciliation(UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_reconciliation(TEXT,INTEGER[],BIGINT),public.review_reconciliation(UUID,JSONB) TO service_role;
COMMIT;
