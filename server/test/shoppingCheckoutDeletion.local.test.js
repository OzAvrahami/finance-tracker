'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { start } = require('./helpers/refundEnvironment');

function shoppingSnapshot(db, listId) {
  return JSON.parse(db.sql(`
    SELECT jsonb_build_object('list',to_jsonb(l),'checkout',to_jsonb(c),'receipt',to_jsonb(r),
      'history',to_jsonb(h),'plan',to_jsonb(p))
    FROM shopping_lists l
    JOIN shopping_checkouts c ON c.list_id=l.id
    JOIN shopping_confirmed_purchases h ON h.list_id=l.id
    JOIN shopping_receipts r ON r.id=h.receipt_id AND r.list_id=l.id
    JOIN shopping_purchase_plans p ON p.list_id=l.id WHERE l.id=${listId};`));
}

test('normal transaction delete clears only the checkout reference and retains ledger protections', async t => {
  const db = await start({ postgresImage:'postgres:17-alpine' });
  t.after(() => db.stop());
  const migration = file => readFileSync(path.join(__dirname,'../migrations',file),'utf8');
  const identity = 'shopping102-' + randomUUID();
  db.sql(`COMMENT ON DATABASE postgres IS '${identity}';`);
  for (const file of ['060_shopping_hierarchy_persistence.sql','061_shopping_category_contract.sql',
    '062_shopping_administration_contract.sql','063_shopping_workflow_persistence.sql']) {
    db.sql(`SET shopping.isolated_migration='${identity}';` + migration(file));
  }

  const type = db.sql("INSERT INTO shopping_list_types(name,slug) VALUES('Test','delete-test') RETURNING id;");
  function priorCheckout() {
    const list = db.sql(`INSERT INTO shopping_lists(title,list_type_id) VALUES('Test receipt',${type}) RETURNING id;`);
    db.sql(`WITH receipt AS (
      INSERT INTO shopping_receipts(list_id,image_hash,image_hashes,state,confirmed)
      VALUES(${list},repeat(md5('${list}'),2),ARRAY[repeat(md5('${list}'),2)],'confirmed','{"store":"Test"}') RETURNING id
    ) INSERT INTO shopping_confirmed_purchases(list_id,purchase_date,items,basis,receipt_id)
      SELECT ${list},'2026-11-01','[{"name":"Soap","quantity":"2","price":"7.25"}]','receipt',id FROM receipt;`);
    const transaction = db.sql(`SELECT shopping_private.checkout_financial(${list},100,14,'[]','[]')->>'transaction_id';`);
    return { list, transaction };
  }
  const ordinary = priorCheckout();
  const imported = priorCheckout();
  db.sql(`WITH source AS (
    INSERT INTO transaction_ingestion_sources(source_kind,instance_key) VALUES('cal','test-delete') RETURNING id
  ) INSERT INTO transaction_source_observations(source_id,idempotency_key,transaction_id,evidence_origin,
    accepted_payload,payload_fingerprint,source_revision,merchant,normalized_merchant,amount_minor,currency_code,
    amount_basis,movement_type,source_transaction_date,payment_source_id,outcome,reason_code)
    SELECT id,'test-charge',${imported.transaction},'source','{}',repeat('a',64),1,'Test','test',1450,'ILS',
      'accounting','expense','2026-11-01',14,'reconciled','owner_link' FROM source;`);
  const before = shoppingSnapshot(db,ordinary.list);
  const protectedBefore = shoppingSnapshot(db,imported.list);
  assert.equal(before.list.status,'checked_out');
  assert.equal(before.receipt.state,'confirmed');
  assert.equal(before.history.basis,'receipt');
  assert.equal(String(before.checkout.transaction_id),ordinary.transaction);
  db.sql(migration('065_shopping_checkout_links.sql'));

  const ledger = () => db.sql(`SELECT jsonb_build_array(to_jsonb(t),to_jsonb(o))
    FROM transactions t JOIN transaction_source_observations o ON o.transaction_id=t.id WHERE t.id=${imported.transaction};`);
  const protectedLedger = ledger();
  const denied = await db.api('/transactions/'+imported.transaction,undefined,'DELETE');
  assert.equal(denied.status,400);
  assert.match(denied.body.error,/protected_transaction/);
  assert.equal(ledger(),protectedLedger);
  assert.deepEqual(shoppingSnapshot(db,imported.list),protectedBefore);

  const removed = await db.api('/transactions/'+ordinary.transaction,undefined,'DELETE');
  assert.equal(removed.status,200,JSON.stringify(removed.body));
  assert.equal(db.sql(`SELECT count(*) FROM transactions WHERE id=${ordinary.transaction};`),'0');
  assert.deepEqual(shoppingSnapshot(db,ordinary.list),{
    ...before, checkout:{ ...before.checkout, transaction_id:null },
  });
  assert.deepEqual(shoppingSnapshot(db,imported.list),protectedBefore);
});
