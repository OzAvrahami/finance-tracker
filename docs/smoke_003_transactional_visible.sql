BEGIN;

-- IMPORTANT RECOVERY INSTRUCTION
-- If the SQL Editor reports a real syntax/execution error BEFORE the expected
-- final SMOKE_003_PASS/SMOKE_003_FAIL error, immediately open a NEW SQL Editor
-- query and run:
--
--   ROLLBACK;
--
-- The harness writes only to transaction-local temporary tables. It never
-- inserts, updates, or deletes rows in public.transactions or any other
-- application table.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE TEMP TABLE smoke003_transaction_baseline ON COMMIT DROP AS
SELECT count(*)::bigint AS row_count,
       pg_catalog.md5(
         COALESCE(
           pg_catalog.string_agg(
             pg_catalog.md5(pg_catalog.to_jsonb(t)::text),
             '' ORDER BY t.id
           ),
           ''
         )
       ) AS content_fingerprint
FROM public.transactions t;

CREATE TEMP TABLE smoke003_results (
  check_order integer GENERATED ALWAYS AS IDENTITY,
  check_name  text NOT NULL,
  passed      boolean NOT NULL,
  details     text NOT NULL
) ON COMMIT DROP;

-- Migration: 003_transaction_pagination_and_aggregates
--
-- Purpose:
--   Replace the unbounded /api/transactions list query with keyset (cursor)
--   pagination, move transaction filtering + financial aggregation from
--   JavaScript into PostgreSQL, and serve the transaction table's column
--   sorting from the database across the whole filtered set.
--
-- Background:
--   The previous list query was `select * ... order by transaction_date desc`
--   with no limit and no range. PostgREST silently caps such a response at
--   db-max-rows (1000 on hosted Supabase) and returns NO error, so the client
--   received only the newest 1000 rows. With ~3080 rows the oldest visible
--   transaction was 2026-04-09 while the true oldest is 2023-11-27.
--
--   The transaction table has always had clickable sorting on תאריך, תיאור and
--   סכום. That sorting used to run in the browser over the rows that happened
--   to be loaded, which sorted a truncated subset and therefore answered the
--   wrong question ("the largest amount of what I downloaded", not "the largest
--   amount there is"). It is restored here as real server-side sorting.
--
-- Safety:
--   This migration is ADDITIVE ONLY.
--   * No table is altered, no column is added, dropped or renamed.
--   * No row is inserted, updated or deleted.
--   * Existing financial data is untouched and remains fully backward
--     compatible; every function below is read-only (STABLE or IMMUTABLE).
--   Re-runnable: uses IF NOT EXISTS / CREATE OR REPLACE throughout.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean);
--   DROP FUNCTION IF EXISTS public.transactions_filtered(date,date,bigint,bigint,boolean,text);
--   DROP FUNCTION IF EXISTS public.transactions_search_pattern(text);
--   DROP FUNCTION IF EXISTS public.dashboard_summary(date,date);
--   DROP FUNCTION IF EXISTS public.dashboard_monthly_series(integer);
--   DROP INDEX IF EXISTS public.idx_transactions_date_id_desc;
--
-- Multi-tenancy note:
--   The `transactions` table has NO user_id / owner column, and no such column
--   exists anywhere in this schema. The application is single-tenant and its RLS
--   policies are permissive (`USING (true)`). These functions therefore do not
--   filter by owner. If per-user ownership is introduced later, add the owner
--   predicate to transactions_filtered() and to the WHERE clauses in the
--   dashboard functions, and extend the index below to
--   (user_id, transaction_date DESC, id DESC).
--
-- Security note:
--   These functions are called ONLY by the Express backend, which connects with
--   the Supabase service-role key. The browser never queries Supabase for data
--   (it uses supabase.auth.* for authentication only). Every function below is
--   therefore revoked from PUBLIC/anon/authenticated and granted to
--   service_role alone — see SECTION 5.
--
--   Restricting these functions does NOT by itself secure the underlying
--   tables: the RLS policies on transactions/budgets/etc. are `USING (true)`,
--   so whatever table-level privileges anon/authenticated hold still apply.
--   That is a separate, pre-existing finding — see docs/audit_003_readonly.sql.


-- =============================================
-- SECTION 1: INDEXES
-- =============================================

-- Primary access path for the default list view:
--   ORDER BY transaction_date DESC, id DESC  +  the keyset predicate,
-- and the `from`/`to` range filter (the default view is always month-bounded).
-- The column order and the DESC/DESC direction both matter: this lets Postgres
-- satisfy the ordering and the cursor seek with a single ordered index scan.
CREATE INDEX IF NOT EXISTS idx_transactions_date_id_desc
  ON public.transactions (transaction_date DESC, id DESC);

-- Deliberately NOT added, and why:
--
-- 1. idx_transactions_category_id (category_id)
--    At ~3k rows a category filter still selects hundreds of rows and the
--    planner will very likely prefer a sequential scan anyway. Create it only
--    if EXPLAIN on real data shows a benefit.
--
-- 2. Sort-specific indexes for the amount and description branches.
--    Those branches order by e.g. (total_amount ASC, transaction_date DESC,
--    id DESC). A mixed-direction ordering cannot be produced by a backward scan
--    of its all-DESC counterpart, so full index coverage would need four more
--    indexes:
--      (total_amount ASC,  transaction_date DESC, id DESC)
--      (total_amount DESC, transaction_date DESC, id DESC)
--      (description COLLATE "C" ASC,  transaction_date DESC, id DESC)
--      (description COLLATE "C" DESC, transaction_date DESC, id DESC)
--    On a ~3k-row table that is unjustifiable write and storage cost for sorts
--    that cost single-digit milliseconds. Revisit only if EXPLAIN says so.
--
-- 3. A pg_trgm GIN index for the description/notes search: needs an extension,
--    and the sequential scan is negligible at this size.
--
-- Note on the ascending date branch: the index above serves
-- `ORDER BY transaction_date DESC, id DESC` exactly, but it does NOT fully
-- serve `ORDER BY transaction_date ASC, id DESC` — a backward scan of this
-- index yields (transaction_date ASC, id ASC), so Postgres will add an explicit
-- sort node for that branch. The `id DESC` tiebreaker is kept deliberately: the
-- final tiebreaker is the same in every branch, which is what makes the cursor
-- contract uniform. At this table size the extra sort is acceptable.


-- =============================================
-- SECTION 2: SEARCH PATTERN (single owner of the escaping rule)
-- =============================================

-- Turns raw user search text into an ILIKE pattern, escaping the LIKE wildcards
-- so a user searching for "50%" or "a_b" gets a literal match instead of a
-- pattern. Backslash is escaped first, or it would double-escape the escapes
-- added afterwards.
--
-- This exists as its own IMMUTABLE function rather than as a CTE inside
-- transactions_filtered() for two reasons:
--   * one owner for the escaping rule, referenced from every predicate;
--   * a CTE in the body would make transactions_filtered() ineligible for
--     planner inlining, which is what lets the index be used at all.
-- Being IMMUTABLE with a constant argument, it is folded once at plan time —
-- it is not evaluated per row.
CREATE OR REPLACE FUNCTION public.transactions_search_pattern(p_search text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
AS $$
  SELECT CASE
           WHEN p_search IS NULL OR pg_catalog.btrim(p_search) = '' THEN NULL
           ELSE '%' || pg_catalog.replace(
                         pg_catalog.replace(
                           pg_catalog.replace(pg_catalog.btrim(p_search),
                             '\', '\\'),
                           '%', '\%'),
                         '_', '\_') || '%'
         END;
$$;


-- =============================================
-- SECTION 3: FILTERED TRANSACTION SET
-- =============================================

-- THE single owner of transaction filter semantics.
--
-- Both the page slice and the totals are derived from this one function, which
-- is what guarantees the summary bar can never disagree with the rows the user
-- is looking at. It is not a view because it is parameterised.
--
-- row_json is byte-compatible with the previous PostgREST response shape: the
-- full transactions row plus embedded `categories` and `payment_sources`
-- objects, so existing consumers need no field remapping.
--
-- Inlining contract (deliberate, do not "tidy" this away):
--   This function has NO `SET search_path`, because a SET clause makes a SQL
--   function ineligible for planner inlining — and without inlining the sort
--   and LIMIT could not use an index. To stay safe without a pinned search
--   path, every object referenced below is schema-qualified. It remains
--   SECURITY INVOKER, so it grants no privilege of its own.
CREATE OR REPLACE FUNCTION public.transactions_filtered(
  p_from                date    DEFAULT NULL,
  p_to                  date    DEFAULT NULL,
  p_category_id         bigint  DEFAULT NULL,
  p_payment_source_id   bigint  DEFAULT NULL,
  p_uncategorized_only  boolean DEFAULT false,
  p_search              text    DEFAULT NULL
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
SECURITY INVOKER
AS $$
  SELECT
    t.id,
    t.transaction_date,
    t.description::text,
    t.movement_type::text,
    t.total_amount,
    pg_catalog.to_jsonb(t) || pg_catalog.jsonb_build_object(
      'categories',
      CASE WHEN c.id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object('name', c.name, 'icon', c.icon) END,
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
  WHERE (p_from IS NULL OR t.transaction_date >= p_from)
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
      OR c.name               ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR ps.name              ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
    );
$$;


-- =============================================
-- SECTION 4: PAGINATED + SORTED TRANSACTION LIST
-- =============================================

-- Returns one jsonb object:
--   {
--     "data":     [ <transaction row>, ... ],   -- at most p_limit rows
--     "has_more": true | false,
--     "next_key": { ...keyset position... } | null,
--     "totals":   { "count": n, "income": n, "expense": n } | null
--   }
--
-- SORTING
--   Six fully static branches, one per (sort field, direction). There is no
--   dynamic SQL anywhere: p_sort_by and p_sort_direction only *select* a
--   branch, they are never interpolated into a statement. An unrecognised
--   combination raises, rather than silently falling through to an arbitrary
--   order — defence in depth behind the allowlist in
--   server/utils/transactionQuery.js.
--
--   Every branch ends with `id DESC`, a unique column, so the ordering is
--   always total and deterministic and no row can straddle a page boundary.
--
--   Description ordering uses COLLATE "C". That makes it deterministic and
--   independent of the database's locale, and it preserves the expected order
--   for this application's Hebrew and English descriptions. It is byte /
--   code-point ordering, whereas the old browser-side comparator used UTF-16
--   code units; those agree across the BMP but may differ for supplementary
--   characters such as some emoji. No claim of exact equivalence is made.
--
--   COLLATION INVARIANT (do not weaken): the description branches must apply
--   COLLATE "C" to BOTH SIDES of every description comparison — the inequality
--   AND the equality that guards the transaction_date/id tiebreakers — and in
--   the ORDER BY of both the inner LIMIT query and the outer jsonb_agg calls.
--   A cursor predicate that compared under the database-default collation while
--   the rows were ordered under "C" would place the boundary somewhere the sort
--   never put it, skipping and repeating rows across the page edge. The
--   NULL-block transition uses IS NULL, which is collation-independent.
--
--   NULL descriptions: `(description IS NULL) ASC` is promoted to the leading
--   sort key, so rows with no description sort to the BOTTOM in BOTH
--   directions. This is a deliberate product decision. Postgres' own defaults
--   (NULLS LAST for ASC, NULLS FIRST for DESC) would move them to the top on a
--   descending sort and would make the cursor predicate direction-dependent in
--   a much more error-prone way.
--
-- PAGINATION
--   Keyset (cursor), never OFFSET. The probe row lives entirely inside this
--   function: it selects p_limit + 1 rows, returns at most p_limit, and reports
--   has_more separately. The probe row is structurally incapable of reaching
--   the response.
--
--   next_key is built here rather than in JavaScript on purpose. total_amount
--   is NUMERIC; if the caller read it back off a JSON row it would already have
--   been through a double. It is emitted as ::text so the cursor boundary is
--   exact, and transaction_date via to_char so it is DateStyle-independent.
--
-- TOTALS
--   Computed only when asked for, inside a real IF. The previous version used
--   `CASE WHEN p_include_totals THEN (SELECT ...) END`, which Postgres may hoist
--   into an InitPlan and evaluate regardless of the condition — meaning every
--   "load more" would have re-aggregated the entire filtered set.
CREATE OR REPLACE FUNCTION public.transactions_page(
  p_from                        date    DEFAULT NULL,
  p_to                          date    DEFAULT NULL,
  p_category_id                 bigint  DEFAULT NULL,
  p_payment_source_id           bigint  DEFAULT NULL,
  p_uncategorized_only          boolean DEFAULT false,
  p_search                      text    DEFAULT NULL,
  p_limit                       integer DEFAULT 100,
  p_sort_by                     text    DEFAULT 'transaction_date',
  p_sort_direction              text    DEFAULT 'desc',
  p_cursor_id                   bigint  DEFAULT NULL,
  p_cursor_date                 date    DEFAULT NULL,
  p_cursor_amount               numeric DEFAULT NULL,
  p_cursor_description          text    DEFAULT NULL,
  p_cursor_description_is_null  boolean DEFAULT NULL,
  p_include_totals              boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_probe     integer;
  v_rows      jsonb;
  v_keys      jsonb;
  v_has_more  boolean := false;
  v_next_key  jsonb   := NULL;
  v_totals    jsonb   := NULL;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'transactions_page: p_limit must be a positive integer, got %', p_limit;
  END IF;

  -- One row beyond the page, so has_more is derived from real data rather than
  -- guessed from a full page.
  v_probe := p_limit + 1;

  -- ---------------------------------------------------------------------
  -- transaction_date DESC, id DESC   (the default view)
  -- ---------------------------------------------------------------------
  IF p_sort_by = 'transaction_date' AND p_sort_direction = 'desc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.row_json,
             jsonb_build_object(
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search) f
      WHERE p_cursor_id IS NULL
         OR f.transaction_date < p_cursor_date
         OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)
      ORDER BY f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- transaction_date ASC, id DESC
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'transaction_date' AND p_sort_direction = 'asc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY p.transaction_date ASC, p.id DESC),
           jsonb_agg(p.k        ORDER BY p.transaction_date ASC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.row_json,
             jsonb_build_object(
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search) f
      WHERE p_cursor_id IS NULL
         OR f.transaction_date > p_cursor_date
         OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)
      ORDER BY f.transaction_date ASC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- total_amount DESC, transaction_date DESC, id DESC
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'total_amount' AND p_sort_direction = 'desc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY p.total_amount DESC, p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY p.total_amount DESC, p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.total_amount,
             f.row_json,
             jsonb_build_object(
               -- ::text, not a JSON number: NUMERIC must not round-trip a double.
               'av', f.total_amount::text,
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search) f
      WHERE p_cursor_id IS NULL
         OR f.total_amount < p_cursor_amount
         OR (f.total_amount = p_cursor_amount
             AND (f.transaction_date < p_cursor_date
                  OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)))
      ORDER BY f.total_amount DESC, f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- total_amount ASC, transaction_date DESC, id DESC
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'total_amount' AND p_sort_direction = 'asc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY p.total_amount ASC, p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY p.total_amount ASC, p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.total_amount,
             f.row_json,
             jsonb_build_object(
               'av', f.total_amount::text,
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search) f
      WHERE p_cursor_id IS NULL
         OR f.total_amount > p_cursor_amount
         OR (f.total_amount = p_cursor_amount
             AND (f.transaction_date < p_cursor_date
                  OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)))
      ORDER BY f.total_amount ASC, f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- description ASC, transaction_date DESC, id DESC   (NULL descriptions last)
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'description' AND p_sort_direction = 'asc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY (p.description IS NULL) ASC,
                                         p.description COLLATE "C" ASC,
                                         p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY (p.description IS NULL) ASC,
                                         p.description COLLATE "C" ASC,
                                         p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.description,
             f.row_json,
             jsonb_build_object(
               'dn', (f.description IS NULL),
               'dv', f.description,
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search) f
      WHERE p_cursor_id IS NULL
         OR (
           CASE
             -- Still inside the non-NULL block: everything that sorts after the
             -- cursor value, plus the entire NULL block that follows it.
             WHEN NOT p_cursor_description_is_null THEN
                  f.description IS NULL
               OR f.description COLLATE "C" > p_cursor_description COLLATE "C"
               OR (f.description COLLATE "C" = p_cursor_description COLLATE "C"
                   AND (f.transaction_date < p_cursor_date
                        OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)))
             -- Already inside the trailing NULL block: only later NULL rows.
             ELSE
               f.description IS NULL
               AND (f.transaction_date < p_cursor_date
                    OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id))
           END
         )
      ORDER BY (f.description IS NULL) ASC,
               f.description COLLATE "C" ASC,
               f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- description DESC, transaction_date DESC, id DESC  (NULL descriptions last)
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'description' AND p_sort_direction = 'desc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY (p.description IS NULL) ASC,
                                         p.description COLLATE "C" DESC,
                                         p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY (p.description IS NULL) ASC,
                                         p.description COLLATE "C" DESC,
                                         p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.description,
             f.row_json,
             jsonb_build_object(
               'dn', (f.description IS NULL),
               'dv', f.description,
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search) f
      WHERE p_cursor_id IS NULL
         OR (
           CASE
             WHEN NOT p_cursor_description_is_null THEN
                  f.description IS NULL
               OR f.description COLLATE "C" < p_cursor_description COLLATE "C"
               OR (f.description COLLATE "C" = p_cursor_description COLLATE "C"
                   AND (f.transaction_date < p_cursor_date
                        OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)))
             ELSE
               f.description IS NULL
               AND (f.transaction_date < p_cursor_date
                    OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id))
           END
         )
      ORDER BY (f.description IS NULL) ASC,
               f.description COLLATE "C" DESC,
               f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  ELSE
    RAISE EXCEPTION 'transactions_page: unsupported sort % %', p_sort_by, p_sort_direction;
  END IF;

  -- jsonb_agg over an empty set returns NULL, not '[]'.
  v_rows := COALESCE(v_rows, '[]'::jsonb);
  v_keys := COALESCE(v_keys, '[]'::jsonb);

  v_has_more := jsonb_array_length(v_rows) > p_limit;

  IF v_has_more THEN
    -- Drop the probe row. The explicit ORDER BY on the ordinality keeps the
    -- page order intact through the re-aggregation.
    SELECT jsonb_agg(e ORDER BY o)
      INTO v_rows
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS x(e, o)
    WHERE o <= p_limit;

    -- Keyset position of the LAST ROW ACTUALLY RETURNED (0-based index),
    -- never the probe row.
    v_next_key := v_keys -> (p_limit - 1);
  END IF;

  -- Totals cover the whole filtered set, not the returned page: summing a
  -- single page would understate the user's real totals. Requested on the
  -- first page only, which is why this must be a real conditional.
  IF COALESCE(p_include_totals, false) THEN
    SELECT jsonb_build_object(
             'count',   COUNT(*),
             -- The income/expense split follows the existing movement_type
             -- contract: total_amount carries the magnitude and movement_type
             -- carries the direction. Unchanged from calculateSummaryStats.
             -- (Note: there is no CHECK constraint forcing total_amount >= 0;
             -- this mirrors whatever is stored, it does not assume a sign.)
             'income',  COALESCE(SUM(f.total_amount) FILTER (WHERE f.movement_type = 'income'),  0),
             'expense', COALESCE(SUM(f.total_amount) FILTER (WHERE f.movement_type = 'expense'), 0)
           )
      INTO v_totals
    FROM public.transactions_filtered(
           p_from, p_to, p_category_id, p_payment_source_id,
           p_uncategorized_only, p_search) f;
  END IF;

  RETURN jsonb_build_object(
    'data',     v_rows,
    'has_more', v_has_more,
    'next_key', v_next_key,
    'totals',   v_totals
  );
END;
$$;


-- =============================================
-- SECTION 5: DASHBOARD AGGREGATES
-- =============================================

-- Period totals for the Dashboard KPI cards.
-- Replaces downloading every transaction into the browser and summing it in
-- calculateSummaryStats(). Same income/expense/balance rule, computed in SQL.
CREATE OR REPLACE FUNCTION public.dashboard_summary(
  p_from date,
  p_to   date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'income',   COALESCE(SUM(total_amount) FILTER (WHERE movement_type = 'income'),  0),
    'expenses', COALESCE(SUM(total_amount) FILTER (WHERE movement_type = 'expense'), 0),
    'balance',  COALESCE(SUM(total_amount) FILTER (WHERE movement_type = 'income'),  0)
              - COALESCE(SUM(total_amount) FILTER (WHERE movement_type = 'expense'), 0),
    'count',    COUNT(*)
  )
  FROM public.transactions
  WHERE (p_from IS NULL OR transaction_date >= p_from)
    AND (p_to   IS NULL OR transaction_date <= p_to);
$$;


-- Trailing-N-month income/expense series for the Dashboard trend chart.
-- Replaces prepareMonthlyChartData(), which bucketed the full downloaded array
-- in JavaScript. Months with no transactions are returned with zeros so the
-- chart keeps a continuous axis (generate_series + LEFT JOIN), matching the
-- previous behaviour where an empty month produced {income: 0, expenses: 0}.
CREATE OR REPLACE FUNCTION public.dashboard_monthly_series(
  p_months integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT date_trunc('month', CURRENT_DATE)::date AS current_month_start,
           GREATEST(COALESCE(p_months, 6), 1)      AS months
  ),
  months AS (
    SELECT generate_series(
             (SELECT current_month_start - ((months - 1) || ' months')::interval FROM bounds),
             (SELECT current_month_start FROM bounds),
             '1 month'::interval
           )::date AS month_start
  ),
  per_month AS (
    SELECT
      m.month_start,
      COALESCE(SUM(t.total_amount) FILTER (WHERE t.movement_type = 'income'),  0) AS income,
      COALESCE(SUM(t.total_amount) FILTER (WHERE t.movement_type = 'expense'), 0) AS expenses
    FROM months m
    LEFT JOIN public.transactions t
      ON t.transaction_date >= m.month_start
     AND t.transaction_date <  (m.month_start + interval '1 month')
    GROUP BY m.month_start
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'month',    to_char(per_month.month_start, 'YYYY-MM'),
             'income',   per_month.income,
             'expenses', per_month.expenses
           )
           ORDER BY per_month.month_start
         ), '[]'::jsonb)
  FROM per_month;
$$;


-- =============================================
-- SECTION 6: GRANTS
-- =============================================
--
-- PostgreSQL grants EXECUTE to PUBLIC by default. Without the REVOKEs below,
-- every function above would be callable through PostgREST by `anon` and
-- `authenticated`, bypassing the Express requireAuth middleware entirely — and
-- the RLS policies on these tables are `USING (true)`, so RLS is no backstop.
--
-- These statements only NARROW access from the PostgreSQL default. They grant
-- nothing that was not already implicitly granted to everyone.
--
-- If SUPABASE_KEY on the server is ever changed to an anon key, these REVOKEs
-- will break every endpoint. Confirm the key's JWT `role` claim is
-- `service_role` before applying this migration.

REVOKE ALL ON FUNCTION public.transactions_search_pattern(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transactions_search_pattern(text)
  TO service_role;

REVOKE ALL ON FUNCTION public.transactions_filtered(date,date,bigint,bigint,boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transactions_filtered(date,date,bigint,bigint,boolean,text)
  TO service_role;

REVOKE ALL ON FUNCTION public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.dashboard_summary(date,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(date,date)
  TO service_role;

REVOKE ALL ON FUNCTION public.dashboard_monthly_series(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_monthly_series(integer)
  TO service_role;


-- =============================================================================
-- TRANSACTIONAL SMOKE CHECKS
--
-- Every check records a PASS/FAIL row. No check deliberately raises an
-- exception. Calls that could fail unexpectedly are caught in PL/pgSQL blocks
-- so later checks and the final summary exception can still run.
-- =============================================================================

DO $smoke_catalog$
DECLARE
  v_signature text;
  v_expected_volatility "char";
  v_oid oid;
  v_security_definer boolean;
  v_actual_volatility "char";
  v_public_execute boolean;
  v_anon_execute boolean;
  v_authenticated_execute boolean;
  v_service_execute boolean;
BEGIN
  INSERT INTO smoke003_results (check_name, passed, details)
  SELECT
    'index exists',
    to_regclass('public.idx_transactions_date_id_desc') IS NOT NULL,
    COALESCE(
      pg_catalog.pg_get_indexdef(to_regclass('public.idx_transactions_date_id_desc')),
      'index not found'
    );

  INSERT INTO smoke003_results (check_name, passed, details)
  SELECT
    'index definition',
    pg_catalog.pg_get_indexdef(to_regclass('public.idx_transactions_date_id_desc'))
      ~ 'USING btree \(transaction_date DESC, id DESC\)$',
    COALESCE(
      pg_catalog.pg_get_indexdef(to_regclass('public.idx_transactions_date_id_desc')),
      'index not found'
    );

  FOR v_signature, v_expected_volatility IN
    SELECT *
    FROM (VALUES
      ('public.transactions_search_pattern(text)', 'i'::"char"),
      ('public.transactions_filtered(date,date,bigint,bigint,boolean,text)', 's'::"char"),
      ('public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean)', 's'::"char"),
      ('public.dashboard_summary(date,date)', 's'::"char"),
      ('public.dashboard_monthly_series(integer)', 's'::"char")
    ) AS expected(signature, volatility)
  LOOP
    v_oid := to_regprocedure(v_signature);

    INSERT INTO smoke003_results (check_name, passed, details)
    VALUES (
      'function exists: ' || v_signature,
      v_oid IS NOT NULL,
      CASE WHEN v_oid IS NULL THEN 'missing' ELSE 'oid=' || v_oid::text END
    );

    IF v_oid IS NOT NULL THEN
      SELECT p.prosecdef,
             p.provolatile,
             EXISTS (
               SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   p.proacl,
                   pg_catalog.acldefault('f', p.proowner)
                 )
               ) acl
               WHERE acl.grantee = 0
                 AND acl.privilege_type = 'EXECUTE'
             ),
             pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
             pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
             pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
        INTO v_security_definer,
             v_actual_volatility,
             v_public_execute,
             v_anon_execute,
             v_authenticated_execute,
             v_service_execute
      FROM pg_catalog.pg_proc p
      WHERE p.oid = v_oid;

      INSERT INTO smoke003_results (check_name, passed, details)
      VALUES (
        'function attributes: ' || v_signature,
        NOT v_security_definer
          AND v_actual_volatility = v_expected_volatility,
        'security=' || CASE WHEN v_security_definer
                             THEN 'DEFINER' ELSE 'INVOKER' END
          || ', volatility=' || v_actual_volatility::text
          || ', expected=' || v_expected_volatility::text
      );

      INSERT INTO smoke003_results (check_name, passed, details)
      VALUES (
        'function ACL: ' || v_signature,
        NOT v_public_execute
          AND NOT v_anon_execute
          AND NOT v_authenticated_execute
          AND v_service_execute,
        'PUBLIC=' || v_public_execute::text
          || ', anon=' || v_anon_execute::text
          || ', authenticated=' || v_authenticated_execute::text
          || ', service_role=' || v_service_execute::text
      );
    END IF;
  END LOOP;
END;
$smoke_catalog$;


-- Execute every supported sorting branch and validate the response envelope.
DO $smoke_sort_branches$
DECLARE
  v_sort_by text;
  v_sort_direction text;
  v_page jsonb;
  v_passed boolean;
  v_details text;
BEGIN
  FOR v_sort_by, v_sort_direction IN
    SELECT *
    FROM (VALUES
      ('transaction_date', 'desc'),
      ('transaction_date', 'asc'),
      ('total_amount', 'desc'),
      ('total_amount', 'asc'),
      ('description', 'desc'),
      ('description', 'asc')
    ) AS sorts(sort_by, sort_direction)
  LOOP
    BEGIN
      v_page := public.transactions_page(
        p_limit => 2,
        p_sort_by => v_sort_by,
        p_sort_direction => v_sort_direction,
        p_include_totals => true
      );

      v_passed := jsonb_typeof(v_page) = 'object'
        AND jsonb_typeof(v_page->'data') = 'array'
        AND jsonb_array_length(v_page->'data') <= 2
        AND v_page ?& ARRAY['data', 'has_more', 'next_key', 'totals']
        AND jsonb_typeof(v_page->'totals') = 'object';
      v_details := 'rows=' || COALESCE(
        jsonb_array_length(v_page->'data')::text,
        'null'
      );
    EXCEPTION WHEN OTHERS THEN
      v_passed := false;
      v_details := 'unexpected error [' || SQLSTATE || ']: ' || SQLERRM;
    END;

    INSERT INTO smoke003_results (check_name, passed, details)
    VALUES (
      'sort branch: ' || v_sort_by || ' ' || v_sort_direction,
      v_passed,
      v_details
    );
  END LOOP;
END;
$smoke_sort_branches$;


-- Confirm the p_limit + 1 probe drives has_more but never reaches data.
DO $smoke_probe_and_totals$
DECLARE
  v_page jsonb;
  v_without_totals jsonb;
  v_total_rows bigint;
  v_expected_ids jsonb;
  v_actual_ids jsonb;
  v_probe_id integer;
  v_passed boolean;
  v_details text;
BEGIN
  SELECT count(*) INTO v_total_rows FROM public.transactions;

  SELECT COALESCE(jsonb_agg(x.id ORDER BY x.transaction_date DESC, x.id DESC), '[]'::jsonb)
    INTO v_expected_ids
  FROM (
    SELECT t.id, t.transaction_date
    FROM public.transactions t
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT 2
  ) x;

  SELECT x.id
    INTO v_probe_id
  FROM (
    SELECT t.id
    FROM public.transactions t
    ORDER BY t.transaction_date DESC, t.id DESC
    OFFSET 2 LIMIT 1
  ) x;

  BEGIN
    v_page := public.transactions_page(
      p_limit => 2,
      p_sort_by => 'transaction_date',
      p_sort_direction => 'desc',
      p_include_totals => true
    );

    SELECT COALESCE(jsonb_agg((e->>'id')::integer ORDER BY ord), '[]'::jsonb)
      INTO v_actual_ids
    FROM jsonb_array_elements(v_page->'data') WITH ORDINALITY AS rows(e, ord);

    v_passed := v_actual_ids = v_expected_ids
      AND jsonb_array_length(v_page->'data') = LEAST(v_total_rows, 2)::integer
      AND (v_page->>'has_more')::boolean = (v_total_rows > 2)
      AND (v_probe_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_page->'data') e
        WHERE (e->>'id')::integer = v_probe_id
      ));
    v_details := 'returned_ids=' || v_actual_ids::text
      || ', probe_id=' || COALESCE(v_probe_id::text, 'none')
      || ', has_more=' || (v_page->>'has_more');
  EXCEPTION WHEN OTHERS THEN
    v_passed := false;
    v_details := 'unexpected error [' || SQLSTATE || ']: ' || SQLERRM;
  END;

  INSERT INTO smoke003_results (check_name, passed, details)
  VALUES ('limit probe row is not returned', v_passed, v_details);

  BEGIN
    v_without_totals := public.transactions_page(
      p_limit => 2,
      p_include_totals => false
    );
    v_passed := v_without_totals->'totals' = 'null'::jsonb;
    v_details := 'totals=' || COALESCE(
      (v_without_totals->'totals')::text,
      'missing'
    );
  EXCEPTION WHEN OTHERS THEN
    v_passed := false;
    v_details := 'unexpected error [' || SQLSTATE || ']: ' || SQLERRM;
  END;

  INSERT INTO smoke003_results (check_name, passed, details)
  VALUES ('totals can be omitted', v_passed, v_details);
END;
$smoke_probe_and_totals$;


-- Force a cursor boundary through rows sharing the same transaction_date.
DO $smoke_repeated_dates$
DECLARE
  v_date date;
  v_expected_first integer;
  v_expected_second integer;
  v_actual_first integer;
  v_actual_second integer;
  v_page_one jsonb;
  v_page_two jsonb;
  v_cursor jsonb;
  v_passed boolean := false;
  v_details text;
BEGIN
  SELECT t.transaction_date
    INTO v_date
  FROM public.transactions t
  GROUP BY t.transaction_date
  HAVING count(*) > 1
  ORDER BY t.transaction_date DESC
  LIMIT 1;

  IF v_date IS NULL THEN
    v_details := 'no repeated transaction_date exists';
  ELSE
    SELECT max(t.id) INTO v_expected_first
    FROM public.transactions t
    WHERE t.transaction_date = v_date;

    SELECT t.id INTO v_expected_second
    FROM public.transactions t
    WHERE t.transaction_date = v_date
      AND t.id < v_expected_first
    ORDER BY t.id DESC
    LIMIT 1;

    BEGIN
      v_page_one := public.transactions_page(
        p_from => v_date,
        p_to => v_date,
        p_limit => 1,
        p_sort_by => 'transaction_date',
        p_sort_direction => 'desc'
      );
      v_cursor := v_page_one->'next_key';
      v_page_two := public.transactions_page(
        p_from => v_date,
        p_to => v_date,
        p_limit => 1,
        p_sort_by => 'transaction_date',
        p_sort_direction => 'desc',
        p_cursor_id => (v_cursor->>'id')::bigint,
        p_cursor_date => (v_cursor->>'td')::date
      );

      v_actual_first := ((v_page_one->'data'->0)->>'id')::integer;
      v_actual_second := ((v_page_two->'data'->0)->>'id')::integer;
      v_passed := v_actual_first = v_expected_first
        AND v_actual_second = v_expected_second
        AND v_actual_first <> v_actual_second;
      v_details := 'date=' || v_date::text
        || ', ids=' || v_actual_first::text || ',' || v_actual_second::text;
    EXCEPTION WHEN OTHERS THEN
      v_passed := false;
      v_details := 'unexpected error [' || SQLSTATE || ']: ' || SQLERRM;
    END;
  END IF;

  INSERT INTO smoke003_results (check_name, passed, details)
  VALUES ('pagination across repeated dates', v_passed, v_details);
END;
$smoke_repeated_dates$;


-- Force a cursor boundary through adjacent rows sharing total_amount.
DO $smoke_repeated_amounts$
DECLARE
  v_boundary integer;
  v_expected_first integer;
  v_expected_second integer;
  v_actual_first integer;
  v_actual_second integer;
  v_page_one jsonb;
  v_page_two jsonb;
  v_cursor jsonb;
  v_passed boolean := false;
  v_details text;
BEGIN
  WITH ranked AS (
    SELECT t.id,
           t.total_amount,
           row_number() OVER (
             ORDER BY t.total_amount DESC, t.transaction_date DESC, t.id DESC
           )::integer AS rn,
           lead(t.total_amount) OVER (
             ORDER BY t.total_amount DESC, t.transaction_date DESC, t.id DESC
           ) AS next_amount
    FROM public.transactions t
  )
  SELECT r.rn, r.id
    INTO v_boundary, v_expected_first
  FROM ranked r
  WHERE r.total_amount = r.next_amount
  ORDER BY r.rn
  LIMIT 1;

  IF v_boundary IS NULL THEN
    v_details := 'no adjacent repeated total_amount exists';
  ELSE
    SELECT t.id INTO v_expected_second
    FROM public.transactions t
    ORDER BY t.total_amount DESC, t.transaction_date DESC, t.id DESC
    OFFSET v_boundary LIMIT 1;

    BEGIN
      v_page_one := public.transactions_page(
        p_limit => v_boundary,
        p_sort_by => 'total_amount',
        p_sort_direction => 'desc'
      );
      v_cursor := v_page_one->'next_key';
      v_page_two := public.transactions_page(
        p_limit => 1,
        p_sort_by => 'total_amount',
        p_sort_direction => 'desc',
        p_cursor_id => (v_cursor->>'id')::bigint,
        p_cursor_date => (v_cursor->>'td')::date,
        p_cursor_amount => (v_cursor->>'av')::numeric
      );

      v_actual_first := ((v_page_one->'data'->(v_boundary - 1))->>'id')::integer;
      v_actual_second := ((v_page_two->'data'->0)->>'id')::integer;
      v_passed := v_actual_first = v_expected_first
        AND v_actual_second = v_expected_second
        AND v_actual_first <> v_actual_second;
      v_details := 'boundary=' || v_boundary::text
        || ', ids=' || v_actual_first::text || ',' || v_actual_second::text;
    EXCEPTION WHEN OTHERS THEN
      v_passed := false;
      v_details := 'unexpected error [' || SQLSTATE || ']: ' || SQLERRM;
    END;
  END IF;

  INSERT INTO smoke003_results (check_name, passed, details)
  VALUES ('pagination across repeated amounts', v_passed, v_details);
END;
$smoke_repeated_amounts$;


-- Force a cursor boundary through adjacent non-NULL equal descriptions.
DO $smoke_repeated_descriptions$
DECLARE
  v_boundary integer;
  v_expected_first integer;
  v_expected_second integer;
  v_actual_first integer;
  v_actual_second integer;
  v_page_one jsonb;
  v_page_two jsonb;
  v_cursor jsonb;
  v_passed boolean := false;
  v_details text;
BEGIN
  WITH ranked AS (
    SELECT t.id,
           t.description,
           row_number() OVER (
             ORDER BY (t.description IS NULL) ASC,
                      t.description COLLATE "C" ASC,
                      t.transaction_date DESC,
                      t.id DESC
           )::integer AS rn,
           lead(t.description) OVER (
             ORDER BY (t.description IS NULL) ASC,
                      t.description COLLATE "C" ASC,
                      t.transaction_date DESC,
                      t.id DESC
           ) AS next_description
    FROM public.transactions t
  )
  SELECT r.rn, r.id
    INTO v_boundary, v_expected_first
  FROM ranked r
  WHERE r.description IS NOT NULL
    AND r.next_description IS NOT NULL
    AND r.description COLLATE "C" = r.next_description COLLATE "C"
  ORDER BY r.rn
  LIMIT 1;

  IF v_boundary IS NULL THEN
    v_details := 'no adjacent repeated non-NULL description exists';
  ELSE
    SELECT t.id INTO v_expected_second
    FROM public.transactions t
    ORDER BY (t.description IS NULL) ASC,
             t.description COLLATE "C" ASC,
             t.transaction_date DESC,
             t.id DESC
    OFFSET v_boundary LIMIT 1;

    BEGIN
      v_page_one := public.transactions_page(
        p_limit => v_boundary,
        p_sort_by => 'description',
        p_sort_direction => 'asc'
      );
      v_cursor := v_page_one->'next_key';
      v_page_two := public.transactions_page(
        p_limit => 1,
        p_sort_by => 'description',
        p_sort_direction => 'asc',
        p_cursor_id => (v_cursor->>'id')::bigint,
        p_cursor_date => (v_cursor->>'td')::date,
        p_cursor_description => v_cursor->>'dv',
        p_cursor_description_is_null => (v_cursor->>'dn')::boolean
      );

      v_actual_first := ((v_page_one->'data'->(v_boundary - 1))->>'id')::integer;
      v_actual_second := ((v_page_two->'data'->0)->>'id')::integer;
      v_passed := v_actual_first = v_expected_first
        AND v_actual_second = v_expected_second
        AND v_actual_first <> v_actual_second;
      v_details := 'boundary=' || v_boundary::text
        || ', ids=' || v_actual_first::text || ',' || v_actual_second::text;
    EXCEPTION WHEN OTHERS THEN
      v_passed := false;
      v_details := 'unexpected error [' || SQLSTATE || ']: ' || SQLERRM;
    END;
  END IF;

  INSERT INTO smoke003_results (check_name, passed, details)
  VALUES ('pagination across repeated descriptions', v_passed, v_details);
END;
$smoke_repeated_descriptions$;


-- Validate totals and dashboard contracts against direct read-only aggregates.
DO $smoke_aggregates$
DECLARE
  v_page jsonb;
  v_summary jsonb;
  v_series jsonb;
  v_count bigint;
  v_income numeric;
  v_expense numeric;
  v_passed boolean;
  v_details text;
BEGIN
  SELECT count(*),
         COALESCE(sum(t.total_amount)
           FILTER (WHERE t.movement_type = 'income'), 0),
         COALESCE(sum(t.total_amount)
           FILTER (WHERE t.movement_type = 'expense'), 0)
    INTO v_count, v_income, v_expense
  FROM public.transactions t;

  BEGIN
    v_page := public.transactions_page(p_limit => 2, p_include_totals => true);
    v_passed := (v_page->'totals'->>'count')::bigint = v_count
      AND (v_page->'totals'->>'income')::numeric = v_income
      AND (v_page->'totals'->>'expense')::numeric = v_expense;
    v_details := 'expected count/income/expense='
      || v_count::text || '/' || v_income::text || '/' || v_expense::text;
  EXCEPTION WHEN OTHERS THEN
    v_passed := false;
    v_details := 'unexpected error [' || SQLSTATE || ']: ' || SQLERRM;
  END;

  INSERT INTO smoke003_results (check_name, passed, details)
  VALUES ('page totals match transaction data', v_passed, v_details);

  BEGIN
    v_summary := public.dashboard_summary(NULL, NULL);
    v_passed := jsonb_typeof(v_summary) = 'object'
      AND v_summary ?& ARRAY['income', 'expenses', 'balance', 'count']
      AND (v_summary->>'count')::bigint = v_count
      AND (v_summary->>'income')::numeric = v_income
      AND (v_summary->>'expenses')::numeric = v_expense
      AND (v_summary->>'balance')::numeric = v_income - v_expense;
    v_details := COALESCE(v_summary::text, 'null');
  EXCEPTION WHEN OTHERS THEN
    v_passed := false;
    v_details := 'unexpected error [' || SQLSTATE || ']: ' || SQLERRM;
  END;

  INSERT INTO smoke003_results (check_name, passed, details)
  VALUES ('dashboard_summary contract', v_passed, v_details);

  BEGIN
    v_series := public.dashboard_monthly_series(6);
    v_passed := jsonb_typeof(v_series) = 'array'
      AND jsonb_array_length(v_series) = 6
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_series) e
        WHERE jsonb_typeof(e) <> 'object'
           OR NOT (e ?& ARRAY['month', 'income', 'expenses'])
           OR e->>'month' !~ '^\d{4}-\d{2}$'
           OR jsonb_typeof(e->'income') <> 'number'
           OR jsonb_typeof(e->'expenses') <> 'number'
      );
    v_details := 'months=' || COALESCE(
      jsonb_array_length(v_series)::text,
      'null'
    );
  EXCEPTION WHEN OTHERS THEN
    v_passed := false;
    v_details := 'unexpected error [' || SQLSTATE || ']: ' || SQLERRM;
  END;

  INSERT INTO smoke003_results (check_name, passed, details)
  VALUES ('dashboard_monthly_series contract', v_passed, v_details);
END;
$smoke_aggregates$;


-- Invalid-input behavior is checked without invoking an expected exception.
-- The definition must contain both guards; executing those invalid calls would
-- deliberately raise and risks preventing later statements from running.
INSERT INTO smoke003_results (check_name, passed, details)
SELECT
  'invalid-input guards are present',
  pg_catalog.pg_get_functiondef(
    'public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean)'::regprocedure
  ) LIKE '%p_limit IS NULL OR p_limit < 1%'
  AND pg_catalog.pg_get_functiondef(
    'public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean)'::regprocedure
  ) LIKE '%unsupported sort%',
  'checked p_limit and unsupported-sort guards in pg_get_functiondef';


-- Recompute an exact row count and whole-row fingerprint. This detects any
-- insert, delete, or update to public.transactions during the smoke test.
INSERT INTO smoke003_results (check_name, passed, details)
SELECT
  'transaction data unchanged',
  before.row_count = after.row_count
    AND before.content_fingerprint = after.content_fingerprint,
  'before=' || before.row_count::text || '/' || before.content_fingerprint
    || ', after=' || after.row_count::text || '/' || after.content_fingerprint
FROM smoke003_transaction_baseline before
CROSS JOIN LATERAL (
  SELECT count(*)::bigint AS row_count,
         pg_catalog.md5(
           COALESCE(
             pg_catalog.string_agg(
               pg_catalog.md5(pg_catalog.to_jsonb(t)::text),
               '' ORDER BY t.id
             ),
             ''
           )
         ) AS content_fingerprint
  FROM public.transactions t
) after;


-- =============================================================================
-- VISIBLE SQL EDITOR RESULT + AUTOMATIC ROLLBACK
--
-- A RED SQL EDITOR ERROR IS EXPECTED. The exception is intentional and is the
-- final statement, so PostgreSQL aborts and rolls back this entire transaction.
--
--   SMOKE_003_PASS ... means every smoke check passed.
--   SMOKE_003_FAIL ... identifies the failed checks.
--
-- Run docs/verify_003_absent.sql separately afterward to confirm cleanup.
-- =============================================================================

DO $smoke_final_result$
DECLARE
  v_checks bigint;
  v_passed bigint;
  v_failed bigint;
  v_failures jsonb;
  v_failure_text text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE passed),
         count(*) FILTER (WHERE NOT passed),
         COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'name', check_name,
               'details', left(details, 240)
             )
             ORDER BY check_order
           ) FILTER (WHERE NOT passed),
           '[]'::jsonb
         )
    INTO v_checks, v_passed, v_failed, v_failures
  FROM smoke003_results;

  IF v_failed = 0 THEN
    RAISE EXCEPTION USING MESSAGE = pg_catalog.format(
      'SMOKE_003_PASS: checks=%s, passed=%s, failed=0',
      v_checks,
      v_passed
    );
  END IF;

  v_failure_text := v_failures::text;

  -- Keep the SQL Editor error comfortably bounded. The normal representation
  -- caps each detail at 240 characters. If it still exceeds 8,000 characters,
  -- fall back to compact JSON containing every failed check name.
  IF length(v_failure_text) > 8000 THEN
    SELECT jsonb_build_object(
             'details_truncated', true,
             'failed_checks', jsonb_agg(check_name ORDER BY check_order)
           )::text
      INTO v_failure_text
    FROM smoke003_results
    WHERE NOT passed;
  END IF;

  RAISE EXCEPTION USING MESSAGE = pg_catalog.format(
    'SMOKE_003_FAIL: checks=%s, passed=%s, failed=%s; failures=%s',
    v_checks,
    v_passed,
    v_failed,
    v_failure_text
  );
END;
$smoke_final_result$;
