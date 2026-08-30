-- Migration 018: recurring monthly budget defaults.
--
-- Recurring defaults are mutable future-planning configuration. Applying them
-- to a month is an explicit, atomic command that creates immutable opening
-- snapshots backed only by that month's existing unallocated funds.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.budget_months') IS NULL
     OR to_regclass('public.budget_operations') IS NULL
     OR to_regclass('public.budget_lifecycle_events') IS NULL
     OR to_regprocedure('public.get_funded_budget_month(text)') IS NULL
     OR to_regprocedure('public.budget_assert_reconciled(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Migration 018 preflight: funded budget foundation from Migration 017 is required';
  END IF;
END;
$$;

ALTER TABLE public.budgets
  DROP CONSTRAINT budgets_starting_kind_check,
  ADD CONSTRAINT budgets_starting_kind_check CHECK (
    starting_kind IN ('manual', 'legacy_import', 'copied', 'recurring_default')
  );

ALTER TABLE public.budget_operations
  DROP CONSTRAINT budget_operations_operation_type_check,
  ADD CONSTRAINT budget_operations_operation_type_check CHECK (operation_type IN (
    'legacy_import',
    'manual_funding',
    'establish_budget',
    'adjustment',
    'removal',
    'reactivation',
    'copy',
    'reversal',
    'month_initialization'
  ));

CREATE UNIQUE INDEX budget_operations_month_initialization_key
  ON public.budget_operations (budget_month_id)
  WHERE operation_type = 'month_initialization';

CREATE TABLE public.budget_recurring_defaults (
  category_id BIGINT PRIMARY KEY REFERENCES public.categories(id) ON DELETE RESTRICT,
  amount NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT budget_recurring_defaults_amount_check CHECK (
    amount::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND amount >= 0
  )
);

CREATE OR REPLACE FUNCTION public.validate_budget_recurring_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.categories
    WHERE id = NEW.category_id AND type = 'expense'
  ) THEN
    RAISE EXCEPTION 'Recurring budgets are available only for expense categories'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.amount::text IN ('NaN', 'Infinity', '-Infinity') OR NEW.amount < 0 THEN
    RAISE EXCEPTION 'Recurring budget amount must be a finite nonnegative NUMERIC(18,2) value'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_recurring_defaults_validate
BEFORE INSERT OR UPDATE ON public.budget_recurring_defaults
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_recurring_default();

CREATE OR REPLACE FUNCTION public.prevent_category_type_with_recurring_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.type = 'expense' AND NEW.type <> 'expense' AND EXISTS (
    SELECT 1 FROM public.budget_recurring_defaults WHERE category_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Disable the recurring budget before changing this category type'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER categories_recurring_budget_type_guard
BEFORE UPDATE OF type ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_category_type_with_recurring_default();

CREATE VIEW public.budget_recurring_defaults_read AS
SELECT
  rd.category_id,
  rd.amount::numeric(18, 2)::text AS amount_text,
  rd.created_at,
  rd.updated_at
FROM public.budget_recurring_defaults rd;

CREATE OR REPLACE FUNCTION public.set_budget_recurring_default(
  p_category_id BIGINT,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category public.categories%ROWTYPE;
BEGIN
  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'category_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_category
  FROM public.categories
  WHERE id = p_category_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % does not exist', p_category_id USING ERRCODE = 'P0002';
  END IF;
  IF v_category.type <> 'expense' THEN
    RAISE EXCEPTION 'Recurring budgets are available only for expense categories'
      USING ERRCODE = '23514';
  END IF;

  IF p_amount IS NULL THEN
    DELETE FROM public.budget_recurring_defaults WHERE category_id = p_category_id;
    RETURN jsonb_build_object('category_id', p_category_id, 'enabled', false, 'amount', NULL);
  END IF;

  IF p_amount::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_amount < 0
     OR p_amount <> round(p_amount, 2)
     OR p_amount > 9999999999999999.99 THEN
    RAISE EXCEPTION 'Recurring budget amount must be a finite nonnegative two-decimal value'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.budget_recurring_defaults (category_id, amount)
  VALUES (p_category_id, p_amount::numeric(18, 2))
  ON CONFLICT (category_id) DO UPDATE
  SET amount = EXCLUDED.amount,
      updated_at = timezone('utc'::text, now());

  RETURN jsonb_build_object(
    'category_id', p_category_id,
    'enabled', true,
    'amount', p_amount::numeric(18, 2)::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_budget_recurring_preview(p_month TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_month_start DATE := public.budget_month_start_from_key(p_month);
  v_current_month DATE := date_trunc(
    'month', timezone('Asia/Jerusalem', statement_timestamp())
  )::date;
  v_month_id BIGINT;
  v_eligible BOOLEAN;
  v_initialized BOOLEAN := false;
  v_unallocated NUMERIC(18, 2) := 0;
  v_required NUMERIC(18, 2) := 0;
  v_shortfall NUMERIC(18, 2) := 0;
  v_pending JSONB := '[]'::jsonb;
BEGIN
  v_eligible := v_month_start >= v_current_month;
  SELECT id INTO v_month_id
  FROM public.budget_months
  WHERE month_start = v_month_start;

  IF v_month_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.budget_operations
      WHERE budget_month_id = v_month_id
        AND operation_type = 'month_initialization'
    ) INTO v_initialized;

    SELECT coalesce(unallocated, 0)::numeric(18, 2)
    INTO v_unallocated
    FROM public.budget_month_funding_state
    WHERE budget_month_id = v_month_id;
  END IF;

  IF v_eligible AND NOT v_initialized THEN
    SELECT
      coalesce(jsonb_agg(jsonb_build_object(
        'category_id', c.id,
        'category', jsonb_build_object('name', c.name, 'icon', c.icon, 'type', c.type),
        'amount', rd.amount::numeric(18, 2)::text
      ) ORDER BY c.name, c.id), '[]'::jsonb),
      coalesce(sum(rd.amount), 0)::numeric(18, 2)
    INTO v_pending, v_required
    FROM public.budget_recurring_defaults rd
    JOIN public.categories c ON c.id = rd.category_id
    LEFT JOIN public.budgets b
      ON b.budget_month_id = v_month_id
     AND b.category_id = rd.category_id
    WHERE c.type = 'expense'
      AND c.is_active = true
      AND b.id IS NULL;
  END IF;

  v_shortfall := greatest(v_required - v_unallocated, 0)::numeric(18, 2);
  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'initialized', v_initialized,
    'pending_categories', v_pending,
    'pending_count', jsonb_array_length(v_pending),
    'required', v_required::numeric(18, 2)::text,
    'unallocated', v_unallocated::numeric(18, 2)::text,
    'shortfall', v_shortfall::numeric(18, 2)::text,
    'can_apply', v_eligible AND NOT v_initialized
      AND jsonb_array_length(v_pending) > 0 AND v_shortfall = 0
  );
END;
$$;

-- Preserve the Migration 017 read implementation as an internal foundation
-- helper and layer the recurring preview onto its JSON response. Both remain
-- STABLE: merely viewing a month never creates budget state.
ALTER FUNCTION public.get_funded_budget_month(TEXT)
  RENAME TO get_funded_budget_month_foundation;

CREATE OR REPLACE FUNCTION public.get_funded_budget_month(p_month TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN public.get_funded_budget_month_foundation(p_month)
    || jsonb_build_object('recurring', public.get_budget_recurring_preview(p_month));
END;
$$;

CREATE OR REPLACE FUNCTION public.initialize_budget_recurring_defaults(
  p_month TEXT,
  p_request_key UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_month_start DATE := public.budget_month_start_from_key(p_month);
  v_current_month DATE := date_trunc(
    'month', timezone('Asia/Jerusalem', statement_timestamp())
  )::date;
  v_month_id BIGINT;
  v_operation_id BIGINT;
  v_budget_id BIGINT;
  v_existing public.budget_operations%ROWTYPE;
  v_required NUMERIC(18, 2) := 0;
  v_unallocated NUMERIC(18, 2) := 0;
  v_fingerprint TEXT;
  v_default RECORD;
BEGIN
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key is required' USING ERRCODE = '22023';
  END IF;
  IF v_month_start < v_current_month THEN
    RAISE EXCEPTION 'Recurring budgets cannot be initialized for a historical month'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.budget_months (month_start)
  VALUES (v_month_start)
  ON CONFLICT (month_start) DO NOTHING;

  -- Canonical lock order: month, existing budget rows by ID, configuration
  -- rows by category, then immutable operation/history inserts.
  SELECT id INTO v_month_id
  FROM public.budget_months
  WHERE month_start = v_month_start
  FOR UPDATE;

  PERFORM 1 FROM public.budgets
  WHERE budget_month_id = v_month_id
  ORDER BY id
  FOR UPDATE;

  PERFORM 1
  FROM public.categories c
  JOIN public.budget_recurring_defaults rd ON rd.category_id = c.id
  WHERE c.type = 'expense' AND c.is_active = true
  ORDER BY c.id
  FOR SHARE OF c;

  PERFORM 1
  FROM public.budget_recurring_defaults rd
  JOIN public.categories c ON c.id = rd.category_id
  WHERE c.type = 'expense' AND c.is_active = true
  ORDER BY rd.category_id
  FOR SHARE OF rd;

  v_fingerprint := 'month_initialization|' || p_month;
  SELECT * INTO v_existing
  FROM public.budget_operations
  WHERE request_key = p_request_key;
  IF FOUND THEN
    IF v_existing.budget_month_id <> v_month_id
       OR v_existing.operation_type <> 'month_initialization'
       OR v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation'
        USING ERRCODE = '23505';
    END IF;
    RETURN public.get_funded_budget_month(p_month);
  END IF;

  -- A month is initialized once. A later command with a fresh key is also a
  -- harmless read of the already-established immutable state.
  IF EXISTS (
    SELECT 1 FROM public.budget_operations
    WHERE budget_month_id = v_month_id
      AND operation_type = 'month_initialization'
  ) THEN
    RETURN public.get_funded_budget_month(p_month);
  END IF;

  SELECT coalesce(sum(rd.amount), 0)::numeric(18, 2)
  INTO v_required
  FROM public.budget_recurring_defaults rd
  JOIN public.categories c ON c.id = rd.category_id
  LEFT JOIN public.budgets b
    ON b.budget_month_id = v_month_id
   AND b.category_id = rd.category_id
  WHERE c.type = 'expense'
    AND c.is_active = true
    AND b.id IS NULL;

  SELECT coalesce(unallocated, 0)::numeric(18, 2)
  INTO v_unallocated
  FROM public.budget_month_funding_state
  WHERE budget_month_id = v_month_id;

  IF v_required > v_unallocated THEN
    RAISE EXCEPTION 'Insufficient unallocated funds for recurring budgets: required %, available %, shortfall %',
      v_required, v_unallocated, v_required - v_unallocated
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.budget_operations (
    budget_month_id, request_key, request_fingerprint, operation_type,
    effective_date, reason
  ) VALUES (
    v_month_id, p_request_key, v_fingerprint, 'month_initialization',
    v_month_start, p_reason
  ) RETURNING id INTO v_operation_id;

  FOR v_default IN
    SELECT rd.category_id, rd.amount
    FROM public.budget_recurring_defaults rd
    JOIN public.categories c ON c.id = rd.category_id
    LEFT JOIN public.budgets b
      ON b.budget_month_id = v_month_id
     AND b.category_id = rd.category_id
    WHERE c.type = 'expense'
      AND c.is_active = true
      AND b.id IS NULL
    ORDER BY rd.category_id
  LOOP
    INSERT INTO public.budgets (
      category_id, month, amount, budget_month_id, starting_amount,
      starting_kind, created_by_operation_id
    ) VALUES (
      v_default.category_id, p_month, v_default.amount, v_month_id,
      v_default.amount, 'recurring_default', v_operation_id
    ) RETURNING id INTO v_budget_id;

    INSERT INTO public.budget_lifecycle_events (operation_id, budget_id, state)
    VALUES (v_operation_id, v_budget_id, 'active');
  END LOOP;

  PERFORM public.budget_assert_reconciled(v_month_id);
  RETURN public.get_funded_budget_month(p_month);
END;
$$;

ALTER TABLE public.budget_recurring_defaults ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.budget_recurring_defaults,
  public.budget_recurring_defaults_read
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.budget_recurring_defaults,
  public.budget_recurring_defaults_read
  TO service_role;

REVOKE ALL ON FUNCTION public.validate_budget_recurring_default(),
  public.prevent_category_type_with_recurring_default(),
  public.get_budget_recurring_preview(TEXT),
  public.get_funded_budget_month_foundation(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_budget_recurring_default(BIGINT, NUMERIC),
  public.initialize_budget_recurring_defaults(TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_funded_budget_month(TEXT)
  FROM PUBLIC, anon, authenticated;

-- Migration 017 granted the renamed read helper to service_role. It is now
-- internal, so remove that inherited grant and expose only the wrapper.
REVOKE EXECUTE ON FUNCTION public.get_funded_budget_month_foundation(TEXT)
  FROM service_role;

GRANT EXECUTE ON FUNCTION public.get_funded_budget_month(TEXT),
  public.set_budget_recurring_default(BIGINT, NUMERIC),
  public.initialize_budget_recurring_defaults(TEXT, UUID, TEXT)
  TO service_role;

COMMIT;
