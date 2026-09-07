-- Migration 028: let an explicit monthly budget allocation exceed recorded spending.
--
-- The expense total remains the initial suggestion and the source of any resulting
-- deficit. It is not an allocation ceiling. Authoritative funding continues to be
-- validated through the selected source legs and their captured capacities.

BEGIN;

DO $$
DECLARE
  v_budget_tables INTEGER;
  v_budget_views INTEGER;
  v_preview_definition TEXT;
BEGIN
  SELECT count(*) INTO v_budget_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'budget%';
  SELECT count(*) INTO v_budget_views
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v' AND c.relname LIKE 'budget%';

  IF v_budget_tables<>11 OR v_budget_views<>9 THEN
    RAISE EXCEPTION 'Migration 028 requires the post-027 11-table/9-view Budget schema (found % tables, % views)',
      v_budget_tables,v_budget_views;
  END IF;
  IF to_regclass('public.budget_operation_items') IS NULL
     OR to_regclass('public.budget_category_composition') IS NULL
     OR to_regprocedure('public.budget_funding_source_rows(text,bigint)') IS NULL
     OR to_regprocedure('public.apply_budget_unbudgeted_resolution(text,bigint,numeric,jsonb,uuid,text,text)') IS NULL
     OR to_regprocedure('public.reverse_budget_unbudgeted_resolution(bigint,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Migration 028 requires the consolidated unbudgeted-resolution foundation through Migration 027';
  END IF;
  SELECT pg_get_functiondef('public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)'::regprocedure)
    INTO v_preview_definition;
  IF v_preview_definition NOT LIKE '%UNBUDGETED_RESOLUTION_EXCEEDS_ACTUAL%'
     OR v_preview_definition NOT LIKE '%maximum_allocation%' THEN
    RAISE EXCEPTION 'Migration 028 found an unexpected pre-migration unbudgeted preview contract';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'budget_carryover_batches','budget_carryover_transfers','budget_month_override_events',
      'budget_month_disposition_batches','budget_unused_disposition_events','budget_funding_actions',
      'budget_funding_action_legs','budget_unbudgeted_resolution_events'
    ]) retired(name) WHERE to_regclass('public.'||retired.name) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Migration 028 will not run with a retired Budget relation present';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_budget_unbudgeted_resolution_preview(
  p_month TEXT,p_category_id BIGINT,p_requested_amount NUMERIC,p_legs JSONB
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_month_start DATE:=public.budget_month_start_from_key(p_month);
  v_lifecycle TEXT:=public.budget_action_month_lifecycle(p_month);
  v_month_id BIGINT; v_category public.categories%ROWTYPE;
  v_budget_id BIGINT; v_budget_lifecycle TEXT; v_existing_funded NUMERIC(18,2):=0;
  v_mode TEXT:='created'; v_raw NUMERIC(18,2):=0; v_needed_to_cover_actual NUMERIC(18,2):=0;
  v_unallocated NUMERIC(18,2):=0; v_savings NUMERIC(18,2):=0;
  v_sources JSONB:='[]'::jsonb; v_selected JSONB:='[]'::jsonb;
  v_total NUMERIC(18,2):=0; v_resulting NUMERIC(18,2):=0; v_deficit NUMERIC(18,2):=0;
  v_reason TEXT; v_material TEXT:=''; v_seen TEXT[]:='{}';
  item JSONB; v_kind TEXT; v_amount NUMERIC(18,2); v_key TEXT; v_source RECORD;
  v_pending_override BOOLEAN:=false;
BEGIN
  IF p_requested_amount IS NULL OR p_requested_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_requested_amount<0 OR p_requested_amount<>round(p_requested_amount,2)
     OR p_requested_amount>9999999999999999.99 THEN
    RAISE EXCEPTION 'requested_amount must be a nonnegative two-decimal value' USING ERRCODE='22023';
  END IF;
  IF p_legs IS NULL OR jsonb_typeof(p_legs)<>'array' THEN
    RAISE EXCEPTION 'legs must be an array' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_category FROM public.categories WHERE id=p_category_id;
  IF NOT FOUND THEN v_reason:='INVALID_BUDGET_CATEGORY';
  ELSIF v_category.type<>'expense' THEN v_reason:='INVALID_BUDGET_CATEGORY';
  ELSIF NOT v_category.is_active THEN v_reason:='CATEGORY_NOT_ACTIVE';
  END IF;
  SELECT id INTO v_month_id FROM public.budget_months WHERE month_start=v_month_start;
  SELECT cs.budget_id,cs.lifecycle_state,cs.final_funded
    INTO v_budget_id,v_budget_lifecycle,v_existing_funded
  FROM public.budget_category_state cs
  WHERE cs.budget_month_id=v_month_id AND cs.category_id=p_category_id;
  IF FOUND THEN
    IF v_budget_lifecycle='active' THEN v_reason:=coalesce(v_reason,'NO_UNBUDGETED_EXPENSE');
    ELSE v_mode:='reactivated'; END IF;
  ELSE
    v_budget_id:=NULL; v_budget_lifecycle:='no_budget'; v_existing_funded:=0;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE movement_type='expense' AND category_id=p_category_id
      AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date
      AND total_amount::text IN ('NaN','Infinity','-Infinity')
  ) THEN
    RAISE EXCEPTION 'Unbudgeted actual spending contains a non-finite amount' USING ERRCODE='22003';
  END IF;
  SELECT coalesce(sum(total_amount),0)::numeric(18,2) INTO v_raw FROM public.transactions
  WHERE movement_type='expense' AND category_id=p_category_id
    AND transaction_date>=v_month_start AND transaction_date<(v_month_start+interval '1 month')::date;
  IF v_raw<=0 THEN v_reason:=coalesce(v_reason,'NO_UNBUDGETED_EXPENSE'); END IF;
  v_pending_override:=v_budget_id IS NULL AND EXISTS (
    SELECT 1 FROM public.budget_month_overrides
    WHERE budget_month_id=v_month_id AND category_id=p_category_id
  );
  IF v_pending_override THEN v_reason:=coalesce(v_reason,'UNBUDGETED_RESOLUTION_PENDING_OVERRIDE'); END IF;

  -- Recorded spending explains how much funding is needed to eliminate the
  -- existing deficit. It does not limit the monthly budget selected by the user.
  v_needed_to_cover_actual:=greatest(v_raw-v_existing_funded,0);
  IF p_requested_amount=0 AND (v_mode='created' OR v_existing_funded<v_raw) THEN
    v_reason:=coalesce(v_reason,'UNBUDGETED_RESOLUTION_REQUIRES_FUNDING');
  END IF;
  IF v_lifecycle='closed' THEN v_reason:='BUDGET_MONTH_ALREADY_CLOSED';
  ELSIF v_lifecycle NOT IN ('current','immediately_completed_unclosed') THEN
    v_reason:='BUDGET_ACTION_MONTH_FORBIDDEN';
  END IF;

  SELECT capacity INTO v_unallocated FROM public.budget_funding_source_rows(p_month,p_category_id)
  WHERE source_kind='unallocated';
  SELECT capacity INTO v_savings FROM public.budget_funding_source_rows(p_month,p_category_id)
  WHERE source_kind='savings';
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'category_id',s.category_id,'budget_id',s.budget_id,'category_name',s.category_name,
    'final_funded',s.final_funded::text,'raw_actual',s.raw_actual::text,
    'effective_actual',s.effective_actual::text,'capacity',s.capacity::text
  ) ORDER BY s.category_name,s.category_id),'[]'::jsonb) INTO v_sources
  FROM public.budget_funding_source_rows(p_month,p_category_id) s
  WHERE s.source_kind='category' AND s.capacity>0;

  FOR item IN SELECT value FROM jsonb_array_elements(p_legs) LOOP
    v_kind:=item->>'source_kind';
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR v_kind IS NULL OR v_kind NOT IN ('category','unallocated','savings')
       OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string'
       OR (item->>'amount')!~'^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Unbudgeted funding leg has an invalid source or money format' USING ERRCODE='22023';
    END IF;
    v_amount:=(item->>'amount')::numeric;
    IF v_amount<=0 OR v_amount>9999999999999999.99 THEN
      RAISE EXCEPTION 'Unbudgeted funding leg amount must be positive' USING ERRCODE='22023';
    END IF;
    v_key:=v_kind||':'||coalesce(item->>'category_id','');
    IF v_key=ANY(v_seen) THEN RAISE EXCEPTION 'Duplicate unbudgeted funding source' USING ERRCODE='22023'; END IF;
    v_seen:=array_append(v_seen,v_key);
    SELECT * INTO v_source FROM public.budget_funding_source_rows(p_month,p_category_id) s
    WHERE s.source_kind=v_kind
      AND (v_kind<>'category' OR s.category_id=NULLIF(item->>'category_id','')::bigint);
    IF NOT FOUND THEN
      v_reason:=coalesce(v_reason,'UNBUDGETED_RESOLUTION_SOURCE_INSUFFICIENT');
      SELECT NULL::text source_kind,NULL::bigint category_id,NULL::bigint budget_id,
        NULL::text category_name,NULL::numeric final_funded,NULL::numeric raw_actual,
        NULL::numeric effective_actual,0::numeric capacity INTO v_source;
    END IF;
    IF v_amount>v_source.capacity THEN v_reason:=coalesce(v_reason,
      CASE WHEN v_kind='savings' THEN 'SAVINGS_INSUFFICIENT' ELSE 'UNBUDGETED_RESOLUTION_SOURCE_INSUFFICIENT' END);
    END IF;
    v_total:=v_total+v_amount;
    v_selected:=v_selected||jsonb_build_array(jsonb_build_object(
      'source_kind',v_kind,'category_id',CASE WHEN v_kind='category' THEN v_source.category_id END,
      'source_budget_id',CASE WHEN v_kind='category' THEN v_source.budget_id END,
      'amount',v_amount::numeric(18,2)::text,
      'source_final_funded',CASE WHEN v_kind='category' THEN v_source.final_funded::text END,
      'source_raw_actual',CASE WHEN v_kind='category' THEN v_source.raw_actual::text END,
      'source_effective_actual',CASE WHEN v_kind='category' THEN v_source.effective_actual::text END,
      'source_capacity',v_source.capacity::numeric(18,2)::text));
    v_material:=v_material||'|'||v_key||'|'||v_amount::numeric(18,2)::text||'|'||v_source.capacity::text
      ||'|'||coalesce(v_source.budget_id::text,'')||'|'||coalesce(v_source.final_funded::text,'')
      ||'|'||coalesce(v_source.raw_actual::text,'')||'|'||coalesce(v_source.effective_actual::text,'');
  END LOOP;
  IF v_total<>p_requested_amount THEN
    v_reason:=coalesce(v_reason,'UNBUDGETED_RESOLUTION_LEG_TOTAL_MISMATCH');
  END IF;
  v_resulting:=v_existing_funded+p_requested_amount;
  v_deficit:=greatest(v_raw-v_resulting,0);
  RETURN jsonb_build_object(
    'month',p_month,'lifecycle',v_lifecycle,'category_id',p_category_id,
    'category',CASE WHEN v_category.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',v_category.id,'name',v_category.name,'icon',v_category.icon,'type',v_category.type,
      'is_active',v_category.is_active) END,
    'resolution_mode',v_mode,'budget_id',v_budget_id,'budget_lifecycle',v_budget_lifecycle,
    'raw_actual',v_raw::numeric(18,2)::text,
    'existing_funded',v_existing_funded::numeric(18,2)::text,
    'amount_needed_to_cover_actual',v_needed_to_cover_actual::numeric(18,2)::text,
    'requested_allocation',p_requested_amount::numeric(18,2)::text,
    'resulting_funded',v_resulting::numeric(18,2)::text,
    'remaining_deficit',v_deficit::numeric(18,2)::text,
    'unallocated_capacity',v_unallocated::numeric(18,2)::text,
    'savings_balance',v_savings::numeric(18,2)::text,
    'eligible_source_categories',v_sources,'selected_legs',v_selected,
    'pending_override',v_pending_override,
    'fingerprint',md5(concat_ws('|','unbudgeted',p_month,v_lifecycle,p_category_id,
      coalesce(v_category.type,''),coalesce(v_category.is_active::text,''),v_mode,
      coalesce(v_budget_id::text,''),v_budget_lifecycle,v_raw::text,v_existing_funded::text,
      p_requested_amount::numeric(18,2)::text,v_unallocated::text,v_savings::text,
      v_pending_override::text,v_material,coalesce(v_reason,''))),
    'can_apply',v_reason IS NULL,'reason',v_reason
  );
END; $$;

REVOKE ALL ON FUNCTION public.get_budget_unbudgeted_resolution_preview(TEXT,BIGINT,NUMERIC,JSONB)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_budget_unbudgeted_resolution_preview(TEXT,BIGINT,NUMERIC,JSONB)
  TO service_role;

DO $$
DECLARE
  v_budget_tables INTEGER;
  v_budget_views INTEGER;
  v_preview_definition TEXT;
BEGIN
  SELECT count(*) INTO v_budget_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'budget%';
  SELECT count(*) INTO v_budget_views
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v' AND c.relname LIKE 'budget%';
  SELECT pg_get_functiondef('public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)'::regprocedure)
    INTO v_preview_definition;

  IF v_budget_tables<>11 OR v_budget_views<>9 THEN
    RAISE EXCEPTION 'Migration 028 changed the approved Budget object boundary';
  END IF;
  IF v_preview_definition LIKE '%UNBUDGETED_RESOLUTION_EXCEEDS_ACTUAL%'
     OR v_preview_definition LIKE '%maximum_allocation%'
     OR v_preview_definition NOT LIKE '%amount_needed_to_cover_actual%' THEN
    RAISE EXCEPTION 'Migration 028 did not install the corrected allocation contract';
  END IF;
  IF EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
       WHERE p.oid='public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)'::regprocedure
         AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
     )
     OR has_function_privilege('anon','public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.get_budget_unbudgeted_resolution_preview(text,bigint,numeric,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Migration 028 found an unexpected preview RPC ACL';
  END IF;
  PERFORM public.budget_assert_reconciled(id) FROM public.budget_months;
END $$;

COMMIT;
