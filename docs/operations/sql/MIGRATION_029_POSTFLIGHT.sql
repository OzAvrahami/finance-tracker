-- Read-only. Run immediately after Migration 029, before application writes.
-- Compare counts/fingerprint to preflight. The script cannot infer that baseline.
WITH columns AS (
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shopping_lists'
    AND column_name IN ('store', 'link', 'target_date')
), checks AS (
  SELECT count(*) = 3 AND count(*) FILTER (
    WHERE is_nullable = 'YES' AND column_default IS NULL
      AND data_type = CASE WHEN column_name = 'target_date' THEN 'date' ELSE 'text' END
  ) = 3 AS shape_correct FROM columns
)
SELECT jsonb_build_object(
  'result', CASE WHEN shape_correct THEN 'MIGRATION_029_POSTFLIGHT_PASS' ELSE 'MIGRATION_029_POSTFLIGHT_STOP' END,
  'nullable_columns_without_defaults', shape_correct,
  'list_count', (SELECT count(*) FROM public.shopping_lists),
  'item_count', (SELECT count(*) FROM public.shopping_list_items),
  'checkout_count', (SELECT count(*) FROM public.shopping_checkouts),
  'header_fingerprint', (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) - ARRAY['store','link','target_date'] ORDER BY id)::text, '[]')) FROM public.shopping_lists s)
) AS verification
FROM checks;
