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
