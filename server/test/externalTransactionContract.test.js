const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createMockResponse,
  loadControllerWithFake,
} = require('./helpers/fakeSupabase');

function createExternalApiFake({ existingExternalIds = {} } = {}) {
  const state = { insertedRows: [], externalIdLookups: [] };

  return {
    state,
    from(table) {
      assert.equal(table, 'transactions');
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, 'external_id');
              state.externalIdLookups.push(value);
              return {
                maybeSingle: async () => ({
                  data: existingExternalIds[value] ?? null,
                  error: null,
                }),
              };
            },
          };
        },
        insert(row) {
          state.insertedRows.push(row);
          return {
            select() {
              return {
                single: async () => ({
                  data: {
                    id: 701,
                    external_id: row.external_id ?? null,
                    created_at: '2026-08-15T09:00:00Z',
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

function request(overrides = {}) {
  return {
    body: {
      type: 'expense',
      amount: 42.5,
      date: '2026-08-15',
      ...overrides,
    },
  };
}

async function invoke(bodyOverrides = {}, fakeOptions = {}) {
  const fake = createExternalApiFake(fakeOptions);
  const controller = loadControllerWithFake(
    '../../controllers/v1/transactionController',
    fake,
  );
  const res = createMockResponse();
  const originalLog = console.log;
  console.log = () => {};
  try {
    await controller.createTransaction(request(bodyOverrides), res);
  } finally {
    console.log = originalLog;
  }
  return { fake, res };
}

test('external v1 omits the TEXT tags column when tags are absent', async () => {
  const { fake, res } = await invoke();

  assert.equal(res.statusCode, 201);
  assert.equal(fake.state.insertedRows.length, 1);
  assert.equal(Object.hasOwn(fake.state.insertedRows[0], 'tags'), false);
});

test('external v1 omits the TEXT tags column for an empty array', async () => {
  const { fake, res } = await invoke({ tags: [] });

  assert.equal(res.statusCode, 201);
  assert.equal(Object.hasOwn(fake.state.insertedRows[0], 'tags'), false);
});

test('external v1 serializes one tag to the canonical TEXT value', async () => {
  const { fake, res } = await invoke({ tags: ['  groceries  '] });

  assert.equal(res.statusCode, 201);
  assert.equal(fake.state.insertedRows[0].tags, 'groceries');
  assert.equal(Array.isArray(fake.state.insertedRows[0].tags), false);
});

test('external v1 serializes multiple tags as comma-separated TEXT', async () => {
  const { fake, res } = await invoke({ tags: ['groceries', 'weekly', 'cash'] });

  assert.equal(res.statusCode, 201);
  assert.equal(fake.state.insertedRows[0].tags, 'groceries,weekly,cash');
});

test('external v1 dry-run reports the same serialized TEXT without writing', async () => {
  const { fake, res } = await invoke({ tags: ['groceries', 'weekly'], dry_run: true });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dry_run, true);
  assert.equal(res.body.would_insert.tags, 'groceries,weekly');
  assert.equal(fake.state.insertedRows.length, 0);
});

test('external v1 rejects comma-containing tags because TEXT storage has no escaping', async () => {
  const { fake, res } = await invoke({ tags: ['food,weekly'] });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'validation_error');
  assert.equal(fake.state.insertedRows.length, 0);
});

test('external ID persistence and duplicate detection remain unchanged', async (t) => {
  await t.test('persists the supplied external ID', async () => {
    const { fake, res } = await invoke({ external_id: 'pos-2026-001' });

    assert.equal(res.statusCode, 201);
    assert.deepEqual(fake.state.externalIdLookups, ['pos-2026-001']);
    assert.equal(fake.state.insertedRows[0].external_id, 'pos-2026-001');
    assert.equal(res.body.external_id, 'pos-2026-001');
  });

  await t.test('returns 409 without inserting an existing external ID', async () => {
    const { fake, res } = await invoke(
      { external_id: 'pos-2026-duplicate' },
      { existingExternalIds: { 'pos-2026-duplicate': { id: 88 } } },
    );

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'already_exists');
    assert.equal(res.body.id, 88);
    assert.equal(fake.state.insertedRows.length, 0);
  });
});

test('Migration 016 and full_schema canonicalize the external transaction contract', () => {
  const migrationPath = path.join(
    __dirname,
    '..',
    'migrations',
    '016_external_transaction_contract.sql',
  );
  const schemaPath = path.join(__dirname, '..', 'full_schema.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const fullSchema = fs.readFileSync(schemaPath, 'utf8');

  assert.match(
    migration,
    /ALTER TABLE public\.transactions\s+ADD COLUMN IF NOT EXISTS external_id TEXT;/i,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX idx_transactions_external_id\s+ON public\.transactions \(external_id\)\s+WHERE external_id IS NOT NULL;/i,
  );
  assert.match(migration, /FROM pg_catalog\.pg_index i/i);
  assert.match(migration, /exists with an incompatible definition/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_unique_tags\(\)/i);
  assert.match(migration, /string_to_array\(t\.tags, ','\)/i);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.get_unique_tags\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/i,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_unique_tags\(\)\s+TO service_role;/i,
  );

  assert.match(fullSchema, /external_id\s+TEXT,/i);
  assert.match(
    fullSchema,
    /CREATE UNIQUE INDEX idx_transactions_external_id\s+ON transactions \(external_id\)\s+WHERE external_id IS NOT NULL;/i,
  );
  assert.match(fullSchema, /CREATE OR REPLACE FUNCTION public\.get_unique_tags\(\)/i);
  assert.match(fullSchema, /string_to_array\(t\.tags, ','\)/i);
  assert.match(
    fullSchema,
    /REVOKE ALL ON FUNCTION public\.get_unique_tags\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/i,
  );
  assert.match(
    fullSchema,
    /GRANT EXECUTE ON FUNCTION public\.get_unique_tags\(\)\s+TO service_role;/i,
  );
});

test('external v1 does not log complete incoming financial request bodies', () => {
  const controllerPath = path.join(
    __dirname,
    '..',
    'controllers',
    'v1',
    'transactionController.js',
  );
  const controllerSource = fs.readFileSync(controllerPath, 'utf8');

  assert.doesNotMatch(controllerSource, /Incoming transaction body/i);
  assert.doesNotMatch(controllerSource, /JSON\.stringify\(req\.body/);
});
