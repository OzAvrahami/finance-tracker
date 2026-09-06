-- Migration 025: remove post-consolidation compatibility relations.
--
-- Migration 024 made budget_operations/budget_operation_items authoritative,
-- but temporarily retained feature-table-shaped views so the deployed RPC
-- implementations could be converted without a broken intermediate release.
-- This migration completes that conversion. It changes no financial data.

BEGIN;

DO $$
DECLARE
  v_name TEXT;
  v_kind "char";
  v_expected_views CONSTANT TEXT[] := ARRAY[
    'budget_carryover_batches','budget_carryover_transfers',
    'budget_month_override_events','budget_month_disposition_batches',
    'budget_unused_disposition_events','budget_funding_actions',
    'budget_funding_action_legs','budget_unbudgeted_resolution_events',
    'budget_category_carryover_state','budget_category_base_state',
    'budget_category_funding_action_state','budget_carryover_settings',
    'budget_carryover_settings_read'
  ];
BEGIN
  IF to_regclass('public.budget_operation_items') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='budget_operations'
         AND column_name='parent_operation_id'
     )
     OR to_regclass('public.budget_category_composition') IS NULL
     OR to_regclass('public.budget_operation_history') IS NULL THEN
    RAISE EXCEPTION 'Migration 025 requires the complete Migration 024 consolidated schema';
  END IF;

  FOREACH v_name IN ARRAY v_expected_views LOOP
    SELECT c.relkind INTO v_kind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=v_name;
    IF v_kind IS DISTINCT FROM 'v'::"char" THEN
      RAISE EXCEPTION 'Migration 025 expected public.% to be a post-024 view, found relkind %',
        v_name,coalesce(v_kind::text,'missing');
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.budget_category_composition
    WHERE final_funded IS DISTINCT FROM (
      opening_base+override_adjustment_total+incoming_carryover-outgoing_carryover
      +incoming_reallocation_resolution-outgoing_reallocation
      +unbudgeted_resolution_adjustment+unused_disposition_adjustment+other_adjustments
    )::numeric(18,2)
  ) THEN
    RAISE EXCEPTION 'Migration 025 preflight found an unreconciled category composition';
  END IF;

  PERFORM public.budget_assert_reconciled(id) FROM public.budget_months;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_budget_unbudgeted_resolution(
  p_event_id BIGINT,p_request_key UUID,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_original public.budget_operation_items%ROWTYPE; v_existing public.budget_operations%ROWTYPE;
  v_month public.budget_months%ROWTYPE; v_operation_id BIGINT; v_action_id BIGINT;
  v_event_id BIGINT; v_fingerprint TEXT; v_current_final NUMERIC(18,2);
  v_current_raw NUMERIC(18,2); v_movement_id BIGINT; v_savings_entry_id BIGINT;
  v_lifecycle_id BIGINT; v_savings_total NUMERIC(18,2):=0;
  v_original_funding public.budget_funding_entries%ROWTYPE; original_leg RECORD;
BEGIN
  IF p_event_id IS NULL OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'event_id and request_key are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_original FROM public.budget_operation_items
  WHERE id=p_event_id AND item_kind='unbudgeted_resolution' AND action_kind='apply'
    AND reversed_item_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unbudgeted resolution does not exist' USING ERRCODE='P0002'; END IF;
  v_fingerprint:='unbudgeted_resolution_reverse|'||p_event_id::text;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'unbudgeted_resolution_reversal'
       OR v_existing.request_fingerprint<>v_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'event_id',(SELECT id FROM public.budget_operation_items
        WHERE operation_id=coalesce(v_existing.parent_operation_id,v_existing.id)
          AND item_kind='unbudgeted_resolution' AND reversed_item_id=p_event_id LIMIT 1),
      'action_id',(SELECT id FROM public.budget_operation_items
        WHERE operation_id=coalesce(v_existing.parent_operation_id,v_existing.id)
          AND item_kind='funding_action' AND reversed_item_id=v_original.linked_item_id LIMIT 1),
      'state',public.get_funded_budget_month(to_char((SELECT month_start FROM public.budget_months
        WHERE id=v_original.budget_month_id),'YYYY-MM')));
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  IF v_original.linked_item_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.budget_operation_items
    WHERE item_kind='allocation_leg' AND linked_item_id=v_original.linked_item_id AND source_kind='savings') THEN
    PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  END IF;
  SELECT * INTO v_month FROM public.budget_months WHERE id=v_original.budget_month_id FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month.id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories WHERE id IN(
    SELECT v_original.category_id UNION SELECT b.category_id
    FROM public.budget_operation_items l JOIN public.budgets b ON b.id=l.source_budget_id
    WHERE l.item_kind='allocation_leg' AND l.linked_item_id=v_original.linked_item_id
  ) ORDER BY id FOR UPDATE;
  IF public.budget_action_month_lifecycle(to_char(v_month.month_start,'YYYY-MM'))='closed' THEN
    RAISE EXCEPTION 'BUDGET_MONTH_ALREADY_CLOSED: closed months require a historical correction workflow' USING ERRCODE='23514';
  ELSIF public.budget_action_month_lifecycle(to_char(v_month.month_start,'YYYY-MM'))
        NOT IN('current','immediately_completed_unclosed') THEN
    RAISE EXCEPTION 'BUDGET_ACTION_MONTH_FORBIDDEN: action is outside the allowed month lifecycle' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_operation_items
    WHERE item_kind='unbudgeted_resolution' AND reversed_item_id=p_event_id) THEN
    RAISE EXCEPTION 'Unbudgeted resolution has already been reversed' USING ERRCODE='23505';
  END IF;
  SELECT final_funded INTO v_current_final FROM public.budget_category_state
  WHERE budget_id=v_original.destination_budget_id AND lifecycle_state='active';
  IF NOT FOUND OR v_current_final<v_original.amount THEN
    RAISE EXCEPTION 'UNBUDGETED_RESOLUTION_REVERSAL_BLOCKED: destination funding or lifecycle changed'
      USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(total_amount),0)::numeric(18,2) INTO v_current_raw
  FROM public.transactions WHERE movement_type='expense' AND category_id=v_original.category_id
    AND transaction_date>=v_month.month_start
    AND transaction_date<(v_month.month_start+interval '1 month')::date;
  v_operation_id:=public.budget_create_action_root(v_month.id,p_request_key,v_fingerprint,
    'unbudgeted_resolution_reversal',CASE WHEN v_month.month_start=
      date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date
      THEN timezone('Asia/Jerusalem',statement_timestamp())::date
      ELSE (v_month.month_start+interval '1 month - 1 day')::date END,
    p_reason,v_original.operation_id);
  IF v_original.linked_item_id IS NOT NULL THEN
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,destination_budget_id,amount,
      funded_before,raw_actual_snapshot,deficit_after,reversed_item_id
    ) VALUES(v_operation_id,'funding_action','reversal',v_month.id,v_original.destination_budget_id,
      v_original.amount,v_current_final,v_original.raw_actual_snapshot,NULL,v_original.linked_item_id)
    RETURNING id INTO v_action_id;
    SELECT coalesce(sum(amount),0) INTO v_savings_total FROM public.budget_operation_items
    WHERE item_kind='allocation_leg' AND linked_item_id=v_original.linked_item_id AND source_kind='savings';
    IF v_savings_total>0 THEN
      SELECT * INTO v_original_funding FROM public.budget_funding_entries
      WHERE operation_id=v_original.operation_id AND source_kind='savings_withdrawal';
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id)
      VALUES(v_operation_id,-v_savings_total,'savings_withdrawal',
        'Reverse Savings-funded unbudgeted resolution',v_original_funding.id);
    END IF;
    FOR original_leg IN
      SELECT l.*,m.source_budget_id original_source,m.destination_budget_id original_destination
      FROM public.budget_operation_items l JOIN public.budget_movements m ON m.id=l.movement_id
      WHERE l.item_kind='allocation_leg' AND l.linked_item_id=v_original.linked_item_id ORDER BY l.id
    LOOP
      INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
      VALUES(v_operation_id,original_leg.original_destination,original_leg.original_source,original_leg.amount)
      RETURNING id INTO v_movement_id;
      v_savings_entry_id:=NULL;
      IF original_leg.source_kind='savings' THEN
        INSERT INTO public.budget_savings_entries(operation_id,category_id,amount_delta,entry_kind,
          reverses_entry_id,destination_budget_month_id,destination_budget_id,movement_id)
        VALUES(v_operation_id,v_original.category_id,original_leg.amount,'withdrawal_reversal',
          original_leg.savings_entry_id,v_month.id,v_original.destination_budget_id,v_movement_id)
        RETURNING id INTO v_savings_entry_id;
      END IF;
      INSERT INTO public.budget_operation_items(
        operation_id,item_kind,action_kind,budget_month_id,source_kind,source_budget_id,
        destination_budget_id,amount,funded_before,raw_actual_snapshot,source_capacity_snapshot,
        movement_id,savings_entry_id,linked_item_id,reversed_item_id
      ) VALUES(v_operation_id,'allocation_leg','reversal',v_month.id,original_leg.source_kind,
        original_leg.source_budget_id,v_original.destination_budget_id,original_leg.amount,
        original_leg.funded_before,original_leg.raw_actual_snapshot,original_leg.source_capacity_snapshot,
        v_movement_id,v_savings_entry_id,v_action_id,original_leg.id);
    END LOOP;
  END IF;
  INSERT INTO public.budget_lifecycle_events(operation_id,budget_id,state,actual_spent_snapshot)
  VALUES(v_operation_id,v_original.destination_budget_id,'inactive',greatest(v_current_raw,0))
  RETURNING id INTO v_lifecycle_id;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
    resolution_mode,raw_actual_snapshot,funded_before,amount,funded_after,deficit_after,
    lifecycle_event_id,linked_item_id,reversed_item_id
  ) VALUES(v_operation_id,'unbudgeted_resolution','reversal',v_month.id,v_original.category_id,
    v_original.destination_budget_id,v_original.resolution_mode,v_current_raw,v_current_final,
    v_original.amount,v_current_final-v_original.amount,
    greatest(v_current_raw-(v_current_final-v_original.amount),0),v_lifecycle_id,v_action_id,p_event_id)
  RETURNING id INTO v_event_id;
  PERFORM public.budget_assert_reconciled(v_month.id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('event_id',v_event_id,'action_id',v_action_id,
    'state',public.get_funded_budget_month(to_char(v_month.month_start,'YYYY-MM')));
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_budget_unbudgeted_resolution(
  p_month TEXT,p_category_id BIGINT,p_requested_amount NUMERIC,p_legs JSONB,
  p_request_key UUID,p_preview_fingerprint TEXT,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month); v_month_id BIGINT;
  v_existing public.budget_operations%ROWTYPE; v_preview JSONB; v_operation_id BIGINT;
  v_budget_id BIGINT; v_action_id BIGINT; v_event_id BIGINT; v_lifecycle_id BIGINT;
  v_movement_id BIGINT; v_savings_entry_id BIGINT; v_savings_total NUMERIC(18,2):=0;
  v_effective_date DATE; item JSONB;
BEGIN
  IF p_request_key IS NULL OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'request_key and preview fingerprint are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'unbudgeted_resolution' OR v_existing.request_fingerprint<>p_preview_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'event_id',(SELECT id FROM public.budget_operation_items
        WHERE operation_id=coalesce(v_existing.parent_operation_id,v_existing.id)
          AND item_kind='unbudgeted_resolution' LIMIT 1),
      'action_id',(SELECT id FROM public.budget_operation_items
        WHERE operation_id=coalesce(v_existing.parent_operation_id,v_existing.id)
          AND item_kind='funding_action' LIMIT 1),
      'state',public.get_funded_budget_month(p_month));
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_legs) leg(value)
    WHERE leg.value->>'source_kind'='savings') THEN
    PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  END IF;
  INSERT INTO public.budget_months(month_start) VALUES(v_month_start) ON CONFLICT(month_start) DO NOTHING;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month_id AND category_id IN(
    SELECT p_category_id UNION SELECT NULLIF(leg.value->>'category_id','')::bigint
    FROM jsonb_array_elements(p_legs) leg(value) WHERE leg.value->>'source_kind'='category'
  ) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories WHERE id IN(
    SELECT p_category_id UNION SELECT NULLIF(leg.value->>'category_id','')::bigint
    FROM jsonb_array_elements(p_legs) leg(value) WHERE leg.value->>'source_kind'='category'
  ) ORDER BY id FOR UPDATE;
  v_preview:=public.get_budget_unbudgeted_resolution_preview(p_month,p_category_id,p_requested_amount,p_legs);
  IF v_preview->>'fingerprint'<>p_preview_fingerprint THEN
    RAISE EXCEPTION 'UNBUDGETED_RESOLUTION_PREVIEW_STALE: refresh the preview before applying' USING ERRCODE='40001';
  END IF;
  IF NOT (v_preview->>'can_apply')::boolean THEN
    RAISE EXCEPTION '%: unbudgeted resolution cannot be applied',v_preview->>'reason' USING ERRCODE='23514';
  END IF;
  v_effective_date:=CASE WHEN v_preview->>'lifecycle'='current'
    THEN timezone('Asia/Jerusalem',statement_timestamp())::date
    ELSE (v_month_start+interval '1 month - 1 day')::date END;
  v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,p_preview_fingerprint,
    'unbudgeted_resolution',v_effective_date,p_reason,NULL);
  IF v_preview->>'resolution_mode'='created' THEN
    INSERT INTO public.budgets(category_id,month,amount,budget_month_id,starting_amount,
      starting_kind,created_by_operation_id)
    VALUES(p_category_id,p_month,0,v_month_id,0,'unbudgeted_resolution',v_operation_id)
    RETURNING id INTO v_budget_id;
  ELSE v_budget_id:=(v_preview->>'budget_id')::bigint; END IF;
  INSERT INTO public.budget_lifecycle_events(operation_id,budget_id,state)
  VALUES(v_operation_id,v_budget_id,'active') RETURNING id INTO v_lifecycle_id;
  IF p_requested_amount>0 THEN
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,destination_budget_id,amount,
      funded_before,raw_actual_snapshot,deficit_after
    ) VALUES(v_operation_id,'funding_action','unbudgeted_resolution',v_month_id,v_budget_id,
      p_requested_amount,(v_preview->>'existing_funded')::numeric,
      (v_preview->>'raw_actual')::numeric,(v_preview->>'remaining_deficit')::numeric)
    RETURNING id INTO v_action_id;
    SELECT coalesce(sum((leg.value->>'amount')::numeric),0) INTO v_savings_total
    FROM jsonb_array_elements(v_preview->'selected_legs') leg(value)
    WHERE leg.value->>'source_kind'='savings';
    IF v_savings_total>0 THEN
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
      VALUES(v_operation_id,v_savings_total,'savings_withdrawal','Explicit Savings-funded unbudgeted resolution');
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(v_preview->'selected_legs') LOOP
      INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
      VALUES(v_operation_id,NULLIF(item->>'source_budget_id','')::bigint,v_budget_id,
        (item->>'amount')::numeric) RETURNING id INTO v_movement_id;
      v_savings_entry_id:=NULL;
      IF item->>'source_kind'='savings' THEN
        INSERT INTO public.budget_savings_entries(operation_id,category_id,amount_delta,entry_kind,
          destination_budget_month_id,destination_budget_id,movement_id)
        VALUES(v_operation_id,p_category_id,-(item->>'amount')::numeric,'withdrawal',
          v_month_id,v_budget_id,v_movement_id) RETURNING id INTO v_savings_entry_id;
      END IF;
      INSERT INTO public.budget_operation_items(
        operation_id,item_kind,action_kind,budget_month_id,source_kind,source_budget_id,
        destination_budget_id,amount,funded_before,raw_actual_snapshot,source_capacity_snapshot,
        movement_id,savings_entry_id,linked_item_id
      ) VALUES(v_operation_id,'allocation_leg','apply',v_month_id,item->>'source_kind',
        NULLIF(item->>'source_budget_id','')::bigint,v_budget_id,(item->>'amount')::numeric,
        NULLIF(item->>'source_final_funded','')::numeric,NULLIF(item->>'source_raw_actual','')::numeric,
        (item->>'source_capacity')::numeric,v_movement_id,v_savings_entry_id,v_action_id);
    END LOOP;
  END IF;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
    resolution_mode,raw_actual_snapshot,funded_before,amount,funded_after,deficit_after,
    lifecycle_event_id,linked_item_id
  ) VALUES(v_operation_id,'unbudgeted_resolution','apply',v_month_id,p_category_id,v_budget_id,
    v_preview->>'resolution_mode',(v_preview->>'raw_actual')::numeric,
    (v_preview->>'existing_funded')::numeric,p_requested_amount,
    (v_preview->>'resulting_funded')::numeric,(v_preview->>'remaining_deficit')::numeric,
    v_lifecycle_id,v_action_id) RETURNING id INTO v_event_id;
  PERFORM public.budget_assert_reconciled(v_month_id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('event_id',v_event_id,'action_id',v_action_id,
    'applied_amount',p_requested_amount::numeric(18,2)::text,
    'remaining_deficit',v_preview->>'remaining_deficit','state',public.get_funded_budget_month(p_month));
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_budget_funding_action(
  p_action_id BIGINT,p_request_key UUID,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_original public.budget_operation_items%ROWTYPE; v_original_operation public.budget_operations%ROWTYPE;
  v_existing public.budget_operations%ROWTYPE; v_month public.budget_months%ROWTYPE;
  v_operation_id BIGINT; v_action_id BIGINT; v_fingerprint TEXT:='funding_action_reverse|'||coalesce(p_action_id::text,'');
  v_required_unallocated NUMERIC(18,2):=0; v_unallocated NUMERIC(18,2):=0;
  v_savings_total NUMERIC(18,2):=0; v_original_funding public.budget_funding_entries%ROWTYPE;
  v_destination_release NUMERIC(18,2):=0; v_destination_raw NUMERIC(18,2):=0;
  v_destination_effective NUMERIC(18,2):=0; v_destination_final NUMERIC(18,2):=0;
  v_movement_id BIGINT; v_savings_entry_id BIGINT; original_leg RECORD;
BEGIN
  IF p_action_id IS NULL OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'action_id and request_key are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_original FROM public.budget_operation_items
  WHERE id=p_action_id AND item_kind IN('reallocation','deficit_resolution') AND reversed_item_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding action does not exist' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_original_operation FROM public.budget_operations WHERE id=v_original.operation_id;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'funding_action_reversal' OR v_existing.request_fingerprint<>v_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('action_id',(SELECT id FROM public.budget_operation_items
      WHERE operation_id=coalesce(v_existing.parent_operation_id,v_existing.id)
        AND reversed_item_id=p_action_id LIMIT 1),
      'state',public.get_funded_budget_month(to_char((SELECT month_start FROM public.budget_months
        WHERE id=v_original.budget_month_id),'YYYY-MM')));
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.budget_operation_items
    WHERE item_kind='allocation_leg' AND linked_item_id=p_action_id AND source_kind='savings') THEN
    PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  END IF;
  SELECT * INTO v_month FROM public.budget_months WHERE id=v_original.budget_month_id FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_original.budget_month_id ORDER BY id FOR UPDATE;
  IF public.budget_action_month_lifecycle(to_char(v_month.month_start,'YYYY-MM'))='closed' THEN
    RAISE EXCEPTION 'BUDGET_MONTH_ALREADY_CLOSED: closed months require a historical correction workflow' USING ERRCODE='23514';
  ELSIF public.budget_action_month_lifecycle(to_char(v_month.month_start,'YYYY-MM'))
        NOT IN('current','immediately_completed_unclosed') THEN
    RAISE EXCEPTION 'BUDGET_ACTION_MONTH_FORBIDDEN: action is outside the allowed month lifecycle' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_operation_items
    WHERE item_kind=v_original.item_kind AND reversed_item_id=p_action_id) THEN
    RAISE EXCEPTION 'Funding action has already been reversed' USING ERRCODE='23505';
  END IF;
  SELECT coalesce(sum(l.amount),0) INTO v_required_unallocated
  FROM public.budget_operation_items l JOIN public.budget_movements m ON m.id=l.movement_id
  WHERE l.item_kind='allocation_leg' AND l.linked_item_id=p_action_id
    AND l.source_kind='category' AND m.destination_budget_id IS NULL;
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_original.budget_month_id;
  IF v_required_unallocated>v_unallocated THEN
    RAISE EXCEPTION 'FUNDING_ACTION_REVERSAL_BLOCKED: unallocated funding is insufficient' USING ERRCODE='23514';
  END IF;
  IF v_original.destination_budget_id IS NOT NULL THEN
    SELECT coalesce(sum(l.amount),0) INTO v_destination_release
    FROM public.budget_operation_items l JOIN public.budget_movements m ON m.id=l.movement_id
    WHERE l.item_kind='allocation_leg' AND l.linked_item_id=p_action_id
      AND m.destination_budget_id=v_original.destination_budget_id;
    SELECT final_funded INTO v_destination_final FROM public.budget_category_state
    WHERE budget_id=v_original.destination_budget_id;
    IF v_destination_release>v_destination_final THEN
      RAISE EXCEPTION 'FUNDING_ACTION_REVERSAL_BLOCKED: destination funding is insufficient' USING ERRCODE='23514';
    END IF;
    IF v_original.item_kind='reallocation' THEN
      SELECT coalesce(sum(t.total_amount),0)::numeric(18,2) INTO v_destination_raw
      FROM public.transactions t JOIN public.budgets b ON b.category_id=t.category_id
      WHERE b.id=v_original.destination_budget_id AND t.movement_type='expense'
        AND t.transaction_date>=v_month.month_start
        AND t.transaction_date<(v_month.month_start+interval '1 month')::date;
      v_destination_effective:=greatest(v_destination_raw,0);
      IF v_destination_release>greatest(v_destination_final-v_destination_effective,0) THEN
        RAISE EXCEPTION 'FUNDING_ACTION_REVERSAL_BLOCKED: destination funding has been spent' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  v_operation_id:=public.budget_create_action_root(v_original.budget_month_id,p_request_key,v_fingerprint,
    'funding_action_reversal',v_month.month_start,p_reason,v_original.operation_id);
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,destination_budget_id,amount,
    funded_before,raw_actual_snapshot,deficit_before,deficit_after,reversed_item_id
  ) VALUES(v_operation_id,v_original.item_kind,'reversal',v_original.budget_month_id,
    v_original.destination_budget_id,v_original.amount,v_original.funded_before,
    v_original.raw_actual_snapshot,v_original.deficit_before,v_original.deficit_after,p_action_id)
  RETURNING id INTO v_action_id;
  SELECT coalesce(sum(amount),0) INTO v_savings_total FROM public.budget_operation_items
  WHERE item_kind='allocation_leg' AND linked_item_id=p_action_id AND source_kind='savings';
  IF v_savings_total>0 THEN
    SELECT * INTO v_original_funding FROM public.budget_funding_entries
    WHERE operation_id=v_original.operation_id AND source_kind='savings_withdrawal';
    INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id)
    VALUES(v_operation_id,-v_savings_total,'savings_withdrawal',
      'Reverse Savings-funded deficit resolution',v_original_funding.id);
  END IF;
  FOR original_leg IN
    SELECT l.*,m.source_budget_id original_source,m.destination_budget_id original_destination
    FROM public.budget_operation_items l JOIN public.budget_movements m ON m.id=l.movement_id
    WHERE l.item_kind='allocation_leg' AND l.linked_item_id=p_action_id ORDER BY l.id
  LOOP
    INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
    VALUES(v_operation_id,original_leg.original_destination,original_leg.original_source,original_leg.amount)
    RETURNING id INTO v_movement_id;
    v_savings_entry_id:=NULL;
    IF original_leg.source_kind='savings' THEN
      INSERT INTO public.budget_savings_entries(operation_id,category_id,amount_delta,entry_kind,
        reverses_entry_id,destination_budget_month_id,destination_budget_id,movement_id)
      VALUES(v_operation_id,(SELECT category_id FROM public.budgets WHERE id=v_original.destination_budget_id),
        original_leg.amount,'withdrawal_reversal',original_leg.savings_entry_id,
        v_original.budget_month_id,v_original.destination_budget_id,v_movement_id)
      RETURNING id INTO v_savings_entry_id;
    END IF;
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,source_kind,source_budget_id,
      destination_budget_id,amount,funded_before,raw_actual_snapshot,source_capacity_snapshot,
      movement_id,savings_entry_id,linked_item_id,reversed_item_id
    ) VALUES(v_operation_id,'allocation_leg','reversal',v_original.budget_month_id,
      original_leg.source_kind,original_leg.source_budget_id,v_original.destination_budget_id,
      original_leg.amount,original_leg.funded_before,original_leg.raw_actual_snapshot,
      original_leg.source_capacity_snapshot,v_movement_id,v_savings_entry_id,v_action_id,original_leg.id);
  END LOOP;
  PERFORM public.budget_assert_reconciled(v_original.budget_month_id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('action_id',v_action_id,
    'state',public.get_funded_budget_month(to_char(v_month.month_start,'YYYY-MM')));
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_budget_reallocation(
  p_month TEXT,p_source_kind TEXT,p_source_category_id BIGINT,
  p_destination_kind TEXT,p_destination_category_id BIGINT,p_amount NUMERIC,
  p_request_key UUID,p_preview_fingerprint TEXT,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month); v_month_id BIGINT;
  v_existing public.budget_operations%ROWTYPE; v_preview JSONB; v_operation_id BIGINT;
  v_action_id BIGINT; v_movement_id BIGINT;
BEGIN
  IF p_request_key IS NULL OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'request_key and preview fingerprint are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'budget_reallocation' OR v_existing.request_fingerprint<>p_preview_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('action_id',(SELECT id FROM public.budget_operation_items
      WHERE operation_id=coalesce(v_existing.parent_operation_id,v_existing.id) AND item_kind='reallocation' LIMIT 1),
      'state',public.get_funded_budget_month(p_month));
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month_id
    AND category_id IN(p_source_category_id,p_destination_category_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories WHERE id IN(p_source_category_id,p_destination_category_id) ORDER BY id FOR UPDATE;
  v_preview:=public.get_budget_reallocation_preview(p_month,p_source_kind,p_source_category_id,
    p_destination_kind,p_destination_category_id,p_amount);
  IF v_preview->>'fingerprint'<>p_preview_fingerprint THEN
    RAISE EXCEPTION 'BUDGET_REALLOCATION_PREVIEW_STALE: refresh the preview before applying' USING ERRCODE='40001';
  END IF;
  IF NOT (v_preview->>'can_apply')::boolean THEN
    RAISE EXCEPTION '%: reallocation cannot be applied',v_preview->>'reason' USING ERRCODE='23514';
  END IF;
  v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,p_preview_fingerprint,
    'budget_reallocation',v_month_start,p_reason,NULL);
  INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
  VALUES(v_operation_id,NULLIF(v_preview->>'source_budget_id','')::bigint,
    NULLIF(v_preview->>'destination_budget_id','')::bigint,p_amount) RETURNING id INTO v_movement_id;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,destination_budget_id,amount,
    funded_before,raw_actual_snapshot,deficit_before,deficit_after
  ) VALUES(v_operation_id,'reallocation','planned_reallocation',v_month_id,
    NULLIF(v_preview->>'destination_budget_id','')::bigint,p_amount,
    CASE WHEN p_destination_kind='category' THEN (v_preview->>'destination_before')::numeric END,
    CASE WHEN p_destination_kind='category' THEN (v_preview->>'destination_raw_actual')::numeric END,
    CASE WHEN p_destination_kind='category' THEN greatest((v_preview->>'destination_raw_actual')::numeric-
      (v_preview->>'destination_before')::numeric,0) END,
    CASE WHEN p_destination_kind='category' THEN greatest((v_preview->>'destination_raw_actual')::numeric-
      (v_preview->>'destination_after')::numeric,0) END
  ) RETURNING id INTO v_action_id;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,source_kind,source_budget_id,
    destination_budget_id,amount,funded_before,raw_actual_snapshot,source_capacity_snapshot,
    movement_id,linked_item_id
  ) VALUES(v_operation_id,'allocation_leg','apply',v_month_id,p_source_kind,
    NULLIF(v_preview->>'source_budget_id','')::bigint,NULLIF(v_preview->>'destination_budget_id','')::bigint,
    p_amount,CASE WHEN p_source_kind='category' THEN (v_preview->>'source_funded')::numeric END,
    CASE WHEN p_source_kind='category' THEN (v_preview->>'source_raw_actual')::numeric END,
    (v_preview->>'source_capacity')::numeric,v_movement_id,v_action_id);
  PERFORM public.budget_assert_reconciled(v_month_id);
  RETURN jsonb_build_object('action_id',v_action_id,'state',public.get_funded_budget_month(p_month));
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_budget_deficit_resolution(
  p_month TEXT,p_destination_category_id BIGINT,p_legs JSONB,p_request_key UUID,
  p_preview_fingerprint TEXT,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month); v_month_id BIGINT;
  v_existing public.budget_operations%ROWTYPE; v_preview JSONB; v_operation_id BIGINT;
  v_action_id BIGINT; v_movement_id BIGINT; v_savings_entry_id BIGINT;
  v_savings_total NUMERIC(18,2):=0; item JSONB;
BEGIN
  IF p_request_key IS NULL OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'request_key and preview fingerprint are required' USING ERRCODE='22023';
  END IF;
  IF p_legs IS NULL OR jsonb_typeof(p_legs)<>'array' OR jsonb_array_length(p_legs)=0 THEN
    RAISE EXCEPTION 'At least one deficit funding leg is required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'deficit_resolution' OR v_existing.request_fingerprint<>p_preview_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('action_id',(SELECT id FROM public.budget_operation_items
      WHERE operation_id=coalesce(v_existing.parent_operation_id,v_existing.id)
        AND item_kind='deficit_resolution' LIMIT 1),'state',public.get_funded_budget_month(p_month));
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_legs) leg(value)
    WHERE leg.value->>'source_kind'='savings') THEN
    PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  END IF;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month_id AND category_id IN(
    SELECT p_destination_category_id UNION SELECT NULLIF(leg.value->>'category_id','')::bigint
    FROM jsonb_array_elements(p_legs) leg(value) WHERE leg.value->>'source_kind'='category'
  ) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories WHERE id IN(
    SELECT p_destination_category_id UNION SELECT NULLIF(leg.value->>'category_id','')::bigint
    FROM jsonb_array_elements(p_legs) leg(value) WHERE leg.value->>'source_kind'='category'
  ) ORDER BY id FOR UPDATE;
  v_preview:=public.get_budget_deficit_resolution_preview(p_month,p_destination_category_id,p_legs);
  IF v_preview->>'fingerprint'<>p_preview_fingerprint THEN
    RAISE EXCEPTION 'DEFICIT_RESOLUTION_PREVIEW_STALE: refresh the preview before applying' USING ERRCODE='40001';
  END IF;
  IF NOT (v_preview->>'can_apply')::boolean THEN
    RAISE EXCEPTION '%: deficit resolution cannot be applied',v_preview->>'reason' USING ERRCODE='23514';
  END IF;
  v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,p_preview_fingerprint,
    'deficit_resolution',v_month_start,p_reason,NULL);
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,destination_budget_id,amount,
    funded_before,raw_actual_snapshot,deficit_before,deficit_after
  ) VALUES(v_operation_id,'deficit_resolution','deficit_resolution',v_month_id,
    (v_preview->>'destination_budget_id')::bigint,(v_preview->>'requested_resolution')::numeric,
    (v_preview->>'current_funded')::numeric,(v_preview->>'actual')::numeric,
    (v_preview->>'deficit')::numeric,(v_preview->>'remaining_deficit')::numeric)
  RETURNING id INTO v_action_id;
  SELECT coalesce(sum((leg.value->>'amount')::numeric),0) INTO v_savings_total
  FROM jsonb_array_elements(v_preview->'selected_legs') leg(value)
  WHERE leg.value->>'source_kind'='savings';
  IF v_savings_total>0 THEN
    INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
    VALUES(v_operation_id,v_savings_total,'savings_withdrawal','Explicit Savings-funded deficit resolution');
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v_preview->'selected_legs') LOOP
    INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
    VALUES(v_operation_id,NULLIF(item->>'source_budget_id','')::bigint,
      (v_preview->>'destination_budget_id')::bigint,(item->>'amount')::numeric)
    RETURNING id INTO v_movement_id;
    v_savings_entry_id:=NULL;
    IF item->>'source_kind'='savings' THEN
      INSERT INTO public.budget_savings_entries(operation_id,category_id,amount_delta,entry_kind,
        destination_budget_month_id,destination_budget_id,movement_id)
      VALUES(v_operation_id,p_destination_category_id,-(item->>'amount')::numeric,'withdrawal',
        v_month_id,(v_preview->>'destination_budget_id')::bigint,v_movement_id)
      RETURNING id INTO v_savings_entry_id;
    END IF;
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,source_kind,source_budget_id,
      destination_budget_id,amount,funded_before,raw_actual_snapshot,source_capacity_snapshot,
      movement_id,savings_entry_id,linked_item_id
    ) VALUES(v_operation_id,'allocation_leg','apply',v_month_id,item->>'source_kind',
      NULLIF(item->>'source_budget_id','')::bigint,(v_preview->>'destination_budget_id')::bigint,
      (item->>'amount')::numeric,NULLIF(item->>'source_final_funded','')::numeric,
      NULLIF(item->>'source_raw_actual','')::numeric,(item->>'source_capacity')::numeric,
      v_movement_id,v_savings_entry_id,v_action_id);
  END LOOP;
  PERFORM public.budget_assert_reconciled(v_month_id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('action_id',v_action_id,
    'applied_amount',v_preview->>'requested_resolution','remaining_deficit',v_preview->>'remaining_deficit',
    'state',public.get_funded_budget_month(p_month));
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_budget_month_disposition(
  p_batch_id BIGINT,p_request_key UUID,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_original_root public.budget_operations%ROWTYPE; v_original_summary public.budget_operation_items%ROWTYPE;
  v_reversal_root public.budget_operations%ROWTYPE; v_source_month public.budget_months%ROWTYPE;
  v_destination_month public.budget_months%ROWTYPE; v_fingerprint TEXT:='month_disposition_reverse|'||coalesce(p_batch_id::text,'');
  v_destination_unallocated NUMERIC(18,2); v_savings_balance NUMERIC(18,2);
  v_source_operation_id BIGINT; v_destination_operation_id BIGINT; v_savings_entry_id BIGINT;
  v_carry_item_id BIGINT; v_source_funding_id BIGINT; v_destination_funding_id BIGINT;
  original_event public.budget_operation_items%ROWTYPE;
BEGIN
  IF p_batch_id IS NULL OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'batch_id and request_key are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_original_root FROM public.budget_operations
  WHERE id=p_batch_id AND parent_operation_id IS NULL AND operation_type='month_close'
    AND reverses_operation_id IS NULL;
  SELECT * INTO v_original_summary FROM public.budget_operation_items
  WHERE operation_id=p_batch_id AND item_kind='month_close' AND action_kind='apply'
    AND reversed_item_id IS NULL;
  IF v_original_root.id IS NULL OR v_original_summary.id IS NULL THEN
    RAISE EXCEPTION 'Original month disposition batch % does not exist',p_batch_id USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_reversal_root FROM public.budget_operations
  WHERE request_key=p_request_key AND parent_operation_id IS NULL;
  IF FOUND THEN
    IF v_reversal_root.request_fingerprint<>v_fingerprint
       OR v_reversal_root.reverses_operation_id<>p_batch_id THEN
      RAISE EXCEPTION 'request_key was already used for a different disposition reversal' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'source',public.get_funded_budget_month((SELECT month FROM public.budget_month_funding_state
        WHERE budget_month_id=v_original_summary.budget_month_id)),
      'destination',public.get_funded_budget_month((SELECT month FROM public.budget_month_funding_state
        WHERE budget_month_id=v_original_summary.destination_budget_month_id)),
      'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
      'batch_id',v_reversal_root.id);
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  PERFORM 1 FROM public.budget_months
    WHERE id IN(v_original_summary.budget_month_id,v_original_summary.destination_budget_month_id)
    ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.budgets
    WHERE budget_month_id IN(v_original_summary.budget_month_id,v_original_summary.destination_budget_month_id)
    ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.budget_operation_items
    WHERE item_kind='month_close' AND reversed_item_id=v_original_summary.id) THEN
    RAISE EXCEPTION 'Month disposition batch % has already been reversed',p_batch_id USING ERRCODE='23505';
  END IF;
  SELECT * INTO v_source_month FROM public.budget_months WHERE id=v_original_summary.budget_month_id;
  SELECT * INTO v_destination_month FROM public.budget_months WHERE id=v_original_summary.destination_budget_month_id;
  IF EXISTS(SELECT 1 FROM public.budget_operation_items i
    JOIN public.budget_category_state cs ON cs.budget_id=i.source_budget_id
    WHERE i.operation_id=p_batch_id AND i.item_kind='unused_disposition'
      AND i.action_kind='apply' AND cs.lifecycle_state<>'active') THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_REVERSAL_BLOCKED: source category budget is inactive' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_destination_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_original_summary.destination_budget_month_id;
  IF v_destination_unallocated<coalesce((SELECT sum(amount) FROM public.budget_operation_items
    WHERE operation_id=p_batch_id AND item_kind='unused_disposition' AND action_kind='apply'
      AND policy='return_to_unallocated'),0) THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_REVERSAL_BLOCKED: destination unallocated funding is insufficient'
      USING ERRCODE='23514';
  END IF;
  SELECT balance INTO v_savings_balance FROM public.budget_savings_state;
  IF v_savings_balance<coalesce((SELECT sum(amount) FROM public.budget_operation_items
    WHERE operation_id=p_batch_id AND item_kind='unused_disposition' AND action_kind='apply'
      AND policy='savings'),0) THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_REVERSAL_BLOCKED: Savings retained funds are insufficient'
      USING ERRCODE='23514';
  END IF;
  v_reversal_root.id:=public.budget_create_action_root(v_original_summary.budget_month_id,p_request_key,
    v_fingerprint,'unused_disposition_reversal',v_source_month.month_start,p_reason,p_batch_id);
  INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,
    destination_budget_month_id,reversed_item_id)
  VALUES(v_reversal_root.id,'month_close','reversal',v_original_summary.budget_month_id,
    v_original_summary.destination_budget_month_id,v_original_summary.id);
  FOR original_event IN SELECT * FROM public.budget_operation_items
    WHERE operation_id=p_batch_id AND item_kind='unused_disposition' AND action_kind='apply' ORDER BY id
  LOOP
    v_source_operation_id:=NULL; v_destination_operation_id:=NULL; v_savings_entry_id:=NULL; v_carry_item_id:=NULL;
    IF original_event.policy='carry_forward' THEN
      PERFORM public.reverse_budget_carryover(original_event.linked_item_id,
        public.budget_derived_request_key(p_request_key,'carry-forward|'||original_event.id),
        coalesce(p_reason,'Month close correction'));
      SELECT id,source_operation_id,destination_operation_id INTO
        v_carry_item_id,v_source_operation_id,v_destination_operation_id
      FROM public.budget_operation_items
      WHERE item_kind='carryover' AND reversed_item_id=original_event.linked_item_id;
    ELSIF original_event.policy='return_to_unallocated' THEN
      SELECT id INTO v_source_funding_id FROM public.budget_funding_entries
      WHERE operation_id=original_event.source_operation_id;
      SELECT id INTO v_destination_funding_id FROM public.budget_funding_entries
      WHERE operation_id=original_event.destination_operation_id;
      INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,
        effective_date,reason,reverses_operation_id)
      VALUES(v_original_summary.destination_budget_month_id,
        public.budget_derived_request_key(p_request_key,'return-destination|'||original_event.id),
        v_fingerprint||'|destination|'||original_event.id,'unused_disposition_reversal',
        v_destination_month.month_start,p_reason,original_event.destination_operation_id)
      RETURNING id INTO v_destination_operation_id;
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id)
      VALUES(v_destination_operation_id,-original_event.amount,'unused_disposition_transfer',
        'Reverse unused funding returned from '||to_char(v_source_month.month_start,'YYYY-MM'),v_destination_funding_id);
      INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,
        effective_date,reason,reverses_operation_id)
      VALUES(v_original_summary.budget_month_id,
        public.budget_derived_request_key(p_request_key,'return-source|'||original_event.id),
        v_fingerprint||'|source|'||original_event.id,'unused_disposition_reversal',
        v_source_month.month_start,p_reason,original_event.source_operation_id)
      RETURNING id INTO v_source_operation_id;
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id)
      VALUES(v_source_operation_id,original_event.amount,'unused_disposition_transfer',
        'Restore unused funding from '||to_char(v_destination_month.month_start,'YYYY-MM'),v_source_funding_id);
      INSERT INTO public.budget_movements(operation_id,destination_budget_id,amount)
      VALUES(v_source_operation_id,original_event.source_budget_id,original_event.amount);
    ELSE
      SELECT id INTO v_source_funding_id FROM public.budget_funding_entries
      WHERE operation_id=original_event.source_operation_id;
      INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,
        effective_date,reason,reverses_operation_id)
      VALUES(v_original_summary.budget_month_id,
        public.budget_derived_request_key(p_request_key,'savings|'||original_event.id),
        v_fingerprint||'|savings|'||original_event.id,'unused_disposition_reversal',
        v_source_month.month_start,p_reason,original_event.source_operation_id)
      RETURNING id INTO v_source_operation_id;
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id)
      VALUES(v_source_operation_id,original_event.amount,'savings_transfer',
        'Restore retained Savings to source budget',v_source_funding_id);
      INSERT INTO public.budget_movements(operation_id,destination_budget_id,amount)
      VALUES(v_source_operation_id,original_event.source_budget_id,original_event.amount);
      INSERT INTO public.budget_savings_entries(operation_id,source_budget_month_id,source_budget_id,
        category_id,amount_delta,entry_kind,reverses_entry_id)
      VALUES(v_source_operation_id,v_original_summary.budget_month_id,original_event.source_budget_id,
        original_event.category_id,-original_event.amount,'reversal',original_event.savings_entry_id)
      RETURNING id INTO v_savings_entry_id;
    END IF;
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,category_id,
      source_budget_id,destination_budget_id,source_operation_id,destination_operation_id,
      policy,amount,raw_actual_snapshot,funded_before,savings_entry_id,linked_item_id,reversed_item_id
    ) VALUES(v_reversal_root.id,'unused_disposition','reversal',v_original_summary.budget_month_id,
      v_original_summary.destination_budget_month_id,original_event.category_id,original_event.source_budget_id,
      original_event.destination_budget_id,v_source_operation_id,v_destination_operation_id,original_event.policy,
      original_event.amount,original_event.raw_actual_snapshot,original_event.funded_before,
      v_savings_entry_id,v_carry_item_id,original_event.id);
  END LOOP;
  PERFORM public.budget_assert_reconciled(v_original_summary.budget_month_id);
  PERFORM public.budget_assert_reconciled(v_original_summary.destination_budget_month_id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('source',public.get_funded_budget_month(to_char(v_source_month.month_start,'YYYY-MM')),
    'destination',public.get_funded_budget_month(to_char(v_destination_month.month_start,'YYYY-MM')),
    'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
    'batch_id',v_reversal_root.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_budget_month_disposition(
  p_source_month TEXT,p_request_key UUID,p_preview_fingerprint TEXT,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_source_start DATE:=public.budget_month_start_from_key(p_source_month);
  v_destination_start DATE:=(v_source_start+interval '1 month')::date;
  v_current_start DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_source_month_id BIGINT; v_destination_month_id BIGINT; v_batch_id BIGINT;
  v_existing public.budget_operations%ROWTYPE; v_preview JSONB;
  v_expected TEXT:='month_disposition_apply|'||p_source_month||'|'||coalesce(p_preview_fingerprint,'');
  v_carry_preview JSONB; v_carry_request UUID; v_source_operation_id BIGINT;
  v_destination_operation_id BIGINT; v_carry_item_id BIGINT; v_destination_budget_id BIGINT;
  v_savings_entry_id BIGINT; candidate RECORD;
BEGIN
  IF p_request_key IS NULL OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'request_key and a valid preview fingerprint are required' USING ERRCODE='22023';
  END IF;
  IF v_destination_start<>v_current_start THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_PERIOD_INVALID: source must be the immediately completed Asia/Jerusalem month'
      USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.budget_operations
  WHERE request_key=p_request_key AND parent_operation_id IS NULL;
  IF FOUND THEN
    IF v_existing.operation_type<>'month_close' OR v_existing.request_fingerprint<>v_expected THEN
      RAISE EXCEPTION 'request_key was already used for a different month disposition request' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('source',public.get_funded_budget_month(p_source_month),
      'destination',public.get_funded_budget_month(to_char(v_destination_start,'YYYY-MM')),
      'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
      'batch_id',v_existing.id);
  END IF;
  SELECT id INTO v_source_month_id FROM public.budget_months WHERE month_start=v_source_start;
  IF v_source_month_id IS NULL THEN RAISE EXCEPTION 'Previous month has no funded budget state' USING ERRCODE='23514'; END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  LOCK TABLE public.budget_unused_balance_policies IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  INSERT INTO public.budget_months(month_start) VALUES(v_destination_start) ON CONFLICT(month_start) DO NOTHING;
  SELECT id INTO v_destination_month_id FROM public.budget_months WHERE month_start=v_destination_start;
  PERFORM 1 FROM public.budget_months WHERE id IN(v_source_month_id,v_destination_month_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id IN(v_source_month_id,v_destination_month_id) ORDER BY id FOR UPDATE;
  PERFORM public.budget_assert_reconciled(v_source_month_id);
  PERFORM public.budget_assert_reconciled(v_destination_month_id);
  SELECT * INTO v_existing FROM public.budget_operations
  WHERE request_key=p_request_key AND parent_operation_id IS NULL;
  IF FOUND THEN
    IF v_existing.operation_type<>'month_close' OR v_existing.request_fingerprint<>v_expected THEN
      RAISE EXCEPTION 'request_key was already used for a different month disposition request' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('source',public.get_funded_budget_month(p_source_month),
      'destination',public.get_funded_budget_month(to_char(v_destination_start,'YYYY-MM')),
      'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
      'batch_id',v_existing.id);
  END IF;
  v_preview:=public.get_budget_month_disposition_preview(p_source_month);
  IF v_preview->>'fingerprint' IS DISTINCT FROM p_preview_fingerprint THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_PREVIEW_STALE: candidate material changed; refresh before applying'
      USING ERRCODE='40001';
  END IF;
  IF jsonb_array_length(v_preview->'deficit_blockers')>0 THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_DEFICITS_UNRESOLVED: resolve funded category deficits before closing the month'
      USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(v_preview->'unbudgeted_expense_blockers')>0 THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_UNBUDGETED_EXPENSES: budget or resolve unbudgeted expenses before closing the month'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_preview->'categories') row(item)
    WHERE item->>'status'='blocked') THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_BLOCKED: configure every eligible category and initialize carry-forward destinations'
      USING ERRCODE='23514';
  END IF;
  v_batch_id:=public.budget_create_action_root(v_source_month_id,p_request_key,v_expected,
    'month_close',v_source_start,p_reason,NULL);
  INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id)
  VALUES(v_batch_id,'month_close','apply',v_source_month_id,v_destination_month_id);
  IF (v_preview->>'carry_forward_total')::numeric>0 THEN
    v_carry_preview:=public.get_budget_carryover_preview(to_char(v_destination_start,'YYYY-MM'));
    v_carry_request:=public.budget_derived_request_key(p_request_key,'carry-forward-batch');
    PERFORM public.apply_budget_carryover(to_char(v_destination_start,'YYYY-MM'),v_carry_request,
      v_carry_preview->>'fingerprint',coalesce(p_reason,'Month close: carry forward'));
  END IF;
  FOR candidate IN SELECT item FROM jsonb_array_elements(v_preview->'categories') captured(item)
    WHERE item->>'status'='ready' ORDER BY (item->>'category_id')::bigint
  LOOP
    v_source_operation_id:=NULL; v_destination_operation_id:=NULL;
    v_savings_entry_id:=NULL; v_carry_item_id:=NULL; v_destination_budget_id:=NULL;
    IF candidate.item->>'policy'='carry_forward' THEN
      SELECT id,source_operation_id,destination_operation_id,destination_budget_id
      INTO v_carry_item_id,v_source_operation_id,v_destination_operation_id,v_destination_budget_id
      FROM public.budget_operation_items
      WHERE operation_id=v_batch_id AND item_kind='carryover' AND category_id IS NOT NULL
        AND source_budget_id=(candidate.item->>'source_budget_id')::bigint AND reversed_item_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Carry-forward orchestration did not create the captured transfer' USING ERRCODE='23514';
      END IF;
    ELSIF candidate.item->>'policy'='return_to_unallocated' THEN
      INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason)
      VALUES(v_source_month_id,public.budget_derived_request_key(p_request_key,'return-source|'||(candidate.item->>'category_id')),
        'unused_return_out|'||v_batch_id||'|'||(candidate.item->>'category_id')||'|'||(candidate.item->>'eligible_unused'),
        'unused_return_out',v_source_start,p_reason) RETURNING id INTO v_source_operation_id;
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
      VALUES(v_source_operation_id,-(candidate.item->>'eligible_unused')::numeric,'unused_disposition_transfer',
        'Return unused funding to '||to_char(v_destination_start,'YYYY-MM'));
      INSERT INTO public.budget_movements(operation_id,source_budget_id,amount)
      VALUES(v_source_operation_id,(candidate.item->>'source_budget_id')::bigint,
        (candidate.item->>'eligible_unused')::numeric);
      INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason)
      VALUES(v_destination_month_id,public.budget_derived_request_key(p_request_key,'return-destination|'||(candidate.item->>'category_id')),
        'unused_return_in|'||v_batch_id||'|'||(candidate.item->>'category_id')||'|'||(candidate.item->>'eligible_unused'),
        'unused_return_in',v_destination_start,p_reason) RETURNING id INTO v_destination_operation_id;
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
      VALUES(v_destination_operation_id,(candidate.item->>'eligible_unused')::numeric,'unused_disposition_transfer',
        'Unused funding returned from '||p_source_month);
    ELSE
      INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason)
      VALUES(v_source_month_id,public.budget_derived_request_key(p_request_key,'savings|'||(candidate.item->>'category_id')),
        'unused_to_savings|'||v_batch_id||'|'||(candidate.item->>'category_id')||'|'||(candidate.item->>'eligible_unused'),
        'unused_to_savings',v_source_start,p_reason) RETURNING id INTO v_source_operation_id;
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
      VALUES(v_source_operation_id,-(candidate.item->>'eligible_unused')::numeric,'savings_transfer',
        'Unused budget retained in Savings');
      INSERT INTO public.budget_movements(operation_id,source_budget_id,amount)
      VALUES(v_source_operation_id,(candidate.item->>'source_budget_id')::bigint,
        (candidate.item->>'eligible_unused')::numeric);
      INSERT INTO public.budget_savings_entries(operation_id,source_budget_month_id,source_budget_id,
        category_id,amount_delta,entry_kind)
      VALUES(v_source_operation_id,v_source_month_id,(candidate.item->>'source_budget_id')::bigint,
        (candidate.item->>'category_id')::bigint,(candidate.item->>'eligible_unused')::numeric,'deposit')
      RETURNING id INTO v_savings_entry_id;
    END IF;
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,category_id,
      source_budget_id,destination_budget_id,source_operation_id,destination_operation_id,
      policy,amount,raw_actual_snapshot,funded_before,savings_entry_id,linked_item_id
    ) VALUES(v_batch_id,'unused_disposition','apply',v_source_month_id,v_destination_month_id,
      (candidate.item->>'category_id')::bigint,(candidate.item->>'source_budget_id')::bigint,
      v_destination_budget_id,v_source_operation_id,v_destination_operation_id,candidate.item->>'policy',
      (candidate.item->>'eligible_unused')::numeric,(candidate.item->>'source_raw_actual')::numeric,
      (candidate.item->>'source_final_funded')::numeric,v_savings_entry_id,v_carry_item_id);
  END LOOP;
  PERFORM public.budget_assert_reconciled(v_source_month_id);
  PERFORM public.budget_assert_reconciled(v_destination_month_id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('source',public.get_funded_budget_month(p_source_month),
    'destination',public.get_funded_budget_month(to_char(v_destination_start,'YYYY-MM')),
    'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
    'batch_id',v_batch_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.budget_month_disposition_candidate_rows(p_source_month TEXT)
RETURNS TABLE(
  category_id BIGINT,category_name TEXT,category_icon TEXT,source_budget_id BIGINT,policy TEXT,
  source_final_funded NUMERIC(18,2),source_raw_actual NUMERIC(18,2),
  source_effective_actual NUMERIC(18,2),eligible_amount NUMERIC(18,2),status TEXT,blocked_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_source_start DATE:=public.budget_month_start_from_key(p_source_month);
  v_destination_start DATE:=(v_source_start+interval '1 month')::date; v_source_id BIGINT;
BEGIN
  SELECT id INTO v_source_id FROM public.budget_months WHERE month_start=v_source_start;
  IF EXISTS(SELECT 1 FROM public.transactions WHERE movement_type='expense'
    AND transaction_date>=v_source_start AND transaction_date<v_destination_start
    AND total_amount::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'Month disposition actual spending contains a non-finite amount' USING ERRCODE='22003';
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions t WHERE t.movement_type='expense'
    AND t.transaction_date>=v_source_start AND t.transaction_date<v_destination_start
    GROUP BY t.category_id HAVING sum(t.total_amount)<>round(sum(t.total_amount),2)
      OR abs(sum(t.total_amount))>9999999999999999.99) THEN
    RAISE EXCEPTION 'Month disposition actual spending must fit finite NUMERIC(18,2) exactly' USING ERRCODE='22003';
  END IF;
  RETURN QUERY
  WITH actuals AS(
    SELECT t.category_id,sum(t.total_amount)::numeric(18,2) actual
    FROM public.transactions t WHERE t.movement_type='expense'
      AND t.transaction_date>=v_source_start AND t.transaction_date<v_destination_start GROUP BY t.category_id
  ),base AS(
    SELECT cs.budget_id,cs.category_id,cs.category_name,cs.category_icon,cs.category_type,
      c.is_active,cs.lifecycle_state,cs.final_funded::numeric(18,2) final_funded,
      coalesce(a.actual,0)::numeric(18,2) raw_actual,
      greatest(coalesce(a.actual,0),0)::numeric(18,2) effective_actual,
      greatest(cs.final_funded-greatest(coalesce(a.actual,0),0),0)::numeric(18,2) unused,
      p.policy,
      EXISTS(SELECT 1 FROM public.budget_operation_items original
        WHERE original.item_kind='unused_disposition' AND original.source_budget_id=cs.budget_id
          AND original.action_kind='apply' AND original.reversed_item_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM public.budget_operation_items correction
            WHERE correction.item_kind='unused_disposition' AND correction.reversed_item_id=original.id)) disposed,
      carry.status carry_status,carry.blocked_reason carry_blocked
    FROM public.budget_category_state cs JOIN public.categories c ON c.id=cs.category_id
    LEFT JOIN actuals a ON a.category_id=cs.category_id
    LEFT JOIN public.budget_unused_balance_policies p ON p.category_id=cs.category_id
    LEFT JOIN public.budget_carryover_candidate_rows(to_char(v_destination_start,'YYYY-MM')) carry
      ON p.policy='carry_forward' AND carry.category_id=cs.category_id
    WHERE cs.budget_month_id=v_source_id
  )
  SELECT b.category_id,b.category_name,b.category_icon,b.budget_id,b.policy,b.final_funded,
    b.raw_actual,b.effective_actual,b.unused,
    CASE WHEN b.disposed OR (b.policy='carry_forward' AND b.carry_status='already_applied') THEN 'already_applied'
      WHEN b.category_type<>'expense' OR NOT b.is_active OR b.lifecycle_state<>'active' THEN 'blocked'
      WHEN b.unused<=0 THEN 'ineligible' WHEN b.policy IS NULL THEN 'blocked'
      WHEN b.policy='carry_forward' AND b.carry_status IS DISTINCT FROM 'ready' THEN 'blocked'
      ELSE 'ready' END,
    CASE WHEN b.disposed OR (b.policy='carry_forward' AND b.carry_status='already_applied') THEN NULL
      WHEN b.category_type<>'expense' THEN 'CATEGORY_NOT_EXPENSE'
      WHEN NOT b.is_active THEN 'CATEGORY_INACTIVE'
      WHEN b.lifecycle_state<>'active' THEN 'SOURCE_BUDGET_INACTIVE'
      WHEN b.unused<=0 THEN NULL WHEN b.policy IS NULL THEN 'POLICY_UNCONFIGURED'
      WHEN b.policy='carry_forward' AND b.carry_status IS DISTINCT FROM 'ready'
        THEN coalesce(b.carry_blocked,'CARRY_FORWARD_NOT_READY') ELSE NULL END
  FROM base b ORDER BY b.category_name,b.category_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_budget_carryover(
  p_transfer_id BIGINT,p_request_key UUID,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_original public.budget_operation_items%ROWTYPE; v_original_root public.budget_operations%ROWTYPE;
  v_source public.budget_category_state%ROWTYPE; v_destination public.budget_category_state%ROWTYPE;
  v_source_month public.budget_months%ROWTYPE; v_destination_month public.budget_months%ROWTYPE;
  v_destination_actual NUMERIC(18,2); v_existing public.budget_operations%ROWTYPE;
  v_root_id BIGINT; v_source_operation_id BIGINT; v_destination_operation_id BIGINT;
  v_source_funding public.budget_funding_entries%ROWTYPE;
  v_destination_funding public.budget_funding_entries%ROWTYPE;
  v_source_movement_id BIGINT; v_destination_movement_id BIGINT;
  v_source_funding_id BIGINT; v_destination_funding_id BIGINT;
BEGIN
  IF p_transfer_id IS NULL OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'transfer_id and request_key are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_original FROM public.budget_operation_items
  WHERE id=p_transfer_id AND item_kind='carryover' AND category_id IS NOT NULL
    AND reversed_item_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original carryover transfer % does not exist',p_transfer_id USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_original_root FROM public.budget_operations WHERE id=v_original.operation_id;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'carryover_out'
       OR v_existing.request_fingerprint<>'carryover_reverse|'||p_transfer_id THEN
      RAISE EXCEPTION 'request_key was already used for a different carryover request' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'source',public.get_funded_budget_month((SELECT month FROM public.budget_month_funding_state
        WHERE budget_month_id=v_original.budget_month_id)),
      'destination',public.get_funded_budget_month((SELECT month FROM public.budget_month_funding_state
        WHERE budget_month_id=v_original.destination_budget_month_id)));
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_operation_items
    WHERE item_kind='carryover' AND reversed_item_id=p_transfer_id) THEN
    RAISE EXCEPTION 'Carryover transfer % has already been reversed',p_transfer_id USING ERRCODE='23505';
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  PERFORM 1 FROM public.budget_months
    WHERE id IN(v_original.budget_month_id,v_original.destination_budget_month_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.budgets
    WHERE id IN(v_original.source_budget_id,v_original.destination_budget_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'carryover_out'
       OR v_existing.request_fingerprint<>'carryover_reverse|'||p_transfer_id THEN
      RAISE EXCEPTION 'request_key was already used for a different carryover request' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'source',public.get_funded_budget_month((SELECT month FROM public.budget_month_funding_state
        WHERE budget_month_id=v_original.budget_month_id)),
      'destination',public.get_funded_budget_month((SELECT month FROM public.budget_month_funding_state
        WHERE budget_month_id=v_original.destination_budget_month_id)));
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_operation_items
    WHERE item_kind='carryover' AND reversed_item_id=p_transfer_id) THEN
    RAISE EXCEPTION 'Carryover transfer % has already been reversed',p_transfer_id USING ERRCODE='23505';
  END IF;
  SELECT * INTO v_source FROM public.budget_category_state WHERE budget_id=v_original.source_budget_id;
  SELECT * INTO v_destination FROM public.budget_category_state WHERE budget_id=v_original.destination_budget_id;
  SELECT * INTO v_source_month FROM public.budget_months WHERE id=v_original.budget_month_id;
  SELECT * INTO v_destination_month FROM public.budget_months WHERE id=v_original.destination_budget_month_id;
  IF v_source.lifecycle_state<>'active' OR v_destination.lifecycle_state<>'active' THEN
    RAISE EXCEPTION 'Carryover reversal requires active source and destination budgets' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions WHERE movement_type='expense'
    AND category_id=v_destination.category_id AND transaction_date>=v_destination_month.month_start
    AND transaction_date<(v_destination_month.month_start+interval '1 month')::date
    AND total_amount::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'Carryover actual spending contains a non-finite amount' USING ERRCODE='22003';
  END IF;
  SELECT greatest(coalesce(sum(total_amount),0),0)::numeric(18,2) INTO v_destination_actual
  FROM public.transactions WHERE movement_type='expense' AND category_id=v_destination.category_id
    AND transaction_date>=v_destination_month.month_start
    AND transaction_date<(v_destination_month.month_start+interval '1 month')::date;
  IF v_original.amount>greatest(v_destination.final_funded-v_destination_actual,0) THEN
    RAISE EXCEPTION 'Carryover reversal would release spent destination funding' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_source_funding FROM public.budget_funding_entries WHERE id=v_original.source_funding_entry_id;
  SELECT * INTO v_destination_funding FROM public.budget_funding_entries WHERE id=v_original.destination_funding_entry_id;

  v_root_id:=nullif(current_setting('finance_tracker.budget_root_operation_id',true),'')::bigint;
  IF v_root_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.budget_operations
    WHERE id=v_root_id AND parent_operation_id IS NULL AND reverses_operation_id=v_original.operation_id) THEN
    v_root_id:=public.budget_create_action_root(v_original.destination_budget_month_id,p_request_key,
      'carryover_reverse|'||p_transfer_id,'carryover_out',v_destination_month.month_start,
      p_reason,v_original.operation_id);
  END IF;
  INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,
    effective_date,reason,reverses_operation_id)
  VALUES(v_original.destination_budget_month_id,
    public.budget_derived_request_key(p_request_key,'destination-return'),
    'carryover_reverse|'||p_transfer_id,
    'carryover_out',v_destination_month.month_start,p_reason,v_original.destination_operation_id)
  RETURNING id INTO v_destination_operation_id;
  INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id)
  VALUES(v_destination_operation_id,-v_original.amount,'carryover_transfer',
    'Carryover reversal to '||to_char(v_source_month.month_start,'YYYY-MM'),v_destination_funding.id)
  RETURNING id INTO v_destination_funding_id;
  INSERT INTO public.budget_movements(operation_id,source_budget_id,amount)
  VALUES(v_destination_operation_id,v_original.destination_budget_id,v_original.amount)
  RETURNING id INTO v_destination_movement_id;
  INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,
    effective_date,reason,reverses_operation_id)
  VALUES(v_original.budget_month_id,public.budget_derived_request_key(p_request_key,'source-return'),
    'carryover_reverse_return|'||p_transfer_id,'carryover_in',v_source_month.month_start,p_reason,
    v_original.source_operation_id) RETURNING id INTO v_source_operation_id;
  INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id)
  VALUES(v_source_operation_id,v_original.amount,'carryover_transfer',
    'Carryover reversal from '||to_char(v_destination_month.month_start,'YYYY-MM'),v_source_funding.id)
  RETURNING id INTO v_source_funding_id;
  INSERT INTO public.budget_movements(operation_id,destination_budget_id,amount)
  VALUES(v_source_operation_id,v_original.source_budget_id,v_original.amount)
  RETURNING id INTO v_source_movement_id;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,category_id,
    source_budget_id,destination_budget_id,source_operation_id,destination_operation_id,
    amount,raw_actual_snapshot,funded_before,source_movement_id,destination_movement_id,
    source_funding_entry_id,destination_funding_entry_id,reversed_item_id
  ) VALUES(v_root_id,'carryover','reversal',v_original.budget_month_id,
    v_original.destination_budget_month_id,v_original.category_id,v_original.source_budget_id,
    v_original.destination_budget_id,v_source_operation_id,v_destination_operation_id,
    v_original.amount,v_original.raw_actual_snapshot,v_original.funded_before,
    v_source_movement_id,v_destination_movement_id,v_source_funding_id,v_destination_funding_id,p_transfer_id);
  PERFORM public.budget_assert_reconciled(v_original.budget_month_id);
  PERFORM public.budget_assert_reconciled(v_original.destination_budget_month_id);
  RETURN jsonb_build_object('source',public.get_funded_budget_month(to_char(v_source_month.month_start,'YYYY-MM')),
    'destination',public.get_funded_budget_month(to_char(v_destination_month.month_start,'YYYY-MM')));
END;
$$;

CREATE OR REPLACE FUNCTION public.budget_carryover_candidate_rows(p_destination_month TEXT)
RETURNS TABLE(
  category_id BIGINT,category_name TEXT,category_icon TEXT,
  source_budget_id BIGINT,destination_budget_id BIGINT,
  source_final_funded NUMERIC(18,2),source_raw_actual_spent NUMERIC(18,2),
  source_effective_actual_spent NUMERIC(18,2),eligible_amount NUMERIC(18,2),
  status TEXT,blocked_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_destination_start DATE:=public.budget_month_start_from_key(p_destination_month);
  v_source_start DATE:=(v_destination_start-interval '1 month')::date;
  v_source_id BIGINT; v_destination_id BIGINT; v_destination_initialized BOOLEAN:=false;
BEGIN
  SELECT id INTO v_source_id FROM public.budget_months WHERE month_start=v_source_start;
  SELECT id INTO v_destination_id FROM public.budget_months WHERE month_start=v_destination_start;
  IF v_destination_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.budget_operations
      WHERE budget_month_id=v_destination_id AND operation_type='month_initialization')
    INTO v_destination_initialized;
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions WHERE movement_type='expense'
    AND transaction_date>=v_source_start
    AND transaction_date<(v_destination_start+interval '1 month')::date
    AND total_amount::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'Carryover actual spending contains a non-finite amount' USING ERRCODE='22003';
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions t WHERE t.movement_type='expense'
    AND t.transaction_date>=v_source_start
    AND t.transaction_date<(v_destination_start+interval '1 month')::date
    GROUP BY t.category_id,date_trunc('month',t.transaction_date)
    HAVING sum(t.total_amount)<>round(sum(t.total_amount),2)
       OR abs(sum(t.total_amount))>9999999999999999.99) THEN
    RAISE EXCEPTION 'Carryover actual spending must fit finite NUMERIC(18,2) exactly' USING ERRCODE='22003';
  END IF;
  RETURN QUERY
  WITH source_actuals AS(
    SELECT t.category_id,sum(t.total_amount)::numeric(18,2) actual
    FROM public.transactions t WHERE t.movement_type='expense'
      AND t.transaction_date>=v_source_start AND t.transaction_date<v_destination_start
    GROUP BY t.category_id
  ),destination_actuals AS(
    SELECT t.category_id,sum(t.total_amount)::numeric(18,2) actual
    FROM public.transactions t WHERE t.movement_type='expense'
      AND t.transaction_date>=v_destination_start
      AND t.transaction_date<(v_destination_start+interval '1 month')::date
    GROUP BY t.category_id
  ),candidate AS(
    SELECT c.id category_id,c.name,c.icon,src.budget_id source_budget_id,
      dst.budget_id destination_budget_id,coalesce(src.final_funded,0)::numeric(18,2) source_final_funded,
      coalesce(sa.actual,0)::numeric(18,2) source_raw_actual_spent,
      greatest(coalesce(sa.actual,0),0)::numeric(18,2) source_effective_actual_spent,
      greatest(coalesce(src.final_funded,0)-greatest(coalesce(sa.actual,0),0),0)::numeric(18,2) eligible_amount,
      c.is_active,src.lifecycle_state source_lifecycle,dst.lifecycle_state destination_lifecycle,
      coalesce(da.actual,0)::numeric(18,2) destination_actual,
      coalesce(dst.final_funded,0)::numeric(18,2) destination_final,
      mo.category_id IS NOT NULL AND NOT v_destination_initialized override_pending,
      rd.category_id IS NOT NULL AND NOT v_destination_initialized recurring_pending,
      EXISTS(
        SELECT 1 FROM public.budget_operation_items original
        WHERE original.item_kind='carryover' AND original.category_id IS NOT NULL
          AND original.source_budget_id=src.budget_id AND original.reversed_item_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM public.budget_operation_items correction
            WHERE correction.item_kind='carryover' AND correction.reversed_item_id=original.id)
      ) already_applied
    FROM public.budget_unused_balance_policies policy
    JOIN public.categories c ON c.id=policy.category_id
    LEFT JOIN public.budget_category_state src
      ON src.budget_month_id=v_source_id AND src.category_id=c.id
    LEFT JOIN source_actuals sa ON sa.category_id=c.id
    LEFT JOIN public.budget_category_state dst
      ON dst.budget_month_id=v_destination_id AND dst.category_id=c.id
    LEFT JOIN destination_actuals da ON da.category_id=c.id
    LEFT JOIN public.budget_recurring_defaults rd ON rd.category_id=c.id
    LEFT JOIN public.budget_month_overrides mo
      ON mo.budget_month_id=v_destination_id AND mo.category_id=c.id
    WHERE policy.policy='carry_forward' AND c.type='expense'
  )
  SELECT candidate.category_id,candidate.name,candidate.icon,candidate.source_budget_id,
    candidate.destination_budget_id,candidate.source_final_funded,
    candidate.source_raw_actual_spent,candidate.source_effective_actual_spent,candidate.eligible_amount,
    CASE WHEN candidate.already_applied THEN 'already_applied'
      WHEN NOT candidate.is_active OR candidate.source_budget_id IS NULL
        OR candidate.source_lifecycle<>'active' OR candidate.eligible_amount<=0 THEN 'blocked'
      WHEN candidate.destination_budget_id IS NOT NULL AND candidate.destination_lifecycle<>'active' THEN 'blocked'
      WHEN candidate.destination_budget_id IS NULL AND (candidate.override_pending OR candidate.recurring_pending) THEN 'blocked'
      WHEN candidate.destination_budget_id IS NULL AND candidate.destination_actual>0 THEN 'blocked'
      WHEN candidate.destination_budget_id IS NOT NULL AND candidate.destination_actual>candidate.destination_final THEN 'blocked'
      ELSE 'ready' END,
    CASE WHEN candidate.already_applied THEN NULL
      WHEN NOT candidate.is_active THEN 'CATEGORY_INACTIVE'
      WHEN candidate.source_budget_id IS NULL THEN 'SOURCE_BUDGET_MISSING'
      WHEN candidate.source_lifecycle<>'active' THEN 'SOURCE_BUDGET_INACTIVE'
      WHEN candidate.eligible_amount<=0 THEN 'NO_ELIGIBLE_BALANCE'
      WHEN candidate.destination_budget_id IS NOT NULL AND candidate.destination_lifecycle<>'active'
        THEN 'DESTINATION_BUDGET_INACTIVE'
      WHEN candidate.destination_budget_id IS NULL AND candidate.override_pending
        THEN 'MONTH_OVERRIDE_INITIALIZATION_REQUIRED'
      WHEN candidate.destination_budget_id IS NULL AND candidate.recurring_pending
        THEN 'RECURRING_INITIALIZATION_REQUIRED'
      WHEN candidate.destination_budget_id IS NULL AND candidate.destination_actual>0
        THEN 'UNBUDGETED_ACTUAL_EXISTS'
      WHEN candidate.destination_budget_id IS NOT NULL AND candidate.destination_actual>candidate.destination_final
        THEN 'DESTINATION_DEFICIT'
      ELSE NULL END
  FROM candidate ORDER BY candidate.name,candidate.category_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_budget_carryover(
  p_destination_month TEXT,p_request_key UUID,p_preview_fingerprint TEXT,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_destination_start DATE:=public.budget_month_start_from_key(p_destination_month);
  v_source_start DATE:=(v_destination_start-interval '1 month')::date;
  v_current_start DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_source_month_id BIGINT; v_destination_month_id BIGINT; v_root_id BIGINT;
  v_existing public.budget_operations%ROWTYPE; v_preview JSONB; v_fingerprint TEXT;
  v_source_operation_id BIGINT; v_destination_operation_id BIGINT; v_destination_budget_id BIGINT;
  v_source_movement_id BIGINT; v_destination_movement_id BIGINT;
  v_source_funding_id BIGINT; v_destination_funding_id BIGINT; v_lifecycle_id BIGINT;
  candidate RECORD;
BEGIN
  IF p_request_key IS NULL OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'request_key and a valid preview fingerprint are required' USING ERRCODE='22023';
  END IF;
  IF v_destination_start<>v_current_start THEN
    RAISE EXCEPTION 'Carryover can be applied only to the current Asia/Jerusalem month' USING ERRCODE='22023';
  END IF;
  v_fingerprint:='carryover_apply|'||p_destination_month||'|'||p_preview_fingerprint;
  SELECT root.* INTO v_existing
  FROM public.budget_operations root
  WHERE root.parent_operation_id IS NULL
    AND (root.request_key=p_request_key OR (root.operation_type='month_close'
      AND public.budget_derived_request_key(root.request_key,'carry-forward-batch')=p_request_key))
    AND EXISTS(SELECT 1 FROM public.budget_operation_items i
      WHERE i.operation_id=root.id AND i.item_kind='carryover' AND i.category_id IS NULL);
  IF FOUND THEN
    IF v_existing.operation_type<>'month_close' AND v_existing.request_fingerprint<>v_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different carryover request' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('source',public.get_funded_budget_month(to_char(v_source_start,'YYYY-MM')),
      'destination',public.get_funded_budget_month(p_destination_month));
  END IF;
  SELECT id INTO v_source_month_id FROM public.budget_months WHERE month_start=v_source_start;
  IF v_source_month_id IS NULL THEN RAISE EXCEPTION 'Previous month has no funded budget state' USING ERRCODE='23514'; END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  INSERT INTO public.budget_months(month_start) VALUES(v_destination_start) ON CONFLICT(month_start) DO NOTHING;
  SELECT id INTO v_destination_month_id FROM public.budget_months WHERE month_start=v_destination_start;
  PERFORM 1 FROM public.budget_months WHERE id IN(v_source_month_id,v_destination_month_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id IN(v_source_month_id,v_destination_month_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories c JOIN public.budget_unused_balance_policies p ON p.category_id=c.id
    WHERE p.policy='carry_forward' ORDER BY c.id FOR SHARE OF c;
  PERFORM 1 FROM public.budget_unused_balance_policies WHERE policy='carry_forward' ORDER BY category_id FOR SHARE;
  PERFORM public.budget_assert_reconciled(v_source_month_id);
  PERFORM public.budget_assert_reconciled(v_destination_month_id);

  SELECT root.* INTO v_existing FROM public.budget_operations root
  WHERE root.parent_operation_id IS NULL
    AND (root.request_key=p_request_key OR (root.operation_type='month_close'
      AND public.budget_derived_request_key(root.request_key,'carry-forward-batch')=p_request_key))
    AND EXISTS(SELECT 1 FROM public.budget_operation_items i
      WHERE i.operation_id=root.id AND i.item_kind='carryover' AND i.category_id IS NULL);
  IF FOUND THEN
    IF v_existing.operation_type<>'month_close' AND v_existing.request_fingerprint<>v_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different carryover request' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('source',public.get_funded_budget_month(to_char(v_source_start,'YYYY-MM')),
      'destination',public.get_funded_budget_month(p_destination_month));
  END IF;
  v_preview:=public.get_budget_carryover_preview(p_destination_month);
  IF v_preview->>'fingerprint' IS DISTINCT FROM p_preview_fingerprint THEN
    RAISE EXCEPTION 'CARRYOVER_PREVIEW_STALE: carryover candidate material changed; refresh before applying'
      USING ERRCODE='40001';
  END IF;
  v_root_id:=nullif(current_setting('finance_tracker.budget_root_operation_id',true),'')::bigint;
  IF v_root_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.budget_operations
    WHERE id=v_root_id AND parent_operation_id IS NULL AND operation_type='month_close') THEN
    v_root_id:=public.budget_create_action_root(v_source_month_id,p_request_key,v_fingerprint,
      'carryover_out',v_source_start,p_reason,NULL);
  END IF;
  INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id)
  VALUES(v_root_id,'carryover','apply',v_source_month_id,v_destination_month_id);
  FOR candidate IN SELECT item FROM jsonb_array_elements(v_preview->'ready_categories') captured(item)
    ORDER BY (item->>'category_id')::bigint
  LOOP
    INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason)
    VALUES(v_source_month_id,public.budget_derived_request_key(p_request_key,'source|'||(candidate.item->>'category_id')),
      'carryover_out|'||v_root_id||'|'||(candidate.item->>'category_id')||'|'||(candidate.item->>'amount'),
      'carryover_out',v_source_start,p_reason) RETURNING id INTO v_source_operation_id;
    INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
    VALUES(v_source_operation_id,-(candidate.item->>'amount')::numeric(18,2),'carryover_transfer',
      'Carryover to '||p_destination_month) RETURNING id INTO v_source_funding_id;
    INSERT INTO public.budget_movements(operation_id,source_budget_id,amount)
    VALUES(v_source_operation_id,(candidate.item->>'source_budget_id')::bigint,
      (candidate.item->>'amount')::numeric(18,2)) RETURNING id INTO v_source_movement_id;
    INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason)
    VALUES(v_destination_month_id,public.budget_derived_request_key(p_request_key,'destination|'||(candidate.item->>'category_id')),
      'carryover_in|'||v_root_id||'|'||(candidate.item->>'category_id')||'|'||(candidate.item->>'amount'),
      'carryover_in',v_destination_start,p_reason) RETURNING id INTO v_destination_operation_id;
    v_lifecycle_id:=NULL;
    IF candidate.item->>'destination_budget_id' IS NULL THEN
      INSERT INTO public.budgets(category_id,month,amount,budget_month_id,starting_amount,starting_kind,created_by_operation_id)
      VALUES((candidate.item->>'category_id')::bigint,p_destination_month,0,v_destination_month_id,0,
        'carryover_only',v_destination_operation_id) RETURNING id INTO v_destination_budget_id;
      INSERT INTO public.budget_lifecycle_events(operation_id,budget_id,state)
      VALUES(v_destination_operation_id,v_destination_budget_id,'active') RETURNING id INTO v_lifecycle_id;
    ELSE v_destination_budget_id:=(candidate.item->>'destination_budget_id')::bigint; END IF;
    INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
    VALUES(v_destination_operation_id,(candidate.item->>'amount')::numeric(18,2),'carryover_transfer',
      'Carryover from '||to_char(v_source_start,'YYYY-MM')) RETURNING id INTO v_destination_funding_id;
    INSERT INTO public.budget_movements(operation_id,destination_budget_id,amount)
    VALUES(v_destination_operation_id,v_destination_budget_id,(candidate.item->>'amount')::numeric(18,2))
    RETURNING id INTO v_destination_movement_id;
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,category_id,
      source_budget_id,destination_budget_id,source_operation_id,destination_operation_id,
      amount,raw_actual_snapshot,funded_before,source_movement_id,destination_movement_id,
      source_funding_entry_id,destination_funding_entry_id,lifecycle_event_id
    ) VALUES(v_root_id,'carryover','apply',v_source_month_id,v_destination_month_id,
      (candidate.item->>'category_id')::bigint,(candidate.item->>'source_budget_id')::bigint,
      v_destination_budget_id,v_source_operation_id,v_destination_operation_id,
      (candidate.item->>'amount')::numeric(18,2),(candidate.item->>'source_raw_actual_spent')::numeric(18,2),
      (candidate.item->>'source_final_funded')::numeric(18,2),v_source_movement_id,v_destination_movement_id,
      v_source_funding_id,v_destination_funding_id,v_lifecycle_id);
  END LOOP;
  PERFORM public.budget_assert_reconciled(v_source_month_id);
  PERFORM public.budget_assert_reconciled(v_destination_month_id);
  RETURN jsonb_build_object('source',public.get_funded_budget_month(to_char(v_source_start,'YYYY-MM')),
    'destination',public.get_funded_budget_month(p_destination_month));
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_budget_month_override(
  p_month TEXT,p_category_id BIGINT,p_request_key UUID,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_current_start DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_month_id BIGINT; v_override NUMERIC(18,2); v_budget public.budget_category_state%ROWTYPE;
  v_base public.budget_category_composition%ROWTYPE; v_existing public.budget_operations%ROWTYPE;
  v_fingerprint TEXT; v_operation_id BIGINT; v_movement_id BIGINT; v_lifecycle_id BIGINT;
  v_delta NUMERIC(18,2); v_unallocated NUMERIC(18,2); v_raw_actual NUMERIC;
  v_effective_actual NUMERIC(18,2):=0; v_eligible_release NUMERIC(18,2);
  v_fallback NUMERIC(18,2); v_fallback_source TEXT; v_new_final NUMERIC(18,2);
BEGIN
  IF p_request_key IS NULL OR p_category_id IS NULL THEN
    RAISE EXCEPTION 'month, category_id, and request_key are required' USING ERRCODE='22023';
  END IF;
  IF v_month_start<v_current_start THEN
    RAISE EXCEPTION 'HISTORICAL_MONTH_OVERRIDE_FORBIDDEN: month overrides are limited to current/future Asia/Jerusalem months'
      USING ERRCODE='22023';
  END IF;
  v_fingerprint:='month_override_remove|'||p_month||'|'||p_category_id;
  LOCK TABLE public.transactions IN SHARE MODE;
  INSERT INTO public.budget_months(month_start) VALUES(v_month_start) ON CONFLICT(month_start) DO NOTHING;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories WHERE id=p_category_id FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.categories WHERE id=p_category_id AND type='expense') THEN
    RAISE EXCEPTION 'Month overrides are available only for expense categories' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.budget_recurring_defaults WHERE category_id=p_category_id FOR SHARE;
  PERFORM 1 FROM public.budget_month_overrides
    WHERE budget_month_id=v_month_id AND category_id=p_category_id FOR UPDATE;

  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint<>v_fingerprint
       OR NOT EXISTS(SELECT 1 FROM public.budget_operation_items
         WHERE operation_id=coalesce(v_existing.parent_operation_id,v_existing.id)
           AND item_kind='month_override' AND action_kind='remove') THEN
      RAISE EXCEPTION 'request_key was already used for a different month override request' USING ERRCODE='23505';
    END IF;
    RETURN public.get_funded_budget_month(p_month);
  END IF;

  SELECT amount INTO v_override FROM public.budget_month_overrides
    WHERE budget_month_id=v_month_id AND category_id=p_category_id;
  SELECT * INTO v_budget FROM public.budget_category_state
    WHERE budget_month_id=v_month_id AND category_id=p_category_id;
  SELECT coalesce(amount,0)::numeric(18,2),
    CASE WHEN amount IS NULL THEN 'none' ELSE 'recurring_default' END
  INTO v_fallback,v_fallback_source
  FROM (SELECT (SELECT amount FROM public.budget_recurring_defaults
                WHERE category_id=p_category_id) AS amount) recurring;

  IF v_budget.budget_id IS NULL THEN
    v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,v_fingerprint,
      'monthly_override_remove',v_month_start,p_reason,NULL);
    IF v_override IS NOT NULL THEN
      DELETE FROM public.budget_month_overrides
      WHERE budget_month_id=v_month_id AND category_id=p_category_id;
    END IF;
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,category_id,
      base_before,base_after,fallback_base_snapshot,source_kind
    ) VALUES(v_operation_id,'month_override','remove',v_month_id,p_category_id,
      coalesce(v_override,v_fallback),v_fallback,v_fallback,v_fallback_source);
    RETURN public.get_funded_budget_month(p_month);
  END IF;
  SELECT * INTO v_base FROM public.budget_category_composition WHERE budget_id=v_budget.budget_id;
  IF v_override IS NULL THEN
    v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,v_fingerprint,
      'monthly_override_remove',v_month_start,p_reason,NULL);
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
      base_before,base_after,fallback_base_snapshot,source_kind
    ) VALUES(v_operation_id,'month_override','remove',v_month_id,p_category_id,v_budget.budget_id,
      v_base.effective_base,v_base.effective_base,v_base.fallback_base,v_base.fallback_source);
    RETURN public.get_funded_budget_month(p_month);
  END IF;
  IF v_budget.lifecycle_state<>'active' THEN
    RAISE EXCEPTION 'Month override removal requires an active category budget' USING ERRCODE='23514';
  END IF;
  v_delta:=v_base.fallback_base-v_base.effective_base;
  IF EXISTS(SELECT 1 FROM public.transactions WHERE movement_type='expense'
    AND category_id=p_category_id AND transaction_date>=v_month_start
    AND transaction_date<(v_month_start+interval '1 month')::date
    AND total_amount::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'Month override actual spending contains a non-finite amount' USING ERRCODE='22003';
  END IF;
  SELECT coalesce(sum(total_amount),0) INTO v_raw_actual FROM public.transactions
  WHERE movement_type='expense' AND category_id=p_category_id
    AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date;
  IF v_raw_actual<>round(v_raw_actual,2) OR abs(v_raw_actual)>9999999999999999.99 THEN
    RAISE EXCEPTION 'Month override actual spending must fit finite NUMERIC(18,2) exactly' USING ERRCODE='22003';
  END IF;
  v_effective_actual:=greatest(v_raw_actual,0)::numeric(18,2);
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_month_id;
  IF v_delta>0 AND v_delta>v_unallocated THEN
    RAISE EXCEPTION 'MONTH_OVERRIDE_INSUFFICIENT_FUNDS: required %, available %, shortfall %',
      v_delta,v_unallocated,(v_delta-v_unallocated)::numeric(18,2) USING ERRCODE='23514';
  END IF;
  IF v_delta<0 THEN
    v_eligible_release:=least(greatest(v_base.effective_base-v_effective_actual,0),
      greatest(v_base.final_funded-v_effective_actual,0))::numeric(18,2);
    IF -v_delta>v_eligible_release THEN
      RAISE EXCEPTION 'MONTH_OVERRIDE_RELEASE_BLOCKED: requested release %, eligible release %, shortfall %',
        -v_delta,v_eligible_release,(-v_delta-v_eligible_release)::numeric(18,2) USING ERRCODE='23514';
    END IF;
  END IF;
  v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,v_fingerprint,
    'monthly_override_remove',v_month_start,p_reason,NULL);
  IF v_delta<>0 THEN
    INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
    VALUES(v_operation_id,CASE WHEN v_delta<0 THEN v_budget.budget_id END,
      CASE WHEN v_delta>0 THEN v_budget.budget_id END,abs(v_delta)) RETURNING id INTO v_movement_id;
  END IF;
  DELETE FROM public.budget_month_overrides
  WHERE budget_month_id=v_month_id AND category_id=p_category_id;
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
    base_before,base_after,fallback_base_snapshot,source_kind,movement_id
  ) VALUES(v_operation_id,'month_override','remove',v_month_id,p_category_id,v_budget.budget_id,
    v_base.effective_base,v_base.fallback_base,v_base.fallback_base,v_base.fallback_source,v_movement_id);
  v_new_final:=v_base.final_funded+v_delta;
  IF v_base.fallback_base=0 AND v_new_final=0 AND v_effective_actual=0
     AND v_base.incoming_carryover=0 AND v_base.outgoing_carryover=0
     AND v_base.incoming_reallocation_resolution=0 AND v_base.outgoing_reallocation=0
     AND v_base.unbudgeted_resolution_adjustment=0
     AND v_base.unused_disposition_adjustment=0 AND v_base.other_adjustments=0 THEN
    INSERT INTO public.budget_lifecycle_events(operation_id,budget_id,state,actual_spent_snapshot)
    VALUES(v_operation_id,v_budget.budget_id,'inactive',0) RETURNING id INTO v_lifecycle_id;
  END IF;
  PERFORM public.budget_assert_reconciled(v_month_id);
  RETURN public.get_funded_budget_month(p_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_budget_recurring_defaults(
  p_month TEXT,p_request_key UUID,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_current_month DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_month_id BIGINT; v_operation_id BIGINT; v_budget_id BIGINT; v_lifecycle_id BIGINT;
  v_existing public.budget_operations%ROWTYPE; v_required NUMERIC(18,2):=0;
  v_unallocated NUMERIC(18,2):=0; v_fingerprint TEXT:='month_initialization|'||p_month;
  candidate RECORD;
BEGIN
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'request_key is required' USING ERRCODE='22023'; END IF;
  IF v_month_start<v_current_month THEN
    RAISE EXCEPTION 'Recurring budgets cannot be initialized for a historical month' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.budget_months(month_start) VALUES(v_month_start) ON CONFLICT(month_start) DO NOTHING;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories c WHERE c.id IN(
    SELECT category_id FROM public.budget_recurring_defaults
    UNION SELECT category_id FROM public.budget_month_overrides WHERE budget_month_id=v_month_id
  ) ORDER BY c.id FOR SHARE;
  PERFORM 1 FROM public.budget_recurring_defaults ORDER BY category_id FOR SHARE;
  PERFORM 1 FROM public.budget_month_overrides WHERE budget_month_id=v_month_id ORDER BY category_id FOR SHARE;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.budget_month_id<>v_month_id OR v_existing.operation_type<>'month_initialization'
       OR v_existing.request_fingerprint<>v_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation' USING ERRCODE='23505';
    END IF;
    RETURN public.get_funded_budget_month(p_month);
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_operations
    WHERE budget_month_id=v_month_id AND operation_type='month_initialization') THEN
    RETURN public.get_funded_budget_month(p_month);
  END IF;
  WITH category_config AS(
    SELECT category_id FROM public.budget_recurring_defaults
    UNION SELECT category_id FROM public.budget_month_overrides WHERE budget_month_id=v_month_id
  )
  SELECT coalesce(sum(CASE WHEN mo.category_id IS NOT NULL THEN mo.amount ELSE rd.amount END),0)::numeric(18,2)
  INTO v_required FROM category_config keys
  JOIN public.categories c ON c.id=keys.category_id
  LEFT JOIN public.budget_recurring_defaults rd ON rd.category_id=keys.category_id
  LEFT JOIN public.budget_month_overrides mo ON mo.budget_month_id=v_month_id AND mo.category_id=keys.category_id
  LEFT JOIN public.budgets b ON b.budget_month_id=v_month_id AND b.category_id=keys.category_id
  WHERE c.type='expense' AND c.is_active AND b.id IS NULL;
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_month_id;
  IF v_required>v_unallocated THEN
    RAISE EXCEPTION 'MONTH_OVERRIDE_INSUFFICIENT_FUNDS: required %, available %, shortfall %',
      v_required,v_unallocated,(v_required-v_unallocated)::numeric(18,2) USING ERRCODE='23514';
  END IF;
  v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,v_fingerprint,
    'month_initialization',v_month_start,p_reason,NULL);
  FOR candidate IN
    WITH category_config AS(
      SELECT category_id FROM public.budget_recurring_defaults
      UNION SELECT category_id FROM public.budget_month_overrides WHERE budget_month_id=v_month_id
    )
    SELECT keys.category_id,
      CASE WHEN mo.category_id IS NOT NULL THEN mo.amount ELSE rd.amount END::numeric(18,2) amount,
      CASE WHEN mo.category_id IS NOT NULL THEN 'monthly_override' ELSE 'recurring_default' END starting_kind,
      coalesce(rd.amount,0)::numeric(18,2) fallback_base,
      CASE WHEN rd.category_id IS NULL THEN 'none' ELSE 'recurring_default' END fallback_source,
      mo.category_id IS NOT NULL has_override
    FROM category_config keys JOIN public.categories c ON c.id=keys.category_id
    LEFT JOIN public.budget_recurring_defaults rd ON rd.category_id=keys.category_id
    LEFT JOIN public.budget_month_overrides mo ON mo.budget_month_id=v_month_id AND mo.category_id=keys.category_id
    LEFT JOIN public.budgets b ON b.budget_month_id=v_month_id AND b.category_id=keys.category_id
    WHERE c.type='expense' AND c.is_active AND b.id IS NULL ORDER BY keys.category_id
  LOOP
    INSERT INTO public.budgets(category_id,month,amount,budget_month_id,starting_amount,
      starting_kind,created_by_operation_id)
    VALUES(candidate.category_id,p_month,candidate.amount,v_month_id,candidate.amount,
      candidate.starting_kind,v_operation_id) RETURNING id INTO v_budget_id;
    INSERT INTO public.budget_lifecycle_events(operation_id,budget_id,state)
    VALUES(v_operation_id,v_budget_id,'active') RETURNING id INTO v_lifecycle_id;
    IF candidate.has_override THEN
      INSERT INTO public.budget_operation_items(
        operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
        amount,base_before,base_after,fallback_base_snapshot,source_kind,lifecycle_event_id
      ) VALUES(v_operation_id,'month_override','initialize',v_month_id,candidate.category_id,v_budget_id,
        candidate.amount,candidate.fallback_base,candidate.amount,candidate.fallback_base,
        candidate.fallback_source,v_lifecycle_id);
    END IF;
  END LOOP;
  PERFORM public.budget_assert_reconciled(v_month_id);
  RETURN public.get_funded_budget_month(p_month);
END;
$$;

-- The policy table was renamed in Migration 021; finish the internal naming
-- cleanup now that the old carryover-setting read aliases are being removed.
CREATE OR REPLACE FUNCTION public.validate_budget_unused_balance_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id=NEW.category_id AND type='expense'
  ) THEN
    RAISE EXCEPTION 'Unused-balance policies are available only for expense categories'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_category_type_with_unused_balance_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF OLD.type='expense' AND NEW.type<>'expense' AND EXISTS (
    SELECT 1 FROM public.budget_unused_balance_policies WHERE category_id=OLD.id
  ) THEN
    RAISE EXCEPTION 'Remove the unused-balance policy before changing this category type'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER budget_unused_balance_policies_validate ON public.budget_unused_balance_policies;
CREATE TRIGGER budget_unused_balance_policies_validate
BEFORE INSERT OR UPDATE ON public.budget_unused_balance_policies
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_unused_balance_policy();

DROP TRIGGER categories_carryover_type_guard ON public.categories;
CREATE TRIGGER categories_unused_balance_policy_guard
BEFORE UPDATE OF type ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_category_type_with_unused_balance_policy();

-- Override readers and commands now use the canonical composition and typed
-- operation items directly.
CREATE OR REPLACE FUNCTION public.get_budget_month_override_preview(p_month TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_current_start DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_month_id BIGINT; v_rows JSONB;
BEGIN
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'category_id',mo.category_id,
    'category',jsonb_build_object('name',c.name,'icon',c.icon,'type',c.type),
    'amount',mo.amount::numeric(18,2)::text,
    'initialized',composition.budget_id IS NOT NULL,
    'fallback_base',coalesce(composition.fallback_base,rd.amount,0)::numeric(18,2)::text,
    'fallback_source',coalesce(composition.fallback_source,
      CASE WHEN rd.category_id IS NULL THEN 'none' ELSE 'recurring_default' END),
    'effective_base',coalesce(composition.effective_base,mo.amount)::numeric(18,2)::text
  ) ORDER BY c.name,mo.category_id),'[]'::jsonb) INTO v_rows
  FROM public.budget_month_overrides mo
  JOIN public.categories c ON c.id=mo.category_id
  LEFT JOIN public.budget_category_composition composition
    ON composition.budget_month_id=mo.budget_month_id AND composition.category_id=mo.category_id
  LEFT JOIN public.budget_recurring_defaults rd ON rd.category_id=mo.category_id
  WHERE mo.budget_month_id=v_month_id;
  RETURN jsonb_build_object('eligible',v_month_start>=v_current_start,
    'month',p_month,'overrides',v_rows,'count',jsonb_array_length(v_rows));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_budget_month_override(
  p_month TEXT,p_category_id BIGINT,p_amount NUMERIC,p_request_key UUID,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_current_start DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_month_id BIGINT; v_budget public.budget_category_state%ROWTYPE;
  v_base public.budget_category_composition%ROWTYPE; v_existing public.budget_operations%ROWTYPE;
  v_initialized BOOLEAN; v_fingerprint TEXT; v_operation_id BIGINT; v_item_id BIGINT;
  v_movement_id BIGINT; v_lifecycle_id BIGINT; v_delta NUMERIC(18,2);
  v_unallocated NUMERIC(18,2); v_raw_actual NUMERIC; v_effective_actual NUMERIC(18,2);
  v_base_headroom NUMERIC(18,2); v_total_headroom NUMERIC(18,2);
  v_eligible_release NUMERIC(18,2); v_fallback NUMERIC(18,2);
  v_fallback_source TEXT; v_prior_override NUMERIC(18,2);
BEGIN
  IF p_request_key IS NULL OR p_category_id IS NULL OR p_amount IS NULL THEN
    RAISE EXCEPTION 'month, category_id, amount, and request_key are required' USING ERRCODE='22023';
  END IF;
  IF p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<0
     OR p_amount<>round(p_amount,2) OR p_amount>9999999999999999.99 THEN
    RAISE EXCEPTION 'Month override amount must be a finite nonnegative two-decimal value'
      USING ERRCODE='22023';
  END IF;
  IF v_month_start<v_current_start THEN
    RAISE EXCEPTION 'HISTORICAL_MONTH_OVERRIDE_FORBIDDEN: month overrides are limited to current/future Asia/Jerusalem months'
      USING ERRCODE='22023';
  END IF;
  v_fingerprint:='month_override_set|'||p_month||'|'||p_category_id||'|'||p_amount::numeric(18,2)::text;
  LOCK TABLE public.transactions IN SHARE MODE;
  INSERT INTO public.budget_months(month_start) VALUES(v_month_start) ON CONFLICT(month_start) DO NOTHING;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories WHERE id=p_category_id FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.categories WHERE id=p_category_id AND type='expense' AND is_active) THEN
    RAISE EXCEPTION 'Month overrides are available only for active expense categories' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.budget_recurring_defaults WHERE category_id=p_category_id FOR SHARE;
  PERFORM 1 FROM public.budget_month_overrides
    WHERE budget_month_id=v_month_id AND category_id=p_category_id FOR UPDATE;

  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint<>v_fingerprint
       OR NOT EXISTS(SELECT 1 FROM public.budget_operation_items
         WHERE operation_id=coalesce(v_existing.parent_operation_id,v_existing.id)
           AND item_kind='month_override') THEN
      RAISE EXCEPTION 'request_key was already used for a different month override request' USING ERRCODE='23505';
    END IF;
    RETURN public.get_funded_budget_month(p_month);
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.budget_operations
    WHERE budget_month_id=v_month_id AND operation_type='month_initialization') INTO v_initialized;
  SELECT * INTO v_budget FROM public.budget_category_state
    WHERE budget_month_id=v_month_id AND category_id=p_category_id;
  SELECT amount INTO v_prior_override FROM public.budget_month_overrides
    WHERE budget_month_id=v_month_id AND category_id=p_category_id;
  SELECT coalesce(amount,0)::numeric(18,2),
    CASE WHEN amount IS NULL THEN 'none' ELSE 'recurring_default' END
  INTO v_fallback,v_fallback_source
  FROM (SELECT (SELECT amount FROM public.budget_recurring_defaults
                WHERE category_id=p_category_id) AS amount) recurring;

  IF v_budget.budget_id IS NULL AND NOT v_initialized THEN
    v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,v_fingerprint,
      'monthly_override_set',v_month_start,p_reason,NULL);
    INSERT INTO public.budget_month_overrides(budget_month_id,category_id,amount)
    VALUES(v_month_id,p_category_id,p_amount::numeric(18,2))
    ON CONFLICT(budget_month_id,category_id) DO UPDATE
    SET amount=EXCLUDED.amount,updated_at=timezone('utc'::text,now());
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,category_id,amount,
      base_before,base_after,fallback_base_snapshot,source_kind
    ) VALUES(v_operation_id,'month_override','set',v_month_id,p_category_id,p_amount,
      coalesce(v_prior_override,v_fallback),p_amount,v_fallback,v_fallback_source);
    RETURN public.get_funded_budget_month(p_month);
  END IF;

  IF v_budget.budget_id IS NULL THEN
    SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_unallocated
    FROM public.budget_month_funding_state WHERE budget_month_id=v_month_id;
    IF p_amount>v_unallocated THEN
      RAISE EXCEPTION 'MONTH_OVERRIDE_INSUFFICIENT_FUNDS: required %, available %, shortfall %',
        p_amount::numeric(18,2),v_unallocated,(p_amount-v_unallocated)::numeric(18,2)
        USING ERRCODE='23514';
    END IF;
    v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,v_fingerprint,
      'monthly_override_set',v_month_start,p_reason,NULL);
    INSERT INTO public.budgets(category_id,month,amount,budget_month_id,starting_amount,
      starting_kind,created_by_operation_id)
    VALUES(p_category_id,p_month,p_amount,v_month_id,p_amount,'monthly_override',v_operation_id)
    RETURNING id INTO v_budget.budget_id;
    INSERT INTO public.budget_lifecycle_events(operation_id,budget_id,state)
    VALUES(v_operation_id,v_budget.budget_id,'active') RETURNING id INTO v_lifecycle_id;
    INSERT INTO public.budget_month_overrides(budget_month_id,category_id,amount)
    VALUES(v_month_id,p_category_id,p_amount);
    INSERT INTO public.budget_operation_items(
      operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
      amount,base_before,base_after,fallback_base_snapshot,source_kind,lifecycle_event_id
    ) VALUES(v_operation_id,'month_override','initialize',v_month_id,p_category_id,v_budget.budget_id,
      p_amount,v_fallback,p_amount,v_fallback,v_fallback_source,v_lifecycle_id);
    PERFORM public.budget_assert_reconciled(v_month_id);
    RETURN public.get_funded_budget_month(p_month);
  END IF;

  IF v_budget.lifecycle_state<>'active' THEN
    RAISE EXCEPTION 'Month override requires an active category budget' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_base FROM public.budget_category_composition WHERE budget_id=v_budget.budget_id;
  v_delta:=p_amount::numeric(18,2)-v_base.effective_base;
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_month_id;
  IF v_delta>0 AND v_delta>v_unallocated THEN
    RAISE EXCEPTION 'MONTH_OVERRIDE_INSUFFICIENT_FUNDS: required %, available %, shortfall %',
      v_delta,v_unallocated,(v_delta-v_unallocated)::numeric(18,2) USING ERRCODE='23514';
  END IF;
  IF v_delta<0 THEN
    IF EXISTS(SELECT 1 FROM public.transactions WHERE movement_type='expense'
      AND category_id=p_category_id AND transaction_date>=v_month_start
      AND transaction_date<(v_month_start+interval '1 month')::date
      AND total_amount::text IN ('NaN','Infinity','-Infinity')) THEN
      RAISE EXCEPTION 'Month override actual spending contains a non-finite amount' USING ERRCODE='22003';
    END IF;
    SELECT coalesce(sum(total_amount),0) INTO v_raw_actual FROM public.transactions
    WHERE movement_type='expense' AND category_id=p_category_id
      AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date;
    IF v_raw_actual<>round(v_raw_actual,2) OR abs(v_raw_actual)>9999999999999999.99 THEN
      RAISE EXCEPTION 'Month override actual spending must fit finite NUMERIC(18,2) exactly' USING ERRCODE='22003';
    END IF;
    v_effective_actual:=greatest(v_raw_actual,0)::numeric(18,2);
    v_base_headroom:=greatest(v_base.effective_base-v_effective_actual,0)::numeric(18,2);
    v_total_headroom:=greatest(v_base.final_funded-v_effective_actual,0)::numeric(18,2);
    v_eligible_release:=least(v_base_headroom,v_total_headroom)::numeric(18,2);
    IF -v_delta>v_eligible_release THEN
      RAISE EXCEPTION 'MONTH_OVERRIDE_RELEASE_BLOCKED: requested release %, eligible release %, shortfall %',
        -v_delta,v_eligible_release,(-v_delta-v_eligible_release)::numeric(18,2) USING ERRCODE='23514';
    END IF;
  END IF;
  v_operation_id:=public.budget_create_action_root(v_month_id,p_request_key,v_fingerprint,
    'monthly_override_set',v_month_start,p_reason,NULL);
  IF v_delta<>0 THEN
    INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
    VALUES(v_operation_id,CASE WHEN v_delta<0 THEN v_budget.budget_id END,
      CASE WHEN v_delta>0 THEN v_budget.budget_id END,abs(v_delta)) RETURNING id INTO v_movement_id;
  END IF;
  INSERT INTO public.budget_month_overrides(budget_month_id,category_id,amount)
  VALUES(v_month_id,p_category_id,p_amount::numeric(18,2))
  ON CONFLICT(budget_month_id,category_id) DO UPDATE
  SET amount=EXCLUDED.amount,updated_at=timezone('utc'::text,now());
  INSERT INTO public.budget_operation_items(
    operation_id,item_kind,action_kind,budget_month_id,category_id,destination_budget_id,
    amount,base_before,base_after,fallback_base_snapshot,source_kind,movement_id
  ) VALUES(v_operation_id,'month_override','set',v_month_id,p_category_id,v_budget.budget_id,
    p_amount,v_base.effective_base,p_amount,v_base.fallback_base,v_base.fallback_source,v_movement_id)
  RETURNING id INTO v_item_id;
  PERFORM public.budget_assert_reconciled(v_month_id);
  RETURN public.get_funded_budget_month(p_month);
END;
$$;

-- All runtime dependencies have been replaced above. Drop each compatibility
-- relation explicitly; CASCADE is intentionally not used.
DROP VIEW public.budget_unbudgeted_resolution_events;
DROP VIEW public.budget_funding_action_legs;
DROP VIEW public.budget_funding_actions;
DROP VIEW public.budget_unused_disposition_events;
DROP VIEW public.budget_month_disposition_batches;
DROP VIEW public.budget_carryover_transfers;
DROP VIEW public.budget_carryover_batches;
DROP VIEW public.budget_month_override_events;
DROP VIEW public.budget_category_funding_action_state;
DROP VIEW public.budget_category_base_state;
DROP VIEW public.budget_category_carryover_state;
DROP VIEW public.budget_carryover_settings_read;
DROP VIEW public.budget_carryover_settings;

DROP FUNCTION public.write_budget_unbudgeted_event_adapter();
DROP FUNCTION public.write_budget_funding_action_leg_adapter();
DROP FUNCTION public.write_budget_funding_action_adapter();
DROP FUNCTION public.write_budget_disposition_event_adapter();
DROP FUNCTION public.write_budget_disposition_batch_adapter();
DROP FUNCTION public.write_budget_carryover_transfer_adapter();
DROP FUNCTION public.write_budget_carryover_batch_adapter();
DROP FUNCTION public.write_budget_month_override_event_adapter();
DROP FUNCTION public.validate_budget_carryover_setting();
DROP FUNCTION public.prevent_category_type_with_carryover();

REVOKE ALL ON FUNCTION public.validate_budget_unused_balance_policy(),
  public.prevent_category_type_with_unused_balance_policy()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.budget_category_state,public.budget_month_funding_state,
  public.budget_month_category_actuals,public.budget_category_composition,
  public.budget_savings_state,public.budget_recurring_defaults_read,
  public.budget_month_overrides_read,public.budget_unused_balance_policies_read,
  public.budget_operation_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.budget_category_state,public.budget_month_funding_state,
  public.budget_month_category_actuals,public.budget_category_composition,
  public.budget_savings_state,public.budget_recurring_defaults_read,
  public.budget_month_overrides_read,public.budget_unused_balance_policies_read,
  public.budget_operation_history TO service_role;

DO $$
DECLARE
  v_actual_views TEXT[];
  v_expected_views CONSTANT TEXT[]:=ARRAY[
    'budget_category_composition','budget_category_state','budget_month_category_actuals',
    'budget_month_funding_state','budget_month_overrides_read','budget_operation_history',
    'budget_recurring_defaults_read','budget_savings_state','budget_unused_balance_policies_read'
  ];
  v_forbidden CONSTANT TEXT[]:=ARRAY[
    'budget_carryover_batches','budget_carryover_transfers','budget_month_override_events',
    'budget_month_disposition_batches','budget_unused_disposition_events','budget_funding_actions',
    'budget_funding_action_legs','budget_unbudgeted_resolution_events',
    'budget_category_carryover_state','budget_category_base_state',
    'budget_category_funding_action_state','budget_carryover_settings','budget_carryover_settings_read'
  ];
  v_name TEXT;
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO v_actual_views
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v' AND c.relname LIKE 'budget%';
  IF v_actual_views IS DISTINCT FROM v_expected_views THEN
    RAISE EXCEPTION 'Migration 025 final Budget view set mismatch: %',v_actual_views;
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN('r','p') AND c.relname LIKE 'budget%')<>11 THEN
    RAISE EXCEPTION 'Migration 025 expected exactly eleven physical Budget tables';
  END IF;
  FOREACH v_name IN ARRAY v_forbidden LOOP
    IF to_regclass('public.'||v_name) IS NOT NULL THEN
      RAISE EXCEPTION 'Migration 025 retained forbidden compatibility relation public.%',v_name;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND (
      p.prosrc LIKE '%budget_carryover_batches%' OR p.prosrc LIKE '%budget_carryover_transfers%'
      OR p.prosrc LIKE '%budget_month_override_events%' OR p.prosrc LIKE '%budget_month_disposition_batches%'
      OR p.prosrc LIKE '%budget_unused_disposition_events%' OR p.prosrc LIKE '%budget_funding_actions%'
      OR p.prosrc LIKE '%budget_funding_action_legs%' OR p.prosrc LIKE '%budget_unbudgeted_resolution_events%'
      OR p.prosrc LIKE '%budget_category_carryover_state%' OR p.prosrc LIKE '%budget_category_base_state%'
      OR p.prosrc LIKE '%budget_category_funding_action_state%' OR p.prosrc LIKE '%budget_carryover_settings%'
    )) THEN
    RAISE EXCEPTION 'Migration 025 left a SQL function dependent on a retired Budget relation name';
  END IF;
  IF to_regprocedure('public.get_funded_budget_month(text)') IS NULL
     OR to_regprocedure('public.get_budget_month_override_preview(text)') IS NULL
     OR to_regprocedure('public.set_budget_month_override(text,bigint,numeric,uuid,text)') IS NULL
     OR to_regprocedure('public.remove_budget_month_override(text,bigint,uuid,text)') IS NULL
     OR to_regprocedure('public.get_budget_carryover_preview(text)') IS NULL
     OR to_regprocedure('public.apply_budget_carryover(text,uuid,text,text)') IS NULL
     OR to_regprocedure('public.reverse_budget_carryover(bigint,uuid,text)') IS NULL
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
     OR to_regprocedure('public.reverse_budget_unbudgeted_resolution(bigint,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Migration 025 did not preserve the complete public funded-Budget RPC surface';
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_category_composition
    WHERE final_funded IS DISTINCT FROM (
      opening_base+override_adjustment_total+incoming_carryover-outgoing_carryover
      +incoming_reallocation_resolution-outgoing_reallocation
      +unbudgeted_resolution_adjustment+unused_disposition_adjustment+other_adjustments
    )::numeric(18,2)) THEN
    RAISE EXCEPTION 'Migration 025 changed canonical category composition';
  END IF;
  PERFORM public.budget_assert_reconciled(id) FROM public.budget_months;
END;
$$;

COMMIT;
