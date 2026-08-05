#!/usr/bin/env node
/**
 * Reports the `role` claim of the Supabase keys this project is configured with.
 *
 * Why this exists: migration 003 revokes EXECUTE on the new RPCs from `anon`
 * and `authenticated` and grants it to `service_role` only. That is correct if
 * and only if the Express server actually connects as service_role. The env var
 * is named `SUPABASE_KEY` — generically, with nothing in the code distinguishing
 * one kind of key from another — so this has to be confirmed, not assumed. If it
 * is an anon key, applying the migration breaks every endpoint.
 *
 * Two key formats exist and both are handled:
 *   * Legacy JWT keys (`eyJ...`), where the role is the `role` claim.
 *   * Current opaque keys (`sb_secret_...` / `sb_publishable_...`), which carry
 *     no readable claims — the prefix is the only local evidence of their
 *     privilege level, and it is authoritative for which family the key is in.
 *
 * Safety: for JWTs this decodes ONLY the middle (payload) segment and prints
 * ONLY the `role`, `ref` and expiry claims. For opaque keys it prints ONLY the
 * `sb_<family>_` prefix. It never prints, logs, copies or transmits key
 * material, and it makes no network calls. Signatures are not verified — that
 * is not the question being asked here.
 *
 * Read-only: reads two .env files, writes nothing.
 *
 * Usage:  node server/scripts/check-supabase-key-roles.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const TARGETS = [
  {
    label: 'server SUPABASE_KEY',
    file: path.join(ROOT, 'server', '.env'),
    key: 'SUPABASE_KEY',
    expected: 'service_role',
    why: 'the backend must bypass the RPC revokes',
  },
  {
    label: 'client VITE_SUPABASE_ANON_KEY',
    file: path.join(ROOT, 'client', '.env'),
    key: 'VITE_SUPABASE_ANON_KEY',
    expected: 'anon',
    why: 'this key ships to the browser',
  },
];

/** Minimal .env reader. Deliberately not dotenv: nothing is put into process.env. */
function readEnvValue(file, key) {
  if (!fs.existsSync(file)) return { missing: `no such file: ${path.relative(ROOT, file)}` };

  const line = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trimStart().startsWith(`${key}=`));

  if (!line) return { missing: `${key} not set in ${path.relative(ROOT, file)}` };

  const value = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  return value ? { value } : { missing: `${key} is empty` };
}

/**
 * The Postgres role each opaque key family resolves to.
 *
 * Caveat, and it matters for the grants: a secret key resolves to service_role
 * by default, but Supabase allows a secret key to be bound to a custom role.
 * The prefix proves the family, not the specific role — confirm the effective
 * role in the dashboard (or with PART 3 of docs/audit_003_readonly.sql) before
 * relying on it.
 */
const OPAQUE_PREFIXES = {
  sb_secret_: { role: 'service_role', note: 'secret key — server-side only' },
  sb_publishable_: { role: 'anon', note: 'publishable key — safe to ship to the browser' },
};

/**
 * Identifies a key's role without revealing the key.
 *
 * For a JWT, only the payload segment is touched: the header and signature are
 * never decoded. For an opaque key, only the family prefix is read.
 */
function inspectKey(token) {
  for (const [prefix, meta] of Object.entries(OPAQUE_PREFIXES)) {
    if (token.startsWith(prefix)) {
      return { format: `opaque (${prefix}…)`, role: meta.role, note: meta.note, inferred: true };
    }
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { error: 'unrecognised key format (neither a JWT nor an sb_* key)' };
  }

  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object') return { error: 'payload is not a JSON object' };
    return {
      format: 'legacy JWT',
      role: claims.role ?? '(no role claim)',
      ref: claims.ref,
      exp: claims.exp,
      inferred: false,
    };
  } catch {
    return { error: 'payload is not decodable base64url JSON' };
  }
}

function formatExpiry(exp) {
  if (typeof exp !== 'number') return 'unknown';
  const when = new Date(exp * 1000);
  const expired = when.getTime() < Date.now();
  return `${when.toISOString().slice(0, 10)}${expired ? '  *** EXPIRED ***' : ''}`;
}

let failures = 0;
let inferred = 0;

console.log('Supabase key role check (no key value is printed)\n');

for (const target of TARGETS) {
  const read = readEnvValue(target.file, target.key);
  if (read.missing) {
    console.log(`  ${target.label}`);
    console.log(`    NOT FOUND: ${read.missing}\n`);
    failures += 1;
    continue;
  }

  const info = inspectKey(read.value);
  if (info.error) {
    console.log(`  ${target.label}`);
    console.log(`    UNREADABLE: ${info.error}\n`);
    failures += 1;
    continue;
  }

  const matches = info.role === target.expected;
  if (!matches) failures += 1;
  if (info.inferred) inferred += 1;

  console.log(`  ${target.label}`);
  console.log(`    format   : ${info.format}`);
  console.log(
    `    role     : ${info.role}   ${matches ? 'OK' : `MISMATCH — expected ${target.expected}`}` +
      (info.inferred ? '   (inferred from the key family, not read from a claim)' : '')
  );
  console.log(`    expected : ${target.expected}  (${target.why})`);
  if (info.note) console.log(`    note     : ${info.note}`);
  if (!info.inferred) {
    console.log(`    ref      : ${info.ref ?? '(none)'}`);
    console.log(`    expires  : ${formatExpiry(info.exp)}`);
  }
  console.log('');
}

if (failures > 0) {
  console.log('RESULT: at least one key could not be confirmed.');
  console.log('Do NOT apply migration 003 until the server key resolves to service_role —');
  console.log('the REVOKEs in SECTION 6 would otherwise lock the backend out of its own RPCs.');
  process.exitCode = 1;
} else {
  console.log('RESULT: both keys carry the expected role. The grants in migration 003');
  console.log('SECTION 6 are consistent with the key configuration.');
  if (inferred > 0) {
    console.log('');
    console.log('CAVEAT: the role above was inferred from the sb_* key family, not read');
    console.log('from a signed claim. Supabase permits binding a secret key to a custom');
    console.log('role, so confirm the effective role with PART 3 of');
    console.log('docs/audit_003_readonly.sql before applying the migration.');
  }
}
