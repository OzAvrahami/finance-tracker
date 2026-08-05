-- =============================================================================
-- READ-ONLY pre-flight audit for migrations/003_transaction_pagination_and_aggregates.sql
--
-- RUN THIS BEFORE APPLYING THE MIGRATION. Paste it into the Supabase SQL Editor.
--
-- Every statement here is a SELECT or an EXPLAIN. Nothing creates, alters,
-- drops, inserts, updates or deletes. EXPLAIN is used WITHOUT ANALYZE for any
-- statement that could otherwise execute a write — none of these are writes, so
-- ANALYZE is safe, but it is left off where the plan alone answers the question.
--
-- Why this file exists: the repository has no database connection available to
-- the tooling (no psql, no DATABASE_URL, and @supabase/supabase-js cannot run
-- raw SQL), so the index and privilege questions cannot be answered from the
-- code alone. Answer them here, then decide whether to apply the migration.
-- =============================================================================


-- =============================================================================
-- PART 1 — Does the database already have any of this?
-- =============================================================================

-- 1.1 Every index on transactions, so a duplicate is impossible to miss.
--     Expect: transactions_pkey, idx_transactions_loan_id,
--             idx_transactions_payment_source_id.
--     If idx_transactions_date_id_desc already exists, the migration's
--     CREATE INDEX IF NOT EXISTS is a no-op — confirm the definition matches.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'transactions'
ORDER BY indexname;

-- 1.2 Any index on any table that already covers (transaction_date, id),
--     under a different name.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexdef ILIKE '%transaction_date%'
ORDER BY tablename, indexname;

-- 1.3 Do the functions already exist (a re-run, or a name collision)?
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS signature,
       p.provolatile,          -- i = immutable, s = stable, v = volatile
       p.prosecdef             AS security_definer,
       p.proconfig             AS settings   -- expect search_path where set
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'transactions_search_pattern',
    'transactions_filtered',
    'transactions_page',
    'dashboard_summary',
    'dashboard_monthly_series',
    'get_unique_tags'
  )
ORDER BY p.proname;

-- 1.4 Table size, which is what the index cost/benefit argument rests on.
--     The migration assumes ~3k rows. If this is now much larger, revisit the
--     decision to skip the sort-specific indexes.
SELECT count(*) AS transaction_rows,
       min(transaction_date) AS oldest,
       max(transaction_date) AS newest,
       count(*) FILTER (WHERE description IS NULL) AS null_descriptions,
       pg_size_pretty(pg_total_relation_size('public.transactions')) AS total_size
FROM public.transactions;


-- =============================================================================
-- PART 2 — Index benefit, measured rather than assumed
--
-- These run the *equivalent* queries against the current schema, so they can be
-- executed before the migration exists. Compare "Seq Scan" vs "Index Scan" and
-- the actual times. If every one of these is already sub-millisecond on a
-- sequential scan, the case for adding indexes is weak.
-- =============================================================================

-- 2.1 The default list branch, month-bounded (the app's default view).
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t.transaction_date
FROM public.transactions t
WHERE t.transaction_date >= date_trunc('month', CURRENT_DATE)::date
  AND t.transaction_date <= (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
ORDER BY t.transaction_date DESC, t.id DESC
LIMIT 101;

-- 2.2 The default branch over the whole history (the "all dates" preset).
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t.transaction_date
FROM public.transactions t
ORDER BY t.transaction_date DESC, t.id DESC
LIMIT 101;

-- 2.3 The default branch mid-traversal, i.e. with the keyset predicate applied.
--     Substitute a real (date, id) from the middle of the table.
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t.transaction_date
FROM public.transactions t
WHERE t.transaction_date < DATE '2026-04-09'
   OR (t.transaction_date = DATE '2026-04-09' AND t.id < 999999)
ORDER BY t.transaction_date DESC, t.id DESC
LIMIT 101;

-- 2.4 The ASCENDING date branch. Expect a Sort node even after the migration:
--     (transaction_date DESC, id DESC) cannot be scanned backwards to produce
--     (transaction_date ASC, id DESC). Confirm the sort cost is acceptable.
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t.transaction_date
FROM public.transactions t
ORDER BY t.transaction_date ASC, t.id DESC
LIMIT 101;

-- 2.5 The amount branches. No index is proposed for these; this is the number
--     that justifies that decision.
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t.total_amount
FROM public.transactions t
ORDER BY t.total_amount DESC, t.transaction_date DESC, t.id DESC
LIMIT 101;

EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t.total_amount
FROM public.transactions t
ORDER BY t.total_amount ASC, t.transaction_date DESC, t.id DESC
LIMIT 101;

-- 2.6 The description branches, with the collation the migration uses.
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t.description
FROM public.transactions t
ORDER BY (t.description IS NULL) ASC,
         t.description COLLATE "C" ASC,
         t.transaction_date DESC, t.id DESC
LIMIT 101;

EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t.description
FROM public.transactions t
ORDER BY (t.description IS NULL) ASC,
         t.description COLLATE "C" DESC,
         t.transaction_date DESC, t.id DESC
LIMIT 101;

-- 2.7 Does a category filter actually justify a standalone index?
--     Look at the row estimate vs the actual rows, and whether the planner
--     would even consider an index at this selectivity.
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id
FROM public.transactions t
WHERE t.category_id = (SELECT id FROM public.categories ORDER BY id LIMIT 1)
ORDER BY t.transaction_date DESC, t.id DESC
LIMIT 101;

-- 2.8 Selectivity of each category, so 2.7 can be read in context.
SELECT c.name,
       count(t.id) AS rows,
       round(100.0 * count(t.id) / NULLIF((SELECT count(*) FROM public.transactions), 0), 1) AS pct
FROM public.categories c
LEFT JOIN public.transactions t ON t.category_id = c.id
GROUP BY c.name
ORDER BY rows DESC;

-- 2.9 The full-set search predicate, to confirm the "no pg_trgm needed" claim.
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id
FROM public.transactions t
LEFT JOIN public.categories c ON c.id = t.category_id
LEFT JOIN public.payment_sources ps ON ps.id = t.payment_source_id
WHERE t.description ILIKE '%קפה%' ESCAPE '\'
   OR t.total_amount::text ILIKE '%קפה%' ESCAPE '\'
   OR c.name ILIKE '%קפה%' ESCAPE '\'
   OR ps.name ILIKE '%קפה%' ESCAPE '\';


-- =============================================================================
-- PART 3 — Security: who can execute the RPCs?
--
-- Run PART 3.1 before applying (baseline) and again after (verification).
-- =============================================================================

-- 3.1 EXECUTE privilege on every relevant function, per role.
--     BEFORE the migration: functions do not exist yet -> no rows.
--     AFTER the migration: anon and authenticated must be FALSE for all of the
--     new functions, service_role TRUE. If anon/authenticated are TRUE, the
--     REVOKEs did not take effect and the endpoints are reachable through
--     PostgREST, bypassing the Express requireAuth middleware.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS signature,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role_execute,
       p.proacl                                                   AS raw_acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'transactions_search_pattern',
    'transactions_filtered',
    'transactions_page',
    'dashboard_summary',
    'dashboard_monthly_series',
    'get_unique_tags'
  )
ORDER BY p.proname;

-- 3.2 The default-privileges baseline: PostgreSQL grants EXECUTE to PUBLIC on
--     every new function. Anything with a NULL proacl is relying on that
--     default, i.e. it is executable by everyone.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proacl IS NULL
ORDER BY p.proname;

-- 3.3 Inspect the pre-existing get_unique_tags function separately.
--     `security_mode` is authoritative. `function_definition` is included so
--     every table reference can be reviewed even when PostgreSQL did not record
--     dependencies for a string-literal SQL function body.
--
--     Confirmed result (2026-08-05): SECURITY INVOKER, owner postgres; the
--     PL/pgSQL body reads public.transactions.tags. Public execution currently
--     returns zero rows to anon because the caller's RLS permissions apply.
--
--     Separate cleanup follow-up (NOT migration 003): the only production RPC
--     caller is the service-role backend, so revoke EXECUTE from PUBLIC, anon
--     and authenticated; grant it only to service_role; schema-qualify
--     public.transactions; and consider marking the read-only function STABLE.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS signature,
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END
         AS security_mode,
       pg_get_userbyid(p.proowner) AS owner,
       l.lanname AS language,
       p.provolatile,
       p.proconfig AS settings,
       pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.proname = 'get_unique_tags';

-- Dependency cross-check. This can be empty for SQL functions created with a
-- quoted body, so an empty result does not override table references visible in
-- pg_get_functiondef above.
SELECT routine_schema, routine_name, table_schema, table_name
FROM information_schema.routine_table_usage
WHERE routine_schema = 'public'
  AND routine_name = 'get_unique_tags'
ORDER BY table_schema, table_name;


-- =============================================================================
-- PART 4 — SEPARATE CRITICAL FINDING: direct table access
--
-- Restricting the RPCs does not secure the tables. The browser holds a public
-- Supabase key and can reach PostgREST directly. Table privileges alone do not
-- establish exposure when RLS is enabled: a table with no applicable policy is
-- default-deny even if anon/authenticated hold SELECT/INSERT/UPDATE/DELETE.
-- Effective access therefore has to be evaluated from grants and policies
-- together, then confirmed through the anon data API.
--
-- This is PRE-EXISTING and is NOT changed by migration 003. It is reported here
-- so that "the RPCs are locked down" is not mistaken for "the database is
-- secured". Fixing the policy-open tables belongs in a separate security
-- migration; do not add that work to migration 003.
-- =============================================================================

-- 4.1 Table-level privileges for the untrusted roles.
SELECT c.relname AS table_name,
       r.rolname AS role,
       has_table_privilege(r.rolname, c.oid, 'SELECT') AS can_select,
       has_table_privilege(r.rolname, c.oid, 'INSERT') AS can_insert,
       has_table_privilege(r.rolname, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(r.rolname, c.oid, 'DELETE') AS can_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) AS rolname) r
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'transactions', 'transaction_items', 'categories', 'payment_sources',
    'budgets', 'loans', 'lego_sets', 'tasks'
  )
ORDER BY c.relname, r.rolname;

-- 4.2 Is RLS enabled, and is it forced?
--     Current PART 4 result: RLS is enabled on every inspected table.
--     For enabled tables with no applicable policy, PostgreSQL uses default
--     deny for anon/authenticated even when table-level privileges are granted.
SELECT c.relname AS table_name,
       c.relrowsecurity  AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity, c.relname;

-- 4.3 The policies themselves.
--     Current PART 4 interpretation:
--       * transactions, transaction_items, loans, lego_sets and tasks have no
--         reported policies and are therefore default-deny through RLS.
--       * budgets and payment_sources have PUBLIC ALL policies with qual=true.
--       * categories has PUBLIC SELECT and INSERT policies.
--       * the listed shopping tables have PUBLIC ALL policies with qual=true.
--     These policy-open tables are directly exposed for the commands covered
--     by both their grants and policies.
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 4.4 Verify effective SELECT access through the actual anon PostgREST path.
--     This repository script uses the client publishable/anon key, disables
--     session persistence, issues only SELECT HEAD/count requests plus the
--     read-only get_unique_tags RPC, and prints no row data or credentials:
--
--       node server/scripts/verify-anon-read-access.js
--
--     Expected before the separate security migration:
--       transactions    -> HTTP success with 0 visible rows, or denied
--       budgets         -> readable
--       payment_sources -> readable
--       categories      -> readable
--       shopping_lists  -> readable (representative shopping table)


-- =============================================================================
-- PART 5 — Key/role confirmation (run OUTSIDE this file)
--
-- The migration's REVOKEs assume the Express server connects as service_role.
-- If SUPABASE_KEY is actually an anon key, applying the migration BREAKS EVERY
-- ENDPOINT. Confirm before applying.
--
-- Run, from the repository root:
--     node server/scripts/check-supabase-key-roles.js
--
-- It reads server/.env and client/.env, decodes ONLY the JWT payload segment,
-- and prints ONLY the `role` claim. It never prints, logs or transmits a key.
--
-- Required result:
--     server SUPABASE_KEY          -> role: service_role
--     client VITE_SUPABASE_ANON_KEY-> role: anon
--
-- 5.1 Cross-check from inside the database: which role is this session?
--     Run this in the SQL Editor to see what the editor itself connects as
--     (it is not the same connection the server uses, but it confirms the
--     roles exist and are spelled as expected).
SELECT current_user, session_user;

SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY rolname;
