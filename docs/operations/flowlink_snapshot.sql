-- Owner-operated, read-only evidence. Run with psql -X -qAt -v ON_ERROR_STOP=1.
-- No row payloads, credentials or digests of credentials are emitted.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL timezone = 'UTC';
SET LOCAL row_security = off;
SET LOCAL statement_timeout = '120s';
SELECT jsonb_build_object('kind','environment','major',current_setting('server_version_num')::int / 10000,
  'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'bypass',rolbypassrls) ORDER BY rolname)
    FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')));
-- Inventory and exact catalog evidence (extension-owned objects excluded).
SELECT jsonb_build_object('kind','catalog','object','relation:'||c.relname,'value',jsonb_build_object(
 'type',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),
 'options',c.reloptions,
 'acl',(SELECT jsonb_agg(jsonb_build_object('role',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee=0,pg_get_userbyid(a.grantee),a.privilege_type)
 FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a),
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid),'validated',x.convalidated) ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=c.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
 'policies',(SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r) FROM unnest(p.polroles) r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),
 'view',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) END,
 'effective',(SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'privilege',v,'allowed',has_table_privilege(r.oid,c.oid,v)) ORDER BY r.rolname,v)
 FROM pg_roles r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) v WHERE r.rolname IN ('anon','authenticated','service_role') AND c.relkind<>'S')
)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') ORDER BY c.relname;
SELECT jsonb_build_object('kind','catalog','object','function:'||p.oid::regprocedure::text,'value',jsonb_build_object(
 'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
 'security_definer',p.prosecdef,'config',p.proconfig,'owner',pg_get_userbyid(p.proowner),
 'acl',(SELECT jsonb_agg(jsonb_build_object('role',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee=0,pg_get_userbyid(a.grantee),a.privilege_type) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),
 'effective',(SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'execute',has_function_privilege(r.oid,p.oid,'EXECUTE')) ORDER BY r.rolname) FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role'))
)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY p.oid::regprocedure::text;
-- Full row fingerprints of EVERY public application table/materialized view.
-- Exclude credential/capability values from output: only aggregate row hashes leave the DB.
SELECT format($q$SELECT jsonb_build_object('kind','data','object',%L,'count',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM public.%I t) rows$q$,c.relname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','m')
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') ORDER BY c.relname
\gexec
SELECT jsonb_build_object('kind','totals','object','transactions','count',count(*),'all_amount',coalesce(sum(total_amount),0)::text,
 'live_count',count(*) FILTER (WHERE voided_at IS NULL),'live_amount',coalesce(sum(total_amount) FILTER (WHERE voided_at IS NULL),0)::text) FROM public.transactions;
-- 036 observations are inspected without changing source/cash/reconciliation state.
SELECT jsonb_build_object('kind','invariants','object','apy',
 'flowlink_sources',(SELECT count(*) FROM public.transaction_ingestion_sources WHERE instance_key LIKE 'flowlink:%'),
 'flowlink_observations',(SELECT count(*) FROM public.transaction_source_observations o JOIN public.transaction_ingestion_sources s ON s.id=o.source_id WHERE s.instance_key LIKE 'flowlink:%'),
 'flowlink_financial_events',(SELECT count(*) FROM public.transaction_reconciliation_events e JOIN public.transaction_ingestion_sources s ON s.id=e.source_id WHERE s.instance_key LIKE 'flowlink:%' AND e.event_kind<>'source_configuration'));
-- Existing APY rows stay unchanged when enrollment adds binding sources/configuration receipts.
SELECT format($q$SELECT jsonb_build_object('kind','legacy_apy','object',%L,'count',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM public.%I t WHERE %s) rows$q$,name,name,predicate)
FROM (VALUES
 ('transaction_ingestion_sources', 't.instance_key NOT LIKE ''flowlink:%'''),
 ('transaction_source_observations', 'NOT EXISTS(SELECT 1 FROM public.transaction_ingestion_sources s WHERE s.id=t.source_id AND s.instance_key LIKE ''flowlink:%'')'),
 ('transaction_reconciliation_events', 'NOT EXISTS(SELECT 1 FROM public.transaction_ingestion_sources s WHERE s.id=t.source_id AND s.instance_key LIKE ''flowlink:%'')')
) v(name,predicate)
\gexec
COMMIT;
