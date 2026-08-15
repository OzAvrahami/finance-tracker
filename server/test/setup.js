// Canonical server tests use fakes/static fixtures and must never require a
// developer's private .env file or live services. Defaults are intentionally
// non-secret and are applied only by test/run-tests.js. Explicitly supplied
// environment values are preserved.
const testDefaults = {
  NODE_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_KEY: 'test-only-supabase-key',
  EXTERNAL_API_KEY: 'test-only-external-api-key',
  LOAN_JOB_SECRET: 'test-only-loan-job-secret',
  REBRICKABLE_API_KEY: 'test-only-rebrickable-key',
  PORT: '5050',
  DOTENV_CONFIG_QUIET: 'true',
};

for (const [name, value] of Object.entries(testDefaults)) {
  if (!process.env[name]) process.env[name] = value;
}
