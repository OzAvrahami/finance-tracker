-- Read-only. Run after ALL financial writers are paused, then inspect every check.
-- Counts/fingerprints belong in a private evidence directory, never in Git.
SELECT jsonb_build_object('checks', jsonb_build_object(
 'server_major_17', current_setting('server_version_num')::integer / 10000 = 17,
 'migration_054_absent', to_regprocedure('public.unified_ingest(bigint,jsonb,jsonb,jsonb,text,jsonb)') IS NULL,
 'new_adapter_absent', to_regprocedure('public.ingest_external_transaction(jsonb,boolean)') IS NULL,
 'both_old_guards_present', (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='public.transactions'::regclass AND tgname IN ('cal_external_identity','general_external_identity')),
 'expected_constraints_present', (SELECT count(*)=2 FROM pg_constraint WHERE conname IN ('transaction_ingestion_sources_source_kind_check','transaction_source_observations_check1')),
 'old_cal_rpc_executable', has_function_privilege('service_role','public.ingest_cal_v1(uuid,jsonb,jsonb,jsonb)','EXECUTE'),
 'old_general_rpc_executable', has_function_privilege('service_role','public.ingest_general_transaction(text,jsonb)','EXECUTE'),
 'historical_cal_receipts_38', (SELECT count(*)=38 FROM public.cal_ingestion_receipts),
 'general_registrations_zero', (SELECT count(*)=0 FROM public.transaction_api_registrations),
 'general_receipts_zero', (SELECT count(*)=0 FROM public.transaction_api_receipts),
 'new_sources_absent', (SELECT count(*)=0 FROM public.transaction_ingestion_sources WHERE instance_key IN ('unified:v1','unified:manual','unified:csv')),
 'no_other_public_writer_locks', NOT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE l.pid<>pg_backend_pid() AND c.relnamespace='public'::regnamespace AND l.mode IN ('RowExclusiveLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))),
 'preservation', (SELECT jsonb_object_agg(c.relname,
  query_to_xml(format(
    'SELECT count(*) AS rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY md5(to_jsonb(t)::text)), '''')) AS fingerprint FROM public.%I t%s',
    c.relname, CASE WHEN c.relname='transaction_ingestion_sources'
      THEN ' WHERE instance_key NOT IN (''unified:v1'',''unified:manual'',''unified:csv'')' ELSE '' END), true, false, '')::text)
 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p'))) AS preflight;
