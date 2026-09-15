-- Migration 033: Funded Budget surplus to named Savings (SAV-05).
-- Requires 032. Functions and one existing view only; no row backfill or new relations.
BEGIN;

CREATE OR REPLACE FUNCTION public.validate_budget_unused_balance_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id=NEW.category_id AND type='expense' AND savings_role IS NULL
  ) THEN
    RAISE EXCEPTION 'Unused-balance policies are available only for expense categories'
      USING ERRCODE='23514';
  END IF;
  IF NEW.policy='savings_account' AND NOT EXISTS(SELECT 1 FROM public.savings_accounts WHERE id=NEW.savings_account_id AND status='active') THEN RAISE EXCEPTION 'יש לבחור חשבון חיסכון פעיל ליתרה שלא נוצלה' USING ERRCODE='23514',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_budget_operation_tree()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_parent public.budget_operations%ROWTYPE;
  v_reversed public.budget_operations%ROWTYPE;
  v_parent_month DATE;
  v_child_month DATE;
  v_combined_category_id BIGINT;
BEGIN
  IF NEW.operation_type='savings_account_transfer' AND NEW.parent_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.budget_operations WHERE id=NEW.parent_operation_id AND operation_type='month_close') THEN RAISE EXCEPTION 'העברת חיסכון מקוננת חייבת להיות חלק מסגירת חודש' USING ERRCODE='23514'; END IF;
  IF NEW.operation_type IN ('savings_reserve_retirement','savings_reserve_retirement_reversal') AND NEW.parent_operation_id IS NOT NULL THEN RAISE EXCEPTION 'פרישת רזרבה חייבת להיות פעולת שורש' USING ERRCODE='23514'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.validate_budget_operation_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  IF NEW.item_kind='savings_transfer' THEN
    IF NEW.action_kind NOT IN ('apply','reversal') OR NEW.amount IS NULL OR NEW.amount<=0
      OR num_nonnulls(NEW.category_id,NEW.source_budget_id,NEW.source_operation_id,NEW.source_funding_entry_id,NEW.source_movement_id,NEW.savings_event_id,NEW.raw_actual_snapshot,NEW.funded_before,NEW.destination_budget_month_id)<>9
      OR num_nonnulls(NEW.destination_budget_id,NEW.destination_operation_id,NEW.destination_movement_id,NEW.destination_funding_entry_id,NEW.savings_entry_id,NEW.movement_id)>0
      OR NOT EXISTS(SELECT 1 FROM public.savings_entries e JOIN public.budget_operations o ON o.id=NEW.source_operation_id
        JOIN public.budget_funding_entries f ON f.id=NEW.source_funding_entry_id JOIN public.budget_movements m ON m.id=NEW.source_movement_id
        JOIN public.budget_months cm ON cm.id=NEW.destination_budget_month_id
        WHERE e.id=NEW.savings_event_id AND e.event_kind='deposit' AND e.source_kind='budget_surplus' AND e.amount=NEW.amount
          AND (e.entry_action='post')=(NEW.action_kind='apply') AND cm.month_start=date_trunc('month',e.effective_date)::date
          AND o.budget_month_id=NEW.budget_month_id AND v_source.budget_month_id=NEW.budget_month_id
          AND o.operation_type=CASE WHEN NEW.action_kind='apply' THEN 'savings_account_transfer' ELSE 'savings_account_transfer_reversal' END
          AND f.operation_id=o.id AND f.source_kind='savings_transfer' AND f.amount_delta=NEW.amount*CASE WHEN NEW.action_kind='apply' THEN -1 ELSE 1 END
          AND m.operation_id=o.id AND m.amount=NEW.amount
          AND (m.source_budget_id,m.destination_budget_id) IS NOT DISTINCT FROM (CASE WHEN NEW.action_kind='apply' THEN NEW.source_budget_id END,CASE WHEN NEW.action_kind='reversal' THEN NEW.source_budget_id END))
      THEN RAISE EXCEPTION 'קישורי העודף, המימון וההפקדה אינם תואמים' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.item_kind='reserve_retirement' THEN
    IF NEW.action_kind IS DISTINCT FROM (CASE WHEN v_operation.operation_type='savings_reserve_retirement' THEN 'apply' ELSE 'reversal' END)
      OR v_operation.operation_type NOT IN ('savings_reserve_retirement','savings_reserve_retirement_reversal')
      OR NEW.savings_event_id IS NULL OR NEW.savings_entry_id IS NULL OR NEW.amount IS NULL OR NEW.amount<=0
      OR num_nonnulls(NEW.source_budget_id,NEW.destination_budget_id,NEW.destination_budget_month_id,NEW.source_movement_id,NEW.destination_movement_id,NEW.movement_id,NEW.source_funding_entry_id,NEW.destination_funding_entry_id)>0
      OR NOT EXISTS (SELECT 1 FROM public.savings_entries s JOIN public.budget_savings_entries b ON b.id=NEW.savings_entry_id WHERE s.id=NEW.savings_event_id AND s.event_kind='opening' AND b.operation_id=NEW.operation_id AND NEW.amount=abs(b.amount_delta) AND NEW.amount<=s.amount AND (s.entry_action='post')=(NEW.action_kind='apply'))
    THEN RAISE EXCEPTION 'קישור פרישת הרזרבה ליתרת הפתיחה אינו תקין' USING ERRCODE='23514'; END IF;
  ELSIF NEW.savings_event_id IS NOT NULL THEN RAISE EXCEPTION 'קישור חיסכון אינו מתאים לסוג פעולת התקציב' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.savings_assert_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.savings_entries%ROWTYPE; r public.savings_entries%ROWTYPE; a public.savings_accounts%ROWTYPE; t public.transactions%ROWTYPE; v_role TEXT; v_id BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.savings_entries fresh JOIN public.savings_accounts account ON account.id=fresh.account_id
    WHERE fresh.xmin::text=pg_current_xact_id()::text AND fresh.entry_action='post' AND fresh.reversed_by_entry_id IS NULL
      AND fresh.occurrence_month IS NOT NULL AND fresh.occurrence_root_id IS NULL
      AND (account.plan_start_date IS NULL OR fresh.scheduled_due_date<account.plan_start_date
        OR fresh.scheduled_due_date>timezone('Asia/Jerusalem',statement_timestamp())::date OR fresh.plan_revision<>account.plan_revision)) THEN
    RAISE EXCEPTION 'מועד חדש מחייב תוכנית שמורה, גרסה תקפה ותאריך שכבר הגיע' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.savings_entries fresh JOIN public.savings_accounts account ON account.id=fresh.account_id
    LEFT JOIN public.categories category ON category.id=fresh.cash_category_id LEFT JOIN public.payment_sources source ON source.id=fresh.cash_payment_source_id
    WHERE fresh.xmin::text=pg_current_xact_id()::text AND fresh.entry_action='post' AND fresh.reversed_by_entry_id IS NULL AND fresh.supersedes_entry_id IS NULL AND fresh.event_kind NOT IN ('opening','occurrence_skip')
      AND (account.status<>'active' OR (fresh.transaction_id IS NOT NULL AND (NOT category.is_active OR NOT source.is_active)))) THEN
    RAISE EXCEPTION 'אירוע חדש מחייב חשבון, קטגוריה ואמצעי תשלום פעילים' USING ERRCODE='23514';
  END IF;
  -- Read final stored rows: deferred trigger NEW may describe an intermediate state.
  FOR e IN SELECT * FROM public.savings_entries ORDER BY id LOOP
    SELECT * INTO a FROM public.savings_accounts WHERE id=e.account_id;
    IF NOT isfinite(e.effective_date) OR e.effective_date<a.tracking_start_date OR e.effective_date>timezone('Asia/Jerusalem',statement_timestamp())::date
       OR (e.cash_charge_date IS NOT NULL AND NOT isfinite(e.cash_charge_date)) OR (e.event_kind='opening' AND e.effective_date<>a.tracking_start_date) THEN
      RAISE EXCEPTION 'תאריך האירוע אינו בתחום המעקב המאושר' USING ERRCODE='23514';
    END IF;
    IF e.entry_action='reverse' THEN
      SELECT * INTO r FROM public.savings_entries WHERE id=e.reverses_entry_id;
      IF r.entry_action<>'post' OR r.id>=e.id OR r.reversed_by_entry_id IS DISTINCT FROM e.id OR
        (e.account_id,e.event_kind,e.source_kind,e.amount,e.effective_date,e.transaction_id,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date) IS DISTINCT FROM
        (r.account_id,r.event_kind,r.source_kind,r.amount,r.effective_date,r.transaction_id,r.cash_movement_type,r.cash_category_id,r.cash_payment_source_id,r.cash_charge_date) THEN
        RAISE EXCEPTION 'רישום ביטול אינו תואם לאירוע המקורי' USING ERRCODE='23514';
      END IF;
    ELSIF e.reversed_by_entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.savings_entries WHERE id=e.reversed_by_entry_id AND reverses_entry_id=e.id AND entry_action='reverse') THEN
      RAISE EXCEPTION 'חסר אירוע ביטול תואם' USING ERRCODE='23514';
    END IF;
    IF e.supersedes_entry_id IS NOT NULL THEN
      SELECT * INTO r FROM public.savings_entries WHERE id=e.supersedes_entry_id;
      IF r.entry_action<>'post' OR r.reversed_by_entry_id IS NULL OR r.id>=e.id
        OR ((e.event_kind='opening') IS DISTINCT FROM (r.event_kind='opening'))
        OR (r.event_kind='opening' AND e.account_id<>r.account_id)
        OR (r.occurrence_month IS NOT NULL AND (e.account_id,e.occurrence_month,e.occurrence_root_id) IS DISTINCT FROM (r.account_id,r.occurrence_month,coalesce(r.occurrence_root_id,r.id)))
        OR (r.occurrence_month IS NULL AND e.occurrence_month IS NOT NULL)
        OR (r.event_kind<>e.event_kind AND NOT (r.event_kind IN ('interest_capitalized','interest_payout') AND e.event_kind IN ('interest_capitalized','interest_payout'))
          AND NOT (r.occurrence_month IS NOT NULL AND r.event_kind IN ('deposit','occurrence_skip') AND e.event_kind IN ('deposit','occurrence_skip'))) THEN
        RAISE EXCEPTION 'החלפת אירוע חייבת לשמור על שרשרת התיקון וזהות המועד' USING ERRCODE='23514';
      END IF;
    END IF;
    IF e.occurrence_root_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.savings_entries WHERE id=e.occurrence_root_id AND id<e.id AND occurrence_root_id IS NULL AND entry_action='post' AND account_id=e.account_id AND occurrence_month=e.occurrence_month) THEN
      RAISE EXCEPTION 'זהות המועד החודשי אינה תקינה' USING ERRCODE='23514';
    END IF;
    IF e.source_kind='budget_surplus' THEN
      IF e.event_kind<>'deposit' OR NOT EXISTS(SELECT 1 FROM public.budget_operation_items i
        JOIN public.budget_operations o ON o.id=i.source_operation_id JOIN public.budget_funding_entries f ON f.id=i.source_funding_entry_id
        JOIN public.budget_movements m ON m.id=i.source_movement_id
        WHERE i.savings_event_id=e.id AND i.item_kind='savings_transfer' AND i.amount=e.amount
          AND i.action_kind=CASE WHEN e.entry_action='post' THEN 'apply' ELSE 'reversal' END
          AND f.operation_id=o.id AND m.operation_id=o.id AND m.amount=e.amount
          AND f.amount_delta=e.amount*CASE WHEN e.entry_action='post' THEN -1 ELSE 1 END
          AND ((e.reversed_by_entry_id IS NULL AND e.entry_action='post' AND NOT EXISTS(SELECT 1 FROM public.budget_operation_items ri WHERE ri.reversed_item_id=i.id))
            OR e.entry_action='reverse' OR EXISTS(SELECT 1 FROM public.budget_operation_items ri WHERE ri.reversed_item_id=i.id AND ri.savings_event_id=e.reversed_by_entry_id))) THEN
        RAISE EXCEPTION 'הפקדת עודף מחייבת מימון והקצאה תואמים באותה פעולה' USING ERRCODE='23514'; END IF;
    END IF;
    IF e.transaction_id IS NOT NULL THEN
      PERFORM id FROM public.transactions WHERE id=e.transaction_id FOR UPDATE;
      SELECT * INTO t FROM public.transactions WHERE id=e.transaction_id;
      IF t.loan_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.loan_payments WHERE transaction_id=t.id)
        OR t.currency IS DISTINCT FROM 'ILS' OR t.total_amount IS NULL OR t.total_amount<=0 OR t.total_amount::text IN ('NaN','Infinity','-Infinity')
        OR t.total_amount<>round(t.total_amount,2) OR t.total_amount>9999999999999999.99
        OR NOT isfinite(t.transaction_date) OR t.payment_source_id IS NULL OR t.charge_date IS NULL OR NOT isfinite(t.charge_date)
        OR coalesce(t.global_discount,0)<>0 OR t.parent_transaction_id IS NOT NULL
        OR coalesce(t.installment_count,1)>1 OR EXISTS (SELECT 1 FROM public.transactions WHERE parent_transaction_id=t.id)
        OR EXISTS (SELECT 1 FROM public.transaction_items WHERE transaction_id=t.id)
        OR EXISTS (SELECT 1 FROM public.lego_sets WHERE transaction_id=t.id)
        OR EXISTS (SELECT 1 FROM public.shopping_checkouts WHERE transaction_id=t.id) THEN
        RAISE EXCEPTION 'תנועת חיסכון חייבת להיות תנועה ישירה בשקלים ללא פריטים או קישור הלוואה' USING ERRCODE='23514';
      END IF;
      IF e.entry_action='post' AND e.reversed_by_entry_id IS NULL THEN
        SELECT savings_role INTO v_role FROM public.categories WHERE id=t.category_id;
        IF t.voided_at IS NOT NULL OR
          (e.amount,e.effective_date,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date) IS DISTINCT FROM
          (t.total_amount,t.transaction_date,t.movement_type,t.category_id,t.payment_source_id,t.charge_date)
          OR v_role IS DISTINCT FROM e.event_kind OR t.movement_type<> (CASE WHEN e.event_kind='deposit' THEN 'expense' ELSE 'income' END) THEN
          RAISE EXCEPTION 'התנועה והרישום בחיסכון חייבים להסכים בסכום, בתאריך ובסיווג' USING ERRCODE='23514';
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.transactions live_cash JOIN public.categories c ON c.id=live_cash.category_id WHERE live_cash.voided_at IS NULL AND c.savings_role IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.savings_entries live_entry WHERE live_entry.transaction_id=live_cash.id AND live_entry.entry_action='post' AND live_entry.reversed_by_entry_id IS NULL)) THEN
    RAISE EXCEPTION 'פעולות הפקדה ומשיכה יתווספו בהמשך; אין ליצור תנועת חיסכון ללא רישום תואם' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.savings_entries GROUP BY command_id HAVING min(command_index)<>0 OR max(command_index)<>count(*)-1 OR count(DISTINCT command_kind)<>1 OR count(DISTINCT command_fingerprint)<>1) THEN
    RAISE EXCEPTION 'קבלת הפעולה אינה עקבית' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.budget_savings_entries b WHERE b.entry_kind IN ('account_opening_retirement','account_opening_retirement_reversal') AND NOT EXISTS (
    SELECT 1 FROM public.budget_operation_items i JOIN public.savings_entries s ON s.id=i.savings_event_id
    WHERE i.operation_id=b.operation_id AND i.savings_entry_id=b.id AND i.item_kind='reserve_retirement' AND s.event_kind='opening'
      AND i.amount=abs(b.amount_delta) AND i.amount<=s.amount AND ((b.amount_delta<0 AND s.entry_action='post') OR (b.amount_delta>0 AND s.entry_action='reverse'))
  )) THEN RAISE EXCEPTION 'פרישת רזרבה מחייבת קישור מפורש ליתרת פתיחה' USING ERRCODE='23514'; END IF;
  FOR v_id IN SELECT id FROM public.savings_accounts ORDER BY id LOOP PERFORM public.savings_assert_account(v_id); END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.budget_actual_transactions(p_from DATE,p_to DATE) RETURNS SETOF public.transactions LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT t.* FROM public.transactions t WHERE t.voided_at IS NULL AND t.movement_type='expense'
 AND (p_from IS NULL OR t.transaction_date>=p_from) AND (p_to IS NULL OR t.transaction_date<=p_to)
 AND NOT EXISTS(SELECT 1 FROM public.savings_entries e JOIN public.budget_operation_items i ON i.savings_event_id=e.id
   JOIN public.budget_funding_entries f ON f.id=i.source_funding_entry_id JOIN public.budget_movements m ON m.id=i.source_movement_id
   WHERE e.transaction_id=t.id AND e.source_kind='budget_surplus' AND e.event_kind='deposit' AND e.entry_action='post' AND e.reversed_by_entry_id IS NULL
     AND i.item_kind='savings_transfer' AND i.action_kind='apply' AND i.amount=e.amount AND f.amount_delta=-e.amount AND m.amount=e.amount
     AND NOT EXISTS(SELECT 1 FROM public.budget_operation_items ri WHERE ri.reversed_item_id=i.id));
$$;

CREATE OR REPLACE VIEW public.budget_category_composition AS WITH movement_classification AS (
         SELECT m.id,
            m.operation_id,
            m.source_budget_id,
            m.destination_budget_id,
            m.amount,
            COALESCE(classified.component, 'other'::text) AS component,
            classified.semantic_role,
            classified.semantic_source_budget_id,
            classified.semantic_destination_budget_id,
            COALESCE(classified.semantic_sign, 1) AS semantic_sign
           FROM budget_movements m
             LEFT JOIN LATERAL ( SELECT
                        CASE
                            WHEN i.item_kind = 'month_override'::text THEN 'override'::text
                            WHEN i.item_kind = 'carryover'::text THEN 'carryover'::text
                            WHEN i.item_kind = 'unused_disposition'::text AND i.policy = 'carry_forward'::text THEN 'carryover'::text
                            WHEN i.item_kind IN ('unused_disposition'::text,'savings_transfer'::text) THEN 'unused_disposition'::text
                            WHEN i.item_kind = 'allocation_leg'::text AND (root.operation_type = ANY (ARRAY['unbudgeted_resolution'::text, 'unbudgeted_resolution_reversal'::text])) THEN 'unbudgeted_resolution'::text
                            WHEN i.item_kind = 'allocation_leg'::text THEN 'reallocation_resolution'::text
                            ELSE NULL::text
                        END AS component,
                        CASE
                            WHEN i.item_kind = ANY (ARRAY['carryover'::text, 'unused_disposition'::text, 'savings_transfer'::text]) THEN
                            CASE
                                WHEN m.operation_id = i.source_operation_id THEN 'source'::text
                                WHEN m.operation_id = i.destination_operation_id THEN 'destination'::text
                                ELSE NULL::text
                            END
                            ELSE NULL::text
                        END AS semantic_role,
                        CASE
                            WHEN i.item_kind = ANY (ARRAY['carryover'::text, 'unused_disposition'::text, 'savings_transfer'::text]) THEN i.source_budget_id
                            ELSE NULL::bigint
                        END AS semantic_source_budget_id,
                        CASE
                            WHEN i.item_kind = ANY (ARRAY['carryover'::text, 'unused_disposition'::text, 'savings_transfer'::text]) THEN i.destination_budget_id
                            ELSE NULL::bigint
                        END AS semantic_destination_budget_id,
                        CASE
                            WHEN (i.item_kind = ANY (ARRAY['carryover'::text, 'unused_disposition'::text, 'savings_transfer'::text])) AND i.reversed_item_id IS NOT NULL THEN '-1'::integer
                            ELSE 1
                        END AS semantic_sign
                   FROM budget_operation_items i
                     JOIN budget_operations root ON root.id = i.operation_id
                  WHERE i.movement_id = m.id OR i.source_movement_id = m.id OR i.destination_movement_id = m.id OR (i.item_kind = ANY (ARRAY['carryover'::text, 'unused_disposition'::text, 'savings_transfer'::text])) AND (m.operation_id = i.source_operation_id OR m.operation_id = i.destination_operation_id)
                  ORDER BY (
                        CASE i.item_kind
                            WHEN 'carryover'::text THEN 1
                            WHEN 'unused_disposition'::text THEN 2
                            ELSE 3
                        END), i.id
                 LIMIT 1) classified ON true
        ), movement_totals AS (
         SELECT b.id AS budget_id,
            COALESCE(sum(
                CASE
                    WHEN mc.destination_budget_id = b.id AND mc.component = 'override'::text THEN mc.amount
                    WHEN mc.source_budget_id = b.id AND mc.component = 'override'::text THEN - mc.amount
                    ELSE 0::numeric
                END), 0::numeric)::numeric(18,2) AS override_adjustment,
            COALESCE(sum(
                CASE
                    WHEN mc.semantic_destination_budget_id = b.id AND mc.component = 'carryover'::text AND mc.semantic_role = 'destination'::text THEN mc.amount * mc.semantic_sign::numeric
                    ELSE 0::numeric
                END), 0::numeric)::numeric(18,2) AS incoming_carryover,
            COALESCE(sum(
                CASE
                    WHEN mc.semantic_source_budget_id = b.id AND mc.component = 'carryover'::text AND mc.semantic_role = 'source'::text THEN mc.amount * mc.semantic_sign::numeric
                    ELSE 0::numeric
                END), 0::numeric)::numeric(18,2) AS outgoing_carryover,
            COALESCE(sum(
                CASE
                    WHEN mc.destination_budget_id = b.id AND mc.component = 'reallocation_resolution'::text THEN mc.amount
                    ELSE 0::numeric
                END), 0::numeric)::numeric(18,2) AS incoming_reallocation_resolution,
            COALESCE(sum(
                CASE
                    WHEN mc.source_budget_id = b.id AND mc.component = 'reallocation_resolution'::text THEN mc.amount
                    ELSE 0::numeric
                END), 0::numeric)::numeric(18,2) AS outgoing_reallocation,
            COALESCE(sum(
                CASE
                    WHEN mc.destination_budget_id = b.id AND mc.component = 'unbudgeted_resolution'::text THEN mc.amount
                    WHEN mc.source_budget_id = b.id AND mc.component = 'unbudgeted_resolution'::text THEN - mc.amount
                    ELSE 0::numeric
                END), 0::numeric)::numeric(18,2) AS unbudgeted_resolution_adjustment,
            COALESCE(sum(
                CASE
                    WHEN mc.semantic_destination_budget_id = b.id AND mc.component = 'unused_disposition'::text AND mc.semantic_role = 'destination'::text THEN mc.amount * mc.semantic_sign::numeric
                    WHEN mc.semantic_source_budget_id = b.id AND mc.component = 'unused_disposition'::text AND mc.semantic_role = 'source'::text THEN (- mc.amount) * mc.semantic_sign::numeric
                    ELSE 0::numeric
                END), 0::numeric)::numeric(18,2) AS unused_disposition_adjustment,
            COALESCE(sum(
                CASE
                    WHEN mc.destination_budget_id = b.id AND mc.component = 'other'::text THEN mc.amount
                    WHEN mc.source_budget_id = b.id AND mc.component = 'other'::text THEN - mc.amount
                    ELSE 0::numeric
                END), 0::numeric)::numeric(18,2) AS other_adjustment
           FROM budgets b
             LEFT JOIN movement_classification mc ON mc.source_budget_id = b.id OR mc.destination_budget_id = b.id
          GROUP BY b.id
        ), initialized_override AS (
         SELECT DISTINCT ON ((COALESCE(i.destination_budget_id, i.source_budget_id))) COALESCE(i.destination_budget_id, i.source_budget_id) AS budget_id,
            i.fallback_base_snapshot,
            i.source_kind AS fallback_source
           FROM budget_operation_items i
          WHERE i.item_kind = 'month_override'::text AND i.action_kind = 'initialize'::text AND COALESCE(i.destination_budget_id, i.source_budget_id) IS NOT NULL
          ORDER BY (COALESCE(i.destination_budget_id, i.source_budget_id)), i.id
        ), actuals AS (
         SELECT bm.id AS budget_month_id,
            t.category_id,
            sum(t.total_amount)::numeric(18,2) AS actual_spent
           FROM budget_months bm
             JOIN public.budget_actual_transactions(NULL,NULL) t ON t.movement_type::text = 'expense'::text AND t.transaction_date >= bm.month_start AND t.transaction_date < (bm.month_start + '1 mon'::interval)::date
          GROUP BY bm.id, t.category_id
        )
 SELECT cs.budget_id,
    cs.budget_month_id,
    cs.month,
    cs.month_start,
    cs.category_id,
    cs.starting_amount AS opening_base,
    cs.starting_kind,
        CASE
            WHEN cs.starting_kind = 'monthly_override'::text THEN COALESCE(init.fallback_base_snapshot, 0::numeric)
            ELSE cs.starting_amount
        END::numeric(18,2) AS fallback_base,
        CASE
            WHEN cs.starting_kind = 'monthly_override'::text THEN COALESCE(init.fallback_source, 'none'::text)
            ELSE cs.starting_kind
        END AS fallback_source,
    rd.amount AS recurring_default,
    mo.amount AS current_override,
    mt.override_adjustment AS override_adjustment_total,
    (cs.starting_amount + mt.override_adjustment)::numeric(18,2) AS effective_base,
    mt.incoming_carryover,
    mt.outgoing_carryover,
    mt.incoming_reallocation_resolution,
    mt.outgoing_reallocation,
    mt.unbudgeted_resolution_adjustment,
    GREATEST(mt.unbudgeted_resolution_adjustment, 0::numeric)::numeric(18,2) AS incoming_unbudgeted_resolution,
    GREATEST(- mt.unbudgeted_resolution_adjustment, 0::numeric)::numeric(18,2) AS outgoing_unbudgeted_resolution,
    mt.unused_disposition_adjustment,
    mt.other_adjustment AS other_adjustments,
    cs.final_funded,
    COALESCE(a.actual_spent, 0::numeric)::numeric(18,2) AS actual_spent,
    (cs.final_funded - COALESCE(a.actual_spent, 0::numeric))::numeric(18,2) AS remaining,
    GREATEST(COALESCE(a.actual_spent, 0::numeric) - cs.final_funded, 0::numeric)::numeric(18,2) AS deficit,
    cs.lifecycle_state,
    p.policy AS unused_balance_policy
   FROM budget_category_state cs
     JOIN movement_totals mt ON mt.budget_id = cs.budget_id
     LEFT JOIN initialized_override init ON init.budget_id = cs.budget_id
     LEFT JOIN budget_recurring_defaults rd ON rd.category_id = cs.category_id
     LEFT JOIN budget_month_overrides mo ON mo.budget_month_id = cs.budget_month_id AND mo.category_id = cs.category_id
     LEFT JOIN budget_unused_balance_policies p ON p.category_id = cs.category_id
     LEFT JOIN actuals a ON a.budget_month_id = cs.budget_month_id AND a.category_id = cs.category_id;

CREATE OR REPLACE FUNCTION public.budget_month_disposition_candidate_rows(p_source_month text)
 RETURNS TABLE(category_id bigint, category_name text, category_icon text, source_budget_id bigint, policy text, source_final_funded numeric, source_raw_actual numeric, source_effective_actual numeric, eligible_amount numeric, status text, blocked_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_start DATE:=public.budget_month_start_from_key(p_source_month);
  v_destination_start DATE:=(v_source_start+interval '1 month')::date; v_source_id BIGINT;
BEGIN
  SELECT id INTO v_source_id FROM public.budget_months WHERE month_start=v_source_start;
  IF EXISTS(SELECT 1 FROM public.budget_actual_transactions(NULL,NULL) WHERE movement_type='expense'
    AND transaction_date>=v_source_start AND transaction_date<v_destination_start
    AND total_amount::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'Month disposition actual spending contains a non-finite amount' USING ERRCODE='22003';
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_actual_transactions(NULL,NULL) t WHERE t.movement_type='expense'
    AND t.transaction_date>=v_source_start AND t.transaction_date<v_destination_start
    GROUP BY t.category_id HAVING sum(t.total_amount)<>round(sum(t.total_amount),2)
      OR abs(sum(t.total_amount))>9999999999999999.99) THEN
    RAISE EXCEPTION 'Month disposition actual spending must fit finite NUMERIC(18,2) exactly' USING ERRCODE='22003';
  END IF;
  RETURN QUERY
  WITH actuals AS(
    SELECT t.category_id,sum(t.total_amount)::numeric(18,2) actual
    FROM public.budget_actual_transactions(NULL,NULL) t WHERE t.movement_type='expense'
      AND t.transaction_date>=v_source_start AND t.transaction_date<v_destination_start GROUP BY t.category_id
  ),base AS(
    SELECT cs.budget_id,cs.category_id,cs.category_name,cs.category_icon,cs.category_type,
      c.is_active,c.savings_role,sa.status savings_status,cs.lifecycle_state,cs.final_funded::numeric(18,2) final_funded,
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
    LEFT JOIN public.savings_accounts sa ON sa.id=p.savings_account_id
    LEFT JOIN public.budget_carryover_candidate_rows(to_char(v_destination_start,'YYYY-MM')) carry
      ON p.policy='carry_forward' AND carry.category_id=cs.category_id
    WHERE cs.budget_month_id=v_source_id
  )
  SELECT b.category_id,b.category_name,b.category_icon,b.budget_id,b.policy,b.final_funded,
    b.raw_actual,b.effective_actual,b.unused,
    CASE WHEN b.disposed OR (b.policy='carry_forward' AND b.carry_status='already_applied') THEN 'already_applied'
      WHEN b.category_type<>'expense' OR NOT b.is_active OR b.lifecycle_state<>'active' THEN 'blocked'
      WHEN b.savings_role IS NOT NULL THEN 'ineligible' WHEN b.policy='savings_account' AND b.savings_status IS DISTINCT FROM 'active' AND b.unused>0 THEN 'blocked' WHEN b.unused<=0 THEN 'ineligible' WHEN b.policy IS NULL THEN 'blocked'
      WHEN b.policy='carry_forward' AND b.carry_status IS DISTINCT FROM 'ready' THEN 'blocked'
      ELSE 'ready' END,
    CASE WHEN b.disposed OR (b.policy='carry_forward' AND b.carry_status='already_applied') THEN NULL
      WHEN b.category_type<>'expense' THEN 'CATEGORY_NOT_EXPENSE'
      WHEN NOT b.is_active THEN 'CATEGORY_INACTIVE'
      WHEN b.lifecycle_state<>'active' THEN 'SOURCE_BUDGET_INACTIVE'
      WHEN b.savings_role IS NOT NULL THEN NULL WHEN b.policy='savings_account' AND b.savings_status IS DISTINCT FROM 'active' AND b.unused>0 THEN 'SAVINGS_REFERENCE_INACTIVE' WHEN b.unused<=0 THEN NULL WHEN b.policy IS NULL THEN 'POLICY_UNCONFIGURED'
      WHEN b.policy='carry_forward' AND b.carry_status IS DISTINCT FROM 'ready'
        THEN coalesce(b.carry_blocked,'CARRY_FORWARD_NOT_READY') ELSE NULL END
  FROM base b ORDER BY b.category_name,b.category_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_budget_month_disposition_preview(p_source_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_start DATE := public.budget_month_start_from_key(p_source_month);
  v_destination_start DATE := (v_source_start + interval '1 month')::date;
  v_current_start DATE := date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_source_id BIGINT;
  v_destination_id BIGINT;
  v_rows JSONB := '[]'::jsonb;
  v_material TEXT := '';
  v_deficits JSONB := '[]'::jsonb;
  v_unbudgeted JSONB := '[]'::jsonb;
  v_carry NUMERIC(18,2) := 0;
  v_return NUMERIC(18,2) := 0;
  v_savings NUMERIC(18,2) := 0;
  v_destination_unallocated NUMERIC(18,2) := 0;
  v_destination_available NUMERIC(18,2) := 0;
  v_source_available NUMERIC(18,2) := 0;
  v_source_unallocated NUMERIC(18,2) := 0;
  v_savings_balance NUMERIC(18,2) := 0;
  v_fingerprint TEXT;
  v_timing BOOLEAN;
BEGIN
  v_timing := v_destination_start=v_current_start;
  SELECT id INTO v_source_id FROM public.budget_months WHERE month_start=v_source_start;
  SELECT id INTO v_destination_id FROM public.budget_months WHERE month_start=v_destination_start;

  WITH rows AS (SELECT * FROM public.budget_month_disposition_candidate_rows(p_source_month))
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'category_id',category_id,
      'category',jsonb_build_object('name',category_name,'icon',category_icon,'type','expense'),
      'source_budget_id',source_budget_id,'policy',policy,
      'source_final_funded',source_final_funded::text,
      'source_raw_actual',source_raw_actual::text,
      'source_effective_actual',source_effective_actual::text,
      'eligible_unused',eligible_amount::text,
      'status',status,'blocked_reason',blocked_reason,'savings_account',(SELECT jsonb_build_object('id',a.id::text,'name',a.name,'status',a.status,'revision',a.revision::text,'tracking_start_date',a.tracking_start_date) FROM public.budget_unused_balance_policies p JOIN public.savings_accounts a ON a.id=p.savings_account_id WHERE p.category_id=rows.category_id),'cash_confirmation_required',policy='savings_account'
    ) ORDER BY category_name,category_id),'[]'::jsonb),
    coalesce(string_agg(category_id||'|'||source_budget_id||'|'||coalesce(policy,'')||'|'
      ||source_final_funded::text||'|'||source_raw_actual::text||'|'
      ||source_effective_actual::text||'|'||eligible_amount::text||'|'
      ||status||'|'||coalesce(blocked_reason,''),';' ORDER BY category_id),''),
    coalesce(sum(eligible_amount) FILTER (WHERE status='ready' AND policy='carry_forward'),0),
    coalesce(sum(eligible_amount) FILTER (WHERE status='ready' AND policy='return_to_unallocated'),0),
    coalesce(sum(eligible_amount) FILTER (WHERE status='ready' AND policy='savings'),0)
  INTO v_rows,v_material,v_carry,v_return,v_savings FROM rows;

  WITH actuals AS (
    SELECT t.category_id,sum(t.total_amount)::numeric(18,2) actual
    FROM public.budget_actual_transactions(NULL,NULL) t
    WHERE t.movement_type='expense' AND t.transaction_date>=v_source_start
      AND t.transaction_date<v_destination_start
    GROUP BY t.category_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'category_id',cs.category_id,'category_name',cs.category_name,
    'funded',cs.final_funded::numeric(18,2)::text,'actual',a.actual::text,
    'deficit',(a.actual-cs.final_funded)::numeric(18,2)::text
  ) ORDER BY cs.category_name,cs.category_id),'[]'::jsonb)
  INTO v_deficits
  FROM actuals a JOIN public.budget_category_state cs
    ON cs.budget_month_id=v_source_id AND cs.category_id=a.category_id
  WHERE cs.lifecycle_state='active' AND a.actual>cs.final_funded;

  WITH actuals AS (
    SELECT t.category_id,sum(t.total_amount)::numeric(18,2) actual
    FROM public.budget_actual_transactions(NULL,NULL) t
    WHERE t.movement_type='expense' AND t.transaction_date>=v_source_start
      AND t.transaction_date<v_destination_start
    GROUP BY t.category_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'category_id',a.category_id,'actual',a.actual::text
  ) ORDER BY a.category_id NULLS FIRST),'[]'::jsonb)
  INTO v_unbudgeted
  FROM actuals a
  WHERE a.actual>0 AND NOT EXISTS (
    SELECT 1 FROM public.budget_category_state cs
    WHERE cs.budget_month_id=v_source_id AND cs.category_id IS NOT DISTINCT FROM a.category_id
      AND cs.lifecycle_state='active'
  );

  SELECT coalesce(available,0)::numeric(18,2),coalesce(unallocated,0)::numeric(18,2)
  INTO v_destination_available,v_destination_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_destination_id;
  IF NOT FOUND THEN v_destination_available:=0; v_destination_unallocated:=0; END IF;
  SELECT coalesce(available,0)::numeric(18,2),coalesce(unallocated,0)::numeric(18,2)
  INTO v_source_available,v_source_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_source_id;
  IF NOT FOUND THEN v_source_available:=0; v_source_unallocated:=0; END IF;
  SELECT balance INTO v_savings_balance FROM public.budget_savings_state;

  v_fingerprint:=md5('month_disposition|'||p_source_month||'|'
    ||to_char(v_destination_start,'YYYY-MM')||'|'||v_material||'|deficits:'
    ||v_deficits::text||'|unbudgeted:'||v_unbudgeted::text
    ||'|source-funding:'||v_source_available::text||'|'||v_source_unallocated::text
    ||'|destination-funding:'||v_destination_available::text||'|'||v_destination_unallocated::text
    ||'|savings:'||v_savings_balance::text||'|destinations:'||v_rows::text);

  RETURN jsonb_build_object(
    'eligible',v_timing AND v_source_id IS NOT NULL,
    'reason',CASE WHEN NOT v_timing THEN 'IMMEDIATELY_COMPLETED_MONTH_ONLY'
                  WHEN v_source_id IS NULL THEN 'SOURCE_MONTH_MISSING' ELSE NULL END,
    'source_month',p_source_month,
    'destination_month',to_char(v_destination_start,'YYYY-MM'),
    'fingerprint',v_fingerprint,
    'categories',v_rows,
    'carry_forward_total',v_carry::text,
    'return_to_unallocated_total',v_return::text,
    'savings_total',v_savings::text,
    'source_available',v_source_available::text,
    'source_unallocated',v_source_unallocated::text,
    'destination_unallocated_before',v_destination_unallocated::text,
    'destination_unallocated_after',(v_destination_unallocated+v_return)::numeric(18,2)::text,
    'savings_balance_before',v_savings_balance::text,
    'savings_balance_after',(v_savings_balance+v_savings)::numeric(18,2)::text,
    'deficit_blockers',v_deficits,
    'unbudgeted_expense_blockers',v_unbudgeted,
    'can_apply',v_timing AND v_source_id IS NOT NULL
      AND jsonb_array_length(v_deficits)=0 AND jsonb_array_length(v_unbudgeted)=0
      AND NOT EXISTS (
        SELECT 1 FROM public.budget_month_disposition_candidate_rows(p_source_month)
        WHERE status='blocked'
      )
      AND EXISTS (
        SELECT 1 FROM public.budget_month_disposition_candidate_rows(p_source_month)
        WHERE status='ready'
      )
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.set_budget_unused_balance_policy(p_category_id BIGINT,p_policy TEXT,p_savings_account_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'יש לנסות שוב בבידוד READ COMMITTED' USING ERRCODE='22023'; END IF;
 LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.budget_unused_balance_policies IN SHARE ROW EXCLUSIVE MODE;
 PERFORM id FROM public.categories ORDER BY id FOR UPDATE;
 PERFORM id FROM public.savings_accounts ORDER BY id FOR UPDATE;
 IF p_policy IS NOT NULL AND p_policy NOT IN ('carry_forward','return_to_unallocated','savings','savings_account') THEN RAISE EXCEPTION 'מדיניות יתרה אינה תקינה' USING ERRCODE='22023'; END IF;
 IF (p_policy IS NOT DISTINCT FROM 'savings_account')<>(p_savings_account_id IS NOT NULL) THEN RAISE EXCEPTION 'יש לבחור יעד רק להעברה לחשבון חיסכון' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.categories WHERE id=p_category_id AND is_active AND type='expense' AND savings_role IS NULL) THEN RAISE EXCEPTION 'בחרו קטגוריית הוצאה פעילה שאינה הפקדה לחיסכון' USING ERRCODE='22023'; END IF;
 IF p_policy IS NULL THEN DELETE FROM public.budget_unused_balance_policies WHERE category_id=p_category_id;
 ELSE INSERT INTO public.budget_unused_balance_policies(category_id,policy,savings_account_id) VALUES(p_category_id,p_policy,p_savings_account_id)
 ON CONFLICT(category_id) DO UPDATE SET policy=excluded.policy,savings_account_id=excluded.savings_account_id,updated_at=now(); END IF;
 RETURN jsonb_build_object('category_id',p_category_id::text,'policy',p_policy,'savings_account_id',p_savings_account_id::text);
END $$;
CREATE OR REPLACE FUNCTION public.set_budget_unused_balance_policy(p_category_id BIGINT,p_policy TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.budget_unused_balance_policies IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.budget_unused_balance_policies WHERE category_id=p_category_id AND savings_account_id IS NOT NULL) THEN
 RAISE EXCEPTION 'קיים יעד חיסכון; יש להשתמש בבחירה המפורשת כדי לשנותו או להסירו' USING ERRCODE='22023'; END IF;
 RETURN public.set_budget_unused_balance_policy(p_category_id,p_policy,NULL);
END $$;

CREATE FUNCTION public.get_savings_surplus_preview(p_source_month TEXT,p_category_id BIGINT,p_account_id BIGINT,p_amount TEXT,p_payment_source_id BIGINT,p_cash_date DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE start_date DATE=public.budget_month_start_from_key(p_source_month); today DATE=timezone('Asia/Jerusalem',statement_timestamp())::date;
 a public.savings_accounts%ROWTYPE; c public.categories%ROWTYPE; ps public.payment_sources%ROWTYPE; cs public.budget_category_state%ROWTYPE;
 amount NUMERIC; actual NUMERIC; capacity NUMERIC; material JSONB; blockers JSONB; result JSONB; deposit_category BIGINT;
BEGIN
 IF p_amount IS NULL OR p_amount !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' OR p_amount::numeric<=0 OR p_amount::numeric>9999999999999999.99 THEN RAISE EXCEPTION 'הזינו סכום חיובי מדויק בשקלים, עד שתי ספרות עשרוניות' USING ERRCODE='22023',DETAIL='SAVINGS_EXACT_MONEY_REQUIRED'; END IF;
 amount=p_amount::numeric(18,2);
 SELECT * INTO a FROM public.savings_accounts WHERE id=p_account_id;
 SELECT * INTO c FROM public.categories WHERE id=p_category_id;
 SELECT * INTO ps FROM public.payment_sources WHERE id=p_payment_source_id;
 SELECT id INTO deposit_category FROM public.categories WHERE savings_role='deposit' AND is_active;
 IF a.id IS NULL OR a.status<>'active' OR ps.id IS NULL OR NOT ps.is_active OR deposit_category IS NULL THEN RAISE EXCEPTION 'יש לבחור חשבון חיסכון ואמצעי תשלום פעילים; בדקו גם את קטגוריית ההפקדה' USING ERRCODE='22023',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
 IF c.id IS NULL OR c.type<>'expense' OR NOT c.is_active OR c.savings_role IS NOT NULL THEN RAISE EXCEPTION 'מקור העודף חייב להיות קטגוריית הוצאה פעילה שאינה חיסכון' USING ERRCODE='22023'; END IF;
 IF start_date NOT IN (date_trunc('month',today)::date,(date_trunc('month',today)-interval '1 month')::date) THEN RAISE EXCEPTION 'העברה זמינה בחודש הנוכחי או בחודש הקודם שטרם נסגר' USING ERRCODE='22023',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED'; END IF;
 IF p_cash_date IS NULL OR NOT isfinite(p_cash_date) OR p_cash_date<a.tracking_start_date OR p_cash_date>today OR date_trunc('month',p_cash_date)::date NOT IN (start_date,(start_date+interval '1 month')::date) THEN RAISE EXCEPTION 'תאריך הכסף חייב להיות בחודש המקור או בחודש הבא, בתחום המעקב ולא בעתיד' USING ERRCODE='22023',DETAIL='SAVINGS_CUTOFF_VIOLATION'; END IF;
 IF EXISTS(SELECT 1 FROM public.budget_operations o JOIN public.budget_months m ON m.id=o.budget_month_id WHERE m.month_start IN (start_date,date_trunc('month',p_cash_date)::date) AND o.operation_type='month_close')
 OR EXISTS(SELECT 1 FROM public.budget_operation_items i JOIN public.budget_months m ON m.id=i.budget_month_id WHERE m.month_start=start_date AND i.item_kind IN ('carryover','unused_disposition')) THEN RAISE EXCEPTION 'החודש כבר נסגר או נכלל בהעברה תקציבית; אין לשכתב היסטוריה' USING ERRCODE='22023',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED'; END IF;
 SELECT state.* INTO cs FROM public.budget_category_state state JOIN public.budget_months m ON m.id=state.budget_month_id WHERE m.month_start=start_date AND state.category_id=p_category_id;
 IF cs.budget_id IS NULL OR cs.lifecycle_state<>'active' THEN RAISE EXCEPTION 'לקטגוריה אין תקציב פעיל בחודש המקור' USING ERRCODE='22023'; END IF;
 SELECT coalesce(sum(t.total_amount),0) INTO actual FROM public.budget_actual_transactions(start_date,(start_date+interval '1 month -1 day')::date) t WHERE t.category_id=p_category_id;
 capacity=greatest(cs.final_funded-greatest(actual,0),0);
 blockers=public.get_budget_month_disposition_preview(p_source_month);
 IF jsonb_array_length(blockers->'deficit_blockers')>0 OR jsonb_array_length(blockers->'unbudgeted_expense_blockers')>0 THEN RAISE EXCEPTION 'לפני העברה יש לפתור חריגות והוצאות ללא תקציב בחודש המקור' USING ERRCODE='22023'; END IF;
 IF amount>capacity THEN RAISE EXCEPTION 'הסכום גבוה מהעודף הממומן הפנוי; רעננו ובחרו סכום מתאים' USING ERRCODE='22023',DETAIL='SAVINGS_INSUFFICIENT_BALANCE'; END IF;
 result=jsonb_build_object('source_month',p_source_month,'category_id',p_category_id::text,'category_name',c.name,'source_budget_id',cs.budget_id::text,'source_month_id',cs.budget_month_id::text,
 'account_id',a.id::text,'account_name',a.name,'account_revision',a.revision::text,'amount',amount::numeric(18,2)::text,'payment_source_id',ps.id::text,'payment_source_name',ps.name,'cash_date',p_cash_date,
 'deposit_category_id',deposit_category::text,'eligible_surplus',capacity::numeric(18,2)::text,'raw_actual',actual::numeric(18,2)::text,'funded_before',cs.final_funded::numeric(18,2)::text,
 'funded_after',(cs.final_funded-amount)::numeric(18,2)::text,'savings_before',(SELECT current_balance FROM public.savings_account_summary WHERE account_id=a.id),
 'savings_after',((SELECT current_balance::numeric FROM public.savings_account_summary WHERE account_id=a.id)+amount)::numeric(18,2)::text,'opening_cutoff_confirmation_required',p_cash_date=a.tracking_start_date);
 material=jsonb_build_object('preview',result,'account',to_jsonb(a),'category',to_jsonb(c),'payment_source',to_jsonb(ps),'budget',to_jsonb(cs),'blockers',blockers,
 'policy',(SELECT to_jsonb(p) FROM public.budget_unused_balance_policies p WHERE category_id=p_category_id),
 'cash', (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]')::text) FROM public.transactions t WHERE t.transaction_date>=start_date AND t.transaction_date<(start_date+interval '1 month')));
 RETURN result||jsonb_build_object('fingerprint',md5(material::text));
END $$;

CREATE FUNCTION public.savings_apply_surplus_locked(p_request_key UUID,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE mode TEXT=p_command->>'mode'; v JSONB=p_command->'preview'; o public.budget_operations%ROWTYPE; i public.budget_operation_items%ROWTYPE;
 e public.savings_entries%ROWTYPE; a public.savings_accounts%ROWTYPE; t public.transactions%ROWTYPE; m public.budget_months%ROWTYPE;
 root_id BIGINT; posting_id BIGINT; funding_id BIGINT; movement_id BIGINT; cash_month_id BIGINT; cash_id INTEGER; entry_id BIGINT; ledger_key UUID; result JSONB; blocked BOOLEAN; fp TEXT;
BEGIN
 IF mode IN ('reverse_preview','reverse') THEN
  SELECT * INTO o FROM public.budget_operations WHERE id=(p_command->>'operation_id')::bigint;
  SELECT * INTO i FROM public.budget_operation_items WHERE source_operation_id=o.id AND item_kind='savings_transfer' AND action_kind='apply';
  SELECT * INTO e FROM public.savings_entries WHERE id=i.savings_event_id;
  SELECT * INTO a FROM public.savings_accounts WHERE id=e.account_id;
  SELECT * INTO t FROM public.transactions WHERE id=e.transaction_id;
  SELECT * INTO m FROM public.budget_months WHERE id=o.budget_month_id;
  IF i.id IS NULL THEN RAISE EXCEPTION 'העברת העודף לא נמצאה' USING ERRCODE='P0002'; END IF;
  blocked=o.parent_operation_id IS NOT NULL OR e.reversed_by_entry_id IS NOT NULL OR t.voided_at IS NOT NULL
   OR m.month_start NOT IN (date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date,(date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))-interval '1 month')::date)
   OR EXISTS(SELECT 1 FROM public.budget_operations bo JOIN public.budget_months bm ON bm.id=bo.budget_month_id WHERE bm.month_start IN (m.month_start,date_trunc('month',t.transaction_date)::date) AND bo.operation_type='month_close')
   OR EXISTS(SELECT 1 FROM public.budget_operation_items bi JOIN public.budget_months bm ON bm.id=bi.budget_month_id WHERE bm.month_start IN (m.month_start,date_trunc('month',t.transaction_date)::date) AND bi.item_kind IN ('carryover','unused_disposition'))
   OR NOT EXISTS(SELECT 1 FROM public.budget_category_state WHERE budget_id=i.source_budget_id AND lifecycle_state='active');
  result=jsonb_build_object('operation_id',o.id::text,'source_month',to_char(m.month_start,'YYYY-MM'),'category_id',i.category_id::text,'category_name',(SELECT name FROM public.categories WHERE id=i.category_id),'account_id',a.id::text,'account_name',a.name,'amount',e.amount::text,'cash_date',e.effective_date,'transaction_id',t.id::text,'reversible',NOT blocked,'reason',CASE WHEN blocked THEN 'אין לבטל העברה שכבר בוטלה או נכללה בסגירה/היסטוריה תקציבית' END);
  fp=md5(jsonb_build_object('operation',to_jsonb(o),'item',to_jsonb(i),'entry',to_jsonb(e),'account',to_jsonb(a),'cash',to_jsonb(t),'source',(SELECT to_jsonb(cs) FROM public.budget_category_state cs WHERE budget_id=i.source_budget_id),'result',result)::text);
  IF mode='reverse_preview' THEN RETURN result||jsonb_build_object('fingerprint',fp); END IF;
  IF blocked THEN RAISE EXCEPTION 'לא ניתן לבטל העברה היסטורית; החזרת כסף אמיתית נרשמת כמשיכה חדשה' USING ERRCODE='22023',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED'; END IF;
  IF p_command->>'fingerprint' IS DISTINCT FROM fp THEN RAISE EXCEPTION 'נתוני ההעברה השתנו; רעננו את ההיסטוריה לפני הביטול' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
  root_id=public.budget_create_action_root(o.budget_month_id,p_request_key,p_command->>'request_fingerprint','savings_account_transfer_reversal',m.month_start,p_command->>'reason',o.id);
  ledger_key=public.budget_derived_request_key(p_request_key,'savings-surplus-event');
  INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,entry_action,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,reverses_entry_id,reason)
   VALUES(e.account_id,ledger_key,0,'reverse_savings_surplus',p_command->>'request_fingerprint','deposit','reverse',e.amount,e.effective_date,'budget_surplus',e.transaction_id,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date,e.id,p_command->>'reason') RETURNING id INTO entry_id;
  UPDATE public.savings_entries SET reversed_by_entry_id=entry_id WHERE id=e.id;
  INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id) VALUES(root_id,e.amount,'savings_transfer','ביטול העברת עודף לחיסכון',i.source_funding_entry_id) RETURNING id INTO funding_id;
  INSERT INTO public.budget_movements(operation_id,destination_budget_id,amount) VALUES(root_id,i.source_budget_id,e.amount) RETURNING id INTO movement_id;
  INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,category_id,source_budget_id,source_operation_id,source_funding_entry_id,source_movement_id,savings_event_id,amount,raw_actual_snapshot,funded_before,reversed_item_id)
   VALUES(root_id,'savings_transfer','reversal',o.budget_month_id,i.destination_budget_month_id,i.category_id,i.source_budget_id,root_id,funding_id,movement_id,entry_id,e.amount,i.raw_actual_snapshot,i.funded_before,i.id);
  UPDATE public.transactions SET voided_at=now(),void_request_key=public.budget_derived_request_key(p_request_key,'savings-void-'||t.id),void_fingerprint=p_command->>'request_fingerprint',void_reason=p_command->>'reason' WHERE id=t.id;
  UPDATE public.savings_accounts SET revision=revision+1 WHERE id=a.id;
  PERFORM public.savings_assert_account(a.id);PERFORM public.budget_assert_reconciled(o.budget_month_id);
  RETURN result||jsonb_build_object('reversal_operation_id',root_id::text,'affected_account_ids',jsonb_build_array(a.id::text),'affected_transaction_ids',jsonb_build_array(t.id::text),'affected_months',jsonb_build_array(to_char(m.month_start,'YYYY-MM'),to_char(e.effective_date,'YYYY-MM')));
 END IF;
 IF mode IS DISTINCT FROM 'post_locked' THEN RAISE EXCEPTION 'פעולת עודף פנימית אינה תקינה' USING ERRCODE='22023'; END IF;
 root_id=(p_command->>'root_id')::bigint;
 IF root_id IS NULL THEN
  root_id=public.budget_create_action_root((v->>'source_month_id')::bigint,p_request_key,p_command->>'request_fingerprint','savings_account_transfer',public.budget_month_start_from_key(v->>'source_month'),'העברת עודף ממומן לחיסכון',NULL);posting_id=root_id;
 ELSE
  INSERT INTO public.budget_operations(budget_month_id,parent_operation_id,request_key,request_fingerprint,operation_type,effective_date,reason)
   VALUES((v->>'source_month_id')::bigint,root_id,p_request_key,p_command->>'request_fingerprint','savings_account_transfer',public.budget_month_start_from_key(v->>'source_month'),'סגירת חודש: הפקדה לחיסכון') RETURNING id INTO posting_id;
 END IF;
 INSERT INTO public.budget_months(month_start) VALUES(date_trunc('month',(v->>'cash_date')::date)::date) ON CONFLICT DO NOTHING;
 SELECT id INTO cash_month_id FROM public.budget_months WHERE month_start=date_trunc('month',(v->>'cash_date')::date)::date;
 INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label) VALUES(posting_id,-(v->>'amount')::numeric,'savings_transfer','עודף ממומן לחשבון '||(v->>'account_name')) RETURNING id INTO funding_id;
 INSERT INTO public.budget_movements(operation_id,source_budget_id,amount) VALUES(posting_id,(v->>'source_budget_id')::bigint,(v->>'amount')::numeric) RETURNING id INTO movement_id;
 INSERT INTO public.transactions(description,movement_type,total_amount,transaction_date,charge_date,category_id,payment_source_id,currency)
  VALUES('העברת עודף: '||(v->>'category_name')||' → '||(v->>'account_name'),'expense',(v->>'amount')::numeric,(v->>'cash_date')::date,(v->>'cash_date')::date,(v->>'deposit_category_id')::bigint,(v->>'payment_source_id')::bigint,'ILS') RETURNING id INTO cash_id;
 ledger_key=public.budget_derived_request_key(p_request_key,'savings-surplus-event');
 INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date)
  VALUES((v->>'account_id')::bigint,ledger_key,0,'apply_savings_surplus',p_command->>'request_fingerprint','deposit',(v->>'amount')::numeric,(v->>'cash_date')::date,'budget_surplus',cash_id,'expense',(v->>'deposit_category_id')::bigint,(v->>'payment_source_id')::bigint,(v->>'cash_date')::date) RETURNING id INTO entry_id;
 INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,destination_budget_month_id,category_id,source_budget_id,source_operation_id,source_funding_entry_id,source_movement_id,savings_event_id,amount,raw_actual_snapshot,funded_before)
 VALUES(root_id,'savings_transfer','apply',(v->>'source_month_id')::bigint,cash_month_id,(v->>'category_id')::bigint,(v->>'source_budget_id')::bigint,posting_id,funding_id,movement_id,entry_id,(v->>'amount')::numeric,(v->>'raw_actual')::numeric,(v->>'funded_before')::numeric);
 UPDATE public.savings_accounts SET revision=revision+1 WHERE id=(v->>'account_id')::bigint;
 PERFORM public.savings_assert_account((v->>'account_id')::bigint);PERFORM public.budget_assert_reconciled((v->>'source_month_id')::bigint);
 RETURN jsonb_build_object('operation_id',posting_id::text,'entry_id',entry_id::text,'transaction_id',cash_id::text,'affected_account_ids',jsonb_build_array(v->>'account_id'),'affected_transaction_ids',jsonb_build_array(cash_id::text),'affected_months',jsonb_build_array(v->>'source_month',to_char((v->>'cash_date')::date,'YYYY-MM')));
END $$;

CREATE FUNCTION public.apply_savings_surplus(p_request_key UUID,p_preview_fingerprint TEXT,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE k TEXT; value JSONB; c JSONB=p_command; v JSONB; old public.budget_operations%ROWTYPE; fp TEXT;
BEGIN
 IF p_request_key IS NULL OR p_preview_fingerprint IS NULL OR p_preview_fingerprint !~ '^[a-f0-9]{32}$' OR jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'חסרים פרטי העברה ואישור סקירה' USING ERRCODE='22023'; END IF;
 FOR k,value IN SELECT * FROM jsonb_each(c) LOOP
  IF NOT k=ANY(ARRAY['source_month','category_id','account_id','amount','payment_source_id','cash_date']) OR jsonb_typeof(value)<>'string' THEN RAISE EXCEPTION 'פרטי ההעברה אינם תקינים' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF NOT c ?& ARRAY['source_month','category_id','account_id','amount','payment_source_id','cash_date'] OR c->>'source_month' !~ '^[0-9]{4}-[0-9]{2}$' OR c->>'cash_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR c->>'category_id' !~ '^[1-9][0-9]*$' OR c->>'account_id' !~ '^[1-9][0-9]*$' OR c->>'payment_source_id' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'יש להזין את כל פרטי ההעברה, מזהים ותאריך תקין' USING ERRCODE='22023'; END IF;
 IF c->>'amount' !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'יש להזין סכום מדויק' USING ERRCODE='22023'; END IF;
 c=jsonb_set(c,'{amount}',to_jsonb((c->>'amount')::numeric(18,2)::text));fp=md5(jsonb_build_object('command',c,'preview',p_preview_fingerprint)::text);
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'יש לנסות שוב בבידוד READ COMMITTED' USING ERRCODE='22023'; END IF;
 LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE; LOCK TABLE public.budget_unused_balance_policies IN SHARE ROW EXCLUSIVE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
 PERFORM id FROM public.budget_months ORDER BY id FOR UPDATE;PERFORM id FROM public.budgets ORDER BY id FOR UPDATE;PERFORM id FROM public.categories ORDER BY id FOR UPDATE;PERFORM id FROM public.payment_sources ORDER BY id FOR UPDATE;PERFORM id FROM public.savings_accounts ORDER BY id FOR UPDATE;
 SELECT * INTO old FROM public.budget_operations WHERE request_key=p_request_key;
 IF FOUND THEN IF old.operation_type<>'savings_account_transfer' OR old.request_fingerprint<>fp THEN RAISE EXCEPTION 'מזהה הבקשה כבר שימש לפרטים אחרים' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('operation_id',old.id::text,'replayed',true,'affected_months',jsonb_build_array(c->>'source_month'),'affected_account_ids',jsonb_build_array(c->>'account_id')); END IF;
 v=public.get_savings_surplus_preview(c->>'source_month',(c->>'category_id')::bigint,(c->>'account_id')::bigint,c->>'amount',(c->>'payment_source_id')::bigint,(c->>'cash_date')::date);
 IF v->>'fingerprint' IS DISTINCT FROM p_preview_fingerprint THEN RAISE EXCEPTION 'העודף, החשבון או המדיניות השתנו; רעננו את הסקירה' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
 RETURN public.savings_apply_surplus_locked(p_request_key,jsonb_build_object('mode','post_locked','preview',v,'request_fingerprint',fp));
END $$;

CREATE FUNCTION public.reverse_savings_surplus(p_request_key UUID,p_operation_id BIGINT,p_preview_fingerprint TEXT,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old public.budget_operations%ROWTYPE; fp TEXT=md5(jsonb_build_object('operation_id',p_operation_id::text,'preview',p_preview_fingerprint,'reason',btrim(p_reason))::text);
BEGIN
 IF p_request_key IS NULL OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 OR p_preview_fingerprint IS NULL THEN RAISE EXCEPTION 'יש להזין סיבה ולאשר סקירת ביטול עדכנית' USING ERRCODE='22023'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'יש לנסות שוב בבידוד READ COMMITTED' USING ERRCODE='22023'; END IF;
 LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;LOCK TABLE public.budget_unused_balance_policies IN SHARE ROW EXCLUSIVE MODE;PERFORM pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
 PERFORM id FROM public.budget_months ORDER BY id FOR UPDATE;PERFORM id FROM public.budgets ORDER BY id FOR UPDATE;PERFORM id FROM public.categories ORDER BY id FOR UPDATE;PERFORM id FROM public.payment_sources ORDER BY id FOR UPDATE;PERFORM id FROM public.savings_accounts ORDER BY id FOR UPDATE;
 SELECT * INTO old FROM public.budget_operations WHERE request_key=p_request_key;
 IF FOUND THEN IF old.operation_type<>'savings_account_transfer_reversal' OR old.request_fingerprint<>fp THEN RAISE EXCEPTION 'מזהה הבקשה כבר שימש לפרטים אחרים' USING ERRCODE='40001'; END IF;RETURN jsonb_build_object('reversal_operation_id',old.id::text,'replayed',true);END IF;
 RETURN public.savings_apply_surplus_locked(p_request_key,jsonb_build_object('mode','reverse','operation_id',p_operation_id::text,'fingerprint',p_preview_fingerprint,'request_fingerprint',fp,'reason',btrim(p_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.apply_budget_month_disposition(
  p_source_month TEXT,p_request_key UUID,p_preview_fingerprint TEXT,p_reason TEXT,p_cash_confirmations JSONB
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
  v_savings_entry_id BIGINT; candidate RECORD; confirmation JSONB; captured JSONB; prepared JSONB='[]';
BEGIN
  IF jsonb_typeof(p_cash_confirmations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'נדרש אישור תשלום מפורש לכל יעד חיסכון' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_cash_confirmations)>0 THEN v_expected=v_expected||'|cash:'||p_cash_confirmations::text; END IF;
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
  LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.budget_unused_balance_policies IN SHARE ROW EXCLUSIVE MODE;
  PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  INSERT INTO public.budget_months(month_start) VALUES(v_destination_start) ON CONFLICT(month_start) DO NOTHING;
  SELECT id INTO v_destination_month_id FROM public.budget_months WHERE month_start=v_destination_start;
  PERFORM 1 FROM public.budget_months WHERE id IN(v_source_month_id,v_destination_month_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id IN(v_source_month_id,v_destination_month_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.payment_sources ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.savings_accounts ORDER BY id FOR UPDATE;
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
  -- Validate every cash preview before this batch changes accounts or closes the month.
  IF jsonb_array_length(p_cash_confirmations)<>(SELECT count(*) FROM jsonb_array_elements(v_preview->'categories') x WHERE x->>'status'='ready' AND x->>'policy'='savings_account') THEN
    RAISE EXCEPTION 'יש לאשר תשלום אחד לכל יעד חיסכון, ללא יעדים נוספים' USING ERRCODE='22023'; END IF;
  FOR candidate IN SELECT item FROM jsonb_array_elements(v_preview->'categories') x(item) WHERE item->>'status'='ready' AND item->>'policy'='savings_account' ORDER BY (item->>'category_id')::bigint LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(p_cash_confirmations) x WHERE x->>'category_id'=candidate.item->>'category_id')<>1 THEN RAISE EXCEPTION 'אישור חיסכון חסר או כפול' USING ERRCODE='22023'; END IF;
    SELECT x INTO confirmation FROM jsonb_array_elements(p_cash_confirmations) x WHERE x->>'category_id'=candidate.item->>'category_id';
    IF jsonb_typeof(confirmation)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(confirmation) x WHERE x.key<>ALL(ARRAY['category_id','account_id','amount','payment_source_id','cash_date','preview_fingerprint']) OR jsonb_typeof(x.value)<>'string')
      OR NOT confirmation ?& ARRAY['category_id','account_id','amount','payment_source_id','cash_date','preview_fingerprint'] OR confirmation->>'cash_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR confirmation->>'account_id' IS DISTINCT FROM candidate.item->'savings_account'->>'id'
      OR confirmation->>'amount' IS DISTINCT FROM candidate.item->>'eligible_unused' THEN RAISE EXCEPTION 'אישור התשלום אינו תואם ליעד ולעודף בסקירה' USING ERRCODE='22023'; END IF;
    captured=public.get_savings_surplus_preview(p_source_month,(confirmation->>'category_id')::bigint,(confirmation->>'account_id')::bigint,confirmation->>'amount',(confirmation->>'payment_source_id')::bigint,(confirmation->>'cash_date')::date);
    IF captured->>'fingerprint' IS DISTINCT FROM confirmation->>'preview_fingerprint' THEN RAISE EXCEPTION 'אישור החיסכון התיישן; יש לרענן את הסקירה' USING ERRCODE='40001'; END IF;
    prepared=prepared||jsonb_build_array(captured);
  END LOOP;
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
    IF candidate.item->>'policy'='savings_account' THEN
      SELECT x INTO captured FROM jsonb_array_elements(prepared) x WHERE x->>'category_id'=candidate.item->>'category_id';
      PERFORM public.savings_apply_surplus_locked(public.budget_derived_request_key(p_request_key,'named-savings|'||(candidate.item->>'category_id')),
        jsonb_build_object('mode','post_locked','root_id',v_batch_id::text,'preview',captured,'request_fingerprint',v_expected));
      CONTINUE;
    END IF;
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
  PERFORM 1 FROM public.categories ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.payment_sources ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.savings_accounts ORDER BY id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.apply_budget_month_disposition(p_source_month TEXT,p_request_key UUID,p_preview_fingerprint TEXT,p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.apply_budget_month_disposition(p_source_month,p_request_key,p_preview_fingerprint,p_reason,'[]'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.savings_post_event_locked(p_request_key UUID,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
<<cmd>>
DECLARE
  op TEXT=p_command->>'operation'; c JSONB=coalesce(p_command->'payload','{}');
  k TEXT; value JSONB; fp TEXT; reason TEXT=nullif(btrim(p_command->>'reason'),'');
  a public.savings_accounts%ROWTYPE; old_a public.savings_accounts%ROWTYPE;
  e public.savings_entries%ROWTYPE; t public.transactions%ROWTYPE;
  category public.categories%ROWTYPE; source public.payment_sources%ROWTYPE;
  account_id BIGINT; transaction_id INTEGER; category_id BIGINT; source_id BIGINT;
  amount NUMERIC; effective DATE; charge DATE; kind TEXT; action TEXT; revision BIGINT;
  reversed_id BIGINT; entry_id BIGINT; entry_index INTEGER=0; cash_fp TEXT;
  receipt JSONB; result JSONB; affected JSONB; months JSONB; reinstate BOOLEAN=false;
  old_overlap NUMERIC=0; new_overlap NUMERIC; reserve_balance NUMERIC;
  old_item public.budget_operation_items%ROWTYPE; month_id BIGINT; operation_id BIGINT; reserve_id BIGINT;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'יש לנסות שוב בבידוד READ COMMITTED' USING ERRCODE='22023';
  END IF;
  IF p_request_key IS NULL OR jsonb_typeof(c) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'חסרים פרטי פעולה ומזהה בקשה' USING ERRCODE='22023';
  END IF;
  FOR k,value IN SELECT j.key,j.value FROM jsonb_each(c) j LOOP
    IF NOT k=ANY(ARRAY['action','account_id','expected_revision','event_kind','amount','effective_date','transaction_id','expected_transaction_fingerprint','description','category_id','payment_source_id','charge_date','notes','reinstate','expected_destination_revision','cutoff_confirmed','legacy_overlap_amount','overlap_reason','expected_reserve_fingerprint']) THEN
      RAISE EXCEPTION 'שדה שאינו נתמך בפעולת חיסכון: %',k USING ERRCODE='22023';
    END IF;
    IF value='null'::jsonb THEN CONTINUE; END IF;
    IF k IN ('amount','legacy_overlap_amount') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' OR (value#>>'{}')::numeric>9999999999999999.99 THEN
        RAISE EXCEPTION 'יש להזין סכום מדויק בשקלים עם עד שתי ספרות עשרוניות' USING ERRCODE='22023',DETAIL='SAVINGS_EXACT_MONEY_REQUIRED';
      END IF;
      c=jsonb_set(c,ARRAY[k],to_jsonb(((value#>>'{}')::numeric(18,2))::text));
    ELSIF k IN ('account_id','expected_revision','transaction_id','category_id','payment_source_id','expected_destination_revision') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'מזהה או גרסה אינם תקינים' USING ERRCODE='22023';
      END IF;
    ELSIF k IN ('effective_date','charge_date') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR ((value#>>'{}')::date)::text<>(value#>>'{}') THEN
        RAISE EXCEPTION 'יש להזין תאריך לוח שנה תקין' USING ERRCODE='22023';
      END IF;
    ELSIF k IN ('reinstate','cutoff_confirmed') THEN
      IF jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'חסר אישור מפורש לפעולה' USING ERRCODE='22023'; END IF;
    ELSIF jsonb_typeof(value)<>'string' THEN RAISE EXCEPTION 'ערך טקסט אינו תקין' USING ERRCODE='22023';
    ELSE c=jsonb_set(c,ARRAY[k],coalesce(to_jsonb(nullif(btrim(value#>>'{}'),'')),'null'::jsonb)); END IF;
  END LOOP;
  IF op NOT IN ('post_savings_event','correct_savings_event','cancel_savings_event','void_detached_savings_transaction') THEN RAISE EXCEPTION 'פעולה לא נתמכת' USING ERRCODE='22023'; END IF;
  IF op<>'post_savings_event' AND (reason IS NULL OR length(reason)>2000) THEN RAISE EXCEPTION 'יש להזין סיבה לתיקון או לביטול, עד 2000 תווים' USING ERRCODE='22023'; END IF;
  LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;
  -- Reserve operations precede row locks, including an opening correction.
  IF op='correct_savings_event' AND EXISTS(SELECT 1 FROM public.savings_entries WHERE id=(p_command->>'entry_id')::bigint AND event_kind='opening') THEN
    LOCK TABLE public.budget_unused_balance_policies IN SHARE ROW EXCLUSIVE MODE;
    PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
  fp=md5((p_command||jsonb_build_object('payload',c,'reason',reason))::text);
  SELECT jsonb_agg(id::text ORDER BY command_index) INTO receipt FROM public.savings_entries WHERE command_id=p_request_key;
  IF receipt IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.savings_entries WHERE command_id=p_request_key AND (command_kind<>op OR command_fingerprint<>fp)) THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר שימש לפרטים אחרים' USING ERRCODE='40001',DETAIL='SAVINGS_LINK_CONFLICT';
    END IF;
    SELECT jsonb_agg(DISTINCT se.account_id::text) INTO affected FROM public.savings_entries se WHERE command_id=p_request_key;
    RETURN jsonb_build_object('entry_ids',receipt,'replayed',true,'affected_account_ids',affected,
      'affected_transaction_ids',(SELECT coalesce(jsonb_agg(DISTINCT se.transaction_id::text) FILTER(WHERE se.transaction_id IS NOT NULL),'[]') FROM public.savings_entries se WHERE command_id=p_request_key),
      'affected_months',(SELECT jsonb_agg(DISTINCT to_char(se.effective_date,'YYYY-MM')) FROM public.savings_entries se WHERE command_id=p_request_key));
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions WHERE void_request_key=p_request_key) AND op<>'void_detached_savings_transaction' THEN
    RAISE EXCEPTION 'מזהה הבקשה כבר שימש לביטול תנועה' USING ERRCODE='40001';
  END IF;
  IF op IN ('correct_savings_event','cancel_savings_event') THEN
    SELECT * INTO e FROM public.savings_entries WHERE id=(p_command->>'entry_id')::bigint;
    IF NOT FOUND OR e.entry_action<>'post' THEN RAISE EXCEPTION 'אירוע החיסכון לא נמצא' USING ERRCODE='P0002'; END IF;
    IF e.event_kind NOT IN ('opening','deposit','withdrawal','interest_capitalized','interest_payout') OR e.source_kind='budget_surplus' OR e.occurrence_month IS NOT NULL THEN
      RAISE EXCEPTION 'אירוע זה מחייב את פעולת הריבית, המועד או העודף הייעודית' USING ERRCODE='22023';
    END IF;
    reinstate=coalesce((c->>'reinstate')::boolean,false);
    IF (e.reversed_by_entry_id IS NOT NULL) IS DISTINCT FROM reinstate OR EXISTS(SELECT 1 FROM public.savings_entries WHERE supersedes_entry_id=e.id) THEN
      RAISE EXCEPTION 'האירוע השתנה או כבר הוחלף; יש לרענן' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE';
    END IF;
    IF op='cancel_savings_event' AND (reinstate OR e.event_kind='opening') THEN RAISE EXCEPTION 'אין לבטל יתרת פתיחה או אירוע שכבר בוטל' USING ERRCODE='22023'; END IF;
    account_id=coalesce((c->>'account_id')::bigint,e.account_id);
    transaction_id=e.transaction_id;
  ELSE account_id=(c->>'account_id')::bigint; transaction_id=(c->>'transaction_id')::integer; END IF;
  action=c->>'action';
  IF op='post_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash','noncash')) THEN RAISE EXCEPTION 'יש לבחור רישום כספי, קישור או ריבית בחיסכון' USING ERRCODE='22023'; END IF;
  IF op='correct_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash','detach','noncash')) THEN RAISE EXCEPTION 'יש לבחור תיקון, ניתוק או החזרה מפורשת' USING ERRCODE='22023'; END IF;
  IF op='cancel_savings_event' AND action IS DISTINCT FROM (CASE WHEN e.event_kind='interest_capitalized' THEN 'none' ELSE 'void' END) THEN
    RAISE EXCEPTION 'לניתוק ללא ביטול הכסף יש לבחור קטגוריה רגילה בטופס התיקון' USING ERRCODE='22023';
  END IF;
  category_id=(c->>'category_id')::bigint; source_id=(c->>'payment_source_id')::bigint;
  kind=coalesce(c->>'event_kind',e.event_kind); amount=(c->>'amount')::numeric;
  effective=(c->>'effective_date')::date; charge=(c->>'charge_date')::date;
  -- Consistent coarse-to-fine lock order. The complete set is intentionally
  -- conservative for the single-user database and foundation deferred scans.
  PERFORM id FROM public.budget_months ORDER BY id FOR UPDATE;
  PERFORM id FROM public.budgets ORDER BY id FOR UPDATE;
  PERFORM id FROM public.categories ORDER BY id FOR UPDATE;
  PERFORM id FROM public.payment_sources ORDER BY id FOR UPDATE;
  IF op<>'void_detached_savings_transaction' THEN PERFORM id FROM public.savings_accounts ORDER BY id FOR UPDATE; END IF;
  IF transaction_id IS NOT NULL THEN
    PERFORM id FROM public.transactions WHERE id=transaction_id FOR UPDATE;
    SELECT * INTO t FROM public.transactions WHERE id=transaction_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'התנועה לא נמצאה' USING ERRCODE='P0002'; END IF;
    cash_fp=md5((to_jsonb(t)-ARRAY['updated_at','voided_at','void_request_key','void_fingerprint','void_reason'])::text);
  END IF;
  IF op='void_detached_savings_transaction' THEN
    IF t.void_request_key=p_request_key THEN
      IF t.void_fingerprint<>fp THEN RAISE EXCEPTION 'קבלת הביטול אינה תואמת לבקשה' USING ERRCODE='40001'; END IF;
      RETURN jsonb_build_object('replayed',true,'transaction_id',t.id::text,'affected_transaction_ids',jsonb_build_array(t.id::text),'affected_account_ids','[]'::jsonb,'affected_months',jsonb_build_array(to_char(t.transaction_date,'YYYY-MM')));
    END IF;
    IF t.voided_at IS NOT NULL OR cash_fp IS DISTINCT FROM c->>'expected_transaction_fingerprint'
      OR NOT EXISTS(SELECT 1 FROM public.savings_entries WHERE savings_entries.transaction_id=t.id)
      OR EXISTS(SELECT 1 FROM public.savings_entries WHERE savings_entries.transaction_id=t.id AND entry_action='post' AND reversed_by_entry_id IS NULL)
      OR EXISTS(SELECT 1 FROM public.categories WHERE id=t.category_id AND savings_role IS NOT NULL) THEN
      RAISE EXCEPTION 'התנועה אינה מנותקת וחיה או השתנתה; יש לרענן' USING ERRCODE='40001',DETAIL='SAVINGS_LINK_CONFLICT';
    END IF;
  ELSE
    SELECT * INTO a FROM public.savings_accounts WHERE id=account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'חשבון החיסכון לא נמצא' USING ERRCODE='P0002'; END IF;
    IF e.id IS NOT NULL THEN
      SELECT * INTO old_a FROM public.savings_accounts WHERE id=e.account_id;
      IF old_a.revision IS DISTINCT FROM (p_command->>'expected_revision')::bigint THEN RAISE EXCEPTION 'החיסכון השתנה; יש לרענן לפני התיקון' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
      IF account_id<>e.account_id AND a.revision IS DISTINCT FROM (c->>'expected_destination_revision')::bigint THEN RAISE EXCEPTION 'חשבון היעד השתנה; יש לרענן' USING ERRCODE='40001'; END IF;
    ELSIF a.revision IS DISTINCT FROM (c->>'expected_revision')::bigint THEN RAISE EXCEPTION 'החיסכון השתנה; יש לרענן לפני הרישום' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
    IF (e.id IS NULL OR reinstate OR account_id<>e.account_id) AND a.status<>'active' THEN RAISE EXCEPTION 'יש לבחור חשבון פעיל לפעילות חדשה' USING ERRCODE='22023',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
    IF op<>'cancel_savings_event' THEN
      IF amount IS NULL OR amount<0 OR (kind<>'opening' AND amount=0) OR kind IS NULL OR kind NOT IN ('deposit','withdrawal','opening','interest_capitalized','interest_payout') THEN RAISE EXCEPTION 'סכום או סוג אירוע אינם תקינים' USING ERRCODE='22023'; END IF;
      IF effective IS NULL OR effective<a.tracking_start_date OR effective>timezone('Asia/Jerusalem',statement_timestamp())::date
        OR (kind<>'opening' AND effective=a.tracking_start_date AND c->'cutoff_confirmed' IS DISTINCT FROM 'true'::jsonb) THEN
        RAISE EXCEPTION 'התאריך חייב להיות בתחום המעקב; ביום הפתיחה יש לאשר שהכסף אינו כלול ביתרת הפתיחה' USING ERRCODE='22023',DETAIL='SAVINGS_CUTOFF_VIOLATION';
      END IF;
      IF e.id IS NULL AND kind='opening' THEN RAISE EXCEPTION 'יתרת פתיחה נוצרת רק עם החשבון' USING ERRCODE='22023'; END IF;
      IF e.id IS NOT NULL AND kind<>e.event_kind AND NOT (kind IN ('interest_capitalized','interest_payout') AND e.event_kind IN ('interest_capitalized','interest_payout')) THEN RAISE EXCEPTION 'אין להפוך הפקדה למשיכה; יש לבטל ולרשום אירוע נפרד' USING ERRCODE='22023'; END IF;
      IF reinstate AND kind<>e.event_kind THEN RAISE EXCEPTION 'החזרה משחזרת את יעד האירוע המקורי; תיקון יעד נעשה לאחר מכן בנפרד' USING ERRCODE='22023'; END IF;
      IF e.transaction_id IS NULL AND e.id IS NOT NULL AND c->>'transaction_id' IS NOT NULL THEN RAISE EXCEPTION 'המרת ריבית מהחיסכון אינה מקשרת כסף אחר' USING ERRCODE='22023'; END IF;
      IF kind='opening' THEN
        IF action<>'noncash' OR account_id<>e.account_id OR effective<>a.tracking_start_date OR reinstate OR c ?| ARRAY['transaction_id','category_id','payment_source_id','charge_date'] THEN RAISE EXCEPTION 'תיקון פתיחה שומר על החשבון והגבול וללא תנועה כספית' USING ERRCODE='22023'; END IF;
      ELSIF kind='interest_capitalized' THEN
        IF action<>'noncash' OR category_id IS NOT NULL OR source_id IS NOT NULL OR charge IS NOT NULL
          OR (e.transaction_id IS NULL AND transaction_id IS NOT NULL) THEN
          RAISE EXCEPTION 'ריבית שנשארה בחיסכון נרשמת ללא תנועת כסף או פרטי תשלום' USING ERRCODE='22023';
        END IF;
      ELSE
        IF action='noncash' OR (e.event_kind='interest_capitalized' AND action<>'create_cash') THEN
          RAISE EXCEPTION 'ריבית לעו״ש מחייבת פרטי הכנסה; המרת ריבית מהחיסכון יוצרת הכנסה חדשה אחת' USING ERRCODE='22023';
        END IF;
        SELECT * INTO category FROM public.categories WHERE id=category_id;
        SELECT * INTO source FROM public.payment_sources WHERE id=source_id;
        IF category.id IS NULL OR source.id IS NULL OR NOT category.is_active OR NOT source.is_active THEN RAISE EXCEPTION 'יש לבחור קטגוריה ואמצעי תשלום פעילים' USING ERRCODE='22023',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
        IF charge IS NULL OR category.type<>(CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END)
          OR (action='detach' AND category.savings_role IS NOT NULL)
          OR (action<>'detach' AND category.savings_role IS DISTINCT FROM kind) THEN RAISE EXCEPTION 'הקטגוריה אינה מתאימה לכיוון התנועה בחיסכון' USING ERRCODE='22023'; END IF;
        IF nullif(btrim(c->>'description'),'') IS NULL OR length(c->>'description')>2000 OR length(c->>'notes')>10000 THEN RAISE EXCEPTION 'יש להזין תיאור תקין לתנועה' USING ERRCODE='22023'; END IF;
      END IF;
    END IF;
  END IF;
  -- Every old/new cash period must remain free of captured Budget history.
  -- Use typed operation provenance, not merely current-month UI restrictions.
  IF kind IS DISTINCT FROM 'opening' THEN
    IF EXISTS(SELECT 1 FROM public.budget_operations bo JOIN public.budget_months bm ON bm.id=bo.budget_month_id
      WHERE bm.month_start IN (date_trunc('month',t.transaction_date)::date,CASE WHEN kind IN ('deposit','withdrawal','interest_payout') THEN date_trunc('month',effective)::date END)
        AND bo.operation_type IN ('month_close','carryover','unused_disposition','month_disposition'))
      OR EXISTS(SELECT 1 FROM public.budget_operation_items bi JOIN public.budget_months bm ON bm.id=bi.budget_month_id
        WHERE bm.month_start IN (date_trunc('month',t.transaction_date)::date,CASE WHEN kind IN ('deposit','withdrawal','interest_payout') THEN date_trunc('month',effective)::date END)
          AND bi.item_kind IN ('carryover','unused_disposition')) THEN
      RAISE EXCEPTION 'החודש כבר נסגר או נכלל בהעברה תקציבית; נדרש תיקון היסטורי מפורש' USING ERRCODE='22023',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED';
    END IF;
  END IF;
  IF op='void_detached_savings_transaction' THEN
    UPDATE public.transactions SET voided_at=now(),void_request_key=p_request_key,void_fingerprint=fp,void_reason=reason WHERE id=t.id;
    RETURN jsonb_build_object('transaction_id',t.id::text,'affected_transaction_ids',jsonb_build_array(t.id::text),'affected_account_ids','[]'::jsonb,'affected_months',jsonb_build_array(to_char(t.transaction_date,'YYYY-MM')));
  END IF;
  IF transaction_id IS NOT NULL AND op<>'cancel_savings_event' THEN
    IF nullif(btrim(t.installments_info),'') IS NOT NULL OR coalesce(t.installment_number,1)>1 THEN
      RAISE EXCEPTION 'תנועה מיובאת עם פירוט תשלומים אינה מתאימה לקישור ישיר לחיסכון' USING ERRCODE='22023',DETAIL='SAVINGS_LINK_CONFLICT';
    END IF;
    IF c->>'expected_transaction_fingerprint' IS DISTINCT FROM cash_fp OR (c->>'transaction_id')::integer IS DISTINCT FROM t.id THEN RAISE EXCEPTION 'התנועה השתנתה; יש לרענן ולאשר מחדש' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
    IF t.voided_at IS NOT NULL AND NOT (reinstate AND action='create_cash') THEN RAISE EXCEPTION 'אין להשתמש שוב בתנועה שבוטלה' USING ERRCODE='22023'; END IF;
    IF reinstate AND t.voided_at IS NULL AND action<>'link_cash' THEN RAISE EXCEPTION 'להחזרה לאחר ניתוק יש לקשר במפורש את הכסף הקיים' USING ERRCODE='22023'; END IF;
    IF e.id IS NULL AND EXISTS(SELECT 1 FROM public.savings_entries WHERE savings_entries.transaction_id=t.id) THEN RAISE EXCEPTION 'לתנועה היסטוריית חיסכון; יש להשתמש בהחזרה המפורשת של האירוע המקורי' USING ERRCODE='22023',DETAIL='SAVINGS_LINK_CONFLICT'; END IF;
    IF action='link_cash' AND (amount,effective,source_id,charge,CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END) IS DISTINCT FROM (t.total_amount,t.transaction_date,t.payment_source_id,t.charge_date,t.movement_type) THEN RAISE EXCEPTION 'קישור חייב לשמר את סכום הכסף, התאריכים, הכיוון ומקור התשלום הקיימים' USING ERRCODE='22023'; END IF;
  END IF;
  IF op='post_savings_event' AND ((action='create_cash' AND transaction_id IS NOT NULL) OR (action='link_cash' AND transaction_id IS NULL)) THEN RAISE EXCEPTION 'יש לבחור יצירה חדשה או קישור של תנועה קיימת בלבד' USING ERRCODE='22023'; END IF;
  IF action='detach' AND (e.id IS NULL OR reinstate OR account_id<>e.account_id) THEN RAISE EXCEPTION 'ניתוק משנה סיווג של אותה תנועה ואינו מעביר או מחזיר אירוע לחשבון אחר' USING ERRCODE='22023'; END IF;
  IF e.id IS NOT NULL AND NOT reinstate THEN
    INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,entry_action,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,reverses_entry_id,reason)
      VALUES(e.account_id,p_request_key,0,op,fp,e.event_kind,'reverse',e.amount,e.effective_date,e.source_kind,e.transaction_id,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date,e.id,reason) RETURNING id INTO reversed_id;
    UPDATE public.savings_entries SET reversed_by_entry_id=reversed_id WHERE id=e.id;
    entry_index=1;
  END IF;
  IF op='cancel_savings_event' OR (kind='interest_capitalized' AND t.id IS NOT NULL) THEN
    UPDATE public.transactions SET voided_at=now(),void_request_key=public.budget_derived_request_key(p_request_key,'savings-void-'||t.id),void_fingerprint=fp,void_reason=reason WHERE id=t.id;
  ELSIF kind IN ('deposit','withdrawal','interest_payout') THEN
    IF t.id IS NULL OR t.voided_at IS NOT NULL THEN
      INSERT INTO public.transactions(description,movement_type,total_amount,transaction_date,charge_date,category_id,payment_source_id,currency,notes)
        VALUES(c->>'description',CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END,amount,effective,charge,category_id,source_id,'ILS',c->>'notes') RETURNING id INTO transaction_id;
    ELSE
      UPDATE public.transactions SET description=c->>'description',total_amount=amount,transaction_date=effective,charge_date=charge,category_id=cmd.category_id,payment_source_id=source_id,notes=c->>'notes' WHERE id=t.id;
    END IF;
  END IF;
  IF kind='interest_capitalized' THEN transaction_id=NULL; END IF;
  IF op<>'cancel_savings_event' AND action<>'detach' THEN
    INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,supersedes_entry_id,reason)
      VALUES(account_id,p_request_key,entry_index,op,fp,kind,amount,effective,CASE WHEN kind='opening' THEN 'opening' WHEN e.id IS NOT NULL THEN e.source_kind WHEN action='link_cash' THEN 'existing_transaction' ELSE 'manual' END,
        transaction_id,CASE WHEN kind IN ('opening','interest_capitalized') THEN NULL WHEN kind='deposit' THEN 'expense' ELSE 'income' END,category_id,source_id,charge,e.id,reason) RETURNING id INTO entry_id;
  END IF;
  IF kind='opening' THEN
    SELECT * INTO old_item FROM public.budget_operation_items WHERE savings_event_id=e.id AND item_kind='reserve_retirement';
    old_overlap=coalesce(old_item.amount,0); new_overlap=(c->>'legacy_overlap_amount')::numeric;
    SELECT coalesce(sum(amount_delta),0) INTO reserve_balance FROM public.budget_savings_entries;
    IF new_overlap IS NULL OR new_overlap>amount OR new_overlap>reserve_balance+old_overlap OR c->>'expected_reserve_fingerprint' IS DISTINCT FROM
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]')::text) FROM public.budget_savings_entries b) THEN RAISE EXCEPTION 'יש לרענן ולאשר יתרת פתיחה וחפיפה לרזרבה לפני התיקון' USING ERRCODE='40001'; END IF;
    IF (old_overlap>0 OR new_overlap>0) AND nullif(btrim(c->>'overlap_reason'),'') IS NULL THEN RAISE EXCEPTION 'יש לאשר שהרזרבה המשוחררת זמינה מחוץ לחיסכון' USING ERRCODE='22023'; END IF;
    IF old_overlap>0 OR new_overlap>0 THEN
      INSERT INTO public.budget_months(month_start) VALUES(date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date) ON CONFLICT DO NOTHING;
      SELECT id INTO month_id FROM public.budget_months WHERE month_start=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
      SELECT id INTO category_id FROM public.categories WHERE savings_role='deposit' AND is_active;
      IF category_id IS NULL THEN RAISE EXCEPTION 'קטגוריית הפקדה אינה פעילה' USING ERRCODE='22023'; END IF;
      IF old_overlap>0 THEN
        INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reverses_operation_id)
          VALUES(month_id,public.budget_derived_request_key(p_request_key,'opening-reserve-reversal'),fp,'savings_reserve_retirement_reversal',date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date,old_item.operation_id) RETURNING id INTO operation_id;
        INSERT INTO public.budget_savings_entries(operation_id,category_id,entry_kind,amount_delta,reverses_entry_id) VALUES(operation_id,category_id,'account_opening_retirement_reversal',old_overlap,old_item.savings_entry_id) RETURNING id INTO reserve_id;
        INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,category_id,savings_event_id,savings_entry_id,amount,reversed_item_id)
          VALUES(operation_id,'reserve_retirement','reversal',month_id,category_id,reversed_id,reserve_id,old_overlap,old_item.id);
      END IF;
      IF new_overlap>0 THEN
        INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date)
          VALUES(month_id,public.budget_derived_request_key(p_request_key,'opening-reserve-retirement'),fp,'savings_reserve_retirement',date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date) RETURNING id INTO operation_id;
        INSERT INTO public.budget_savings_entries(operation_id,category_id,entry_kind,amount_delta) VALUES(operation_id,category_id,'account_opening_retirement',-new_overlap) RETURNING id INTO reserve_id;
        INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,category_id,savings_event_id,savings_entry_id,amount)
          VALUES(operation_id,'reserve_retirement','apply',month_id,category_id,entry_id,reserve_id,new_overlap);
      END IF;
    END IF;
  END IF;
  UPDATE public.savings_accounts sa SET revision=sa.revision+1 WHERE sa.id IN (account_id,e.account_id);
  FOR revision IN SELECT id FROM public.savings_accounts WHERE id IN (account_id,e.account_id) ORDER BY id LOOP
    BEGIN
      PERFORM public.savings_assert_account(revision);
      IF (SELECT coalesce(sum(se.amount),0) FROM public.savings_entries se WHERE se.account_id=revision AND se.entry_action='post' AND se.reversed_by_entry_id IS NULL AND se.event_kind IN ('interest_capitalized','interest_payout'))>9999999999999999.99 THEN
        RAISE EXCEPTION 'סך הריבית חורג מטווח הסכומים' USING ERRCODE='23514';
      END IF;
    EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'לא ניתן להשלים את הפעולה: תיווצר יתרה שלילית או חריגה מהטווח בהיסטוריית החיסכון' USING ERRCODE='23514',DETAIL='SAVINGS_INSUFFICIENT_BALANCE'; END;
  END LOOP;
  SELECT jsonb_agg(se.id::text ORDER BY command_index),jsonb_agg(DISTINCT se.account_id::text),jsonb_agg(DISTINCT to_char(se.effective_date,'YYYY-MM')) INTO receipt,affected,months FROM public.savings_entries se WHERE command_id=p_request_key;
  RETURN jsonb_build_object('entry_ids',receipt,'transaction_id',transaction_id::text,'affected_account_ids',affected,'affected_months',months,'affected_transaction_ids',(SELECT coalesce(jsonb_agg(DISTINCT se.transaction_id::text) FILTER(WHERE se.transaction_id IS NOT NULL),'[]') FROM public.savings_entries se WHERE command_id=p_request_key));
END $$;

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
  IF EXISTS(SELECT 1 FROM public.budget_operation_items WHERE operation_id=p_batch_id AND item_kind='savings_transfer') THEN
    RAISE EXCEPTION 'סגירה הכוללת הפקדה לחשבון חיסכון היא היסטוריה סגורה; אין לבטל בנתיב הישן' USING ERRCODE='23514',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED'; END IF;
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

CREATE OR REPLACE FUNCTION public.savings_guard_transaction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF num_nonnulls(NEW.voided_at,NEW.void_request_key,NEW.void_fingerprint,NEW.void_reason)>0 THEN RAISE EXCEPTION 'לא ניתן ליצור תנועה שבוטלה מראש' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'תנועה שבוטלה נשמרת לקריאה בלבד' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.savings_entries WHERE transaction_id=OLD.id) THEN RAISE EXCEPTION 'יש לבטל תנועת חיסכון בפקודה הייעודית; אין למחוק היסטוריה' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.savings_entries WHERE transaction_id=OLD.id)
    AND (NEW.transaction_date,NEW.total_amount,NEW.category_id,NEW.payment_source_id,NEW.charge_date,NEW.voided_at) IS DISTINCT FROM
        (OLD.transaction_date,OLD.total_amount,OLD.category_id,OLD.payment_source_id,OLD.charge_date,OLD.voided_at)
    AND (EXISTS (SELECT 1 FROM public.budget_operations o JOIN public.budget_months m ON m.id=o.budget_month_id
      WHERE m.month_start IN (date_trunc('month',OLD.transaction_date)::date,date_trunc('month',NEW.transaction_date)::date) AND o.operation_type='month_close')
      OR EXISTS (SELECT 1 FROM public.budget_operation_items i JOIN public.budget_months m ON m.id=i.budget_month_id
        WHERE m.month_start IN (date_trunc('month',OLD.transaction_date)::date,date_trunc('month',NEW.transaction_date)::date) AND i.item_kind IN ('carryover','unused_disposition'))) THEN
    RAISE EXCEPTION 'התיקון ישנה היסטוריית תקציב שנלכדה; אין לשנות תנועה זו בנתיב הרגיל' USING ERRCODE='23514',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.savings_entries WHERE transaction_id=OLD.id AND source_kind='budget_surplus') AND NOT (
    NEW.voided_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.savings_entries e JOIN public.budget_operation_items i ON i.savings_event_id=e.reversed_by_entry_id WHERE e.transaction_id=OLD.id AND e.source_kind='budget_surplus' AND i.item_kind='savings_transfer' AND i.action_kind='reversal')) THEN
    RAISE EXCEPTION 'העברת עודף ניתנת לתיקון רק בביטול מלא דרך היסטוריית התקציב ובסקירה חדשה' USING ERRCODE='23514',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED'; END IF;
  IF NEW.voided_at IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM public.savings_entries WHERE transaction_id=OLD.id)
    OR (to_jsonb(NEW)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','updated_at'])) THEN
    RAISE EXCEPTION 'ביטול מחייב תנועת חיסכון שמורה וקבלה תקינה ללא שינוי כספי נוסף' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

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
    IF NEW.operation_type='savings_account_transfer' AND NOT EXISTS(SELECT 1 FROM public.budget_operations WHERE id=v_context::bigint AND operation_type='month_close' AND parent_operation_id IS NULL) THEN RAISE EXCEPTION 'קיבוץ העברת חיסכון מחייב שורש סגירת חודש' USING ERRCODE='23514'; END IF;
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

CREATE OR REPLACE FUNCTION public.get_funded_budget_month(p_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    SELECT 1 FROM public.budget_actual_transactions(NULL,NULL)
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
    FROM public.budget_actual_transactions(NULL,NULL)
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
  FROM public.budget_actual_transactions(NULL,NULL) WHERE movement_type='expense'
    AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date;
  SELECT coalesce(sum(t.total_amount),0)::numeric(18,2) INTO v_budgeted_actual
  FROM public.budget_actual_transactions(NULL,NULL) t
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
    'action_lifecycle',public.budget_action_month_lifecycle(p_month),
    'savings_transfer_history',coalesce((SELECT jsonb_agg(public.savings_apply_surplus_locked(NULL,jsonb_build_object('mode','reverse_preview','operation_id',i.source_operation_id::text)) ORDER BY i.id DESC) FROM public.budget_operation_items i WHERE i.item_kind='savings_transfer' AND i.action_kind='apply' AND (i.budget_month_id=v_month_id OR i.destination_budget_month_id=v_month_id)),'[]'::jsonb),
    'cash_bridge',jsonb_build_object('envelope_actuals',v_total_actual::text,
      'cash_expenses',(SELECT coalesce(sum(total_amount),0)::numeric(18,2)::text FROM public.transactions WHERE movement_type='expense' AND voided_at IS NULL AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')),
      'funded_savings_transfers',(SELECT coalesce(sum(e.amount),0)::numeric(18,2)::text FROM public.savings_entries e JOIN public.budget_operation_items i ON i.savings_event_id=e.id WHERE e.source_kind='budget_surplus' AND e.entry_action='post' AND e.reversed_by_entry_id IS NULL AND i.item_kind='savings_transfer' AND i.action_kind='apply' AND e.effective_date>=v_month_start AND e.effective_date<(v_month_start+interval '1 month')),
      'manual_savings_deposits',(SELECT coalesce(sum(t.total_amount),0)::numeric(18,2)::text FROM public.budget_actual_transactions(v_month_start,(v_month_start+interval '1 month -1 day')::date) t JOIN public.categories c ON c.id=t.category_id WHERE c.savings_role='deposit'))
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.transactions_filtered(
  p_from                date    DEFAULT NULL,
  p_to                  date    DEFAULT NULL,
  p_category_id         bigint  DEFAULT NULL,
  p_payment_source_id   bigint  DEFAULT NULL,
  p_uncategorized_only  boolean DEFAULT false,
  p_search              text    DEFAULT NULL,
  p_savings_account_id bigint DEFAULT NULL,
  p_transaction_id integer DEFAULT NULL
)
RETURNS TABLE (
  id                integer,
  transaction_date  date,
  description       text,
  movement_type     text,
  total_amount      numeric,
  row_json          jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT
    t.id,
    t.transaction_date,
    t.description::text,
    t.movement_type::text,
    t.total_amount,
    pg_catalog.to_jsonb(t) || pg_catalog.jsonb_build_object(
      'total_amount',t.total_amount::text, 'category_id',t.category_id::text,'payment_source_id',t.payment_source_id::text,
      'transaction_fingerprint',md5((to_jsonb(t)-ARRAY['updated_at','voided_at','void_request_key','void_fingerprint','void_reason'])::text),
      'savings',CASE WHEN se.id IS NULL THEN NULL ELSE jsonb_build_object('entry_id',se.id::text,'account_id',sa.id::text,'name',sa.name,'status',sa.status,'revision',sa.revision::text,'event_kind',se.event_kind,'source_kind',se.source_kind,'active',se.reversed_by_entry_id IS NULL,'reinstatable',se.reversed_by_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.savings_entries replacement WHERE replacement.supersedes_entry_id=se.id)) END,
      'categories',
      CASE WHEN c.id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object('name', c.name, 'icon', c.icon, 'savings_role',c.savings_role) END,
      'payment_sources',
      CASE WHEN ps.id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object(
             'id',     ps.id,
             'name',   ps.name,
             'method', ps.method,
             'slug',   ps.slug,
             'issuer', ps.issuer,
             'last4',  ps.last4
           ) END
    )
  FROM public.transactions t
  -- LEFT JOIN is required: transactions with no category or no payment source
  -- must still appear (the "uncategorized only" filter depends on it).
  LEFT JOIN public.categories      c  ON c.id  = t.category_id
  LEFT JOIN public.payment_sources ps ON ps.id = t.payment_source_id
  LEFT JOIN LATERAL (SELECT e.* FROM public.savings_entries e WHERE e.transaction_id=t.id AND e.entry_action='post' ORDER BY (e.reversed_by_entry_id IS NULL) DESC,e.id DESC LIMIT 1) se ON true
  LEFT JOIN public.savings_accounts sa ON sa.id=se.account_id
  WHERE (t.voided_at IS NULL OR p_transaction_id=t.id)
    AND (p_transaction_id IS NULL OR p_transaction_id=t.id)
    AND (p_savings_account_id IS NULL OR se.account_id=p_savings_account_id)
    AND (p_from IS NULL OR t.transaction_date >= p_from)
    AND (p_to   IS NULL OR t.transaction_date <= p_to)
    AND (p_category_id IS NULL OR t.category_id = p_category_id)
    AND (p_payment_source_id IS NULL OR t.payment_source_id = p_payment_source_id)
    AND (NOT COALESCE(p_uncategorized_only, false) OR t.category_id IS NULL)
    AND (
      public.transactions_search_pattern(p_search) IS NULL
      -- Mirrors the previous client-side search exactly: description,
      -- amount-as-text, category name, payment source name. Notes are NOT
      -- searched, because the old implementation did not search them.
      OR t.description        ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR t.total_amount::text ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR sa.name              ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR c.name               ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR ps.name              ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
    );
$$;

REVOKE ALL ON FUNCTION public.get_savings_surplus_preview(text,bigint,bigint,text,bigint,date) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.get_savings_surplus_preview(text,bigint,bigint,text,bigint,date) TO service_role;

REVOKE ALL ON FUNCTION public.apply_savings_surplus(uuid,text,jsonb) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.apply_savings_surplus(uuid,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_savings_surplus(uuid,bigint,text,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.reverse_savings_surplus(uuid,bigint,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.set_budget_unused_balance_policy(bigint,text,bigint) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.set_budget_unused_balance_policy(bigint,text,bigint) TO service_role;

REVOKE ALL ON FUNCTION public.apply_budget_month_disposition(text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.apply_budget_month_disposition(text,uuid,text,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.savings_apply_surplus_locked(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.budget_actual_transactions(date,date) TO service_role;

COMMIT;
