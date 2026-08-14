const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  calculateOutstandingPrincipal,
  summarizeLoanPayments,
} = require('../utils/loanAmortization');

const migration = fs.readFileSync(path.join(
  __dirname,
  '..',
  'migrations',
  '012_irregular_loan_payment_accounting.sql',
), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'full_schema.sql'), 'utf8');

test('Migration 012 defines reusable irregular payment shapes', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /installments_covered\s+INTEGER(?: NOT NULL DEFAULT 1)?/);
    assert.match(sql, /'installment', 'catch_up', (?:'irregular_payment', )?'balance_adjustment', 'early_payoff'/);
    assert.match(sql, /payment_kind = 'installment'[\s\S]*installments_covered = 1/);
    assert.match(sql, /payment_kind = 'catch_up'[\s\S]*installment_number IS NULL[\s\S]*installments_covered >= 1/);
    assert.match(sql, /payment_kind IN \((?:'irregular_payment', )?'balance_adjustment', 'early_payoff'\)[\s\S]*installments_covered = 0/);
    assert.match(sql, /loan_payments_balance_adjustment_shape_check/);
    assert.match(sql, /transaction_id IS NULL[\s\S]*payment_amount = 0[\s\S]*principal_amount = 0[\s\S]*interest_amount = 0[\s\S]*other_amount = 0/);
  }
  assert.doesNotMatch(
    migration.match(/loan_payments_balance_adjustment_shape_check[\s\S]*?\n\s*\);/)?.[0] || '',
    /balance_adjustment_amount\s*[=<>]/,
  );
});

test('summary counts installment and catch-up coverage but not accounting-only events', () => {
  const payments = [
    {
      paymentKind: 'catch_up', installmentsCovered: 3,
      principalAmount: '0', balanceAdjustmentAmount: '0',
    },
    {
      paymentKind: 'installment', installmentsCovered: 1,
      principalAmount: '0', balanceAdjustmentAmount: '0',
    },
    {
      paymentKind: 'catch_up', installmentsCovered: 2,
      principalAmount: '0', balanceAdjustmentAmount: '0',
    },
    {
      paymentKind: 'installment', installmentsCovered: 1,
      principalAmount: '0', balanceAdjustmentAmount: '0',
    },
    {
      paymentKind: 'installment', installmentsCovered: 1,
      principalAmount: '0', balanceAdjustmentAmount: '0',
    },
    {
      paymentKind: 'balance_adjustment', installmentsCovered: 0,
      principalAmount: '0', balanceAdjustmentAmount: '842.00',
    },
  ];
  assert.deepEqual(summarizeLoanPayments({
    originalAmount: '21000.00', totalInstallments: 71, payments,
  }), {
    currentBalance: '20158.00',
    remainingInstallments: 63,
  });
});

test('signed provider balance adjustments change principal without being cash', () => {
  assert.equal(calculateOutstandingPrincipal({
    originalAmount: '21000.00',
    payments: [{ principalAmount: '0', balanceAdjustmentAmount: '842.00' }],
  }), '20158.0000000000');
  assert.equal(calculateOutstandingPrincipal({
    originalAmount: '20158.00',
    payments: [{ principalAmount: '0', balanceAdjustmentAmount: '-100.00' }],
  }), '20258.0000000000');
});

test('Phoenix-style early payoff closes after eight covered obligations, not nine', () => {
  const payments = [
    { paymentKind: 'catch_up', installmentsCovered: 3, principalAmount: '0', balanceAdjustmentAmount: '0' },
    { paymentKind: 'installment', installmentsCovered: 1, principalAmount: '0', balanceAdjustmentAmount: '0' },
    { paymentKind: 'catch_up', installmentsCovered: 2, principalAmount: '0', balanceAdjustmentAmount: '0' },
    { paymentKind: 'installment', installmentsCovered: 1, principalAmount: '0', balanceAdjustmentAmount: '0' },
    { paymentKind: 'installment', installmentsCovered: 1, principalAmount: '0', balanceAdjustmentAmount: '0' },
    { paymentKind: 'balance_adjustment', installmentsCovered: 0, principalAmount: '0', balanceAdjustmentAmount: '842' },
    { paymentKind: 'early_payoff', installmentsCovered: 0, principalAmount: '20158', balanceAdjustmentAmount: '0' },
  ];
  assert.deepEqual(summarizeLoanPayments({
    originalAmount: '21000', totalInstallments: 71, payments,
  }), { currentBalance: '0.00', remainingInstallments: 0 });
  assert.equal(payments
    .filter((row) => ['installment', 'catch_up'].includes(row.paymentKind))
    .reduce((sum, row) => sum + row.installmentsCovered, 0), 8);
});

test('summary and scheduler SQL use covered obligations and generated rows cover one', () => {
  assert.match(migration, /sum\(installments_covered\) FILTER \([\s\S]*payment_kind IN \('installment', 'catch_up'\)/);
  assert.match(migration, /'installment', 1, 0, 0/);
  assert.match(migration, /payment_kind = 'installment',[\s\S]*installments_covered = 1/);
  assert.match(migration, /WHEN v_balance <= 0\.005 THEN false/);
  assert.match(migration, /WHEN v_balance <= 0\.005 THEN 'paid'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.refresh_loan_summary/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_due_loan_payment\([\s\S]*TO service_role/);
});
