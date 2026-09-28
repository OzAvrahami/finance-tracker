-- OWNER RUN ONLY. Read-only; one consolidated JSON result. Requires Migration 033.
-- Pause application/import/scheduler writes across preflight -> 033 -> postflight.
-- Save both results and compare evidence EXACTLY; PASS alone does not prove preservation.
-- Existing Savings accounts are supported; no empty-history requirement or backfill.
WITH history AS (
SELECT 'transactions' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.transactions r
UNION ALL
SELECT 'transaction_items' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.transaction_items r
UNION ALL
SELECT 'loans' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.loans r
UNION ALL
SELECT 'loan_payments' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.loan_payments r
UNION ALL
SELECT 'shopping_lists' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.shopping_lists r
UNION ALL
SELECT 'shopping_list_items' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.shopping_list_items r
UNION ALL
SELECT 'shopping_checkouts' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.shopping_checkouts r
UNION ALL
SELECT 'budgets' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budgets r
UNION ALL
SELECT 'budget_months' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_months r
UNION ALL
SELECT 'budget_funding_entries' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_funding_entries r
UNION ALL
SELECT 'budget_lifecycle_events' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_lifecycle_events r
UNION ALL
SELECT 'budget_month_overrides' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_month_overrides r
UNION ALL
SELECT 'budget_movements' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_movements r
UNION ALL
SELECT 'budget_operation_items' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_operation_items r
UNION ALL
SELECT 'budget_operations' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_operations r
UNION ALL
SELECT 'budget_recurring_defaults' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_recurring_defaults r
UNION ALL
SELECT 'budget_savings_entries' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_savings_entries r
UNION ALL
SELECT 'budget_unused_balance_policies' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.budget_unused_balance_policies r
UNION ALL
SELECT 'savings_accounts' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.savings_accounts r
UNION ALL
SELECT 'savings_entries' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.savings_entries r
UNION ALL
SELECT 'categories' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.categories r
UNION ALL
SELECT 'payment_sources' AS name,count(*) AS rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.payment_sources r
), checks AS (SELECT
to_regprocedure('public.create_savings_account(uuid,jsonb,text,text,text)') IS NOT NULL AS foundation_installed,
(SELECT count(*)=2 AND bool_and(relkind='r' AND relrowsecurity) FROM pg_class WHERE oid IN ('public.savings_accounts'::regclass,'public.savings_entries'::regclass)) AS two_rls_tables,
(SELECT relkind='v' FROM pg_class WHERE oid='public.savings_account_summary'::regclass) AS one_summary_view,
NOT EXISTS(SELECT 1 FROM public.savings_accounts WHERE auto_deposit_enabled) AS automation_disabled,
NOT EXISTS(SELECT 1 FROM public.budget_month_funding_state WHERE available<>total_allocated+unallocated) AS budget_reconciled,
has_function_privilege('service_role','public.budget_actual_transactions(date,date)','EXECUTE') AS budget_reader_exception,
NOT has_column_privilege('service_role','public.transactions','voided_at','UPDATE') AND NOT has_column_privilege('service_role','public.transactions','void_request_key','UPDATE') AND NOT has_column_privilege('service_role','public.transactions','void_fingerprint','UPDATE') AND NOT has_column_privilege('service_role','public.transactions','void_reason','UPDATE') AS void_fields_protected,
(SELECT count(*)=4 AND bool_and(prosecdef AND has_function_privilege('service_role',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE') AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('post_savings_event','correct_savings_event','cancel_savings_event','void_detached_savings_transaction')) AS four_public_commands,
NOT has_function_privilege('service_role','public.savings_post_event_locked(uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.savings_post_event_locked(uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.savings_post_event_locked(uuid,jsonb)','EXECUTE') AS mutation_helper_private,
(SELECT count(*)=2 AND bool_and(prosecdef=(proname='transactions_filtered') AND has_function_privilege('service_role',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE')) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('transactions_filtered','transactions_page')) AS reader_signatures_and_grants
,
(SELECT md5(prosrc)='b1c5399c60bd64ad454691ef1b9c4bff' FROM pg_proc WHERE oid='public.savings_post_event_locked(uuid,jsonb)'::regprocedure) AS expected_event_engine,
(SELECT md5(prosrc)='5c7b85557f2ca0131aa4b1fb26764734' FROM pg_proc WHERE oid='public.get_savings_account(bigint,date,date,bigint,integer)'::regprocedure) AS expected_history_reader
,
 (SELECT count(*)=3 AND bool_and(prosecdef AND has_function_privilege('service_role',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE')) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_savings_surplus_preview','apply_savings_surplus','reverse_savings_surplus')) AS surplus_commands,
 NOT has_function_privilege('service_role','public.savings_apply_surplus_locked(uuid,jsonb)','EXECUTE') AS surplus_helper_private,
 to_regprocedure('public.apply_budget_month_disposition(text,uuid,text,text,jsonb)') IS NOT NULL AND to_regprocedure('public.set_budget_unused_balance_policy(bigint,text,bigint)') IS NOT NULL AS explicit_budget_overloads
), evidence AS (SELECT jsonb_build_object(
 'unchanged_functions_fingerprint',(SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),E'\n' ORDER BY oid::regprocedure::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' AND proname NOT IN ('validate_budget_unused_balance_policy','validate_budget_operation_tree','validate_budget_operation_item','savings_assert_links','budget_actual_transactions','budget_month_disposition_candidate_rows','get_budget_month_disposition_preview','set_budget_unused_balance_policy','get_savings_surplus_preview','savings_apply_surplus_locked','apply_savings_surplus','reverse_savings_surplus','apply_budget_month_disposition','savings_post_event_locked','reverse_budget_month_disposition','savings_guard_transaction','group_budget_posting_operation','get_funded_budget_month','transactions_filtered')),
 'financial_history',(SELECT jsonb_object_agg(name,jsonb_build_object('count',rows,'fingerprint',fingerprint)) FROM history),
 'public_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
 'public_views',(SELECT count(*) FROM pg_views WHERE schemaname='public'),
 'legacy_reserve',(SELECT coalesce(sum(amount_delta),0)::text FROM public.budget_savings_entries),
 'budget_state_fingerprint',(SELECT md5(coalesce(string_agg(to_jsonb(f)::text,E'\n' ORDER BY budget_month_id),'')) FROM public.budget_month_funding_state f)
) AS body)
SELECT jsonb_build_object('result',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(c)) WHERE value<>'true'::jsonb) THEN 'MIGRATION_033_POSTFLIGHT_PASS' ELSE 'MIGRATION_033_POSTFLIGHT_FAIL' END,'checks',to_jsonb(c),'evidence',e.body) FROM checks c CROSS JOIN evidence e;
