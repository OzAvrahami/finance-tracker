const config = require('../config/flowlink');
const bindings = require('../config/flowlinkBindings');
const ingestion = require('./transactionIngestionService');
const { safeResult } = require('./applePayIngestionService');

const errorStatuses = {
  unsupported_field: 400, invalid_input: 400, stale_revision: 409, request_key_conflict: 409, binding_unavailable: 403,
  invalid_accounting_amount: 422, accounting_amount_required: 422, invalid_merchant: 422, invalid_date: 422,
  flowlink_ingestion_disabled: 503, ingestion_unavailable: 503, unauthorized: 401, pairing_invalid: 401, owner_required: 403, not_found: 404,
  state_conflict: 409, credential_reused: 409, pairing_consumed: 409, pairing_superseded: 409,
  pairing_unavailable: 410, rate_limited: 429, flowlink_configuration_invalid: 503, flowlink_unavailable: 503,
};
const safeDevice = d => ({ id: d.id, label: d.label, status: d.status, created_at: d.created_at,
  revoked_at: d.revoked_at, credential_revision: d.credential_revision });
const safeBinding = b => Object.fromEntries(['id', 'device_id', 'label', 'payment_source_id', 'source_id', 'status',
  'revision', 'created_at', 'updated_at', 'retired_at'].map(k => [k, b[k]]));
const nextCursor = c => c ? Buffer.from(JSON.stringify(c)).toString('base64url') : null;
function createFlowlinkService(db, env = () => process.env) {
  async function rpc(name, args) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let result;
      try { result = await db.rpc(name, args); } catch { config.fail('flowlink_unavailable'); }
      if (result.error) {
        if (attempt === 0 && ['40P01', '40001', '55P03'].includes(result.error.code)) continue;
        config.fail('flowlink_unavailable');
      }
      if (!result.data || typeof result.data !== 'object') config.fail('flowlink_unavailable');
      if (result.data.error) config.fail(Object.hasOwn(errorStatuses, result.data.error.code) ? result.data.error.code : 'flowlink_unavailable');
      return result.data;
    }
  }
  return {
    async paymentSources(cursor) {
      const d = await rpc('list_flowlink_payment_sources', { p_cursor: bindings.paymentCursor(cursor) });
      return { payment_sources: d.payment_sources.map(p => Object.fromEntries(['id', 'name', 'method', 'issuer', 'last4', 'is_active'].map(k => [k, p[k]]))), next_cursor: nextCursor(d.next_cursor) };
    },
    async ownerBindings(id, cursor) {
      const d = await rpc('list_flowlink_owner_bindings', { p_device_id: config.uuid(id), p_cursor: config.cursor(cursor) });
      return { bindings: d.bindings.map(safeBinding), next_cursor: nextCursor(d.next_cursor) };
    },
    async createBinding(ownerId, id, body) {
      const c = bindings.createCommand(id, body);
      const d = await rpc('create_flowlink_binding', { p_owner_id: ownerId, p_request_key: c.request, p_command: c.command });
      return { ...safeBinding(d), replayed: d.replayed === true };
    },
    async updateBinding(ownerId, id, body) {
      const c = bindings.updateCommand(id, body);
      const d = await rpc('update_flowlink_binding', { p_owner_id: ownerId, p_request_key: c.request, p_command: c.command });
      return { ...safeBinding(d), replayed: d.replayed === true };
    },
    async bindings(token) {
      if (!config.credential(token)) config.fail('unauthorized');
      const d = await rpc('list_flowlink_bindings', { p_credential_sha256: config.digest(token) });
      return { bindings: d.bindings.map(b => ({ id: b.id, label: b.label, status: b.status, revision: b.revision, available: b.available === true })) };
    },
    async ingest(token, body) {
      if (!config.credential(token)) config.fail('unauthorized');
      const request = bindings.walletRequest(body);
      let d;
      try { d = await ingestion.ingestFlowlinkObservation(db, config.digest(token), request); }
      catch { config.fail('ingestion_unavailable'); }
      if (d?.error) config.fail(Object.hasOwn(errorStatuses, d.error.code) ? d.error.code : 'ingestion_unavailable');
      // Project APY's existing result. Validation reasons are safe constants from this wrapper.
      const result = safeResult(d);
      if (['invalid_accounting_amount', 'accounting_amount_required', 'invalid_merchant', 'invalid_date'].includes(d.reason_code)) result.body.reason_code = d.reason_code;
      return result;
    },
    async createPairing(ownerId, body) {
      const command = config.pairingCommand(body), pairing = config.newPairing();
      const data = await rpc('create_flowlink_pairing', { p_owner_id: ownerId, p_pairing_id: pairing.id,
        p_secret_sha256: config.digest(pairing.text), p_command: command });
      return { pairing_id: data.pairing_id, pairing_text: pairing.text, expires_at: data.expires_at,
        purpose: data.purpose, device_id: data.device_id };
    },
    async redeem(body) {
      const d = await rpc('redeem_flowlink_pairing', config.redemption(body));
      return { outcome: 'paired', device_id: d.device_id, device_label: d.device_label,
        credential_id: d.credential_id, credential_revision: d.credential_revision, replayed: d.replayed === true };
    },
    async cancel(ownerId, id) {
      const d = await rpc('cancel_flowlink_pairing', { p_owner_id: ownerId, p_pairing_id: config.uuid(id) });
      return { pairing_id: d.pairing_id, status: d.status };
    },
    async revoke(ownerId, id) {
      return safeDevice(await rpc('revoke_flowlink_device', { p_owner_id: ownerId, p_device_id: config.uuid(id) }));
    },
    async device(token) {
      if (!config.credential(token)) config.fail('unauthorized');
      const d = await rpc('get_flowlink_device', { p_credential_sha256: config.digest(token) });
      return { device: { id: d.device.id, label: d.device.label, status: d.device.status },
        credential: { id: d.credential.id, revision: d.credential.revision }, protocol_version: 1,
        ingestion_enabled: env().FLOWLINK_INGESTION_ENABLED === 'true' };
    },
    async devices(encodedCursor) {
      const d = await rpc('list_flowlink_devices', { p_cursor: config.cursor(encodedCursor) });
      return { devices: d.devices.map(safeDevice), next_cursor: d.next_cursor
        ? Buffer.from(JSON.stringify(d.next_cursor)).toString('base64url') : null };
    },
  };
}
module.exports = { createFlowlinkService, errorStatuses };
