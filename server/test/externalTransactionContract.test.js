const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadControllerWithFake, createMockResponse } = require('./helpers/fakeSupabase');
const { serializeTags } = require('../controllers/v1/transactionController');
const { submitExternal } = require('../services/unifiedTransactionIngestion');
const request = extra => ({ type: 'expense', amount: 42.5, date: '2026-11-04', payment_source_id: 6, external_id: 'synthetic', ...extra });
function fake(result) {
 const calls=[];
 return { calls, from() { throw Error('no direct financial table access'); }, rpc: async(name,args)=>{
  calls.push({name,args});return {data:result || {outcome:'created',transaction_id:'701',replayed:false,created_at:'2026-11-04T00:00:00Z'}};
 } };
}
test('single v1 forwards established fields to one atomic command, preserving JSON-number FX semantics',async()=>{
 const db=fake(), controller=loadControllerWithFake('../../controllers/v1/transactionController',db),res=createMockResponse();
 await controller.createTransaction({body:request({currency:'USD',original_amount:12,exchange_rate:3.5,notes:'note',tags:['  food  ']})},res);
 assert.equal(res.statusCode,201);assert.equal(res.body.id,701);assert.equal(db.calls[0].name,'ingest_external_transaction');
 assert.equal(db.calls[0].args.p_request.original_amount,12);assert.deepEqual(db.calls[0].args.p_request.tags,['food']);
});
test('tag TEXT compatibility and invalid comma validation',async()=>{
 assert.equal(serializeTags(),null);assert.equal(serializeTags([]),null);assert.equal(serializeTags(['food','weekly']),'food,weekly');
 const db=fake();assert.equal((await submitExternal(db,request({tags:['food,weekly']}))).status,400);assert.equal(db.calls.length,0);
});
test('exact replay is 409; changed content is conflict; cancelled identity is never a success',async()=>{
 const replay=await submitExternal(fake({outcome:'already_observed',transaction_id:'88',replayed:true,disposition:'created'}),request());
 assert.equal(replay.status,409);assert.equal(replay.body.error,'already_exists');
 const changed=await submitExternal(fake({outcome:'conflict',reason_code:'idempotency_key_conflict',transaction_id:'88'}),request());
 assert.equal(changed.status,409);assert.equal(changed.body.error,'idempotency_key_conflict');
 const cancelled=await submitExternal(fake({outcome:'already_observed',transaction_id:'88',replayed:true,disposition:'cancelled'}),request());
 assert.equal(cancelled.body.error,'cancelled_record_exists');
});
test('dry-run stays a preview command and pending review never claims financial success',async()=>{
 const db=fake({dry_run:true,would_insert:{tags:'a,b'}}),r=await submitExternal(db,request({dry_run:true}));
 assert.equal(r.status,200);assert.equal(db.calls[0].args.p_dry_run,true);assert.equal('dry_run' in db.calls[0].args.p_request,false);
 const held=await submitExternal(fake({outcome:'ambiguous',reason_code:'competing_candidates',transaction_id:null}),request());
 assert.equal(held.status,202);assert.equal(held.body.financial_posted,false);
});
test('uncertain timeout is bounded, sanitized and never reported as rollback',async()=>{
 const r=await submitExternal({rpc:()=>new Promise(()=>{})},request(),{commandMs:5});
 assert.equal(r.status,503);assert.equal(r.body.commit_state,'unknown');assert.equal(r.body.financial_posted,null);
});
test('unsafe precision, invalid dates and new public fields fail before persistence',async()=>{
 for(const changes of [{amount:1.001},{amount:1e18},{date:'2026-02-30'},{purchase_key:'not approved'}]){
  const db=fake();assert.equal((await submitExternal(db,request(changes))).status,400);assert.equal(db.calls.length,0);
 }
});
test('Migration 016 and full_schema canonicalize the external transaction contract', () => {
  const migrationPath = path.join(
    __dirname,
    '..',
    'migrations',
    '016_external_transaction_contract.sql',
  );
  const schemaPath = path.join(__dirname, '..', 'full_schema.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const fullSchema = fs.readFileSync(schemaPath, 'utf8');

  assert.match(
    migration,
    /ALTER TABLE public\.transactions\s+ADD COLUMN IF NOT EXISTS external_id TEXT;/i,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX idx_transactions_external_id\s+ON public\.transactions \(external_id\)\s+WHERE external_id IS NOT NULL;/i,
  );
  assert.match(migration, /FROM pg_catalog\.pg_index i/i);
  assert.match(migration, /exists with an incompatible definition/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_unique_tags\(\)/i);
  assert.match(migration, /string_to_array\(t\.tags, ','\)/i);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.get_unique_tags\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/i,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_unique_tags\(\)\s+TO service_role;/i,
  );

  assert.match(fullSchema, /external_id\s+TEXT,/i);
  assert.match(
    fullSchema,
    /CREATE UNIQUE INDEX idx_transactions_external_id\s+ON transactions \(external_id\)\s+WHERE external_id IS NOT NULL;/i,
  );
  assert.match(fullSchema, /CREATE OR REPLACE FUNCTION public\.get_unique_tags\(\)/i);
  assert.match(fullSchema, /string_to_array\(t\.tags, ','\)/i);
  assert.match(
    fullSchema,
    /REVOKE ALL ON FUNCTION public\.get_unique_tags\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/i,
  );
  assert.match(
    fullSchema,
    /GRANT EXECUTE ON FUNCTION public\.get_unique_tags\(\)\s+TO service_role;/i,
  );
});

test('external v1 does not log complete incoming financial request bodies', () => {
  const controllerPath = path.join(
    __dirname,
    '..',
    'controllers',
    'v1',
    'transactionController.js',
  );
  const controllerSource = fs.readFileSync(controllerPath, 'utf8');

  assert.doesNotMatch(controllerSource, /Incoming transaction body/i);
  assert.doesNotMatch(controllerSource, /JSON\.stringify\(req\.body/);
});
