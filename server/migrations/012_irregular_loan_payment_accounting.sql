-- Migration 012: irregular/catch-up loan payments and provider balance snapshots.
-- Real cash remains in transactions. Non-cash provider reconciliation remains
-- explicit in loan_payments.balance_adjustment_amount.

BEGIN;

ALTER TABLE public.loan_payments
  ADD COLUMN IF NOT EXISTS installments_covered INTEGER;

-- Migration 010 predates this column. Preserve the historical meaning of its
-- rows: normal installments cover one obligation; early payoff covers none.
UPDATE public.loan_payments
SET installments_covered = CASE
  WHEN payment_kind = 'installment' THEN 1
  ELSE 0
END
WHERE installments_covered IS NULL;

ALTER TABLE public.loan_payments
  ALTER COLUMN installments_covered SET DEFAULT 1,
  ALTER COLUMN installments_covered SET NOT NULL;

ALTER TABLE public.loan_payments
  DROP CONSTRAINT IF EXISTS loan_payments_payment_kind_check,
  DROP CONSTRAINT IF EXISTS loan_payments_installment_kind_check,
  DROP CONSTRAINT IF EXISTS loan_payments_balance_adjustment_shape_check;

ALTER TABLE public.loan_payments
  ADD CONSTRAINT loan_payments_payment_kind_check
    CHECK (payment_kind IN (
      'installment', 'catch_up', 'balance_adjustment', 'early_payoff'
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
      OR (payment_kind IN ('balance_adjustment', 'early_payoff')
        AND installment_number IS NULL
        AND installments_covered = 0)
    ),
  ADD CONSTRAINT loan_payments_balance_adjustment_shape_check
    CHECK (
      payment_kind <> 'balance_adjustment'
      OR (
        transaction_id IS NULL
        AND payment_amount = 0
        AND principal_amount = 0
        AND interest_amount = 0
        AND other_amount = 0
      )
    );

CREATE OR REPLACE FUNCTION public.refresh_loan_summary(p_loan_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_loan public.loans%ROWTYPE;
  v_installments_covered BIGINT := 0;
  v_early_payoff_count BIGINT := 0;
  v_paid_principal NUMERIC := 0;
  v_balance_adjustment NUMERIC := 0;
  v_cash_total NUMERIC := 0;
  v_balance NUMERIC := 0;
  v_remaining INTEGER := 0;
  v_closed_date DATE;
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
      coalesce(sum(installments_covered) FILTER (
        WHERE payment_kind IN ('installment', 'catch_up')
      ), 0),
      count(*) FILTER (WHERE payment_kind = 'early_payoff'),
      coalesce(sum(principal_amount), 0),
      coalesce(sum(balance_adjustment_amount), 0)
    INTO v_installments_covered, v_early_payoff_count,
      v_paid_principal, v_balance_adjustment
    FROM public.loan_payments
    WHERE loan_id = p_loan_id;

    IF v_installments_covered > coalesce(v_loan.total_installments, 0) THEN
      RAISE EXCEPTION 'Loan % payment coverage exceeds total installments', p_loan_id;
    END IF;

    v_balance := round(greatest(
      v_loan.original_amount - v_paid_principal - v_balance_adjustment,
      0
    ), 2);

    IF v_early_payoff_count > 0 AND v_balance > 0.005 THEN
      RAISE EXCEPTION 'Loan % early payoff does not clear its outstanding principal',
        p_loan_id;
    END IF;

    IF v_balance <= 0.005 THEN
      SELECT payment_date
      INTO v_closed_date
      FROM public.loan_payments
      WHERE loan_id = p_loan_id
      ORDER BY
        CASE WHEN payment_kind = 'early_payoff' THEN 0 ELSE 1 END,
        payment_date DESC,
        id DESC
      LIMIT 1;
      v_remaining := 0;
    ELSE
      v_closed_date := NULL;
      v_remaining := greatest(
        coalesce(v_loan.total_installments, 0) - v_installments_covered,
        0
      )::integer;
    END IF;

    UPDATE public.loans
    SET
      current_balance = CASE WHEN v_balance <= 0.005 THEN 0 ELSE v_balance END,
      remaining_installments = v_remaining,
      next_payment_date = CASE
        WHEN v_balance <= 0.005 THEN NULL
        ELSE next_payment_date
      END,
      auto_payment_enabled = CASE
        WHEN v_balance <= 0.005 THEN false
        ELSE auto_payment_enabled
      END,
      closed_date = v_closed_date,
      status = CASE
        WHEN v_balance <= 0.005 THEN 'paid'
        WHEN v_loan.status = 'defaulted' THEN 'defaulted'
        ELSE 'active'
      END
    WHERE id = p_loan_id;
  ELSE
    SELECT count(*), coalesce(sum(total_amount), 0)
    INTO v_installments_covered, v_cash_total
    FROM public.transactions
    WHERE loan_id = p_loan_id;

    UPDATE public.loans
    SET
      current_balance = v_loan.original_amount - v_cash_total,
      remaining_installments = coalesce(v_loan.total_installments, 0)
        - v_installments_covered
    WHERE id = p_loan_id;
  END IF;
END;
$$;

-- The automatic processor creates exactly one normal installment. Contractual
-- progress comes from installment + catch-up coverage, never from adjustment
-- or payoff event counts.
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
  v_covered_count BIGINT := 0;
  v_precise_balance NUMERIC(24, 10) := 0;
  v_refreshed_balance NUMERIC := 0;
  v_refreshed_remaining INTEGER := 0;
  v_next_payment_date DATE;
  v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  SELECT * INTO v_loan FROM public.loans
  WHERE id = p_loan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan % does not exist', p_loan_id; END IF;
  IF v_loan.calculation_mode <> 'loan_payments' THEN
    RAISE EXCEPTION 'Loan % is not in loan_payments mode', p_loan_id;
  END IF;

  SELECT * INTO v_existing FROM public.loan_payments
  WHERE loan_id = p_loan_id
    AND payment_kind = 'installment'
    AND installment_number = p_expected_installment_number
  FOR UPDATE;
  IF FOUND THEN
    SELECT coalesce(sum(installments_covered), 0)
    INTO v_covered_count
    FROM public.loan_payments
    WHERE loan_id = p_loan_id
      AND payment_kind IN ('installment', 'catch_up');
    IF v_existing.installment_number <> v_covered_count THEN
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
      UPDATE public.loans SET next_payment_date = CASE
        WHEN current_balance <= 0.005 OR remaining_installments <= 0 THEN NULL
        ELSE (p_expected_due_date + INTERVAL '1 month')::date
      END WHERE id = p_loan_id RETURNING next_payment_date INTO v_next_payment_date;
    ELSE
      v_next_payment_date := v_loan.next_payment_date;
    END IF;
    RETURN jsonb_build_object(
      'status', 'already_processed', 'loan_id', p_loan_id,
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
  IF v_loan.next_payment_date IS NULL OR v_loan.next_payment_date <> p_expected_due_date THEN
    RAISE EXCEPTION 'Loan % due date changed from expected %', p_loan_id, p_expected_due_date;
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
  IF NOT EXISTS (SELECT 1 FROM public.categories
    WHERE id = p_category_id AND type = 'expense' AND is_active = true) THEN
    RAISE EXCEPTION 'Loan payment category % is not an active expense category', p_category_id;
  END IF;

  SELECT
    coalesce(sum(installments_covered) FILTER (
      WHERE payment_kind IN ('installment', 'catch_up')
    ), 0),
    round(greatest(
      v_loan.original_amount
        - coalesce(sum(principal_amount), 0)
        - coalesce(sum(balance_adjustment_amount), 0),
      0
    ), 10)
  INTO v_covered_count, v_precise_balance
  FROM public.loan_payments
  WHERE loan_id = p_loan_id;

  IF v_covered_count > v_loan.total_installments THEN
    RAISE EXCEPTION 'Loan % payment coverage exceeds total installments', p_loan_id;
  END IF;
  IF v_loan.remaining_installments <> v_loan.total_installments - v_covered_count THEN
    RAISE EXCEPTION 'Loan % remaining-installment summary has drifted', p_loan_id;
  END IF;
  IF p_expected_installment_number <> v_covered_count + 1
    OR p_expected_installment_number > v_loan.total_installments THEN
    RAISE EXCEPTION 'Loan % expected installment % but received %',
      p_loan_id, v_covered_count + 1, p_expected_installment_number;
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
    transaction_date, charge_date, description, movement_type, total_amount,
    category_id, payment_source_id, loan_id, original_amount, currency,
    installments_info, installment_number, installment_count, notes
  ) VALUES (
    p_expected_due_date, p_expected_due_date,
    'תשלום הלוואה אוטומטי - ' || v_loan.name, 'expense', p_payment_amount,
    p_category_id, v_loan.payment_source_id, v_loan.id, v_loan.original_amount, 'ILS',
    p_expected_installment_number::text || '/' || v_loan.total_installments::text,
    p_expected_installment_number, v_loan.total_installments,
    'Generated automatically when the loan installment became due'
  ) RETURNING id INTO v_transaction_id;

  INSERT INTO public.loan_payments (
    loan_id, transaction_id, installment_number, payment_date, payment_amount,
    principal_amount, interest_amount, annual_interest_rate, source_kind, notes,
    payment_kind, installments_covered, other_amount, balance_adjustment_amount
  ) VALUES (
    v_loan.id, v_transaction_id, p_expected_installment_number,
    p_expected_due_date, p_payment_amount, p_principal_amount, p_interest_amount,
    p_annual_interest_rate, 'generated',
    'Generated automatically from loans.next_payment_date',
    'installment', 1, 0, 0
  ) RETURNING id INTO v_payment_id;

  SELECT current_balance, remaining_installments
  INTO v_refreshed_balance, v_refreshed_remaining
  FROM public.loans WHERE id = p_loan_id;
  v_next_payment_date := CASE
    WHEN v_refreshed_balance <= 0.005 OR v_refreshed_remaining <= 0 THEN NULL
    ELSE (p_expected_due_date + INTERVAL '1 month')::date
  END;
  UPDATE public.loans SET next_payment_date = v_next_payment_date WHERE id = p_loan_id;
  RETURN jsonb_build_object(
    'status', 'processed', 'loan_id', p_loan_id,
    'transaction_id', v_transaction_id, 'loan_payment_id', v_payment_id,
    'installment_number', p_expected_installment_number,
    'next_payment_date', v_next_payment_date
  );
END;
$$;

-- Normal transaction synchronization still creates one ordinary installment.
-- Catch-up rows are explicit accounting events and are never manufactured here.
CREATE OR REPLACE FUNCTION public.sync_loan_payment_from_transaction(
  p_transaction_id BIGINT,
  p_record_loan_payment BOOLEAN DEFAULT true
)
RETURNS public.loan_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_transaction public.transactions%ROWTYPE;
  v_loan public.loans%ROWTYPE;
  v_existing public.loan_payments%ROWTYPE;
  v_result public.loan_payments%ROWTYPE;
  v_installment_number INTEGER;
  v_installments_covered BIGINT := 0;
  v_opening_principal NUMERIC;
  v_payment NUMERIC;
  v_interest NUMERIC;
  v_principal NUMERIC;
BEGIN
  SELECT * INTO v_transaction FROM public.transactions
  WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % does not exist', p_transaction_id;
  END IF;

  SELECT * INTO v_existing FROM public.loan_payments
  WHERE transaction_id = p_transaction_id FOR UPDATE;
  IF v_existing.id IS NOT NULL AND v_existing.source_kind <> 'existing_transaction' THEN
    RAISE EXCEPTION
      'Transaction % is linked to a % loan payment and cannot be synchronized automatically',
      p_transaction_id, v_existing.source_kind;
  END IF;

  IF NOT p_record_loan_payment OR v_transaction.loan_id IS NULL THEN
    IF v_existing.id IS NOT NULL THEN
      DELETE FROM public.loan_payments WHERE id = v_existing.id RETURNING * INTO v_result;
    END IF;
    RETURN v_result;
  END IF;

  SELECT * INTO v_loan FROM public.loans
  WHERE id = v_transaction.loan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan % does not exist', v_transaction.loan_id;
  END IF;

  IF v_loan.calculation_mode <> 'loan_payments' THEN
    IF v_existing.id IS NOT NULL THEN
      DELETE FROM public.loan_payments WHERE id = v_existing.id RETURNING * INTO v_result;
    END IF;
    RETURN v_result;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loan_payments
    WHERE loan_id = v_loan.id
      AND payment_kind = 'early_payoff'
      AND id IS DISTINCT FROM v_existing.id
  ) THEN
    RAISE EXCEPTION 'Loan % has an early payoff and cannot accept another regular installment',
      v_loan.id;
  END IF;

  SELECT coalesce(sum(installments_covered), 0)
  INTO v_installments_covered
  FROM public.loan_payments
  WHERE loan_id = v_loan.id
    AND payment_kind IN ('installment', 'catch_up')
    AND id IS DISTINCT FROM v_existing.id;

  IF v_transaction.installment_number IS NOT NULL
    AND v_transaction.installment_number > 0 THEN
    v_installment_number := v_transaction.installment_number;
  ELSIF v_existing.id IS NOT NULL AND v_existing.loan_id = v_loan.id THEN
    v_installment_number := v_existing.installment_number;
  ELSE
    v_installment_number := v_installments_covered + 1;
  END IF;

  IF v_loan.total_installments IS NOT NULL
    AND v_installment_number > v_loan.total_installments THEN
    RAISE EXCEPTION 'Installment % exceeds total installments % for loan %',
      v_installment_number, v_loan.total_installments, v_loan.id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loan_payments later
    WHERE later.loan_id = v_loan.id
      AND later.payment_kind = 'installment'
      AND later.installment_number > v_installment_number
      AND later.id IS DISTINCT FROM v_existing.id
  ) THEN
    RAISE EXCEPTION
      'Cannot insert or reprice installment % while later loan payments exist',
      v_installment_number;
  END IF;

  SELECT greatest(
    v_loan.original_amount
      - coalesce(sum(principal_amount), 0)
      - coalesce(sum(balance_adjustment_amount), 0),
    0
  )
  INTO v_opening_principal
  FROM public.loan_payments
  WHERE loan_id = v_loan.id
    AND id IS DISTINCT FROM v_existing.id
    AND (
      (payment_kind = 'installment' AND installment_number < v_installment_number)
      OR (payment_kind IN ('catch_up', 'balance_adjustment')
        AND payment_date <= v_transaction.charge_date)
    );

  v_payment := round(abs(v_transaction.total_amount), 2);
  IF v_loan.interest_type = 'fixed' THEN
    v_interest := round(v_opening_principal * coalesce(v_loan.interest_rate, 0) / 1200, 2);
  ELSE
    v_interest := round(v_opening_principal * coalesce(v_loan.interest_rate, 0) / 1200, 10);
  END IF;
  v_principal := round(v_payment - v_interest, 10);
  IF v_principal < 0 THEN
    RAISE EXCEPTION 'Loan payment % is less than calculated interest % for transaction %',
      v_payment, v_interest, p_transaction_id;
  END IF;
  IF v_principal > v_opening_principal THEN
    v_principal := round(v_opening_principal, 10);
    v_interest := round(v_payment - v_principal, 10);
  END IF;

  INSERT INTO public.loan_payments (
    loan_id, transaction_id, installment_number, payment_date,
    payment_amount, principal_amount, interest_amount,
    annual_interest_rate, source_kind, notes,
    payment_kind, installments_covered, other_amount, balance_adjustment_amount
  ) VALUES (
    v_loan.id, v_transaction.id, v_installment_number,
    v_transaction.charge_date, v_payment, v_principal, v_interest,
    v_loan.interest_rate, 'existing_transaction',
    'Generated from an actual loan-linked ledger transaction',
    'installment', 1, 0, 0
  )
  ON CONFLICT (transaction_id) DO UPDATE SET
    loan_id = EXCLUDED.loan_id,
    installment_number = EXCLUDED.installment_number,
    payment_date = EXCLUDED.payment_date,
    payment_amount = EXCLUDED.payment_amount,
    principal_amount = EXCLUDED.principal_amount,
    interest_amount = EXCLUDED.interest_amount,
    annual_interest_rate = EXCLUDED.annual_interest_rate,
    source_kind = EXCLUDED.source_kind,
    payment_kind = 'installment',
    installments_covered = 1,
    other_amount = 0,
    balance_adjustment_amount = 0,
    updated_at = timezone('utc'::text, now())
  RETURNING * INTO v_result;

  UPDATE public.transactions SET
    installment_number = v_installment_number,
    installment_count = v_loan.total_installments,
    installments_info = CASE
      WHEN v_loan.total_installments IS NULL THEN v_installment_number::text
      ELSE v_installment_number::text || '/' || v_loan.total_installments::text
    END
  WHERE id = p_transaction_id;
  RETURN v_result;
END;
$$;

-- Reassert the established PostgREST privilege boundary after replacement.
REVOKE ALL ON FUNCTION public.refresh_loan_summary(BIGINT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_loan_payment_from_transaction(BIGINT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_due_loan_payment(
  BIGINT, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BIGINT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_due_loan_payment(
  BIGINT, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, BIGINT
) TO service_role;

COMMIT;
