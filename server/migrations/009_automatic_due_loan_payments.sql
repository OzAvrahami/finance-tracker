-- Migration 009: automatically record one loan installment when it becomes due.
-- Future installments remain outside the cash transaction ledger.

BEGIN;

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS auto_payment_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.loan_payments
  DROP CONSTRAINT IF EXISTS loan_payments_source_kind_check;

ALTER TABLE public.loan_payments
  ADD CONSTRAINT loan_payments_source_kind_check
  CHECK (source_kind IN ('existing_transaction', 'reconstructed', 'manual', 'generated'));

-- Keep the migration-008 summary semantics and additionally clear a completed
-- loan's due date. This also handles a manually recorded final installment.
CREATE OR REPLACE FUNCTION public.refresh_loan_summary(p_loan_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_loan public.loans%ROWTYPE;
  v_payment_count BIGINT := 0;
  v_paid_principal NUMERIC := 0;
  v_cash_total NUMERIC := 0;
  v_balance NUMERIC := 0;
  v_remaining INTEGER := 0;
BEGIN
  IF p_loan_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_loan
  FROM public.loans
  WHERE id = p_loan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_loan.calculation_mode = 'loan_payments' THEN
    SELECT
      count(*),
      coalesce(sum(principal_amount), 0)
    INTO v_payment_count, v_paid_principal
    FROM public.loan_payments
    WHERE loan_id = p_loan_id;

    v_balance := round(greatest(v_loan.original_amount - v_paid_principal, 0), 2);
    v_remaining := greatest(
      coalesce(v_loan.total_installments, 0) - v_payment_count,
      0
    )::integer;

    UPDATE public.loans
    SET
      current_balance = v_balance,
      remaining_installments = v_remaining,
      next_payment_date = CASE
        WHEN v_balance <= 0.005 THEN NULL
        ELSE next_payment_date
      END,
      status = CASE
        WHEN v_balance <= 0.005 THEN 'paid'
        WHEN v_loan.status = 'defaulted' THEN 'defaulted'
        ELSE 'active'
      END
    WHERE id = p_loan_id;
  ELSE
    SELECT count(*), coalesce(sum(total_amount), 0)
    INTO v_payment_count, v_cash_total
    FROM public.transactions
    WHERE loan_id = p_loan_id;

    UPDATE public.loans
    SET
      current_balance = v_loan.original_amount - v_cash_total,
      remaining_installments = coalesce(v_loan.total_installments, 0) - v_payment_count
    WHERE id = p_loan_id;
  END IF;
END;
$$;

-- The server supplies decimal-safe principal/interest components. This RPC
-- owns the complete ledger + accounting mutation and executes atomically.
CREATE OR REPLACE FUNCTION public.create_due_loan_payment(
  p_loan_id BIGINT,
  p_expected_due_date DATE,
  p_expected_installment_number INTEGER,
  p_payment_amount NUMERIC,
  p_principal_amount NUMERIC,
  p_interest_amount NUMERIC,
  p_annual_interest_rate NUMERIC,
  p_category_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_loan public.loans%ROWTYPE;
  v_existing public.loan_payments%ROWTYPE;
  v_transaction_id BIGINT;
  v_payment_id BIGINT;
  v_paid_count BIGINT := 0;
  v_max_installment INTEGER := 0;
  v_precise_balance NUMERIC(24, 10) := 0;
  v_refreshed_balance NUMERIC := 0;
  v_refreshed_remaining INTEGER := 0;
  v_next_payment_date DATE;
  v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  SELECT *
  INTO v_loan
  FROM public.loans
  WHERE id = p_loan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan % does not exist', p_loan_id;
  END IF;

  IF v_loan.calculation_mode <> 'loan_payments' THEN
    RAISE EXCEPTION 'Loan % is not in loan_payments mode', p_loan_id;
  END IF;
  -- A concurrent/repeated call may arrive after the first call committed.
  -- Return the authoritative existing row instead of inserting a duplicate.
  SELECT *
  INTO v_existing
  FROM public.loan_payments
  WHERE loan_id = p_loan_id
    AND installment_number = p_expected_installment_number
  FOR UPDATE;

  IF FOUND THEN
    SELECT count(*), coalesce(max(installment_number), 0)
    INTO v_paid_count, v_max_installment
    FROM public.loan_payments
    WHERE loan_id = p_loan_id;

    IF v_max_installment <> v_paid_count
      OR v_existing.installment_number <> v_paid_count THEN
      RAISE EXCEPTION 'Loan % existing installment is not the latest accounting row', p_loan_id;
    END IF;
    IF p_expected_due_date > v_today THEN
      RAISE EXCEPTION 'Loan % is not due on Jerusalem business date %', p_loan_id, v_today;
    END IF;
    IF v_loan.next_payment_date IS DISTINCT FROM p_expected_due_date
      AND v_loan.next_payment_date IS DISTINCT FROM
        (p_expected_due_date + INTERVAL '1 month')::date
      AND v_loan.next_payment_date IS NOT NULL THEN
      RAISE EXCEPTION 'Loan % due date no longer matches the processed installment', p_loan_id;
    END IF;

    IF v_loan.next_payment_date = p_expected_due_date THEN
      IF NOT v_loan.auto_payment_enabled OR v_loan.status <> 'active' THEN
        RAISE EXCEPTION 'Loan % is not eligible for automatic payment', p_loan_id;
      END IF;
      UPDATE public.loans
      SET next_payment_date = CASE
        WHEN current_balance <= 0.005 OR remaining_installments <= 0 THEN NULL
        ELSE (p_expected_due_date + INTERVAL '1 month')::date
      END
      WHERE id = p_loan_id
      RETURNING next_payment_date INTO v_next_payment_date;
    ELSE
      v_next_payment_date := v_loan.next_payment_date;
    END IF;

    RETURN jsonb_build_object(
      'status', 'already_processed',
      'loan_id', p_loan_id,
      'transaction_id', v_existing.transaction_id,
      'loan_payment_id', v_existing.id,
      'installment_number', v_existing.installment_number,
      'next_payment_date', v_next_payment_date
    );
  END IF;

  IF NOT v_loan.auto_payment_enabled THEN
    RAISE EXCEPTION 'Automatic payment is disabled for loan %', p_loan_id;
  END IF;
  IF v_loan.status <> 'active' THEN
    RAISE EXCEPTION 'Loan % is not active', p_loan_id;
  END IF;

  IF v_loan.remaining_installments IS NULL OR v_loan.remaining_installments <= 0 THEN
    RAISE EXCEPTION 'Loan % has no remaining installments', p_loan_id;
  END IF;
  IF v_loan.next_payment_date IS NULL
    OR v_loan.next_payment_date <> p_expected_due_date THEN
    RAISE EXCEPTION 'Loan % due date changed from expected %',
      p_loan_id, p_expected_due_date;
  END IF;
  IF p_expected_due_date > v_today THEN
    RAISE EXCEPTION 'Loan % is not due on Jerusalem business date %', p_loan_id, v_today;
  END IF;
  IF v_loan.payment_source_id IS NULL THEN
    RAISE EXCEPTION 'Loan % has no payment source', p_loan_id;
  END IF;
  IF v_loan.total_installments IS NULL OR v_loan.total_installments <= 0 THEN
    RAISE EXCEPTION 'Loan % has invalid total installments', p_loan_id;
  END IF;
  IF v_loan.monthly_payment IS NULL OR v_loan.monthly_payment <= 0 THEN
    RAISE EXCEPTION 'Loan % has invalid monthly payment', p_loan_id;
  END IF;
  IF v_loan.interest_rate IS NULL OR v_loan.interest_rate < 0 THEN
    RAISE EXCEPTION 'Loan % has invalid interest rate', p_loan_id;
  END IF;
  IF p_annual_interest_rate IS NULL
    OR abs(p_annual_interest_rate - v_loan.interest_rate) > 0.000001 THEN
    RAISE EXCEPTION 'Loan % interest rate changed during processing', p_loan_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = p_category_id
      AND type = 'expense'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Loan payment category % is not an active expense category', p_category_id;
  END IF;

  SELECT
    count(*),
    coalesce(max(installment_number), 0),
    round(greatest(v_loan.original_amount - coalesce(sum(principal_amount), 0), 0), 10)
  INTO v_paid_count, v_max_installment, v_precise_balance
  FROM public.loan_payments
  WHERE loan_id = p_loan_id;

  IF v_max_installment <> v_paid_count THEN
    RAISE EXCEPTION 'Loan % payment installments are not contiguous', p_loan_id;
  END IF;
  IF v_loan.remaining_installments
      <> v_loan.total_installments - v_paid_count THEN
    RAISE EXCEPTION 'Loan % remaining-installment summary has drifted', p_loan_id;
  END IF;
  IF p_expected_installment_number <> v_paid_count + 1
    OR p_expected_installment_number > v_loan.total_installments THEN
    RAISE EXCEPTION 'Loan % expected installment % but received %',
      p_loan_id, v_paid_count + 1, p_expected_installment_number;
  END IF;

  IF p_payment_amount IS NULL OR round(p_payment_amount, 2) <= 0
    OR p_payment_amount <> round(p_payment_amount, 2)
    OR p_principal_amount IS NULL OR p_principal_amount < 0
    OR p_interest_amount IS NULL OR p_interest_amount < 0
    OR abs(p_payment_amount - p_principal_amount - p_interest_amount) > 0.00000001 THEN
    RAISE EXCEPTION 'Loan % payment components do not reconcile', p_loan_id;
  END IF;
  IF p_principal_amount > v_precise_balance + 0.00000001 THEN
    RAISE EXCEPTION 'Loan % principal component exceeds outstanding principal', p_loan_id;
  END IF;
  IF p_expected_installment_number < v_loan.total_installments
    AND abs(p_payment_amount - round(v_loan.monthly_payment, 2)) > 0.00000001 THEN
    RAISE EXCEPTION 'Loan % payment amount changed from configured monthly payment', p_loan_id;
  END IF;
  IF p_expected_installment_number = v_loan.total_installments
    AND abs(p_principal_amount - v_precise_balance) > 0.00000001 THEN
    RAISE EXCEPTION 'Loan % final installment does not clear principal', p_loan_id;
  END IF;

  INSERT INTO public.transactions (
    transaction_date,
    charge_date,
    description,
    movement_type,
    total_amount,
    category_id,
    payment_source_id,
    loan_id,
    original_amount,
    currency,
    installments_info,
    installment_number,
    installment_count,
    notes
  ) VALUES (
    p_expected_due_date,
    p_expected_due_date,
    'תשלום הלוואה אוטומטי - ' || v_loan.name,
    'expense',
    p_payment_amount,
    p_category_id,
    v_loan.payment_source_id,
    v_loan.id,
    v_loan.original_amount,
    'ILS',
    p_expected_installment_number::text || '/' || v_loan.total_installments::text,
    p_expected_installment_number,
    v_loan.total_installments,
    'Generated automatically when the loan installment became due'
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.loan_payments (
    loan_id,
    transaction_id,
    installment_number,
    payment_date,
    payment_amount,
    principal_amount,
    interest_amount,
    annual_interest_rate,
    source_kind,
    notes
  ) VALUES (
    v_loan.id,
    v_transaction_id,
    p_expected_installment_number,
    p_expected_due_date,
    p_payment_amount,
    p_principal_amount,
    p_interest_amount,
    p_annual_interest_rate,
    'generated',
    'Generated automatically from loans.next_payment_date'
  )
  RETURNING id INTO v_payment_id;

  SELECT current_balance, remaining_installments
  INTO v_refreshed_balance, v_refreshed_remaining
  FROM public.loans
  WHERE id = p_loan_id;

  v_next_payment_date := CASE
    WHEN v_refreshed_balance <= 0.005 OR v_refreshed_remaining <= 0 THEN NULL
    ELSE (p_expected_due_date + INTERVAL '1 month')::date
  END;

  UPDATE public.loans
  SET next_payment_date = v_next_payment_date
  WHERE id = p_loan_id;

  RETURN jsonb_build_object(
    'status', 'processed',
    'loan_id', p_loan_id,
    'transaction_id', v_transaction_id,
    'loan_payment_id', v_payment_id,
    'installment_number', p_expected_installment_number,
    'next_payment_date', v_next_payment_date
  );
END;
$$;

-- Refresh remains internal. The new bounded RPC follows migration 008's
-- service-only PostgREST boundary.
REVOKE ALL ON FUNCTION public.refresh_loan_summary(BIGINT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_due_loan_payment(
  BIGINT, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BIGINT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_due_loan_payment(
  BIGINT, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BIGINT
) TO service_role;

COMMIT;
