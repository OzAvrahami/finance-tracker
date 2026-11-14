const { test } = require('node:test');
const assert = require('node:assert/strict');
const { manualRow, assertRequest, decideEdit } = require('../services/ingestion/manualRefund');
const { decideIngestion } = require('../services/ingestion/core');
const row = { description:'Owner refund',movement_type:'expense',total_amount:'-557.55',transaction_date:'2026-11-09',
  charge_date:'2026-11-10',currency:'ILS',payment_source_id:7,category_id:100,installment_count:null };
const facts = () => ({ transactions:[{...row,id:'1',total_amount:'557.5500000000000000',bank_movement:null,links:[]}],
  payments:[{id:'7',is_active:true,method:'credit_card'}],categories:[{id:'100',is_active:true,type:'expense',savings_role:null}],
  sources:[{id:'3',is_active:true,source_kind:'manual',instance_key:'unified:manual',configuration:{},revision:'1'}],
  observations:[],events:[],installments:[] });
const scope = () => ({command_kind:'owner_refund_edit',command:{transaction_id:'1',transaction:manualRow(row)}});

test('signed owner amount determines classification, exact cents and null installment semantics',()=>{
  assert.deepEqual(manualRow({...row,bank_movement:'untrusted',installment_count:1,total_amount:'-557.550000'}),{
    ...row,bank_movement:'refund',installment_number:null,installments_info:null,
  });
  assert.equal(manualRow({...row,total_amount:'25',bank_movement:'refund'}).bank_movement,undefined);
  for (const total_amount of ['-0','-0.00','-557.551','-1e2']) assert.throws(()=>manualRow({...row,total_amount}));
  assert.throws(()=>manualRow({...row,movement_type:'income'}));
  assert.throws(()=>assertRequest({transaction:row,items:[{}]}),/היסטוריה מוגנת/);
});

test('ordinary and unmarked negative expenses can be corrected; FX provenance stays exact',()=>{
  for (const amount of ['557.55','-557.55']) {
    const f=facts(); f.transactions[0].total_amount=amount;
    assert.equal(decideEdit(f,scope()).action,'owner_refund_edit');
  }
  const f=facts(); Object.assign(f.transactions[0],{currency:'USD',original_amount:'123.456789',exchange_rate:'3.123456789'});
  const s=scope(); Object.assign(s.command.transaction,{currency:'USD',original_amount:'123.456789',exchange_rate:'3.123456789'});
  assert.deepEqual(decideEdit(f,s).transaction,s.command.transaction);
});

test('protected current facts win even when a refund request omits all links',()=>{
  const protections=[{voided_at:'2026-11-09'}, {loan_id:1}, {parent_transaction_id:1}, {installment_count:3},
    {installment_number:1},{installments_info:'1/3'},{global_discount:'1.00'},{savings_role:'deposit'},{category_id:24},
    ...['item','loan','savings','shopping','lego','child'].map(link=>({links:[link]})),
    {budget_facts:[{operation_type:'month_close'}]},{budget_facts:[{item_kind:'carryover'}]}];
  for(const protection of protections) {
    const f=facts();Object.assign(f.transactions[0],protection);
    assert.throws(()=>decideEdit(f,scope()),/היסטוריה מוגנת/,JSON.stringify(protection));
  }
});

test('unrelated card installments do not block a manual refund; external and ordinary rules stay intact',()=>{
  const f=facts();f.transactions=[];f.installments=[{payment_source_id:'7',idempotency_key:null}];
  const r=manualRow(row), s={channel:'manual',row:r,key:'owner-refund',evidence:row};
  assert.equal(decideIngestion(f,s).outcome,'created');
  const positive={...row,total_amount:'557.55'};
  assert.equal(decideIngestion(f,{...s,row:positive}).reason,'installment_series_review');
});
