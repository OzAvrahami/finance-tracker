BEGIN;

-- Canonicalize the database prerequisites used by POST /api/v1/transactions.
-- These objects predate the repository migration history in production, so
-- every step tolerates the verified live shape while rejecting a conflicting
-- object instead of silently accepting it.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS external_id TEXT;

DO $$
DECLARE
  v_type TEXT;
  v_not_null BOOLEAN;
  v_default TEXT;
BEGIN
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod),
         a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid)
  INTO v_type, v_not_null, v_default
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.transactions'::pg_catalog.regclass
    AND a.attname = 'external_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transactions.external_id was not created';
  END IF;
  IF v_type <> 'text' OR v_not_null OR v_default IS NOT NULL THEN
    RAISE EXCEPTION
      'transactions.external_id has incompatible shape (type %, not_null %, default %)',
      v_type, v_not_null, coalesce(v_default, '<none>');
  END IF;
END;
$$;

DO $$
DECLARE
  v_index_oid pg_catalog.oid := pg_catalog.to_regclass(
    'public.idx_transactions_external_id'
  );
  v_table_oid pg_catalog.oid;
  v_unique BOOLEAN;
  v_valid BOOLEAN;
  v_ready BOOLEAN;
  v_key_count INTEGER;
  v_attribute_count INTEGER;
  v_key_expression TEXT;
  v_predicate TEXT;
BEGIN
  IF v_index_oid IS NULL THEN
    CREATE UNIQUE INDEX idx_transactions_external_id
      ON public.transactions (external_id)
      WHERE external_id IS NOT NULL;
  ELSE
    SELECT i.indrelid,
           i.indisunique,
           i.indisvalid,
           i.indisready,
           i.indnkeyatts,
           i.indnatts,
           pg_catalog.pg_get_indexdef(i.indexrelid, 1, true),
           pg_catalog.regexp_replace(
             pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred, i.indrelid)),
             '[()[:space:]]',
             '',
             'g'
           )
    INTO v_table_oid, v_unique, v_valid, v_ready, v_key_count,
         v_attribute_count, v_key_expression, v_predicate
    FROM pg_catalog.pg_index i
    WHERE i.indexrelid = v_index_oid;

    IF NOT FOUND
      OR v_table_oid <> 'public.transactions'::pg_catalog.regclass
      OR NOT v_unique
      OR NOT v_valid
      OR NOT v_ready
      OR v_key_count <> 1
      OR v_attribute_count <> 1
      OR v_key_expression <> 'external_id'
      OR v_predicate <> 'external_idisnotnull' THEN
      RAISE EXCEPTION
        'public.idx_transactions_external_id exists with an incompatible definition';
    END IF;
  END IF;
END;
$$;

-- Preserve the existing comma-separated TEXT contract and its observable
-- DISTINCT/split behavior. This is a server-only read RPC; it intentionally
-- remains SECURITY INVOKER and grants no table access of its own.
CREATE OR REPLACE FUNCTION public.get_unique_tags()
RETURNS TABLE(tag TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT
    pg_catalog.unnest(pg_catalog.string_to_array(t.tags, ',')) AS tag
  FROM public.transactions AS t;
$$;

REVOKE ALL ON FUNCTION public.get_unique_tags()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unique_tags()
  TO service_role;

COMMIT;
