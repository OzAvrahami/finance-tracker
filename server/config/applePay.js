const { createHash, timingSafeEqual } = require('node:crypto');

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const BOUND_CARD_REFERENCE = 'apple-shortcut-selected-card'; // Server protocol alias, not Wallet data.
const fail = () => { throw new Error('apple_configuration_invalid'); };
const keys = (value, allowed) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).every(key => allowed.includes(key));
const safeIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 80
  && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value)
  && !/(?:\d[ -]*){13}/.test(value); // Never accept a full PAN/device account number.
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n;

function authenticate(env, authorization) {
  if (env.APPLE_PAY_INGESTION_ENABLED !== 'true') return 'apple_ingestion_disabled';
  const current = env.APPLE_PAY_TOKEN_SHA256 || '', previous = env.APPLE_PAY_PREVIOUS_TOKEN_SHA256 || '';
  if (!/^[\da-f]{64}$/i.test(current) || (previous && !/^[\da-f]{64}$/i.test(previous))) return 'apple_configuration_invalid';
  const token = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const supplied = createHash('sha256').update(token).digest();
  // Always compare both fixed-length digests. Rotation never changes source identity.
  const currentMatch = timingSafeEqual(supplied, Buffer.from(current, 'hex'));
  const previousMatch = timingSafeEqual(supplied, Buffer.from(previous || '0'.repeat(64), 'hex'));
  return /^ftapy1_[A-Za-z0-9_-]{43}$/.test(token) && (currentMatch | (Boolean(previous) && previousMatch))
    ? null : 'unauthorized';
}

function sourceConfiguration(env) {
  const raw = env.APPLE_PAY_SOURCE_CONFIG || '';
  if (Buffer.byteLength(raw) > 16384) fail();
  let config;
  try { config = JSON.parse(raw); } catch { fail(); }
  if (!keys(config, ['instance_key', 'request_key', 'expected_revision', 'payment_source_id', 'card_mappings', 'time_verified'])
      || typeof config.instance_key !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(config.instance_key || '')
      || !UUID.test(config.request_key || '')
      || (config.expected_revision != null && !id(config.expected_revision))
      || (config.time_verified !== undefined && typeof config.time_verified !== 'boolean')) fail();
  const bound = Object.hasOwn(config, 'payment_source_id');
  if (bound && (!id(config.payment_source_id) || Object.hasOwn(config, 'card_mappings'))) fail();
  const mappings = bound
    ? [{ card_reference: BOUND_CARD_REFERENCE, payment_source_id: config.payment_source_id }]
    : config.card_mappings;
  if (!Array.isArray(mappings) || !mappings.length || mappings.length > 32) fail();
  const seen = new Set();
  for (const mapping of mappings) {
    if (!keys(mapping, ['card_reference', 'payment_source_id']) || !safeIdentity(mapping.card_reference)
        || !id(mapping.payment_source_id) || seen.has(mapping.card_reference)) fail();
    seen.add(mapping.card_reference);
  }
  return {
    bound,
    requestKey: config.request_key,
    command: {
      source_kind: 'apple_pay', instance_key: config.instance_key, is_active: true,
      ...(config.expected_revision ? { expected_revision: config.expected_revision } : {}),
      actor: 'apple_shortcut_configuration',
      configuration: {
        payment_source_ids: [...new Set(mappings.map(m => m.payment_source_id))],
        card_mappings: mappings, time_verified: config.time_verified === true,
        verified_references: [], aliases: [],
      },
    },
  };
}

module.exports = { authenticate, sourceConfiguration, UUID, safeIdentity, keys, id, BOUND_CARD_REFERENCE };
