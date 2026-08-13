const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  calculateFixedSchedule,
  calculateVariableSchedule,
  summarizeLoanPayments,
  summarizeSchedule,
} = require('../utils/loanAmortization');

const migrationPath = path.join(
  __dirname,
  '..',
  'migrations',
  '008_loan_payment_accounting.sql',
);
const schemaPath = path.join(__dirname, '..', 'full_schema.sql');

test('Target B fixed amortization matches CAL after payment 24', () => {
  const rows = calculateFixedSchedule({
    originalAmount: '21900.00',
    paymentAmount: '727.39',
    annualInterestRate: '12.00',
    installments: 24,
  });
  const summary = summarizeSchedule(rows);

  assert.equal(summary.paymentAmount, '17457.3600000000');
  assert.equal(summary.principalAmount, '13713.0300000000');
  assert.equal(summary.interestAmount, '3744.3300000000');
  assert.equal(summary.closingBalance, '8186.97');
});

test('Target C fixed amortization matches CAL after payment 17', () => {
  const rows = calculateFixedSchedule({
    originalAmount: '18000.00',
    paymentAmount: '997.48',
    annualInterestRate: '12.00',
    installments: 17,
  });
  const summary = summarizeSchedule(rows);

  assert.equal(summary.paymentAmount, '16957.1600000000');
  assert.equal(summary.principalAmount, '15066.5200000000');
  assert.equal(summary.interestAmount, '1890.6400000000');
  assert.equal(summary.closingBalance, '2933.48');
});

test('Target A retains sub-cent components and displays 16346.78', () => {
  const rows = calculateVariableSchedule({
    originalAmount: '21000.00',
    periods: [
      { count: 18, paymentAmount: '380.32', annualInterestRate: '12.85' },
      { count: 2, paymentAmount: '378.00', annualInterestRate: '12.60' },
      { count: 4, paymentAmount: '375.75', annualInterestRate: '12.35' },
      { count: 2, paymentAmount: '373.62', annualInterestRate: '12.10' },
    ],
  });
  const cash = summarizeSchedule(rows);
  const summary = summarizeLoanPayments({
    originalAmount: '21000.00',
    totalInstallments: 84,
    payments: rows,
  });

  assert.equal(cash.paymentAmount, '9852.0000000000');
  assert.equal(cash.closingBalance, '16346.7755161592');
  assert.notEqual(cash.closingBalance, '16346.80');
  assert.equal(summary.currentBalance, '16346.78');
  assert.equal(summary.remainingInstallments, 58);
});

test('principal-only summary ignores interest and reverses a deleted payment', () => {
  const payments = [
    { principalAmount: '500.0000000000', interestAmount: '200.0000000000' },
    { principalAmount: '450.0000000000', interestAmount: '250.0000000000' },
  ];
  assert.deepEqual(summarizeLoanPayments({
    originalAmount: '10000', totalInstallments: 10, payments,
  }), { currentBalance: '9050.00', remainingInstallments: 8 });

  assert.deepEqual(summarizeLoanPayments({
    originalAmount: '10000', totalInstallments: 10, payments: payments.slice(0, 1),
  }), { currentBalance: '9500.00', remainingInstallments: 9 });
});

test('migration defines compatibility mode, constraints, and both refresh triggers', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  for (const sql of [migration, schema]) {
    assert.match(sql, /calculation_mode\s+TEXT NOT NULL DEFAULT 'legacy'/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS (?:public\.)?loan_payments/);
    assert.match(sql, /UNIQUE \(transaction_id\)/);
    assert.match(sql, /NUMERIC\(24, 10\)/);
    assert.match(sql, /refresh_loan_summary\(p_loan_id BIGINT\)/);
    assert.match(sql, /on_transaction_change/);
    assert.match(sql, /on_loan_payment_change/);
    assert.match(sql, /create_transaction_with_loan_payment/);
    assert.match(sql, /update_transaction_with_loan_payment/);
    assert.match(sql, /delete_transaction_with_loan_payment/);
  }

  assert.match(migration, /UNIQUE \(loan_id, installment_number\)/);
  assert.match(schema, /CREATE UNIQUE INDEX loan_payments_unique_installment[\s\S]*ON loan_payments \(loan_id, installment_number\)[\s\S]*WHERE payment_kind = 'installment'/);

  assert.match(migration, /v_loan\.calculation_mode = 'loan_payments'/);
  assert.match(migration, /sum\(principal_amount\)/);
  assert.match(migration, /ELSE[\s\S]*sum\(total_amount\)/);
  assert.match(migration, /OLD\.loan_id IS DISTINCT FROM NEW\.loan_id/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /source_kind IN \('existing_transaction', 'reconstructed', 'manual'\)/);
  assert.match(migration, /WHEN v_balance <= 0\.005 THEN 'paid'/);
  assert.doesNotMatch(
    migration,
    /v_remaining = 0\)[\s\S]{0,80}THEN 'paid'/,
  );
  assert.match(migration, /WHEN v_loan\.status = 'defaulted' THEN 'defaulted'/);
  assert.match(
    migration,
    /DELETE FROM public\.loan_payments[\s\S]*DELETE FROM public\.transactions/,
  );
  assert.match(migration, /later\.installment_number > v_existing\.installment_number/);
  assert.match(migration, /Cannot insert or reprice installment/);
  assert.match(migration, /v_existing\.id IS NOT NULL AND NOT v_accounting_change/);
  assert.match(migration, /p_record_loan_payment BOOLEAN DEFAULT true/);
  assert.match(migration, /p_record_loan_payment BOOLEAN DEFAULT NULL/);
  assert.match(migration, /WHEN v_old_transaction\.loan_id = v_new_loan_id[\s\S]*false/);
});

test('application loan creation forces loan_payments while schema default stays legacy', async () => {
  const inserted = [];
  const fake = {
    from(table) {
      assert.equal(table, 'loans');
      return {
        insert(rows) {
          inserted.push(...rows);
          return { select: async () => ({ data: [{ ...rows[0], id: 8 }], error: null }) };
        },
      };
    },
  };
  const { loadControllerWithFake, createMockResponse } = require('./helpers/fakeSupabase');
  const controller = loadControllerWithFake('../../controllers/loanController', fake);
  const res = createMockResponse();

  await controller.createLoan({
    body: {
      name: 'New loan',
      original_amount: 1000,
      current_balance: 1000,
      calculation_mode: 'legacy',
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(inserted[0].calculation_mode, 'loan_payments');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migration, /calculation_mode TEXT NOT NULL DEFAULT 'legacy'/);
  assert.doesNotMatch(migration, /UPDATE public\.loans[\s\S]{0,120}calculation_mode/);
});

test('migration exposes only bounded RPCs and revokes every internal helper role', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const internalHelpers = [
    'refresh_loan_summary\\(BIGINT\\)',
    'recalculate_loan_status\\(\\)',
    'refresh_loan_summary_from_payment\\(\\)',
    'sync_loan_payment_from_transaction\\(BIGINT, BOOLEAN\\)',
  ];
  const serviceRpcs = [
    'create_transaction_with_loan_payment\\(JSONB, BOOLEAN\\)',
    'update_transaction_with_loan_payment\\(BIGINT, JSONB, BOOLEAN\\)',
    'delete_transaction_with_loan_payment\\(BIGINT\\)',
  ];

  for (const sql of [migration, schema]) {
    for (const signature of [...internalHelpers, ...serviceRpcs]) {
      assert.match(
        sql,
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${signature}\\s+` +
          'FROM PUBLIC, anon, authenticated, service_role;',
        ),
      );
    }

    for (const signature of internalHelpers) {
      assert.doesNotMatch(
        sql,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role;`),
      );
    }

    for (const signature of serviceRpcs) {
      assert.match(
        sql,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role;`),
      );
    }
  }

  assert.doesNotMatch(migration, /GRANT EXECUTE ON ALL FUNCTIONS/i);
  assert.equal(
    (migration.match(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/g) || []).length,
    7,
  );
});
