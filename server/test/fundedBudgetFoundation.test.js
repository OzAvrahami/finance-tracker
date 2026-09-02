const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const budgetService = require('../services/budgetService');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '017_funded_budget_foundation.sql'),
  'utf8',
);
const recurringMigration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '018_recurring_budget_defaults.sql'),
  'utf8',
);
const carryoverMigration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '019_budget_category_carryover.sql'),
  'utf8',
);
const fullSchema = fs.readFileSync(path.join(__dirname, '..', 'full_schema.sql'), 'utf8');

test('migration 017 and full_schema carry the same funded-budget foundation', () => {
  const marker = '-- Migration 017: funded monthly budget foundation';
  assert.match(migration, new RegExp(marker));
  assert.ok(fullSchema.includes(migration.trim()));
});

test('migration 018 and full_schema carry the same recurring-budget extension', () => {
  const marker = '-- Migration 018: recurring monthly budget defaults';
  assert.match(recurringMigration, new RegExp(marker));
  assert.ok(fullSchema.includes(recurringMigration.trim()));
  assert.match(recurringMigration, /budget_recurring_defaults/i);
  assert.match(recurringMigration, /starting_kind IN \([^)]+recurring_default/is);
  assert.match(recurringMigration, /month_initialization/i);
  assert.match(recurringMigration, /Asia\/Jerusalem/i);
  assert.doesNotMatch(recurringMigration, /source_transaction_id|carryover|monthly_override/i);
});

test('migration 019 and full_schema carry the balanced carryover extension', () => {
  assert.match(carryoverMigration, /Migration 019: balanced category budget carryover/i);
  assert.ok(fullSchema.includes(carryoverMigration.trim()));
  for (const object of [
    'budget_carryover_settings', 'budget_carryover_batches', 'budget_carryover_transfers',
    'get_budget_carryover_preview', 'apply_budget_carryover', 'reverse_budget_carryover',
  ]) assert.match(carryoverMigration, new RegExp(object, 'i'));
  assert.match(carryoverMigration, /'carryover_out'/i);
  assert.match(carryoverMigration, /'carryover_in'/i);
  assert.match(carryoverMigration, /'carryover_transfer'/i);
  assert.match(carryoverMigration, /'carryover_only'/i);
  assert.match(carryoverMigration, /source_raw_actual_spent_snapshot\s+NUMERIC\(18,\s*2\)/i);
  assert.match(carryoverMigration, /source_effective_actual_spent_snapshot\s+NUMERIC\(18,\s*2\)/i);
  assert.match(carryoverMigration, /LOCK TABLE public\.transactions IN SHARE MODE/i);
  assert.match(carryoverMigration, /jsonb_array_elements\(v_preview->'ready_categories'\)/i);
  assert.match(carryoverMigration, /CARRYOVER_PREVIEW_STALE/i);
  assert.doesNotMatch(carryoverMigration, /savings_destination|monthly_override/i);
});

test('migration preflight rejects malformed legacy data instead of normalizing it', () => {
  for (const diagnostic of [
    'unexpected shape',
    'invalid legacy budget month rows',
    'non-canonical calendar month rows',
    'null legacy budget categories',
    'duplicate logical budget rows',
    'invalid legacy budget amounts',
    'legacy budgets reference missing categories',
  ]) {
    assert.match(migration, new RegExp(diagnostic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.budgets/i);
});

test('schema defines canonical months, immutable snapshots, and append-only provenance', () => {
  for (const table of [
    'budget_months', 'budget_operations', 'budget_funding_entries',
    'budget_movements', 'budget_lifecycle_events',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`, 'i'));
  }
  assert.match(migration, /starting_amount\s+NUMERIC\(18,\s*2\)/i);
  assert.match(migration, /starting_kind/i);
  assert.match(migration, /created_by_operation_id/i);
  assert.match(migration, /CREATE TRIGGER budgets_immutable/i);
  assert.match(migration, /CREATE TRIGGER budget_operations_immutable/i);
  assert.match(migration, /CREATE TRIGGER budget_movements_immutable/i);
  assert.match(migration, /CREATE TRIGGER budget_lifecycle_immutable/i);
});

test('funding sources are deliberately bounded and manual labels are required', () => {
  assert.ok(migration.includes("source_kind IN ('manual_available_funds', 'legacy_import')"));
  assert.ok(migration.includes("source_label TEXT NOT NULL CHECK (btrim(source_label) <> '')"));
  assert.doesNotMatch(migration, /source_transaction_id/i);
  assert.doesNotMatch(migration, /projected_income|expected_salary/i);
  const runtimeStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.add_manual_budget_funding');
  const runtimeEnd = migration.indexOf('CREATE OR REPLACE FUNCTION', runtimeStart + 40);
  const runtimeFunction = migration.slice(runtimeStart, runtimeEnd);
  assert.match(runtimeFunction, /'manual_available_funds'/i);
  assert.doesNotMatch(runtimeFunction, /'legacy_import'/i);
});

test('legacy backfill creates one funding assumption per month and active lifecycle per row', () => {
  assert.match(migration, /Legacy budget import assumption; historical real-world funding source is unknown/i);
  assert.match(migration, /INSERT INTO public\.budget_lifecycle_events/i);
  assert.match(migration, /'active'/i);
  assert.match(migration, /Post-backfill reconciliation is part of the migration transaction/i);
  assert.match(migration, /expected one initial active lifecycle event per budget/i);
});

test('read model includes funding, all actuals, categories, deficit, and history', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_funded_budget_month/i);
  for (const key of [
    "'available'", "'total_allocated'", "'active_allocated'", "'inactive_retained_funding'",
    "'unallocated'", "'budgeted'", "'unbudgeted'", "'starting_amount'",
    "'adjustment_total'", "'final_funded'", "'deficit'", "'history'",
  ]) assert.match(migration, new RegExp(key));
  assert.match(migration, /FROM public\.transactions[\s\S]*movement_type = 'expense'/i);
});

test('bounded RPC set is present and narrowly exposed', () => {
  for (const rpc of [
    'add_manual_budget_funding', 'establish_funded_budget', 'set_funded_budget_amount',
    'remove_funded_budget', 'reactivate_funded_budget', 'reverse_funded_budget_operation',
    'copy_funded_budget_month',
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}`, 'i'));
  }
  const grants = migration.slice(migration.lastIndexOf('GRANT EXECUTE ON FUNCTION'));
  for (const rpc of [
    'add_manual_budget_funding', 'establish_funded_budget', 'set_funded_budget_amount',
    'remove_funded_budget', 'reactivate_funded_budget', 'reverse_funded_budget_operation',
    'copy_funded_budget_month',
  ]) assert.match(grants, new RegExp(`public\\.${rpc}`, 'i'));
  const internalRevokes = migration.slice(migration.lastIndexOf('REVOKE ALL ON FUNCTION public.prevent_budget_history_mutation'));
  assert.match(internalRevokes, /public\.budget_assert_reconciled\(BIGINT\)/i);
});

test('removal snapshots actual spending and never deletes the category snapshot', () => {
  const removal = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.remove_funded_budget'),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.reactivate_funded_budget'),
  );
  assert.match(removal, /greatest\(v_state\.final_funded - v_actual, 0\)/i);
  assert.match(removal, /actual_spent_snapshot/i);
  assert.match(removal, /'inactive'/i);
  assert.doesNotMatch(removal, /DELETE/i);
});

test('budget service maps commands to one database RPC each', async () => {
  const calls = [];
  const supabase = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { data: { ok: true }, error: null };
    },
  };
  await budgetService.addManualFunding(supabase, {
    month: '2026-08', amount: '10.00', sourceLabel: 'Confirmed cash', requestKey: 'key-a',
  });
  await budgetService.establishBudget(supabase, {
    month: '2026-08', categoryId: 1, startingAmount: '0.00', requestKey: 'key-b',
  });
  await budgetService.removeBudget(supabase, { budgetId: 5, requestKey: 'key-c' });
  await budgetService.initializeRecurringBudgets(supabase, { month: '2026-08', requestKey: 'key-d' });
  await budgetService.applyCarryover(supabase, {
    destinationMonth: '2026-08', previewFingerprint: 'abc', requestKey: 'key-e',
  });
  assert.deepEqual(calls.map(({ name }) => name), [
    'add_manual_budget_funding', 'establish_funded_budget', 'remove_funded_budget',
    'initialize_budget_recurring_defaults', 'apply_budget_carryover',
  ]);
  assert.equal(calls[0].params.p_source_label, 'Confirmed cash');
  assert.equal(calls[1].params.p_starting_amount, '0.00');
  assert.equal(calls[3].params.p_request_key, 'key-d');
  assert.equal(calls[4].params.p_preview_fingerprint, 'abc');
});

test('compatibility amount is final funded and inactive/no-budget categories are omitted', () => {
  const rows = budgetService.toCompatibilityRows({
    month: '2026-08',
    categories: [
      { budget_id: 1, category_id: 2, lifecycle_state: 'active', starting_amount: '10.00', final_funded: '15.00' },
      { budget_id: 2, category_id: 3, lifecycle_state: 'inactive', final_funded: '5.00' },
      { budget_id: null, category_id: 4, lifecycle_state: 'no_budget', actual_spent: '3.00' },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, '15.00');
  assert.equal(rows[0].starting_amount, '10.00');
});
