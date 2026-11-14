-- Owner-authorized production activation: Shopping access is HTTP/owner-only.
-- Earlier 060 intentionally retained legacy SELECT policies. Keep backend reads,
-- but close direct browser/anonymous reads without touching financial grants.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $gate$
DECLARE t text;
  tables text[] := ARRAY[
    'shopping_catalog_categories','shopping_catalog_items','shopping_list_types',
    'shopping_catalog_category_list_types','shopping_lists','shopping_list_items',
    'shopping_receipts','shopping_purchase_plans','shopping_regular_products',
    'shopping_product_identifiers','shopping_commercial_products',
    'shopping_product_mappings','shopping_product_lookup_cache',
    'shopping_confirmed_purchases','shopping_checkouts'];
BEGIN
  IF to_regnamespace('shopping_private') IS NULL OR
     to_regprocedure('public.shopping_list_commit(uuid,uuid,jsonb,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'shopping_hierarchy_required';
  END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'shopping_%') <> 15 THEN
    RAISE EXCEPTION 'shopping_table_inventory_changed';
  END IF;
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role',t);
    EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
    IF has_table_privilege('anon','public.'||t,'SELECT') OR
       has_table_privilege('authenticated','public.'||t,'SELECT') OR
       NOT has_table_privilege('service_role','public.'||t,'SELECT') THEN
      RAISE EXCEPTION 'shopping_read_boundary_invalid';
    END IF;
  END LOOP;
END $gate$;
NOTIFY pgrst,'reload schema';
COMMIT;
