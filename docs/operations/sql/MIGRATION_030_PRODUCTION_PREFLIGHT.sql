-- OWNER RUN ONLY, before 030, against the confirmed 029 deployment.
-- Read-only: one JSON result. Save this result and compare postflight financial
-- fingerprints/counts, Budget state and reserve exactly, with writes quiesced.
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
  (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND table_name='shopping_lists' AND column_name IN ('store','link','target_date')) AS migration_029_present,
  to_regclass('public.savings_accounts') IS NULL AND to_regclass('public.savings_entries') IS NULL AND to_regclass('public.savings_account_summary') IS NULL AS savings_absent,
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='voided_at') AS receipt_absent,
  (SELECT count(*)=3 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS api_roles_present,
  NOT EXISTS (SELECT 1 FROM public.budget_month_funding_state WHERE available<>total_allocated+unallocated) AS budget_reconciled,
  NOT EXISTS (SELECT 1 FROM public.categories WHERE name IN ('הפקדה לחיסכון','משיכה מחיסכון','ריבית מחיסכון לעו״ש')) AS role_seed_names_available
)
SELECT jsonb_build_object('result',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(checks)) c WHERE c.value<>'true'::jsonb) THEN 'MIGRATION_030_PREFLIGHT_PASS' ELSE 'MIGRATION_030_PREFLIGHT_BLOCKED' END,'checks',to_jsonb(checks),'evidence',evidence.body,'action','Save this result. Resolve every false check; do not guess legacy overlap.') AS migration_030_preflight FROM checks CROSS JOIN evidence;
