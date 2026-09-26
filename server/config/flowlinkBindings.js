const config = require('./flowlink');
const ingestion = require('../services/transactionIngestionService');
const decimal = value => {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) config.fail();
  return value;
};
function createCommand(deviceId, body) {
  if (!config.object(body, ['request_id', 'label', 'payment_source_id'])) config.fail();
  return { request: config.uuid(body.request_id), command: { device_id: config.uuid(deviceId),
    label: config.label(body.label), payment_source_id: decimal(body.payment_source_id) } };
}
function updateCommand(bindingId, body) {
  if (!config.object(body, ['request_id', 'expected_revision', 'status', 'label'])
    || !['status', 'label'].some(k => Object.hasOwn(body, k))) config.fail();
  if (Object.hasOwn(body, 'status') && !['active', 'disabled', 'retired'].includes(body.status)) config.fail();
  return { request: config.uuid(body.request_id), command: { binding_id: config.uuid(bindingId),
    expected_revision: decimal(body.expected_revision),
    ...(Object.hasOwn(body, 'status') ? { status: body.status } : {}),
    ...(Object.hasOwn(body, 'label') ? { label: config.label(body.label) } : {}) } };
}
function paymentCursor(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) config.fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) config.fail();
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { config.fail(); }
  if (!config.object(parsed, ['id'])) config.fail();
  return { id: decimal(parsed.id) };
}
function walletRequest(body) {
  if (!config.object(body, ['binding_id', 'amount', 'currency', 'merchant', 'transaction_date', 'idempotency_key'])) config.fail('unsupported_field');
  config.uuid(body.binding_id);config.uuid(body.idempotency_key);
  if (typeof body.amount !== 'string' || !/^(0|[1-9][0-9]{0,27})\.[0-9]{2}$/.test(body.amount) || body.amount === '0.00') config.fail('invalid_accounting_amount');
  if (body.currency !== 'ILS') config.fail('accounting_amount_required');
  if (typeof body.merchant !== 'string' || /\p{Cc}/u.test(body.merchant) || /^attachment(?: \d+)?\.txt$/i.test(body.merchant.trim())) config.fail('invalid_merchant');
  try {
    ingestion.normalizeObservation({ idempotency_key: body.idempotency_key, accounting_amount: body.amount,
      currency: body.currency, merchant: body.merchant, movement_type: 'expense', transaction_date: body.transaction_date });
    if (body.transaction_date == null) config.fail('invalid_date');
  } catch (e) { config.fail(e.reason || 'invalid_date'); }
  return body;
}
module.exports = { decimal, createCommand, updateCommand, paymentCursor, walletRequest };
