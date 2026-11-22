'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planCheckout } = require('../modules/shopping/lists/checkoutService');

const row = (id, quantity, price, is_purchased = true) => ({
  id, list_id:'1', catalog_item_id:null, custom_name:'Soap', quantity, price, is_purchased,
});
const facts = {
  db_time:'2026-06-30T21:30:00Z', products:[], receipts:[], confirmed:[],
  items:[row('1','0.5','0.01'), row('2','0.5','0.01'), row('3','1',null), row('4','2','250',false)],
};

test('checklist total rounds once, retains missing prices and uses the Jerusalem purchase day', () => {
  const plan = planCheckout(facts,'1',null);
  assert.equal(plan.total_amount,'0.01');
  assert.equal(plan.purchase_date,'2026-07-01');
  assert.deepEqual(plan.history_items.map(r => r.list_item_id),['1','2','3']);
  assert.equal(plan.history_items[2].price,null);
  const winter = planCheckout({...facts,db_time:'2026-12-01T21:30:00Z'},'1',null);
  assert.equal(winter.purchase_date,'2026-12-01');
});

test('rounding preserves list input precision beyond floating point', () => {
  const checkout = amount => planCheckout({...facts,items:[row('1','9999.999999999999',amount)]},'1',null);
  assert.equal(checkout('99999999.999999509999').total_amount,'999999999999.99');
  assert.equal(checkout('99999999.999999510001').total_amount,'1000000000000.00');
});

test('confirmed history supplies its own date and exact discounted line total in either mode', () => {
  const purchase = {purchase_date:'2020-02-29', items:[
    {quantity:'3',price:null,price_basis:'line_discount',final_total:'4.99'},
    {quantity:'1.5',price:'0.01'},
  ]};
  for (const target of [null,'99']) {
    const plan = planCheckout({...facts,confirmed:[purchase]},'1',target);
    assert.equal(plan.total_amount,'5.01');
    assert.equal(plan.purchase_date,purchase.purchase_date);
    assert.equal(plan.transaction_id,target);
    assert.equal(plan.history_items,null);
  }
  assert.throws(() => planCheckout({...facts,confirmed:[{...purchase,items:[{price:null}]}]},'1',null), /checkout_receipt_price_required/);
});
