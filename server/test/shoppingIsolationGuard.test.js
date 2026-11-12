'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createIsolatedDatabase}=require('./helpers/shoppingIsolatedDatabase');

test('disposable database helper refuses a missing or incorrect opt-in before Docker/database access',async()=>{
 const before=process.env.SHOPPING_ISOLATED_TEST;
 try {
  delete process.env.SHOPPING_ISOLATED_TEST;
  await assert.rejects(createIsolatedDatabase(),/Explicit isolated-test guard required/);
  process.env.SHOPPING_ISOLATED_TEST='production';
  await assert.rejects(createIsolatedDatabase(),/Explicit isolated-test guard required/);
 } finally {
  if(before===undefined)delete process.env.SHOPPING_ISOLATED_TEST;else process.env.SHOPPING_ISOLATED_TEST=before;
 }
});
