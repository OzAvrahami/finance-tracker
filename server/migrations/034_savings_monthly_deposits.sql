-- Migration 034: Monthly Savings occurrences (SAV-06).
-- Requires 033. Function replacements only; no backfill or automatic activation.
BEGIN;

CREATE OR REPLACE FUNCTION public.savings_validate_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_month DATE; v_due DATE; v_plan_changed BOOLEAN;
BEGIN
  NEW.name=btrim(NEW.name); NEW.purpose=nullif(btrim(NEW.purpose),'');
  NEW.institution_name=nullif(btrim(NEW.institution_name),''); NEW.product_name=nullif(btrim(NEW.product_name),''); NEW.reference=nullif(btrim(NEW.reference),'');
  NEW.terms=nullif(btrim(NEW.terms),''); NEW.liquidity_notes=nullif(btrim(NEW.liquidity_notes),''); NEW.notes=nullif(btrim(NEW.notes),'');
  IF NOT isfinite(NEW.opened_on) OR NOT isfinite(NEW.tracking_start_date) OR NEW.tracking_start_date>timezone('Asia/Jerusalem',statement_timestamp())::date
     OR (NEW.target_date IS NOT NULL AND NOT isfinite(NEW.target_date)) OR (NEW.release_date IS NOT NULL AND NOT isfinite(NEW.release_date)) THEN
    RAISE EXCEPTION 'תאריך פתיחה או תחילת מעקב אינו תקין' USING ERRCODE='22023';
  END IF;
  IF NEW.status='archived' THEN NEW.auto_deposit_enabled=false; END IF;
  IF TG_OP='UPDATE' AND (NEW.opened_on,NEW.tracking_start_date,NEW.currency_code,NEW.creation_request_key,NEW.creation_fingerprint,NEW.created_at,NEW.id) IS DISTINCT FROM
    (OLD.opened_on,OLD.tracking_start_date,OLD.currency_code,OLD.creation_request_key,OLD.creation_fingerprint,OLD.created_at,OLD.id) THEN
    RAISE EXCEPTION 'לא ניתן לשנות את זהות החשבון או את גבול יתרת הפתיחה' USING ERRCODE='23514';
  END IF;
  v_plan_changed=TG_OP='INSERT';
  IF TG_OP='UPDATE' THEN
    v_plan_changed=(NEW.monthly_amount,NEW.monthly_day,NEW.plan_start_date,NEW.default_payment_source_id) IS DISTINCT FROM (OLD.monthly_amount,OLD.monthly_day,OLD.plan_start_date,OLD.default_payment_source_id);
    IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'יש לרענן את פרטי החיסכון ולנסות שוב' USING ERRCODE='40001'; END IF;
    IF v_plan_changed AND OLD.next_due_date<=timezone('Asia/Jerusalem',statement_timestamp())::date THEN
      RAISE EXCEPTION 'יש להסדיר או לדלג במפורש על המועד שהגיע לפני שינוי התוכנית' USING ERRCODE='22023',DETAIL='SAVINGS_PLAN_OVERDUE';
    END IF;
    NEW.plan_revision=OLD.plan_revision+CASE WHEN v_plan_changed THEN 1 ELSE 0 END;
    IF NOT v_plan_changed THEN
      NEW.next_due_date=OLD.next_due_date;
      IF NEW.next_due_date IS NOT NULL THEN
        v_month=date_trunc('month',NEW.next_due_date)::date;
        WHILE EXISTS(SELECT 1 FROM public.savings_entries WHERE account_id=NEW.id AND occurrence_month=v_month AND entry_action='post' AND occurrence_root_id IS NULL) LOOP
          v_month=(v_month+interval '1 month')::date;
        END LOOP;
        NEW.next_due_date=v_month+least(NEW.monthly_day,extract(day FROM v_month+interval '1 month - 1 day')::integer)-1;
      END IF;
    END IF;
  END IF;
  IF NEW.default_payment_source_id IS NOT NULL AND (TG_OP='INSERT' OR v_plan_changed OR NEW.auto_deposit_enabled) THEN
    PERFORM 1 FROM public.payment_sources WHERE id=NEW.default_payment_source_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'יש לבחור אמצעי תשלום פעיל לתוכנית' USING ERRCODE='22023'; END IF;
  END IF;
  IF v_plan_changed THEN
    IF num_nonnulls(NEW.monthly_amount,NEW.monthly_day,NEW.plan_start_date) NOT IN (0,3) THEN RAISE EXCEPTION 'לתוכנית יש להזין סכום, יום בחודש ותאריך התחלה' USING ERRCODE='22023'; END IF;
    IF NEW.monthly_amount IS NULL THEN NEW.next_due_date=NULL;
    ELSE
      IF NOT isfinite(NEW.plan_start_date) THEN RAISE EXCEPTION 'תאריך תחילת התוכנית אינו תקין' USING ERRCODE='22023'; END IF;
      v_month=date_trunc('month',NEW.plan_start_date)::date;
      LOOP
        v_due=v_month+least(NEW.monthly_day,extract(day FROM v_month+interval '1 month - 1 day')::integer)-1;
        EXIT WHEN v_due>=NEW.plan_start_date AND (TG_OP='INSERT' OR OLD.monthly_amount IS NULL OR v_due>timezone('Asia/Jerusalem',statement_timestamp())::date) AND NOT EXISTS (SELECT 1 FROM public.savings_entries WHERE account_id=NEW.id AND occurrence_month=v_month);
        v_month=(v_month+interval '1 month')::date;
      END LOOP;
      NEW.next_due_date=v_due;
    END IF;
  END IF;
  NEW.archived_at=CASE WHEN NEW.status='archived' THEN coalesce(NEW.archived_at,now()) ELSE NULL END;
  NEW.updated_at=now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.update_savings_account(p_account_id BIGINT,p_expected_revision BIGINT,p_request_key UUID,p_account JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_key TEXT; v_value JSONB; v public.savings_accounts%ROWTYPE; v_old public.savings_accounts%ROWTYPE; v_fingerprint TEXT;
BEGIN

  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'יש לנסות שוב בבידוד READ COMMITTED' USING ERRCODE='22023'; END IF;
  IF p_request_key IS NULL OR jsonb_typeof(p_account) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'חסרים פרטי חשבון או מזהה בקשה' USING ERRCODE='22023'; END IF;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_account) LOOP
    IF NOT (v_key=ANY(ARRAY['name','purpose','institution_name','product_name','reference','opened_on','tracking_start_date','target_amount','target_date','annual_interest_rate','terms','liquidity_notes','notes','release_date','monthly_amount','monthly_day','plan_start_date','default_payment_source_id','status','auto_deposit_enabled'])) THEN RAISE EXCEPTION 'שדה חשבון לא מוכר: %',v_key USING ERRCODE='22023'; END IF;
    IF v_value='null'::jsonb THEN CONTINUE; END IF;
    IF v_key IN ('target_amount','monthly_amount','annual_interest_rate') THEN
      IF jsonb_typeof(v_value)<>'string' OR (v_value#>>'{}') !~ (CASE WHEN v_key='annual_interest_rate' THEN '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$' ELSE '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' END) THEN RAISE EXCEPTION 'יש להזין סכום עשרוני מדויק ללא עיגול' USING ERRCODE='22023'; END IF;
      IF (v_value#>>'{}')::numeric> (CASE WHEN v_key='annual_interest_rate' THEN 100 ELSE 9999999999999999.99 END) THEN RAISE EXCEPTION 'הערך חורג מהטווח המותר' USING ERRCODE='22023'; END IF;
    ELSIF v_key IN ('opened_on','tracking_start_date','target_date','release_date','plan_start_date') THEN
      IF jsonb_typeof(v_value)<>'string' OR (v_value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR ((v_value#>>'{}')::date)::text<>(v_value#>>'{}') THEN RAISE EXCEPTION 'יש להזין תאריך לוח שנה תקין' USING ERRCODE='22023'; END IF;
    ELSIF v_key='default_payment_source_id' THEN
      IF jsonb_typeof(v_value)<>'string' OR (v_value#>>'{}') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'מזהה אמצעי תשלום אינו תקין' USING ERRCODE='22023'; END IF;
    ELSIF v_key='monthly_day' THEN
      IF (v_value#>>'{}') !~ '^[0-9]{1,2}$' THEN RAISE EXCEPTION 'יש לבחור יום בחודש' USING ERRCODE='22023'; END IF;
    ELSIF v_key='auto_deposit_enabled' THEN
      IF jsonb_typeof(v_value)<>'boolean' THEN RAISE EXCEPTION 'יש לבחור במפורש אם להפעיל רישום אוטומטי' USING ERRCODE='22023'; END IF;
    ELSIF jsonb_typeof(v_value)<>'string' THEN RAISE EXCEPTION 'ערך טקסט אינו תקין: %',v_key USING ERRCODE='22023'; END IF;
    IF v_key IN ('target_amount','monthly_amount') THEN
      p_account=jsonb_set(p_account,ARRAY[v_key],to_jsonb(((v_value#>>'{}')::numeric(18,2))::text));
    ELSIF v_key='annual_interest_rate' THEN
      p_account=jsonb_set(p_account,ARRAY[v_key],to_jsonb(((v_value#>>'{}')::numeric(12,6))::text));
    ELSIF v_key IN ('name','purpose','institution_name','product_name','reference','terms','liquidity_notes','notes','status') THEN
      p_account=jsonb_set(p_account,ARRAY[v_key],coalesce(to_jsonb(nullif(btrim(v_value#>>'{}'),'')),'null'::jsonb));
    END IF;
  END LOOP;
  LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));

  IF p_account ?| ARRAY['opened_on','tracking_start_date'] THEN RAISE EXCEPTION 'לא ניתן לערוך את תאריכי הפתיחה והמעקב' USING ERRCODE='22023'; END IF;
  PERFORM id FROM public.payment_sources WHERE id IN ((p_account->>'default_payment_source_id')::bigint,(SELECT default_payment_source_id FROM public.savings_accounts WHERE id=p_account_id)) ORDER BY id FOR UPDATE;
  SELECT * INTO v_old FROM public.savings_accounts WHERE id=p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'חשבון החיסכון לא נמצא' USING ERRCODE='P0002'; END IF;
  v_fingerprint=md5(jsonb_build_object('account',p_account_id::text,'expected_revision',p_expected_revision::text,'changes',p_account)::text);
  IF v_old.last_config_request_key=p_request_key THEN
    IF v_old.last_config_fingerprint<>v_fingerprint OR v_old.revision<>p_expected_revision+1 THEN RAISE EXCEPTION 'הבקשה אינה תואמת לגרסה השמורה; יש לרענן' USING ERRCODE='22023'; END IF;
    RETURN public.get_savings_account(v_old.id);
  END IF;
  IF p_expected_revision IS NULL OR v_old.revision<>p_expected_revision THEN RAISE EXCEPTION 'פרטי החיסכון השתנו; יש לרענן לפני שמירה' USING ERRCODE='22023'; END IF;
  v=jsonb_populate_record(v_old,p_account);
  UPDATE public.savings_accounts SET name=v.name,purpose=v.purpose,institution_name=v.institution_name,product_name=v.product_name,reference=v.reference,target_amount=v.target_amount,target_date=v.target_date,annual_interest_rate=v.annual_interest_rate,terms=v.terms,liquidity_notes=v.liquidity_notes,notes=v.notes,release_date=v.release_date,monthly_amount=v.monthly_amount,monthly_day=v.monthly_day,plan_start_date=v.plan_start_date,default_payment_source_id=v.default_payment_source_id,status=v.status,auto_deposit_enabled=v.auto_deposit_enabled,revision=v_old.revision+1,last_config_request_key=p_request_key,last_config_fingerprint=v_fingerprint WHERE id=p_account_id;
  RETURN public.get_savings_account(p_account_id)||jsonb_build_object('affected_account_ids',jsonb_build_array(p_account_id::text),'affected_months','[]'::jsonb,'affected_transaction_ids','[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.savings_post_event_locked(p_request_key UUID,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
<<cmd>>
DECLARE
  op TEXT=p_command->>'operation'; c JSONB=coalesce(p_command->'payload','{}');
  k TEXT; value JSONB; fp TEXT; reason TEXT=nullif(btrim(p_command->>'reason'),'');
  a public.savings_accounts%ROWTYPE; old_a public.savings_accounts%ROWTYPE;
  e public.savings_entries%ROWTYPE; t public.transactions%ROWTYPE;
  category public.categories%ROWTYPE; source public.payment_sources%ROWTYPE;
  account_id BIGINT; transaction_id INTEGER; category_id BIGINT; source_id BIGINT;
  amount NUMERIC; effective DATE; charge DATE; kind TEXT; action TEXT; revision BIGINT;
  reversed_id BIGINT; entry_id BIGINT; entry_index INTEGER=0; cash_fp TEXT;
  receipt JSONB; result JSONB; affected JSONB; months JSONB; reinstate BOOLEAN=false;
  occurrence DATE; due DATE; captured_plan BIGINT; fulfillment BOOLEAN=false; restore_skip BOOLEAN=false;
  claim public.savings_entries%ROWTYPE;
  old_overlap NUMERIC=0; new_overlap NUMERIC; reserve_balance NUMERIC;
  old_item public.budget_operation_items%ROWTYPE; month_id BIGINT; operation_id BIGINT; reserve_id BIGINT;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'יש לנסות שוב בבידוד READ COMMITTED' USING ERRCODE='22023';
  END IF;
  IF p_request_key IS NULL OR jsonb_typeof(c) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'חסרים פרטי פעולה ומזהה בקשה' USING ERRCODE='22023';
  END IF;
  FOR k,value IN SELECT j.key,j.value FROM jsonb_each(c) j LOOP
    IF NOT k=ANY(ARRAY['action','account_id','expected_revision','event_kind','amount','effective_date','transaction_id','expected_transaction_fingerprint','description','category_id','payment_source_id','charge_date','notes','reinstate','expected_destination_revision','cutoff_confirmed','legacy_overlap_amount','overlap_reason','expected_reserve_fingerprint','occurrence_month','expected_due_date','plan_revision','plan_override','reason']) THEN
      RAISE EXCEPTION 'שדה שאינו נתמך בפעולת חיסכון: %',k USING ERRCODE='22023';
    END IF;
    IF value='null'::jsonb THEN CONTINUE; END IF;
    IF k IN ('amount','legacy_overlap_amount') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' OR (value#>>'{}')::numeric>9999999999999999.99 THEN
        RAISE EXCEPTION 'יש להזין סכום מדויק בשקלים עם עד שתי ספרות עשרוניות' USING ERRCODE='22023',DETAIL='SAVINGS_EXACT_MONEY_REQUIRED';
      END IF;
      c=jsonb_set(c,ARRAY[k],to_jsonb(((value#>>'{}')::numeric(18,2))::text));
    ELSIF k IN ('account_id','expected_revision','transaction_id','category_id','payment_source_id','expected_destination_revision') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'מזהה או גרסה אינם תקינים' USING ERRCODE='22023';
      END IF;
    ELSIF k='plan_revision' THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'גרסת התוכנית אינה תקינה' USING ERRCODE='22023'; END IF;
    ELSIF k IN ('effective_date','charge_date','occurrence_month','expected_due_date') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR ((value#>>'{}')::date)::text<>(value#>>'{}') THEN
        RAISE EXCEPTION 'יש להזין תאריך לוח שנה תקין' USING ERRCODE='22023';
      END IF;
    ELSIF k IN ('reinstate','cutoff_confirmed','plan_override') THEN
      IF jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'חסר אישור מפורש לפעולה' USING ERRCODE='22023'; END IF;
    ELSIF jsonb_typeof(value)<>'string' THEN RAISE EXCEPTION 'ערך טקסט אינו תקין' USING ERRCODE='22023';
    ELSE c=jsonb_set(c,ARRAY[k],coalesce(to_jsonb(nullif(btrim(value#>>'{}'),'')),'null'::jsonb)); END IF;
  END LOOP;
  IF op='post_savings_event' THEN reason=nullif(btrim(c->>'reason'),''); END IF;
  IF op NOT IN ('post_savings_event','correct_savings_event','cancel_savings_event','void_detached_savings_transaction') THEN RAISE EXCEPTION 'פעולה לא נתמכת' USING ERRCODE='22023'; END IF;
  IF op<>'post_savings_event' AND (reason IS NULL OR length(reason)>2000) THEN RAISE EXCEPTION 'יש להזין סיבה לתיקון או לביטול, עד 2000 תווים' USING ERRCODE='22023'; END IF;
  LOCK TABLE public.transactions IN SHARE ROW EXCLUSIVE MODE;
  -- Reserve operations precede row locks, including an opening correction.
  IF op='correct_savings_event' AND EXISTS(SELECT 1 FROM public.savings_entries WHERE id=(p_command->>'entry_id')::bigint AND event_kind='opening') THEN
    LOCK TABLE public.budget_unused_balance_policies IN SHARE ROW EXCLUSIVE MODE;
    PERFORM pg_advisory_xact_lock(hashtext('finance_tracker_budget_savings'));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
  fp=md5((p_command||jsonb_build_object('payload',c,'reason',reason))::text);
  SELECT jsonb_agg(id::text ORDER BY command_index) INTO receipt FROM public.savings_entries WHERE command_id=p_request_key;
  IF receipt IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.savings_entries WHERE command_id=p_request_key AND (command_kind<>op OR command_fingerprint<>fp)) THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר שימש לפרטים אחרים' USING ERRCODE='40001',DETAIL='SAVINGS_LINK_CONFLICT';
    END IF;
    SELECT jsonb_agg(DISTINCT se.account_id::text) INTO affected FROM public.savings_entries se WHERE command_id=p_request_key;
    RETURN jsonb_build_object('entry_ids',receipt,'replayed',true,'affected_account_ids',affected,
      'affected_transaction_ids',(SELECT coalesce(jsonb_agg(DISTINCT se.transaction_id::text) FILTER(WHERE se.transaction_id IS NOT NULL),'[]') FROM public.savings_entries se WHERE command_id=p_request_key),
      'affected_months',(SELECT jsonb_agg(DISTINCT to_char(se.effective_date,'YYYY-MM')) FROM public.savings_entries se WHERE command_id=p_request_key));
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions WHERE void_request_key=p_request_key) AND op<>'void_detached_savings_transaction' THEN
    RAISE EXCEPTION 'מזהה הבקשה כבר שימש לביטול תנועה' USING ERRCODE='40001';
  END IF;
  IF op IN ('correct_savings_event','cancel_savings_event') THEN
    SELECT * INTO e FROM public.savings_entries WHERE id=(p_command->>'entry_id')::bigint;
    IF NOT FOUND OR e.entry_action<>'post' THEN RAISE EXCEPTION 'אירוע החיסכון לא נמצא' USING ERRCODE='P0002'; END IF;
    IF e.event_kind NOT IN ('opening','deposit','withdrawal','interest_capitalized','interest_payout','occurrence_skip') OR e.source_kind='budget_surplus' THEN
      RAISE EXCEPTION 'אירוע זה מחייב את פעולת הריבית, המועד או העודף הייעודית' USING ERRCODE='22023';
    END IF;
    reinstate=coalesce((c->>'reinstate')::boolean,false);
    restore_skip=reinstate AND e.event_kind='occurrence_skip';
    IF ((NOT restore_skip) AND ((e.reversed_by_entry_id IS NOT NULL) IS DISTINCT FROM reinstate)) OR EXISTS(SELECT 1 FROM public.savings_entries WHERE supersedes_entry_id=e.id) THEN
      RAISE EXCEPTION 'האירוע השתנה או כבר הוחלף; יש לרענן' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE';
    END IF;
    IF op='cancel_savings_event' AND (reinstate OR e.event_kind='opening') THEN RAISE EXCEPTION 'אין לבטל יתרת פתיחה או אירוע שכבר בוטל' USING ERRCODE='22023'; END IF;
    account_id=coalesce((c->>'account_id')::bigint,e.account_id);
    transaction_id=e.transaction_id;
  ELSE account_id=(c->>'account_id')::bigint; transaction_id=(c->>'transaction_id')::integer; END IF;
  action=c->>'action';
  IF op='post_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash','noncash','due','skip')) THEN RAISE EXCEPTION 'יש לבחור רישום כספי, קישור או ריבית בחיסכון' USING ERRCODE='22023'; END IF;
  IF op='correct_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash','detach','noncash')) THEN RAISE EXCEPTION 'יש לבחור תיקון, ניתוק או החזרה מפורשת' USING ERRCODE='22023'; END IF;
  IF op='cancel_savings_event' AND action IS DISTINCT FROM (CASE WHEN e.event_kind IN ('interest_capitalized','occurrence_skip') THEN 'none' ELSE 'void' END) THEN
    RAISE EXCEPTION 'לניתוק ללא ביטול הכסף יש לבחור קטגוריה רגילה בטופס התיקון' USING ERRCODE='22023';
  END IF;
  category_id=(c->>'category_id')::bigint; source_id=(c->>'payment_source_id')::bigint;
  kind=coalesce(c->>'event_kind',e.event_kind); amount=(c->>'amount')::numeric;
  effective=(c->>'effective_date')::date; charge=(c->>'charge_date')::date;
  -- Consistent coarse-to-fine lock order. The complete set is intentionally
  -- conservative for the single-user database and foundation deferred scans.
  PERFORM id FROM public.budget_months ORDER BY id FOR UPDATE;
  PERFORM id FROM public.budgets ORDER BY id FOR UPDATE;
  PERFORM id FROM public.categories ORDER BY id FOR UPDATE;
  PERFORM id FROM public.payment_sources ORDER BY id FOR UPDATE;
  IF op<>'void_detached_savings_transaction' THEN PERFORM id FROM public.savings_accounts ORDER BY id FOR UPDATE; END IF;
  IF transaction_id IS NOT NULL THEN
    PERFORM id FROM public.transactions WHERE id=transaction_id FOR UPDATE;
    SELECT * INTO t FROM public.transactions WHERE id=transaction_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'התנועה לא נמצאה' USING ERRCODE='P0002'; END IF;
    cash_fp=md5((to_jsonb(t)-ARRAY['updated_at','voided_at','void_request_key','void_fingerprint','void_reason'])::text);
  END IF;
  IF op='void_detached_savings_transaction' THEN
    IF t.void_request_key=p_request_key THEN
      IF t.void_fingerprint<>fp THEN RAISE EXCEPTION 'קבלת הביטול אינה תואמת לבקשה' USING ERRCODE='40001'; END IF;
      RETURN jsonb_build_object('replayed',true,'transaction_id',t.id::text,'affected_transaction_ids',jsonb_build_array(t.id::text),'affected_account_ids','[]'::jsonb,'affected_months',jsonb_build_array(to_char(t.transaction_date,'YYYY-MM')));
    END IF;
    IF t.voided_at IS NOT NULL OR cash_fp IS DISTINCT FROM c->>'expected_transaction_fingerprint'
      OR NOT EXISTS(SELECT 1 FROM public.savings_entries WHERE savings_entries.transaction_id=t.id)
      OR EXISTS(SELECT 1 FROM public.savings_entries WHERE savings_entries.transaction_id=t.id AND entry_action='post' AND reversed_by_entry_id IS NULL)
      OR EXISTS(SELECT 1 FROM public.categories WHERE id=t.category_id AND savings_role IS NOT NULL) THEN
      RAISE EXCEPTION 'התנועה אינה מנותקת וחיה או השתנתה; יש לרענן' USING ERRCODE='40001',DETAIL='SAVINGS_LINK_CONFLICT';
    END IF;
  ELSE
    SELECT * INTO a FROM public.savings_accounts WHERE id=account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'חשבון החיסכון לא נמצא' USING ERRCODE='P0002'; END IF;
    IF op='post_savings_event' AND (c->>'occurrence_month' IS NOT NULL OR action IN ('due','skip')) THEN
      occurrence=(c->>'occurrence_month')::date; due=(c->>'expected_due_date')::date; captured_plan=(c->>'plan_revision')::bigint;
      IF occurrence IS NULL OR due IS NULL OR captured_plan IS NULL OR occurrence<>date_trunc('month',due)::date THEN
        RAISE EXCEPTION 'חסרים חודש מתוכנן, מועד וגרסת תוכנית' USING ERRCODE='22023';
      END IF;
      SELECT * INTO claim FROM public.savings_entries se WHERE se.account_id=a.id AND se.occurrence_month=occurrence AND se.entry_action='post' AND se.occurrence_root_id IS NULL;
      IF FOUND THEN
        IF action='due' THEN RETURN jsonb_build_object('status','already_claimed','entry_id',claim.id::text,'affected_account_ids',jsonb_build_array(a.id::text),'affected_transaction_ids','[]'::jsonb,'affected_months','[]'::jsonb); END IF;
        RAISE EXCEPTION 'המועד כבר הוסדר, גם אם ההפקדה בוטלה; להחזרה יש לבחור את האירוע בהיסטוריה' USING ERRCODE='40001',DETAIL='SAVINGS_OCCURRENCE_CLAIMED';
      END IF;
      IF a.status<>'active' OR a.next_due_date IS DISTINCT FROM due OR a.plan_revision<>captured_plan
        OR due>timezone('Asia/Jerusalem',statement_timestamp())::date OR (action='due' AND NOT a.auto_deposit_enabled) THEN
        RAISE EXCEPTION 'המועד, מצב החשבון או התוכנית השתנו או טרם הגיעו; יש לרענן' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE';
      END IF;
      IF action='due' THEN
        IF c ?| ARRAY['amount','effective_date','transaction_id','category_id','payment_source_id','charge_date','event_kind','description','notes','plan_override','cutoff_confirmed'] THEN RAISE EXCEPTION 'הרישום האוטומטי נגזר מהתוכנית בלבד' USING ERRCODE='22023'; END IF;
        kind='deposit'; amount=a.monthly_amount; effective=timezone('Asia/Jerusalem',statement_timestamp())::date; charge=effective; source_id=a.default_payment_source_id;
        SELECT id INTO category_id FROM public.categories WHERE savings_role='deposit' AND is_active;
        c=c||jsonb_build_object('description','הפקדה חודשית — '||a.name,'cutoff_confirmed',true);
        action='create_cash';
      ELSIF action='skip' THEN
        IF a.revision IS DISTINCT FROM (c->>'expected_revision')::bigint THEN RAISE EXCEPTION 'יש לרענן את החיסכון' USING ERRCODE='40001'; END IF;
        IF reason IS NULL OR length(reason)>2000 OR c ?| ARRAY['transaction_id','amount','effective_date','category_id','payment_source_id','charge_date','event_kind'] THEN RAISE EXCEPTION 'דילוג מחייב סיבה וללא פרטי כסף' USING ERRCODE='22023'; END IF;
        INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,occurrence_month,scheduled_due_date,plan_revision,reason)
        VALUES(a.id,p_request_key,0,op,fp,'occurrence_skip',0,due,'schedule_control',occurrence,due,captured_plan,reason) RETURNING id INTO entry_id;
        UPDATE public.savings_accounts SET revision=savings_accounts.revision+1 WHERE id=a.id;
        RETURN jsonb_build_object('status','skipped','entry_id',entry_id::text,'affected_account_ids',jsonb_build_array(a.id::text),'affected_transaction_ids','[]'::jsonb,'affected_months','[]'::jsonb);
      ELSE
        IF action NOT IN ('create_cash','link_cash') OR kind IS DISTINCT FROM 'deposit' THEN RAISE EXCEPTION 'רק הפקדה מפורשת יכולה להסדיר מועד' USING ERRCODE='22023'; END IF;
        IF (amount,source_id) IS DISTINCT FROM (a.monthly_amount,a.default_payment_source_id) AND (c->'plan_override' IS DISTINCT FROM 'true'::jsonb OR reason IS NULL OR length(reason)>2000) THEN
          RAISE EXCEPTION 'הסכום או המקור שונים מהתוכנית; נדרש אישור חריגה מפורש וסיבה' USING ERRCODE='22023';
        END IF;
        IF action='link_cash' THEN
          SELECT * INTO e FROM public.savings_entries se WHERE se.transaction_id=t.id AND se.entry_action='post' AND se.reversed_by_entry_id IS NULL;
          IF FOUND THEN
            IF e.account_id<>a.id OR e.event_kind<>'deposit' OR e.occurrence_month IS NOT NULL OR e.source_kind NOT IN ('manual','existing_transaction') OR (e.amount,e.effective_date,e.cash_payment_source_id,e.cash_category_id,e.cash_charge_date) IS DISTINCT FROM (amount,effective,source_id,category_id,charge) THEN
              RAISE EXCEPTION 'ההפקדה המקושרת אינה מתאימה להסדרת המועד הזה' USING ERRCODE='22023',DETAIL='SAVINGS_LINK_CONFLICT';
            END IF;
            fulfillment=true; reason=coalesce(reason,'שיוך מפורש של הפקדה קיימת למועד החודשי');
          END IF;
        END IF;
      END IF;
    ELSIF c ?| ARRAY['occurrence_month','expected_due_date','plan_revision','plan_override'] THEN
      RAISE EXCEPTION 'מועד מתוכנן נבחר רק בפעולת הסדרה מפורשת' USING ERRCODE='22023';
    END IF;
    IF e.occurrence_month IS NOT NULL THEN
      IF account_id<>e.account_id THEN RAISE EXCEPTION 'אין להעביר מועד מתוכנן לחשבון אחר' USING ERRCODE='22023'; END IF;
      occurrence=e.occurrence_month; due=e.scheduled_due_date; captured_plan=e.plan_revision;
    END IF;
    IF e.id IS NOT NULL THEN
      SELECT * INTO old_a FROM public.savings_accounts WHERE id=e.account_id;
      IF old_a.revision IS DISTINCT FROM (CASE WHEN fulfillment THEN c->>'expected_revision' ELSE p_command->>'expected_revision' END)::bigint THEN RAISE EXCEPTION 'החיסכון השתנה; יש לרענן לפני התיקון' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
      IF account_id<>e.account_id AND a.revision IS DISTINCT FROM (c->>'expected_destination_revision')::bigint THEN RAISE EXCEPTION 'חשבון היעד השתנה; יש לרענן' USING ERRCODE='40001'; END IF;
    ELSIF c->>'action' IS DISTINCT FROM 'due' AND a.revision IS DISTINCT FROM (c->>'expected_revision')::bigint THEN RAISE EXCEPTION 'החיסכון השתנה; יש לרענן לפני הרישום' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
    IF (e.id IS NULL OR reinstate OR account_id<>e.account_id) AND a.status<>'active' THEN RAISE EXCEPTION 'יש לבחור חשבון פעיל לפעילות חדשה' USING ERRCODE='22023',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
    IF op<>'cancel_savings_event' THEN
      IF amount IS NULL OR amount<0 OR (kind<>'opening' AND amount=0) OR kind IS NULL OR kind NOT IN ('deposit','withdrawal','opening','interest_capitalized','interest_payout') THEN RAISE EXCEPTION 'סכום או סוג אירוע אינם תקינים' USING ERRCODE='22023'; END IF;
      IF effective IS NULL OR effective<a.tracking_start_date OR effective>timezone('Asia/Jerusalem',statement_timestamp())::date
        OR (kind<>'opening' AND effective=a.tracking_start_date AND c->'cutoff_confirmed' IS DISTINCT FROM 'true'::jsonb) THEN
        RAISE EXCEPTION 'התאריך חייב להיות בתחום המעקב; ביום הפתיחה יש לאשר שהכסף אינו כלול ביתרת הפתיחה' USING ERRCODE='22023',DETAIL='SAVINGS_CUTOFF_VIOLATION';
      END IF;
      IF e.id IS NULL AND kind='opening' THEN RAISE EXCEPTION 'יתרת פתיחה נוצרת רק עם החשבון' USING ERRCODE='22023'; END IF;
      IF e.id IS NOT NULL AND kind<>e.event_kind AND NOT (kind IN ('interest_capitalized','interest_payout') AND e.event_kind IN ('interest_capitalized','interest_payout')) AND NOT (restore_skip AND kind='deposit') THEN RAISE EXCEPTION 'אין להפוך הפקדה למשיכה; יש לבטל ולרשום אירוע נפרד' USING ERRCODE='22023'; END IF;
      IF reinstate AND kind<>e.event_kind AND NOT (restore_skip AND kind='deposit') THEN RAISE EXCEPTION 'החזרה משחזרת את יעד האירוע המקורי; תיקון יעד נעשה לאחר מכן בנפרד' USING ERRCODE='22023'; END IF;
      IF e.transaction_id IS NULL AND e.id IS NOT NULL AND c->>'transaction_id' IS NOT NULL THEN RAISE EXCEPTION 'המרת ריבית מהחיסכון אינה מקשרת כסף אחר' USING ERRCODE='22023'; END IF;
      IF kind='opening' THEN
        IF action<>'noncash' OR account_id<>e.account_id OR effective<>a.tracking_start_date OR reinstate OR c ?| ARRAY['transaction_id','category_id','payment_source_id','charge_date'] THEN RAISE EXCEPTION 'תיקון פתיחה שומר על החשבון והגבול וללא תנועה כספית' USING ERRCODE='22023'; END IF;
      ELSIF kind='interest_capitalized' THEN
        IF action<>'noncash' OR category_id IS NOT NULL OR source_id IS NOT NULL OR charge IS NOT NULL
          OR (e.transaction_id IS NULL AND transaction_id IS NOT NULL) THEN
          RAISE EXCEPTION 'ריבית שנשארה בחיסכון נרשמת ללא תנועת כסף או פרטי תשלום' USING ERRCODE='22023';
        END IF;
      ELSE
        IF action='noncash' OR (e.event_kind='interest_capitalized' AND action<>'create_cash') THEN
          RAISE EXCEPTION 'ריבית לעו״ש מחייבת פרטי הכנסה; המרת ריבית מהחיסכון יוצרת הכנסה חדשה אחת' USING ERRCODE='22023';
        END IF;
        SELECT * INTO category FROM public.categories WHERE id=category_id;
        SELECT * INTO source FROM public.payment_sources WHERE id=source_id;
        IF category.id IS NULL OR source.id IS NULL OR NOT category.is_active OR NOT source.is_active THEN RAISE EXCEPTION 'יש לבחור קטגוריה ואמצעי תשלום פעילים' USING ERRCODE='22023',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
        IF charge IS NULL OR category.type<>(CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END)
          OR (action='detach' AND category.savings_role IS NOT NULL)
          OR (action<>'detach' AND category.savings_role IS DISTINCT FROM kind) THEN RAISE EXCEPTION 'הקטגוריה אינה מתאימה לכיוון התנועה בחיסכון' USING ERRCODE='22023'; END IF;
        IF nullif(btrim(c->>'description'),'') IS NULL OR length(c->>'description')>2000 OR length(c->>'notes')>10000 THEN RAISE EXCEPTION 'יש להזין תיאור תקין לתנועה' USING ERRCODE='22023'; END IF;
      END IF;
    END IF;
  END IF;
  -- Every old/new cash period must remain free of captured Budget history.
  -- Use typed operation provenance, not merely current-month UI restrictions.
  IF kind IS DISTINCT FROM 'opening' THEN
    IF EXISTS(SELECT 1 FROM public.budget_operations bo JOIN public.budget_months bm ON bm.id=bo.budget_month_id
      WHERE bm.month_start IN (date_trunc('month',t.transaction_date)::date,CASE WHEN kind IN ('deposit','withdrawal','interest_payout') THEN date_trunc('month',effective)::date END)
        AND bo.operation_type IN ('month_close','carryover','unused_disposition','month_disposition'))
      OR EXISTS(SELECT 1 FROM public.budget_operation_items bi JOIN public.budget_months bm ON bm.id=bi.budget_month_id
        WHERE bm.month_start IN (date_trunc('month',t.transaction_date)::date,CASE WHEN kind IN ('deposit','withdrawal','interest_payout') THEN date_trunc('month',effective)::date END)
          AND bi.item_kind IN ('carryover','unused_disposition')) THEN
      RAISE EXCEPTION 'החודש כבר נסגר או נכלל בהעברה תקציבית; נדרש תיקון היסטורי מפורש' USING ERRCODE='22023',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED';
    END IF;
  END IF;
  IF op='void_detached_savings_transaction' THEN
    UPDATE public.transactions SET voided_at=now(),void_request_key=p_request_key,void_fingerprint=fp,void_reason=reason WHERE id=t.id;
    RETURN jsonb_build_object('transaction_id',t.id::text,'affected_transaction_ids',jsonb_build_array(t.id::text),'affected_account_ids','[]'::jsonb,'affected_months',jsonb_build_array(to_char(t.transaction_date,'YYYY-MM')));
  END IF;
  IF transaction_id IS NOT NULL AND op<>'cancel_savings_event' THEN
    IF nullif(btrim(t.installments_info),'') IS NOT NULL OR coalesce(t.installment_number,1)>1 THEN
      RAISE EXCEPTION 'תנועה מיובאת עם פירוט תשלומים אינה מתאימה לקישור ישיר לחיסכון' USING ERRCODE='22023',DETAIL='SAVINGS_LINK_CONFLICT';
    END IF;
    IF c->>'expected_transaction_fingerprint' IS DISTINCT FROM cash_fp OR (c->>'transaction_id')::integer IS DISTINCT FROM t.id THEN RAISE EXCEPTION 'התנועה השתנתה; יש לרענן ולאשר מחדש' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
    IF t.voided_at IS NOT NULL AND NOT (reinstate AND action='create_cash') THEN RAISE EXCEPTION 'אין להשתמש שוב בתנועה שבוטלה' USING ERRCODE='22023'; END IF;
    IF reinstate AND t.voided_at IS NULL AND action<>'link_cash' THEN RAISE EXCEPTION 'להחזרה לאחר ניתוק יש לקשר במפורש את הכסף הקיים' USING ERRCODE='22023'; END IF;
    IF e.id IS NULL AND EXISTS(SELECT 1 FROM public.savings_entries WHERE savings_entries.transaction_id=t.id) THEN RAISE EXCEPTION 'לתנועה היסטוריית חיסכון; יש להשתמש בהחזרה המפורשת של האירוע המקורי' USING ERRCODE='22023',DETAIL='SAVINGS_LINK_CONFLICT'; END IF;
    IF action='link_cash' AND (amount,effective,source_id,charge,CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END) IS DISTINCT FROM (t.total_amount,t.transaction_date,t.payment_source_id,t.charge_date,t.movement_type) THEN RAISE EXCEPTION 'קישור חייב לשמר את סכום הכסף, התאריכים, הכיוון ומקור התשלום הקיימים' USING ERRCODE='22023'; END IF;
  END IF;
  IF op='post_savings_event' AND ((action='create_cash' AND transaction_id IS NOT NULL) OR (action='link_cash' AND transaction_id IS NULL)) THEN RAISE EXCEPTION 'יש לבחור יצירה חדשה או קישור של תנועה קיימת בלבד' USING ERRCODE='22023'; END IF;
  IF action='detach' AND (e.id IS NULL OR reinstate OR account_id<>e.account_id) THEN RAISE EXCEPTION 'ניתוק משנה סיווג של אותה תנועה ואינו מעביר או מחזיר אירוע לחשבון אחר' USING ERRCODE='22023'; END IF;
  IF e.id IS NOT NULL AND (NOT reinstate OR (restore_skip AND e.reversed_by_entry_id IS NULL)) THEN
    INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,entry_action,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,reverses_entry_id,reason)
      VALUES(e.account_id,p_request_key,0,op,fp,e.event_kind,'reverse',e.amount,e.effective_date,e.source_kind,e.transaction_id,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date,e.id,reason) RETURNING id INTO reversed_id;
    UPDATE public.savings_entries SET reversed_by_entry_id=reversed_id WHERE id=e.id;
    entry_index=1;
  END IF;
  IF op='cancel_savings_event' OR (kind='interest_capitalized' AND t.id IS NOT NULL) THEN
    UPDATE public.transactions SET voided_at=now(),void_request_key=public.budget_derived_request_key(p_request_key,'savings-void-'||t.id),void_fingerprint=fp,void_reason=reason WHERE id=t.id;
  ELSIF kind IN ('deposit','withdrawal','interest_payout') THEN
    IF t.id IS NULL OR t.voided_at IS NOT NULL THEN
      INSERT INTO public.transactions(description,movement_type,total_amount,transaction_date,charge_date,category_id,payment_source_id,currency,notes)
        VALUES(c->>'description',CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END,amount,effective,charge,category_id,source_id,'ILS',c->>'notes') RETURNING id INTO transaction_id;
    ELSE
      UPDATE public.transactions SET description=c->>'description',total_amount=amount,transaction_date=effective,charge_date=charge,category_id=cmd.category_id,payment_source_id=source_id,notes=c->>'notes' WHERE id=t.id;
    END IF;
  END IF;
  IF kind='interest_capitalized' THEN transaction_id=NULL; END IF;
  IF op<>'cancel_savings_event' AND action<>'detach' THEN
    INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,supersedes_entry_id,reason,occurrence_month,scheduled_due_date,plan_revision,occurrence_root_id)
      VALUES(account_id,p_request_key,entry_index,op,fp,kind,amount,effective,CASE WHEN kind='opening' THEN 'opening' WHEN occurrence IS NOT NULL THEN 'recurring' WHEN e.id IS NOT NULL THEN e.source_kind WHEN action='link_cash' THEN 'existing_transaction' ELSE 'manual' END,
        transaction_id,CASE WHEN kind IN ('opening','interest_capitalized') THEN NULL WHEN kind='deposit' THEN 'expense' ELSE 'income' END,category_id,source_id,charge,e.id,reason,occurrence,due,captured_plan,CASE WHEN e.occurrence_month IS NOT NULL THEN coalesce(e.occurrence_root_id,e.id) END) RETURNING id INTO entry_id;
  END IF;
  IF kind='opening' THEN
    SELECT * INTO old_item FROM public.budget_operation_items WHERE savings_event_id=e.id AND item_kind='reserve_retirement';
    old_overlap=coalesce(old_item.amount,0); new_overlap=(c->>'legacy_overlap_amount')::numeric;
    SELECT coalesce(sum(amount_delta),0) INTO reserve_balance FROM public.budget_savings_entries;
    IF new_overlap IS NULL OR new_overlap>amount OR new_overlap>reserve_balance+old_overlap OR c->>'expected_reserve_fingerprint' IS DISTINCT FROM
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]')::text) FROM public.budget_savings_entries b) THEN RAISE EXCEPTION 'יש לרענן ולאשר יתרת פתיחה וחפיפה לרזרבה לפני התיקון' USING ERRCODE='40001'; END IF;
    IF (old_overlap>0 OR new_overlap>0) AND nullif(btrim(c->>'overlap_reason'),'') IS NULL THEN RAISE EXCEPTION 'יש לאשר שהרזרבה המשוחררת זמינה מחוץ לחיסכון' USING ERRCODE='22023'; END IF;
    IF old_overlap>0 OR new_overlap>0 THEN
      INSERT INTO public.budget_months(month_start) VALUES(date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date) ON CONFLICT DO NOTHING;
      SELECT id INTO month_id FROM public.budget_months WHERE month_start=date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date;
      SELECT id INTO category_id FROM public.categories WHERE savings_role='deposit' AND is_active;
      IF category_id IS NULL THEN RAISE EXCEPTION 'קטגוריית הפקדה אינה פעילה' USING ERRCODE='22023'; END IF;
      IF old_overlap>0 THEN
        INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date,reverses_operation_id)
          VALUES(month_id,public.budget_derived_request_key(p_request_key,'opening-reserve-reversal'),fp,'savings_reserve_retirement_reversal',date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date,old_item.operation_id) RETURNING id INTO operation_id;
        INSERT INTO public.budget_savings_entries(operation_id,category_id,entry_kind,amount_delta,reverses_entry_id) VALUES(operation_id,category_id,'account_opening_retirement_reversal',old_overlap,old_item.savings_entry_id) RETURNING id INTO reserve_id;
        INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,category_id,savings_event_id,savings_entry_id,amount,reversed_item_id)
          VALUES(operation_id,'reserve_retirement','reversal',month_id,category_id,reversed_id,reserve_id,old_overlap,old_item.id);
      END IF;
      IF new_overlap>0 THEN
        INSERT INTO public.budget_operations(budget_month_id,request_key,request_fingerprint,operation_type,effective_date)
          VALUES(month_id,public.budget_derived_request_key(p_request_key,'opening-reserve-retirement'),fp,'savings_reserve_retirement',date_trunc('month',timezone('Asia/Jerusalem',statement_timestamp()))::date) RETURNING id INTO operation_id;
        INSERT INTO public.budget_savings_entries(operation_id,category_id,entry_kind,amount_delta) VALUES(operation_id,category_id,'account_opening_retirement',-new_overlap) RETURNING id INTO reserve_id;
        INSERT INTO public.budget_operation_items(operation_id,item_kind,action_kind,budget_month_id,category_id,savings_event_id,savings_entry_id,amount)
          VALUES(operation_id,'reserve_retirement','apply',month_id,category_id,entry_id,reserve_id,new_overlap);
      END IF;
    END IF;
  END IF;
  UPDATE public.savings_accounts sa SET revision=sa.revision+1 WHERE sa.id IN (account_id,e.account_id);
  FOR revision IN SELECT id FROM public.savings_accounts WHERE id IN (account_id,e.account_id) ORDER BY id LOOP
    BEGIN
      PERFORM public.savings_assert_account(revision);
      IF (SELECT coalesce(sum(se.amount),0) FROM public.savings_entries se WHERE se.account_id=revision AND se.entry_action='post' AND se.reversed_by_entry_id IS NULL AND se.event_kind IN ('interest_capitalized','interest_payout'))>9999999999999999.99 THEN
        RAISE EXCEPTION 'סך הריבית חורג מטווח הסכומים' USING ERRCODE='23514';
      END IF;
    EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'לא ניתן להשלים את הפעולה: תיווצר יתרה שלילית או חריגה מהטווח בהיסטוריית החיסכון' USING ERRCODE='23514',DETAIL='SAVINGS_INSUFFICIENT_BALANCE'; END;
  END LOOP;
  SELECT jsonb_agg(se.id::text ORDER BY command_index),jsonb_agg(DISTINCT se.account_id::text),jsonb_agg(DISTINCT to_char(se.effective_date,'YYYY-MM')) INTO receipt,affected,months FROM public.savings_entries se WHERE command_id=p_request_key;
  RETURN jsonb_build_object('entry_ids',receipt,'transaction_id',transaction_id::text,'affected_account_ids',affected,'affected_months',months,'affected_transaction_ids',(SELECT coalesce(jsonb_agg(DISTINCT se.transaction_id::text) FILTER(WHERE se.transaction_id IS NOT NULL),'[]') FROM public.savings_entries se WHERE command_id=p_request_key));
END $$;

CREATE OR REPLACE FUNCTION public.savings_assert_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.savings_entries%ROWTYPE; r public.savings_entries%ROWTYPE; a public.savings_accounts%ROWTYPE; t public.transactions%ROWTYPE; v_role TEXT; v_id BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.savings_entries fresh JOIN public.savings_accounts account ON account.id=fresh.account_id
    WHERE fresh.xmin::text=pg_current_xact_id()::text AND fresh.entry_action='post' AND fresh.reversed_by_entry_id IS NULL
      AND fresh.occurrence_month IS NOT NULL AND fresh.occurrence_root_id IS NULL
      AND (account.plan_start_date IS NULL OR fresh.scheduled_due_date<account.plan_start_date
        OR fresh.scheduled_due_date>timezone('Asia/Jerusalem',statement_timestamp())::date OR fresh.plan_revision<>account.plan_revision)) THEN
    RAISE EXCEPTION 'מועד חדש מחייב תוכנית שמורה, גרסה תקפה ותאריך שכבר הגיע' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.savings_entries fresh JOIN public.savings_accounts account ON account.id=fresh.account_id
    LEFT JOIN public.categories category ON category.id=fresh.cash_category_id LEFT JOIN public.payment_sources source ON source.id=fresh.cash_payment_source_id
    WHERE fresh.xmin::text=pg_current_xact_id()::text AND fresh.entry_action='post' AND fresh.reversed_by_entry_id IS NULL AND fresh.supersedes_entry_id IS NULL AND fresh.event_kind NOT IN ('opening','occurrence_skip')
      AND (account.status<>'active' OR (fresh.transaction_id IS NOT NULL AND (NOT category.is_active OR NOT source.is_active)))) THEN
    RAISE EXCEPTION 'אירוע חדש מחייב חשבון, קטגוריה ואמצעי תשלום פעילים' USING ERRCODE='23514';
  END IF;
  -- Read final stored rows: deferred trigger NEW may describe an intermediate state.
  FOR e IN SELECT * FROM public.savings_entries ORDER BY id LOOP
    SELECT * INTO a FROM public.savings_accounts WHERE id=e.account_id;
    IF NOT isfinite(e.effective_date) OR e.effective_date<a.tracking_start_date OR e.effective_date>timezone('Asia/Jerusalem',statement_timestamp())::date
       OR (e.cash_charge_date IS NOT NULL AND NOT isfinite(e.cash_charge_date)) OR (e.event_kind='opening' AND e.effective_date<>a.tracking_start_date) THEN
      RAISE EXCEPTION 'תאריך האירוע אינו בתחום המעקב המאושר' USING ERRCODE='23514';
    END IF;
    IF e.entry_action='reverse' THEN
      SELECT * INTO r FROM public.savings_entries WHERE id=e.reverses_entry_id;
      IF r.entry_action<>'post' OR r.id>=e.id OR r.reversed_by_entry_id IS DISTINCT FROM e.id OR
        (e.account_id,e.event_kind,e.source_kind,e.amount,e.effective_date,e.transaction_id,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date) IS DISTINCT FROM
        (r.account_id,r.event_kind,r.source_kind,r.amount,r.effective_date,r.transaction_id,r.cash_movement_type,r.cash_category_id,r.cash_payment_source_id,r.cash_charge_date) THEN
        RAISE EXCEPTION 'רישום ביטול אינו תואם לאירוע המקורי' USING ERRCODE='23514';
      END IF;
    ELSIF e.reversed_by_entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.savings_entries WHERE id=e.reversed_by_entry_id AND reverses_entry_id=e.id AND entry_action='reverse') THEN
      RAISE EXCEPTION 'חסר אירוע ביטול תואם' USING ERRCODE='23514';
    END IF;
    IF e.supersedes_entry_id IS NOT NULL THEN
      SELECT * INTO r FROM public.savings_entries WHERE id=e.supersedes_entry_id;
      IF r.entry_action<>'post' OR r.reversed_by_entry_id IS NULL OR r.id>=e.id
        OR ((e.event_kind='opening') IS DISTINCT FROM (r.event_kind='opening'))
        OR (r.event_kind='opening' AND e.account_id<>r.account_id)
        OR (r.occurrence_month IS NOT NULL AND (e.account_id,e.occurrence_month,e.occurrence_root_id) IS DISTINCT FROM (r.account_id,r.occurrence_month,coalesce(r.occurrence_root_id,r.id)))
        OR (r.occurrence_month IS NULL AND e.occurrence_month IS NOT NULL AND NOT (
          e.command_kind='post_savings_event' AND r.event_kind='deposit' AND e.event_kind='deposit'
          AND r.source_kind IN ('manual','existing_transaction') AND e.source_kind='recurring'
          AND e.occurrence_root_id IS NULL AND e.command_id=(SELECT command_id FROM public.savings_entries WHERE id=r.reversed_by_entry_id)
          AND (e.account_id,e.amount,e.effective_date,e.transaction_id,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date)
            IS NOT DISTINCT FROM (r.account_id,r.amount,r.effective_date,r.transaction_id,r.cash_movement_type,r.cash_category_id,r.cash_payment_source_id,r.cash_charge_date)))
        OR (r.event_kind<>e.event_kind AND NOT (r.event_kind IN ('interest_capitalized','interest_payout') AND e.event_kind IN ('interest_capitalized','interest_payout'))
          AND NOT (r.occurrence_month IS NOT NULL AND r.event_kind IN ('deposit','occurrence_skip') AND e.event_kind IN ('deposit','occurrence_skip'))) THEN
        RAISE EXCEPTION 'החלפת אירוע חייבת לשמור על שרשרת התיקון וזהות המועד' USING ERRCODE='23514';
      END IF;
    END IF;
    IF e.occurrence_root_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.savings_entries WHERE id=e.occurrence_root_id AND id<e.id AND occurrence_root_id IS NULL AND entry_action='post' AND account_id=e.account_id AND occurrence_month=e.occurrence_month) THEN
      RAISE EXCEPTION 'זהות המועד החודשי אינה תקינה' USING ERRCODE='23514';
    END IF;
    IF e.source_kind='budget_surplus' THEN
      IF e.event_kind<>'deposit' OR NOT EXISTS(SELECT 1 FROM public.budget_operation_items i
        JOIN public.budget_operations o ON o.id=i.source_operation_id JOIN public.budget_funding_entries f ON f.id=i.source_funding_entry_id
        JOIN public.budget_movements m ON m.id=i.source_movement_id
        WHERE i.savings_event_id=e.id AND i.item_kind='savings_transfer' AND i.amount=e.amount
          AND i.action_kind=CASE WHEN e.entry_action='post' THEN 'apply' ELSE 'reversal' END
          AND f.operation_id=o.id AND m.operation_id=o.id AND m.amount=e.amount
          AND f.amount_delta=e.amount*CASE WHEN e.entry_action='post' THEN -1 ELSE 1 END
          AND ((e.reversed_by_entry_id IS NULL AND e.entry_action='post' AND NOT EXISTS(SELECT 1 FROM public.budget_operation_items ri WHERE ri.reversed_item_id=i.id))
            OR e.entry_action='reverse' OR EXISTS(SELECT 1 FROM public.budget_operation_items ri WHERE ri.reversed_item_id=i.id AND ri.savings_event_id=e.reversed_by_entry_id))) THEN
        RAISE EXCEPTION 'הפקדת עודף מחייבת מימון והקצאה תואמים באותה פעולה' USING ERRCODE='23514'; END IF;
    END IF;
    IF e.transaction_id IS NOT NULL THEN
      PERFORM id FROM public.transactions WHERE id=e.transaction_id FOR UPDATE;
      SELECT * INTO t FROM public.transactions WHERE id=e.transaction_id;
      IF t.loan_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.loan_payments WHERE transaction_id=t.id)
        OR t.currency IS DISTINCT FROM 'ILS' OR t.total_amount IS NULL OR t.total_amount<=0 OR t.total_amount::text IN ('NaN','Infinity','-Infinity')
        OR t.total_amount<>round(t.total_amount,2) OR t.total_amount>9999999999999999.99
        OR NOT isfinite(t.transaction_date) OR t.payment_source_id IS NULL OR t.charge_date IS NULL OR NOT isfinite(t.charge_date)
        OR coalesce(t.global_discount,0)<>0 OR t.parent_transaction_id IS NOT NULL
        OR coalesce(t.installment_count,1)>1 OR EXISTS (SELECT 1 FROM public.transactions WHERE parent_transaction_id=t.id)
        OR EXISTS (SELECT 1 FROM public.transaction_items WHERE transaction_id=t.id)
        OR EXISTS (SELECT 1 FROM public.lego_sets WHERE transaction_id=t.id)
        OR EXISTS (SELECT 1 FROM public.shopping_checkouts WHERE transaction_id=t.id) THEN
        RAISE EXCEPTION 'תנועת חיסכון חייבת להיות תנועה ישירה בשקלים ללא פריטים או קישור הלוואה' USING ERRCODE='23514';
      END IF;
      IF e.entry_action='post' AND e.reversed_by_entry_id IS NULL THEN
        SELECT savings_role INTO v_role FROM public.categories WHERE id=t.category_id;
        IF t.voided_at IS NOT NULL OR
          (e.amount,e.effective_date,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date) IS DISTINCT FROM
          (t.total_amount,t.transaction_date,t.movement_type,t.category_id,t.payment_source_id,t.charge_date)
          OR v_role IS DISTINCT FROM e.event_kind OR t.movement_type<> (CASE WHEN e.event_kind='deposit' THEN 'expense' ELSE 'income' END) THEN
          RAISE EXCEPTION 'התנועה והרישום בחיסכון חייבים להסכים בסכום, בתאריך ובסיווג' USING ERRCODE='23514';
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.transactions live_cash JOIN public.categories c ON c.id=live_cash.category_id WHERE live_cash.voided_at IS NULL AND c.savings_role IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.savings_entries live_entry WHERE live_entry.transaction_id=live_cash.id AND live_entry.entry_action='post' AND live_entry.reversed_by_entry_id IS NULL)) THEN
    RAISE EXCEPTION 'פעולות הפקדה ומשיכה יתווספו בהמשך; אין ליצור תנועת חיסכון ללא רישום תואם' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.savings_entries GROUP BY command_id HAVING min(command_index)<>0 OR max(command_index)<>count(*)-1 OR count(DISTINCT command_kind)<>1 OR count(DISTINCT command_fingerprint)<>1) THEN
    RAISE EXCEPTION 'קבלת הפעולה אינה עקבית' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.budget_savings_entries b WHERE b.entry_kind IN ('account_opening_retirement','account_opening_retirement_reversal') AND NOT EXISTS (
    SELECT 1 FROM public.budget_operation_items i JOIN public.savings_entries s ON s.id=i.savings_event_id
    WHERE i.operation_id=b.operation_id AND i.savings_entry_id=b.id AND i.item_kind='reserve_retirement' AND s.event_kind='opening'
      AND i.amount=abs(b.amount_delta) AND i.amount<=s.amount AND ((b.amount_delta<0 AND s.entry_action='post') OR (b.amount_delta>0 AND s.entry_action='reverse'))
  )) THEN RAISE EXCEPTION 'פרישת רזרבה מחייבת קישור מפורש ליתרת פתיחה' USING ERRCODE='23514'; END IF;
  FOR v_id IN SELECT id FROM public.savings_accounts ORDER BY id LOOP PERFORM public.savings_assert_account(v_id); END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.get_savings_account(p_account_id BIGINT,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL,p_before_entry_id BIGINT DEFAULT NULL,p_limit INTEGER DEFAULT 50) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.savings_accounts%ROWTYPE; v_history JSONB; v_summary JSONB; v_period JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_from>p_to OR (p_from IS NOT NULL AND NOT isfinite(p_from)) OR (p_to IS NOT NULL AND NOT isfinite(p_to)) THEN RAISE EXCEPTION 'טווח תאריכים או גודל עמוד אינו תקין' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.savings_accounts WHERE id=p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'חשבון החיסכון לא נמצא' USING ERRCODE='P0002'; END IF;
  SELECT to_jsonb(s)||jsonb_build_object('account_id',s.account_id::text,'revision',s.revision::text,'plan_revision',s.plan_revision::text) INTO v_summary FROM public.savings_account_summary s WHERE account_id=p_account_id;
  SELECT coalesce(jsonb_agg(row ORDER BY id DESC),'[]') INTO v_history FROM (
    SELECT e.id,to_jsonb(e)||jsonb_build_object('reinstatable',e.entry_action='post' AND (e.reversed_by_entry_id IS NOT NULL OR e.event_kind='occurrence_skip') AND NOT EXISTS(SELECT 1 FROM public.savings_entries replacement WHERE replacement.supersedes_entry_id=e.id),'id',e.id::text,'account_id',e.account_id::text,'amount',e.amount::text,'reverses_entry_id',e.reverses_entry_id::text,'reversed_by_entry_id',e.reversed_by_entry_id::text,'supersedes_entry_id',e.supersedes_entry_id::text,'occurrence_root_id',e.occurrence_root_id::text,'plan_revision',e.plan_revision::text,'cash_category_id',e.cash_category_id::text,'cash_payment_source_id',e.cash_payment_source_id::text) AS row
    FROM public.savings_entries e WHERE account_id=p_account_id AND (p_before_entry_id IS NULL OR e.id<p_before_entry_id) AND (p_from IS NULL OR effective_date>=p_from) AND (p_to IS NULL OR effective_date<=p_to) ORDER BY id DESC LIMIT p_limit
  ) page;
  SELECT jsonb_build_object('from',p_from,'to',p_to,'deposits',coalesce(sum(amount*CASE WHEN entry_action='post' THEN 1 ELSE -1 END) FILTER (WHERE event_kind='deposit'),0)::numeric(18,2)::text,
    'withdrawals',coalesce(sum(amount*CASE WHEN entry_action='post' THEN 1 ELSE -1 END) FILTER (WHERE event_kind='withdrawal'),0)::numeric(18,2)::text,
    'realized_interest',coalesce(sum(amount*CASE WHEN entry_action='post' THEN 1 ELSE -1 END) FILTER (WHERE event_kind IN ('interest_capitalized','interest_payout')),0)::numeric(18,2)::text) INTO v_period
    FROM public.savings_entries WHERE account_id=p_account_id AND (p_from IS NULL OR effective_date>=p_from) AND (p_to IS NULL OR effective_date<=p_to);
  RETURN jsonb_build_object('account',(to_jsonb(a)-ARRAY['creation_fingerprint','last_config_fingerprint'])||jsonb_build_object('id',a.id::text,'revision',a.revision::text,'plan_revision',a.plan_revision::text,'default_payment_source_id',a.default_payment_source_id::text,'target_amount',a.target_amount::text,'monthly_amount',a.monthly_amount::text,'annual_interest_rate',a.annual_interest_rate::text),
    'summary',v_summary,'history',v_history,'period',v_period,'next_before_entry_id',CASE WHEN jsonb_array_length(v_history)=p_limit THEN v_history->-1->>'id' END);
END $$;

COMMIT;
