'use strict';

// Produces reviewed SQL only. No network, credential discovery or execution.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { removeFunctions, retainFunctions } = require('../modules/shopping/shared/migrationReadiness');
const sources = Object.freeze([
  ['060_shopping_hierarchy_persistence.sql','0d088ec3c0851c1f38badcef6afa32381cfc1b3b075226975af26a193e0aa66e','20261110200708'],
  ['061_shopping_category_contract.sql','4e19c45dc4f02c3c47ad7249f2752d587a4c6a45147047927307a2b940f545bb','20261111175902'],
  ['062_shopping_administration_contract.sql','00ffef70764d50661fd23b82fe262a4e0a165121b8540ef59ef23bc7e45d661d','20261111190541'],
  ['063_shopping_workflow_persistence.sql','6b87a2e9751ea6f0e03af52d65c7025426d009653b2e0d88c61a67e71584de7d','20261111203921'],
]);
const project = 'ohhvzveyreolguztcnqx';
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const hash = value => createHash('sha256').update(value).digest('hex');
const check = (expression, error) => `DO $gate$ BEGIN IF (${expression}) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '${error}'; END IF; END $gate$;`;
function preservationMask(table) {
  if(table==='shopping_catalog_categories')return "-'parent_id'-'is_active'-'revision'-'display_order'-'updated_at'";
  if(table==='shopping_catalog_items')return "-'category_id'-'revision'-'updated_at'";
  if(['shopping_lists','shopping_list_types'].includes(table))return "-'revision'";
  if(table==='shopping_product_lookup_cache')return "-'lease_id'";
  return '';
}
function derivedBodies() {
  return sources.map(([file, expected]) => {
    const bytes = fs.readFileSync(path.join(__dirname, '../migrations', file));
    assert.equal(hash(bytes), expected, 'Migration source hash mismatch');
    const text = bytes.toString('utf8').replaceAll('\r\n','\n');
    const boundary = text.indexOf('END $$;\n');
    assert(boundary > 0 && boundary < 1200);
    const guard = text.slice(0,boundary+8);
    assert(guard.includes("shopping_isolated_migration_required") && guard.includes('BEGIN;'));
    assert(text.endsWith("NOTIFY pgrst,'reload schema';\nCOMMIT;\n"));
    let body = text.slice(boundary+8, -"NOTIFY pgrst,'reload schema';\nCOMMIT;\n".length);
    if (file.startsWith('060')) {
      const original = "PERFORM setval(pg_get_serial_sequence('public.shopping_catalog_categories','id'),(SELECT greatest(1,max(id)) FROM public.shopping_catalog_categories));";
      assert.equal(body.split(original).length,2);
      // Same next generated ID, but transactional RESTART rolls back with DDL.
      body = body.replace(original,"EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',pg_get_serial_sequence('public.shopping_catalog_categories','id'),(SELECT greatest(1,max(id))+1 FROM public.shopping_catalog_categories));");
    }
    assert(!/^COMMIT;/m.test(body));return body;
  });
}
function fingerprint(table) {
  assert(/^shopping_[a-z_]+$/.test(table));
  return `(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) FROM public.${table} t)`;
}
function fenceSql(tables, key, release = false, systemId) {
  assert(/^[a-f0-9]{64}$/.test(key));
  assert(/^[0-9]{19,20}$/.test(systemId));
  assert.equal(tables.length,15);tables.forEach(t=>assert(/^shopping_[a-z_]+$/.test(t)));
  const names = [...tables].sort();
  const identity=check(`current_database()='postgres' AND (SELECT system_identifier::text FROM pg_control_system())=${quote(systemId)}`,'shopping_database_identity_invalid');
  if (release) return `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'; ${identity}\n`+names.map(t=>`DROP TRIGGER shopping_cutover_fence ON public.${t};`).join('\n')+'\nDROP FUNCTION public.shopping_cutover_write_fence(); COMMIT;';
  return `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';
    ${identity}
    LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE ${names.map(t=>'public.'+t).join(',')} IN SHARE ROW EXCLUSIVE MODE;
    CREATE FUNCTION public.shopping_cutover_write_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fence$
    BEGIN IF current_setting('shopping.cutover_key',true) IS DISTINCT FROM ${quote(key)} THEN RAISE EXCEPTION 'shopping_maintenance' USING ERRCODE='55000'; END IF; RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END $fence$;
    REVOKE ALL ON FUNCTION public.shopping_cutover_write_fence() FROM PUBLIC,anon,authenticated,service_role;
    ${names.map(t=>`CREATE TRIGGER shopping_cutover_fence BEFORE INSERT OR UPDATE OR DELETE ON public.${t} FOR EACH ROW EXECUTE FUNCTION public.shopping_cutover_write_fence();`).join('\n')}
    COMMIT;`;
}
function buildBundle({ targetProject, databaseSystemIdentifier, ownerAuthorization, fenceKey, baseline, ledger, mappingSql, schemaAssertions = '', postAssertions = '' }) {
  assert.equal(targetProject,project,'Explicit production target required');
  assert.equal(ownerAuthorization,'issue-102-owner-production-authorized-backup-waived','Owner authorization required');
  assert(/^[0-9]{19,20}$/.test(databaseSystemIdentifier));
  assert(/^[a-f0-9]{64}$/.test(fenceKey));assert.equal(baseline.length,15);
  assert.equal(new Set(baseline.map(r=>r.name)).size,15);
  const tables = baseline.map(r=>r.name).sort();tables.forEach(t=>assert(/^shopping_[a-z_]+$/.test(t)));
  assert(ledger.length && ledger.at(-1).name==='059_manual_owner_refunds');
  assert(mappingSql.includes('CREATE TEMP TABLE shopping_mapping_categories'));
  const bodies=derivedBodies();
  // Application writes remain fenced after this transaction; only the reviewed
  // activation step removes the fence after matching runtime readiness checks.
  const prefix = `BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s'; SET LOCAL transaction_timeout='120s';
SET LOCAL shopping.cutover_key=${quote(fenceKey)};
${check(`current_database()='postgres' AND current_user='postgres' AND (SELECT system_identifier::text FROM pg_control_system())=${quote(databaseSystemIdentifier)}`,'shopping_database_identity_invalid')}
LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE ${tables.map(t=>'public.'+t).join(',')} IN SHARE ROW EXCLUSIVE MODE;
${check(`(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version) FROM supabase_migrations.schema_migrations)=${quote(JSON.stringify(ledger))}::jsonb`,'shopping_ledger_drift')}
${check(`(SELECT count(*) FROM pg_trigger WHERE tgname='shopping_cutover_fence' AND NOT tgisinternal)=15`,'shopping_writer_fence_required')}
${check("to_regnamespace('shopping_private') IS NULL",'shopping_unexpected_schema')}
${baseline.map(r=>{assert(Number.isSafeInteger(r.count)&&/^[a-f0-9]{32}$/.test(r.hash));return check(`(SELECT count(*) FROM public.${r.name})=${r.count} AND ${fingerprint(r.name)}=${quote(r.hash)}`,'shopping_preservation_drift');}).join('\n')}
${schemaAssertions}
CREATE TEMP TABLE shopping_cutover_preserved(name text PRIMARY KEY, rows jsonb) ON COMMIT DROP;
${[...tables,'transactions'].filter(t=>!['shopping_catalog_category_list_types'].includes(t)).map(t=> {
    const minus=preservationMask(t);
    return `INSERT INTO shopping_cutover_preserved SELECT ${quote(t)},coalesce(jsonb_agg(to_jsonb(t)${minus} ORDER BY (to_jsonb(t)${minus})::text),'[]'::jsonb) FROM public.${t} t;`;
  }).join('\n')}
CREATE TEMP TABLE shopping_cutover_functions ON COMMIT DROP AS SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.oid IN (${[...retainFunctions,'apy_protected(integer)','ingestion_core_commit(jsonb,text,jsonb)','ingestion_core_snapshot(jsonb)','savings_assert_links()'].map(s=>quote(s)+'::regprocedure').join(',')});
${mappingSql}
`;
  const preserving=t=> {
    const minus=preservationMask(t);
    const original=t==='shopping_catalog_categories'?"WHERE t.id IN (SELECT (r->>'id')::bigint FROM shopping_cutover_preserved s CROSS JOIN LATERAL jsonb_array_elements(s.rows) r WHERE s.name='shopping_catalog_categories')":'';
    return check(`(SELECT coalesce(jsonb_agg(to_jsonb(t)${minus} ORDER BY (to_jsonb(t)${minus})::text),'[]'::jsonb) FROM public.${t} t ${original})=(SELECT rows FROM shopping_cutover_preserved WHERE name=${quote(t)})`,'shopping_post_preservation_failed_'+t);
  };
  const suffix=`
${[...tables,'transactions'].filter(t=>t!=='shopping_catalog_category_list_types').map(preserving).join('\n')}
${check("(SELECT count(*) FROM shopping_catalog_categories)=99 AND (SELECT count(*) FROM shopping_catalog_categories WHERE is_active)=74 AND (SELECT count(*) FROM shopping_catalog_items)=173 AND (SELECT count(*) FROM shopping_catalog_category_list_types)=21 AND (SELECT count(*) FROM shopping_list_items)=85",'shopping_target_count_failed')}
${check("NOT EXISTS(SELECT id,parent_id,is_active FROM shopping_catalog_categories EXCEPT SELECT id,parent_id,is_active FROM shopping_mapping_categories) AND NOT EXISTS(SELECT id,category_id FROM shopping_catalog_items EXCEPT SELECT id,category_id FROM shopping_mapping_products) AND NOT EXISTS(SELECT category_id,list_type_id FROM shopping_catalog_category_list_types EXCEPT SELECT category_id,list_type_id FROM shopping_mapping_links)",'shopping_target_mapping_failed')}
${removeFunctions.map(s=>check(`to_regprocedure(${quote(s)}) IS NULL`,'shopping_retirement_failed')).join('\n')}
${check("NOT EXISTS(SELECT 1 FROM shopping_cutover_functions f WHERE pg_get_functiondef(to_regprocedure(f.signature)) IS DISTINCT FROM f.definition)",'shopping_retained_function_changed')}
${postAssertions}
${sources.map(([name,source,version],i)=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name.slice(0,-4))},ARRAY[${quote('Issue #102 owner-authorized production derivation; source SHA256 '+source+'; derived body SHA256 '+hash(bodies[i])+'; mapping SHA256 7b4b0547363ebd6066aca8cee5871467cb0a1db1ed6271c36b7de80a6f8d4fdf; backup waived; bounded atomic bundle')}]);`).join('\n')}
NOTIFY pgrst,'reload schema';
COMMIT;
`;
  return prefix+bodies.join('\n')+suffix;
}
module.exports={ sources, derivedBodies, fingerprint, fenceSql, buildBundle, quote, check, hash };
