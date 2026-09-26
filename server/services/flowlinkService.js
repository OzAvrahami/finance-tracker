const config = require('../config/flowlink');

const errorStatuses = {
  invalid_input: 400, unauthorized: 401, pairing_invalid: 401, owner_required: 403, not_found: 404,
  state_conflict: 409, credential_reused: 409, pairing_consumed: 409, pairing_superseded: 409,
  pairing_unavailable: 410, rate_limited: 429, flowlink_configuration_invalid: 503, flowlink_unavailable: 503,
};
const safeDevice = d => ({ id: d.id, label: d.label, status: d.status, created_at: d.created_at,
  revoked_at: d.revoked_at, credential_revision: d.credential_revision });
function createFlowlinkService(db) {
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
        ingestion_enabled: false }; // FLI-02 mounts no money-write capability, regardless of env.
    },
    async devices(encodedCursor) {
      const d = await rpc('list_flowlink_devices', { p_cursor: config.cursor(encodedCursor) });
      return { devices: d.devices.map(safeDevice), next_cursor: d.next_cursor
        ? Buffer.from(JSON.stringify(d.next_cursor)).toString('base64url') : null };
    },
  };
}
module.exports = { createFlowlinkService, errorStatuses };
