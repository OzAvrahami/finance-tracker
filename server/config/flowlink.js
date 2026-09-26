const { createHash, randomBytes, randomUUID } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USER_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const fail = (code = 'invalid_input') => { throw Object.assign(new Error(code), { flowlinkCode: code }); };
const object = (value, fields) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).every(k => fields.includes(k));
const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value; };
const label = value => {
  if (typeof value !== 'string') fail();
  const result = value.trim();
  if (!result || [...result].length > 80 || /[\p{Cc}\p{Cf}]/u.test(result) || /(?:\d[ -]*){13}/.test(result)) fail();
  return result;
};
function owners(env) {
  const raw = env.FLOWLINK_OWNER_USER_IDS;
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 1024) fail('flowlink_configuration_invalid');
  let values;
  try { values = JSON.parse(raw); } catch { fail('flowlink_configuration_invalid'); }
  if (!Array.isArray(values) || !values.length || values.length > 10
      || values.some(v => typeof v !== 'string' || !USER_UUID.test(v)) || new Set(values).size !== values.length) fail('flowlink_configuration_invalid');
  return new Set(values);
}
const digest = text => '\\x' + createHash('sha256').update(text, 'utf8').digest('hex');
const randomSecret = () => randomBytes(32).toString('base64url');
// Canonical encoding prevents alternate textual representations of the same bytes.
const secret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
  && Buffer.from(value, 'base64url').length === 32 && Buffer.from(value, 'base64url').toString('base64url') === value;
const credential = value => typeof value === 'string' && value.startsWith('fldev1_') && secret(value.slice(7));
const bearer = header => typeof header === 'string' && /^Bearer [^\s]+$/.test(header) ? header.slice(7) : null;
const pairingText = (id, value) => `flpair1.${id}.${value}`;
const newPairing = () => { const id = randomUUID(), value = randomSecret();return { id, text: pairingText(id, value) }; };
function pairingCommand(input) {
  if (input?.purpose === 'enroll' && object(input, ['purpose', 'label'])) return { purpose: 'enroll', label: label(input.label) };
  if (input?.purpose === 'replace_credential' && object(input, ['purpose', 'device_id'])) return { purpose: 'replace_credential', device_id: uuid(input.device_id) };
  fail();
}
function redemption(input) {
  if (!object(input, ['pairing_id', 'secret', 'redemption_id', 'device_credential'])
      || !secret(input.secret) || !credential(input.device_credential)) fail();
  return { p_pairing_id: uuid(input.pairing_id), p_redemption_id: uuid(input.redemption_id),
    p_secret_sha256: digest(pairingText(input.pairing_id, input.secret)), p_credential_sha256: digest(input.device_credential) };
}
function cursor(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) fail();
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { fail(); }
  if (!object(parsed, ['created_at', 'id']) || typeof parsed.created_at !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.created_at)
      || !Number.isFinite(Date.parse(parsed.created_at))) fail();
  uuid(parsed.id);return parsed;
}
module.exports = { UUID, USER_UUID, owners, object, uuid, label, fail, digest, secret, credential, bearer,
  newPairing, pairingText, pairingCommand, redemption, cursor };
