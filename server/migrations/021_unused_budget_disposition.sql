-- Migration 021: unified unused-budget policy, explicit month close, and savings.
--
-- A close moves eligible unused funded money out of the immediately completed
-- month. Carry-forward reuses Migration 019, return-to-unallocated transfers
-- funding into the current month's free pool, and savings leaves the monthly
-- envelope for one application-wide retained reserve.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.budget_months') IS NULL
     OR to_regclass('public.budget_carryover_settings') IS NULL
     OR to_regclass('public.budget_carryover_batches') IS NULL
     OR to_regclass('public.budget_carryover_transfers') IS NULL
     OR to_regclass('public.budget_month_overrides') IS NULL
     OR to_regclass('public.budget_month_override_events') IS NULL
     OR to_regclass('public.budget_category_base_state') IS NULL
     OR to_regprocedure('public.apply_budget_carryover(text,uuid,text,text)') IS NULL
     OR to_regprocedure('public.reverse_budget_carryover(bigint,uuid,text)') IS NULL
     OR to_regprocedure('public.budget_assert_reconciled(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Migration 021 preflight: Migrations 017 through 020 are required';
  END IF;
  IF to_regclass('public.budget_unused_balance_policies') IS NOT NULL
     OR to_regclass('public.budget_month_disposition_batches') IS NOT NULL
     OR to_regclass('public.budget_unused_disposition_events') IS NOT NULL
     OR to_regclass('public.budget_savings_entries') IS NOT NULL
     OR to_regprocedure('public.apply_budget_month_disposition(text,uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 021 preflight: unexpected partial unused-disposition schema exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.budget_operations
    WHERE operation_type NOT IN (
      'legacy_import','manual_funding','establish_budget','adjustment','removal',
      'reactivation','copy','reversal','month_initialization','carryover_out',
      'carryover_in','monthly_override_set','monthly_override_remove'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.budget_funding_entries
    WHERE source_kind NOT IN ('manual_available_funds','legacy_import','carryover_transfer')
  ) THEN
    RAISE EXCEPTION 'Migration 021 preflight: unexpected funded-budget domain value';
  END IF;
END;
$$;

ALTER TABLE public.budget_operations
  DROP CONSTRAINT budget_operations_operation_type_check,
  ADD CONSTRAINT budget_operations_operation_type_check CHECK (operation_type IN (
    'legacy_import','manual_funding','establish_budget','adjustment','removal',
    'reactivation','copy','reversal','month_initialization','carryover_out',
    'carryover_in','monthly_override_set','monthly_override_remove',
    'unused_return_out','unused_return_in','unused_to_savings',
    'unused_disposition_reversal'
  ));

ALTER TABLE public.budget_funding_entries
  DROP CONSTRAINT budget_funding_entries_source_kind_check,
  ADD CONSTRAINT budget_funding_entries_source_kind_check CHECK (
    source_kind IN (
      'manual_available_funds','legacy_import','carryover_transfer',
      'unused_disposition_transfer','savings_transfer'
    )
  ),
  DROP CONSTRAINT budget_funding_entry_amount_shape,
  ADD CONSTRAINT budget_funding_entry_amount_shape CHECK (
    amount_delta::text NOT IN ('NaN','Infinity','-Infinity')
    AND (
      (source_kind = 'legacy_import' AND amount_delta >= 0 AND reverses_funding_entry_id IS NULL)
      OR (source_kind <> 'legacy_import' AND amount_delta <> 0)
    )
  );

-- Existing rows are exactly the enabled carryover set. Adding the default
-- before the rename deterministically maps every one to carry_forward.
ALTER TABLE public.budget_carryover_settings
  ADD COLUMN policy TEXT NOT NULL DEFAULT 'carry_forward'
    CHECK (policy IN ('carry_forward','savings','return_to_unallocated'));
ALTER TABLE public.budget_carryover_settings RENAME TO budget_unused_balance_policies;
ALTER TABLE public.budget_unused_balance_policies ALTER COLUMN policy DROP DEFAULT;
ALTER TRIGGER budget_carryover_settings_validate ON public.budget_unused_balance_policies
  RENAME TO budget_unused_balance_policies_validate;

-- Migration 019 continues to see only carry-forward policies. This simple
-- compatibility view keeps its proven transfer engine and provenance intact.
CREATE VIEW public.budget_carryover_settings AS
SELECT category_id, created_at, updated_at
FROM public.budget_unused_balance_policies
WHERE policy = 'carry_forward';

DROP VIEW public.budget_carryover_settings_read;
CREATE VIEW public.budget_carryover_settings_read AS
SELECT category_id, true AS enabled, created_at, updated_at
FROM public.budget_unused_balance_policies
WHERE policy = 'carry_forward';

CREATE VIEW public.budget_unused_balance_policies_read AS
SELECT category_id, policy, created_at, updated_at
FROM public.budget_unused_balance_policies;

CREATE OR REPLACE FUNCTION public.validate_budget_carryover_setting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = NEW.category_id AND type = 'expense'
  ) THEN
    RAISE EXCEPTION 'Unused-balance policies are available only for expense categories'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_category_type_with_carryover()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.type = 'expense' AND NEW.type <> 'expense' AND EXISTS (
    SELECT 1 FROM public.budget_unused_balance_policies WHERE category_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Remove the unused-balance policy before changing this category type'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION public.set_budget_carryover_enabled(BIGINT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.set_budget_unused_balance_policy(
  p_category_id BIGINT,
  p_policy TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_category public.categories%ROWTYPE;
BEGIN
  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'category_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_policy IS NOT NULL
     AND p_policy NOT IN ('carry_forward','savings','return_to_unallocated') THEN
    RAISE EXCEPTION 'Unknown unused-balance policy' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_category FROM public.categories WHERE id = p_category_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % does not exist', p_category_id USING ERRCODE = 'P0002';
  END IF;
  IF v_category.type <> 'expense' OR NOT v_category.is_active THEN
    RAISE EXCEPTION 'Unused-balance policies require an active expense category'
      USING ERRCODE = '23514';
  END IF;
  IF p_policy IS NULL THEN
    DELETE FROM public.budget_unused_balance_policies WHERE category_id = p_category_id;
  ELSE
    INSERT INTO public.budget_unused_balance_policies(category_id, policy)
    VALUES (p_category_id, p_policy)
    ON CONFLICT (category_id) DO UPDATE
    SET policy = EXCLUDED.policy, updated_at = timezone('utc'::text, now());
  END IF;
  RETURN jsonb_build_object('category_id', p_category_id, 'policy', p_policy);
END;
$$;

CREATE TABLE public.budget_month_disposition_batches (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  request_key UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  source_budget_month_id BIGINT NOT NULL REFERENCES public.budget_months(id) ON DELETE RESTRICT,
  destination_budget_month_id BIGINT NOT NULL REFERENCES public.budget_months(id) ON DELETE RESTRICT,
  reverses_batch_id BIGINT UNIQUE REFERENCES public.budget_month_disposition_batches(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  CHECK (source_budget_month_id <> destination_budget_month_id),
  CHECK (reverses_batch_id IS NULL OR reverses_batch_id <> id)
);

CREATE TABLE public.budget_savings_entries (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  operation_id BIGINT NOT NULL UNIQUE REFERENCES public.budget_operations(id) ON DELETE RESTRICT,
  source_budget_month_id BIGINT NOT NULL REFERENCES public.budget_months(id) ON DELETE RESTRICT,
  source_budget_id BIGINT NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  category_id BIGINT NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  amount_delta NUMERIC(18,2) NOT NULL,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('deposit','reversal')),
  reverses_entry_id BIGINT UNIQUE REFERENCES public.budget_savings_entries(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  CHECK (amount_delta::text NOT IN ('NaN','Infinity','-Infinity') AND amount_delta <> 0),
  CHECK ((entry_kind='deposit' AND amount_delta > 0 AND reverses_entry_id IS NULL)
      OR (entry_kind='reversal' AND amount_delta < 0 AND reverses_entry_id IS NOT NULL)),
  CHECK (reverses_entry_id IS NULL OR reverses_entry_id <> id)
);

CREATE TABLE public.budget_unused_disposition_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES public.budget_month_disposition_batches(id) ON DELETE RESTRICT,
  category_id BIGINT NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  source_budget_id BIGINT NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('apply','reversal')),
  policy TEXT NOT NULL CHECK (policy IN ('carry_forward','savings','return_to_unallocated')),
  amount NUMERIC(18,2) NOT NULL,
  source_final_funded_snapshot NUMERIC(18,2) NOT NULL,
  source_raw_actual_snapshot NUMERIC(18,2) NOT NULL,
  source_effective_actual_snapshot NUMERIC(18,2) NOT NULL,
  source_operation_id BIGINT REFERENCES public.budget_operations(id) ON DELETE RESTRICT,
  destination_operation_id BIGINT REFERENCES public.budget_operations(id) ON DELETE RESTRICT,
  carryover_transfer_id BIGINT REFERENCES public.budget_carryover_transfers(id) ON DELETE RESTRICT,
  savings_entry_id BIGINT REFERENCES public.budget_savings_entries(id) ON DELETE RESTRICT,
  reverses_event_id BIGINT UNIQUE REFERENCES public.budget_unused_disposition_events(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  CHECK (amount::text NOT IN ('NaN','Infinity','-Infinity') AND amount > 0),
  CHECK (source_final_funded_snapshot::text NOT IN ('NaN','Infinity','-Infinity')
         AND source_final_funded_snapshot >= 0),
  CHECK (source_raw_actual_snapshot::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (source_effective_actual_snapshot::text NOT IN ('NaN','Infinity','-Infinity')
         AND source_effective_actual_snapshot >= 0),
  CHECK (reverses_event_id IS NULL OR reverses_event_id <> id),
  CHECK ((event_kind='apply' AND reverses_event_id IS NULL)
      OR (event_kind='reversal' AND reverses_event_id IS NOT NULL)),
  CHECK ((policy='carry_forward' AND carryover_transfer_id IS NOT NULL
          AND savings_entry_id IS NULL)
      OR (policy='savings' AND carryover_transfer_id IS NULL
          AND savings_entry_id IS NOT NULL AND destination_operation_id IS NULL)
      OR (policy='return_to_unallocated' AND carryover_transfer_id IS NULL
          AND savings_entry_id IS NULL AND destination_operation_id IS NOT NULL))
);

CREATE INDEX idx_budget_disposition_batches_months
  ON public.budget_month_disposition_batches(source_budget_month_id,destination_budget_month_id,id);
CREATE INDEX idx_budget_disposition_events_source
  ON public.budget_unused_disposition_events(source_budget_id,id);
CREATE INDEX idx_budget_savings_entries_source
  ON public.budget_savings_entries(source_budget_month_id,source_budget_id,id);

CREATE VIEW public.budget_savings_state AS
SELECT coalesce(sum(amount_delta),0)::numeric(18,2) AS balance,
       coalesce(sum(amount_delta),0)::numeric(18,2)::text AS balance_text
FROM public.budget_savings_entries;

CREATE VIEW public.budget_month_disposition_history AS
SELECT e.id AS event_id, e.batch_id, e.event_kind, e.policy,
       e.category_id, c.name AS category_name, e.source_budget_id,
       to_char(sm.month_start,'YYYY-MM') AS source_month,
       to_char(dm.month_start,'YYYY-MM') AS destination_month,
       e.amount::numeric(18,2)::text AS amount,
       e.source_final_funded_snapshot::numeric(18,2)::text AS source_final_funded_snapshot,
       e.source_raw_actual_snapshot::numeric(18,2)::text AS source_raw_actual_snapshot,
       e.source_effective_actual_snapshot::numeric(18,2)::text AS source_effective_actual_snapshot,
       e.source_operation_id, e.destination_operation_id, e.carryover_transfer_id,
       e.savings_entry_id, e.reverses_event_id, e.created_at
FROM public.budget_unused_disposition_events e
JOIN public.budget_month_disposition_batches b ON b.id=e.batch_id
JOIN public.budget_months sm ON sm.id=b.source_budget_month_id
JOIN public.budget_months dm ON dm.id=b.destination_budget_month_id
JOIN public.categories c ON c.id=e.category_id;

CREATE OR REPLACE FUNCTION public.validate_budget_disposition_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_source DATE; v_destination DATE;
BEGIN
  SELECT month_start INTO v_source FROM public.budget_months WHERE id=NEW.source_budget_month_id;
  SELECT month_start INTO v_destination FROM public.budget_months WHERE id=NEW.destination_budget_month_id;
  IF v_destination IS DISTINCT FROM (v_source + interval '1 month')::date THEN
    RAISE EXCEPTION 'Month disposition must link consecutive calendar months' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_budget_savings_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_operation public.budget_operations%ROWTYPE;
  v_budget public.budgets%ROWTYPE;
  v_funding public.budget_funding_entries%ROWTYPE;
  v_movement public.budget_movements%ROWTYPE;
BEGIN
  SELECT * INTO v_operation FROM public.budget_operations WHERE id=NEW.operation_id;
  SELECT * INTO v_budget FROM public.budgets WHERE id=NEW.source_budget_id;
  SELECT * INTO v_funding FROM public.budget_funding_entries WHERE operation_id=NEW.operation_id;
  SELECT * INTO v_movement FROM public.budget_movements WHERE operation_id=NEW.operation_id;
  IF v_operation.budget_month_id IS DISTINCT FROM NEW.source_budget_month_id
     OR v_budget.budget_month_id IS DISTINCT FROM NEW.source_budget_month_id
     OR v_budget.category_id IS DISTINCT FROM NEW.category_id
     OR v_operation.operation_type NOT IN ('unused_to_savings','unused_disposition_reversal') THEN
    RAISE EXCEPTION 'Savings entry provenance does not match its source' USING ERRCODE='23514';
  END IF;
  IF NEW.entry_kind='reversal' AND NOT EXISTS (
    SELECT 1 FROM public.budget_savings_entries original
    WHERE original.id=NEW.reverses_entry_id AND original.entry_kind='deposit'
      AND original.source_budget_id=NEW.source_budget_id
      AND original.amount_delta=-NEW.amount_delta
  ) THEN
    RAISE EXCEPTION 'Savings reversal does not match its deposit' USING ERRCODE='23514';
  END IF;
  IF v_funding.source_kind<>'savings_transfer'
     OR (NEW.entry_kind='deposit' AND (
       v_funding.amount_delta<>-NEW.amount_delta
       OR v_movement.source_budget_id IS DISTINCT FROM NEW.source_budget_id
       OR v_movement.destination_budget_id IS NOT NULL
       OR v_movement.amount<>NEW.amount_delta
     ))
     OR (NEW.entry_kind='reversal' AND (
       v_funding.amount_delta<>-NEW.amount_delta
       OR v_movement.source_budget_id IS NOT NULL
       OR v_movement.destination_budget_id IS DISTINCT FROM NEW.source_budget_id
       OR v_movement.amount<>-NEW.amount_delta
     )) THEN
    RAISE EXCEPTION 'Savings funding and category movement are not balanced'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_disposition_batches_validate BEFORE INSERT ON public.budget_month_disposition_batches
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_disposition_batch();
CREATE TRIGGER budget_disposition_batches_immutable BEFORE UPDATE OR DELETE ON public.budget_month_disposition_batches
FOR EACH ROW EXECUTE FUNCTION public.prevent_budget_history_mutation();
CREATE TRIGGER budget_disposition_events_immutable BEFORE UPDATE OR DELETE ON public.budget_unused_disposition_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_budget_history_mutation();
CREATE TRIGGER budget_savings_entries_validate BEFORE INSERT ON public.budget_savings_entries
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_savings_entry();
CREATE TRIGGER budget_savings_entries_immutable BEFORE UPDATE OR DELETE ON public.budget_savings_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_budget_history_mutation();

CREATE OR REPLACE FUNCTION public.budget_month_disposition_candidate_rows(p_source_month TEXT)
RETURNS TABLE (
  category_id BIGINT, category_name TEXT, category_icon TEXT,
  source_budget_id BIGINT, policy TEXT,
  source_final_funded NUMERIC(18,2), source_raw_actual NUMERIC(18,2),
  source_effective_actual NUMERIC(18,2), eligible_amount NUMERIC(18,2),
  status TEXT, blocked_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_source_start DATE := public.budget_month_start_from_key(p_source_month);
  v_destination_start DATE := (v_source_start + interval '1 month')::date;
  v_source_id BIGINT;
BEGIN
  SELECT id INTO v_source_id FROM public.budget_months WHERE month_start=v_source_start;
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE movement_type='expense'
      AND transaction_date>=v_source_start AND transaction_date<v_destination_start
      AND total_amount::text IN ('NaN','Infinity','-Infinity')
  ) THEN
    RAISE EXCEPTION 'Month disposition actual spending contains a non-finite amount'
      USING ERRCODE='22003';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.movement_type='expense'
      AND t.transaction_date>=v_source_start AND t.transaction_date<v_destination_start
    GROUP BY t.category_id
    HAVING sum(t.total_amount)<>round(sum(t.total_amount),2)
       OR abs(sum(t.total_amount))>9999999999999999.99
  ) THEN
    RAISE EXCEPTION 'Month disposition actual spending must fit finite NUMERIC(18,2) exactly'
      USING ERRCODE='22003';
  END IF;

  RETURN QUERY
  WITH actuals AS (
    SELECT t.category_id, sum(t.total_amount)::numeric(18,2) AS actual
    FROM public.transactions t
    WHERE t.movement_type='expense'
      AND t.transaction_date>=v_source_start AND t.transaction_date<v_destination_start
    GROUP BY t.category_id
  ), base AS (
    SELECT cs.budget_id, cs.category_id, cs.category_name, cs.category_icon,
      cs.category_type, c.is_active, cs.lifecycle_state,
      cs.final_funded::numeric(18,2) AS final_funded,
      coalesce(a.actual,0)::numeric(18,2) AS raw_actual,
      greatest(coalesce(a.actual,0),0)::numeric(18,2) AS effective_actual,
      greatest(cs.final_funded-greatest(coalesce(a.actual,0),0),0)::numeric(18,2) AS unused,
      p.policy,
      EXISTS (
        SELECT 1 FROM public.budget_unused_disposition_events original
        WHERE original.source_budget_id=cs.budget_id AND original.event_kind='apply'
          AND NOT EXISTS (
            SELECT 1 FROM public.budget_unused_disposition_events correction
            WHERE correction.reverses_event_id=original.id
          )
      ) AS disposed,
      carry.status AS carry_status,
      carry.blocked_reason AS carry_blocked
    FROM public.budget_category_state cs
    JOIN public.categories c ON c.id=cs.category_id
    LEFT JOIN actuals a ON a.category_id=cs.category_id
    LEFT JOIN public.budget_unused_balance_policies p ON p.category_id=cs.category_id
    LEFT JOIN public.budget_carryover_candidate_rows(to_char(v_destination_start,'YYYY-MM')) carry
      ON p.policy='carry_forward' AND carry.category_id=cs.category_id
    WHERE cs.budget_month_id=v_source_id
  )
  SELECT b.category_id,b.category_name,b.category_icon,b.budget_id,b.policy,
    b.final_funded,b.raw_actual,b.effective_actual,b.unused,
    CASE
      WHEN b.disposed OR (b.policy='carry_forward' AND b.carry_status='already_applied')
        THEN 'already_applied'
      WHEN b.category_type<>'expense' OR NOT b.is_active THEN 'blocked'
      WHEN b.lifecycle_state<>'active' THEN 'blocked'
      WHEN b.unused<=0 THEN 'ineligible'
      WHEN b.policy IS NULL THEN 'blocked'
      WHEN b.policy='carry_forward' AND b.carry_status IS DISTINCT FROM 'ready' THEN 'blocked'
      ELSE 'ready'
    END,
    CASE
      WHEN b.disposed OR (b.policy='carry_forward' AND b.carry_status='already_applied') THEN NULL
      WHEN b.category_type<>'expense' THEN 'CATEGORY_NOT_EXPENSE'
      WHEN NOT b.is_active THEN 'CATEGORY_INACTIVE'
      WHEN b.lifecycle_state<>'active' THEN 'SOURCE_BUDGET_INACTIVE'
      WHEN b.unused<=0 THEN NULL
      WHEN b.policy IS NULL THEN 'POLICY_UNCONFIGURED'
      WHEN b.policy='carry_forward' AND b.carry_status IS DISTINCT FROM 'ready'
        THEN coalesce(b.carry_blocked,'CARRY_FORWARD_NOT_READY')
      ELSE NULL
    END
  FROM base b
  ORDER BY b.category_name,b.category_id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_budget_month_disposition_preview(p_source_month TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_source_start DATE := public.budget_month_start_from_key(p_source_month);
  v_destination_start DATE := (v_source_start + interval '1 month')::date;
  v_current_start DATE := date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_source_id BIGINT;
  v_destination_id BIGINT;
  v_rows JSONB := '[]'::jsonb;
  v_material TEXT := '';
  v_deficits JSONB := '[]'::jsonb;
  v_unbudgeted JSONB := '[]'::jsonb;
  v_carry NUMERIC(18,2) := 0;
  v_return NUMERIC(18,2) := 0;
  v_savings NUMERIC(18,2) := 0;
  v_destination_unallocated NUMERIC(18,2) := 0;
  v_destination_available NUMERIC(18,2) := 0;
  v_source_available NUMERIC(18,2) := 0;
  v_source_unallocated NUMERIC(18,2) := 0;
  v_savings_balance NUMERIC(18,2) := 0;
  v_fingerprint TEXT;
  v_timing BOOLEAN;
BEGIN
  v_timing := v_destination_start=v_current_start;
  SELECT id INTO v_source_id FROM public.budget_months WHERE month_start=v_source_start;
  SELECT id INTO v_destination_id FROM public.budget_months WHERE month_start=v_destination_start;

  WITH rows AS (SELECT * FROM public.budget_month_disposition_candidate_rows(p_source_month))
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'category_id',category_id,
      'category',jsonb_build_object('name',category_name,'icon',category_icon,'type','expense'),
      'source_budget_id',source_budget_id,'policy',policy,
      'source_final_funded',source_final_funded::text,
      'source_raw_actual',source_raw_actual::text,
      'source_effective_actual',source_effective_actual::text,
      'eligible_unused',eligible_amount::text,
      'status',status,'blocked_reason',blocked_reason
    ) ORDER BY category_name,category_id),'[]'::jsonb),
    coalesce(string_agg(category_id||'|'||source_budget_id||'|'||coalesce(policy,'')||'|'
      ||source_final_funded::text||'|'||source_raw_actual::text||'|'
      ||source_effective_actual::text||'|'||eligible_amount::text||'|'
      ||status||'|'||coalesce(blocked_reason,''),';' ORDER BY category_id),''),
    coalesce(sum(eligible_amount) FILTER (WHERE status='ready' AND policy='carry_forward'),0),
    coalesce(sum(eligible_amount) FILTER (WHERE status='ready' AND policy='return_to_unallocated'),0),
    coalesce(sum(eligible_amount) FILTER (WHERE status='ready' AND policy='savings'),0)
  INTO v_rows,v_material,v_carry,v_return,v_savings FROM rows;

  WITH actuals AS (
    SELECT t.category_id,sum(t.total_amount)::numeric(18,2) actual
    FROM public.transactions t
    WHERE t.movement_type='expense' AND t.transaction_date>=v_source_start
      AND t.transaction_date<v_destination_start
    GROUP BY t.category_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'category_id',cs.category_id,'category_name',cs.category_name,
    'funded',cs.final_funded::numeric(18,2)::text,'actual',a.actual::text,
    'deficit',(a.actual-cs.final_funded)::numeric(18,2)::text
  ) ORDER BY cs.category_name,cs.category_id),'[]'::jsonb)
  INTO v_deficits
  FROM actuals a JOIN public.budget_category_state cs
    ON cs.budget_month_id=v_source_id AND cs.category_id=a.category_id
  WHERE cs.lifecycle_state='active' AND a.actual>cs.final_funded;

  WITH actuals AS (
    SELECT t.category_id,sum(t.total_amount)::numeric(18,2) actual
    FROM public.transactions t
    WHERE t.movement_type='expense' AND t.transaction_date>=v_source_start
      AND t.transaction_date<v_destination_start
    GROUP BY t.category_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'category_id',a.category_id,'actual',a.actual::text
  ) ORDER BY a.category_id NULLS FIRST),'[]'::jsonb)
  INTO v_unbudgeted
  FROM actuals a
  WHERE a.actual>0 AND NOT EXISTS (
    SELECT 1 FROM public.budget_category_state cs
    WHERE cs.budget_month_id=v_source_id AND cs.category_id IS NOT DISTINCT FROM a.category_id
      AND cs.lifecycle_state='active'
  );

  SELECT coalesce(available,0)::numeric(18,2),coalesce(unallocated,0)::numeric(18,2)
  INTO v_destination_available,v_destination_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_destination_id;
  IF NOT FOUND THEN v_destination_available:=0; v_destination_unallocated:=0; END IF;
  SELECT coalesce(available,0)::numeric(18,2),coalesce(unallocated,0)::numeric(18,2)
  INTO v_source_available,v_source_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_source_id;
  IF NOT FOUND THEN v_source_available:=0; v_source_unallocated:=0; END IF;
  SELECT balance INTO v_savings_balance FROM public.budget_savings_state;

  v_fingerprint:=md5('month_disposition|'||p_source_month||'|'
    ||to_char(v_destination_start,'YYYY-MM')||'|'||v_material||'|deficits:'
    ||v_deficits::text||'|unbudgeted:'||v_unbudgeted::text
    ||'|source-funding:'||v_source_available::text||'|'||v_source_unallocated::text
    ||'|destination-funding:'||v_destination_available::text||'|'||v_destination_unallocated::text
    ||'|savings:'||v_savings_balance::text);

  RETURN jsonb_build_object(
    'eligible',v_timing AND v_source_id IS NOT NULL,
    'reason',CASE WHEN NOT v_timing THEN 'IMMEDIATELY_COMPLETED_MONTH_ONLY'
                  WHEN v_source_id IS NULL THEN 'SOURCE_MONTH_MISSING' ELSE NULL END,
    'source_month',p_source_month,
    'destination_month',to_char(v_destination_start,'YYYY-MM'),
    'fingerprint',v_fingerprint,
    'categories',v_rows,
    'carry_forward_total',v_carry::text,
    'return_to_unallocated_total',v_return::text,
    'savings_total',v_savings::text,
    'source_available',v_source_available::text,
    'source_unallocated',v_source_unallocated::text,
    'destination_unallocated_before',v_destination_unallocated::text,
    'destination_unallocated_after',(v_destination_unallocated+v_return)::numeric(18,2)::text,
    'savings_balance_before',v_savings_balance::text,
    'savings_balance_after',(v_savings_balance+v_savings)::numeric(18,2)::text,
    'deficit_blockers',v_deficits,
    'unbudgeted_expense_blockers',v_unbudgeted,
    'can_apply',v_timing AND v_source_id IS NOT NULL
      AND jsonb_array_length(v_deficits)=0 AND jsonb_array_length(v_unbudgeted)=0
      AND NOT EXISTS (
        SELECT 1 FROM public.budget_month_disposition_candidate_rows(p_source_month)
        WHERE status='blocked'
      )
      AND EXISTS (
        SELECT 1 FROM public.budget_month_disposition_candidate_rows(p_source_month)
        WHERE status='ready'
      )
  );
END; $$;

CREATE OR REPLACE FUNCTION public.apply_budget_month_disposition(
  p_source_month TEXT,
  p_request_key UUID,
  p_preview_fingerprint TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_source_start DATE := public.budget_month_start_from_key(p_source_month);
  v_destination_start DATE := (v_source_start+interval '1 month')::date;
  v_current_start DATE := date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_source_month_id BIGINT;
  v_destination_month_id BIGINT;
  v_batch_id BIGINT;
  v_existing public.budget_month_disposition_batches%ROWTYPE;
  v_preview JSONB;
  v_expected TEXT := 'month_disposition_apply|'||p_source_month||'|'||coalesce(p_preview_fingerprint,'');
  v_carry_preview JSONB;
  v_carry_request UUID;
  v_carry_batch_id BIGINT;
  v_source_operation_id BIGINT;
  v_destination_operation_id BIGINT;
  v_transfer public.budget_carryover_transfers%ROWTYPE;
  v_savings_entry_id BIGINT;
  candidate RECORD;
BEGIN
  IF p_request_key IS NULL OR p_preview_fingerprint IS NULL
     OR p_preview_fingerprint !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'request_key and a valid preview fingerprint are required'
      USING ERRCODE='22023';
  END IF;
  IF v_destination_start<>v_current_start THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_PERIOD_INVALID: source must be the immediately completed Asia/Jerusalem month'
      USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.budget_month_disposition_batches WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint<>v_expected THEN
      RAISE EXCEPTION 'request_key was already used for a different month disposition request'
        USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'source',public.get_funded_budget_month(p_source_month),
      'destination',public.get_funded_budget_month(to_char(v_destination_start,'YYYY-MM')),
      'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
      'batch_id',v_existing.id
    );
  END IF;
  SELECT id INTO v_source_month_id FROM public.budget_months WHERE month_start=v_source_start;
  IF v_source_month_id IS NULL THEN
    RAISE EXCEPTION 'Previous month has no funded budget state' USING ERRCODE='23514';
  END IF;

  -- Transaction mutations take ROW EXCLUSIVE. This table lock is acquired
  -- before month locks everywhere a transaction-dependent release is made.
  LOCK TABLE public.transactions IN SHARE MODE;
  -- Policy changes cannot pass between capture and write, including insertion
  -- of a previously absent (unconfigured) policy row.
  LOCK TABLE public.budget_unused_balance_policies IN SHARE MODE;
  -- One application-wide reserve has one short transaction-scoped mutex.
  -- It is acquired before month rows so deposits/corrections cannot race the
  -- derived Savings balance or invert the funded lock order.
  PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));

  INSERT INTO public.budget_months(month_start) VALUES(v_destination_start)
  ON CONFLICT(month_start) DO NOTHING;
  SELECT id INTO v_destination_month_id FROM public.budget_months WHERE month_start=v_destination_start;
  PERFORM 1 FROM public.budget_months
    WHERE id IN(v_source_month_id,v_destination_month_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.budgets
    WHERE budget_month_id IN(v_source_month_id,v_destination_month_id) ORDER BY id FOR UPDATE;
  PERFORM public.budget_assert_reconciled(v_source_month_id);
  PERFORM public.budget_assert_reconciled(v_destination_month_id);

  SELECT * INTO v_existing FROM public.budget_month_disposition_batches WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint<>v_expected THEN
      RAISE EXCEPTION 'request_key was already used for a different month disposition request'
        USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'source',public.get_funded_budget_month(p_source_month),
      'destination',public.get_funded_budget_month(to_char(v_destination_start,'YYYY-MM')),
      'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
      'batch_id',v_existing.id
    );
  END IF;

  v_preview:=public.get_budget_month_disposition_preview(p_source_month);
  IF v_preview->>'fingerprint' IS DISTINCT FROM p_preview_fingerprint THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_PREVIEW_STALE: candidate material changed; refresh before applying'
      USING ERRCODE='40001';
  END IF;
  IF jsonb_array_length(v_preview->'deficit_blockers')>0 THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_DEFICITS_UNRESOLVED: resolve funded category deficits before closing the month'
      USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(v_preview->'unbudgeted_expense_blockers')>0 THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_UNBUDGETED_EXPENSES: budget or resolve unbudgeted expenses before closing the month'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_preview->'categories') row(item)
    WHERE item->>'status'='blocked'
  ) THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_BLOCKED: configure every eligible category and initialize carry-forward destinations'
      USING ERRCODE='23514';
  END IF;

  INSERT INTO public.budget_month_disposition_batches(
    request_key,request_fingerprint,source_budget_month_id,destination_budget_month_id
  ) VALUES(p_request_key,v_expected,v_source_month_id,v_destination_month_id)
  RETURNING id INTO v_batch_id;

  IF (v_preview->>'carry_forward_total')::numeric>0 THEN
    v_carry_preview:=public.get_budget_carryover_preview(to_char(v_destination_start,'YYYY-MM'));
    v_carry_request:=public.budget_derived_request_key(p_request_key,'carry-forward-batch');
    PERFORM public.apply_budget_carryover(
      to_char(v_destination_start,'YYYY-MM'),v_carry_request,
      v_carry_preview->>'fingerprint',coalesce(p_reason,'Month close: carry forward')
    );
    SELECT id INTO v_carry_batch_id FROM public.budget_carryover_batches
      WHERE request_key=v_carry_request;
  END IF;

  FOR candidate IN
    SELECT item FROM jsonb_array_elements(v_preview->'categories') captured(item)
    WHERE item->>'status'='ready'
    ORDER BY (item->>'category_id')::bigint
  LOOP
    v_source_operation_id:=NULL;
    v_destination_operation_id:=NULL;
    v_savings_entry_id:=NULL;
    v_transfer.id:=NULL;

    IF candidate.item->>'policy'='carry_forward' THEN
      SELECT * INTO v_transfer FROM public.budget_carryover_transfers
      WHERE batch_id=v_carry_batch_id
        AND source_budget_id=(candidate.item->>'source_budget_id')::bigint
        AND reverses_transfer_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Carry-forward orchestration did not create the captured transfer'
          USING ERRCODE='23514';
      END IF;
      v_source_operation_id:=v_transfer.source_operation_id;
      v_destination_operation_id:=v_transfer.destination_operation_id;
    ELSIF candidate.item->>'policy'='return_to_unallocated' THEN
      INSERT INTO public.budget_operations(
        budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason
      ) VALUES(
        v_source_month_id,
        public.budget_derived_request_key(p_request_key,'return-source|'||(candidate.item->>'category_id')),
        'unused_return_out|'||v_batch_id||'|'||(candidate.item->>'category_id')||'|'||(candidate.item->>'eligible_unused'),
        'unused_return_out',v_source_start,p_reason
      ) RETURNING id INTO v_source_operation_id;
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
      VALUES(v_source_operation_id,-(candidate.item->>'eligible_unused')::numeric,
        'unused_disposition_transfer','Return unused funding to '||to_char(v_destination_start,'YYYY-MM'));
      INSERT INTO public.budget_movements(operation_id,source_budget_id,amount)
      VALUES(v_source_operation_id,(candidate.item->>'source_budget_id')::bigint,
        (candidate.item->>'eligible_unused')::numeric);

      INSERT INTO public.budget_operations(
        budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason
      ) VALUES(
        v_destination_month_id,
        public.budget_derived_request_key(p_request_key,'return-destination|'||(candidate.item->>'category_id')),
        'unused_return_in|'||v_batch_id||'|'||(candidate.item->>'category_id')||'|'||(candidate.item->>'eligible_unused'),
        'unused_return_in',v_destination_start,p_reason
      ) RETURNING id INTO v_destination_operation_id;
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
      VALUES(v_destination_operation_id,(candidate.item->>'eligible_unused')::numeric,
        'unused_disposition_transfer','Unused funding returned from '||p_source_month);
    ELSE
      INSERT INTO public.budget_operations(
        budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason
      ) VALUES(
        v_source_month_id,
        public.budget_derived_request_key(p_request_key,'savings|'||(candidate.item->>'category_id')),
        'unused_to_savings|'||v_batch_id||'|'||(candidate.item->>'category_id')||'|'||(candidate.item->>'eligible_unused'),
        'unused_to_savings',v_source_start,p_reason
      ) RETURNING id INTO v_source_operation_id;
      INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
      VALUES(v_source_operation_id,-(candidate.item->>'eligible_unused')::numeric,
        'savings_transfer','Unused budget retained in Savings');
      INSERT INTO public.budget_movements(operation_id,source_budget_id,amount)
      VALUES(v_source_operation_id,(candidate.item->>'source_budget_id')::bigint,
        (candidate.item->>'eligible_unused')::numeric);
      INSERT INTO public.budget_savings_entries(
        operation_id,source_budget_month_id,source_budget_id,category_id,
        amount_delta,entry_kind
      ) VALUES(
        v_source_operation_id,v_source_month_id,(candidate.item->>'source_budget_id')::bigint,
        (candidate.item->>'category_id')::bigint,(candidate.item->>'eligible_unused')::numeric,'deposit'
      ) RETURNING id INTO v_savings_entry_id;
    END IF;

    INSERT INTO public.budget_unused_disposition_events(
      batch_id,category_id,source_budget_id,event_kind,policy,amount,
      source_final_funded_snapshot,source_raw_actual_snapshot,
      source_effective_actual_snapshot,source_operation_id,destination_operation_id,
      carryover_transfer_id,savings_entry_id
    ) VALUES(
      v_batch_id,(candidate.item->>'category_id')::bigint,
      (candidate.item->>'source_budget_id')::bigint,'apply',candidate.item->>'policy',
      (candidate.item->>'eligible_unused')::numeric,
      (candidate.item->>'source_final_funded')::numeric,
      (candidate.item->>'source_raw_actual')::numeric,
      (candidate.item->>'source_effective_actual')::numeric,
      v_source_operation_id,v_destination_operation_id,v_transfer.id,v_savings_entry_id
    );
  END LOOP;

  PERFORM public.budget_assert_reconciled(v_source_month_id);
  PERFORM public.budget_assert_reconciled(v_destination_month_id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object(
    'source',public.get_funded_budget_month(p_source_month),
    'destination',public.get_funded_budget_month(to_char(v_destination_start,'YYYY-MM')),
    'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
    'batch_id',v_batch_id
  );
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_budget_month_disposition(
  p_batch_id BIGINT,
  p_request_key UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_original public.budget_month_disposition_batches%ROWTYPE;
  v_reversal public.budget_month_disposition_batches%ROWTYPE;
  v_source_month public.budget_months%ROWTYPE;
  v_destination_month public.budget_months%ROWTYPE;
  v_fingerprint TEXT := 'month_disposition_reverse|'||coalesce(p_batch_id::text,'');
  v_destination_unallocated NUMERIC(18,2);
  v_savings_balance NUMERIC(18,2);
  v_source_operation_id BIGINT;
  v_destination_operation_id BIGINT;
  v_savings_entry_id BIGINT;
  v_transfer_id BIGINT;
  v_source_funding_id BIGINT;
  v_destination_funding_id BIGINT;
  original_event RECORD;
BEGIN
  IF p_batch_id IS NULL OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'batch_id and request_key are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_original FROM public.budget_month_disposition_batches WHERE id=p_batch_id;
  IF NOT FOUND OR v_original.reverses_batch_id IS NOT NULL THEN
    RAISE EXCEPTION 'Original month disposition batch % does not exist',p_batch_id USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_reversal FROM public.budget_month_disposition_batches WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_reversal.request_fingerprint<>v_fingerprint OR v_reversal.reverses_batch_id<>p_batch_id THEN
      RAISE EXCEPTION 'request_key was already used for a different disposition reversal'
        USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'source',public.get_funded_budget_month((SELECT month FROM public.budget_month_funding_state WHERE budget_month_id=v_original.source_budget_month_id)),
      'destination',public.get_funded_budget_month((SELECT month FROM public.budget_month_funding_state WHERE budget_month_id=v_original.destination_budget_month_id)),
      'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
      'batch_id',v_reversal.id
    );
  END IF;

  LOCK TABLE public.transactions IN SHARE MODE;
  PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  PERFORM 1 FROM public.budget_months
    WHERE id IN(v_original.source_budget_month_id,v_original.destination_budget_month_id)
    ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.budgets
    WHERE budget_month_id IN(v_original.source_budget_month_id,v_original.destination_budget_month_id)
    ORDER BY id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.budget_month_disposition_batches
    WHERE reverses_batch_id=p_batch_id
  ) THEN
    RAISE EXCEPTION 'Month disposition batch % has already been reversed',p_batch_id
      USING ERRCODE='23505';
  END IF;
  SELECT * INTO v_source_month FROM public.budget_months WHERE id=v_original.source_budget_month_id;
  SELECT * INTO v_destination_month FROM public.budget_months WHERE id=v_original.destination_budget_month_id;
  IF EXISTS (
    SELECT 1 FROM public.budget_unused_disposition_events e
    JOIN public.budget_category_state cs ON cs.budget_id=e.source_budget_id
    WHERE e.batch_id=p_batch_id AND e.event_kind='apply' AND cs.lifecycle_state<>'active'
  ) THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_REVERSAL_BLOCKED: source category budget is inactive'
      USING ERRCODE='23514';
  END IF;
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_destination_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_original.destination_budget_month_id;
  IF v_destination_unallocated < coalesce((
    SELECT sum(amount) FROM public.budget_unused_disposition_events
    WHERE batch_id=p_batch_id AND event_kind='apply' AND policy='return_to_unallocated'
  ),0) THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_REVERSAL_BLOCKED: destination unallocated funding is insufficient'
      USING ERRCODE='23514';
  END IF;
  SELECT balance INTO v_savings_balance FROM public.budget_savings_state;
  IF v_savings_balance < coalesce((
    SELECT sum(amount) FROM public.budget_unused_disposition_events
    WHERE batch_id=p_batch_id AND event_kind='apply' AND policy='savings'
  ),0) THEN
    RAISE EXCEPTION 'MONTH_DISPOSITION_REVERSAL_BLOCKED: Savings retained funds are insufficient'
      USING ERRCODE='23514';
  END IF;

  INSERT INTO public.budget_month_disposition_batches(
    request_key,request_fingerprint,source_budget_month_id,destination_budget_month_id,reverses_batch_id
  ) VALUES(
    p_request_key,v_fingerprint,v_original.source_budget_month_id,
    v_original.destination_budget_month_id,p_batch_id
  ) RETURNING * INTO v_reversal;

  FOR original_event IN
    SELECT * FROM public.budget_unused_disposition_events
    WHERE batch_id=p_batch_id AND event_kind='apply' ORDER BY id
  LOOP
    v_source_operation_id:=NULL;
    v_destination_operation_id:=NULL;
    v_savings_entry_id:=NULL;
    v_transfer_id:=NULL;
    IF original_event.policy='carry_forward' THEN
      PERFORM public.reverse_budget_carryover(
        original_event.carryover_transfer_id,
        public.budget_derived_request_key(p_request_key,'carry-forward|'||original_event.id),
        coalesce(p_reason,'Month close correction')
      );
      SELECT id,source_operation_id,destination_operation_id
      INTO v_transfer_id,v_source_operation_id,v_destination_operation_id
      FROM public.budget_carryover_transfers
      WHERE reverses_transfer_id=original_event.carryover_transfer_id;
    ELSIF original_event.policy='return_to_unallocated' THEN
      SELECT id INTO v_source_funding_id FROM public.budget_funding_entries
        WHERE operation_id=original_event.source_operation_id;
      SELECT id INTO v_destination_funding_id FROM public.budget_funding_entries
        WHERE operation_id=original_event.destination_operation_id;

      INSERT INTO public.budget_operations(
        budget_month_id,request_key,request_fingerprint,operation_type,
        effective_date,reason,reverses_operation_id
      ) VALUES(
        v_original.destination_budget_month_id,
        public.budget_derived_request_key(p_request_key,'return-destination|'||original_event.id),
        v_fingerprint||'|destination|'||original_event.id,'unused_disposition_reversal',
        v_destination_month.month_start,p_reason,original_event.destination_operation_id
      ) RETURNING id INTO v_destination_operation_id;
      INSERT INTO public.budget_funding_entries(
        operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id
      ) VALUES(v_destination_operation_id,-original_event.amount,'unused_disposition_transfer',
        'Reverse unused funding returned from '||to_char(v_source_month.month_start,'YYYY-MM'),
        v_destination_funding_id);

      INSERT INTO public.budget_operations(
        budget_month_id,request_key,request_fingerprint,operation_type,
        effective_date,reason,reverses_operation_id
      ) VALUES(
        v_original.source_budget_month_id,
        public.budget_derived_request_key(p_request_key,'return-source|'||original_event.id),
        v_fingerprint||'|source|'||original_event.id,'unused_disposition_reversal',
        v_source_month.month_start,p_reason,original_event.source_operation_id
      ) RETURNING id INTO v_source_operation_id;
      INSERT INTO public.budget_funding_entries(
        operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id
      ) VALUES(v_source_operation_id,original_event.amount,'unused_disposition_transfer',
        'Restore unused funding from '||to_char(v_destination_month.month_start,'YYYY-MM'),
        v_source_funding_id);
      INSERT INTO public.budget_movements(operation_id,destination_budget_id,amount)
      VALUES(v_source_operation_id,original_event.source_budget_id,original_event.amount);
    ELSE
      SELECT id INTO v_source_funding_id FROM public.budget_funding_entries
        WHERE operation_id=original_event.source_operation_id;
      INSERT INTO public.budget_operations(
        budget_month_id,request_key,request_fingerprint,operation_type,
        effective_date,reason,reverses_operation_id
      ) VALUES(
        v_original.source_budget_month_id,
        public.budget_derived_request_key(p_request_key,'savings|'||original_event.id),
        v_fingerprint||'|savings|'||original_event.id,'unused_disposition_reversal',
        v_source_month.month_start,p_reason,original_event.source_operation_id
      ) RETURNING id INTO v_source_operation_id;
      INSERT INTO public.budget_funding_entries(
        operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id
      ) VALUES(v_source_operation_id,original_event.amount,'savings_transfer',
        'Restore retained Savings to source budget',v_source_funding_id);
      INSERT INTO public.budget_movements(operation_id,destination_budget_id,amount)
      VALUES(v_source_operation_id,original_event.source_budget_id,original_event.amount);
      INSERT INTO public.budget_savings_entries(
        operation_id,source_budget_month_id,source_budget_id,category_id,
        amount_delta,entry_kind,reverses_entry_id
      ) VALUES(
        v_source_operation_id,v_original.source_budget_month_id,original_event.source_budget_id,
        original_event.category_id,-original_event.amount,'reversal',original_event.savings_entry_id
      ) RETURNING id INTO v_savings_entry_id;
    END IF;

    INSERT INTO public.budget_unused_disposition_events(
      batch_id,category_id,source_budget_id,event_kind,policy,amount,
      source_final_funded_snapshot,source_raw_actual_snapshot,
      source_effective_actual_snapshot,source_operation_id,destination_operation_id,
      carryover_transfer_id,savings_entry_id,reverses_event_id
    ) VALUES(
      v_reversal.id,original_event.category_id,original_event.source_budget_id,
      'reversal',original_event.policy,original_event.amount,
      original_event.source_final_funded_snapshot,original_event.source_raw_actual_snapshot,
      original_event.source_effective_actual_snapshot,v_source_operation_id,
      v_destination_operation_id,v_transfer_id,v_savings_entry_id,original_event.id
    );
  END LOOP;

  PERFORM public.budget_assert_reconciled(v_original.source_budget_month_id);
  PERFORM public.budget_assert_reconciled(v_original.destination_budget_month_id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object(
    'source',public.get_funded_budget_month(to_char(v_source_month.month_start,'YYYY-MM')),
    'destination',public.get_funded_budget_month(to_char(v_destination_month.month_start,'YYYY-MM')),
    'savings',jsonb_build_object('balance',(SELECT balance_text FROM public.budget_savings_state)),
    'batch_id',v_reversal.id
  );
END; $$;

CREATE OR REPLACE FUNCTION public.validate_budget_disposition_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_batch public.budget_month_disposition_batches%ROWTYPE;
  v_budget public.budgets%ROWTYPE;
  v_source_operation public.budget_operations%ROWTYPE;
  v_destination_operation public.budget_operations%ROWTYPE;
  v_source_funding public.budget_funding_entries%ROWTYPE;
  v_destination_funding public.budget_funding_entries%ROWTYPE;
  v_source_movement public.budget_movements%ROWTYPE;
BEGIN
  SELECT * INTO v_batch FROM public.budget_month_disposition_batches WHERE id=NEW.batch_id;
  SELECT * INTO v_budget FROM public.budgets WHERE id=NEW.source_budget_id;
  SELECT * INTO v_source_operation FROM public.budget_operations WHERE id=NEW.source_operation_id;
  SELECT * INTO v_source_funding FROM public.budget_funding_entries WHERE operation_id=NEW.source_operation_id;
  SELECT * INTO v_source_movement FROM public.budget_movements WHERE operation_id=NEW.source_operation_id;
  IF v_budget.budget_month_id IS DISTINCT FROM v_batch.source_budget_month_id
     OR v_budget.category_id IS DISTINCT FROM NEW.category_id
     OR v_source_operation.budget_month_id IS DISTINCT FROM v_batch.source_budget_month_id THEN
    RAISE EXCEPTION 'Disposition source provenance does not match its batch/category'
      USING ERRCODE='23514';
  END IF;
  IF NEW.destination_operation_id IS NOT NULL THEN
    SELECT * INTO v_destination_operation FROM public.budget_operations
      WHERE id=NEW.destination_operation_id;
    SELECT * INTO v_destination_funding FROM public.budget_funding_entries
      WHERE operation_id=NEW.destination_operation_id;
    IF v_destination_operation.budget_month_id IS DISTINCT FROM v_batch.destination_budget_month_id THEN
      RAISE EXCEPTION 'Disposition destination operation does not match its batch'
        USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.policy='return_to_unallocated' AND NEW.event_kind='apply' AND (
       v_source_funding.source_kind<>'unused_disposition_transfer'
       OR v_source_funding.amount_delta<>-NEW.amount
       OR v_source_movement.source_budget_id IS DISTINCT FROM NEW.source_budget_id
       OR v_source_movement.destination_budget_id IS NOT NULL
       OR v_source_movement.amount<>NEW.amount
       OR v_destination_funding.source_kind<>'unused_disposition_transfer'
       OR v_destination_funding.amount_delta<>NEW.amount
       OR EXISTS(SELECT 1 FROM public.budget_movements WHERE operation_id=NEW.destination_operation_id)
     ) THEN
    RAISE EXCEPTION 'Return-to-unallocated operations are not a balanced cross-month transfer'
      USING ERRCODE='23514';
  END IF;
  IF NEW.event_kind='apply' AND (
    (NEW.policy='carry_forward' AND v_source_operation.operation_type<>'carryover_out')
    OR (NEW.policy='return_to_unallocated' AND
        (v_source_operation.operation_type<>'unused_return_out'
         OR v_destination_operation.operation_type<>'unused_return_in'))
    OR (NEW.policy='savings' AND v_source_operation.operation_type<>'unused_to_savings')
  ) THEN
    RAISE EXCEPTION 'Disposition operation types do not match the applied policy'
      USING ERRCODE='23514';
  END IF;
  IF NEW.event_kind='reversal' AND NEW.policy<>'carry_forward'
     AND v_source_operation.operation_type<>'unused_disposition_reversal' THEN
    RAISE EXCEPTION 'Disposition correction requires a compensating operation'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_disposition_events_validate
BEFORE INSERT ON public.budget_unused_disposition_events
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_disposition_event();

-- Preserve the Migration 020 canonical read and add policy, close history, and
-- the separate application-wide Savings balance. This wrapper remains STABLE.
ALTER FUNCTION public.get_funded_budget_month(TEXT)
  RENAME TO get_funded_budget_month_overrides;

CREATE OR REPLACE FUNCTION public.get_funded_budget_month(p_month TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_state JSONB:=public.get_funded_budget_month_overrides(p_month);
  v_categories JSONB;
  v_history JSONB;
BEGIN
  SELECT coalesce(jsonb_agg(
    item||jsonb_build_object('unused_balance_policy',p.policy)
    ORDER BY ordinality
  ),'[]'::jsonb)
  INTO v_categories
  FROM jsonb_array_elements(coalesce(v_state->'categories','[]'::jsonb))
    WITH ORDINALITY category(item,ordinality)
  LEFT JOIN public.budget_unused_balance_policies p
    ON p.category_id=NULLIF(item->>'category_id','')::bigint;

  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.event_id),'[]'::jsonb)
  INTO v_history
  FROM public.budget_month_disposition_history h
  WHERE h.source_month=p_month OR h.destination_month=p_month;

  RETURN v_state
    ||jsonb_build_object('categories',v_categories)
    ||jsonb_build_object('unused_disposition_history',v_history)
    ||jsonb_build_object('savings',jsonb_build_object(
      'balance',(SELECT balance_text FROM public.budget_savings_state)
    ));
END; $$;

ALTER TABLE public.budget_unused_balance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_month_disposition_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_unused_disposition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_savings_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.budget_unused_balance_policies,
  public.budget_carryover_settings,
  public.budget_carryover_settings_read,
  public.budget_unused_balance_policies_read,
  public.budget_month_disposition_batches,
  public.budget_unused_disposition_events,
  public.budget_savings_entries,
  public.budget_savings_state,
  public.budget_month_disposition_history
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.budget_unused_balance_policies,
  public.budget_unused_balance_policies_read,
  public.budget_month_disposition_batches,
  public.budget_unused_disposition_events,
  public.budget_savings_entries,
  public.budget_savings_state,
  public.budget_month_disposition_history
  TO service_role;

REVOKE ALL ON FUNCTION public.validate_budget_carryover_setting(),
  public.prevent_category_type_with_carryover(),
  public.validate_budget_disposition_batch(),
  public.validate_budget_savings_entry(),
  public.validate_budget_disposition_event(),
  public.budget_month_disposition_candidate_rows(TEXT),
  public.get_funded_budget_month_overrides(TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_budget_unused_balance_policy(BIGINT,TEXT),
  public.get_budget_month_disposition_preview(TEXT),
  public.apply_budget_month_disposition(TEXT,UUID,TEXT,TEXT),
  public.reverse_budget_month_disposition(BIGINT,UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_budget_carryover(TEXT,UUID,TEXT,TEXT)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.get_funded_budget_month(TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_funded_budget_month(TEXT),
  public.set_budget_unused_balance_policy(BIGINT,TEXT),
  public.get_budget_month_disposition_preview(TEXT),
  public.apply_budget_month_disposition(TEXT,UUID,TEXT,TEXT),
  public.reverse_budget_month_disposition(BIGINT,UUID,TEXT)
  TO service_role;

DO $$
DECLARE v_month RECORD;
BEGIN
  FOR v_month IN SELECT id FROM public.budget_months ORDER BY id LOOP
    PERFORM public.budget_assert_reconciled(v_month.id);
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.budget_savings_entries) THEN
    RAISE EXCEPTION 'Migration 021 must not create historical savings entries';
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_month_disposition_batches)
     OR EXISTS(SELECT 1 FROM public.budget_unused_disposition_events) THEN
    RAISE EXCEPTION 'Migration 021 must not create historical disposition provenance';
  END IF;
END; $$;

COMMIT;
