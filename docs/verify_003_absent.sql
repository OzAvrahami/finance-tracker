SELECT
  CASE WHEN to_regclass('public.idx_transactions_date_id_desc') IS NULL
       THEN 'PASS' ELSE 'FAIL' END AS result,
  'post-rollback: index absent' AS check_name,
  COALESCE(
    pg_catalog.pg_get_indexdef(to_regclass('public.idx_transactions_date_id_desc')),
    'not present'
  ) AS details
UNION ALL
SELECT
  CASE WHEN to_regprocedure('public.transactions_search_pattern(text)') IS NULL
       THEN 'PASS' ELSE 'FAIL' END,
  'post-rollback: transactions_search_pattern absent',
  COALESCE(
    to_regprocedure('public.transactions_search_pattern(text)')::text,
    'not present'
  )
UNION ALL
SELECT
  CASE WHEN to_regprocedure('public.transactions_filtered(date,date,bigint,bigint,boolean,text)') IS NULL
       THEN 'PASS' ELSE 'FAIL' END,
  'post-rollback: transactions_filtered absent',
  COALESCE(
    to_regprocedure('public.transactions_filtered(date,date,bigint,bigint,boolean,text)')::text,
    'not present'
  )
UNION ALL
SELECT
  CASE WHEN to_regprocedure('public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean)') IS NULL
       THEN 'PASS' ELSE 'FAIL' END,
  'post-rollback: transactions_page absent',
  COALESCE(
    to_regprocedure('public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean)')::text,
    'not present'
  )
UNION ALL
SELECT
  CASE WHEN to_regprocedure('public.dashboard_summary(date,date)') IS NULL
       THEN 'PASS' ELSE 'FAIL' END,
  'post-rollback: dashboard_summary absent',
  COALESCE(
    to_regprocedure('public.dashboard_summary(date,date)')::text,
    'not present'
  )
UNION ALL
SELECT
  CASE WHEN to_regprocedure('public.dashboard_monthly_series(integer)') IS NULL
       THEN 'PASS' ELSE 'FAIL' END,
  'post-rollback: dashboard_monthly_series absent',
  COALESCE(
    to_regprocedure('public.dashboard_monthly_series(integer)')::text,
    'not present'
  );
