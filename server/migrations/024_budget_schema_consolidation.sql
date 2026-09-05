-- Migration 024: consolidate funded-budget action provenance.
--
-- Financial truth remains in funding entries, movements, savings entries,
-- lifecycle events, and transactions. budget_operations is the sole action
-- header; budget_operation_items stores typed point-in-time approval context.

BEGIN;

DO $$
DECLARE
  v_relation TEXT;
  v_count BIGINT;
  v_month RECORD;
BEGIN
  IF to_regclass('public.budget_months') IS NULL
     OR to_regclass('public.budgets') IS NULL
     OR to_regclass('public.budget_operations') IS NULL
     OR to_regclass('public.budget_funding_entries') IS NULL
     OR to_regclass('public.budget_movements') IS NULL
     OR to_regclass('public.budget_lifecycle_events') IS NULL
     OR to_regclass('public.budget_recurring_defaults') IS NULL
     OR to_regclass('public.budget_month_overrides') IS NULL
     OR to_regclass('public.budget_unused_balance_policies') IS NULL
     OR to_regclass('public.budget_savings_entries') IS NULL
     OR to_regclass('public.budget_carryover_batches') IS NULL
     OR to_regclass('public.budget_carryover_transfers') IS NULL
     OR to_regclass('public.budget_month_override_events') IS NULL
     OR to_regclass('public.budget_month_disposition_batches') IS NULL
     OR to_regclass('public.budget_unused_disposition_events') IS NULL
     OR to_regclass('public.budget_funding_actions') IS NULL
     OR to_regclass('public.budget_funding_action_legs') IS NULL
     OR to_regclass('public.budget_unbudgeted_resolution_events') IS NULL
     OR to_regprocedure('public.get_funded_budget_month(text)') IS NULL
     OR to_regprocedure('public.set_budget_recurring_default(bigint,numeric)') IS NULL
     OR to_regprocedure('public.initialize_budget_recurring_defaults(text,uuid,text)') IS NULL
     OR to_regprocedure('public.copy_funded_budget_month(text,text,uuid,text)') IS NULL
     OR to_regprocedure('public.get_budget_month_override_preview(text)') IS NULL
     OR to_regprocedure('public.set_budget_month_override(text,bigint,numeric,uuid,text)') IS NULL
     OR to_regprocedure('public.remove_budget_month_override(text,bigint,uuid,text)') IS NULL
     OR to_regprocedure('public.get_budget_carryover_preview(text)') IS NULL
     OR to_regprocedure('public.apply_budget_carryover(text,uuid,text,text)') IS NULL
     OR to_regprocedure('public.reverse_budget_carryover(bigint,uuid,text)') IS NULL
     OR to_regprocedure('public.set_budget_unused_balance_policy(bigint,text)') IS NULL
     OR to_regprocedure('public.get_budget_month_disposition_preview(text)') IS NULL
     OR to_regprocedure('public.apply_budget_month_disposition(text,uuid,text,text)') IS NULL
     OR to_regprocedure('public.reverse_budget_month_disposition(bigint,uuid,text)') IS NULL
     OR to_regprocedure('public.get_budget_reallocation_preview(text,text,bigint,text,bigint,numeric)') IS NULL
     OR to_regprocedure('public.apply_budget_reallocation(text,text,bigint,text,bigint,numeric,uuid,text,text)') IS NULL
     OR to_regprocedure('public.get_budget_deficit_resolution_preview(text,bigint,jsonb)') IS NULL
     OR to_regprocedure('public.apply_budget_deficit_resolution(text,bigint,jsonb,uuid,text,text)') IS NULL
     OR to_regprocedure('public.reverse_budget_funding_action(bigint,uuid,text)') IS NULL
     OR to_regprocedure('public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)') IS NULL
     OR to_regprocedure('public.apply_budget_unbudgeted_resolution(text,bigint,numeric,jsonb,uuid,text,text)') IS NULL
     OR to_regprocedure('public.reverse_budget_unbudgeted_resolution(bigint,uuid,text)') IS NULL
     OR to_regprocedure('public.budget_assert_reconciled(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Migration 024 preflight: exact Migrations 017 through 023 foundation is required';
  END IF;

  IF to_regclass('public.budget_operation_items') IS NOT NULL
     OR to_regclass('public.budget_category_composition') IS NOT NULL
     OR to_regclass('public.budget_operation_history') IS NOT NULL
     OR to_regprocedure('public.budget_operation_root_id(bigint)') IS NOT NULL
     OR to_regprocedure('public.budget_create_action_root(bigint,uuid,text,text,date,text,bigint)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='budget_operations'
         AND column_name='parent_operation_id'
     ) THEN
    RAISE EXCEPTION 'Migration 024 preflight: unexpected partial consolidation state exists';
  END IF;

  FOREACH v_relation IN ARRAY ARRAY[
    'budget_carryover_batches','budget_carryover_transfers',
    'budget_month_override_events','budget_month_disposition_batches',
    'budget_unused_disposition_events','budget_funding_actions',
    'budget_funding_action_legs','budget_unbudgeted_resolution_events'
  ] LOOP
    IF (SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=v_relation) NOT IN ('r','p') THEN
      RAISE EXCEPTION 'Migration 024 preflight: public.% must be a physical table',v_relation;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I',v_relation) INTO v_count;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'Migration 024 preflight: retirement table public.% contains % rows; provenance must not be discarded',
        v_relation,v_count;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.budgets WHERE starting_kind NOT IN (
      'manual','legacy_import','copied','recurring_default','carryover_only',
      'monthly_override','unbudgeted_resolution'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.budget_operations WHERE operation_type NOT IN (
      'legacy_import','manual_funding','establish_budget','adjustment','removal',
      'reactivation','copy','reversal','month_initialization','carryover_out',
      'carryover_in','monthly_override_set','monthly_override_remove',
      'unused_return_out','unused_return_in','unused_to_savings',
      'unused_disposition_reversal','budget_reallocation','deficit_resolution',
      'funding_action_reversal','unbudgeted_resolution','unbudgeted_resolution_reversal'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.budget_funding_entries WHERE source_kind NOT IN (
      'manual_available_funds','legacy_import','carryover_transfer',
      'unused_disposition_transfer','savings_transfer','savings_withdrawal'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.budget_savings_entries WHERE entry_kind NOT IN (
      'deposit','reversal','withdrawal','withdrawal_reversal'
    )
  ) THEN
    RAISE EXCEPTION 'Migration 024 preflight: unexpected funded-budget domain value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.budget_savings_entries
    WHERE amount_delta::text IN ('NaN','Infinity','-Infinity')
  ) OR coalesce((SELECT sum(amount_delta) FROM public.budget_savings_entries),0) < 0 THEN
    RAISE EXCEPTION 'Migration 024 preflight: Savings ledger is invalid';
  END IF;

  FOR v_month IN SELECT id FROM public.budget_months ORDER BY id LOOP
    PERFORM public.budget_assert_reconciled(v_month.id);
  END LOOP;
END;
$$;

ALTER TABLE public.budget_operations
  ADD COLUMN parent_operation_id BIGINT
    REFERENCES public.budget_operations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT budget_operations_not_self_parented CHECK (
    parent_operation_id IS NULL OR parent_operation_id <> id
  );

ALTER TABLE public.budget_operations
  DROP CONSTRAINT budget_operations_operation_type_check,
  ADD CONSTRAINT budget_operations_operation_type_check CHECK (operation_type IN (
    'legacy_import','manual_funding','establish_budget','adjustment','removal',
    'reactivation','copy','reversal','month_initialization','carryover_out',
    'carryover_in','monthly_override_set','monthly_override_remove',
    'unused_return_out','unused_return_in','unused_to_savings',
    'unused_disposition_reversal','budget_reallocation','deficit_resolution',
    'funding_action_reversal','unbudgeted_resolution','unbudgeted_resolution_reversal',
    'month_close'
  ));

CREATE INDEX idx_budget_operations_parent
  ON public.budget_operations(parent_operation_id,id)
  WHERE parent_operation_id IS NOT NULL;

CREATE TABLE public.budget_operation_items (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  operation_id BIGINT NOT NULL REFERENCES public.budget_operations(id) ON DELETE RESTRICT,
  item_kind TEXT NOT NULL CHECK (item_kind IN (
    'month_override','month_close','carryover','unused_disposition',
    'reallocation','funding_action','allocation_leg','deficit_resolution',
    'unbudgeted_resolution'
  )),
  action_kind TEXT,
  budget_month_id BIGINT REFERENCES public.budget_months(id) ON DELETE RESTRICT,
  destination_budget_month_id BIGINT REFERENCES public.budget_months(id) ON DELETE RESTRICT,
  category_id BIGINT REFERENCES public.categories(id) ON DELETE RESTRICT,
  source_budget_id BIGINT REFERENCES public.budgets(id) ON DELETE RESTRICT,
  destination_budget_id BIGINT REFERENCES public.budgets(id) ON DELETE RESTRICT,
  source_operation_id BIGINT REFERENCES public.budget_operations(id) ON DELETE RESTRICT,
  destination_operation_id BIGINT REFERENCES public.budget_operations(id) ON DELETE RESTRICT,
  source_kind TEXT,
  policy TEXT,
  resolution_mode TEXT,
  amount NUMERIC(18,2),
  raw_actual_snapshot NUMERIC(18,2),
  source_capacity_snapshot NUMERIC(18,2),
  funded_before NUMERIC(18,2),
  funded_after NUMERIC(18,2),
  base_before NUMERIC(18,2),
  base_after NUMERIC(18,2),
  fallback_base_snapshot NUMERIC(18,2),
  deficit_before NUMERIC(18,2),
  deficit_after NUMERIC(18,2),
  movement_id BIGINT REFERENCES public.budget_movements(id) ON DELETE RESTRICT,
  source_movement_id BIGINT REFERENCES public.budget_movements(id) ON DELETE RESTRICT,
  destination_movement_id BIGINT REFERENCES public.budget_movements(id) ON DELETE RESTRICT,
  source_funding_entry_id BIGINT REFERENCES public.budget_funding_entries(id) ON DELETE RESTRICT,
  destination_funding_entry_id BIGINT REFERENCES public.budget_funding_entries(id) ON DELETE RESTRICT,
  savings_entry_id BIGINT REFERENCES public.budget_savings_entries(id) ON DELETE RESTRICT,
  lifecycle_event_id BIGINT REFERENCES public.budget_lifecycle_events(id) ON DELETE RESTRICT,
  linked_item_id BIGINT REFERENCES public.budget_operation_items(id) ON DELETE RESTRICT,
  reversed_item_id BIGINT UNIQUE REFERENCES public.budget_operation_items(id) ON DELETE RESTRICT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text,now()),
  CONSTRAINT budget_operation_items_not_self_linked CHECK (
    linked_item_id IS NULL OR linked_item_id<>id
  ),
  CONSTRAINT budget_operation_items_not_self_reversed CHECK (
    reversed_item_id IS NULL OR reversed_item_id<>id
  ),
  CONSTRAINT budget_operation_items_money_shape CHECK (
    (amount IS NULL OR amount::text NOT IN ('NaN','Infinity','-Infinity'))
    AND (raw_actual_snapshot IS NULL OR raw_actual_snapshot::text NOT IN ('NaN','Infinity','-Infinity'))
    AND (source_capacity_snapshot IS NULL OR source_capacity_snapshot::text NOT IN ('NaN','Infinity','-Infinity'))
    AND (funded_before IS NULL OR funded_before::text NOT IN ('NaN','Infinity','-Infinity'))
    AND (funded_after IS NULL OR funded_after::text NOT IN ('NaN','Infinity','-Infinity'))
    AND (base_before IS NULL OR base_before::text NOT IN ('NaN','Infinity','-Infinity'))
    AND (base_after IS NULL OR base_after::text NOT IN ('NaN','Infinity','-Infinity'))
    AND (fallback_base_snapshot IS NULL OR fallback_base_snapshot::text NOT IN ('NaN','Infinity','-Infinity'))
    AND (deficit_before IS NULL OR deficit_before::text NOT IN ('NaN','Infinity','-Infinity'))
    AND (deficit_after IS NULL OR deficit_after::text NOT IN ('NaN','Infinity','-Infinity'))
  )
);

CREATE INDEX idx_budget_operation_items_operation
  ON public.budget_operation_items(operation_id,id);
CREATE INDEX idx_budget_operation_items_month_category
  ON public.budget_operation_items(budget_month_id,category_id,id);
CREATE INDEX idx_budget_operation_items_source_budget
  ON public.budget_operation_items(source_budget_id,id)
  WHERE source_budget_id IS NOT NULL;
CREATE INDEX idx_budget_operation_items_destination_budget
  ON public.budget_operation_items(destination_budget_id,id)
  WHERE destination_budget_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_budget_operation_tree()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_parent public.budget_operations%ROWTYPE;
  v_reversed public.budget_operations%ROWTYPE;
  v_parent_month DATE;
  v_child_month DATE;
BEGIN
  IF NEW.parent_operation_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.budget_operations WHERE id=NEW.parent_operation_id;
    IF NOT FOUND OR v_parent.parent_operation_id IS NOT NULL THEN
      RAISE EXCEPTION 'Budget operation children must reference a root operation' USING ERRCODE='23514';
    END IF;
    IF NEW.request_key=v_parent.request_key THEN
      RAISE EXCEPTION 'Budget operation child must use a deterministic distinct request key' USING ERRCODE='23514';
    END IF;
    SELECT month_start INTO v_parent_month FROM public.budget_months WHERE id=v_parent.budget_month_id;
    SELECT month_start INTO v_child_month FROM public.budget_months WHERE id=NEW.budget_month_id;
    IF NEW.effective_date IS DISTINCT FROM v_child_month THEN
      RAISE EXCEPTION 'Budget operation child effective date must match its posting month' USING ERRCODE='23514';
    END IF;
    IF v_child_month IS DISTINCT FROM v_parent_month AND (
      v_parent.operation_type NOT IN ('carryover_out','month_close','unused_disposition_reversal')
      OR v_child_month NOT IN (
        (v_parent_month-interval '1 month')::date,
        (v_parent_month+interval '1 month')::date
      )
    ) THEN
      RAISE EXCEPTION 'Budget cross-month child does not match an adjacent cross-month action' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.reverses_operation_id IS NOT NULL THEN
    SELECT * INTO v_reversed FROM public.budget_operations WHERE id=NEW.reverses_operation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Budget operation reversal target does not exist' USING ERRCODE='23514';
    END IF;
    IF NEW.parent_operation_id IS NULL AND v_reversed.parent_operation_id IS NOT NULL THEN
      RAISE EXCEPTION 'Budget root reversal must reference an original root' USING ERRCODE='23514';
    END IF;
    IF NEW.parent_operation_id IS NOT NULL
       AND v_reversed.parent_operation_id IS DISTINCT FROM v_parent.reverses_operation_id THEN
      RAISE EXCEPTION 'Budget operation reversal children must align with their root reversal' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_operations_tree_validate
BEFORE INSERT OR UPDATE ON public.budget_operations
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_operation_tree();

CREATE OR REPLACE FUNCTION public.validate_budget_operation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_operation public.budget_operations%ROWTYPE;
  v_source public.budgets%ROWTYPE;
  v_destination public.budgets%ROWTYPE;
BEGIN
  SELECT * INTO v_operation FROM public.budget_operations WHERE id=NEW.operation_id;
  IF NOT FOUND OR v_operation.parent_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Budget operation items must belong to a root operation' USING ERRCODE='23514';
  END IF;
  IF NEW.budget_month_id IS NULL THEN NEW.budget_month_id:=v_operation.budget_month_id; END IF;
  IF NEW.source_budget_id IS NOT NULL THEN
    SELECT * INTO v_source FROM public.budgets WHERE id=NEW.source_budget_id;
    IF NOT FOUND OR (NEW.category_id IS NOT NULL AND v_source.category_id<>NEW.category_id) THEN
      RAISE EXCEPTION 'Budget operation item source budget/category mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.destination_budget_id IS NOT NULL THEN
    SELECT * INTO v_destination FROM public.budgets WHERE id=NEW.destination_budget_id;
    IF NOT FOUND OR (NEW.category_id IS NOT NULL AND NEW.item_kind IN ('carryover','unbudgeted_resolution')
      AND v_destination.category_id<>NEW.category_id) THEN
      RAISE EXCEPTION 'Budget operation item destination budget/category mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.source_operation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_operations posting
    WHERE posting.id=NEW.source_operation_id
      AND coalesce(posting.parent_operation_id,posting.id)=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item source operation is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.destination_operation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_operations posting
    WHERE posting.id=NEW.destination_operation_id
      AND coalesce(posting.parent_operation_id,posting.id)=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item destination operation is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.movement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_movements posting
    JOIN public.budget_operations operation ON operation.id=posting.operation_id
    WHERE posting.id=NEW.movement_id
      AND coalesce(operation.parent_operation_id,operation.id)=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item movement is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.source_movement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_movements posting
    JOIN public.budget_operations operation ON operation.id=posting.operation_id
    WHERE posting.id=NEW.source_movement_id
      AND coalesce(operation.parent_operation_id,operation.id)=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item source movement is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.destination_movement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_movements posting
    JOIN public.budget_operations operation ON operation.id=posting.operation_id
    WHERE posting.id=NEW.destination_movement_id
      AND coalesce(operation.parent_operation_id,operation.id)=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item destination movement is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.source_funding_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_funding_entries posting
    JOIN public.budget_operations operation ON operation.id=posting.operation_id
    WHERE posting.id=NEW.source_funding_entry_id
      AND coalesce(operation.parent_operation_id,operation.id)=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item source funding entry is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.destination_funding_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_funding_entries posting
    JOIN public.budget_operations operation ON operation.id=posting.operation_id
    WHERE posting.id=NEW.destination_funding_entry_id
      AND coalesce(operation.parent_operation_id,operation.id)=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item destination funding entry is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.savings_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_savings_entries posting
    JOIN public.budget_operations operation ON operation.id=posting.operation_id
    WHERE posting.id=NEW.savings_entry_id
      AND coalesce(operation.parent_operation_id,operation.id)=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item Savings entry is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.lifecycle_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_lifecycle_events posting
    JOIN public.budget_operations operation ON operation.id=posting.operation_id
    WHERE posting.id=NEW.lifecycle_event_id
      AND coalesce(operation.parent_operation_id,operation.id)=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item lifecycle event is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.linked_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_operation_items linked
    WHERE linked.id=NEW.linked_item_id AND linked.operation_id=v_operation.id
  ) THEN RAISE EXCEPTION 'Budget operation item link is outside its root' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='month_override' AND (
    NEW.category_id IS NULL OR coalesce(NEW.action_kind,'') NOT IN ('set','remove','initialize')
    OR NEW.base_before IS NULL OR NEW.base_after IS NULL OR NEW.fallback_base_snapshot IS NULL
    OR NEW.source_kind IS NULL
  ) THEN RAISE EXCEPTION 'Invalid month_override operation item shape' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='month_close' AND (
    coalesce(NEW.action_kind,'') NOT IN ('apply','reversal') OR NEW.destination_budget_month_id IS NULL
  ) THEN RAISE EXCEPTION 'Invalid month_close operation item shape' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='carryover' AND NEW.category_id IS NOT NULL AND (
    NEW.source_budget_id IS NULL OR NEW.destination_budget_id IS NULL OR NEW.amount IS NULL OR NEW.amount<=0
    OR NEW.raw_actual_snapshot IS NULL OR NEW.funded_before IS NULL
  ) THEN RAISE EXCEPTION 'Invalid carryover operation item shape' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='carryover' AND NEW.category_id IS NULL AND (
    NEW.action_kind IS DISTINCT FROM 'apply' OR NEW.destination_budget_month_id IS NULL
  ) THEN RAISE EXCEPTION 'Invalid carryover summary item shape' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='unused_disposition' AND (
    NEW.category_id IS NULL OR NEW.source_budget_id IS NULL OR NEW.amount IS NULL OR NEW.amount<=0
    OR coalesce(NEW.policy,'') NOT IN ('carry_forward','savings','return_to_unallocated')
    OR coalesce(NEW.action_kind,'') NOT IN ('apply','reversal') OR NEW.raw_actual_snapshot IS NULL
  ) THEN RAISE EXCEPTION 'Invalid unused_disposition operation item shape' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='allocation_leg' AND (
    NEW.linked_item_id IS NULL OR coalesce(NEW.source_kind,'') NOT IN ('category','unallocated','savings')
    OR NEW.amount IS NULL OR NEW.amount<=0 OR NEW.source_capacity_snapshot IS NULL
    OR NEW.source_capacity_snapshot<NEW.amount OR NEW.movement_id IS NULL
    OR (NEW.source_kind='category')<>(NEW.source_budget_id IS NOT NULL)
    OR (NEW.source_kind='savings')<>(NEW.savings_entry_id IS NOT NULL)
  ) THEN RAISE EXCEPTION 'Invalid allocation_leg operation item shape' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='reallocation' AND (
    coalesce(NEW.action_kind,'') NOT IN ('planned_reallocation','reversal')
    OR NEW.amount IS NULL OR NEW.amount<=0
  ) THEN RAISE EXCEPTION 'Invalid reallocation operation item shape' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='funding_action' AND (
    coalesce(NEW.action_kind,'') NOT IN ('unbudgeted_resolution','reversal')
    OR NEW.destination_budget_id IS NULL OR NEW.amount IS NULL OR NEW.amount<0
  ) THEN RAISE EXCEPTION 'Invalid funding_action operation item shape' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='deficit_resolution' AND NEW.reversed_item_id IS NULL AND (
    NEW.destination_budget_id IS NULL OR NEW.amount IS NULL OR NEW.amount<=0
    OR NEW.raw_actual_snapshot IS NULL OR NEW.funded_before IS NULL
    OR NEW.deficit_before IS NULL OR NEW.deficit_after IS NULL
  ) THEN RAISE EXCEPTION 'Invalid deficit_resolution operation item shape' USING ERRCODE='23514'; END IF;
  IF NEW.item_kind='unbudgeted_resolution' AND (
    NEW.category_id IS NULL OR NEW.destination_budget_id IS NULL
    OR coalesce(NEW.resolution_mode,'') NOT IN ('created','reactivated')
    OR NEW.raw_actual_snapshot IS NULL OR NEW.funded_before IS NULL OR NEW.funded_after IS NULL
    OR NEW.amount IS NULL OR NEW.amount<0 OR NEW.deficit_after IS NULL
  ) THEN RAISE EXCEPTION 'Invalid unbudgeted_resolution operation item shape' USING ERRCODE='23514'; END IF;
  IF NEW.reversed_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_operation_items original
    WHERE original.id=NEW.reversed_item_id AND original.reversed_item_id IS NULL
      AND original.item_kind=NEW.item_kind
      AND v_operation.reverses_operation_id=original.operation_id
  ) THEN
    RAISE EXCEPTION 'Budget operation item reversal does not match an original item' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_operation_items_validate
BEFORE INSERT OR UPDATE ON public.budget_operation_items
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_operation_item();

CREATE TRIGGER budget_operation_items_immutable
BEFORE UPDATE OR DELETE ON public.budget_operation_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_budget_history_mutation();

ALTER TABLE public.budget_operation_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.budget_operation_items FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.budget_operation_items TO service_role;

CREATE OR REPLACE FUNCTION public.budget_operation_root_id(p_operation_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
  SELECT coalesce(parent_operation_id,id)
  FROM public.budget_operations
  WHERE id=p_operation_id
$$;

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
DECLARE v_id BIGINT;
BEGIN
  PERFORM set_config('finance_tracker.creating_budget_root','on',true);
  INSERT INTO public.budget_operations(
    budget_month_id,request_key,request_fingerprint,operation_type,
    effective_date,reason,reverses_operation_id
  ) VALUES(
    p_budget_month_id,p_request_key,p_request_fingerprint,p_operation_type,
    p_effective_date,p_reason,p_reverses_operation_id
  ) RETURNING id INTO v_id;
  PERFORM set_config('finance_tracker.creating_budget_root','off',true);
  PERFORM set_config('finance_tracker.budget_root_operation_id',v_id::text,true);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.group_budget_posting_operation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_context TEXT:=current_setting('finance_tracker.budget_root_operation_id',true);
  v_original public.budget_operations%ROWTYPE;
  v_root_id BIGINT;
  v_user_key UUID;
  v_user_fingerprint TEXT;
BEGIN
  IF current_setting('finance_tracker.creating_budget_root',true)='on' THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_operation_id IS NULL AND coalesce(v_context,'')<>'' THEN
    NEW.parent_operation_id:=v_context::bigint;
    RETURN NEW;
  END IF;
  IF NEW.parent_operation_id IS NULL AND NEW.reverses_operation_id IS NOT NULL THEN
    SELECT * INTO v_original FROM public.budget_operations WHERE id=NEW.reverses_operation_id;
    IF FOUND AND v_original.parent_operation_id IS NOT NULL THEN
      v_user_key:=NEW.request_key;
      v_user_fingerprint:=NEW.request_fingerprint;
      v_root_id:=public.budget_create_action_root(
        NEW.budget_month_id,v_user_key,v_user_fingerprint,NEW.operation_type,
        NEW.effective_date,NEW.reason,v_original.parent_operation_id
      );
      NEW.parent_operation_id:=v_root_id;
      NEW.request_key:=public.budget_derived_request_key(
        v_user_key,'posting|'||NEW.budget_month_id||'|'||NEW.operation_type||'|'||NEW.reverses_operation_id
      );
      NEW.request_fingerprint:=v_user_fingerprint||'|posting|'||NEW.reverses_operation_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_operations_auto_group
BEFORE INSERT ON public.budget_operations
FOR EACH ROW EXECUTE FUNCTION public.group_budget_posting_operation();

-- Remove read objects whose definitions are tied to the feature-specific
-- physical tables. Consolidated equivalents are created below.
DROP VIEW IF EXISTS public.budget_unbudgeted_resolution_history;
DROP VIEW IF EXISTS public.budget_funding_action_history;
DROP VIEW IF EXISTS public.budget_category_funding_action_state;
DROP VIEW IF EXISTS public.budget_month_disposition_history;
DROP VIEW IF EXISTS public.budget_category_base_state;
DROP VIEW IF EXISTS public.budget_category_carryover_state;

ALTER TABLE public.budget_unbudgeted_resolution_events RENAME TO budget_retired_unbudgeted_resolution_events;
ALTER TABLE public.budget_funding_action_legs RENAME TO budget_retired_funding_action_legs;
ALTER TABLE public.budget_funding_actions RENAME TO budget_retired_funding_actions;
ALTER TABLE public.budget_unused_disposition_events RENAME TO budget_retired_unused_disposition_events;
ALTER TABLE public.budget_month_disposition_batches RENAME TO budget_retired_month_disposition_batches;
ALTER TABLE public.budget_carryover_transfers RENAME TO budget_retired_carryover_transfers;
ALTER TABLE public.budget_carryover_batches RENAME TO budget_retired_carryover_batches;
ALTER TABLE public.budget_month_override_events RENAME TO budget_retired_month_override_events;

-- These adapter views preserve the deployed RPC signatures while redirecting
-- every write to budget_operations/budget_operation_items. They are runtime
-- contract adapters, not independent sources of truth.
CREATE VIEW public.budget_carryover_batches AS
SELECT o.id,
  CASE WHEN o.operation_type='month_close'
    THEN public.budget_derived_request_key(o.request_key,'carry-forward-batch')
    ELSE o.request_key END AS request_key,
  o.request_fingerprint,
  o.budget_month_id AS source_budget_month_id,
  summary.destination_budget_month_id,
  o.created_at
FROM public.budget_operations o
JOIN public.budget_operation_items summary
  ON summary.operation_id=o.id AND summary.item_kind='carryover'
  AND summary.category_id IS NULL
WHERE o.parent_operation_id IS NULL;

CREATE VIEW public.budget_carryover_transfers AS
SELECT i.id,
  CASE WHEN i.reversed_item_id IS NULL THEN i.operation_id ELSE original.operation_id END AS batch_id,
  i.source_budget_id,i.destination_budget_id,
  i.source_operation_id,i.destination_operation_id,i.amount,
  i.funded_before AS source_final_funded_snapshot,
  i.raw_actual_snapshot AS source_raw_actual_spent_snapshot,
  greatest(i.raw_actual_snapshot,0)::numeric(18,2) AS source_effective_actual_spent_snapshot,
  i.reversed_item_id AS reverses_transfer_id,i.created_at
FROM public.budget_operation_items i
LEFT JOIN public.budget_operation_items original ON original.id=i.reversed_item_id
WHERE i.item_kind='carryover' AND i.category_id IS NOT NULL;

CREATE VIEW public.budget_month_override_events AS
SELECT i.id,o.request_key,o.request_fingerprint,i.budget_month_id,i.category_id,
  coalesce(i.destination_budget_id,i.source_budget_id) AS budget_id,
  CASE WHEN EXISTS(
    SELECT 1 FROM public.budget_movements m WHERE m.operation_id=o.id
  ) OR EXISTS(
    SELECT 1 FROM public.budget_lifecycle_events le WHERE le.operation_id=o.id
  ) THEN o.id END AS financial_operation_id,
  i.action_kind AS action,
  CASE WHEN i.action_kind='remove' THEN NULL ELSE i.amount END AS requested_override_amount,
  i.base_before AS previous_effective_base,i.base_after AS resulting_effective_base,
  i.fallback_base_snapshot,i.source_kind AS fallback_source,
  (i.base_after-i.base_before)::numeric(18,2) AS applied_base_delta,
  i.reversed_item_id AS reverses_event_id,i.created_at
FROM public.budget_operation_items i
JOIN public.budget_operations o ON o.id=i.operation_id
WHERE i.item_kind='month_override';

CREATE VIEW public.budget_month_disposition_batches AS
SELECT o.id,o.request_key,o.request_fingerprint,o.budget_month_id AS source_budget_month_id,
  i.destination_budget_month_id,reversed.operation_id AS reverses_batch_id,o.created_at
FROM public.budget_operations o
JOIN public.budget_operation_items i
  ON i.operation_id=o.id AND i.item_kind='month_close'
LEFT JOIN public.budget_operation_items reversed ON reversed.id=i.reversed_item_id
WHERE o.parent_operation_id IS NULL;

CREATE VIEW public.budget_unused_disposition_events AS
SELECT i.id,i.operation_id AS batch_id,i.category_id,i.source_budget_id,
  i.action_kind AS event_kind,i.policy,i.amount,
  i.funded_before AS source_final_funded_snapshot,i.raw_actual_snapshot AS source_raw_actual_snapshot,
  greatest(i.raw_actual_snapshot,0)::numeric(18,2) AS source_effective_actual_snapshot,
  i.source_operation_id,i.destination_operation_id,
  CASE WHEN i.policy='carry_forward' THEN i.linked_item_id END AS carryover_transfer_id,
  i.savings_entry_id,i.reversed_item_id AS reverses_event_id,i.created_at
FROM public.budget_operation_items i
WHERE i.item_kind='unused_disposition';

CREATE VIEW public.budget_funding_actions AS
SELECT i.id,i.operation_id,
  CASE
    WHEN i.reversed_item_id IS NOT NULL THEN 'reversal'
    WHEN i.item_kind='reallocation' THEN 'planned_reallocation'
    WHEN i.item_kind='deficit_resolution' THEN 'deficit_resolution'
    ELSE coalesce(i.action_kind,'unbudgeted_resolution')
  END AS action_kind,
  i.budget_month_id,i.destination_budget_id,
  i.amount AS requested_amount,i.amount AS applied_amount,
  i.funded_before AS destination_final_funded_snapshot,
  i.raw_actual_snapshot AS destination_raw_actual_snapshot,
  i.deficit_before,i.deficit_after,i.reversed_item_id AS reversed_action_id,i.created_at
FROM public.budget_operation_items i
WHERE i.item_kind IN ('reallocation','funding_action','deficit_resolution');

CREATE VIEW public.budget_funding_action_legs AS
SELECT i.id,i.linked_item_id AS action_id,i.source_kind,i.source_budget_id,i.amount,
  i.funded_before AS source_final_funded_snapshot,
  i.raw_actual_snapshot AS source_raw_actual_snapshot,
  CASE WHEN i.raw_actual_snapshot IS NULL THEN NULL
    ELSE greatest(i.raw_actual_snapshot,0)::numeric(18,2) END AS source_effective_actual_snapshot,
  i.source_capacity_snapshot,i.movement_id,i.savings_entry_id,i.created_at
FROM public.budget_operation_items i
WHERE i.item_kind='allocation_leg';

CREATE VIEW public.budget_unbudgeted_resolution_events AS
SELECT i.id,i.operation_id,
  (SELECT a.id FROM public.budget_funding_actions a
   WHERE a.operation_id=i.operation_id AND a.action_kind='unbudgeted_resolution'
   ORDER BY a.id LIMIT 1) AS funding_action_id,
  i.budget_month_id,i.category_id,i.destination_budget_id AS budget_id,
  i.action_kind AS event_kind,i.resolution_mode,
  i.raw_actual_snapshot,i.funded_before AS existing_funded_snapshot,
  i.amount AS applied_funding,i.funded_after AS resulting_final_funded,
  i.deficit_after AS resulting_deficit,i.reversed_item_id AS reverses_event_id,i.created_at
FROM public.budget_operation_items i
WHERE i.item_kind='unbudgeted_resolution';

CREATE OR REPLACE FUNCTION public.write_budget_carryover_batch_adapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_root BIGINT; v_effective DATE;
BEGIN
  SELECT month_start INTO v_effective FROM public.budget_months WHERE id=NEW.source_budget_month_id;
  v_root:=nullif(current_setting('finance_tracker.budget_root_operation_id',true),'')::bigint;
  IF v_root IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.budget_operations
    WHERE id=v_root AND parent_operation_id IS NULL AND operation_type='month_close'
  ) THEN
    v_root:=public.budget_create_action_root(
      NEW.source_budget_month_id,NEW.request_key,NEW.request_fingerprint,
      'carryover_out',v_effective,NULL,NULL
    );
  END IF;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id
  ) VALUES(v_root,'carryover','apply',NEW.source_budget_month_id,NEW.destination_budget_month_id);
  NEW.id:=v_root;
  NEW.created_at:=coalesce(NEW.created_at,timezone('utc'::text,now()));
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_carryover_batches_write
INSTEAD OF INSERT ON public.budget_carryover_batches
FOR EACH ROW EXECUTE FUNCTION public.write_budget_carryover_batch_adapter();

CREATE OR REPLACE FUNCTION public.write_budget_carryover_transfer_adapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_root BIGINT:=public.budget_operation_root_id(NEW.source_operation_id);
  v_category BIGINT; v_source_month BIGINT; v_destination_month BIGINT;
  v_source_movement BIGINT; v_destination_movement BIGINT;
  v_source_funding BIGINT; v_destination_funding BIGINT;
BEGIN
  SELECT category_id,budget_month_id INTO v_category,v_source_month
  FROM public.budgets WHERE id=NEW.source_budget_id;
  SELECT budget_month_id INTO v_destination_month FROM public.budgets WHERE id=NEW.destination_budget_id;
  SELECT id INTO v_source_movement FROM public.budget_movements
    WHERE operation_id=NEW.source_operation_id ORDER BY id LIMIT 1;
  SELECT id INTO v_destination_movement FROM public.budget_movements
    WHERE operation_id=NEW.destination_operation_id ORDER BY id LIMIT 1;
  SELECT id INTO v_source_funding FROM public.budget_funding_entries
    WHERE operation_id=NEW.source_operation_id;
  SELECT id INTO v_destination_funding FROM public.budget_funding_entries
    WHERE operation_id=NEW.destination_operation_id;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,
    category_id,source_budget_id,destination_budget_id,source_operation_id,
    destination_operation_id,amount,raw_actual_snapshot,funded_before,
    source_movement_id,destination_movement_id,source_funding_entry_id,
    destination_funding_entry_id,reversed_item_id
  ) VALUES(
    v_root,'carryover',CASE WHEN NEW.reverses_transfer_id IS NULL THEN 'apply' ELSE 'reversal' END,
    v_source_month,v_destination_month,v_category,NEW.source_budget_id,NEW.destination_budget_id,
    NEW.source_operation_id,NEW.destination_operation_id,NEW.amount,
    NEW.source_raw_actual_spent_snapshot,NEW.source_final_funded_snapshot,
    v_source_movement,v_destination_movement,v_source_funding,v_destination_funding,
    NEW.reverses_transfer_id
  ) RETURNING id,created_at INTO NEW.id,NEW.created_at;
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_carryover_transfers_write
INSTEAD OF INSERT ON public.budget_carryover_transfers
FOR EACH ROW EXECUTE FUNCTION public.write_budget_carryover_transfer_adapter();

CREATE OR REPLACE FUNCTION public.write_budget_month_override_event_adapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_root BIGINT; v_type TEXT; v_movement BIGINT; v_lifecycle BIGINT;
BEGIN
  IF NEW.financial_operation_id IS NULL THEN
    v_type:=CASE WHEN NEW.action='remove' THEN 'monthly_override_remove' ELSE 'monthly_override_set' END;
    v_root:=public.budget_create_action_root(
      NEW.budget_month_id,NEW.request_key,NEW.request_fingerprint,v_type,
      (SELECT month_start FROM public.budget_months WHERE id=NEW.budget_month_id),NULL,NULL
    );
  ELSE
    v_root:=public.budget_operation_root_id(NEW.financial_operation_id);
  END IF;
  SELECT id INTO v_movement FROM public.budget_movements
    WHERE operation_id=NEW.financial_operation_id ORDER BY id LIMIT 1;
  SELECT id INTO v_lifecycle FROM public.budget_lifecycle_events
    WHERE operation_id=NEW.financial_operation_id AND budget_id=NEW.budget_id ORDER BY id LIMIT 1;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
    amount,base_before,base_after,fallback_base_snapshot,source_kind,movement_id,
    lifecycle_event_id,reversed_item_id
  ) VALUES(
    v_root,'month_override',NEW.action,NEW.budget_month_id,NEW.category_id,NEW.budget_id,
    NEW.requested_override_amount,NEW.previous_effective_base,NEW.resulting_effective_base,
    NEW.fallback_base_snapshot,NEW.fallback_source,v_movement,v_lifecycle,NEW.reverses_event_id
  ) RETURNING id,created_at INTO NEW.id,NEW.created_at;
  NEW.financial_operation_id:=CASE WHEN NEW.financial_operation_id IS NULL THEN v_root ELSE NEW.financial_operation_id END;
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_month_override_events_write
INSTEAD OF INSERT ON public.budget_month_override_events
FOR EACH ROW EXECUTE FUNCTION public.write_budget_month_override_event_adapter();

CREATE OR REPLACE FUNCTION public.write_budget_disposition_batch_adapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_root BIGINT; v_effective DATE; v_reversed_item BIGINT;
BEGIN
  SELECT month_start INTO v_effective FROM public.budget_months WHERE id=NEW.source_budget_month_id;
  IF NEW.reverses_batch_id IS NOT NULL THEN
    SELECT id INTO v_reversed_item FROM public.budget_operation_items
    WHERE operation_id=NEW.reverses_batch_id AND item_kind='month_close' ORDER BY id LIMIT 1;
  END IF;
  v_root:=public.budget_create_action_root(
    NEW.source_budget_month_id,NEW.request_key,NEW.request_fingerprint,
    CASE WHEN NEW.reverses_batch_id IS NULL THEN 'month_close' ELSE 'unused_disposition_reversal' END,
    v_effective,NULL,NEW.reverses_batch_id
  );
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,reversed_item_id
  ) VALUES(
    v_root,'month_close',CASE WHEN NEW.reverses_batch_id IS NULL THEN 'apply' ELSE 'reversal' END,
    NEW.source_budget_month_id,NEW.destination_budget_month_id,v_reversed_item
  );
  NEW.id:=v_root;
  NEW.created_at:=coalesce(NEW.created_at,timezone('utc'::text,now()));
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_month_disposition_batches_write
INSTEAD OF INSERT ON public.budget_month_disposition_batches
FOR EACH ROW EXECUTE FUNCTION public.write_budget_disposition_batch_adapter();

CREATE OR REPLACE FUNCTION public.write_budget_disposition_event_adapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_category BIGINT; v_source_month BIGINT; v_destination_month BIGINT;
BEGIN
  SELECT category_id,budget_month_id INTO v_category,v_source_month
  FROM public.budgets WHERE id=NEW.source_budget_id;
  SELECT destination_budget_month_id INTO v_destination_month
  FROM public.budget_month_disposition_batches WHERE id=NEW.batch_id;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,
    category_id,source_budget_id,destination_budget_id,source_operation_id,
    destination_operation_id,policy,amount,raw_actual_snapshot,funded_before,
    savings_entry_id,linked_item_id,reversed_item_id
  ) VALUES(
    NEW.batch_id,'unused_disposition',NEW.event_kind,v_source_month,v_destination_month,
    v_category,NEW.source_budget_id,
    CASE WHEN NEW.destination_operation_id IS NULL THEN NULL ELSE (
      SELECT coalesce(m.destination_budget_id,m.source_budget_id)
      FROM public.budget_movements m WHERE m.operation_id=NEW.destination_operation_id
      ORDER BY m.id LIMIT 1
    ) END,
    NEW.source_operation_id,NEW.destination_operation_id,NEW.policy,NEW.amount,
    NEW.source_raw_actual_snapshot,NEW.source_final_funded_snapshot,
    NEW.savings_entry_id,NEW.carryover_transfer_id,NEW.reverses_event_id
  ) RETURNING id,created_at INTO NEW.id,NEW.created_at;
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_unused_disposition_events_write
INSTEAD OF INSERT ON public.budget_unused_disposition_events
FOR EACH ROW EXECUTE FUNCTION public.write_budget_disposition_event_adapter();

CREATE OR REPLACE FUNCTION public.write_budget_funding_action_adapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_kind TEXT; v_root BIGINT:=public.budget_operation_root_id(NEW.operation_id);
BEGIN
  IF NEW.action_kind='reversal' THEN
    SELECT item_kind INTO v_kind FROM public.budget_operation_items WHERE id=NEW.reversed_action_id;
  ELSE
    v_kind:=CASE NEW.action_kind
      WHEN 'planned_reallocation' THEN 'reallocation'
      WHEN 'deficit_resolution' THEN 'deficit_resolution'
      ELSE 'funding_action' END;
  END IF;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,destination_budget_id,
    amount,funded_before,raw_actual_snapshot,deficit_before,deficit_after,reversed_item_id
  ) VALUES(
    v_root,v_kind,NEW.action_kind,NEW.budget_month_id,NEW.destination_budget_id,
    NEW.applied_amount,NEW.destination_final_funded_snapshot,
    NEW.destination_raw_actual_snapshot,NEW.deficit_before,NEW.deficit_after,
    NEW.reversed_action_id
  ) RETURNING id,created_at INTO NEW.id,NEW.created_at;
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_funding_actions_write
INSTEAD OF INSERT ON public.budget_funding_actions
FOR EACH ROW EXECUTE FUNCTION public.write_budget_funding_action_adapter();

CREATE OR REPLACE FUNCTION public.write_budget_funding_action_leg_adapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_root BIGINT; v_destination BIGINT;
BEGIN
  SELECT operation_id,destination_budget_id INTO v_root,v_destination
  FROM public.budget_funding_actions WHERE id=NEW.action_id;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,source_kind,source_budget_id,
    destination_budget_id,amount,funded_before,raw_actual_snapshot,
    source_capacity_snapshot,movement_id,savings_entry_id,linked_item_id
  ) VALUES(
    v_root,'allocation_leg','apply',
    (SELECT budget_month_id FROM public.budget_operations WHERE id=v_root),
    NEW.source_kind,NEW.source_budget_id,v_destination,NEW.amount,
    NEW.source_final_funded_snapshot,NEW.source_raw_actual_snapshot,
    NEW.source_capacity_snapshot,NEW.movement_id,NEW.savings_entry_id,NEW.action_id
  ) RETURNING id,created_at INTO NEW.id,NEW.created_at;
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_funding_action_legs_write
INSTEAD OF INSERT ON public.budget_funding_action_legs
FOR EACH ROW EXECUTE FUNCTION public.write_budget_funding_action_leg_adapter();

CREATE OR REPLACE FUNCTION public.write_budget_unbudgeted_event_adapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_root BIGINT:=public.budget_operation_root_id(NEW.operation_id); v_lifecycle BIGINT;
BEGIN
  SELECT id INTO v_lifecycle FROM public.budget_lifecycle_events
  WHERE operation_id=NEW.operation_id AND budget_id=NEW.budget_id ORDER BY id LIMIT 1;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
    resolution_mode,raw_actual_snapshot,funded_before,amount,funded_after,deficit_after,
    lifecycle_event_id,linked_item_id,reversed_item_id
  ) VALUES(
    v_root,'unbudgeted_resolution',NEW.event_kind,NEW.budget_month_id,NEW.category_id,
    NEW.budget_id,NEW.resolution_mode,NEW.raw_actual_snapshot,NEW.existing_funded_snapshot,
    NEW.applied_funding,NEW.resulting_final_funded,NEW.resulting_deficit,
    v_lifecycle,NEW.funding_action_id,NEW.reverses_event_id
  ) RETURNING id,created_at INTO NEW.id,NEW.created_at;
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_unbudgeted_resolution_events_write
INSTEAD OF INSERT ON public.budget_unbudgeted_resolution_events
FOR EACH ROW EXECUTE FUNCTION public.write_budget_unbudgeted_event_adapter();

CREATE VIEW public.budget_category_composition AS
WITH movement_classification AS (
  SELECT m.id,m.operation_id,m.source_budget_id,m.destination_budget_id,m.amount,
    coalesce(classified.component,'other') AS component,
    classified.semantic_role,classified.semantic_source_budget_id,
    classified.semantic_destination_budget_id,coalesce(classified.semantic_sign,1) AS semantic_sign
  FROM public.budget_movements m
  LEFT JOIN LATERAL (
    SELECT CASE
      WHEN i.item_kind='month_override' THEN 'override'
      WHEN i.item_kind='carryover' THEN 'carryover'
      WHEN i.item_kind='unused_disposition' AND i.policy='carry_forward' THEN 'carryover'
      WHEN i.item_kind='unused_disposition' THEN 'unused_disposition'
      WHEN i.item_kind='allocation_leg' AND root.operation_type IN (
        'unbudgeted_resolution','unbudgeted_resolution_reversal'
      ) THEN 'unbudgeted_resolution'
      WHEN i.item_kind='allocation_leg' THEN 'reallocation_resolution'
      ELSE NULL END AS component,
      CASE WHEN i.item_kind IN ('carryover','unused_disposition')
        THEN CASE WHEN m.operation_id=i.source_operation_id THEN 'source'
                  WHEN m.operation_id=i.destination_operation_id THEN 'destination' END END AS semantic_role,
      CASE WHEN i.item_kind IN ('carryover','unused_disposition') THEN i.source_budget_id END
        AS semantic_source_budget_id,
      CASE WHEN i.item_kind IN ('carryover','unused_disposition') THEN i.destination_budget_id END
        AS semantic_destination_budget_id,
      CASE WHEN i.item_kind IN ('carryover','unused_disposition') AND i.reversed_item_id IS NOT NULL
        THEN -1 ELSE 1 END AS semantic_sign
    FROM public.budget_operation_items i
    JOIN public.budget_operations root ON root.id=i.operation_id
    WHERE i.movement_id=m.id OR i.source_movement_id=m.id OR i.destination_movement_id=m.id
      OR (i.item_kind IN ('carryover','unused_disposition')
          AND m.operation_id IN (i.source_operation_id,i.destination_operation_id))
    ORDER BY CASE i.item_kind WHEN 'carryover' THEN 1 WHEN 'unused_disposition' THEN 2 ELSE 3 END,i.id
    LIMIT 1
  ) classified ON true
), movement_totals AS (
  SELECT b.id AS budget_id,
    coalesce(sum(CASE WHEN mc.destination_budget_id=b.id AND mc.component='override' THEN mc.amount
                      WHEN mc.source_budget_id=b.id AND mc.component='override' THEN -mc.amount ELSE 0 END),0)::numeric(18,2) AS override_adjustment,
    coalesce(sum(CASE WHEN mc.semantic_destination_budget_id=b.id AND mc.component='carryover'
      AND mc.semantic_role='destination' THEN mc.amount*mc.semantic_sign ELSE 0 END),0)::numeric(18,2) AS incoming_carryover,
    coalesce(sum(CASE WHEN mc.semantic_source_budget_id=b.id AND mc.component='carryover'
      AND mc.semantic_role='source' THEN mc.amount*mc.semantic_sign ELSE 0 END),0)::numeric(18,2) AS outgoing_carryover,
    coalesce(sum(CASE WHEN mc.destination_budget_id=b.id AND mc.component='reallocation_resolution' THEN mc.amount ELSE 0 END),0)::numeric(18,2) AS incoming_reallocation_resolution,
    coalesce(sum(CASE WHEN mc.source_budget_id=b.id AND mc.component='reallocation_resolution' THEN mc.amount ELSE 0 END),0)::numeric(18,2) AS outgoing_reallocation,
    coalesce(sum(CASE WHEN mc.destination_budget_id=b.id AND mc.component='unbudgeted_resolution' THEN mc.amount
                      WHEN mc.source_budget_id=b.id AND mc.component='unbudgeted_resolution' THEN -mc.amount ELSE 0 END),0)::numeric(18,2) AS unbudgeted_resolution_adjustment,
    coalesce(sum(CASE WHEN mc.semantic_destination_budget_id=b.id AND mc.component='unused_disposition'
        AND mc.semantic_role='destination' THEN mc.amount*mc.semantic_sign
                      WHEN mc.semantic_source_budget_id=b.id AND mc.component='unused_disposition'
        AND mc.semantic_role='source' THEN -mc.amount*mc.semantic_sign ELSE 0 END),0)::numeric(18,2) AS unused_disposition_adjustment,
    coalesce(sum(CASE WHEN mc.destination_budget_id=b.id AND mc.component='other' THEN mc.amount
                      WHEN mc.source_budget_id=b.id AND mc.component='other' THEN -mc.amount ELSE 0 END),0)::numeric(18,2) AS other_adjustment
  FROM public.budgets b
  LEFT JOIN movement_classification mc
    ON mc.source_budget_id=b.id OR mc.destination_budget_id=b.id
  GROUP BY b.id
), initialized_override AS (
  SELECT DISTINCT ON (coalesce(i.destination_budget_id,i.source_budget_id))
    coalesce(i.destination_budget_id,i.source_budget_id) AS budget_id,
    i.fallback_base_snapshot,i.source_kind AS fallback_source
  FROM public.budget_operation_items i
  WHERE i.item_kind='month_override' AND i.action_kind='initialize'
    AND coalesce(i.destination_budget_id,i.source_budget_id) IS NOT NULL
  ORDER BY coalesce(i.destination_budget_id,i.source_budget_id),i.id
), actuals AS (
  SELECT bm.id AS budget_month_id,t.category_id,
    sum(t.total_amount)::numeric(18,2) AS actual_spent
  FROM public.budget_months bm
  JOIN public.transactions t
    ON t.movement_type='expense' AND t.transaction_date>=bm.month_start
   AND t.transaction_date<(bm.month_start+interval '1 month')::date
  GROUP BY bm.id,t.category_id
)
SELECT cs.budget_id,cs.budget_month_id,cs.month,cs.month_start,cs.category_id,
  cs.starting_amount AS opening_base,cs.starting_kind,
  CASE WHEN cs.starting_kind='monthly_override'
    THEN coalesce(init.fallback_base_snapshot,0) ELSE cs.starting_amount END::numeric(18,2) AS fallback_base,
  CASE WHEN cs.starting_kind='monthly_override'
    THEN coalesce(init.fallback_source,'none') ELSE cs.starting_kind END AS fallback_source,
  rd.amount AS recurring_default,mo.amount AS current_override,
  mt.override_adjustment AS override_adjustment_total,
  (cs.starting_amount+mt.override_adjustment)::numeric(18,2) AS effective_base,
  mt.incoming_carryover,mt.outgoing_carryover,
  mt.incoming_reallocation_resolution,mt.outgoing_reallocation,
  mt.unbudgeted_resolution_adjustment,
  greatest(mt.unbudgeted_resolution_adjustment,0)::numeric(18,2) AS incoming_unbudgeted_resolution,
  greatest(-mt.unbudgeted_resolution_adjustment,0)::numeric(18,2) AS outgoing_unbudgeted_resolution,
  mt.unused_disposition_adjustment,mt.other_adjustment AS other_adjustments,
  cs.final_funded,coalesce(a.actual_spent,0)::numeric(18,2) AS actual_spent,
  (cs.final_funded-coalesce(a.actual_spent,0))::numeric(18,2) AS remaining,
  greatest(coalesce(a.actual_spent,0)-cs.final_funded,0)::numeric(18,2) AS deficit,
  cs.lifecycle_state,p.policy AS unused_balance_policy
FROM public.budget_category_state cs
JOIN movement_totals mt ON mt.budget_id=cs.budget_id
LEFT JOIN initialized_override init ON init.budget_id=cs.budget_id
LEFT JOIN public.budget_recurring_defaults rd ON rd.category_id=cs.category_id
LEFT JOIN public.budget_month_overrides mo
  ON mo.budget_month_id=cs.budget_month_id AND mo.category_id=cs.category_id
LEFT JOIN public.budget_unused_balance_policies p ON p.category_id=cs.category_id
LEFT JOIN actuals a ON a.budget_month_id=cs.budget_month_id AND a.category_id=cs.category_id;

CREATE VIEW public.budget_category_carryover_state AS
SELECT budget_id,incoming_carryover,outgoing_carryover
FROM public.budget_category_composition;

CREATE VIEW public.budget_category_base_state AS
SELECT budget_id,budget_month_id,month,month_start,category_id,
  fallback_base,fallback_source,current_override,override_adjustment_total,
  effective_base,incoming_carryover,outgoing_carryover,
  (
    incoming_reallocation_resolution-outgoing_reallocation
    +unbudgeted_resolution_adjustment+unused_disposition_adjustment+other_adjustments
  )::numeric(18,2) AS other_adjustments,
  final_funded,lifecycle_state
FROM public.budget_category_composition;

CREATE VIEW public.budget_category_funding_action_state AS
SELECT budget_id,incoming_reallocation_resolution,outgoing_reallocation,
  (incoming_reallocation_resolution-outgoing_reallocation)::numeric(18,2)
    AS net_funding_action_adjustment,
  incoming_unbudgeted_resolution,outgoing_unbudgeted_resolution
FROM public.budget_category_composition;

CREATE VIEW public.budget_operation_history AS
SELECT o.id AS operation_id,coalesce(o.parent_operation_id,o.id) AS root_operation_id,
  o.parent_operation_id,o.budget_month_id,to_char(bm.month_start,'YYYY-MM') AS month,
  o.request_key,o.request_fingerprint,o.operation_type,o.effective_date,o.reason,
  o.reverses_operation_id,o.created_at,
  coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
    FROM public.budget_operation_items i
    WHERE i.operation_id=coalesce(o.parent_operation_id,o.id)),'[]'::jsonb) AS items
FROM public.budget_operations o
JOIN public.budget_months bm ON bm.id=o.budget_month_id;

ALTER FUNCTION public.budget_assert_reconciled(BIGINT)
  RENAME TO budget_assert_reconciled_ledger;

CREATE OR REPLACE FUNCTION public.budget_assert_reconciled(p_budget_month_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  PERFORM public.budget_assert_reconciled_ledger(p_budget_month_id);
  IF EXISTS(
    SELECT 1 FROM public.budget_category_composition c
    WHERE c.budget_month_id=p_budget_month_id
      AND c.final_funded IS DISTINCT FROM (
        c.effective_base+c.incoming_carryover-c.outgoing_carryover
        +c.incoming_reallocation_resolution-c.outgoing_reallocation
        +c.unbudgeted_resolution_adjustment+c.unused_disposition_adjustment
        +c.other_adjustments
      )::numeric(18,2)
  ) THEN
    RAISE EXCEPTION 'Funded budget composition does not equal authoritative final funding'
      USING ERRCODE='23514';
  END IF;
END;
$$;

-- PL/pgSQL resolves relation names lazily, but %ROWTYPE declarations retain a
-- relation-type dependency once compiled. Replacing the deployed functions
-- after the adapter views exist binds those declarations to the consolidated
-- read contracts before the empty physical tables are removed.
DO $$
DECLARE v_function RECORD; v_definition TEXT;
BEGIN
  FOR v_function IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.prokind='f'
      AND p.proname NOT LIKE 'write_budget_%_adapter'
      AND (
        p.prosrc LIKE '%budget_carryover_batches%'
        OR p.prosrc LIKE '%budget_carryover_transfers%'
        OR p.prosrc LIKE '%budget_month_override_events%'
        OR p.prosrc LIKE '%budget_month_disposition_batches%'
        OR p.prosrc LIKE '%budget_unused_disposition_events%'
        OR p.prosrc LIKE '%budget_funding_actions%'
        OR p.prosrc LIKE '%budget_funding_action_legs%'
        OR p.prosrc LIKE '%budget_unbudgeted_resolution_events%'
      )
  LOOP
    v_definition:=pg_get_functiondef(v_function.oid);
    EXECUTE v_definition;
  END LOOP;
END;
$$;

DROP TABLE public.budget_retired_unbudgeted_resolution_events;
DROP TABLE public.budget_retired_funding_action_legs;
DROP TABLE public.budget_retired_funding_actions;
DROP TABLE public.budget_retired_unused_disposition_events;
DROP TABLE public.budget_retired_month_disposition_batches;
DROP TABLE public.budget_retired_carryover_transfers;
DROP TABLE public.budget_retired_carryover_batches;
DROP TABLE public.budget_retired_month_override_events;

DROP FUNCTION IF EXISTS public.validate_budget_unbudgeted_resolution_event();
DROP FUNCTION IF EXISTS public.validate_budget_funding_action_leg();
DROP FUNCTION IF EXISTS public.validate_budget_funding_action();
DROP FUNCTION IF EXISTS public.validate_budget_disposition_event();
DROP FUNCTION IF EXISTS public.validate_budget_disposition_batch();
DROP FUNCTION IF EXISTS public.validate_budget_carryover_transfer_insert();
DROP FUNCTION IF EXISTS public.validate_budget_carryover_batch_insert();
DROP FUNCTION IF EXISTS public.validate_budget_month_override_event();

CREATE OR REPLACE FUNCTION public.budget_action_month_lifecycle(p_month TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_current_start DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_month_id BIGINT;
BEGIN
  IF v_month_start=v_current_start THEN RETURN 'current'; END IF;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start;
  IF v_month_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.budget_operations
    WHERE budget_month_id=v_month_id AND parent_operation_id IS NULL
      AND operation_type='month_close' AND reverses_operation_id IS NULL
  ) THEN RETURN 'closed'; END IF;
  IF v_month_start=(v_current_start-interval '1 month')::date THEN
    RETURN 'immediately_completed_unclosed';
  END IF;
  IF v_month_start<v_current_start THEN RETURN 'historical_forbidden'; END IF;
  RETURN 'future_forbidden';
END; $$;

CREATE OR REPLACE FUNCTION public.get_funded_budget_month(p_month TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_month_id BIGINT;
  v_funding JSONB; v_categories JSONB; v_history JSONB;
  v_carryover_history JSONB; v_disposition_history JSONB;
  v_action_history JSONB; v_resolution_history JSONB;
  v_total_actual NUMERIC(18,2); v_budgeted_actual NUMERIC(18,2);
BEGIN
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start;
  IF EXISTS(
    SELECT 1 FROM public.transactions
    WHERE movement_type='expense' AND transaction_date>=v_month_start
      AND transaction_date<(v_month_start+interval '1 month')::date
      AND total_amount::text IN ('NaN','Infinity','-Infinity')
  ) THEN
    RAISE EXCEPTION 'Budget actual spending contains a non-finite amount' USING ERRCODE='22003';
  END IF;

  SELECT jsonb_build_object(
    'available',coalesce(s.available,0)::numeric(18,2)::text,
    'starting_total',coalesce(s.starting_total,0)::numeric(18,2)::text,
    'total_allocated',coalesce(s.total_allocated,0)::numeric(18,2)::text,
    'active_allocated',coalesce(s.active_allocated,0)::numeric(18,2)::text,
    'inactive_retained_funding',coalesce(s.inactive_retained_funding,0)::numeric(18,2)::text,
    'unallocated',coalesce(s.unallocated,0)::numeric(18,2)::text
  ) INTO v_funding
  FROM (SELECT 1) seed
  LEFT JOIN public.budget_month_funding_state s ON s.budget_month_id=v_month_id;

  WITH actuals AS (
    SELECT category_id,sum(total_amount)::numeric(18,2) AS actual_spent
    FROM public.transactions
    WHERE movement_type='expense' AND transaction_date>=v_month_start
      AND transaction_date<(v_month_start+interval '1 month')::date
    GROUP BY category_id
  ), keys AS (
    SELECT category_id FROM public.budget_category_composition WHERE budget_month_id=v_month_id
    UNION SELECT category_id FROM actuals
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'budget_id',c.budget_id,'category_id',keys.category_id,
    'categories',CASE WHEN keys.category_id IS NULL THEN NULL ELSE jsonb_build_object(
      'name',cat.name,'icon',cat.icon,'type',cat.type) END,
    'lifecycle_state',coalesce(c.lifecycle_state,'no_budget'),
    'is_active_budget',coalesce(c.lifecycle_state='active',false),
    'is_active_zero',coalesce(c.lifecycle_state='active' AND c.final_funded=0,false),
    'is_unbudgeted',coalesce(c.lifecycle_state<>'active',true),
    'starting_amount',CASE WHEN c.opening_base IS NULL THEN NULL ELSE c.opening_base::text END,
    'starting_kind',c.starting_kind,
    'adjustment_total',CASE WHEN c.budget_id IS NULL THEN '0.00' ELSE
      (c.final_funded-c.opening_base)::numeric(18,2)::text END,
    'fallback_base',CASE WHEN c.budget_id IS NULL THEN NULL ELSE c.fallback_base::text END,
    'fallback_source',c.fallback_source,
    'recurring_default',CASE WHEN rd.amount IS NULL THEN NULL ELSE rd.amount::numeric(18,2)::text END,
    'month_override',CASE WHEN c.current_override IS NULL THEN NULL ELSE c.current_override::text END,
    'override_adjustment_total',coalesce(c.override_adjustment_total,0)::numeric(18,2)::text,
    'effective_base',CASE WHEN c.budget_id IS NULL THEN NULL ELSE c.effective_base::text END,
    'incoming_carryover',coalesce(c.incoming_carryover,0)::numeric(18,2)::text,
    'outgoing_carryover',coalesce(c.outgoing_carryover,0)::numeric(18,2)::text,
    'incoming_reallocation_resolution',coalesce(c.incoming_reallocation_resolution,0)::numeric(18,2)::text,
    'outgoing_reallocation',coalesce(c.outgoing_reallocation,0)::numeric(18,2)::text,
    'incoming_unbudgeted_resolution',coalesce(c.incoming_unbudgeted_resolution,0)::numeric(18,2)::text,
    'outgoing_unbudgeted_resolution',coalesce(c.outgoing_unbudgeted_resolution,0)::numeric(18,2)::text,
    'funding_action_adjustment_total',(
      coalesce(c.incoming_reallocation_resolution,0)-coalesce(c.outgoing_reallocation,0)
    )::numeric(18,2)::text,
    'unused_disposition_adjustment',coalesce(c.unused_disposition_adjustment,0)::numeric(18,2)::text,
    'other_adjustments',coalesce(c.other_adjustments,0)::numeric(18,2)::text,
    'unused_balance_policy',p.policy,
    'final_funded',CASE WHEN c.final_funded IS NULL THEN NULL ELSE c.final_funded::text END,
    'amount',CASE WHEN c.final_funded IS NULL THEN NULL ELSE c.final_funded::text END,
    'actual_spent',coalesce(a.actual_spent,0)::numeric(18,2)::text,
    'remaining',CASE WHEN c.lifecycle_state='active'
      THEN (c.final_funded-coalesce(a.actual_spent,0))::numeric(18,2)::text ELSE NULL END,
    'deficit',CASE WHEN c.lifecycle_state='active'
      THEN greatest(coalesce(a.actual_spent,0)-c.final_funded,0)::numeric(18,2)::text ELSE '0.00' END
  ) ORDER BY coalesce(cat.name,''),keys.category_id),'[]'::jsonb) INTO v_categories
  FROM keys
  LEFT JOIN public.budget_category_composition c
    ON c.budget_month_id=v_month_id AND c.category_id IS NOT DISTINCT FROM keys.category_id
  LEFT JOIN actuals a ON a.category_id IS NOT DISTINCT FROM keys.category_id
  LEFT JOIN public.categories cat ON cat.id=keys.category_id
  LEFT JOIN public.budget_recurring_defaults rd ON rd.category_id=keys.category_id
  LEFT JOIN public.budget_unused_balance_policies p ON p.category_id=keys.category_id;

  SELECT coalesce(sum(total_amount),0)::numeric(18,2) INTO v_total_actual
  FROM public.transactions WHERE movement_type='expense'
    AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date;
  SELECT coalesce(sum(t.total_amount),0)::numeric(18,2) INTO v_budgeted_actual
  FROM public.transactions t
  WHERE t.movement_type='expense' AND t.transaction_date>=v_month_start
    AND t.transaction_date<(v_month_start+interval '1 month')::date
    AND EXISTS(SELECT 1 FROM public.budget_category_composition c
      WHERE c.budget_month_id=v_month_id AND c.lifecycle_state='active' AND c.category_id=t.category_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'parent_operation_id',o.parent_operation_id,
    'root_operation_id',coalesce(o.parent_operation_id,o.id),
    'operation_type',o.operation_type,'effective_date',o.effective_date,
    'created_at',o.created_at,'reason',o.reason,'reverses_operation_id',o.reverses_operation_id,
    'funding_entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',fe.id,'amount_delta',fe.amount_delta::numeric(18,2)::text,
      'source_kind',fe.source_kind,'source_label',fe.source_label,
      'reverses_funding_entry_id',fe.reverses_funding_entry_id) ORDER BY fe.id)
      FROM public.budget_funding_entries fe WHERE fe.operation_id=o.id),'[]'::jsonb),
    'movements',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',m.id,'source_budget_id',m.source_budget_id,
      'destination_budget_id',m.destination_budget_id,'amount',m.amount::numeric(18,2)::text
      ) ORDER BY m.id) FROM public.budget_movements m WHERE m.operation_id=o.id),'[]'::jsonb),
    'lifecycle_events',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',le.id,'budget_id',le.budget_id,'state',le.state,
      'actual_spent_snapshot',CASE WHEN le.actual_spent_snapshot IS NULL THEN NULL
        ELSE le.actual_spent_snapshot::numeric(18,2)::text END) ORDER BY le.id)
      FROM public.budget_lifecycle_events le WHERE le.operation_id=o.id),'[]'::jsonb)
  ) ORDER BY o.id),'[]'::jsonb) INTO v_history
  FROM public.budget_operations o WHERE o.budget_month_id=v_month_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'transfer_id',i.id,'batch_id',i.operation_id,
    'source_month',to_char(sm.month_start,'YYYY-MM'),
    'destination_month',to_char(dm.month_start,'YYYY-MM'),
    'category_id',i.category_id,'amount',i.amount::text,
    'source_final_funded_snapshot',i.funded_before::text,
    'source_raw_actual_spent_snapshot',i.raw_actual_snapshot::text,
    'source_effective_actual_spent_snapshot',greatest(i.raw_actual_snapshot,0)::numeric(18,2)::text,
    'reverses_transfer_id',i.reversed_item_id,'created_at',i.created_at
  ) ORDER BY i.id),'[]'::jsonb) INTO v_carryover_history
  FROM public.budget_operation_items i
  JOIN public.budget_months sm ON sm.id=i.budget_month_id
  JOIN public.budget_months dm ON dm.id=i.destination_budget_month_id
  WHERE i.item_kind='carryover' AND i.category_id IS NOT NULL
    AND (i.budget_month_id=v_month_id OR i.destination_budget_month_id=v_month_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'event_id',i.id,'batch_id',i.operation_id,'event_kind',i.action_kind,'policy',i.policy,
    'category_id',i.category_id,'category_name',cat.name,'source_budget_id',i.source_budget_id,
    'source_month',to_char(sm.month_start,'YYYY-MM'),
    'destination_month',to_char(dm.month_start,'YYYY-MM'),'amount',i.amount::text,
    'source_final_funded_snapshot',i.funded_before::text,
    'source_raw_actual_snapshot',i.raw_actual_snapshot::text,
    'source_effective_actual_snapshot',greatest(i.raw_actual_snapshot,0)::numeric(18,2)::text,
    'source_operation_id',i.source_operation_id,'destination_operation_id',i.destination_operation_id,
    'carryover_transfer_id',CASE WHEN i.policy='carry_forward' THEN i.linked_item_id END,
    'savings_entry_id',i.savings_entry_id,'reverses_event_id',i.reversed_item_id,
    'created_at',i.created_at
  ) ORDER BY i.id),'[]'::jsonb) INTO v_disposition_history
  FROM public.budget_operation_items i
  JOIN public.budget_months sm ON sm.id=i.budget_month_id
  JOIN public.budget_months dm ON dm.id=i.destination_budget_month_id
  JOIN public.categories cat ON cat.id=i.category_id
  WHERE i.item_kind='unused_disposition'
    AND (i.budget_month_id=v_month_id OR i.destination_budget_month_id=v_month_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'action_id',a.id,'action_kind',CASE WHEN a.reversed_item_id IS NOT NULL THEN 'reversal'
      WHEN a.item_kind='reallocation' THEN 'planned_reallocation'
      WHEN a.item_kind='deficit_resolution' THEN 'deficit_resolution' ELSE a.action_kind END,
    'month',p_month,'destination_budget_id',a.destination_budget_id,
    'requested_amount',a.amount::text,'applied_amount',a.amount::text,
    'destination_final_funded_snapshot',CASE WHEN a.funded_before IS NULL THEN NULL ELSE a.funded_before::text END,
    'destination_raw_actual_snapshot',CASE WHEN a.raw_actual_snapshot IS NULL THEN NULL ELSE a.raw_actual_snapshot::text END,
    'deficit_before',CASE WHEN a.deficit_before IS NULL THEN NULL ELSE a.deficit_before::text END,
    'deficit_after',CASE WHEN a.deficit_after IS NULL THEN NULL ELSE a.deficit_after::text END,
    'reversed_action_id',a.reversed_item_id,'created_at',a.created_at,
    'legs',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',l.id,'source_kind',l.source_kind,'source_budget_id',l.source_budget_id,
      'amount',l.amount::text,'source_capacity_snapshot',l.source_capacity_snapshot::text,
      'source_final_funded_snapshot',CASE WHEN l.funded_before IS NULL THEN NULL ELSE l.funded_before::text END,
      'source_raw_actual_snapshot',CASE WHEN l.raw_actual_snapshot IS NULL THEN NULL ELSE l.raw_actual_snapshot::text END,
      'source_effective_actual_snapshot',CASE WHEN l.raw_actual_snapshot IS NULL THEN NULL
        ELSE greatest(l.raw_actual_snapshot,0)::numeric(18,2)::text END,
      'movement_id',l.movement_id,'savings_entry_id',l.savings_entry_id) ORDER BY l.id)
      FROM public.budget_operation_items l WHERE l.item_kind='allocation_leg' AND l.linked_item_id=a.id),'[]'::jsonb)
  ) ORDER BY a.id),'[]'::jsonb) INTO v_action_history
  FROM public.budget_operation_items a
  WHERE a.budget_month_id=v_month_id AND a.item_kind IN ('reallocation','funding_action','deficit_resolution');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'event_id',i.id,'event_kind',i.action_kind,'resolution_mode',i.resolution_mode,
    'month',p_month,'category_id',i.category_id,'budget_id',i.destination_budget_id,
    'raw_actual_snapshot',i.raw_actual_snapshot::text,
    'existing_funded_snapshot',i.funded_before::text,'applied_funding',i.amount::text,
    'resulting_final_funded',i.funded_after::text,'resulting_deficit',i.deficit_after::text,
    'funding_action_id',i.linked_item_id,'reverses_event_id',i.reversed_item_id,
    'created_at',i.created_at
  ) ORDER BY i.id),'[]'::jsonb) INTO v_resolution_history
  FROM public.budget_operation_items i
  WHERE i.item_kind='unbudgeted_resolution' AND i.budget_month_id=v_month_id;

  RETURN jsonb_build_object(
    'month',p_month,'currency','ILS','funding',v_funding,
    'actuals',jsonb_build_object('total',v_total_actual::text,'budgeted',v_budgeted_actual::text,
      'unbudgeted',(v_total_actual-v_budgeted_actual)::numeric(18,2)::text),
    'categories',v_categories,'history',v_history,
    'recurring',public.get_budget_recurring_preview(p_month),
    'carryover',public.get_budget_carryover_preview(p_month),
    'carryover_history',v_carryover_history,
    'month_overrides',public.get_budget_month_override_preview(p_month),
    'unused_disposition_history',v_disposition_history,
    'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
    'funding_action_history',v_action_history,
    'unbudgeted_resolution_history',v_resolution_history,
    'action_lifecycle',public.budget_action_month_lifecycle(p_month)
  );
END; $$;

DROP FUNCTION IF EXISTS public.get_funded_budget_month_foundation(TEXT);
DROP FUNCTION IF EXISTS public.get_funded_budget_month_recurring(TEXT);
DROP FUNCTION IF EXISTS public.get_funded_budget_month_carryover(TEXT);
DROP FUNCTION IF EXISTS public.get_funded_budget_month_overrides(TEXT);
DROP FUNCTION IF EXISTS public.get_funded_budget_month_disposition(TEXT);

REVOKE ALL ON public.budget_carryover_batches,public.budget_carryover_transfers,
  public.budget_month_override_events,public.budget_month_disposition_batches,
  public.budget_unused_disposition_events,public.budget_funding_actions,
  public.budget_funding_action_legs,public.budget_unbudgeted_resolution_events
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.budget_carryover_batches,public.budget_carryover_transfers,
  public.budget_month_override_events,public.budget_month_disposition_batches,
  public.budget_unused_disposition_events,public.budget_funding_actions,
  public.budget_funding_action_legs,public.budget_unbudgeted_resolution_events
  TO service_role;

REVOKE ALL ON public.budget_category_composition,public.budget_operation_history,
  public.budget_category_carryover_state,public.budget_category_base_state,
  public.budget_category_funding_action_state
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.budget_category_composition,public.budget_operation_history,
  public.budget_category_carryover_state,public.budget_category_base_state,
  public.budget_category_funding_action_state
  TO service_role;

REVOKE ALL ON FUNCTION public.budget_operation_root_id(BIGINT),
  public.budget_create_action_root(BIGINT,UUID,TEXT,TEXT,DATE,TEXT,BIGINT),
  public.group_budget_posting_operation(),public.validate_budget_operation_tree(),
  public.validate_budget_operation_item(),public.write_budget_carryover_batch_adapter(),
  public.write_budget_carryover_transfer_adapter(),
  public.write_budget_month_override_event_adapter(),
  public.write_budget_disposition_batch_adapter(),
  public.write_budget_disposition_event_adapter(),
  public.write_budget_funding_action_adapter(),
  public.write_budget_funding_action_leg_adapter(),
  public.write_budget_unbudgeted_event_adapter(),
  public.budget_assert_reconciled_ledger(BIGINT)
  FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.get_funded_budget_month(TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_funded_budget_month(TEXT) TO service_role;

DO $$
DECLARE v_month RECORD;
BEGIN
  IF EXISTS(SELECT 1 FROM public.budget_operation_items) THEN
    RAISE EXCEPTION 'Migration 024 must not backfill operation items';
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_operations WHERE parent_operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Migration 024 must preserve existing operations as roots';
  END IF;
  IF (
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname IN (
        'budget_months','budgets','budget_operations','budget_funding_entries',
        'budget_movements','budget_lifecycle_events','budget_savings_entries',
        'budget_recurring_defaults','budget_month_overrides',
        'budget_unused_balance_policies','budget_operation_items'
      )
  )<>11 THEN
    RAISE EXCEPTION 'Migration 024 postcondition: expected 11 physical Budget tables';
  END IF;
  IF EXISTS(
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname IN (
        'budget_carryover_batches','budget_carryover_transfers',
        'budget_month_override_events','budget_month_disposition_batches',
        'budget_unused_disposition_events','budget_funding_actions',
        'budget_funding_action_legs','budget_unbudgeted_resolution_events'
      )
  ) THEN
    RAISE EXCEPTION 'Migration 024 postcondition: legacy feature write tables remain physical';
  END IF;
  FOR v_month IN SELECT id FROM public.budget_months ORDER BY id LOOP
    PERFORM public.budget_assert_reconciled(v_month.id);
  END LOOP;
  IF coalesce((SELECT sum(amount_delta) FROM public.budget_savings_entries),0)<0 THEN
    RAISE EXCEPTION 'Migration 024 postcondition: Savings ledger is negative';
  END IF;
END;
$$;

COMMIT;
