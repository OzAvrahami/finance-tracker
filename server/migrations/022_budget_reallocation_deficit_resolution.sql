-- Migration 022: funded reallocation and deficit resolution.
--
-- Planned moves are current-month only. Deficit resolution also supports the
-- immediately completed, still-unclosed month so Migration 021 close blockers
-- can be repaired explicitly. All financial history remains append-only.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.budget_months') IS NULL
     OR to_regclass('public.budget_category_base_state') IS NULL
     OR to_regclass('public.budget_month_disposition_batches') IS NULL
     OR to_regclass('public.budget_savings_entries') IS NULL
     OR to_regclass('public.budget_savings_state') IS NULL
     OR to_regprocedure('public.get_funded_budget_month(text)') IS NULL
     OR to_regprocedure('public.budget_assert_reconciled(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Migration 022 preflight: Migrations 017 through 021 are required';
  END IF;
  IF to_regclass('public.budget_funding_actions') IS NOT NULL
     OR to_regclass('public.budget_funding_action_legs') IS NOT NULL
     OR to_regclass('public.budget_category_funding_action_state') IS NOT NULL
     OR to_regprocedure('public.get_budget_reallocation_preview(text,text,bigint,text,bigint,numeric)') IS NOT NULL
     OR to_regprocedure('public.get_budget_deficit_resolution_preview(text,bigint,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 022 preflight: unexpected partial reallocation schema exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.budget_operations
    WHERE operation_type NOT IN (
      'legacy_import','manual_funding','establish_budget','adjustment','removal',
      'reactivation','copy','reversal','month_initialization','carryover_out',
      'carryover_in','monthly_override_set','monthly_override_remove',
      'unused_return_out','unused_return_in','unused_to_savings',
      'unused_disposition_reversal'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.budget_funding_entries
    WHERE source_kind NOT IN (
      'manual_available_funds','legacy_import','carryover_transfer',
      'unused_disposition_transfer','savings_transfer'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.budget_savings_entries
    WHERE entry_kind NOT IN ('deposit','reversal')
  ) THEN
    RAISE EXCEPTION 'Migration 022 preflight: unexpected funded-budget domain value';
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
    'unused_disposition_reversal','budget_reallocation','deficit_resolution',
    'funding_action_reversal'
  ));

ALTER TABLE public.budget_funding_entries
  DROP CONSTRAINT budget_funding_entries_source_kind_check,
  ADD CONSTRAINT budget_funding_entries_source_kind_check CHECK (
    source_kind IN (
      'manual_available_funds','legacy_import','carryover_transfer',
      'unused_disposition_transfer','savings_transfer','savings_withdrawal'
    )
  );

ALTER TABLE public.budget_savings_entries
  ADD COLUMN destination_budget_month_id BIGINT REFERENCES public.budget_months(id) ON DELETE RESTRICT,
  ADD COLUMN destination_budget_id BIGINT REFERENCES public.budgets(id) ON DELETE RESTRICT,
  ADD COLUMN movement_id BIGINT UNIQUE REFERENCES public.budget_movements(id) ON DELETE RESTRICT,
  ALTER COLUMN source_budget_month_id DROP NOT NULL,
  ALTER COLUMN source_budget_id DROP NOT NULL,
  DROP CONSTRAINT budget_savings_entries_entry_kind_check,
  DROP CONSTRAINT budget_savings_entries_check,
  ADD CONSTRAINT budget_savings_entries_entry_kind_check CHECK (
    entry_kind IN ('deposit','reversal','withdrawal','withdrawal_reversal')
  ),
  ADD CONSTRAINT budget_savings_entries_provenance_shape CHECK (
    (entry_kind='deposit' AND amount_delta>0 AND reverses_entry_id IS NULL
      AND source_budget_month_id IS NOT NULL AND source_budget_id IS NOT NULL
      AND destination_budget_month_id IS NULL AND destination_budget_id IS NULL
      AND movement_id IS NULL)
    OR
    (entry_kind='reversal' AND amount_delta<0 AND reverses_entry_id IS NOT NULL
      AND source_budget_month_id IS NOT NULL AND source_budget_id IS NOT NULL
      AND destination_budget_month_id IS NULL AND destination_budget_id IS NULL
      AND movement_id IS NULL)
    OR
    (entry_kind='withdrawal' AND amount_delta<0 AND reverses_entry_id IS NULL
      AND source_budget_month_id IS NULL AND source_budget_id IS NULL
      AND destination_budget_month_id IS NOT NULL AND destination_budget_id IS NOT NULL
      AND movement_id IS NOT NULL)
    OR
    (entry_kind='withdrawal_reversal' AND amount_delta>0 AND reverses_entry_id IS NOT NULL
      AND source_budget_month_id IS NULL AND source_budget_id IS NULL
      AND destination_budget_month_id IS NOT NULL AND destination_budget_id IS NOT NULL
      AND movement_id IS NOT NULL)
  );

CREATE TABLE public.budget_funding_actions (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  operation_id BIGINT NOT NULL UNIQUE REFERENCES public.budget_operations(id) ON DELETE RESTRICT,
  action_kind TEXT NOT NULL CHECK (action_kind IN (
    'planned_reallocation','deficit_resolution','reversal'
  )),
  budget_month_id BIGINT NOT NULL REFERENCES public.budget_months(id) ON DELETE RESTRICT,
  destination_budget_id BIGINT REFERENCES public.budgets(id) ON DELETE RESTRICT,
  requested_amount NUMERIC(18,2) NOT NULL,
  applied_amount NUMERIC(18,2) NOT NULL,
  destination_final_funded_snapshot NUMERIC(18,2),
  destination_raw_actual_snapshot NUMERIC(18,2),
  deficit_before NUMERIC(18,2),
  deficit_after NUMERIC(18,2),
  reversed_action_id BIGINT UNIQUE REFERENCES public.budget_funding_actions(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text,now()),
  CHECK (requested_amount::text NOT IN ('NaN','Infinity','-Infinity') AND requested_amount>0),
  CHECK (applied_amount::text NOT IN ('NaN','Infinity','-Infinity') AND applied_amount>0),
  CHECK (requested_amount=applied_amount),
  CHECK (destination_final_funded_snapshot IS NULL OR destination_final_funded_snapshot>=0),
  CHECK (deficit_before IS NULL OR deficit_before>=0),
  CHECK (deficit_after IS NULL OR deficit_after>=0),
  CHECK ((action_kind='reversal')=(reversed_action_id IS NOT NULL)),
  CHECK (action_kind<>'deficit_resolution' OR (
    destination_budget_id IS NOT NULL AND deficit_before>0
    AND applied_amount<=deficit_before AND deficit_after=deficit_before-applied_amount
  ))
);

CREATE TABLE public.budget_funding_action_legs (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  action_id BIGINT NOT NULL REFERENCES public.budget_funding_actions(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('category','unallocated','savings')),
  source_budget_id BIGINT REFERENCES public.budgets(id) ON DELETE RESTRICT,
  amount NUMERIC(18,2) NOT NULL,
  source_final_funded_snapshot NUMERIC(18,2),
  source_raw_actual_snapshot NUMERIC(18,2),
  source_effective_actual_snapshot NUMERIC(18,2),
  source_capacity_snapshot NUMERIC(18,2) NOT NULL,
  movement_id BIGINT NOT NULL UNIQUE REFERENCES public.budget_movements(id) ON DELETE RESTRICT,
  savings_entry_id BIGINT UNIQUE REFERENCES public.budget_savings_entries(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text,now()),
  CHECK (amount::text NOT IN ('NaN','Infinity','-Infinity') AND amount>0),
  CHECK (source_capacity_snapshot::text NOT IN ('NaN','Infinity','-Infinity')
         AND source_capacity_snapshot>=amount),
  CHECK (
    (source_kind='category' AND source_budget_id IS NOT NULL
      AND source_final_funded_snapshot IS NOT NULL
      AND source_raw_actual_snapshot IS NOT NULL
      AND source_effective_actual_snapshot IS NOT NULL
      AND savings_entry_id IS NULL)
    OR
    (source_kind='unallocated' AND source_budget_id IS NULL
      AND source_final_funded_snapshot IS NULL
      AND source_raw_actual_snapshot IS NULL
      AND source_effective_actual_snapshot IS NULL
      AND savings_entry_id IS NULL)
    OR
    (source_kind='savings' AND source_budget_id IS NULL
      AND source_final_funded_snapshot IS NULL
      AND source_raw_actual_snapshot IS NULL
      AND source_effective_actual_snapshot IS NULL
      AND savings_entry_id IS NOT NULL)
  )
);

CREATE INDEX idx_budget_funding_actions_month ON public.budget_funding_actions(budget_month_id,id);
CREATE INDEX idx_budget_funding_actions_destination ON public.budget_funding_actions(destination_budget_id,id);
CREATE INDEX idx_budget_funding_action_legs_action ON public.budget_funding_action_legs(action_id,id);
CREATE INDEX idx_budget_funding_action_legs_source ON public.budget_funding_action_legs(source_budget_id,id);

CREATE OR REPLACE FUNCTION public.budget_action_month_lifecycle(p_month TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_current_start DATE:=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
  v_month_id BIGINT;
BEGIN
  IF v_month_start=v_current_start THEN RETURN 'current'; END IF;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start;
  IF v_month_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.budget_month_disposition_batches
    WHERE source_budget_month_id=v_month_id AND reverses_batch_id IS NULL
  ) THEN
    RETURN 'closed';
  END IF;
  IF v_month_start=(v_current_start-interval '1 month')::date THEN
    RETURN 'immediately_completed_unclosed';
  END IF;
  IF v_month_start<v_current_start THEN RETURN 'historical_forbidden'; END IF;
  RETURN 'future_forbidden';
END; $$;

CREATE OR REPLACE FUNCTION public.validate_budget_funding_action()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_operation public.budget_operations%ROWTYPE; v_destination public.budgets%ROWTYPE;
BEGIN
  SELECT * INTO v_operation FROM public.budget_operations WHERE id=NEW.operation_id;
  IF v_operation.budget_month_id IS DISTINCT FROM NEW.budget_month_id
     OR (NEW.action_kind='planned_reallocation' AND v_operation.operation_type<>'budget_reallocation')
     OR (NEW.action_kind='deficit_resolution' AND v_operation.operation_type<>'deficit_resolution')
     OR (NEW.action_kind='reversal' AND v_operation.operation_type<>'funding_action_reversal') THEN
    RAISE EXCEPTION 'Funding action does not match its operation' USING ERRCODE='23514';
  END IF;
  IF NEW.destination_budget_id IS NOT NULL THEN
    SELECT * INTO v_destination FROM public.budgets WHERE id=NEW.destination_budget_id;
    IF v_destination.budget_month_id IS DISTINCT FROM NEW.budget_month_id THEN
      RAISE EXCEPTION 'Funding action destination belongs to another month' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.action_kind='reversal' AND NOT EXISTS (
    SELECT 1 FROM public.budget_funding_actions original
    WHERE original.id=NEW.reversed_action_id AND original.action_kind<>'reversal'
      AND original.budget_month_id=NEW.budget_month_id
  ) THEN
    RAISE EXCEPTION 'Funding action reversal does not match an original action' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_budget_funding_action_leg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_action public.budget_funding_actions%ROWTYPE;
  v_movement public.budget_movements%ROWTYPE;
  v_source public.budgets%ROWTYPE;
BEGIN
  SELECT * INTO v_action FROM public.budget_funding_actions WHERE id=NEW.action_id;
  SELECT * INTO v_movement FROM public.budget_movements WHERE id=NEW.movement_id;
  IF v_movement.operation_id IS DISTINCT FROM v_action.operation_id THEN
    RAISE EXCEPTION 'Funding action leg movement belongs to another operation' USING ERRCODE='23514';
  END IF;
  IF NEW.source_kind='category' THEN
    SELECT * INTO v_source FROM public.budgets WHERE id=NEW.source_budget_id;
    IF v_source.budget_month_id IS DISTINCT FROM v_action.budget_month_id THEN
      RAISE EXCEPTION 'Funding action source belongs to another month' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER budget_funding_actions_validate BEFORE INSERT ON public.budget_funding_actions
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_funding_action();
CREATE TRIGGER budget_funding_actions_immutable BEFORE UPDATE OR DELETE ON public.budget_funding_actions
FOR EACH ROW EXECUTE FUNCTION public.prevent_budget_history_mutation();
CREATE TRIGGER budget_funding_action_legs_validate BEFORE INSERT ON public.budget_funding_action_legs
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_funding_action_leg();
CREATE TRIGGER budget_funding_action_legs_immutable BEFORE UPDATE OR DELETE ON public.budget_funding_action_legs
FOR EACH ROW EXECUTE FUNCTION public.prevent_budget_history_mutation();

CREATE OR REPLACE FUNCTION public.validate_budget_savings_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_operation public.budget_operations%ROWTYPE;
  v_budget public.budgets%ROWTYPE;
  v_funding public.budget_funding_entries%ROWTYPE;
  v_movement public.budget_movements%ROWTYPE;
BEGIN
  SELECT * INTO v_operation FROM public.budget_operations WHERE id=NEW.operation_id;
  SELECT * INTO v_funding FROM public.budget_funding_entries WHERE operation_id=NEW.operation_id;
  IF NEW.entry_kind IN ('deposit','reversal') THEN
    SELECT * INTO v_budget FROM public.budgets WHERE id=NEW.source_budget_id;
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
       OR v_funding.amount_delta<>-NEW.amount_delta
       OR (NEW.entry_kind='deposit' AND (
         v_movement.source_budget_id IS DISTINCT FROM NEW.source_budget_id
         OR v_movement.destination_budget_id IS NOT NULL OR v_movement.amount<>NEW.amount_delta))
       OR (NEW.entry_kind='reversal' AND (
         v_movement.source_budget_id IS NOT NULL
         OR v_movement.destination_budget_id IS DISTINCT FROM NEW.source_budget_id
         OR v_movement.amount<>-NEW.amount_delta)) THEN
      RAISE EXCEPTION 'Savings funding and category movement are not balanced' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO v_budget FROM public.budgets WHERE id=NEW.destination_budget_id;
    SELECT * INTO v_movement FROM public.budget_movements WHERE id=NEW.movement_id;
    IF v_operation.budget_month_id IS DISTINCT FROM NEW.destination_budget_month_id
       OR v_budget.budget_month_id IS DISTINCT FROM NEW.destination_budget_month_id
       OR v_budget.category_id IS DISTINCT FROM NEW.category_id
       OR v_movement.operation_id IS DISTINCT FROM NEW.operation_id
       OR v_operation.operation_type NOT IN ('deficit_resolution','funding_action_reversal')
       OR v_funding.source_kind<>'savings_withdrawal'
       OR v_funding.amount_delta<>-NEW.amount_delta THEN
      RAISE EXCEPTION 'Savings withdrawal provenance is not balanced' USING ERRCODE='23514';
    END IF;
    IF NEW.entry_kind='withdrawal' AND (
      v_movement.source_budget_id IS NOT NULL
      OR v_movement.destination_budget_id IS DISTINCT FROM NEW.destination_budget_id
      OR v_movement.amount<>-NEW.amount_delta
    ) THEN
      RAISE EXCEPTION 'Savings withdrawal movement is not balanced' USING ERRCODE='23514';
    END IF;
    IF NEW.entry_kind='withdrawal_reversal' AND (
      v_movement.source_budget_id IS DISTINCT FROM NEW.destination_budget_id
      OR v_movement.destination_budget_id IS NOT NULL
      OR v_movement.amount<>NEW.amount_delta
      OR NOT EXISTS (
        SELECT 1 FROM public.budget_savings_entries original
        WHERE original.id=NEW.reverses_entry_id AND original.entry_kind='withdrawal'
          AND original.destination_budget_id=NEW.destination_budget_id
          AND original.amount_delta=-NEW.amount_delta
      )
    ) THEN
      RAISE EXCEPTION 'Savings withdrawal reversal does not match its withdrawal' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE VIEW public.budget_category_funding_action_state AS
SELECT cs.budget_id,
  coalesce(sum(m.amount) FILTER (WHERE m.destination_budget_id=cs.budget_id),0)::numeric(18,2)
    AS incoming_reallocation_resolution,
  coalesce(sum(m.amount) FILTER (WHERE m.source_budget_id=cs.budget_id),0)::numeric(18,2)
    AS outgoing_reallocation,
  (coalesce(sum(m.amount) FILTER (WHERE m.destination_budget_id=cs.budget_id),0)
   -coalesce(sum(m.amount) FILTER (WHERE m.source_budget_id=cs.budget_id),0))::numeric(18,2)
    AS net_funding_action_adjustment
FROM public.budget_category_state cs
LEFT JOIN public.budget_movements m
  ON m.source_budget_id=cs.budget_id OR m.destination_budget_id=cs.budget_id
LEFT JOIN public.budget_funding_actions a ON a.operation_id=m.operation_id
WHERE a.id IS NOT NULL OR m.id IS NULL
GROUP BY cs.budget_id;

CREATE VIEW public.budget_funding_action_history AS
SELECT a.id AS action_id,a.action_kind,to_char(bm.month_start,'YYYY-MM') AS month,
  a.destination_budget_id,a.requested_amount::numeric(18,2)::text AS requested_amount,
  a.applied_amount::numeric(18,2)::text AS applied_amount,
  a.destination_final_funded_snapshot::numeric(18,2)::text AS destination_final_funded_snapshot,
  a.destination_raw_actual_snapshot::numeric(18,2)::text AS destination_raw_actual_snapshot,
  a.deficit_before::numeric(18,2)::text AS deficit_before,
  a.deficit_after::numeric(18,2)::text AS deficit_after,a.reversed_action_id,a.created_at,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',l.id,'source_kind',l.source_kind,'source_budget_id',l.source_budget_id,
    'amount',l.amount::numeric(18,2)::text,
    'source_capacity_snapshot',l.source_capacity_snapshot::numeric(18,2)::text,
    'source_final_funded_snapshot',l.source_final_funded_snapshot::numeric(18,2)::text,
    'source_raw_actual_snapshot',l.source_raw_actual_snapshot::numeric(18,2)::text,
    'source_effective_actual_snapshot',l.source_effective_actual_snapshot::numeric(18,2)::text,
    'movement_id',l.movement_id,'savings_entry_id',l.savings_entry_id
  ) ORDER BY l.id) FROM public.budget_funding_action_legs l WHERE l.action_id=a.id),'[]'::jsonb) AS legs
FROM public.budget_funding_actions a JOIN public.budget_months bm ON bm.id=a.budget_month_id;

CREATE OR REPLACE FUNCTION public.get_budget_reallocation_preview(
  p_month TEXT,p_source_kind TEXT,p_source_category_id BIGINT,
  p_destination_kind TEXT,p_destination_category_id BIGINT,p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_lifecycle TEXT:=public.budget_action_month_lifecycle(p_month);
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_month_id BIGINT;
  v_source_budget_id BIGINT; v_source_final NUMERIC(18,2);
  v_source_lifecycle TEXT; v_source_type TEXT; v_source_active BOOLEAN;
  v_destination_budget_id BIGINT; v_destination_final NUMERIC(18,2);
  v_destination_lifecycle TEXT; v_destination_type TEXT; v_destination_active BOOLEAN;
  v_source_raw NUMERIC(18,2):=0; v_source_effective NUMERIC(18,2):=0;
  v_capacity NUMERIC(18,2):=0; v_unallocated NUMERIC(18,2):=0;
  v_destination_raw NUMERIC(18,2):=0; v_destination_after NUMERIC(18,2);
  v_reason TEXT; v_material TEXT; v_fingerprint TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_amount>9999999999999999.99 THEN
    RAISE EXCEPTION 'Reallocation amount must be a positive two-decimal value' USING ERRCODE='22023';
  END IF;
  IF p_source_kind IS NULL OR p_source_kind NOT IN ('category','unallocated')
     OR p_destination_kind IS NULL OR p_destination_kind NOT IN ('category','unallocated')
     OR (p_source_kind='unallocated' AND p_destination_kind='unallocated')
     OR (p_source_kind='category')<>(p_source_category_id IS NOT NULL)
     OR (p_destination_kind='category')<>(p_destination_category_id IS NOT NULL)
     OR (p_source_category_id IS NOT NULL AND p_source_category_id=p_destination_category_id) THEN
    RAISE EXCEPTION 'Invalid reallocation endpoints' USING ERRCODE='22023';
  END IF;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start;
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_month_id;
  IF NOT FOUND THEN v_unallocated:=0; END IF;

  IF p_source_kind='category' THEN
    SELECT cs.budget_id,cs.final_funded,cs.lifecycle_state,cs.category_type,c.is_active
    INTO v_source_budget_id,v_source_final,v_source_lifecycle,v_source_type,v_source_active
    FROM public.budget_category_state cs
    JOIN public.categories c ON c.id=cs.category_id
    WHERE cs.budget_month_id=v_month_id AND cs.category_id=p_source_category_id;
    IF NOT FOUND OR v_source_lifecycle<>'active' OR v_source_type<>'expense'
       OR NOT v_source_active THEN
      v_reason:='SOURCE_BUDGET_NOT_ACTIVE';
    ELSE
      SELECT coalesce(sum(total_amount),0)::numeric(18,2) INTO v_source_raw FROM public.transactions
      WHERE movement_type='expense' AND category_id=p_source_category_id
        AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date;
      v_source_effective:=greatest(v_source_raw,0);
      v_capacity:=greatest(v_source_final-v_source_effective,0);
    END IF;
  ELSE v_capacity:=v_unallocated;
  END IF;

  IF p_destination_kind='category' THEN
    SELECT cs.budget_id,cs.final_funded,cs.lifecycle_state,cs.category_type,c.is_active
    INTO v_destination_budget_id,v_destination_final,v_destination_lifecycle,v_destination_type,v_destination_active
    FROM public.budget_category_state cs
    JOIN public.categories c ON c.id=cs.category_id
    WHERE cs.budget_month_id=v_month_id AND cs.category_id=p_destination_category_id;
    IF NOT FOUND OR v_destination_lifecycle<>'active' OR v_destination_type<>'expense'
       OR NOT v_destination_active THEN
      v_reason:=coalesce(v_reason,'DESTINATION_BUDGET_NOT_ACTIVE');
    ELSE
      SELECT coalesce(sum(total_amount),0)::numeric(18,2) INTO v_destination_raw FROM public.transactions
      WHERE movement_type='expense' AND category_id=p_destination_category_id
        AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date;
      v_destination_after:=v_destination_final+p_amount;
    END IF;
  END IF;
  IF v_lifecycle='closed' THEN v_reason:='BUDGET_MONTH_ALREADY_CLOSED';
  ELSIF v_lifecycle='immediately_completed_unclosed' THEN v_reason:='COMPLETED_MONTH_REALLOCATION_FORBIDDEN';
  ELSIF v_lifecycle<>'current' THEN v_reason:='BUDGET_ACTION_MONTH_FORBIDDEN';
  ELSIF p_amount>v_capacity THEN v_reason:=coalesce(v_reason,'REALLOCATION_SOURCE_INSUFFICIENT');
  END IF;
  v_material:=concat_ws('|','reallocation',p_month,v_lifecycle,p_source_kind,
    coalesce(p_source_category_id::text,''),p_destination_kind,
    coalesce(p_destination_category_id::text,''),p_amount::numeric(18,2)::text,
    coalesce(v_source_budget_id::text,''),coalesce(v_source_final::text,''),
    v_source_raw::text,v_source_effective::text,v_capacity::text,
    coalesce(v_destination_budget_id::text,''),coalesce(v_destination_final::text,''),
    v_destination_raw::text,v_unallocated::text,coalesce(v_reason,''));
  v_fingerprint:=md5(v_material);
  RETURN jsonb_build_object(
    'month',p_month,'lifecycle',v_lifecycle,'source_kind',p_source_kind,
    'source_category_id',p_source_category_id,'source_budget_id',v_source_budget_id,
    'source_funded',coalesce(v_source_final,0)::numeric(18,2)::text,
    'source_raw_actual',v_source_raw::text,'source_effective_actual',v_source_effective::text,
    'source_capacity',v_capacity::text,'destination_kind',p_destination_kind,
    'destination_category_id',p_destination_category_id,'destination_budget_id',v_destination_budget_id,
    'destination_before',coalesce(v_destination_final,0)::numeric(18,2)::text,
    'destination_after',coalesce(v_destination_after,0)::numeric(18,2)::text,
    'destination_raw_actual',v_destination_raw::text,'unallocated_before',v_unallocated::text,
    'unallocated_after',(v_unallocated
      +CASE WHEN p_destination_kind='unallocated' THEN p_amount ELSE 0 END
      -CASE WHEN p_source_kind='unallocated' THEN p_amount ELSE 0 END)::numeric(18,2)::text,
    'requested_amount',p_amount::numeric(18,2)::text,'fingerprint',v_fingerprint,
    'can_apply',v_reason IS NULL,'reason',v_reason
  );
END; $$;

CREATE OR REPLACE FUNCTION public.apply_budget_reallocation(
  p_month TEXT,p_source_kind TEXT,p_source_category_id BIGINT,
  p_destination_kind TEXT,p_destination_category_id BIGINT,p_amount NUMERIC,
  p_request_key UUID,p_preview_fingerprint TEXT,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month); v_month_id BIGINT;
  v_existing public.budget_operations%ROWTYPE; v_preview JSONB; v_operation_id BIGINT;
  v_action_id BIGINT; v_movement_id BIGINT;
BEGIN
  IF p_request_key IS NULL OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'request_key and preview fingerprint are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'budget_reallocation'
       OR v_existing.request_fingerprint<>p_preview_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('action_id',(SELECT id FROM public.budget_funding_actions WHERE operation_id=v_existing.id),
      'state',public.get_funded_budget_month(p_month));
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month_id
    AND category_id IN (p_source_category_id,p_destination_category_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories
    WHERE id IN (p_source_category_id,p_destination_category_id) ORDER BY id FOR UPDATE;
  v_preview:=public.get_budget_reallocation_preview(p_month,p_source_kind,p_source_category_id,
    p_destination_kind,p_destination_category_id,p_amount);
  IF v_preview->>'fingerprint'<>p_preview_fingerprint THEN
    RAISE EXCEPTION 'BUDGET_REALLOCATION_PREVIEW_STALE: refresh the preview before applying'
      USING ERRCODE='40001';
  END IF;
  IF NOT (v_preview->>'can_apply')::boolean THEN
    RAISE EXCEPTION '%: reallocation cannot be applied',v_preview->>'reason' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.budget_operations(
    budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason
  ) VALUES(v_month_id,p_request_key,p_preview_fingerprint,'budget_reallocation',v_month_start,p_reason)
  RETURNING id INTO v_operation_id;
  INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
  VALUES(v_operation_id,NULLIF(v_preview->>'source_budget_id','')::bigint,
    NULLIF(v_preview->>'destination_budget_id','')::bigint,p_amount)
  RETURNING id INTO v_movement_id;
  INSERT INTO public.budget_funding_actions(
    operation_id,action_kind,budget_month_id,destination_budget_id,requested_amount,applied_amount,
    destination_final_funded_snapshot,destination_raw_actual_snapshot,deficit_before,deficit_after
  ) VALUES(v_operation_id,'planned_reallocation',v_month_id,
    NULLIF(v_preview->>'destination_budget_id','')::bigint,p_amount,p_amount,
    CASE WHEN p_destination_kind='category' THEN (v_preview->>'destination_before')::numeric END,
    CASE WHEN p_destination_kind='category' THEN (v_preview->>'destination_raw_actual')::numeric END,
    CASE WHEN p_destination_kind='category' THEN greatest((v_preview->>'destination_raw_actual')::numeric-(v_preview->>'destination_before')::numeric,0) END,
    CASE WHEN p_destination_kind='category' THEN greatest((v_preview->>'destination_raw_actual')::numeric-(v_preview->>'destination_after')::numeric,0) END
  ) RETURNING id INTO v_action_id;
  INSERT INTO public.budget_funding_action_legs(
    action_id,source_kind,source_budget_id,amount,source_final_funded_snapshot,
    source_raw_actual_snapshot,source_effective_actual_snapshot,source_capacity_snapshot,movement_id
  ) VALUES(v_action_id,p_source_kind,NULLIF(v_preview->>'source_budget_id','')::bigint,p_amount,
    CASE WHEN p_source_kind='category' THEN (v_preview->>'source_funded')::numeric END,
    CASE WHEN p_source_kind='category' THEN (v_preview->>'source_raw_actual')::numeric END,
    CASE WHEN p_source_kind='category' THEN (v_preview->>'source_effective_actual')::numeric END,
    (v_preview->>'source_capacity')::numeric,v_movement_id);
  PERFORM public.budget_assert_reconciled(v_month_id);
  RETURN jsonb_build_object('action_id',v_action_id,'state',public.get_funded_budget_month(p_month));
END; $$;

CREATE OR REPLACE FUNCTION public.get_budget_deficit_resolution_preview(
  p_month TEXT,p_destination_category_id BIGINT,p_legs JSONB
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_lifecycle TEXT:=public.budget_action_month_lifecycle(p_month);
  v_month_start DATE:=public.budget_month_start_from_key(p_month); v_month_id BIGINT;
  v_destination RECORD; v_raw NUMERIC(18,2):=0; v_deficit NUMERIC(18,2):=0;
  v_unallocated NUMERIC(18,2):=0; v_savings NUMERIC(18,2):=0;
  v_selected JSONB:='[]'::jsonb; v_sources JSONB:='[]'::jsonb;
  v_total NUMERIC(18,2):=0; v_reason TEXT; v_material TEXT:=''; v_seen TEXT[]:='{}';
  item JSONB; v_kind TEXT; v_amount NUMERIC(18,2); v_key TEXT;
  v_source_category_id BIGINT; v_source_budget_id BIGINT;
  v_source_final NUMERIC(18,2); v_source_lifecycle TEXT; v_source_type TEXT; v_source_active BOOLEAN;
  v_source_raw NUMERIC(18,2); v_source_effective NUMERIC(18,2); v_capacity NUMERIC(18,2);
BEGIN
  IF p_legs IS NULL OR jsonb_typeof(p_legs)<>'array' OR jsonb_array_length(p_legs)=0 THEN
    RAISE EXCEPTION 'At least one deficit funding leg is required' USING ERRCODE='22023';
  END IF;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start;
  SELECT cs.*,c.is_active INTO v_destination FROM public.budget_category_state cs
  JOIN public.categories c ON c.id=cs.category_id
  WHERE cs.budget_month_id=v_month_id AND cs.category_id=p_destination_category_id;
  IF NOT FOUND THEN v_reason:='NO_BUDGET_DESTINATION';
  ELSIF v_destination.lifecycle_state<>'active' OR v_destination.category_type<>'expense'
        OR NOT v_destination.is_active THEN v_reason:='DESTINATION_BUDGET_NOT_ACTIVE';
  ELSE
    SELECT coalesce(sum(total_amount),0)::numeric(18,2) INTO v_raw FROM public.transactions
    WHERE movement_type='expense' AND category_id=p_destination_category_id
      AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date;
    v_deficit:=greatest(v_raw-v_destination.final_funded,0);
    IF v_deficit<=0 THEN v_reason:='NO_ACTIVE_DEFICIT'; END IF;
  END IF;
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_unallocated
    FROM public.budget_month_funding_state WHERE budget_month_id=v_month_id;
  IF NOT FOUND THEN v_unallocated:=0; END IF;
  SELECT balance INTO v_savings FROM public.budget_savings_state;

  WITH actuals AS (
    SELECT category_id,coalesce(sum(total_amount),0)::numeric(18,2) raw_actual
    FROM public.transactions WHERE movement_type='expense'
      AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date
    GROUP BY category_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'category_id',cs.category_id,'budget_id',cs.budget_id,'category_name',cs.category_name,
    'final_funded',cs.final_funded::text,'raw_actual',coalesce(a.raw_actual,0)::text,
    'effective_actual',greatest(coalesce(a.raw_actual,0),0)::text,
    'capacity',greatest(cs.final_funded-greatest(coalesce(a.raw_actual,0),0),0)::numeric(18,2)::text
  ) ORDER BY cs.category_name,cs.category_id),'[]'::jsonb) INTO v_sources
  FROM public.budget_category_state cs JOIN public.categories c ON c.id=cs.category_id
  LEFT JOIN actuals a ON a.category_id=cs.category_id
  WHERE cs.budget_month_id=v_month_id AND cs.category_id<>p_destination_category_id
    AND cs.lifecycle_state='active' AND cs.category_type='expense' AND c.is_active
    AND greatest(cs.final_funded-greatest(coalesce(a.raw_actual,0),0),0)>0;

  FOR item IN SELECT value FROM jsonb_array_elements(p_legs) LOOP
    v_kind:=item->>'source_kind';
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR v_kind IS NULL OR v_kind NOT IN ('category','unallocated','savings')
       OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string'
       OR (item->>'amount')!~'^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Deficit funding leg has an invalid source or money format' USING ERRCODE='22023';
    END IF;
    v_amount:=(item->>'amount')::numeric;
    IF v_amount<=0 OR v_amount>9999999999999999.99 THEN
      RAISE EXCEPTION 'Deficit funding leg amount must be positive' USING ERRCODE='22023';
    END IF;
    v_key:=v_kind||':'||coalesce(item->>'category_id','');
    IF v_key=ANY(v_seen) THEN RAISE EXCEPTION 'Duplicate deficit funding source' USING ERRCODE='22023'; END IF;
    v_seen:=array_append(v_seen,v_key);
    v_source_category_id:=NULL; v_source_budget_id:=NULL; v_source_final:=NULL;
    v_source_lifecycle:=NULL; v_source_type:=NULL; v_source_active:=NULL;
    v_source_raw:=NULL; v_source_effective:=NULL;
    IF v_kind='category' THEN
      SELECT cs.category_id,cs.budget_id,cs.final_funded,cs.lifecycle_state,cs.category_type,c.is_active
      INTO v_source_category_id,v_source_budget_id,v_source_final,v_source_lifecycle,v_source_type,v_source_active
      FROM public.budget_category_state cs
      JOIN public.categories c ON c.id=cs.category_id
      WHERE cs.budget_month_id=v_month_id AND cs.category_id=NULLIF(item->>'category_id','')::bigint;
      IF NOT FOUND OR v_source_category_id=p_destination_category_id
         OR v_source_lifecycle<>'active' OR v_source_type<>'expense' OR NOT v_source_active THEN
        v_reason:=coalesce(v_reason,'SOURCE_BUDGET_NOT_ACTIVE'); v_capacity:=0;
      ELSE
        SELECT coalesce(sum(total_amount),0)::numeric(18,2) INTO v_source_raw FROM public.transactions
        WHERE movement_type='expense' AND category_id=v_source_category_id
          AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date;
        v_source_effective:=greatest(v_source_raw,0);
        v_capacity:=greatest(v_source_final-v_source_effective,0);
      END IF;
    ELSIF v_kind='unallocated' THEN v_capacity:=v_unallocated;
    ELSE v_capacity:=v_savings;
    END IF;
    IF v_amount>v_capacity THEN v_reason:=coalesce(v_reason,
      CASE WHEN v_kind='savings' THEN 'SAVINGS_INSUFFICIENT' ELSE 'DEFICIT_SOURCE_INSUFFICIENT' END);
    END IF;
    v_total:=v_total+v_amount;
    v_selected:=v_selected||jsonb_build_array(jsonb_build_object(
      'source_kind',v_kind,'category_id',CASE WHEN v_kind='category' THEN v_source_category_id END,
      'source_budget_id',CASE WHEN v_kind='category' THEN v_source_budget_id END,
      'amount',v_amount::numeric(18,2)::text,'source_final_funded',CASE WHEN v_kind='category' THEN v_source_final::text END,
      'source_raw_actual',CASE WHEN v_kind='category' THEN v_source_raw::text END,
      'source_effective_actual',CASE WHEN v_kind='category' THEN v_source_effective::text END,
      'source_capacity',v_capacity::numeric(18,2)::text));
    v_material:=v_material||'|'||v_key||'|'||v_amount::numeric(18,2)::text||'|'||v_capacity::text
      ||'|'||coalesce(v_source_budget_id::text,'')||'|'||coalesce(v_source_final::text,'')
      ||'|'||coalesce(v_source_raw::text,'')||'|'||coalesce(v_source_effective::text,'');
  END LOOP;
  IF v_lifecycle='closed' THEN v_reason:='BUDGET_MONTH_ALREADY_CLOSED';
  ELSIF v_lifecycle NOT IN ('current','immediately_completed_unclosed') THEN v_reason:='BUDGET_ACTION_MONTH_FORBIDDEN';
  ELSIF v_total>v_deficit THEN v_reason:=coalesce(v_reason,'DEFICIT_RESOLUTION_EXCEEDS_DEFICIT');
  END IF;
  RETURN jsonb_build_object(
    'month',p_month,'lifecycle',v_lifecycle,'destination_category_id',p_destination_category_id,
    'destination_budget_id',v_destination.budget_id,
    'current_funded',coalesce(v_destination.final_funded,0)::numeric(18,2)::text,
    'actual',v_raw::text,'deficit',v_deficit::text,'unallocated_capacity',v_unallocated::text,
    'savings_balance',v_savings::text,'eligible_source_categories',v_sources,
    'selected_legs',v_selected,'requested_resolution',v_total::numeric(18,2)::text,
    'resulting_funded',(coalesce(v_destination.final_funded,0)+v_total)::numeric(18,2)::text,
    'remaining_deficit',greatest(v_deficit-v_total,0)::numeric(18,2)::text,
    'fingerprint',md5(concat_ws('|','deficit',p_month,v_lifecycle,p_destination_category_id,
      coalesce(v_destination.budget_id::text,''),coalesce(v_destination.final_funded::text,''),
      v_raw::text,v_deficit::text,v_unallocated::text,v_savings::text,v_material,coalesce(v_reason,''))),
    'can_apply',v_reason IS NULL,'reason',v_reason
  );
END; $$;

CREATE OR REPLACE FUNCTION public.apply_budget_deficit_resolution(
  p_month TEXT,p_destination_category_id BIGINT,p_legs JSONB,p_request_key UUID,
  p_preview_fingerprint TEXT,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month); v_month_id BIGINT;
  v_existing public.budget_operations%ROWTYPE; v_preview JSONB; v_operation_id BIGINT;
  v_action_id BIGINT; v_movement_id BIGINT; v_savings_entry_id BIGINT;
  v_savings_total NUMERIC(18,2):=0; v_funding_id BIGINT; item JSONB;
BEGIN
  IF p_request_key IS NULL OR p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'request_key and preview fingerprint are required' USING ERRCODE='22023';
  END IF;
  IF p_legs IS NULL OR jsonb_typeof(p_legs)<>'array' OR jsonb_array_length(p_legs)=0 THEN
    RAISE EXCEPTION 'At least one deficit funding leg is required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'deficit_resolution'
       OR v_existing.request_fingerprint<>p_preview_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('action_id',(SELECT id FROM public.budget_funding_actions WHERE operation_id=v_existing.id),
      'state',public.get_funded_budget_month(p_month));
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_legs) AS leg(value)
    WHERE leg.value->>'source_kind'='savings') THEN
    PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  END IF;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_month_id
    AND category_id IN (
      SELECT p_destination_category_id UNION
      SELECT NULLIF(leg.value->>'category_id','')::bigint
      FROM jsonb_array_elements(p_legs) AS leg(value)
      WHERE leg.value->>'source_kind'='category'
    ) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.categories WHERE id IN (
      SELECT p_destination_category_id UNION
      SELECT NULLIF(leg.value->>'category_id','')::bigint
      FROM jsonb_array_elements(p_legs) AS leg(value)
      WHERE leg.value->>'source_kind'='category'
    ) ORDER BY id FOR UPDATE;
  v_preview:=public.get_budget_deficit_resolution_preview(p_month,p_destination_category_id,p_legs);
  IF v_preview->>'fingerprint'<>p_preview_fingerprint THEN
    RAISE EXCEPTION 'DEFICIT_RESOLUTION_PREVIEW_STALE: refresh the preview before applying'
      USING ERRCODE='40001';
  END IF;
  IF NOT (v_preview->>'can_apply')::boolean THEN
    RAISE EXCEPTION '%: deficit resolution cannot be applied',v_preview->>'reason' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.budget_operations(
    budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason
  ) VALUES(v_month_id,p_request_key,p_preview_fingerprint,'deficit_resolution',v_month_start,p_reason)
  RETURNING id INTO v_operation_id;
  INSERT INTO public.budget_funding_actions(
    operation_id,action_kind,budget_month_id,destination_budget_id,requested_amount,applied_amount,
    destination_final_funded_snapshot,destination_raw_actual_snapshot,deficit_before,deficit_after
  ) VALUES(v_operation_id,'deficit_resolution',v_month_id,(v_preview->>'destination_budget_id')::bigint,
    (v_preview->>'requested_resolution')::numeric,(v_preview->>'requested_resolution')::numeric,
    (v_preview->>'current_funded')::numeric,(v_preview->>'actual')::numeric,
    (v_preview->>'deficit')::numeric,(v_preview->>'remaining_deficit')::numeric)
  RETURNING id INTO v_action_id;
  SELECT coalesce(sum((leg.value->>'amount')::numeric),0) INTO v_savings_total
  FROM jsonb_array_elements(v_preview->'selected_legs') AS leg(value)
  WHERE leg.value->>'source_kind'='savings';
  IF v_savings_total>0 THEN
    INSERT INTO public.budget_funding_entries(operation_id,amount_delta,source_kind,source_label)
    VALUES(v_operation_id,v_savings_total,'savings_withdrawal','Explicit Savings-funded deficit resolution')
    RETURNING id INTO v_funding_id;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v_preview->'selected_legs') LOOP
    INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
    VALUES(v_operation_id,NULLIF(item->>'source_budget_id','')::bigint,
      (v_preview->>'destination_budget_id')::bigint,(item->>'amount')::numeric)
    RETURNING id INTO v_movement_id;
    v_savings_entry_id:=NULL;
    IF item->>'source_kind'='savings' THEN
      INSERT INTO public.budget_savings_entries(
        operation_id,category_id,amount_delta,entry_kind,destination_budget_month_id,
        destination_budget_id,movement_id
      ) VALUES(v_operation_id,p_destination_category_id,-(item->>'amount')::numeric,'withdrawal',
        v_month_id,(v_preview->>'destination_budget_id')::bigint,v_movement_id)
      RETURNING id INTO v_savings_entry_id;
    END IF;
    INSERT INTO public.budget_funding_action_legs(
      action_id,source_kind,source_budget_id,amount,source_final_funded_snapshot,
      source_raw_actual_snapshot,source_effective_actual_snapshot,source_capacity_snapshot,
      movement_id,savings_entry_id
    ) VALUES(v_action_id,item->>'source_kind',NULLIF(item->>'source_budget_id','')::bigint,
      (item->>'amount')::numeric,NULLIF(item->>'source_final_funded','')::numeric,
      NULLIF(item->>'source_raw_actual','')::numeric,NULLIF(item->>'source_effective_actual','')::numeric,
      (item->>'source_capacity')::numeric,v_movement_id,v_savings_entry_id);
  END LOOP;
  PERFORM public.budget_assert_reconciled(v_month_id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('action_id',v_action_id,
    'applied_amount',v_preview->>'requested_resolution','remaining_deficit',v_preview->>'remaining_deficit',
    'state',public.get_funded_budget_month(p_month));
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_budget_funding_action(
  p_action_id BIGINT,p_request_key UUID,p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_original public.budget_funding_actions%ROWTYPE; v_existing public.budget_operations%ROWTYPE;
  v_month public.budget_months%ROWTYPE; v_operation_id BIGINT; v_action_id BIGINT;
  v_fingerprint TEXT:='funding_action_reverse|'||coalesce(p_action_id::text,'');
  v_required_unallocated NUMERIC(18,2):=0; v_unallocated NUMERIC(18,2):=0;
  v_savings_total NUMERIC(18,2):=0; v_original_funding public.budget_funding_entries%ROWTYPE;
  v_destination_release NUMERIC(18,2):=0; v_destination_raw NUMERIC(18,2):=0;
  v_destination_effective NUMERIC(18,2):=0; v_destination_final NUMERIC(18,2):=0;
  v_movement_id BIGINT; v_savings_entry_id BIGINT; original_leg RECORD;
BEGIN
  IF p_action_id IS NULL OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'action_id and request_key are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_original FROM public.budget_funding_actions WHERE id=p_action_id AND action_kind<>'reversal';
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding action does not exist' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM public.budget_operations WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.operation_type<>'funding_action_reversal' OR v_existing.request_fingerprint<>v_fingerprint THEN
      RAISE EXCEPTION 'request_key was already used for a different budget operation' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('action_id',(SELECT id FROM public.budget_funding_actions WHERE operation_id=v_existing.id),
      'state',public.get_funded_budget_month((SELECT to_char(month_start,'YYYY-MM') FROM public.budget_months WHERE id=v_original.budget_month_id)));
  END IF;
  LOCK TABLE public.transactions IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.budget_funding_action_legs WHERE action_id=p_action_id AND source_kind='savings') THEN
    PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  END IF;
  SELECT * INTO v_month FROM public.budget_months WHERE id=v_original.budget_month_id FOR UPDATE;
  PERFORM 1 FROM public.budgets WHERE budget_month_id=v_original.budget_month_id ORDER BY id FOR UPDATE;
  IF public.budget_action_month_lifecycle(to_char(v_month.month_start,'YYYY-MM'))='closed' THEN
    RAISE EXCEPTION 'BUDGET_MONTH_ALREADY_CLOSED: closed months require a historical correction workflow' USING ERRCODE='23514';
  ELSIF public.budget_action_month_lifecycle(to_char(v_month.month_start,'YYYY-MM'))
        NOT IN ('current','immediately_completed_unclosed') THEN
    RAISE EXCEPTION 'BUDGET_ACTION_MONTH_FORBIDDEN: action is outside the allowed month lifecycle' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.budget_funding_actions WHERE reversed_action_id=p_action_id) THEN
    RAISE EXCEPTION 'Funding action has already been reversed' USING ERRCODE='23505';
  END IF;
  SELECT coalesce(sum(l.amount),0) INTO v_required_unallocated
  FROM public.budget_funding_action_legs l JOIN public.budget_movements m ON m.id=l.movement_id
  WHERE l.action_id=p_action_id AND l.source_kind='category' AND m.destination_budget_id IS NULL;
  SELECT coalesce(unallocated,0)::numeric(18,2) INTO v_unallocated
  FROM public.budget_month_funding_state WHERE budget_month_id=v_original.budget_month_id;
  IF v_required_unallocated>v_unallocated THEN
    RAISE EXCEPTION 'FUNDING_ACTION_REVERSAL_BLOCKED: unallocated funding is insufficient' USING ERRCODE='23514';
  END IF;
  IF v_original.destination_budget_id IS NOT NULL THEN
    SELECT coalesce(sum(l.amount),0) INTO v_destination_release FROM public.budget_funding_action_legs l
    JOIN public.budget_movements m ON m.id=l.movement_id
    WHERE l.action_id=p_action_id AND m.destination_budget_id=v_original.destination_budget_id;
    SELECT final_funded INTO v_destination_final FROM public.budget_category_state
    WHERE budget_id=v_original.destination_budget_id;
    IF v_destination_release>v_destination_final THEN
      RAISE EXCEPTION 'FUNDING_ACTION_REVERSAL_BLOCKED: destination funding is insufficient' USING ERRCODE='23514';
    END IF;
    -- A planned move cannot be reversed by releasing money already spent at
    -- the destination. Reversing an explicit deficit resolution intentionally
    -- restores the recorded deficit and is therefore a distinct correction.
    IF v_original.action_kind='planned_reallocation' THEN
      SELECT coalesce(sum(t.total_amount),0)::numeric(18,2) INTO v_destination_raw
      FROM public.transactions t JOIN public.budgets b ON b.category_id=t.category_id
      WHERE b.id=v_original.destination_budget_id AND t.movement_type='expense'
        AND t.transaction_date>=v_month.month_start
        AND t.transaction_date<(v_month.month_start+interval '1 month')::date;
      v_destination_effective:=greatest(v_destination_raw,0);
      IF v_destination_release>greatest(v_destination_final-v_destination_effective,0) THEN
        RAISE EXCEPTION 'FUNDING_ACTION_REVERSAL_BLOCKED: destination funding has been spent' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  INSERT INTO public.budget_operations(
    budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reason,reverses_operation_id
  ) VALUES(v_original.budget_month_id,p_request_key,v_fingerprint,'funding_action_reversal',
    v_month.month_start,p_reason,v_original.operation_id) RETURNING id INTO v_operation_id;
  INSERT INTO public.budget_funding_actions(
    operation_id,action_kind,budget_month_id,destination_budget_id,requested_amount,applied_amount,
    destination_final_funded_snapshot,destination_raw_actual_snapshot,deficit_before,deficit_after,reversed_action_id
  ) VALUES(v_operation_id,'reversal',v_original.budget_month_id,v_original.destination_budget_id,
    v_original.applied_amount,v_original.applied_amount,v_original.destination_final_funded_snapshot,
    v_original.destination_raw_actual_snapshot,v_original.deficit_before,v_original.deficit_after,p_action_id)
  RETURNING id INTO v_action_id;
  SELECT coalesce(sum(amount),0) INTO v_savings_total FROM public.budget_funding_action_legs
  WHERE action_id=p_action_id AND source_kind='savings';
  IF v_savings_total>0 THEN
    SELECT * INTO v_original_funding FROM public.budget_funding_entries WHERE operation_id=v_original.operation_id;
    INSERT INTO public.budget_funding_entries(
      operation_id,amount_delta,source_kind,source_label,reverses_funding_entry_id
    ) VALUES(v_operation_id,-v_savings_total,'savings_withdrawal','Reverse Savings-funded deficit resolution',v_original_funding.id);
  END IF;
  FOR original_leg IN
    SELECT l.*,m.source_budget_id AS original_source,m.destination_budget_id AS original_destination
    FROM public.budget_funding_action_legs l JOIN public.budget_movements m ON m.id=l.movement_id
    WHERE l.action_id=p_action_id ORDER BY l.id
  LOOP
    INSERT INTO public.budget_movements(operation_id,source_budget_id,destination_budget_id,amount)
    VALUES(v_operation_id,original_leg.original_destination,original_leg.original_source,original_leg.amount)
    RETURNING id INTO v_movement_id;
    v_savings_entry_id:=NULL;
    IF original_leg.source_kind='savings' THEN
      INSERT INTO public.budget_savings_entries(
        operation_id,category_id,amount_delta,entry_kind,reverses_entry_id,
        destination_budget_month_id,destination_budget_id,movement_id
      ) VALUES(v_operation_id,(SELECT category_id FROM public.budgets WHERE id=v_original.destination_budget_id),
        original_leg.amount,'withdrawal_reversal',original_leg.savings_entry_id,
        v_original.budget_month_id,v_original.destination_budget_id,v_movement_id)
      RETURNING id INTO v_savings_entry_id;
    END IF;
    INSERT INTO public.budget_funding_action_legs(
      action_id,source_kind,source_budget_id,amount,source_final_funded_snapshot,
      source_raw_actual_snapshot,source_effective_actual_snapshot,source_capacity_snapshot,
      movement_id,savings_entry_id
    ) VALUES(v_action_id,original_leg.source_kind,original_leg.source_budget_id,original_leg.amount,
      original_leg.source_final_funded_snapshot,original_leg.source_raw_actual_snapshot,
      original_leg.source_effective_actual_snapshot,original_leg.source_capacity_snapshot,
      v_movement_id,v_savings_entry_id);
  END LOOP;
  PERFORM public.budget_assert_reconciled(v_original.budget_month_id);
  IF (SELECT balance FROM public.budget_savings_state)<0 THEN
    RAISE EXCEPTION 'Savings ledger cannot have a negative balance' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('action_id',v_action_id,
    'state',public.get_funded_budget_month(to_char(v_month.month_start,'YYYY-MM')));
END; $$;

ALTER FUNCTION public.get_funded_budget_month(TEXT) RENAME TO get_funded_budget_month_disposition;

CREATE OR REPLACE FUNCTION public.get_funded_budget_month(p_month TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_state JSONB:=public.get_funded_budget_month_disposition(p_month); v_categories JSONB; v_history JSONB;
BEGIN
  SELECT coalesce(jsonb_agg(item||jsonb_build_object(
    'incoming_reallocation_resolution',coalesce(a.incoming_reallocation_resolution,0)::numeric(18,2)::text,
    'outgoing_reallocation',coalesce(a.outgoing_reallocation,0)::numeric(18,2)::text,
    'funding_action_adjustment_total',coalesce(a.net_funding_action_adjustment,0)::numeric(18,2)::text,
    'other_adjustments',(
      coalesce(NULLIF(item->>'other_adjustments','')::numeric,0)
      -coalesce(a.net_funding_action_adjustment,0)
    )::numeric(18,2)::text
  ) ORDER BY ordinality),'[]'::jsonb) INTO v_categories
  FROM jsonb_array_elements(coalesce(v_state->'categories','[]'::jsonb)) WITH ORDINALITY category(item,ordinality)
  LEFT JOIN public.budget_category_funding_action_state a
    ON a.budget_id=NULLIF(item->>'budget_id','')::bigint;
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.action_id),'[]'::jsonb) INTO v_history
  FROM public.budget_funding_action_history h WHERE h.month=p_month;
  RETURN v_state||jsonb_build_object('categories',v_categories,'funding_action_history',v_history,
    'action_lifecycle',public.budget_action_month_lifecycle(p_month));
END; $$;

ALTER TABLE public.budget_funding_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_funding_action_legs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.budget_funding_actions,public.budget_funding_action_legs,
  public.budget_category_funding_action_state,public.budget_funding_action_history
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.budget_funding_actions,public.budget_funding_action_legs,
  public.budget_category_funding_action_state,public.budget_funding_action_history
  TO service_role;

REVOKE ALL ON FUNCTION public.budget_action_month_lifecycle(TEXT),
  public.validate_budget_funding_action(),public.validate_budget_funding_action_leg(),
  public.get_funded_budget_month_disposition(TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_budget_reallocation_preview(TEXT,TEXT,BIGINT,TEXT,BIGINT,NUMERIC),
  public.apply_budget_reallocation(TEXT,TEXT,BIGINT,TEXT,BIGINT,NUMERIC,UUID,TEXT,TEXT),
  public.get_budget_deficit_resolution_preview(TEXT,BIGINT,JSONB),
  public.apply_budget_deficit_resolution(TEXT,BIGINT,JSONB,UUID,TEXT,TEXT),
  public.reverse_budget_funding_action(BIGINT,UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.get_funded_budget_month(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_funded_budget_month(TEXT),
  public.get_budget_reallocation_preview(TEXT,TEXT,BIGINT,TEXT,BIGINT,NUMERIC),
  public.apply_budget_reallocation(TEXT,TEXT,BIGINT,TEXT,BIGINT,NUMERIC,UUID,TEXT,TEXT),
  public.get_budget_deficit_resolution_preview(TEXT,BIGINT,JSONB),
  public.apply_budget_deficit_resolution(TEXT,BIGINT,JSONB,UUID,TEXT,TEXT),
  public.reverse_budget_funding_action(BIGINT,UUID,TEXT)
  TO service_role;

DO $$
DECLARE v_month RECORD;
BEGIN
  FOR v_month IN SELECT id FROM public.budget_months ORDER BY id LOOP
    PERFORM public.budget_assert_reconciled(v_month.id);
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.budget_funding_actions)
     OR EXISTS(SELECT 1 FROM public.budget_funding_action_legs)
     OR EXISTS(SELECT 1 FROM public.budget_savings_entries WHERE entry_kind IN ('withdrawal','withdrawal_reversal')) THEN
    RAISE EXCEPTION 'Migration 022 must not create historical reallocation or Savings withdrawal state';
  END IF;
END; $$;

COMMIT;
