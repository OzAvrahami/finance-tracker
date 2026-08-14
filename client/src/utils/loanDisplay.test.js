import { describe, expect, it } from 'vitest';
import { buildLoanPaymentHistory, countRegularLoanPayments } from './loanDisplay';

describe('irregular loan-payment display helpers', () => {
  it('counts contractual coverage from installments and catch-up events only', () => {
    expect(countRegularLoanPayments([
      { payment_kind: 'catch_up', installments_covered: 3 },
      { payment_kind: 'installment', installments_covered: 1 },
      { payment_kind: 'balance_adjustment', installments_covered: 0 },
      { payment_kind: 'early_payoff', installments_covered: 0 },
    ])).toBe(4);
  });

  it('includes signed provider balance adjustments in the running balance', () => {
    const rows = buildLoanPaymentHistory({ original_amount: '21000.00' }, [
      {
        id: 1, payment_date: '2026-04-30', principal_amount: '0',
        balance_adjustment_amount: '842.00', payment_kind: 'balance_adjustment',
      },
      {
        id: 2, payment_date: '2026-05-24', principal_amount: '20158.00',
        balance_adjustment_amount: '0', payment_kind: 'early_payoff',
      },
    ]);
    expect(rows.map((row) => row.running_balance)).toEqual(['20158.00', '0.00']);
  });
});
