const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { summarizeLoanPayments } = require('../utils/loanAmortization');

const migration = fs.readFileSync(path.join(
  __dirname, '..', 'migrations', '014_irregular_loan_payments.sql',
), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'full_schema.sql'), 'utf8');

test('Migration 014 defines positive, non-contractual irregular cash evidence', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /'irregular_payment'/);
    assert.match(sql, /payment_kind IN \('irregular_payment', 'balance_adjustment', 'early_payoff'\)[\s\S]*installment_number IS NULL[\s\S]*installments_covered = 0/);
    assert.match(sql, /loan_payments_irregular_payment_shape_check/);
    assert.match(sql, /payment_kind <> 'irregular_payment'[\s\S]*payment_amount > 0[\s\S]*balance_adjustment_amount = 0/);
  }
});

test('irregular cash does not change principal or contractual installment coverage', () => {
  assert.deepEqual(summarizeLoanPayments({
    originalAmount: '36812.00',
    totalInstallments: 57,
    payments: [
      {
        paymentKind: 'irregular_payment', installmentsCovered: 0,
        principalAmount: '0', balanceAdjustmentAmount: '0',
      },
      {
        paymentKind: 'installment', installmentsCovered: 1,
        principalAmount: '500', balanceAdjustmentAmount: '0',
      },
      {
        paymentKind: 'catch_up', installmentsCovered: 2,
        principalAmount: '1000', balanceAdjustmentAmount: '0',
      },
    ],
  }), {
    currentBalance: '35312.00',
    remainingInstallments: 54,
  });
});

test('Migration 014 does not alter automatic-generation SQL', () => {
  assert.doesNotMatch(migration, /create_due_loan_payment/i);
  assert.doesNotMatch(migration, /source_kind\s*=\s*'generated'/i);
  assert.doesNotMatch(migration, /INSERT INTO public\.transactions/i);
});
