#!/usr/bin/env node
/**
 * Verify effective read access through Supabase's anon PostgREST role.
 *
 * Safety properties:
 *   - Uses only SELECT/HEAD requests and the read-only get_unique_tags RPC.
 *   - Performs no INSERT, UPDATE, DELETE, DDL, or authentication operation.
 *   - Prints only response status/count metadata, never row data or credentials.
 *   - Disables session persistence so a cached authenticated session cannot be used.
 *
 * Usage (from the repository root):
 *   node server/scripts/verify-anon-read-access.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..', '..');
const CLIENT_ENV = path.join(ROOT, 'client', '.env');
const SERVER_ENV = path.join(ROOT, 'server', '.env');

function readEnv(file) {
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '');
        return [key, value];
      })
  );
}

function expectedOutcome(table) {
  return table === 'transactions' ? '0 visible rows or denied' : 'readable';
}

async function main() {
  if (!fs.existsSync(CLIENT_ENV)) {
    throw new Error(`Missing ${path.relative(ROOT, CLIENT_ENV)}`);
  }

  const env = readEnv(CLIENT_ENV);
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('client/.env must define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const tables = [
    'transactions',
    'budgets',
    'payment_sources',
    'categories',
    'shopping_lists',
  ];

  console.log('Anon SELECT verification (no row data is printed)\n');

  for (const table of tables) {
    const { count, error, status } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true });

    const result = error
      ? `DENIED/ERROR (${status ?? 'no status'}: ${error.code ?? 'no code'})`
      : `ALLOWED (${status}; visible rows: ${count ?? 'unknown'})`;

    console.log(`  ${table.padEnd(20)} ${result}`);
    console.log(`  ${''.padEnd(20)} expected: ${expectedOutcome(table)}`);
  }

  const { data, error, status } = await supabase.rpc('get_unique_tags');
  const rpcResult = error
    ? `DENIED/ERROR (${status ?? 'no status'}: ${error.code ?? 'no code'})`
    : `ALLOWED (${status}; returned rows: ${Array.isArray(data) ? data.length : 'unknown'})`;

  console.log('\nAnon RPC verification (tag values are not printed)\n');
  console.log(`  get_unique_tags      ${rpcResult}`);

  if (process.argv.includes('--function-diagnostic')) {
    if (!fs.existsSync(SERVER_ENV)) {
      throw new Error(`Missing ${path.relative(ROOT, SERVER_ENV)}`);
    }

    const serverEnv = readEnv(SERVER_ENV);
    const serviceUrl = serverEnv.SUPABASE_URL;
    const serviceKey = serverEnv.SUPABASE_KEY;
    if (!serviceUrl || !serviceKey) {
      throw new Error('server/.env must define SUPABASE_URL and SUPABASE_KEY');
    }

    const serviceClient = createClient(serviceUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });

    const { data: serviceTags, error: serviceRpcError, status: serviceRpcStatus } =
      await serviceClient.rpc('get_unique_tags');

    console.log('\nService-role comparison (counts only; no values are printed)\n');
    console.log(
      serviceRpcError
        ? `  get_unique_tags      DENIED/ERROR (${serviceRpcStatus ?? 'no status'}: ${serviceRpcError.code ?? 'no code'})`
        : `  get_unique_tags      ALLOWED (${serviceRpcStatus}; returned rows: ${Array.isArray(serviceTags) ? serviceTags.length : 'unknown'})`
    );

    for (const table of ['transactions', 'transaction_items']) {
      const { count, error: tagError, status: tagStatus } = await serviceClient
        .from(table)
        .select('id', { count: 'exact', head: true })
        .not('tags', 'is', null)
        .neq('tags', '');

      console.log(
        tagError
          ? `  ${table.padEnd(20)} DENIED/ERROR (${tagStatus ?? 'no status'}: ${tagError.code ?? 'no code'})`
          : `  ${table.padEnd(20)} non-empty tags rows: ${count ?? 'unknown'}`
      );
    }
  }
}

main().catch((error) => {
  console.error(`Verification failed: ${error.message}`);
  process.exitCode = 1;
});
