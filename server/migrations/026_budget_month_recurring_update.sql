-- Migration 026: atomic current-month budget and recurring-default update
--
-- The existing month-override command remains the sole implementation of
-- funded base changes. This migration adds a bounded wrapper that captures an
-- approved state fingerprint, invokes that command in the same transaction,
-- and then updates the recurring configuration. No Budget table or view is
-- introduced.

BEGIN;

DO $$
DECLARE
  v_tables INTEGER;
  v_views INTEGER;
BEGIN
  IF to_regclass('public.budget_operation_items') IS NULL
     OR to_regclass('public.budget_month_overrides') IS NULL
     OR to_regclass('public.budget_recurring_defaults') IS NULL
     OR to_regclass('public.budget_category_composition') IS NULL
     OR to_regprocedure('public.set_budget_month_override(text,bigint,numeric,uuid,text)') IS NULL
     OR to_regprocedure('public.set_budget_recurring_default(bigint,numeric)') IS NULL
     OR to_regprocedure('public.budget_create_action_root(bigint,uuid,text,text,date,text,bigint)') IS NULL THEN
    RAISE EXCEPTION 'Migration 026 requires the exact post-025 funded-Budget foundation';
  END IF;

  SELECT count(*) INTO v_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'budget%';
  SELECT count(*) INTO v_views
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v' AND c.relname LIKE 'budget%';
  IF v_tables<>11 OR v_views<>9 THEN
    RAISE EXCEPTION 'Migration 026 expected 11 Budget tables and 9 Budget views; found % and %',
      v_tables,v_views;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='budget_operation_items'
      AND column_name='recurring_before')
     OR to_regprocedure('public.get_budget_month_and_recurring_default_preview(text,bigint,numeric)') IS NOT NULL
     OR to_regprocedure('public.set_budget_month_and_recurring_default(text,bigint,numeric,uuid,text,text)') IS NOT NULL
     OR to_regprocedure('public.capture_budget_month_recurring_update(text,bigint,numeric)') IS NOT NULL
     OR to_regprocedure('public.populate_budget_combined_recurring_item()') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 026 found partial combined-update state';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(ARRAY[
    'budget_carryover_batches','budget_carryover_transfers','budget_month_override_events',
    'budget_month_disposition_batches','budget_unused_disposition_events','budget_funding_actions',
    'budget_funding_action_legs','budget_unbudgeted_resolution_events'
  ]) AS retired(name) WHERE to_regclass('public.'||retired.name) IS NOT NULL) THEN
    RAISE EXCEPTION 'Migration 026 will not reintroduce a retired Budget relation';
  END IF;
END;
$$;

-- Legacy installations may predate the full-schema RLS declaration on the
-- immutable monthly snapshot table. Preserve the post-025 security boundary
-- explicitly for ordered-migration upgrades as well.
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.budget_operation_items
  ADD COLUMN recurring_before NUMERIC(18,2),
  ADD CONSTRAINT budget_operation_items_recurring_context CHECK (
    recurring_before IS NULL OR (
      item_kind='month_override'
      AND action_kind='set'
      AND resolution_mode='with_recurring'
      AND recurring_before::text NOT IN ('NaN','Infinity','-Infinity')
      AND recurring_before>=0
    )
  ),
  ADD CONSTRAINT budget_operation_items_combined_mode CHECK (
    resolution_mode IS DISTINCT FROM 'with_recurring'
    OR (item_kind='month_override' AND action_kind='set')
  );

-- A combined call delegates to set_budget_month_override. These two narrowly
-- scoped context hooks let that existing command retain the approved combined
-- fingerprint and typed recurring-before provenance without changing its
-- public signature or duplicating its accounting rules.
CREATE OR REPLACE FUNCTION public.budget_create_action_root(
  p_budget_month_id BIGINT,
  p_request_key UUID,
  p_request_fingerprint TEXT,
  p_operation_type TEXT,
  p_effective_date DATE,
  p_reason TEXT DEFAULT NULL,
  p_reverses_operation_id BIGINT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_id BIGINT;
  v_fingerprint TEXT:=p_request_fingerprint;
BEGIN
  IF p_operation_type='monthly_override_set'
     AND current_setting('finance_tracker.combined_month_recurring',true)='on' THEN
    v_fingerprint:=nullif(
      current_setting('finance_tracker.combined_month_recurring_fingerprint',true),'');
    IF v_fingerprint IS NULL THEN
      RAISE EXCEPTION 'Combined Budget update is missing its approved fingerprint'
        USING ERRCODE='23514';
    END IF;
  END IF;
  PERFORM set_config('finance_tracker.creating_budget_root','on',true);
  INSERT INTO public.budget_operations(
    budget_month_id,request_key,request_fingerprint,operation_type,
    effective_date,reason,reverses_operation_id
  ) VALUES(
    p_budget_month_id,p_request_key,v_fingerprint,p_operation_type,
    p_effective_date,p_reason,p_reverses_operation_id
  ) RETURNING id INTO v_id;
  PERFORM set_config('finance_tracker.creating_budget_root','off',true);
  PERFORM set_config('finance_tracker.budget_root_operation_id',v_id::text,true);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.populate_budget_combined_recurring_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_before TEXT;
BEGIN
  IF NEW.item_kind='month_override' AND NEW.action_kind='set'
     AND current_setting('finance_tracker.combined_month_recurring',true)='on' THEN
    v_before:=current_setting('finance_tracker.combined_month_recurring_before',true);
    NEW.recurring_before:=CASE WHEN v_before='<none>' THEN NULL
      ELSE v_before::numeric(18,2) END;
    NEW.resolution_mode:='with_recurring';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_operation_items_combined_recurring_context
BEFORE INSERT ON public.budget_operation_items
FOR EACH ROW EXECUTE FUNCTION public.populate_budget_combined_recurring_item();

CREATE OR REPLACE FUNCTION public.capture_budget_month_recurring_update(
  p_month TEXT,p_category_id BIGINT,p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_current_start DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_month_id BIGINT;
  v_category public.categories%ROWTYPE;
  v_composition public.budget_category_composition%ROWTYPE;
  v_unallocated NUMERIC(18,2);
  v_recurring NUMERIC(18,2);
  v_override NUMERIC(18,2);
  v_material JSONB;
  v_fingerprint TEXT;
BEGIN
  IF p_category_id IS NULL OR p_amount IS NULL THEN
    RAISE EXCEPTION 'month, category_id, and amount are required' USING ERRCODE='22023';
  END IF;
  IF p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<0
     OR p_amount<>round(p_amount,2) OR p_amount>9999999999999999.99 THEN
    RAISE EXCEPTION 'Combined Budget amount must be a finite nonnegative two-decimal value'
      USING ERRCODE='22023';
  END IF;
  IF v_month_start<>v_current_start THEN
    RAISE EXCEPTION 'BUDGET_MONTH_RECURRING_CURRENT_MONTH_ONLY: combined updates are limited to the current Asia/Jerusalem month'
      USING ERRCODE='23514';
  END IF;

  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start;
  IF v_month_id IS NULL THEN
    RAISE EXCEPTION 'Combined Budget update requires an initialized current month'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_category FROM public.categories WHERE id=p_category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % does not exist',p_category_id USING ERRCODE='P0002';
  END IF;
  IF v_category.type<>'expense' OR NOT v_category.is_active THEN
    RAISE EXCEPTION 'Combined Budget updates require an active expense category'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_composition FROM public.budget_category_composition
  WHERE budget_month_id=v_month_id AND category_id=p_category_id;
  IF NOT FOUND OR v_composition.lifecycle_state<>'active' THEN
    RAISE EXCEPTION 'Combined Budget update requires an active current-month budget snapshot'
      USING ERRCODE='23514';
  END IF;
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_month_id;
  SELECT amount INTO v_recurring FROM public.budget_recurring_defaults
  WHERE category_id=p_category_id;
  SELECT amount INTO v_override FROM public.budget_month_overrides
  WHERE budget_month_id=v_month_id AND category_id=p_category_id;

  v_material:=jsonb_build_object(
    'version',1,'month',p_month,'budget_month_id',v_month_id,
    'category_id',p_category_id,'category_type',v_category.type,
    'category_active',v_category.is_active,'budget_id',v_composition.budget_id,
    'lifecycle_state',v_composition.lifecycle_state,
    'requested_target',p_amount::numeric(18,2)::text,
    'effective_base',v_composition.effective_base::numeric(18,2)::text,
    'final_funded',v_composition.final_funded::numeric(18,2)::text,
    'raw_actual',v_composition.actual_spent::numeric(18,2)::text,
    'unallocated',v_unallocated::text,
    'recurring_before',CASE WHEN v_recurring IS NULL THEN NULL ELSE v_recurring::text END,
    'override_before',CASE WHEN v_override IS NULL THEN NULL ELSE v_override::text END,
    'fallback_base',v_composition.fallback_base::numeric(18,2)::text,
    'fallback_source',v_composition.fallback_source,
    'incoming_carryover',v_composition.incoming_carryover::numeric(18,2)::text,
    'outgoing_carryover',v_composition.outgoing_carryover::numeric(18,2)::text,
    'reallocation_net',(v_composition.incoming_reallocation_resolution-v_composition.outgoing_reallocation)::numeric(18,2)::text,
    'unbudgeted_resolution',v_composition.unbudgeted_resolution_adjustment::numeric(18,2)::text,
    'unused_disposition',v_composition.unused_disposition_adjustment::numeric(18,2)::text,
    'other_adjustments',v_composition.other_adjustments::numeric(18,2)::text
  );
  v_fingerprint:=md5(v_material::text);
  RETURN v_material||jsonb_build_object(
    'fingerprint',v_fingerprint,
    'delta',(p_amount::numeric(18,2)-v_composition.effective_base)::numeric(18,2)::text,
    'resulting_recurring',p_amount::numeric(18,2)::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_budget_month_and_recurring_default_preview(
  p_month TEXT,p_category_id BIGINT,p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
  SELECT public.capture_budget_month_recurring_update(p_month,p_category_id,p_amount)
$$;

CREATE OR REPLACE FUNCTION public.set_budget_month_and_recurring_default(
  p_month TEXT,p_category_id BIGINT,p_amount NUMERIC,p_request_key UUID,
  p_preview_fingerprint TEXT,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_current_start DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_month_id BIGINT;
  v_existing public.budget_operations%ROWTYPE;
  v_material JSONB;
  v_current_fingerprint TEXT;
  v_recurring_before TEXT;
BEGIN
  IF p_request_key IS NULL OR p_category_id IS NULL OR p_amount IS NULL
     OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'month, category_id, amount, request_key, and preview_fingerprint are required'
      USING ERRCODE='22023';
  END IF;
  IF v_month_start<>v_current_start THEN
    RAISE EXCEPTION 'BUDGET_MONTH_RECURRING_CURRENT_MONTH_ONLY: combined updates are limited to the current Asia/Jerusalem month'
      USING ERRCODE='23514';
  END IF;

  LOCK TABLE public.transactions IN SHARE MODE;
  SELECT id INTO v_month_id FROM public.budget_months
  WHERE month_start=v_month_start FOR UPDATE;
  IF v_month_id IS NULL THEN
    RAISE EXCEPTION 'Combined Budget update requires an initialized current month'
      USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories WHERE id=p_category_id FOR UPDATE;
  PERFORM 1 FROM public.budget_recurring_defaults WHERE category_id=p_category_id FOR UPDATE;
  PERFORM 1 FROM public.budget_month_overrides
    WHERE budget_month_id=v_month_id AND category_id=p_category_id FOR UPDATE;

  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.parent_operation_id IS NOT NULL
       OR v_existing.request_fingerprint<>p_preview_fingerprint
       OR v_existing.operation_type<>'monthly_override_set'
       OR NOT EXISTS (
         SELECT 1 FROM public.budget_operation_items i
         WHERE i.operation_id=v_existing.id AND i.item_kind='month_override'
           AND i.action_kind='set' AND i.resolution_mode='with_recurring'
           AND i.amount=p_amount::numeric(18,2)
       ) THEN
      RAISE EXCEPTION 'request_key was already used for a different combined Budget update'
        USING ERRCODE='23505';
    END IF;
    RETURN public.get_funded_budget_month(p_month);
  END IF;

  v_material:=public.capture_budget_month_recurring_update(p_month,p_category_id,p_amount);
  v_current_fingerprint:=v_material->>'fingerprint';
  IF v_current_fingerprint<>p_preview_fingerprint THEN
    RAISE EXCEPTION 'BUDGET_MONTH_RECURRING_PREVIEW_STALE: current month or recurring configuration changed; refresh and review again'
      USING ERRCODE='40001';
  END IF;
  v_recurring_before:=coalesce(v_material->>'recurring_before','<none>');

  PERFORM set_config('finance_tracker.combined_month_recurring','on',true);
  PERFORM set_config('finance_tracker.combined_month_recurring_fingerprint',p_preview_fingerprint,true);
  PERFORM set_config('finance_tracker.combined_month_recurring_before',v_recurring_before,true);
  PERFORM public.set_budget_month_override(
    p_month,p_category_id,p_amount,p_request_key,p_reason);
  PERFORM set_config('finance_tracker.combined_month_recurring','off',true);
  PERFORM set_config('finance_tracker.combined_month_recurring_fingerprint','',true);
  PERFORM set_config('finance_tracker.combined_month_recurring_before','',true);

  PERFORM public.set_budget_recurring_default(p_category_id,p_amount);
  PERFORM public.budget_assert_reconciled(v_month_id);
  RETURN public.get_funded_budget_month(p_month);
END;
$$;

REVOKE ALL ON FUNCTION public.capture_budget_month_recurring_update(TEXT,BIGINT,NUMERIC),
  public.populate_budget_combined_recurring_item()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.budget_assert_reconciled(BIGINT)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_budget_month_and_recurring_default_preview(TEXT,BIGINT,NUMERIC),
  public.set_budget_month_and_recurring_default(TEXT,BIGINT,NUMERIC,UUID,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_budget_month_and_recurring_default_preview(TEXT,BIGINT,NUMERIC),
  public.set_budget_month_and_recurring_default(TEXT,BIGINT,NUMERIC,UUID,TEXT,TEXT)
  TO service_role;

DO $$
DECLARE
  v_tables INTEGER;
  v_views INTEGER;
BEGIN
  SELECT count(*) INTO v_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'budget%';
  SELECT count(*) INTO v_views
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v' AND c.relname LIKE 'budget%';
  IF v_tables<>11 OR v_views<>9 THEN
    RAISE EXCEPTION 'Migration 026 changed the consolidated Budget object counts';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND c.relname LIKE 'budget%' AND c.relrowsecurity)<>11 THEN
    RAISE EXCEPTION 'Migration 026 expected RLS on all eleven Budget tables';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[
    'budget_carryover_batches','budget_carryover_transfers','budget_month_override_events',
    'budget_month_disposition_batches','budget_unused_disposition_events','budget_funding_actions',
    'budget_funding_action_legs','budget_unbudgeted_resolution_events'
  ]) AS retired(name) WHERE to_regclass('public.'||retired.name) IS NOT NULL) THEN
    RAISE EXCEPTION 'Migration 026 reintroduced a retired Budget relation';
  END IF;
  IF to_regprocedure('public.set_budget_month_override(text,bigint,numeric,uuid,text)') IS NULL
     OR to_regprocedure('public.set_budget_recurring_default(bigint,numeric)') IS NULL
     OR to_regprocedure('public.get_budget_month_and_recurring_default_preview(text,bigint,numeric)') IS NULL
     OR to_regprocedure('public.set_budget_month_and_recurring_default(text,bigint,numeric,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Migration 026 did not preserve/install the required public RPC contracts';
  END IF;
  IF EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
       WHERE p.oid='public.budget_assert_reconciled(bigint)'::regprocedure
         AND acl.grantee=0
         AND acl.privilege_type='EXECUTE'
     )
     OR has_function_privilege('anon','public.budget_assert_reconciled(bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.budget_assert_reconciled(bigint)','EXECUTE')
     OR has_function_privilege('service_role','public.budget_assert_reconciled(bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'Migration 026 left budget_assert_reconciled directly executable by an application role';
  END IF;
  PERFORM public.budget_assert_reconciled(id) FROM public.budget_months;
END;
$$;

COMMIT;
