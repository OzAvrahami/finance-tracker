-- OWNER RUN ONLY, immediately after 030 and before enabling account writes.
-- Read-only: one JSON result. PASS is structural, not proof of preservation:
-- compare every evidence fingerprint/count and reserve with saved preflight.
-- Later runs with accounts intentionally fail installation_empty; do not delete data.
WITH history AS (SELECT 'transactions' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.transactions r
UNION ALL
SELECT 'transaction_items' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.transaction_items r
UNION ALL
SELECT 'loans' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.loans r
UNION ALL
SELECT 'loan_payments' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.loan_payments r
UNION ALL
SELECT 'shopping_lists' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.shopping_lists r
UNION ALL
SELECT 'shopping_list_items' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.shopping_list_items r
UNION ALL
SELECT 'shopping_checkouts' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.shopping_checkouts r
UNION ALL
SELECT 'budgets' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budgets r
UNION ALL
SELECT 'budget_months' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_months r
UNION ALL
SELECT 'budget_funding_entries' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_funding_entries r
UNION ALL
SELECT 'budget_lifecycle_events' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_lifecycle_events r
UNION ALL
SELECT 'budget_month_overrides' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_month_overrides r
UNION ALL
SELECT 'budget_movements' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_movements r
UNION ALL
SELECT 'budget_operation_items' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_operation_items r
UNION ALL
SELECT 'budget_operations' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_operations r
UNION ALL
SELECT 'budget_recurring_defaults' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_recurring_defaults r
UNION ALL
SELECT 'budget_savings_entries' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_savings_entries r
UNION ALL
SELECT 'budget_unused_balance_policies' AS object_name,count(*) AS row_count,md5(coalesce(string_agg((to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text,E'\n' ORDER BY (to_jsonb(r)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','savings_event_id','savings_account_id'])::text),'')) AS fingerprint FROM public.budget_unused_balance_policies r),
evidence AS (SELECT jsonb_build_object(
  'financial_history',(SELECT jsonb_object_agg(object_name,jsonb_build_object('count',row_count,'fingerprint',fingerprint)) FROM history),
  'public_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
  'public_views',(SELECT count(*) FROM pg_views WHERE schemaname='public'),
  'legacy_reserve',(SELECT coalesce(sum(amount_delta),0)::text FROM public.budget_savings_entries),
  'budget_reconciliation_violations',(SELECT count(*) FROM public.budget_month_funding_state WHERE available<>total_allocated+unallocated),
  'budget_state_fingerprint',(SELECT md5(coalesce(string_agg(to_jsonb(f)::text,E'\n' ORDER BY budget_month_id),'')) FROM public.budget_month_funding_state f)
) AS body), checks AS (SELECT
  (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND table_name='shopping_lists' AND column_name IN ('store','link','target_date')) AS migration_029_preserved,
  (SELECT count(*)=2 AND bool_and(relkind='r' AND relrowsecurity) FROM pg_class WHERE oid IN ('public.savings_accounts'::regclass,'public.savings_entries'::regclass)) AS two_rls_tables,
  (SELECT relkind='v' FROM pg_class WHERE oid='public.savings_account_summary'::regclass) AS one_ordinary_summary_view,
  NOT EXISTS(SELECT 1 FROM public.savings_accounts) AND NOT EXISTS(SELECT 1 FROM public.savings_entries) AS installation_empty,
  NOT EXISTS(SELECT 1 FROM public.savings_accounts WHERE auto_deposit_enabled) AS automation_disabled,
  (SELECT count(*)=3 FROM public.categories WHERE savings_role IS NOT NULL) AS three_category_roles,
  (SELECT count(*)=11 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('savings_accounts_validate','savings_accounts_reconciled','savings_entries_immutable','savings_entries_reconciled','savings_transactions_guard','savings_transactions_reconciled','savings_transaction_items_guard','savings_transaction_items_reconciled','loan_payments_savings_link_guard','categories_savings_role_guard','budget_operation_items_savings_reconciled')) AS eleven_integrity_triggers,
  (SELECT count(*)=4 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_savings_account','update_savings_account','get_savings_account','budget_actual_transactions') AND prosecdef AND has_function_privilege('service_role',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE') AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']) AS public_rpc_boundaries,
  NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'savings_%' AND has_function_privilege('service_role',oid,'EXECUTE')) AS mutating_helpers_protected,
  NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(oid,'public','CREATE')) AS trusted_public_schema,
  NOT EXISTS(SELECT 1 FROM unnest(ARRAY['voided_at','void_request_key','void_fingerprint','void_reason']) col WHERE has_column_privilege('service_role','public.transactions',col,'UPDATE')) AS protected_void_fields,
  NOT has_table_privilege('service_role','public.savings_accounts','INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_table_privilege('service_role','public.savings_entries','INSERT,UPDATE,DELETE,TRUNCATE') AS no_direct_ledger_mutations,
  has_table_privilege('service_role','public.savings_account_summary','SELECT') AND has_function_privilege('service_role','public.budget_actual_transactions(date,date)','EXECUTE') AS service_read_exception,
  NOT EXISTS(SELECT 1 FROM public.budget_month_funding_state WHERE available<>total_allocated+unallocated) AS budget_reconciled,
  NOT EXISTS(SELECT 1 FROM public.savings_accounts a WHERE (SELECT count(*) FROM public.savings_entries e WHERE e.account_id=a.id AND event_kind='opening' AND entry_action='post' AND reversed_by_entry_id IS NULL)<>1) AS account_opening_links,
  NOT EXISTS(SELECT 1 FROM public.savings_account_summary WHERE current_balance::numeric<0) AS nonnegative_balances,
  NOT EXISTS(SELECT 1 FROM public.loan_payments l JOIN public.transactions t ON t.id=l.transaction_id LEFT JOIN public.categories c ON c.id=t.category_id WHERE t.voided_at IS NOT NULL OR c.savings_role IS NOT NULL OR EXISTS(SELECT 1 FROM public.savings_entries e WHERE e.transaction_id=t.id)) AS loan_links_valid,
  NOT EXISTS(SELECT 1 FROM public.transactions WHERE num_nonnulls(voided_at,void_request_key,void_fingerprint,void_reason) NOT IN (0,4)) AS complete_void_receipts,
  NOT EXISTS(SELECT 1 FROM public.savings_entries e JOIN public.transactions t ON t.id=e.transaction_id WHERE e.entry_action='post' AND e.reversed_by_entry_id IS NULL AND (t.voided_at IS NOT NULL OR (e.amount,e.effective_date,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date) IS DISTINCT FROM (t.total_amount,t.transaction_date,t.movement_type,t.category_id,t.payment_source_id,t.charge_date))) AS active_cash_links
)
SELECT jsonb_build_object('result',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(checks)) c WHERE c.value<>'true'::jsonb) THEN 'MIGRATION_030_POSTFLIGHT_PASS' ELSE 'MIGRATION_030_POSTFLIGHT_BLOCKED' END,'checks',to_jsonb(checks),'evidence',evidence.body,'action','Compare saved preflight evidence exactly; expected schema delta is +2 tables/+1 view. Deploy compatible readers before downstream cash commands.') AS migration_030_postflight FROM checks CROSS JOIN evidence;
