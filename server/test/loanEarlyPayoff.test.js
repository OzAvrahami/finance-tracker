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
  '010_loan_early_payoff_accounting.sql',
), 'utf8');
const reconciliationMigration = fs.readFileSync(path.join(
  __dirname,
  '..',
  'migrations',
  '011_fix_loan_payment_component_reconciliation.sql',
), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'full_schema.sql'), 'utf8');

const regularRows = [
  ['111.91', '60.66', '51.25', '0', '0'],
  ['111.91', '61.18', '50.73', '0', '0'],
  ['111.91', '61.70', '50.21', '0', '0'],
  ['111.91', '62.23', '49.68', '0', '0'],
  ['111.91', '62.76', '49.15', '0', '0'],
  ['111.91', '63.30', '48.61', '0', '0'],
  ['111.91', '63.84', '48.07', '0', '0'],
  ['111.91', '64.38', '47.53', '0', '0'],
  ['111.91', '64.93', '46.98', '0', '0'],
  ['111.91', '65.49', '46.42', '0', '0'],
  ['111.91', '66.05', '45.86', '0', '0'],
  ['111.91', '66.61', '45.30', '0', '0'],
  ['111.91', '67.18', '44.73', '0', '0'],
  ['111.91', '67.75', '44.16', '0', '0'],
  ['111.91', '68.33', '43.58', '0', '0'],
  ['111.91', '68.91', '43.00', '0', '0'],
  ['111.91', '69.50', '42.41', '0', '0'],
  ['111.91', '70.10', '41.81', '0', '0'],
  ['111.91', '70.70', '41.21', '0', '0'],
  ['111.34', '71.61', '39.55', '0.18', '7.84'],
  ['111.34', '72.20', '38.96', '0.18', '0'],
  ['110.78', '73.07', '37.33', '0.38', '8.23'],
  ['110.78', '73.66', '36.74', '0.38', '0'],
  ['110.78', '74.26', '36.14', '0.38', '0'],
  ['110.78', '74.87', '35.53', '0.38', '0'],
].map(([payment, principal, interest, other, balanceAdjustment], index) => ({
  installmentNumber: index + 1,
  paymentAmount: payment,
  principalAmount: principal,
  interestAmount: interest,
  otherAmount: other,
  balanceAdjustmentAmount: balanceAdjustment,
  paymentKind: 'installment',
}));

const sumCents = (rows, field) => rows.reduce(
  (total, row) => total + BigInt(Math.round(Number(row[field]) * 100)),
  0n,
);

test('Migration 010 defines installment and early-payoff row shapes safely', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /closed_date\s+DATE/);
    assert.match(sql, /payment_kind\s+TEXT NOT NULL DEFAULT 'installment'/);
    assert.match(sql, /other_amount\s+NUMERIC\(24, 10\) NOT NULL DEFAULT 0/);
    assert.match(sql, /balance_adjustment_amount\s+NUMERIC\(24, 10\) NOT NULL DEFAULT 0/);
    assert.match(sql, /payment_kind = 'installment'[\s\S]*installment_number IS NOT NULL/);
    assert.match(sql, /loan_payments_unique_installment[\s\S]*payment_kind = 'installment'/);
    assert.match(sql, /loan_payments_unique_early_payoff[\s\S]*payment_kind = 'early_payoff'/);
    assert.match(sql, /payment_amount - principal_amount - interest_amount - other_amount/);
  }

  assert.match(migration, /payment_kind IN \('installment', 'early_payoff'\)/);
  assert.match(migration, /payment_kind = 'early_payoff' AND installment_number IS NULL/);
  assert.match(schema, /payment_kind IN \('installment', 'catch_up', 'irregular_payment', 'balance_adjustment', 'early_payoff'\)/);
  assert.match(schema, /payment_kind IN \('irregular_payment', 'balance_adjustment', 'early_payoff'\)[\s\S]*installment_number IS NULL/);

  assert.match(migration, /ALTER COLUMN installment_number DROP NOT NULL/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS loan_payments_loan_id_installment_number_key/);
});

test('provider cash differences reconcile through other_amount without reducing principal', () => {
  assert.equal(sumCents(regularRows, 'paymentAmount'), 279209n);
  assert.equal(sumCents(regularRows, 'principalAmount'), 168527n);
  assert.equal(sumCents(regularRows, 'interestAmount'), 110494n);
  assert.equal(sumCents(regularRows, 'otherAmount'), 188n);

  const withoutOther = calculateOutstandingPrincipal({
    originalAmount: '6000.00',
    payments: [{ principalAmount: '71.61', balanceAdjustmentAmount: '7.84' }],
  });
  const withCashOther = calculateOutstandingPrincipal({
    originalAmount: '6000.00',
    payments: [{
      principalAmount: '71.61', balanceAdjustmentAmount: '7.84', otherAmount: '999.00',
    }],
  });
  assert.equal(withCashOther, withoutOther);
});

test('Migration 011 replaces the stale cash constraint and excludes balance adjustments', () => {
  const toUnits = (value) => {
    const [whole, fraction = ''] = value.split('.');
    return (BigInt(whole) * 100n) + BigInt(`${fraction}00`.slice(0, 2));
  };
  const payment = toUnits('111.34');
  const principal = toUnits('71.61');
  const interest = toUnits('39.55');
  const other = toUnits('0.18');
  const balanceAdjustment = toUnits('7.84');

  assert.equal(payment, principal + interest + other);
  assert.notEqual(payment, principal + interest + other + balanceAdjustment);

  assert.match(reconciliationMigration, /DROP CONSTRAINT IF EXISTS loan_payments_components_reconcile/);
  assert.match(reconciliationMigration, /DROP CONSTRAINT IF EXISTS loan_payments_cash_reconciliation_check/);
  assert.match(reconciliationMigration, /ADD CONSTRAINT loan_payments_components_reconcile CHECK/);
  assert.match(reconciliationMigration, /payment_amount - principal_amount - interest_amount - other_amount/);
  const canonicalConstraint = reconciliationMigration.match(
    /ADD CONSTRAINT loan_payments_components_reconcile CHECK \(([\s\S]*?)\n  \);/,
  )?.[1];
  assert.ok(canonicalConstraint);
  assert.doesNotMatch(canonicalConstraint, /balance_adjustment_amount/);
  assert.match(reconciliationMigration, /<= 0\.00000001/);
  assert.match(schema, /CONSTRAINT loan_payments_components_reconcile CHECK[\s\S]*payment_amount - principal_amount - interest_amount - other_amount/);

  assert.equal(toUnits('90.00'), toUnits('70.00') + toUnits('20.00') + toUnits('0.00'));
});

test('provider balance adjustments reduce principal independently from cash', () => {
  assert.equal(sumCents(regularRows, 'balanceAdjustmentAmount'), 1607n);
  assert.equal(calculateOutstandingPrincipal({
    originalAmount: '4754.40',
    payments: [{ principalAmount: '71.61', balanceAdjustmentAmount: '7.84' }],
  }), '4674.9500000000');
  assert.equal(calculateOutstandingPrincipal({
    originalAmount: '4602.75',
    payments: [{ principalAmount: '73.07', balanceAdjustmentAmount: '8.23' }],
  }), '4521.4500000000');
});

test('25 regular installments plus early payoff closes principal without becoming 26 of 72', () => {
  const payments = [
    ...regularRows,
    {
      installmentNumber: null,
      paymentAmount: '4314.60',
      principalAmount: '4298.66',
      interestAmount: '1.12',
      otherAmount: '14.82',
      balanceAdjustmentAmount: '0',
      paymentKind: 'early_payoff',
    },
  ];
  const summary = summarizeLoanPayments({
    originalAmount: '6000.00',
    totalInstallments: 72,
    payments,
  });

  assert.equal(payments.filter((row) => row.paymentKind === 'installment').length, 25);
  assert.equal(payments.filter((row) => row.paymentKind === 'early_payoff').length, 1);
  assert.deepEqual(summary, { currentBalance: '0.00', remainingInstallments: 0 });
  assert.equal(429866n + 112n + 1482n, 431460n);
});

test('summary SQL closes a paid loan but preserves regular installment history', () => {
  assert.match(migration, /count\(\*\) FILTER \(WHERE payment_kind = 'installment'\)/);
  assert.match(migration, /early payoff does not clear its outstanding principal/);
  assert.match(migration, /original_amount - v_paid_principal - v_balance_adjustment/);
  assert.match(migration, /WHEN v_balance <= 0\.005 THEN false/);
  assert.match(migration, /closed_date = v_closed_date/);
  assert.match(migration, /WHEN v_balance <= 0\.005 THEN 'paid'/);
  assert.match(migration, /WHEN v_loan\.status = 'defaulted' THEN 'defaulted'/);
  assert.match(migration, /IF v_balance <= 0\.005 THEN[\s\S]*v_remaining := 0/);
});

test('normal and generated payment paths explicitly retain zero adjustments', () => {
  assert.match(migration, /'existing_transaction'[\s\S]*'installment', 0, 0/);
  assert.match(migration, /'generated'[\s\S]*'installment', 0, 0/);
  assert.match(migration, /payment_kind = 'installment',[\s\S]*other_amount = 0,[\s\S]*balance_adjustment_amount = 0/);
  assert.match(migration, /has an early payoff and cannot accept another regular installment/);
  assert.match(migration, /ELSE[\s\S]*sum\(total_amount\)/);
});
