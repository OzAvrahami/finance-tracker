// Synthetic, disposable-only charge and its source observation.
function seedImportedExpense(f, reference) {
  f.env.guard();
  const { randomUUID } = require('node:crypto');
  const key = randomUUID();
  const merchant = reference.replaceAll("'", "''");
  return f.sql(`
    WITH source AS (INSERT INTO transaction_ingestion_sources(source_kind,instance_key)
      VALUES('cal','${key}') RETURNING id),
    card AS (INSERT INTO payment_sources(name,method,slug,last4) VALUES('Fixture Card','credit_card','${key}','4242') RETURNING id),
    charge AS (INSERT INTO transactions(description,transaction_date,movement_type,total_amount,payment_source_id,notes)
      SELECT '${merchant}','2026-11-01','expense',15,id,'Original import' FROM card RETURNING *)
    INSERT INTO transaction_source_observations(source_id,idempotency_key,transaction_id,evidence_origin,accepted_payload,
      payload_fingerprint,source_revision,merchant,normalized_merchant,amount_minor,currency_code,amount_basis,movement_type,
      source_transaction_date,payment_source_id,outcome,reason_code)
    SELECT source.id,'${key}',charge.id,'source','{"fixture":true}',repeat('a',64),1,charge.description,lower(charge.description),
      1500,'ILS','accounting','expense',charge.transaction_date,charge.payment_source_id,'created','fixture'
    FROM charge,source RETURNING transaction_id;`);
}

function ledgerSnapshot(f) {
  return f.sql(`SELECT jsonb_build_array(
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t),
    (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM transaction_source_observations o));`);
}

module.exports = { seedImportedExpense, ledgerSnapshot };
