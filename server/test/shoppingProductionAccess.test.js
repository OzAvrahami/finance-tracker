'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createProductionAccess,isProductionAccess}=require('../modules/shopping/http/productionAccess');
const env=()=>({SHOPPING_PRODUCTION_MODE:'active',SHOPPING_PRODUCTION_PROJECT:'ohhvzveyreolguztcnqx',SUPABASE_URL:'https://ohhvzveyreolguztcnqx.supabase.co',FLOWLINK_OWNER_USER_IDS:'["11111111-1111-4111-8111-111111111111"]',SHOPPING_HISTORICAL_CATEGORY_IDS:Array.from({length:25},(_,i)=>i+1).join(',')});
test('production capability requires explicit project, owner and history configuration',async()=>{
  for(const field of Object.keys(env()))assert.throws(()=>createProductionAccess({...env(),[field]:''}));
  assert.equal(isProductionAccess({mode:'active'}),false);
  const access=createProductionAccess(env());assert.equal(isProductionAccess(access),true);
  assert.equal(await access.authorize({actor:'11111111-1111-4111-8111-111111111111'}),true);
  assert.equal(await access.authorize({actor:'22222222-2222-4222-8222-222222222222'}),false);
});
