-- Migration 027: propagate combined recurring updates to inherited future snapshots
--
-- A current-month "this month and future" command now updates existing future
-- snapshots that still follow inherited/default planning. Explicit month
-- overrides and other proven month-specific openings remain untouched. The
-- consolidated operation/item/posting model remains authoritative.

BEGIN;

DO $$
DECLARE
  v_tables INTEGER;
  v_views INTEGER;
BEGIN
  IF to_regprocedure('public.capture_budget_month_recurring_update(text,bigint,numeric)') IS NULL
     OR to_regprocedure('public.get_budget_month_and_recurring_default_preview(text,bigint,numeric)') IS NULL
     OR to_regprocedure('public.set_budget_month_and_recurring_default(text,bigint,numeric,uuid,text,text)') IS NULL
     OR to_regprocedure('public.set_budget_month_override(text,bigint,numeric,uuid,text)') IS NULL
     OR to_regprocedure('public.budget_derived_request_key(uuid,text)') IS NULL
     OR to_regclass('public.budget_operation_items') IS NULL
     OR to_regclass('public.budget_category_composition') IS NULL THEN
    RAISE EXCEPTION 'Migration 027 requires the exact deployed Migration 026 Budget foundation';
  END IF;

  SELECT count(*) INTO v_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'budget%';
  SELECT count(*) INTO v_views
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v' AND c.relname LIKE 'budget%';
  IF v_tables<>11 OR v_views<>9 THEN
    RAISE EXCEPTION 'Migration 027 expected 11 Budget tables and 9 Budget views; found % and %',
      v_tables,v_views;
  END IF;

  IF to_regprocedure('public.validate_budget_recurring_propagation_item()') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 027 found partial future-propagation state';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(ARRAY[
    'budget_carryover_batches','budget_carryover_transfers','budget_month_override_events',
    'budget_month_disposition_batches','budget_unused_disposition_events','budget_funding_actions',
    'budget_funding_action_legs','budget_unbudgeted_resolution_events'
  ]) AS retired(name) WHERE to_regclass('public.'||retired.name) IS NOT NULL) THEN
    RAISE EXCEPTION 'Migration 027 will not reintroduce a retired Budget relation';
  END IF;
END;
$$;

-- Cross-month children remain exceptional. Recurring propagation is allowed
-- only beneath a combined current-month override root, only into a later
-- month, and only with the deterministic child request key used below.
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
  v_combined_category_id BIGINT;
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

    IF v_child_month IS DISTINCT FROM v_parent_month THEN
      IF v_parent.operation_type='monthly_override_set'
         AND NEW.operation_type='monthly_override_set'
         AND v_child_month>v_parent_month THEN
        SELECT category_id INTO v_combined_category_id
        FROM public.budget_operation_items
        WHERE operation_id=v_parent.id AND item_kind='month_override'
          AND action_kind='set' AND resolution_mode='with_recurring'
        ORDER BY id LIMIT 1;
        IF v_combined_category_id IS NULL
           OR NEW.request_key IS DISTINCT FROM public.budget_derived_request_key(
             v_parent.request_key,
             'recurring-propagation|'||NEW.budget_month_id||'|'||v_combined_category_id
           ) THEN
          RAISE EXCEPTION 'Budget recurring-propagation child is not aligned with its combined root'
            USING ERRCODE='23514';
        END IF;
      ELSIF v_parent.operation_type NOT IN (
          'carryover_out','month_close','unused_disposition_reversal'
        ) OR v_child_month NOT IN (
          (v_parent_month-interval '1 month')::date,
          (v_parent_month+interval '1 month')::date
        ) THEN
        RAISE EXCEPTION 'Budget cross-month child does not match an approved cross-month action'
          USING ERRCODE='23514';
      END IF;
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

CREATE FUNCTION public.validate_budget_recurring_propagation_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  v_root public.budget_operations%ROWTYPE;
  v_posting public.budget_operations%ROWTYPE;
  v_root_month DATE;
  v_item_month DATE;
BEGIN
  IF NEW.resolution_mode IS DISTINCT FROM 'recurring_propagation' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_root FROM public.budget_operations WHERE id=NEW.operation_id;
  SELECT month_start INTO v_root_month FROM public.budget_months WHERE id=v_root.budget_month_id;
  SELECT month_start INTO v_item_month FROM public.budget_months WHERE id=NEW.budget_month_id;
  SELECT posting.* INTO v_posting
  FROM public.budget_movements movement
  JOIN public.budget_operations posting ON posting.id=movement.operation_id
  WHERE movement.id=NEW.movement_id;

  IF NEW.item_kind<>'month_override' OR NEW.action_kind<>'set'
     OR NEW.category_id IS NULL OR NEW.destination_budget_id IS NULL
     OR NEW.amount IS NULL OR NEW.base_before IS NULL OR NEW.base_after IS NULL
     OR NEW.fallback_base_snapshot IS NULL OR NEW.source_kind IS NULL
     OR NEW.movement_id IS NULL
     OR v_root.parent_operation_id IS NOT NULL OR v_root.operation_type<>'monthly_override_set'
     OR NOT EXISTS(
       SELECT 1 FROM public.budget_operation_items current_item
       WHERE current_item.operation_id=v_root.id AND current_item.item_kind='month_override'
         AND current_item.action_kind='set' AND current_item.resolution_mode='with_recurring'
     )
     OR v_item_month IS NULL OR v_item_month<=v_root_month
     OR v_posting.parent_operation_id IS DISTINCT FROM v_root.id
     OR v_posting.budget_month_id IS DISTINCT FROM NEW.budget_month_id
     OR v_posting.operation_type<>'monthly_override_set' THEN
    RAISE EXCEPTION 'Invalid recurring-propagation operation item shape'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_operation_items_recurring_propagation_validate
BEFORE INSERT OR UPDATE ON public.budget_operation_items
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_recurring_propagation_item();

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
  v_delta NUMERIC(18,2);
  v_effective_actual NUMERIC(18,2);
  v_eligible_release NUMERIC(18,2);
  v_current_change JSONB;
  v_future_months JSONB:='[]'::jsonb;
  v_future_changes JSONB:='[]'::jsonb;
  v_future_skipped JSONB:='[]'::jsonb;
  v_future_unchanged JSONB:='[]'::jsonb;
  v_blockers JSONB:='[]'::jsonb;
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

  v_delta:=p_amount::numeric(18,2)-v_composition.effective_base;
  v_effective_actual:=greatest(v_composition.actual_spent,0)::numeric(18,2);
  v_eligible_release:=least(
    greatest(v_composition.effective_base-v_effective_actual,0),
    greatest(v_composition.final_funded-v_effective_actual,0)
  )::numeric(18,2);
  v_current_change:=jsonb_build_object(
    'month',p_month,'budget_month_id',v_month_id,'budget_id',v_composition.budget_id,
    'effective_base_before',v_composition.effective_base::numeric(18,2)::text,
    'effective_base_after',p_amount::numeric(18,2)::text,
    'final_funded_before',v_composition.final_funded::numeric(18,2)::text,
    'final_funded_after',(v_composition.final_funded+v_delta)::numeric(18,2)::text,
    'raw_actual',v_composition.actual_spent::numeric(18,2)::text,
    'unallocated',v_unallocated::text,'delta',v_delta::text,
    'eligible_release',v_eligible_release::text,
    'status',CASE
      WHEN v_delta>0 AND v_delta>v_unallocated THEN 'blocked'
      WHEN v_delta<0 AND -v_delta>v_eligible_release THEN 'blocked'
      WHEN v_delta=0 THEN 'unchanged' ELSE 'will_change' END,
    'blocked_reason',CASE
      WHEN v_delta>0 AND v_delta>v_unallocated THEN 'insufficient_unallocated'
      WHEN v_delta<0 AND -v_delta>v_eligible_release THEN 'release_blocked'
      ELSE NULL END,
    'required',CASE WHEN v_delta>0 THEN v_delta ELSE -v_delta END::numeric(18,2)::text,
    'shortfall',CASE
      WHEN v_delta>0 THEN greatest(v_delta-v_unallocated,0)
      WHEN v_delta<0 THEN greatest(-v_delta-v_eligible_release,0)
      ELSE 0 END::numeric(18,2)::text
  );

  WITH future_base AS (
    SELECT composition.*,funding.unallocated,
      override_config.category_id IS NOT NULL AS has_override_config,
      latest_override.action_kind AS latest_override_action,
      latest_override.resolution_mode AS latest_override_mode
    FROM public.budget_category_composition composition
    JOIN public.budget_month_funding_state funding
      ON funding.budget_month_id=composition.budget_month_id
    LEFT JOIN public.budget_month_overrides override_config
      ON override_config.budget_month_id=composition.budget_month_id
     AND override_config.category_id=composition.category_id
    LEFT JOIN LATERAL (
      SELECT item.action_kind,item.resolution_mode
      FROM public.budget_operation_items item
      WHERE item.item_kind='month_override'
        AND item.budget_month_id=composition.budget_month_id
        AND item.category_id=composition.category_id
      ORDER BY item.id DESC LIMIT 1
    ) latest_override ON true
    WHERE composition.month_start>v_month_start
      AND composition.category_id=p_category_id
  ), calculated AS (
    SELECT future_base.*,
      (p_amount::numeric(18,2)-effective_base)::numeric(18,2) AS delta,
      greatest(actual_spent,0)::numeric(18,2) AS effective_actual,
      least(
        greatest(effective_base-greatest(actual_spent,0),0),
        greatest(final_funded-greatest(actual_spent,0),0)
      )::numeric(18,2) AS eligible_release,
      CASE
        WHEN lifecycle_state<>'active' THEN 'inactive_snapshot'
        WHEN has_override_config THEN 'explicit_month_override'
        WHEN starting_kind IN ('manual','copied','unbudgeted_resolution') THEN 'explicit_month_decision'
        WHEN latest_override_action IN ('set','initialize')
          AND latest_override_mode IS DISTINCT FROM 'recurring_propagation'
          THEN 'explicit_month_override'
        ELSE NULL
      END AS skip_reason
    FROM future_base
  ), classified AS (
    SELECT calculated.*,
      CASE
        WHEN skip_reason IS NOT NULL THEN 'skipped'
        WHEN delta>0 AND delta>unallocated THEN 'blocked'
        WHEN delta<0 AND -delta>eligible_release THEN 'blocked'
        WHEN delta=0 THEN 'unchanged'
        ELSE 'will_change'
      END AS status,
      CASE
        WHEN skip_reason IS NOT NULL THEN skip_reason
        WHEN delta>0 AND delta>unallocated THEN 'insufficient_unallocated'
        WHEN delta<0 AND -delta>eligible_release THEN 'release_blocked'
        ELSE NULL
      END AS reason
    FROM calculated
  ), shaped AS (
    SELECT month_start,jsonb_build_object(
      'month',month,'budget_month_id',budget_month_id,'budget_id',budget_id,
      'starting_kind',starting_kind,'fallback_base',fallback_base::numeric(18,2)::text,
      'fallback_source',fallback_source,
      'effective_base_before',effective_base::numeric(18,2)::text,
      'effective_base_after',CASE WHEN status='skipped' THEN effective_base ELSE p_amount END::numeric(18,2)::text,
      'final_funded_before',final_funded::numeric(18,2)::text,
      'final_funded_after',CASE WHEN status IN ('will_change','blocked')
        THEN final_funded+delta ELSE final_funded END::numeric(18,2)::text,
      'raw_actual',actual_spent::numeric(18,2)::text,
      'effective_actual',effective_actual::text,'unallocated',unallocated::numeric(18,2)::text,
      'delta',delta::text,'eligible_release',eligible_release::text,
      'status',status,'reason',reason,
      'required',CASE WHEN delta>0 THEN delta ELSE -delta END::numeric(18,2)::text,
      'shortfall',CASE
        WHEN status='blocked' AND delta>0 THEN delta-unallocated
        WHEN status='blocked' AND delta<0 THEN -delta-eligible_release
        ELSE 0 END::numeric(18,2)::text
    ) AS item
    FROM classified
  )
  SELECT coalesce(jsonb_agg(item ORDER BY month_start),'[]'::jsonb)
  INTO v_future_months FROM shaped;

  SELECT coalesce(jsonb_agg(value ORDER BY value->>'month'),'[]'::jsonb)
    INTO v_future_changes FROM jsonb_array_elements(v_future_months) value
    WHERE value->>'status'='will_change';
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'month'),'[]'::jsonb)
    INTO v_future_skipped FROM jsonb_array_elements(v_future_months) value
    WHERE value->>'status'='skipped';
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'month'),'[]'::jsonb)
    INTO v_future_unchanged FROM jsonb_array_elements(v_future_months) value
    WHERE value->>'status'='unchanged';
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'month'),'[]'::jsonb)
    INTO v_blockers FROM jsonb_array_elements(v_future_months) value
    WHERE value->>'status'='blocked';
  IF v_current_change->>'status'='blocked' THEN
    v_blockers:=jsonb_build_array(v_current_change)||v_blockers;
  END IF;

  v_material:=jsonb_build_object(
    'version',2,'month',p_month,'budget_month_id',v_month_id,
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
    'other_adjustments',v_composition.other_adjustments::numeric(18,2)::text,
    'current_month_change',v_current_change,
    'future_months_inspected',v_future_months,
    'future_months_to_change',v_future_changes,
    'future_months_skipped',v_future_skipped,
    'future_months_unchanged',v_future_unchanged,
    'blocking_months',v_blockers
  );
  v_fingerprint:=md5(v_material::text);
  RETURN v_material||jsonb_build_object(
    'fingerprint',v_fingerprint,'delta',v_delta::text,
    'resulting_recurring',p_amount::numeric(18,2)::text,
    'can_apply',jsonb_array_length(v_blockers)=0
  );
END;
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
  v_root_id BIGINT;
  v_child_id BIGINT;
  v_movement_id BIGINT;
  v_future JSONB;
  v_blocker JSONB;
  v_delta NUMERIC(18,2);
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
  LOCK TABLE public.budget_months IN SHARE MODE;
  LOCK TABLE public.budgets IN SHARE MODE;
  PERFORM 1 FROM public.budget_months
    WHERE month_start>=v_month_start ORDER BY month_start,id FOR UPDATE;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start;
  IF v_month_id IS NULL THEN
    RAISE EXCEPTION 'Combined Budget update requires an initialized current month'
      USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.budgets b
    JOIN public.budget_months bm ON bm.id=b.budget_month_id
    WHERE bm.month_start>=v_month_start ORDER BY b.id FOR UPDATE OF b;
  PERFORM 1 FROM public.categories WHERE id=p_category_id FOR UPDATE;
  PERFORM 1 FROM public.budget_recurring_defaults WHERE category_id=p_category_id FOR UPDATE;
  PERFORM 1 FROM public.budget_month_overrides override_config
    JOIN public.budget_months bm ON bm.id=override_config.budget_month_id
    WHERE override_config.category_id=p_category_id AND bm.month_start>=v_month_start
    ORDER BY override_config.budget_month_id FOR UPDATE OF override_config;

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
    RAISE EXCEPTION 'BUDGET_MONTH_RECURRING_PREVIEW_STALE: current or future month state or recurring configuration changed; refresh and review again'
      USING ERRCODE='40001';
  END IF;
  IF jsonb_array_length(v_material->'blocking_months')>0 THEN
    v_blocker:=(v_material->'blocking_months')->0;
    IF coalesce(v_blocker->>'reason',v_blocker->>'blocked_reason')='insufficient_unallocated' THEN
      RAISE EXCEPTION 'MONTH_OVERRIDE_INSUFFICIENT_FUNDS: month %, required %, available %, shortfall %',
        v_blocker->>'month',v_blocker->>'required',v_blocker->>'unallocated',v_blocker->>'shortfall'
        USING ERRCODE='23514';
    END IF;
    RAISE EXCEPTION 'MONTH_OVERRIDE_RELEASE_BLOCKED: month %, requested release %, eligible release %, shortfall %',
      v_blocker->>'month',v_blocker->>'required',v_blocker->>'eligible_release',v_blocker->>'shortfall'
      USING ERRCODE='23514';
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
  SELECT id INTO v_root_id FROM public.budget_operations WHERE request_key=p_request_key;

  FOR v_future IN SELECT value FROM jsonb_array_elements(v_material->'future_months_to_change') value LOOP
    v_delta:=(v_future->>'delta')::numeric(18,2);
    INSERT INTO public.budget_operations(
      budget_month_id,parent_operation_id,request_key,request_fingerprint,
      operation_type,effective_date,reason
    ) VALUES(
      (v_future->>'budget_month_id')::bigint,v_root_id,
      public.budget_derived_request_key(
        p_request_key,'recurring-propagation|'||(v_future->>'budget_month_id')||'|'||p_category_id
      ),
      p_preview_fingerprint||'|recurring-propagation|'||(v_future->>'month'),
      'monthly_override_set',public.budget_month_start_from_key(v_future->>'month'),p_reason
    ) RETURNING id INTO v_child_id;

    INSERT INTO public.budget_movements(
      operation_id,source_budget_id,destination_budget_id,amount
    ) VALUES(
      v_child_id,
      CASE WHEN v_delta<0 THEN (v_future->>'budget_id')::bigint END,
      CASE WHEN v_delta>0 THEN (v_future->>'budget_id')::bigint END,
      abs(v_delta)
    ) RETURNING id INTO v_movement_id;

    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
      amount,raw_actual_snapshot,source_capacity_snapshot,funded_before,funded_after,
      base_before,base_after,fallback_base_snapshot,source_kind,resolution_mode,movement_id
    ) VALUES(
      v_root_id,'month_override','set',(v_future->>'budget_month_id')::bigint,p_category_id,
      (v_future->>'budget_id')::bigint,p_amount::numeric(18,2),
      (v_future->>'raw_actual')::numeric(18,2),
      CASE WHEN v_delta<0 THEN (v_future->>'eligible_release')::numeric(18,2)
           ELSE (v_future->>'unallocated')::numeric(18,2) END,
      (v_future->>'final_funded_before')::numeric(18,2),
      (v_future->>'final_funded_after')::numeric(18,2),
      (v_future->>'effective_base_before')::numeric(18,2),p_amount::numeric(18,2),
      (v_future->>'fallback_base')::numeric(18,2),v_future->>'fallback_source',
      'recurring_propagation',v_movement_id
    );
  END LOOP;

  PERFORM public.set_budget_recurring_default(p_category_id,p_amount);
  PERFORM public.budget_assert_reconciled((value->>'budget_month_id')::bigint)
    FROM jsonb_array_elements(
      jsonb_build_array(v_material->'current_month_change')
      ||coalesce(v_material->'future_months_to_change','[]'::jsonb)
    ) value;
  RETURN public.get_funded_budget_month(p_month);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_budget_recurring_propagation_item(),
  public.capture_budget_month_recurring_update(TEXT,BIGINT,NUMERIC),
  public.validate_budget_operation_tree()
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
    RAISE EXCEPTION 'Migration 027 changed the consolidated Budget object counts';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND c.relname LIKE 'budget%' AND c.relrowsecurity)<>11 THEN
    RAISE EXCEPTION 'Migration 027 expected RLS on all eleven Budget tables';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[
    'budget_carryover_batches','budget_carryover_transfers','budget_month_override_events',
    'budget_month_disposition_batches','budget_unused_disposition_events','budget_funding_actions',
    'budget_funding_action_legs','budget_unbudgeted_resolution_events'
  ]) AS retired(name) WHERE to_regclass('public.'||retired.name) IS NOT NULL) THEN
    RAISE EXCEPTION 'Migration 027 reintroduced a retired Budget relation';
  END IF;
  IF has_function_privilege('anon','public.validate_budget_recurring_propagation_item()','EXECUTE')
     OR has_function_privilege('authenticated','public.validate_budget_recurring_propagation_item()','EXECUTE')
     OR has_function_privilege('service_role','public.validate_budget_recurring_propagation_item()','EXECUTE') THEN
    RAISE EXCEPTION 'Migration 027 exposed an internal propagation validator';
  END IF;
  PERFORM public.budget_assert_reconciled(id) FROM public.budget_months;
END;
$$;

COMMIT;
