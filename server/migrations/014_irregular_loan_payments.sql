-- Migration 014: preserve real loan cash when contractual installment allocation is unknown.

BEGIN;

ALTER TABLE public.loan_payments
  DROP CONSTRAINT IF EXISTS loan_payments_payment_kind_check,
  DROP CONSTRAINT IF EXISTS loan_payments_installment_kind_check,
  DROP CONSTRAINT IF EXISTS loan_payments_irregular_payment_shape_check;

ALTER TABLE public.loan_payments
  ADD CONSTRAINT loan_payments_payment_kind_check
    CHECK (payment_kind IN (
      'installment', 'catch_up', 'irregular_payment',
      'balance_adjustment', 'early_payoff'
    )),
  ADD CONSTRAINT loan_payments_installment_kind_check
    CHECK (
      (payment_kind = 'installment'
        AND installment_number IS NOT NULL
        AND installment_number > 0
        AND installments_covered = 1)
      OR (payment_kind = 'catch_up'
        AND installment_number IS NULL
        AND installments_covered >= 1)
      OR (payment_kind IN ('irregular_payment', 'balance_adjustment', 'early_payoff')
        AND installment_number IS NULL
        AND installments_covered = 0)
    ),
  ADD CONSTRAINT loan_payments_irregular_payment_shape_check
    CHECK (
      payment_kind <> 'irregular_payment'
      OR (
        payment_amount > 0
        AND balance_adjustment_amount = 0
      )
    );

-- refresh_loan_summary already counts contractual progress only for
-- installment/catch_up rows. irregular_payment is therefore cash evidence
-- without installment credit or a direct principal effect.

COMMIT;
