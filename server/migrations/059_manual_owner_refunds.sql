-- Manual owner refund correction. Forward only; requires deployed migration 058.
-- Backward compatible: existing callers and stored evidence are unchanged.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.transactions IN EXCLUSIVE MODE;

-- Signed cash must retain congruent refund classification. Source eligibility
-- is decided in JS; the private writer binds the classification to its evidence.
ALTER TABLE public.transaction_source_observations DROP CONSTRAINT transaction_source_observations_check1;
ALTER TABLE public.transaction_source_observations ADD CONSTRAINT transaction_source_observations_check1 CHECK (
 evidence_origin<>'source' OR outcome IN ('ambiguous','conflict') OR
 ((amount_minor>0 OR coalesce((amount_minor<0 AND movement_type='expense' AND accepted_payload#>>'{_creation,bank_movement}'='refund'
 AND source_metadata->>'bank_movement'='refund'),false)) AND currency_code='ILS' AND amount_basis='accounting'
 AND movement_type IN ('expense','income') AND source_transaction_date IS NOT NULL
 AND payment_source_id IS NOT NULL AND merchant IS NOT NULL AND normalized_merchant<>''));

-- Persist the server-derived classification in the same UPDATE as the amount.
CREATE OR REPLACE FUNCTION public.update_transaction_with_manual_loan_payment(
  p_transaction_id BIGINT,
  p_transaction JSONB,
  p_loan_payment JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_transaction public.transactions%ROWTYPE;
  v_new_loan_id BIGINT;
  v_transaction JSONB;
  v_payment JSONB;
  v_loan JSONB;
BEGIN
  SELECT * INTO v_old_transaction
  FROM public.transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % does not exist', p_transaction_id;
  END IF;

  v_new_loan_id := nullif(p_transaction->>'loan_id', '')::BIGINT;
  PERFORM 1 FROM public.loans
  WHERE id IN (v_old_transaction.loan_id, v_new_loan_id)
  ORDER BY id
  FOR UPDATE;
  IF v_new_loan_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.loans WHERE id = v_new_loan_id) THEN
    RAISE EXCEPTION 'Loan % does not exist', v_new_loan_id;
  END IF;

  UPDATE public.transactions
  SET description = p_transaction->>'description',
      movement_type = p_transaction->>'movement_type',
      bank_movement = CASE WHEN p_transaction ? 'bank_movement' THEN p_transaction->>'bank_movement' ELSE bank_movement END,
      category_id = nullif(p_transaction->>'category_id', '')::BIGINT,
      total_amount = (p_transaction->>'total_amount')::NUMERIC,
      global_discount = coalesce(nullif(p_transaction->>'global_discount', '')::NUMERIC, 0),
      global_discount_source = nullif(p_transaction->>'global_discount_source', ''),
      payment_source_id = nullif(p_transaction->>'payment_source_id', '')::BIGINT,
      transaction_date = (p_transaction->>'transaction_date')::DATE,
      charge_date = coalesce(nullif(p_transaction->>'charge_date', '')::DATE,
        (p_transaction->>'transaction_date')::DATE),
      tags = p_transaction->>'tags',
      loan_id = v_new_loan_id,
      original_amount = nullif(p_transaction->>'original_amount', '')::NUMERIC,
      currency = coalesce(nullif(p_transaction->>'currency', ''), 'ILS'),
      exchange_rate = nullif(p_transaction->>'exchange_rate', '')::NUMERIC,
      installments_info = CASE
        WHEN p_transaction ? 'installments_info'
          THEN nullif(p_transaction->>'installments_info', '')
        ELSE installments_info
      END,
      installment_number = CASE
        WHEN p_transaction ? 'installment_number'
          THEN nullif(p_transaction->>'installment_number', '')::INTEGER
        ELSE installment_number
      END,
      installment_count = CASE
        WHEN p_transaction ? 'installment_count'
          THEN nullif(p_transaction->>'installment_count', '')::INTEGER
        ELSE installment_count
      END,
      notes = p_transaction->>'notes',
      updated_at = timezone('utc'::text, now())
  WHERE id = p_transaction_id;

  PERFORM public.sync_manual_loan_payment_from_transaction(
    p_transaction_id, p_loan_payment
  );
  SELECT to_jsonb(t) INTO v_transaction
  FROM public.transactions t WHERE id = p_transaction_id;
  SELECT to_jsonb(lp) INTO v_payment
  FROM public.loan_payments lp WHERE transaction_id = p_transaction_id;
  SELECT to_jsonb(l) INTO v_loan
  FROM public.loans l WHERE id = nullif(v_transaction->>'loan_id', '')::BIGINT;
  RETURN jsonb_build_object(
    'transaction', v_transaction,
    'loanPayment', v_payment,
    'loan', v_loan
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ingestion_core_post(p_id BIGINT,p_row JSONB,p_domain JSONB) RETURNS INTEGER
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
   AND ((o.accepted_payload#>>'{_request,type}'='refund' AND kind='external_api')
    OR (kind='manual' AND o.accepted_payload#>>'{_creation,bank_movement}'='refund')),false))
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

CREATE OR REPLACE FUNCTION public.ingestion_core_apply(p_scope JSONB,p_facts JSONB,p_decision JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f JSONB=p_facts; d JSONB=p_decision; n JSONB=d->'normalized'; p JSONB=n->'input';
 o public.transaction_source_observations%ROWTYPE; t public.transactions%ROWTYPE; s public.transaction_ingestion_sources%ROWTYPE;
 target INTEGER=(d->>'target')::integer; result JSONB; h TEXT; cmd JSONB=p_scope->'command';
 req UUID=(p_scope->>'request_key')::uuid; row_data JSONB; enrichment JSONB=d->'enrichment'; action TEXT=d->>'action';
 obsid BIGINT; reason TEXT=d->>'reason'; revision BIGINT; request JSONB=p_scope->'request'; k TEXT;
 creator public.transaction_source_observations%ROWTYPE;
BEGIN
 IF action='owner_refund_edit' THEN
  -- Bind the JS owner decision to its command under the existing snapshot lock.
  -- Eligibility, signed intent and protected-domain policy remain in JavaScript.
  IF p_scope->>'command_kind' IS DISTINCT FROM 'owner_refund_edit'
   OR d->>'transaction_id' IS DISTINCT FROM cmd->>'transaction_id'
   OR d->'transaction' IS DISTINCT FROM cmd->'transaction'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f->'transactions') x WHERE x->>'id'=d->>'transaction_id') THEN
   RAISE EXCEPTION 'inconsistent_owner_edit' USING ERRCODE='23514'; END IF;
  result=public.update_transaction_with_manual_loan_payment((d->>'transaction_id')::bigint,d->'transaction',NULL);
  RETURN jsonb_build_object('outcome','updated','accounting',result);
 END IF;
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

-- CREATE OR REPLACE retains the existing service-only/private grants.
NOTIFY pgrst, 'reload schema';
COMMIT;
