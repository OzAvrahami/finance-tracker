-- #99 package 1. Forward only, requires 057. Quiesce writers before cutover.
-- No production execution is authorized by preparing this file.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.transactions IN EXCLUSIVE MODE;

-- Mechanical storage projection. Business policy never chooses values here.
CREATE FUNCTION public.ingestion_core_row(p JSONB) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE k TEXT;
BEGIN
 IF p IS NULL OR p='null'::jsonb THEN RETURN NULL; END IF;
 FOREACH k IN ARRAY ARRAY['total_amount','global_discount','original_amount','exchange_rate','payment_source_id','category_id','loan_id','parent_transaction_id','installment_number','installment_count'] LOOP
  IF p->>k IS NOT NULL THEN p=jsonb_set(p,ARRAY[k],to_jsonb((p->>k)::numeric)); END IF;
 END LOOP;
 RETURN p;
END $$;

-- Facts only. Coarse date/reference retrieval deliberately does not select a
-- match or decide eligibility. The JS matcher owns those decisions.
CREATE FUNCTION public.ingestion_core_snapshot(p_scope JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE facts JSONB; day DATE; key TEXT; sid BIGINT; oid BIGINT; tid INTEGER;
 hash TEXT; obs_ids BIGINT[]; tx_ids INTEGER[]; anchor public.transaction_source_observations%ROWTYPE;
 v_request_key UUID; auth JSONB; ref JSONB; receipt BIGINT;
BEGIN
 IF octet_length(p_scope::text)>100000 THEN RAISE EXCEPTION 'scope_too_large' USING ERRCODE='22023'; END IF;
 key=coalesce(p_scope#>>'{request,external_id}',p_scope->>'key',p_scope#>>'{observation,idempotency_key}',p_scope#>>'{command,item,key}');
 hash=public.apy_hash(p_scope->'hash_input');
 oid=(p_scope#>>'{command,observation_id}')::bigint;
 tid=(p_scope#>>'{command,transaction_id}')::integer;
 v_request_key=(p_scope->>'request_key')::uuid;
 receipt=(p_scope#>>'{command,receipt_id}')::bigint;
 IF oid IS NOT NULL THEN SELECT * INTO anchor FROM public.transaction_source_observations WHERE id=oid;
 ELSIF tid IS NOT NULL THEN SELECT * INTO anchor FROM public.transaction_source_observations WHERE transaction_id=tid AND evidence_origin='source' ORDER BY id LIMIT 1; END IF;
 sid=coalesce((p_scope->>'source_id')::bigint,anchor.source_id,
  (SELECT source_id FROM public.transaction_api_current WHERE id=receipt),
  (SELECT id FROM public.transaction_ingestion_sources WHERE instance_key='unified:'||CASE WHEN p_scope->>'channel'='external' THEN 'v1' ELSE p_scope->>'channel' END));
 day=coalesce((p_scope->>'date')::date,anchor.source_transaction_date);
 ref=coalesce(p_scope#>'{observation,provider_reference}',p_scope#>'{command,item,provider_reference}');
 IF p_scope->>'channel'='flowlink' THEN
  SELECT jsonb_build_object('credential_id',c.id,'credential_status',c.status,'device_id',d.id,'device_status',d.status,
   'binding',to_jsonb(b),'source_matches',public.flowlink_source_matches(b,s)) INTO auth
  FROM public.flowlink_device_credentials c JOIN public.flowlink_devices d ON d.id=c.device_id
  LEFT JOIN public.flowlink_card_bindings b ON b.id=(p_scope#>>'{request,binding_id}')::uuid AND b.device_id=d.id
  LEFT JOIN public.transaction_ingestion_sources s ON s.id=b.source_id
  WHERE c.credential_sha256=(p_scope->>'credential')::bytea;
  sid=(auth#>>'{binding,source_id}')::bigint;
  hash=public.apy_hash((p_scope->'hash_input')||jsonb_build_object('payment_source_id',auth#>>'{binding,payment_source_id}'));
 END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO obs_ids FROM (
  SELECT o.id FROM public.transaction_source_observations o WHERE
   o.id=oid OR o.transaction_id=tid OR o.source_transaction_date BETWEEN day-1 AND day+1
   OR o.source_transaction_date BETWEEN (p_scope#>>'{command,item,dates,purchase}')::date-1 AND (p_scope#>>'{command,item,dates,purchase}')::date+1
   OR (ref IS NOT NULL AND o.provider_reference=ref)
   OR (o.source_id=sid AND (o.idempotency_key=key OR (o.payload_fingerprint=hash AND o.reason_code='manual_domain_approved')))
   OR o.id=(SELECT observation_id FROM public.cal_ingestion_receipts WHERE external_id=key)
   ORDER BY o.id LIMIT 2001) q;
 -- A bounded candidate scan must never hide the exact durable identity.
 SELECT ARRAY(SELECT DISTINCT v FROM unnest(obs_ids||ARRAY(
  SELECT id FROM public.transaction_source_observations WHERE id=oid
   OR (source_id=sid AND (idempotency_key=key OR (payload_fingerprint=hash AND reason_code='manual_domain_approved')))
  )) v ORDER BY v) INTO obs_ids;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO tx_ids FROM (
  SELECT t.id FROM public.transactions t WHERE t.id=tid OR t.external_id=key OR t.transaction_date BETWEEN day-1 AND day+1
   OR t.transaction_date BETWEEN (p_scope#>>'{command,item,dates,purchase}')::date-1 AND (p_scope#>>'{command,item,dates,purchase}')::date+1
   OR t.id IN (SELECT transaction_id FROM public.transaction_source_observations WHERE id=ANY(obs_ids))
   OR t.id=ANY(anchor.candidate_ids) ORDER BY t.id LIMIT 2001) q;
 SELECT jsonb_build_object(
  'scope',p_scope,'hash',hash,'source_id',sid::text,'auth',auth,
  'sources',(SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('id',s.id::text,'revision',s.revision::text) ORDER BY s.id),'[]') FROM public.transaction_ingestion_sources s),
  'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('id',p.id::text) ORDER BY p.id),'[]') FROM public.payment_sources p),
  'categories',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('id',c.id::text) ORDER BY c.id),'[]') FROM public.categories c),
  'overflow',cardinality(obs_ids)>2000 OR cardinality(tx_ids)>2000,
  'transactions',(SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object(
   'id',t.id::text,'total_amount',t.total_amount::text,'global_discount',t.global_discount::text,'original_amount',t.original_amount::text,
   'exchange_rate',t.exchange_rate::text,'payment_source_id',t.payment_source_id::text,
   'cash_fingerprint',public.apy_cash_fingerprint(t.id),
   'review_fingerprint',md5((CASE WHEN t.bank_movement IS NULL THEN to_jsonb(t)-'bank_movement' ELSE to_jsonb(t) END)::text),
   'savings_role',(SELECT savings_role FROM public.categories WHERE id=t.category_id),
   'links',(SELECT coalesce(jsonb_agg(kind),'[]') FROM (
    SELECT 'savings' kind FROM public.savings_entries WHERE transaction_id=t.id
    UNION ALL SELECT 'loan' FROM public.loan_payments WHERE transaction_id=t.id
    UNION ALL SELECT 'item' FROM public.transaction_items WHERE transaction_id=t.id
    UNION ALL SELECT 'lego' FROM public.lego_sets WHERE transaction_id=t.id
    UNION ALL SELECT 'shopping' FROM public.shopping_checkouts WHERE transaction_id=t.id
    UNION ALL SELECT 'child' FROM public.transactions WHERE parent_transaction_id=t.id) l),
   'budget_facts',(SELECT coalesce(jsonb_agg(v),'[]') FROM (
    SELECT o.operation_type,NULL::text item_kind FROM public.budget_months m JOIN public.budget_operations o ON o.budget_month_id=m.id WHERE m.month_start=date_trunc('month',t.transaction_date)::date
    UNION ALL SELECT NULL,i.item_kind FROM public.budget_months m JOIN public.budget_operation_items i ON i.budget_month_id=m.id WHERE m.month_start=date_trunc('month',t.transaction_date)::date) v)
   ) ORDER BY t.id),'[]') FROM public.transactions t WHERE t.id=ANY(tx_ids)),
  'observations',(SELECT coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object(
   'id',o.id::text,'source_id',o.source_id::text,'transaction_id',o.transaction_id::text,'payment_source_id',o.payment_source_id::text,
   'amount_minor',trunc(o.amount_minor)::text,'decision_revision',o.decision_revision::text,
   'instant_micros',trunc(extract(epoch FROM o.occurred_at)*1000000)::text,'width_micros',trunc(extract(epoch FROM o.time_width)*1000000)::text,
   'identity_matches',o.initial_identity IS NOT DISTINCT FROM (SELECT public.apy_identity(t) FROM public.transactions t WHERE t.id=o.transaction_id),
   'result',public.apy_result(o.id),'replay_result',public.apy_result(o.id,true),
   'review_fingerprints',public.apy_review_fingerprints(o.id),
   'ui',public.apy_ui_observation(o.id),
   'cal_fields',(SELECT creation_fields FROM public.cal_ingestion_receipts WHERE observation_id=o.id),
   'charge_evidence',public.apy_charge_evidence(o.id)) ORDER BY o.id),'[]') FROM public.transaction_source_observations o WHERE o.id=ANY(obs_ids) OR o.transaction_id=ANY(tx_ids)),
  'installments',(SELECT coalesce(jsonb_agg(v),'[]') FROM (
   SELECT payment_source_id::text,NULL::text idempotency_key FROM public.transactions WHERE installment_count>1
   UNION ALL SELECT payment_source_id::text,idempotency_key FROM public.transaction_source_observations WHERE (accepted_payload#>>'{_creation,installment_count}')::integer>1 OR source_metadata->>'channel'='general_v1_installment') v),
  'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.transaction_reconciliation_events e WHERE e.observation_id=ANY(obs_ids) OR e.request_key=v_request_key),
  'historical_reserved',EXISTS(SELECT 1 FROM public.cal_ingestion_receipts WHERE external_id=key) OR EXISTS(SELECT 1 FROM public.transactions WHERE external_id=key) OR EXISTS(SELECT 1 FROM public.transaction_api_receipts WHERE item_key=key),
  'historical_replay',(SELECT public.apy_result(observation_id,true) FROM public.cal_ingestion_receipts WHERE external_id=key AND request_hash=hash),
  'manual_resume_key',(SELECT idempotency_key FROM public.transaction_source_observations WHERE source_id=sid AND payload_fingerprint=hash AND transaction_id IS NULL AND reason_code='manual_domain_approved' ORDER BY id LIMIT 1),
  'command_receipt',CASE WHEN v_request_key IS NOT NULL THEN public.apy_receipt(v_request_key,public.apy_hash(jsonb_build_object('command',p_scope->>'command_kind','payload',p_scope->'command'))) END,
  'general_review',CASE WHEN receipt IS NOT NULL THEN public.get_general_receipt(receipt) END,
  'general_command_hash',public.apy_hash(p_scope->'command'),
  'general_item_hash',public.apy_hash(p_scope#>'{command,item}'),
  'general_reserved',EXISTS(SELECT 1 FROM public.transactions WHERE external_id=coalesce(p_scope#>>'{command,item,legacy_external_id}',p_scope#>>'{command,item,key}'))
   OR EXISTS(SELECT 1 FROM public.cal_ingestion_receipts WHERE external_id=coalesce(p_scope#>>'{command,item,legacy_external_id}',p_scope#>>'{command,item,key}'))
   OR EXISTS(SELECT 1 FROM public.transaction_source_observations WHERE source_id=sid AND idempotency_key=p_scope#>>'{command,item,key}'),
  'general_current',(SELECT to_jsonb(r) FROM public.transaction_api_current r WHERE id=receipt),
  'registrations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY account_key),'[]') FROM public.transaction_api_registrations r),
  'general_group',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.transaction_api_current r WHERE evidence#>>'{event,purchase_key}'=p_scope#>>'{command,item,event,purchase_key}'),
  'general_command_receipt',(SELECT to_jsonb(r)||jsonb_build_object('current_result',public.transaction_api_result(r.receipt_id,true)) FROM public.transaction_api_resolutions r WHERE r.request_key=v_request_key)
 ) INTO facts;
 RETURN jsonb_build_object('token',public.apy_hash(facts),'facts',facts);
END $$;

REVOKE ALL ON FUNCTION public.ingestion_core_row(JSONB),public.ingestion_core_snapshot(JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ingestion_core_snapshot(JSONB) TO service_role;

-- Private, typed ledger insertion. No matching, classification, category lookup
-- or eligibility policy lives here. Only evidence/ledger consistency and atomic
-- domain delegation are enforced.
CREATE FUNCTION public.ingestion_core_post(p_id BIGINT,p_row JSONB,p_domain JSONB) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE o public.transaction_source_observations%ROWTYPE; t public.transactions%ROWTYPE; r JSONB; kind TEXT; expected JSONB;
BEGIN
 p_domain=nullif(p_domain,'null'::jsonb);
 SELECT * INTO STRICT o FROM public.transaction_source_observations WHERE id=p_id FOR UPDATE;
 SELECT source_kind INTO STRICT kind FROM public.transaction_ingestion_sources WHERE id=o.source_id;
 IF o.transaction_id IS NOT NULL OR o.evidence_origin<>'source' OR o.payment_source_id IS NULL
  OR o.amount_minor IS NULL OR o.amount_minor=0 OR o.source_transaction_date IS NULL THEN
  RAISE EXCEPTION 'inconsistent_post' USING ERRCODE='23514'; END IF;
 -- Posting may copy immutable accepted fields, not replace them with an
 -- arbitrary financial row. Classification/mapping remain application policy.
 expected=o.accepted_payload->'_creation';
 IF expected IS NULL THEN
  SELECT jsonb_strip_nulls(jsonb_build_object('description',o.merchant,'movement_type',o.movement_type,
   'total_amount',o.amount_minor/100,'currency','ILS','transaction_date',o.source_transaction_date,
   'payment_source_id',o.payment_source_id,'category_id',(o.accepted_payload->>'category_id')::bigint,
   'notes',c.creation_fields->>'notes','tags',(SELECT string_agg(value,',' ORDER BY ordinal)
    FROM jsonb_array_elements_text(c.creation_fields->'tags') WITH ORDINALITY a(value,ordinal)))) INTO expected
  FROM (SELECT 1) one LEFT JOIN public.cal_ingestion_receipts c ON c.observation_id=o.id;
 END IF;
 IF jsonb_strip_nulls(p_row-'charge_date') IS DISTINCT FROM jsonb_strip_nulls(expected-'charge_date')
  OR (p_row->>'charge_date')::date IS DISTINCT FROM coalesce(public.apy_charge_evidence(o.id),o.source_transaction_date)
  OR p_domain IS DISTINCT FROM nullif(o.accepted_payload->'_domain','null'::jsonb) THEN
  RAISE EXCEPTION 'inconsistent_post_evidence' USING ERRCODE='23514'; END IF;
 IF (p_row->>'total_amount')::numeric*100 IS DISTINCT FROM o.amount_minor
  OR p_row->>'movement_type' IS DISTINCT FROM o.movement_type
  OR (p_row->>'payment_source_id')::bigint IS DISTINCT FROM o.payment_source_id
  OR (p_row->>'transaction_date')::date IS DISTINCT FROM o.source_transaction_date
  OR (o.amount_minor<0 AND NOT coalesce(p_row->>'bank_movement'='refund' AND o.movement_type='expense'
   AND o.accepted_payload#>>'{_request,type}'='refund' AND kind='external_api',false))
  OR (kind<>'manual' AND (p_row->>'loan_id' IS NOT NULL OR p_row->>'parent_transaction_id' IS NOT NULL OR p_domain IS NOT NULL)) THEN
  RAISE EXCEPTION 'inconsistent_post' USING ERRCODE='23514'; END IF;
 -- Private posting authorization is the locked observation's transaction ID,
 -- checked by the existing external identity trigger, not a caller-set GUC.
 UPDATE public.transaction_source_observations SET decision_revision=decision_revision WHERE id=o.id;
 IF p_row->>'loan_id' IS NOT NULL THEN
  r=public.create_transaction_with_manual_loan_payment(p_row,p_domain->'loan_payment');
  SELECT * INTO STRICT t FROM public.transactions WHERE id=(r#>>'{transaction,id}')::integer;
  INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,transaction_id,actor,reason_code,result)
   VALUES(o.source_id,o.id,'created',t.id,'domain','manual_loan',r);
 ELSE
  INSERT INTO public.transactions(description,movement_type,total_amount,transaction_date,charge_date,payment_source_id,
   category_id,currency,original_amount,exchange_rate,notes,tags,external_id,installment_number,installment_count,
   installments_info,global_discount,global_discount_source,parent_transaction_id,bank_movement)
  VALUES(p_row->>'description',o.movement_type,o.amount_minor/100,o.source_transaction_date,
   (p_row->>'charge_date')::date,o.payment_source_id,(p_row->>'category_id')::bigint,
   coalesce(p_row->>'currency','ILS'),(p_row->>'original_amount')::numeric,(p_row->>'exchange_rate')::numeric,
   p_row->>'notes',p_row->>'tags',p_row->>'external_id',(p_row->>'installment_number')::integer,
   (p_row->>'installment_count')::integer,p_row->>'installments_info',coalesce((p_row->>'global_discount')::numeric,0),
   p_row->>'global_discount_source',(p_row->>'parent_transaction_id')::bigint,p_row->>'bank_movement') RETURNING * INTO t;
 END IF;
 UPDATE public.transaction_source_observations SET transaction_id=t.id,initial_identity=public.apy_identity(t),
  charge_date_origin=CASE WHEN public.apy_charge_evidence(o.id) IS NULL THEN 'provisional_purchase_date' ELSE 'source_supplied' END WHERE id=o.id;
 RETURN t.id;
END $$;

CREATE FUNCTION public.ingestion_core_apply(p_scope JSONB,p_facts JSONB,p_decision JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f JSONB=p_facts; d JSONB=p_decision; n JSONB=d->'normalized'; p JSONB=n->'input';
 o public.transaction_source_observations%ROWTYPE; t public.transactions%ROWTYPE; s public.transaction_ingestion_sources%ROWTYPE;
 target INTEGER=(d->>'target')::integer; result JSONB; h TEXT; cmd JSONB=p_scope->'command';
 req UUID=(p_scope->>'request_key')::uuid; row_data JSONB; enrichment JSONB=d->'enrichment'; action TEXT=d->>'action';
 obsid BIGINT; reason TEXT=d->>'reason'; revision BIGINT; request JSONB=p_scope->'request'; k TEXT;
 creator public.transaction_source_observations%ROWTYPE;
BEGIN
 IF action='return' THEN RETURN d->'result'; END IF;
 IF action='general' THEN
  IF p_scope->>'command_kind' IS DISTINCT FROM 'general'
   OR (d->>'revision')::integer IS DISTINCT FROM (f#>>'{general_review,revision}')::integer+1 THEN
   RAISE EXCEPTION 'inconsistent_resolution_revision' USING ERRCODE='23514'; END IF;
  IF d->'nested' IS NOT NULL AND d->'nested'<>'null'::jsonb THEN
   -- The nested operation is part of this one owner command, not authority for
   -- a different observation. Compare frozen fields, without re-evaluating policy.
   p=d#>'{nested,normalized,input}';
   IF d#>>'{nested_scope,channel}' IS DISTINCT FROM 'observation'
    OR d#>>'{nested_scope,source_id}' IS DISTINCT FROM f->>'source_id'
    OR d#>>'{nested,action}' IS DISTINCT FROM 'ingest'
    OR public.apy_hash(p) IS DISTINCT FROM public.apy_hash(d#>'{nested_scope,hash_input}')
    OR p->>'idempotency_key' IS DISTINCT FROM cmd#>>'{item,key}'
    OR (p->>'accounting_amount')::numeric IS DISTINCT FROM (cmd#>>'{item,charged,amount}')::numeric
    OR p->>'movement_type' IS DISTINCT FROM cmd#>>'{item,event,kind}'
    OR p->>'merchant' IS DISTINCT FROM cmd#>>'{item,merchant}'
    OR p->>'currency' IS DISTINCT FROM cmd#>>'{item,charged,currency}'
    OR p->>'transaction_date' IS DISTINCT FROM p_scope->>'date'
    OR p->>'charge_date' IS DISTINCT FROM cmd#>>'{item,dates,billing}'
    OR p->>'occurred_at' IS DISTINCT FROM cmd#>>'{item,dates,occurred_at}'
    OR nullif(p->'provider_reference','null'::jsonb) IS DISTINCT FROM nullif(cmd#>'{item,provider_reference}','null'::jsonb)
    OR (p->>'original_amount')::numeric IS DISTINCT FROM (cmd#>>'{item,original,amount}')::numeric
    OR p->>'original_currency' IS DISTINCT FROM cmd#>>'{item,original,currency}'
    OR p->>'original_scale' IS DISTINCT FROM cmd#>>'{item,original,scale}' THEN
    RAISE EXCEPTION 'inconsistent_resolution_evidence' USING ERRCODE='23514'; END IF;
   result=public.ingestion_core_apply(d->'nested_scope',f||jsonb_build_object('hash',public.apy_hash(d#>'{nested,normalized,input}')),d->'nested');
   result=d->'result'||jsonb_build_object('observation_id',result->>'observation_id','transaction_id',result->>'transaction_id',
    'review_required',result->'review_required','financial_posted',result->>'transaction_id' IS NOT NULL,'reason_code',result->>'reason_code',
    'outcome',CASE WHEN result->>'review_required'='true' THEN 'review_required' ELSE result->>'outcome' END);
  ELSE result=d->'result'; END IF;
  INSERT INTO public.transaction_api_resolutions(receipt_id,revision,request_key,command_hash,request_hash,evidence,observation_id,result,actor,reason,relationship)
  VALUES((cmd->>'receipt_id')::bigint,(d->>'revision')::integer,req,f->>'general_command_hash',f->>'general_item_hash',cmd->'item',
   (result->>'observation_id')::bigint,result,cmd->>'actor',cmd->>'reason',cmd->'relationship');
  RETURN public.transaction_api_result((cmd->>'receipt_id')::bigint)||jsonb_build_object('resolved_revision',(d->>'revision')::integer);
 END IF;
 IF action NOT IN ('ingest','replay','conflict','resume','approve','link','separate','amend','cancel') THEN
  RAISE EXCEPTION 'invalid_persistence_operation' USING ERRCODE='22023'; END IF;
 IF action IN ('replay','conflict','resume','approve','link','separate','amend','cancel') THEN
  SELECT * INTO STRICT o FROM public.transaction_source_observations WHERE id=(d->>'observation_id')::bigint FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f->'observations') x WHERE x->>'id'=o.id::text) THEN RAISE EXCEPTION 'observation_outside_snapshot' USING ERRCODE='23514'; END IF;
  IF (action IN ('replay','conflict','resume') AND o.source_id::text IS DISTINCT FROM f->>'source_id')
   OR (action IN ('approve','link','separate','amend') AND o.id::text IS DISTINCT FROM cmd->>'observation_id') THEN
   RAISE EXCEPTION 'inconsistent_operation_identity' USING ERRCODE='23514'; END IF;
  obsid=o.id;
 END IF;
 IF action='replay' THEN
  IF o.payload_fingerprint IS DISTINCT FROM f->>'hash' THEN RAISE EXCEPTION 'inconsistent_replay' USING ERRCODE='23514'; END IF;
  RETURN public.apy_result(o.id,true);
 ELSIF action='conflict' THEN
  IF o.payload_fingerprint IS NOT DISTINCT FROM f->>'hash' THEN RAISE EXCEPTION 'inconsistent_conflict' USING ERRCODE='23514'; END IF;
  INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,transaction_id,actor,reason_code,evidence)
   VALUES(o.source_id,o.id,'conflict',o.transaction_id,'source','idempotency_key_conflict',jsonb_build_object('received_fingerprint',f->>'hash'));
  RETURN public.apy_result(o.id)||jsonb_build_object('outcome','conflict','review_required',true,'reason_code','idempotency_key_conflict');
 END IF;
 IF action='ingest' THEN
  SELECT * INTO STRICT s FROM public.transaction_ingestion_sources WHERE id=(d->>'source_id')::bigint;
  IF s.id::text IS DISTINCT FROM f->>'source_id' OR NOT s.is_active OR s.source_kind='legacy_api'
   OR octet_length(p::text)>20000 OR (n->>'amount_minor')::numeric IS DISTINCT FROM (p->>'accounting_amount')::numeric*100
   OR p->>'idempotency_key' IS DISTINCT FROM coalesce(f->>'manual_resume_key',p_scope->>'key',p_scope#>>'{request,external_id}',p_scope#>>'{observation,idempotency_key}')
   THEN RAISE EXCEPTION 'inconsistent_observation' USING ERRCODE='23514'; END IF;
  IF (p_scope->>'channel' IN ('observation','flowlink') AND public.apy_hash(p) IS DISTINCT FROM f->>'hash')
   OR (p_scope->>'channel'='external' AND p_scope->'hash_input' IS DISTINCT FROM p_scope->'request') THEN
   RAISE EXCEPTION 'inconsistent_canonical_evidence' USING ERRCODE='23514'; END IF;
  IF p_scope->>'channel'='external' AND ((n->>'amount_minor')::numeric IS DISTINCT FROM
    (p_scope#>>'{request,amount}')::numeric*100*CASE WHEN p_scope#>>'{request,type}'='refund' THEN -1 ELSE 1 END
    OR p->>'movement_type' IS DISTINCT FROM CASE WHEN p_scope#>>'{request,type}'='refund' THEN 'expense' ELSE p_scope#>>'{request,type}' END)
   THEN RAISE EXCEPTION 'inconsistent_request_amount' USING ERRCODE='23514'; END IF;
  -- Credential/payment binding and request-to-evidence congruence are access
  -- control and integrity checks, not an alternative eligibility engine.
  IF p_scope->>'channel'='flowlink' AND (f#>>'{auth,credential_status}' IS DISTINCT FROM 'active'
   OR f#>>'{auth,device_status}' IS DISTINCT FROM 'active' OR f#>>'{auth,binding,status}' IS DISTINCT FROM 'active'
   OR f#>>'{auth,source_matches}' IS DISTINCT FROM 'true'
   OR (d->>'payment') IS DISTINCT FROM f#>>'{auth,binding,payment_source_id}'
   OR p->>'movement_type' IS DISTINCT FROM 'expense'
   OR (n->>'amount_minor')::numeric IS DISTINCT FROM (p_scope#>>'{request,amount}')::numeric*100
   OR (n->>'date') IS DISTINCT FROM p_scope#>>'{request,transaction_date}'
   OR p->>'merchant' IS DISTINCT FROM p_scope#>>'{request,merchant}') THEN
   RAISE EXCEPTION 'inconsistent_device_binding' USING ERRCODE='23514'; END IF;
  IF (p_scope->>'channel'='external' AND p_scope#>>'{request,payment_source_id}' IS NOT NULL
    AND d->>'payment' IS NOT NULL AND (d->>'payment')::bigint IS DISTINCT FROM (p_scope#>>'{request,payment_source_id}')::bigint)
   OR (p->>'payment_source_id' IS NOT NULL AND (d->>'payment')::bigint IS DISTINCT FROM (p->>'payment_source_id')::bigint) THEN
   RAISE EXCEPTION 'inconsistent_payment_evidence' USING ERRCODE='23514'; END IF;
  IF (p->>'transaction_date' IS NOT NULL AND n->>'date' IS DISTINCT FROM p->>'transaction_date')
   OR (p_scope->>'channel'='external' AND n->>'date' IS DISTINCT FROM request->>'date') THEN
   RAISE EXCEPTION 'inconsistent_accounting_date' USING ERRCODE='23514'; END IF;
  row_data=public.ingestion_core_row(d->'creation');
  IF p_scope->>'channel'='external' THEN
   -- Bind supplied fields without repeating category/payment selection policy.
   FOREACH k IN ARRAY ARRAY['description','original_amount','exchange_rate','notes','external_id','installment_number','installment_count'] LOOP
    IF row_data->k IS DISTINCT FROM request->k THEN RAISE EXCEPTION 'inconsistent_creation_evidence' USING ERRCODE='23514'; END IF;
   END LOOP;
   IF row_data->>'currency' IS DISTINCT FROM coalesce(request->>'currency','ILS')
    OR row_data->>'transaction_date' IS DISTINCT FROM request->>'date'
    OR row_data->>'charge_date' IS DISTINCT FROM coalesce(request->>'charge_date',request->>'date')
    OR (request->>'category_id' IS NOT NULL AND row_data->'category_id' IS DISTINCT FROM request->'category_id')
    OR row_data->>'tags' IS DISTINCT FROM (SELECT string_agg(value,',' ORDER BY ordinal) FROM jsonb_array_elements_text(request->'tags') WITH ORDINALITY a(value,ordinal))
    OR row_data-ARRAY['description','movement_type','bank_movement','total_amount','transaction_date','charge_date','payment_source_id','category_id','currency','original_amount','exchange_rate','external_id','notes','tags','installment_number','installment_count','installments_info']<>'{}'::jsonb THEN
    RAISE EXCEPTION 'inconsistent_creation_evidence' USING ERRCODE='23514'; END IF;
   IF p->>'merchant' IS DISTINCT FROM coalesce(nullif(request->>'description',''),'(description not supplied)')
    OR p->>'charge_date' IS DISTINCT FROM request->>'charge_date' THEN
    RAISE EXCEPTION 'inconsistent_creation_evidence' USING ERRCODE='23514'; END IF;
  ELSIF p_scope->>'channel' IN ('manual','csv') AND row_data IS DISTINCT FROM public.ingestion_core_row(p_scope->'row') THEN
   RAISE EXCEPTION 'inconsistent_creation_evidence' USING ERRCODE='23514';
  END IF;
  IF target IS NOT NULL THEN
   SELECT * INTO STRICT t FROM public.transactions WHERE id=target;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f->'transactions') x WHERE x->>'id'=target::text)
    OR t.voided_at IS NOT NULL OR public.apy_protected(t.id) OR t.total_amount*100 IS DISTINCT FROM (n->>'amount_minor')::numeric
    OR t.payment_source_id IS DISTINCT FROM (d->>'payment')::bigint OR t.movement_type IS DISTINCT FROM p->>'movement_type'
    OR EXISTS(SELECT 1 FROM public.transaction_source_observations x WHERE x.transaction_id=t.id AND
     (x.source_id=s.id OR (x.evidence_origin='source' AND (x.identity_overridden OR x.initial_identity IS DISTINCT FROM public.apy_identity(t)))))
    THEN RAISE EXCEPTION 'inconsistent_link' USING ERRCODE='23514'; END IF;
  END IF;
  row_data=public.ingestion_core_row(d->'creation');
  INSERT INTO public.transaction_source_observations(source_id,idempotency_key,provider_reference,transaction_id,evidence_origin,
   accepted_payload,payload_fingerprint,source_revision,merchant,normalized_merchant,merchant_key,amount_minor,currency_code,
   amount_basis,movement_type,source_transaction_date,source_charge_date,occurred_at,occurred_at_raw,time_precision,time_width,
   time_verified,reference_verified,date_discrepancy,payment_source_id,source_metadata,outcome,reason_code,review_required,candidate_ids,initial_identity)
  VALUES(s.id,p->>'idempotency_key',nullif(p->'provider_reference','null'),target,'source',
   p||CASE WHEN row_data IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('_creation',row_data,'_request',p_scope->'hash_input','_domain',p_scope->'domain') END,
   f->>'hash',s.revision,p->>'merchant',n->>'merchant',d->>'merchant_key',(n->>'amount_minor')::numeric,'ILS','accounting',p->>'movement_type',
   (n->>'date')::date,(p->>'charge_date')::date,(n->>'instant')::timestamptz,p->>'occurred_at',n->>'precision',(n->>'width')::interval,
   (d->>'time_verified')::boolean,(d->>'reference_verified')::boolean,(n->>'date_discrepancy')::boolean,(d->>'payment')::bigint,p->'source_metadata',
   CASE WHEN d->>'outcome'='created' THEN 'ambiguous' ELSE d->>'outcome' END,reason,d->>'outcome' IN ('ambiguous','conflict'),
   ARRAY(SELECT value::integer FROM jsonb_array_elements_text(d->'candidate_ids')),CASE WHEN target IS NOT NULL THEN public.apy_identity(t) END) RETURNING * INTO o;
  obsid=o.id;
  IF d->>'outcome'='created' THEN
   target=public.ingestion_core_post(o.id,public.ingestion_core_row(d->'posting'),p_scope->'domain');
   UPDATE public.transaction_source_observations SET outcome='created' WHERE id=o.id;
  END IF;
 ELSIF action IN ('link','separate','resume','approve','amend','cancel') THEN
  IF o.decision_revision IS DISTINCT FROM (d->>'revision')::bigint THEN RAISE EXCEPTION 'stale_observation_revision' USING ERRCODE='40001'; END IF;
  h=public.apy_hash(jsonb_build_object('command',p_scope->>'command_kind','payload',cmd));
  IF action='approve' THEN
   UPDATE public.transaction_source_observations SET reason_code='manual_domain_approved',decision_revision=decision_revision+1 WHERE id=o.id;
  ELSIF action IN ('resume','separate') THEN
   target=public.ingestion_core_post(o.id,public.ingestion_core_row(d->'posting'),o.accepted_payload->'_domain');
   UPDATE public.transaction_source_observations SET outcome='created',review_required=false,reason_code='owner_separate',decision_revision=decision_revision+1 WHERE id=o.id;
  ELSIF action='link' THEN
   SELECT * INTO STRICT t FROM public.transactions WHERE id=target;
    IF t.voided_at IS NOT NULL OR public.apy_protected(t.id) OR public.apy_captured(t.id)
     OR o.transaction_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.transaction_source_observations x WHERE x.transaction_id=t.id AND x.source_id=o.source_id)
     OR t.total_amount*100 IS DISTINCT FROM o.amount_minor OR t.payment_source_id IS DISTINCT FROM o.payment_source_id
    OR t.movement_type IS DISTINCT FROM o.movement_type OR public.apy_cash_fingerprint(t.id) IS DISTINCT FROM cmd->>'expected_transaction_fingerprint'
    THEN RAISE EXCEPTION 'inconsistent_link' USING ERRCODE='23514'; END IF;
   UPDATE public.transaction_source_observations SET transaction_id=target,initial_identity=public.apy_identity(t),outcome='reconciled',
    review_required=false,reason_code='owner_link',decision_revision=decision_revision+1 WHERE id=o.id;
  ELSIF action='amend' THEN
   target=o.transaction_id;
   UPDATE public.transaction_source_observations SET decision_revision=decision_revision+1 WHERE id=o.id;
  ELSIF action='cancel' THEN
   target=o.transaction_id;
   IF target IS DISTINCT FROM (cmd->>'transaction_id')::integer OR public.apy_cash_fingerprint(target) IS DISTINCT FROM cmd->>'expected_transaction_fingerprint' THEN
    RAISE EXCEPTION 'inconsistent_cancellation' USING ERRCODE='23514'; END IF;
   UPDATE public.transaction_source_observations SET decision_revision=decision_revision+1 WHERE transaction_id=target;
  END IF;
 END IF;
 IF enrichment->>'transaction_id' IS NOT NULL THEN
  IF (enrichment->>'transaction_id')::integer IS DISTINCT FROM target THEN RAISE EXCEPTION 'inconsistent_enrichment' USING ERRCODE='23514'; END IF;
   SELECT * INTO STRICT creator FROM public.transaction_source_observations WHERE id=(enrichment->>'creator_id')::bigint;
   IF creator.transaction_id IS DISTINCT FROM target OR creator.identity_overridden OR creator.charge_date_overridden
    OR creator.charge_date_origin IS DISTINCT FROM 'provisional_purchase_date'
    OR public.apy_protected(target) OR public.apy_captured(target)
    OR (SELECT voided_at IS NOT NULL FROM public.transactions WHERE id=target)
    OR (enrichment->>'charge_date')::date IS DISTINCT FROM (CASE WHEN action='amend' THEN (cmd->>'charge_date')::date ELSE public.apy_charge_evidence(obsid) END) THEN
    RAISE EXCEPTION 'inconsistent_enrichment_evidence' USING ERRCODE='23514'; END IF;
  INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,transaction_id,actor,reason_code,evidence)
   VALUES(o.source_id,o.id,'enrichment',target,'source','provisional_charge_date',jsonb_build_object('charge_date',enrichment->>'charge_date'));
  UPDATE public.transactions SET charge_date=(enrichment->>'charge_date')::date WHERE id=target;
  UPDATE public.transaction_source_observations SET charge_date_origin='cal_confirmed' WHERE id=(enrichment->>'creator_id')::bigint AND transaction_id=target;
 END IF;
 IF enrichment->>'ok'='false' THEN UPDATE public.transaction_source_observations SET review_required=true,reason_code='enrichment_conflict' WHERE id=obsid; END IF;
 result=public.apy_result(obsid);
 IF action='cancel' THEN result=result||jsonb_build_object('disposition','cancelled','reason_code','owner_cancelled'); END IF;
 SELECT decision_revision INTO revision FROM public.transaction_source_observations WHERE id=obsid;
 INSERT INTO public.transaction_reconciliation_events(source_id,observation_id,event_kind,request_key,command_fingerprint,transaction_id,actor,reason_code,decision_revision,evidence,result)
 VALUES(o.source_id,obsid,CASE WHEN action='ingest' THEN d->>'outcome' WHEN action='resume' THEN 'created' WHEN action='amend' THEN 'amendment' WHEN action='cancel' THEN 'cancel' ELSE 'review' END,
  req,h,target,CASE WHEN action='ingest' THEN 'source' WHEN action='resume' THEN 'manual' ELSE cmd->>'actor' END,
  reason,revision,coalesce(d->'event_evidence','{}'),CASE WHEN req IS NOT NULL THEN result END);
 IF action='cancel' THEN UPDATE public.transactions SET voided_at=clock_timestamp(),void_request_key=req,void_fingerprint=h,void_reason=cmd->>'reason' WHERE id=target; END IF;
 IF action='ingest' THEN result=result||jsonb_build_object('created_at',(SELECT created_at FROM public.transactions WHERE id=target)); END IF;
 IF action IN ('ingest','resume') THEN result=result||jsonb_build_object('accounting',(SELECT e.result FROM public.transaction_reconciliation_events e WHERE observation_id=obsid AND actor='domain' ORDER BY id DESC LIMIT 1)); END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.ingestion_core_commit(p_scope JSONB,p_token TEXT,p_decision JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot JSONB;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 LOCK TABLE public.transaction_ingestion_sources,public.transaction_source_observations,public.transaction_reconciliation_events,
  public.payment_sources,public.categories,public.cal_ingestion_receipts,public.transaction_api_receipts,public.transaction_api_resolutions,
  public.transaction_api_registrations,public.savings_entries,public.loan_payments,public.transaction_items,public.lego_sets,
  public.shopping_checkouts,public.budget_months,public.budget_operations,public.budget_operation_items,
  public.flowlink_device_credentials,public.flowlink_devices,public.flowlink_card_bindings IN SHARE ROW EXCLUSIVE MODE;
 snapshot=public.ingestion_core_snapshot(p_scope);
 IF snapshot->>'token' IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'stale_ingestion_snapshot' USING ERRCODE='40001'; END IF;
 RETURN public.ingestion_core_apply(p_scope,snapshot->'facts',p_decision);
END $$;
REVOKE ALL ON FUNCTION public.ingestion_core_post(BIGINT,JSONB,JSONB),public.ingestion_core_apply(JSONB,JSONB,JSONB),public.ingestion_core_commit(JSONB,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ingestion_core_commit(JSONB,TEXT,JSONB) TO service_role;
CREATE OR REPLACE FUNCTION public.apy_ui_transaction(p_id INTEGER) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',t.id::text,'description',t.description,'amount',t.total_amount::numeric(30,2)::text,
 'transaction_date',t.transaction_date,'charge_date',t.charge_date,'cancelled',t.voided_at IS NOT NULL,
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
   'candidates',coalesce((SELECT jsonb_agg(public.apy_ui_transaction(k::integer) ORDER BY k::integer)
    FROM (SELECT key k FROM jsonb_object_keys(fingerprints) key ORDER BY key::bigint LIMIT 100) keys),'[]'));
 END IF;
 RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
END $$;
-- Remove callable duplicate business engines. No CASCADE, no historical data rewrite.
DO $retire$
DECLARE f RECORD;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(ARRAY['ingest_external_transaction','ingest_owned_transaction','unified_ingest','ingest_observation','apy_normalize','apy_payment_source','apy_create_cash','apy_enrich','ingest_flowlink_observation','review_reconciliation','resolve_observation','amend_observation','cancel_ingested_transaction','resolve_general_receipt','evaluate_general_transaction','ingest_cal_v1','ingest_general_transaction','cal_external_guard','general_external_guard']) LOOP
  EXECUTE format('DROP FUNCTION %s',f.signature);
 END LOOP;
END $retire$;

COMMIT;
