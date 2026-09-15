const test=require('node:test'),assert=require('node:assert/strict');
const {createMockResponse,loadControllerWithFake}=require('./helpers/fakeSupabase');
const command={source_month:'2026-09',category_id:'100',account_id:'9007199254740993',amount:'300.01',payment_source_id:'1',cash_date:'2026-09-13'};
async function request(method,body,error){const calls=[],fake={rpc:async(name,args)=>{calls.push({name,args});return {data:{operation_id:'20'},error};}};const controller=loadControllerWithFake('../../controllers/savingsController',fake),res=createMockResponse();await controller[method]({body,params:{id:'20'}},res);return {res,calls};}
test('surplus preview preserves exact IDs/money and validates calendar dates before SQL',async()=>{
 const r=await request('surplusPreview',command);assert.equal(r.res.statusCode,200);assert.equal(r.calls[0].name,'get_savings_surplus_preview');assert.equal(r.calls[0].args.p_account_id,'9007199254740993');assert.equal(r.calls[0].args.p_amount,'300.01');
 for(const body of [{...command,amount:300.01},{...command,cash_date:'2026-02-30'},{...command,cash_date:'9/13/2026'}]){const invalid=await request('surplusPreview',body);assert.equal(invalid.res.statusCode,422);assert.equal(invalid.calls.length,0);}
});
test('apply and reversal use dedicated atomic commands; stale conflicts retain Hebrew and domain code',async()=>{
 const apply=await request('applySurplus',{request_key:'key',preview_fingerprint:'fingerprint',command});assert.equal(apply.res.statusCode,201);assert.deepEqual(apply.calls,[{name:'apply_savings_surplus',args:{p_request_key:'key',p_preview_fingerprint:'fingerprint',p_command:command}}]);
 const reversed=await request('reverseSurplus',{request_key:'key',preview_fingerprint:'fingerprint',reason:'תיקון'});assert.equal(reversed.calls[0].name,'reverse_savings_surplus');assert.equal(reversed.calls[0].args.p_operation_id,'20');
 const stale=await request('applySurplus',{}, {code:'40001',details:'SAVINGS_PREVIEW_STALE',message:'נתוני ההעברה השתנו'});assert.equal(stale.res.statusCode,409);assert.equal(stale.res.body.code,'SAVINGS_PREVIEW_STALE');assert.equal(stale.res.body.error,'נתוני ההעברה השתנו');
});
