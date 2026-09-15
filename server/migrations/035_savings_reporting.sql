-- SAV-07: read-only reporting. No financial writes, backfill or new relations.
BEGIN;
-- Replace optional signatures atomically, preserving every old positional/named call.
DROP FUNCTION public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean,bigint);
DROP FUNCTION public.transactions_filtered(date,date,bigint,bigint,boolean,text,bigint,integer);
CREATE OR REPLACE FUNCTION public.transactions_filtered(
  p_from                date    DEFAULT NULL,
  p_to                  date    DEFAULT NULL,
  p_category_id         bigint  DEFAULT NULL,
  p_payment_source_id   bigint  DEFAULT NULL,
  p_uncategorized_only  boolean DEFAULT false,
  p_search              text    DEFAULT NULL,
  p_savings_account_id bigint DEFAULT NULL,
  p_transaction_id integer DEFAULT NULL,
  p_savings_flow text DEFAULT NULL
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
      'cash_flow',cf.kind,
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
  CROSS JOIN LATERAL (SELECT CASE
    WHEN t.voided_at IS NOT NULL THEN 'cancelled'
    WHEN se.reversed_by_entry_id IS NULL AND c.savings_role=se.event_kind
      AND ((se.event_kind='deposit' AND t.movement_type='expense')
        OR (se.event_kind IN ('withdrawal','interest_payout') AND t.movement_type='income')) THEN se.event_kind
    WHEN t.movement_type='expense' THEN 'ordinary_expense' ELSE 'ordinary_income' END AS kind) cf
  WHERE (p_savings_flow IS NULL OR cf.kind=p_savings_flow)
    AND (t.voided_at IS NULL OR p_transaction_id=t.id)
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
  p_include_totals boolean DEFAULT false,
  p_savings_account_id bigint DEFAULT NULL,
  p_savings_flow text DEFAULT NULL
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
  IF p_savings_flow IS NOT NULL AND p_savings_flow NOT IN ('deposit','withdrawal','interest_payout','ordinary_expense','ordinary_income') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='סוג תזרים אינו תקין';
  END IF;
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
             p_uncategorized_only, p_search,p_savings_account_id,NULL,p_savings_flow) f
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
             p_uncategorized_only, p_search,p_savings_account_id,NULL,p_savings_flow) f
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
             p_uncategorized_only, p_search,p_savings_account_id,NULL,p_savings_flow) f
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
             p_uncategorized_only, p_search,p_savings_account_id,NULL,p_savings_flow) f
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
             p_uncategorized_only, p_search,p_savings_account_id,NULL,p_savings_flow) f
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
             p_uncategorized_only, p_search,p_savings_account_id,NULL,p_savings_flow) f
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
           p_uncategorized_only, p_search,p_savings_account_id,NULL,p_savings_flow) f;
  END IF;

  RETURN jsonb_build_object(
    'data',     v_rows,
    'has_more', v_has_more,
    'next_key', v_next_key,
    'totals',   v_totals
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.get_savings_report(p_from date, p_to date, p_account_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_from<'0001-01-01'::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='יש לבחור טווח תאריכים תקין לדוח';
 END IF;
 IF p_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.savings_accounts WHERE id=p_account_id) THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='חשבון החיסכון לא נמצא';
 END IF;
 -- One statement/snapshot: current holdings are deliberately not an as-of balance.
 -- Net active posts equal original+reversal+replacement arithmetic in each effective-date period.
 WITH accounts AS MATERIALIZED (
  SELECT s.* FROM public.savings_account_summary s WHERE p_account_id IS NULL OR s.account_id=p_account_id
 ), flows AS MATERIALIZED (
  SELECT e.account_id,
   coalesce(sum(e.amount) FILTER(WHERE e.event_kind='deposit'),0)::numeric(30,2) AS deposits,
   coalesce(sum(e.amount) FILTER(WHERE e.event_kind='withdrawal'),0)::numeric(30,2) AS withdrawals,
   coalesce(sum(e.amount) FILTER(WHERE e.event_kind='interest_capitalized'),0)::numeric(30,2) AS capitalized_interest,
   coalesce(sum(e.amount) FILTER(WHERE e.event_kind='interest_payout'),0)::numeric(30,2) AS paid_out_interest
  FROM public.savings_entries e JOIN accounts a ON a.account_id=e.account_id
  WHERE e.entry_action='post' AND e.reversed_by_entry_id IS NULL AND e.effective_date BETWEEN p_from AND p_to
  GROUP BY e.account_id
 ), cash AS MATERIALIZED (
  SELECT t.total_amount,t.movement_type,t.row_json->>'cash_flow' AS kind,t.row_json#>>'{savings,source_kind}' AS source_kind
  FROM public.transactions_filtered(p_from,p_to) t
  WHERE p_account_id IS NULL OR (t.row_json#>>'{savings,account_id}'=p_account_id::text AND t.row_json#>>'{savings,active}'='true')
 )
 SELECT jsonb_build_object(
  'from',p_from,'to',p_to,'account_id',p_account_id::text,'held_scope','current_all_time',
  'current_balance',(SELECT coalesce(sum(current_balance::numeric),0)::numeric(30,2)::text FROM accounts),
  'period',(SELECT jsonb_build_object('deposits',coalesce(sum(deposits),0)::numeric(30,2)::text,
    'withdrawals',coalesce(sum(withdrawals),0)::numeric(30,2)::text,
    'capitalized_interest',coalesce(sum(capitalized_interest),0)::numeric(30,2)::text,
    'paid_out_interest',coalesce(sum(paid_out_interest),0)::numeric(30,2)::text,
    'realized_interest',coalesce(sum(capitalized_interest+paid_out_interest),0)::numeric(30,2)::text) FROM flows),
  'cash',(SELECT jsonb_build_object(
    'expenses',coalesce(sum(total_amount) FILTER(WHERE movement_type='expense'),0)::numeric(30,2)::text,
    'income',coalesce(sum(total_amount) FILTER(WHERE movement_type='income'),0)::numeric(30,2)::text,
    'ordinary_expenses',coalesce(sum(total_amount) FILTER(WHERE kind='ordinary_expense'),0)::numeric(30,2)::text,
    'other_income',coalesce(sum(total_amount) FILTER(WHERE kind='ordinary_income'),0)::numeric(30,2)::text,
    'deposits',coalesce(sum(total_amount) FILTER(WHERE kind='deposit'),0)::numeric(30,2)::text,
    'funded_deposits',coalesce(sum(total_amount) FILTER(WHERE kind='deposit' AND source_kind='budget_surplus'),0)::numeric(30,2)::text,
    'withdrawals',coalesce(sum(total_amount) FILTER(WHERE kind='withdrawal'),0)::numeric(30,2)::text,
    'paid_out_interest',coalesce(sum(total_amount) FILTER(WHERE kind='interest_payout'),0)::numeric(30,2)::text) FROM cash),
  'accounts',(SELECT coalesce(jsonb_agg(jsonb_build_object('account_id',a.account_id::text,'name',a.name,'status',a.status,
    'current_balance',a.current_balance,'target_amount',a.target_amount,'target_remaining',a.target_remaining,
    'next_due_date',a.next_due_date,'monthly_amount',a.monthly_amount,'auto_deposit_enabled',a.auto_deposit_enabled,
    'deposits',coalesce(f.deposits,0)::numeric(30,2)::text,'withdrawals',coalesce(f.withdrawals,0)::numeric(30,2)::text,
    'realized_interest',coalesce(f.capitalized_interest+f.paid_out_interest,0)::numeric(30,2)::text) ORDER BY a.account_id),'[]'::jsonb)
    FROM accounts a LEFT JOIN flows f ON f.account_id=a.account_id)
 ) INTO v_result;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.transactions_filtered(date,date,bigint,bigint,boolean,text,bigint,integer,text),public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean,bigint,text),public.get_savings_report(date,date,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transactions_filtered(date,date,bigint,bigint,boolean,text,bigint,integer,text),public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean,bigint,text),public.get_savings_report(date,date,bigint) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
