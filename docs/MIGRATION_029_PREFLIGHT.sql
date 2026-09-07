-- Read-only. Run before Migration 029; save the single JSON result for comparison.
WITH columns AS (
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shopping_lists'
), checks AS (
  SELECT count(*) FILTER (WHERE column_name IN ('store', 'link', 'target_date')) = 0 AS columns_absent,
         count(*) FILTER (WHERE column_name IN ('id', 'title', 'list_type_id', 'status', 'created_at', 'updated_at')) = 6 AS header_present
  FROM columns
)
SELECT jsonb_build_object(
  'result', CASE WHEN columns_absent AND header_present THEN 'MIGRATION_029_PREFLIGHT_PASS' ELSE 'MIGRATION_029_PREFLIGHT_STOP' END,
  'header_present', header_present, 'new_columns_absent', columns_absent,
  'list_count', (SELECT count(*) FROM public.shopping_lists),
  'item_count', (SELECT count(*) FROM public.shopping_list_items),
  'checkout_count', (SELECT count(*) FROM public.shopping_checkouts),
  'header_fingerprint', (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id)::text, '[]')) FROM public.shopping_lists s)
) AS verification
FROM checks;
