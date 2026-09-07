-- Migration 028 production postflight (SELECT/catalog only).
-- Run this entire script in Supabase SQL Editor after Migration 028 commits.
-- It returns exactly one consolidated result row and performs no writes.

BEGIN TRANSACTION READ ONLY;

WITH
preview AS (
  SELECT pg_get_functiondef(
    'public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)'::regprocedure
  ) AS definition
),
objects AS (
  SELECT
    count(*) FILTER (WHERE c.relkind IN ('r','p') AND c.relname LIKE 'budget%') AS budget_tables,
    count(*) FILTER (WHERE c.relkind='v' AND c.relname LIKE 'budget%') AS budget_views,
    count(*) FILTER (WHERE c.relname=ANY(ARRAY[
      'budget_carryover_batches','budget_carryover_transfers','budget_month_override_events',
      'budget_month_disposition_batches','budget_unused_disposition_events','budget_funding_actions',
      'budget_funding_action_legs','budget_unbudgeted_resolution_events'
    ])) AS retired_relations
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
),
integrity AS (
  SELECT
    count(*) AS checked_months,
    count(*) FILTER (WHERE available<>total_allocated+unallocated) AS bad_months,
    coalesce(max(abs(available-total_allocated-unallocated)),0)::numeric(18,2) AS max_delta
  FROM public.budget_month_funding_state
),
composition AS (
  SELECT count(*) FILTER (WHERE final_funded<>(
    opening_base+override_adjustment_total+incoming_carryover-outgoing_carryover
    +incoming_reallocation_resolution-outgoing_reallocation
    +unbudgeted_resolution_adjustment+unused_disposition_adjustment+other_adjustments
  )) AS bad_categories
  FROM public.budget_category_composition
),
acl AS (
  SELECT
    NOT EXISTS (
      SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) privilege
      WHERE p.oid='public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)'::regprocedure
        AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE'
    ) AS public_denied,
    NOT has_function_privilege('anon',
      'public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)','EXECUTE') AS anon_denied,
    NOT has_function_privilege('authenticated',
      'public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)','EXECUTE') AS authenticated_denied,
    has_function_privilege('service_role',
      'public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)','EXECUTE') AS service_allowed
),
retained AS (
  SELECT jsonb_build_object(
    'budget_months',(SELECT count(*) FROM public.budget_months),
    'budgets',(SELECT count(*) FROM public.budgets),
    'operations',(SELECT count(*) FROM public.budget_operations),
    'operation_items',(SELECT count(*) FROM public.budget_operation_items),
    'funding_entries',(SELECT count(*) FROM public.budget_funding_entries),
    'movements',(SELECT count(*) FROM public.budget_movements),
    'lifecycle_events',(SELECT count(*) FROM public.budget_lifecycle_events),
    'savings_entries',(SELECT count(*) FROM public.budget_savings_entries),
    'recurring_defaults',(SELECT count(*) FROM public.budget_recurring_defaults),
    'month_overrides',(SELECT count(*) FROM public.budget_month_overrides),
    'unused_policies',(SELECT count(*) FROM public.budget_unused_balance_policies),
    'transactions',(SELECT count(*) FROM public.transactions)
  ) AS row_counts
),
checks AS (
  SELECT
    current_setting('transaction_read_only')::boolean AS read_only,
    objects.budget_tables=11 AS table_shape_ok,
    objects.budget_views=9 AS view_shape_ok,
    objects.retired_relations=0 AS retired_relations_absent,
    preview.definition NOT LIKE '%UNBUDGETED_RESOLUTION_EXCEEDS_ACTUAL%' AS old_expense_cap_absent,
    preview.definition NOT LIKE '%maximum_allocation%' AS old_maximum_field_absent,
    preview.definition LIKE '%amount_needed_to_cover_actual%' AS corrected_contract_present,
    integrity.checked_months,
    integrity.bad_months=0 AS funding_reconciled,
    integrity.max_delta,
    composition.bad_categories=0 AS composition_reconciled,
    acl.public_denied AND acl.anon_denied AND acl.authenticated_denied AND acl.service_allowed AS preview_acl_ok,
    retained.row_counts
  FROM preview,objects,integrity,composition,acl,retained
)
SELECT
  CASE WHEN read_only AND table_shape_ok AND view_shape_ok AND retired_relations_absent
         AND old_expense_cap_absent AND old_maximum_field_absent AND corrected_contract_present
         AND funding_reconciled AND composition_reconciled AND preview_acl_ok
       THEN 'MIGRATION_028_POSTFLIGHT_PASS' ELSE 'MIGRATION_028_POSTFLIGHT_BLOCKED' END AS verdict,
  to_jsonb(checks) AS checks
FROM checks;

COMMIT;
