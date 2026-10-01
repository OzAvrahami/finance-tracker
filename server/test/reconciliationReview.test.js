const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const {createReconciliationRouter}=require('../routes/reconciliationRoutes');
const owner='11111111-1111-4111-8111-111111111111';
async function fixture(t, result={}, environment={FLOWLINK_OWNER_USER_IDS:JSON.stringify([owner])}) {
 const calls=[],app=express();app.use(express.json());
 app.use((req,res,next)=>{if(req.headers.authorization==='Bearer owner-session')req.user={id:owner};else if(req.headers.authorization==='Bearer ordinary-session')req.user={id:'other'};next();});
 app.use('/review',createReconciliationRouter({db:{rpc:async(name,args)=>{calls.push({name,args});return {data:result};}},env:()=>environment}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 return {calls,send:async(path,body,authorization='Bearer owner-session')=>{
  const r=await fetch(`http://127.0.0.1:${server.address().port}/review${path}`,{method:body?'POST':'GET',headers:{authorization,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:await r.json()};
 }};
}
const command=()=>({request_key:randomUUID(),expected_revision:'1',action:'link',transaction_id:'2',expected_transaction_fingerprint:'a'.repeat(32),expected_candidate_fingerprints:{2:'a'.repeat(32)}});
test('owner gate denies anonymous, native credentials, ordinary users and missing/malformed configuration',async t=>{
 const f=await fixture(t);for(const token of ['','Bearer fldev1_private','Bearer external-key'])assert.equal((await f.send('/pending',null,token)).status,401);
 assert.equal((await f.send('/pending',null,'Bearer ordinary-session')).status,403);assert.equal(f.calls.length,0);
 for(const env of [{},{FLOWLINK_OWNER_USER_IDS:'invalid'}])assert.equal((await (await fixture(t,{},env)).send('/pending')).status,503);
});
test('bounded reads reject forged IDs, duplicate ids and unknown queries',async t=>{
 const f=await fixture(t,{transactions:{},pending_count:0});assert.equal((await f.send('/summary?ids=1,2')).status,200);
 assert.deepEqual(f.calls[0].args,{p_mode:'summary',p_ids:[1,2],p_id:null});
 for(const path of ['/summary?ids=1,1','/summary?ids=abc','/pending?before=-1','/observation/0','/pending?token=bad'])assert.equal((await f.send(path)).status,400);
});
test('review only invokes shared command with authenticated actor; rejects arbitrary fields',async t=>{
 const result={outcome:'reconciled',transaction_id:'2',observation_id:'1',disposition:'attached',decision_revision:'2',review_required:false};
 const f=await fixture(t,result),b=command();
 assert.equal((await f.send('/observation/1/resolve',{...b,actor:'forged'})).status,400);
 assert.equal((await f.send('/observation/1/resolve',{...b,payment_source_id:'6'})).status,400);
 const r=await f.send('/observation/1/resolve',b);assert.equal(r.status,200);assert.equal(f.calls[0].name,'review_reconciliation');
 assert.equal(f.calls[0].args.p_command.actor,`owner:${owner}`);assert.equal(f.calls[0].args.p_request_key,b.request_key);
 assert.equal(JSON.stringify(r.body).includes(owner),false);
});
test('stale and protected decisions return actionable safe failures',async t=>{
 for(const [reason,status] of [['stale_review',409],['review_target_conflict',409],['command_key_conflict',409],['protected_transaction',422]]) {
  const f=await fixture(t,{outcome:'rejected',reason_code:reason,raw_payload:'must not leak'});
  const r=await f.send('/observation/1/resolve',command());assert.equal(r.status,status);assert.equal(JSON.stringify(r.body).includes('must not leak'),false);
 }
});
