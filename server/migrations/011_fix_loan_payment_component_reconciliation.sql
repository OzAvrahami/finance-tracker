-- Migration 011: replace the surviving pre-adjustment cash reconciliation
-- constraint with the canonical principal + interest + other cash equation.

BEGIN;

ALTER TABLE public.loan_payments
  DROP CONSTRAINT IF EXISTS loan_payments_components_reconcile,
  DROP CONSTRAINT IF EXISTS loan_payments_cash_reconciliation_check;

ALTER TABLE public.loan_payments
  ADD CONSTRAINT loan_payments_components_reconcile CHECK (
    abs(payment_amount - principal_amount - interest_amount - other_amount)
      <= 0.00000001
  );

COMMIT;
