-- Explicit owner links may attach FX evidence without changing financial rows.
-- Forward-only after 059; no historical record repair or source-key rewrite.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.transactions IN EXCLUSIVE MODE;

-- Patch only the known 059 private persistence body. Fail closed on drift,
-- including a repeat application. CREATE OR REPLACE preserves its owner/ACL.
DO $migration$
DECLARE definition TEXT; body TEXT; old_link TEXT; new_link TEXT;
BEGIN
 SELECT pg_get_functiondef(p.oid), replace(p.prosrc,chr(13),'') INTO definition,body
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.ingestion_core_apply(jsonb,jsonb,jsonb)')
  AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']
  AND p.prorettype='jsonb'::regtype AND NOT p.proretset AND NOT p.proisstrict AND p.provolatile='v'
  AND p.proargnames=ARRAY['p_scope','p_facts','p_decision']
  AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql');
 IF body IS NULL OR md5(body)<>'2af72eb0230b4f51594f21f6f50bafae' THEN
  RAISE EXCEPTION '064 requires the reviewed 059 ingestion_core_apply definition';
 END IF;
 definition=replace(definition,chr(13),'');
 old_link=$old$  ELSIF action='link' THEN
   SELECT * INTO STRICT t FROM public.transactions WHERE id=target;
    IF t.voided_at IS NOT NULL OR public.apy_protected(t.id) OR public.apy_captured(t.id)
     OR o.transaction_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.transaction_source_observations x WHERE x.transaction_id=t.id AND x.source_id=o.source_id)
     OR t.total_amount*100 IS DISTINCT FROM o.amount_minor OR t.payment_source_id IS DISTINCT FROM o.payment_source_id
    OR t.movement_type IS DISTINCT FROM o.movement_type OR public.apy_cash_fingerprint(t.id) IS DISTINCT FROM cmd->>'expected_transaction_fingerprint'
    THEN RAISE EXCEPTION 'inconsistent_link' USING ERRCODE='23514'; END IF;$old$;
 new_link=$new$  ELSIF action='link' THEN
   -- Bind the selected target and reviewed revision to the exact owner command.
   -- The locked snapshot remains authoritative. Matching/FX evidence policy is
   -- decided in JavaScript; these are persistence and linked-domain invariants.
   IF p_scope->>'command_kind' IS DISTINCT FROM 'resolve' OR cmd->>'action' IS DISTINCT FROM 'link'
    OR req IS NULL OR nullif(cmd->>'actor','') IS NULL
    OR target IS DISTINCT FROM (cmd->>'transaction_id')::integer
    OR o.decision_revision IS DISTINCT FROM (cmd->>'expected_revision')::bigint
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f->'transactions') x WHERE x->>'id'=target::text)
    OR (coalesce((p_scope->>'review')::boolean,false) AND
      (cmd->'expected_candidate_fingerprints' IS DISTINCT FROM public.apy_review_fingerprints(o.id)
       OR NOT coalesce(cmd->'expected_candidate_fingerprints' ? target::text,false))) THEN
    RAISE EXCEPTION 'inconsistent_owner_link' USING ERRCODE='23514'; END IF;
   SELECT * INTO STRICT t FROM public.transactions WHERE id=target;
   -- Migration-first compatibility: the deployed CAL writer emits either an
   -- exact no-op/conflict result or the existing provisional-date write shape.
   -- Only that legacy, non-FX path may carry enrichment. The unchanged writer
   -- below still binds creator, target and charge evidence, checks sticky owner
   -- overrides and history, and persists the enrichment/event atomically.
   -- New owner links send null and never enter that financial-write path.
   IF nullif(enrichment,'null'::jsonb) IS NOT NULL AND (
    (SELECT source_kind FROM public.transaction_ingestion_sources WHERE id=o.source_id) IS DISTINCT FROM 'cal'
    OR public.apy_protected(t.id)
    OR NOT coalesce(enrichment IN ('{"ok":true}'::jsonb,'{"ok":false}'::jsonb)
     OR (enrichment=jsonb_build_object('ok',true,'transaction_id',target::text,
          'creator_id',enrichment->>'creator_id','charge_date',enrichment->>'charge_date')
      AND enrichment->>'creator_id' ~ '^[1-9][0-9]*$'
      AND enrichment->>'charge_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),false)) THEN
    RAISE EXCEPTION 'inconsistent_owner_link_enrichment' USING ERRCODE='23514'; END IF;
   -- Preserve every non-FX protection from apy_protected. Do not change that
   -- function: automatic links, enrichment and cancellation still protect FX.
   IF t.voided_at IS NOT NULL OR public.apy_captured(t.id)
    OR t.loan_id IS NOT NULL OR t.parent_transaction_id IS NOT NULL OR coalesce(t.installment_count,1)>1
    OR t.installment_number IS NOT NULL OR t.installments_info IS NOT NULL OR coalesce(t.global_discount,0)<>0
    OR EXISTS(SELECT 1 FROM public.savings_entries WHERE transaction_id=t.id)
    OR EXISTS(SELECT 1 FROM public.loan_payments WHERE transaction_id=t.id)
    OR EXISTS(SELECT 1 FROM public.transaction_items WHERE transaction_id=t.id)
    OR EXISTS(SELECT 1 FROM public.lego_sets WHERE transaction_id=t.id)
    OR EXISTS(SELECT 1 FROM public.shopping_checkouts WHERE transaction_id=t.id)
    OR EXISTS(SELECT 1 FROM public.transactions WHERE parent_transaction_id=t.id)
    OR EXISTS(SELECT 1 FROM public.categories WHERE id=t.category_id AND savings_role IS NOT NULL)
    OR o.transaction_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.transaction_source_observations x WHERE x.transaction_id=t.id AND x.source_id=o.source_id)
    OR t.total_amount*100 IS DISTINCT FROM o.amount_minor OR t.payment_source_id IS DISTINCT FROM o.payment_source_id
    OR t.movement_type IS DISTINCT FROM o.movement_type
    OR t.transaction_date IS NULL OR o.source_transaction_date IS NULL OR abs(t.transaction_date-o.source_transaction_date)>1
    OR public.apy_cash_fingerprint(t.id) IS DISTINCT FROM cmd->>'expected_transaction_fingerprint'
    THEN RAISE EXCEPTION 'inconsistent_link' USING ERRCODE='23514'; END IF;$new$;
 IF length(definition)-length(replace(definition,old_link,''))<>length(old_link) THEN
  RAISE EXCEPTION '064 owner-link patch anchor mismatch';
 END IF;
 EXECUTE replace(definition,old_link,new_link);
END $migration$;

NOTIFY pgrst, 'reload schema';
COMMIT;
