-- Read-only. Run before deploying/reopening writers; compare preservation with preflight.
SELECT jsonb_build_object('checks', jsonb_build_object(
 'new_external_grant', has_function_privilege('service_role','public.ingest_external_transaction(jsonb,boolean)','EXECUTE'),
 'new_owned_grant', has_function_privilege('service_role','public.ingest_owned_transaction(text,text,jsonb,jsonb,jsonb)','EXECUTE'),
 'private_unified_denied', NOT has_function_privilege('service_role','public.unified_ingest(bigint,jsonb,jsonb,jsonb,text,jsonb)','EXECUTE'),
 'anon_external_denied', NOT has_function_privilege('anon','public.ingest_external_transaction(jsonb,boolean)','EXECUTE'),
 'authenticated_owned_denied', NOT has_function_privilege('authenticated','public.ingest_owned_transaction(text,text,jsonb,jsonb,jsonb)','EXECUTE'),
 'old_cal_denied', NOT has_function_privilege('service_role','public.ingest_cal_v1(uuid,jsonb,jsonb,jsonb)','EXECUTE'),
 'old_general_denied', NOT has_function_privilege('service_role','public.ingest_general_transaction(text,jsonb)','EXECUTE'),
 'generic_guard_present', (SELECT count(*)=1 FROM pg_trigger WHERE tgrelid='public.transactions'::regclass AND tgname='unified_external_identity'),
 'old_guards_absent', (SELECT count(*)=0 FROM pg_trigger WHERE tgrelid='public.transactions'::regclass AND tgname IN ('cal_external_identity','general_external_identity')),
 'three_internal_sources', (SELECT count(*)=3 FROM public.transaction_ingestion_sources WHERE instance_key IN ('unified:v1','unified:manual','unified:csv')),
 'historical_cal_receipts_38', (SELECT count(*)=38 FROM public.cal_ingestion_receipts),
 'general_registrations_zero', (SELECT count(*)=0 FROM public.transaction_api_registrations),
 'general_receipts_zero', (SELECT count(*)=0 FROM public.transaction_api_receipts),
 'ingestion_rls_retained', (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.transaction_ingestion_sources'::regclass,'public.transaction_source_observations'::regclass,'public.transaction_reconciliation_events'::regclass,'public.cal_ingestion_receipts'::regclass,'public.transaction_api_registrations'::regclass,'public.transaction_api_receipts'::regclass,'public.transaction_api_resolutions'::regclass))),
 'preservation', (SELECT jsonb_object_agg(c.relname,
  query_to_xml(format(
    'SELECT count(*) AS rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY md5(to_jsonb(t)::text)), '''')) AS fingerprint FROM public.%I t%s',
    c.relname, CASE WHEN c.relname='transaction_ingestion_sources'
      THEN ' WHERE instance_key NOT IN (''unified:v1'',''unified:manual'',''unified:csv'')' ELSE '' END), true, false, '')::text)
 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p'))) AS postflight;
