-- OWNER RUN ONLY after 035, with writers paused. READ ONLY, ONE JSON result.
-- Not a 029 preflight: requires all Savings objects. Run the ordered stage
-- checks first. PASS is a database invariant check, not production acceptance.
WITH RECURSIVE live AS (
 SELECT * FROM public.savings_entries WHERE entry_action='post' AND reversed_by_entry_id IS NULL
), chain AS (
 SELECT id,id AS root,supersedes_entry_id AS predecessor FROM live
 UNION ALL
 SELECT c.id,e.id,e.supersedes_entry_id FROM chain c
 JOIN public.savings_entries e ON e.id=c.predecessor AND e.id<c.root
), prefixes AS (
 SELECT e.account_id,sum(CASE WHEN e.event_kind IN ('opening','deposit','interest_capitalized') THEN e.amount
  WHEN e.event_kind='withdrawal' THEN -e.amount ELSE 0 END)
 OVER(PARTITION BY e.account_id ORDER BY (e.event_kind<>'opening'),e.effective_date,c.root ROWS UNBOUNDED PRECEDING) AS balance
 FROM chain c JOIN live e ON e.id=c.id WHERE c.predecessor IS NULL
), ledger AS (
 SELECT account_id,sum((CASE WHEN entry_action='post' THEN 1 ELSE -1 END)*
  (CASE WHEN event_kind IN ('opening','deposit','interest_capitalized') THEN amount WHEN event_kind='withdrawal' THEN -amount ELSE 0 END)) AS held
 FROM public.savings_entries GROUP BY account_id
), report AS (
 SELECT public.get_savings_report(date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date,
  timezone('Asia/Jerusalem',statement_timestamp())::date,NULL) AS body
), checks AS (SELECT
 (SELECT count(*)=2 AND bool_and(relkind='r' AND relrowsecurity) FROM pg_class WHERE oid IN ('public.savings_accounts'::regclass,'public.savings_entries'::regclass)) AS two_rls_tables,
 (SELECT relkind='v' FROM pg_class WHERE oid='public.savings_account_summary'::regclass) AS one_summary_view,
 NOT EXISTS(SELECT 1 FROM public.savings_accounts a WHERE (SELECT count(*) FROM live e WHERE e.account_id=a.id AND e.event_kind='opening')<>1) AS one_live_opening_per_account,
 NOT EXISTS(SELECT 1 FROM live l WHERE NOT EXISTS(SELECT 1 FROM chain c WHERE c.id=l.id AND c.predecessor IS NULL)) AS complete_original_post_chains,
 NOT EXISTS(SELECT 1 FROM prefixes WHERE balance<0 OR balance>9999999999999999.99) AS solvent_original_order_prefixes,
 NOT EXISTS(SELECT 1 FROM ledger l JOIN public.savings_account_summary s ON s.account_id=l.account_id WHERE l.held<>s.current_balance::numeric) AS signed_ledger_matches_held,
 NOT EXISTS(SELECT 1 FROM public.savings_entries e LEFT JOIN public.savings_entries r ON r.id=e.reversed_by_entry_id WHERE e.reversed_by_entry_id IS NOT NULL AND (r.reverses_entry_id IS DISTINCT FROM e.id OR r.entry_action IS DISTINCT FROM 'reverse')) AS reversal_pairs,
 NOT EXISTS(SELECT 1 FROM live e LEFT JOIN public.transactions t ON t.id=e.transaction_id LEFT JOIN public.categories c ON c.id=t.category_id WHERE e.transaction_id IS NOT NULL AND
  (t.id IS NULL OR t.voided_at IS NOT NULL OR (t.total_amount,t.transaction_date,t.movement_type,t.category_id,t.payment_source_id,t.charge_date) IS DISTINCT FROM
   (e.amount,e.effective_date,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date) OR
   c.savings_role IS DISTINCT FROM e.event_kind)) AS live_cash_ledger_agreement,
 NOT EXISTS(SELECT transaction_id FROM live WHERE transaction_id IS NOT NULL GROUP BY transaction_id HAVING count(*)>1) AS cash_link_unique,
 NOT EXISTS(SELECT 1 FROM public.transactions t JOIN public.categories c ON c.id=t.category_id WHERE t.voided_at IS NULL AND c.savings_role IS NOT NULL AND NOT EXISTS(SELECT 1 FROM live e WHERE e.transaction_id=t.id)) AS no_cash_only_savings_role,
 NOT EXISTS(SELECT 1 FROM public.loan_payments p JOIN public.transactions t ON t.id=p.transaction_id LEFT JOIN public.categories c ON c.id=t.category_id WHERE t.voided_at IS NOT NULL OR c.savings_role IS NOT NULL OR EXISTS(SELECT 1 FROM public.savings_entries e WHERE e.transaction_id=t.id)) AS loan_links_disjoint,
 NOT EXISTS(SELECT account_id,occurrence_month FROM public.savings_entries WHERE occurrence_month IS NOT NULL AND occurrence_root_id IS NULL AND entry_action='post' GROUP BY account_id,occurrence_month HAVING count(*)>1) AS permanent_occurrence_claims_unique,
 NOT EXISTS(SELECT 1 FROM public.savings_accounts WHERE status='archived' AND auto_deposit_enabled) AS archived_automation_off,
 NOT EXISTS(SELECT 1 FROM public.budget_month_funding_state WHERE available<>total_allocated+unallocated) AS funded_budget_reconciled,
 has_function_privilege('service_role','public.budget_actual_transactions(date,date)','EXECUTE') AS budget_reader_exception,
 NOT has_function_privilege('service_role','public.savings_post_event_locked(uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('service_role','public.savings_apply_surplus_locked(uuid,jsonb)','EXECUTE') AS mutation_helpers_private,
 NOT has_column_privilege('service_role','public.transactions','voided_at','UPDATE') AND NOT has_column_privilege('service_role','public.transactions','void_request_key','UPDATE') AND NOT has_column_privilege('service_role','public.transactions','void_fingerprint','UPDATE') AND NOT has_column_privilege('service_role','public.transactions','void_reason','UPDATE') AS void_columns_protected,
 (SELECT (body#>>'{cash,expenses}')::numeric=(body#>>'{cash,ordinary_expenses}')::numeric+(body#>>'{cash,deposits}')::numeric AND
  (body#>>'{cash,income}')::numeric=(body#>>'{cash,other_income}')::numeric+(body#>>'{cash,withdrawals}')::numeric+(body#>>'{cash,paid_out_interest}')::numeric FROM report) AS current_month_cash_bridge
)
SELECT jsonb_build_object(
 'result',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(c)) WHERE value IS DISTINCT FROM 'true'::jsonb) THEN 'SAVINGS_RELEASE_POSTFLIGHT_PASS' ELSE 'SAVINGS_RELEASE_POSTFLIGHT_FAIL' END,
 'checks',to_jsonb(c),
 'evidence',jsonb_build_object(
  'public_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
  'public_views',(SELECT count(*) FROM pg_views WHERE schemaname='public'),
  'accounts',(SELECT count(*) FROM public.savings_accounts),
  'entries',(SELECT count(*) FROM public.savings_entries),
  'live_transactions',(SELECT count(*) FROM public.transactions WHERE voided_at IS NULL),
  'voided_transactions',(SELECT count(*) FROM public.transactions WHERE voided_at IS NOT NULL),
  'legacy_reserve',(SELECT balance_text FROM public.budget_savings_state),
  'automation_enabled_accounts',(SELECT count(*) FROM public.savings_accounts WHERE auto_deposit_enabled),
  'current_month_report',(SELECT body FROM report)),
 'operator_action','Require every check true; compare stage fingerprints to saved preflight. Before first activation expect zero Savings accounts/entries/enabled flags. After approved writes compare report and history with actual intentions; do not require zero. A scheduler count does not prove endpoint/job configuration.'
) FROM checks c;
