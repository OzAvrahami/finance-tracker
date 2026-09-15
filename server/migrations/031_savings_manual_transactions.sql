-- Migration 031: Savings manual transactions (SAV-03).
-- Requires 030. No tables/views, backfill, Loan calculations or automation.
BEGIN;

-- Private command engine. Public wrappers construct the operation envelope;
-- clients cannot submit internal operation/receipt fields as financial input.
CREATE FUNCTION public.savings_post_event_locked(p_request_key UUID,p_command JSONB)
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
    IF NOT k=ANY(ARRAY['action','account_id','expected_revision','event_kind','amount','effective_date','transaction_id','expected_transaction_fingerprint','description','category_id','payment_source_id','charge_date','notes','reinstate','expected_destination_revision','cutoff_confirmed','legacy_overlap_amount','overlap_reason','expected_reserve_fingerprint']) THEN
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
    ELSIF k IN ('effective_date','charge_date') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR ((value#>>'{}')::date)::text<>(value#>>'{}') THEN
        RAISE EXCEPTION 'יש להזין תאריך לוח שנה תקין' USING ERRCODE='22023';
      END IF;
    ELSIF k IN ('reinstate','cutoff_confirmed') THEN
      IF jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'חסר אישור מפורש לפעולה' USING ERRCODE='22023'; END IF;
    ELSIF jsonb_typeof(value)<>'string' THEN RAISE EXCEPTION 'ערך טקסט אינו תקין' USING ERRCODE='22023';
    ELSE c=jsonb_set(c,ARRAY[k],coalesce(to_jsonb(nullif(btrim(value#>>'{}'),'')),'null'::jsonb)); END IF;
  END LOOP;
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
    IF e.event_kind NOT IN ('opening','deposit','withdrawal') OR e.source_kind='budget_surplus' OR e.occurrence_month IS NOT NULL THEN
      RAISE EXCEPTION 'אירוע זה מחייב את פעולת הריבית, המועד או העודף הייעודית' USING ERRCODE='22023';
    END IF;
    reinstate=coalesce((c->>'reinstate')::boolean,false);
    IF (e.reversed_by_entry_id IS NOT NULL) IS DISTINCT FROM reinstate OR EXISTS(SELECT 1 FROM public.savings_entries WHERE supersedes_entry_id=e.id) THEN
      RAISE EXCEPTION 'האירוע השתנה או כבר הוחלף; יש לרענן' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE';
    END IF;
    IF op='cancel_savings_event' AND (reinstate OR e.event_kind='opening') THEN RAISE EXCEPTION 'אין לבטל יתרת פתיחה או אירוע שכבר בוטל' USING ERRCODE='22023'; END IF;
    account_id=coalesce((c->>'account_id')::bigint,e.account_id);
    transaction_id=e.transaction_id;
  ELSE account_id=(c->>'account_id')::bigint; transaction_id=(c->>'transaction_id')::integer; END IF;
  action=c->>'action';
  IF op='post_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash')) THEN RAISE EXCEPTION 'רק הפקדה או משיכה ידנית זמינות כעת' USING ERRCODE='22023'; END IF;
  IF op='correct_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash','detach','noncash')) THEN RAISE EXCEPTION 'יש לבחור תיקון, ניתוק או החזרה מפורשת' USING ERRCODE='22023'; END IF;
  IF op='cancel_savings_event' AND action IS DISTINCT FROM 'void' THEN
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
    IF e.id IS NOT NULL THEN
      SELECT * INTO old_a FROM public.savings_accounts WHERE id=e.account_id;
      IF old_a.revision IS DISTINCT FROM (p_command->>'expected_revision')::bigint THEN RAISE EXCEPTION 'החיסכון השתנה; יש לרענן לפני התיקון' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
      IF account_id<>e.account_id AND a.revision IS DISTINCT FROM (c->>'expected_destination_revision')::bigint THEN RAISE EXCEPTION 'חשבון היעד השתנה; יש לרענן' USING ERRCODE='40001'; END IF;
    ELSIF a.revision IS DISTINCT FROM (c->>'expected_revision')::bigint THEN RAISE EXCEPTION 'החיסכון השתנה; יש לרענן לפני הרישום' USING ERRCODE='40001',DETAIL='SAVINGS_PREVIEW_STALE'; END IF;
    IF (e.id IS NULL OR reinstate OR account_id<>e.account_id) AND a.status<>'active' THEN RAISE EXCEPTION 'יש לבחור חשבון פעיל לפעילות חדשה' USING ERRCODE='22023',DETAIL='SAVINGS_REFERENCE_INACTIVE'; END IF;
    IF op<>'cancel_savings_event' THEN
      IF amount IS NULL OR amount<0 OR (kind<>'opening' AND amount=0) OR kind IS NULL OR kind NOT IN ('deposit','withdrawal','opening') THEN RAISE EXCEPTION 'סכום או סוג אירוע אינם תקינים' USING ERRCODE='22023'; END IF;
      IF effective IS NULL OR effective<a.tracking_start_date OR effective>timezone('Asia/Jerusalem',statement_timestamp())::date
        OR (kind<>'opening' AND effective=a.tracking_start_date AND c->'cutoff_confirmed' IS DISTINCT FROM 'true'::jsonb) THEN
        RAISE EXCEPTION 'התאריך חייב להיות בתחום המעקב; ביום הפתיחה יש לאשר שהכסף אינו כלול ביתרת הפתיחה' USING ERRCODE='22023',DETAIL='SAVINGS_CUTOFF_VIOLATION';
      END IF;
      IF e.id IS NULL AND kind='opening' THEN RAISE EXCEPTION 'יתרת פתיחה נוצרת רק עם החשבון' USING ERRCODE='22023'; END IF;
      IF e.id IS NOT NULL AND kind<>e.event_kind THEN RAISE EXCEPTION 'אין להפוך הפקדה למשיכה; יש לבטל ולרשום אירוע נפרד' USING ERRCODE='22023'; END IF;
      IF kind='opening' THEN
        IF action<>'noncash' OR account_id<>e.account_id OR effective<>a.tracking_start_date OR reinstate OR c ?| ARRAY['transaction_id','category_id','payment_source_id','charge_date'] THEN RAISE EXCEPTION 'תיקון פתיחה שומר על החשבון והגבול וללא תנועה כספית' USING ERRCODE='22023'; END IF;
      ELSE
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
      WHERE bm.month_start IN (date_trunc('month',t.transaction_date)::date,date_trunc('month',effective)::date)
        AND bo.operation_type IN ('month_close','carryover','unused_disposition','month_disposition'))
      OR EXISTS(SELECT 1 FROM public.budget_operation_items bi JOIN public.budget_months bm ON bm.id=bi.budget_month_id
        WHERE bm.month_start IN (date_trunc('month',t.transaction_date)::date,date_trunc('month',effective)::date)
          AND bi.item_kind IN ('carryover','unused_disposition','savings_transfer')) THEN
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
  IF e.id IS NOT NULL AND NOT reinstate THEN
    INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,entry_action,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,reverses_entry_id,reason)
      VALUES(e.account_id,p_request_key,0,op,fp,e.event_kind,'reverse',e.amount,e.effective_date,e.source_kind,e.transaction_id,e.cash_movement_type,e.cash_category_id,e.cash_payment_source_id,e.cash_charge_date,e.id,reason) RETURNING id INTO reversed_id;
    UPDATE public.savings_entries SET reversed_by_entry_id=reversed_id WHERE id=e.id;
    entry_index=1;
  END IF;
  IF op='cancel_savings_event' THEN
    UPDATE public.transactions SET voided_at=now(),void_request_key=public.budget_derived_request_key(p_request_key,'savings-void-'||t.id),void_fingerprint=fp,void_reason=reason WHERE id=t.id;
  ELSIF kind<>'opening' THEN
    IF t.id IS NULL OR t.voided_at IS NOT NULL THEN
      INSERT INTO public.transactions(description,movement_type,total_amount,transaction_date,charge_date,category_id,payment_source_id,currency,notes)
        VALUES(c->>'description',CASE WHEN kind='deposit' THEN 'expense' ELSE 'income' END,amount,effective,charge,category_id,source_id,'ILS',c->>'notes') RETURNING id INTO transaction_id;
    ELSE
      UPDATE public.transactions SET description=c->>'description',total_amount=amount,transaction_date=effective,charge_date=charge,category_id=cmd.category_id,payment_source_id=source_id,notes=c->>'notes' WHERE id=t.id;
    END IF;
  END IF;
  IF op<>'cancel_savings_event' AND action<>'detach' THEN
    INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,supersedes_entry_id,reason)
      VALUES(account_id,p_request_key,entry_index,op,fp,kind,amount,effective,CASE WHEN kind='opening' THEN 'opening' WHEN e.id IS NOT NULL THEN e.source_kind WHEN action='link_cash' THEN 'existing_transaction' ELSE 'manual' END,
        transaction_id,CASE WHEN kind='opening' THEN NULL WHEN kind='deposit' THEN 'expense' ELSE 'income' END,category_id,source_id,charge,e.id,reason) RETURNING id INTO entry_id;
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
    BEGIN PERFORM public.savings_assert_account(revision);
    EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'לא ניתן להשלים את הפעולה: תיווצר יתרה שלילית או חריגה מהטווח בהיסטוריית החיסכון' USING ERRCODE='23514',DETAIL='SAVINGS_INSUFFICIENT_BALANCE'; END;
  END LOOP;
  SELECT jsonb_agg(se.id::text ORDER BY command_index),jsonb_agg(DISTINCT se.account_id::text),jsonb_agg(DISTINCT to_char(se.effective_date,'YYYY-MM')) INTO receipt,affected,months FROM public.savings_entries se WHERE command_id=p_request_key;
  RETURN jsonb_build_object('entry_ids',receipt,'transaction_id',transaction_id::text,'affected_account_ids',affected,'affected_months',months,'affected_transaction_ids',CASE WHEN transaction_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(transaction_id::text) END);
END $$;

CREATE FUNCTION public.post_savings_event(p_request_key UUID,p_command JSONB) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.savings_post_event_locked(p_request_key,jsonb_build_object('operation','post_savings_event','payload',p_command));
$$;
CREATE FUNCTION public.correct_savings_event(p_request_key UUID,p_entry_id BIGINT,p_expected_revision BIGINT,p_replacement JSONB,p_reason TEXT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.savings_post_event_locked(p_request_key,jsonb_build_object('operation','correct_savings_event','entry_id',p_entry_id::text,'expected_revision',p_expected_revision::text,'payload',p_replacement,'reason',p_reason));
$$;
CREATE FUNCTION public.cancel_savings_event(p_request_key UUID,p_entry_id BIGINT,p_expected_revision BIGINT,p_cash_action TEXT,p_reason TEXT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.savings_post_event_locked(p_request_key,jsonb_build_object('operation','cancel_savings_event','entry_id',p_entry_id::text,'expected_revision',p_expected_revision::text,'payload',jsonb_build_object('action',p_cash_action),'reason',p_reason));
$$;
CREATE FUNCTION public.void_detached_savings_transaction(p_request_key UUID,p_transaction_id INTEGER,p_expected_transaction_fingerprint TEXT,p_reason TEXT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.savings_post_event_locked(p_request_key,jsonb_build_object('operation','void_detached_savings_transaction','payload',jsonb_build_object('transaction_id',p_transaction_id::text,'expected_transaction_fingerprint',p_expected_transaction_fingerprint),'reason',p_reason));
$$;
REVOKE ALL ON FUNCTION public.savings_post_event_locked(UUID,JSONB),public.post_savings_event(UUID,JSONB),public.correct_savings_event(UUID,BIGINT,BIGINT,JSONB,TEXT),public.cancel_savings_event(UUID,BIGINT,BIGINT,TEXT,TEXT),public.void_detached_savings_transaction(UUID,INTEGER,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.post_savings_event(UUID,JSONB),public.correct_savings_event(UUID,BIGINT,BIGINT,JSONB,TEXT),public.cancel_savings_event(UUID,BIGINT,BIGINT,TEXT,TEXT),public.void_detached_savings_transaction(UUID,INTEGER,TEXT,TEXT) TO service_role;

-- Deliberate reader signature migration: existing named arguments remain valid.
-- Filtering is applied in the shared SQL set before pagination AND totals.
DROP FUNCTION public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean);
DROP FUNCTION public.transactions_filtered(date,date,bigint,bigint,boolean,text);
CREATE OR REPLACE FUNCTION public.transactions_filtered(
  p_from                date    DEFAULT NULL,
  p_to                  date    DEFAULT NULL,
  p_category_id         bigint  DEFAULT NULL,
  p_payment_source_id   bigint  DEFAULT NULL,
  p_uncategorized_only  boolean DEFAULT false,
  p_search              text    DEFAULT NULL,
  p_savings_account_id bigint DEFAULT NULL,
  p_transaction_id integer DEFAULT NULL
)
RETURNS TABLE (
  id                integer,
  transaction_date  date,
  description       text,
  movement_type     text,
  total_amount      numeric,
  row_json          jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT
    t.id,
    t.transaction_date,
    t.description::text,
    t.movement_type::text,
    t.total_amount,
    pg_catalog.to_jsonb(t) || pg_catalog.jsonb_build_object(
      'total_amount',t.total_amount::text, 'category_id',t.category_id::text,'payment_source_id',t.payment_source_id::text,
      'transaction_fingerprint',md5((to_jsonb(t)-ARRAY['updated_at','voided_at','void_request_key','void_fingerprint','void_reason'])::text),
      'savings',CASE WHEN se.id IS NULL THEN NULL ELSE jsonb_build_object('entry_id',se.id::text,'account_id',sa.id::text,'name',sa.name,'status',sa.status,'revision',sa.revision::text,'event_kind',se.event_kind,'active',se.reversed_by_entry_id IS NULL,'reinstatable',se.reversed_by_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.savings_entries replacement WHERE replacement.supersedes_entry_id=se.id)) END,
      'categories',
      CASE WHEN c.id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object('name', c.name, 'icon', c.icon, 'savings_role',c.savings_role) END,
      'payment_sources',
      CASE WHEN ps.id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object(
             'id',     ps.id,
             'name',   ps.name,
             'method', ps.method,
             'slug',   ps.slug,
             'issuer', ps.issuer,
             'last4',  ps.last4
           ) END
    )
  FROM public.transactions t
  -- LEFT JOIN is required: transactions with no category or no payment source
  -- must still appear (the "uncategorized only" filter depends on it).
  LEFT JOIN public.categories      c  ON c.id  = t.category_id
  LEFT JOIN public.payment_sources ps ON ps.id = t.payment_source_id
  LEFT JOIN LATERAL (SELECT e.* FROM public.savings_entries e WHERE e.transaction_id=t.id AND e.entry_action='post' ORDER BY (e.reversed_by_entry_id IS NULL) DESC,e.id DESC LIMIT 1) se ON true
  LEFT JOIN public.savings_accounts sa ON sa.id=se.account_id
  WHERE (t.voided_at IS NULL OR p_transaction_id=t.id)
    AND (p_transaction_id IS NULL OR p_transaction_id=t.id)
    AND (p_savings_account_id IS NULL OR se.account_id=p_savings_account_id)
    AND (p_from IS NULL OR t.transaction_date >= p_from)
    AND (p_to   IS NULL OR t.transaction_date <= p_to)
    AND (p_category_id IS NULL OR t.category_id = p_category_id)
    AND (p_payment_source_id IS NULL OR t.payment_source_id = p_payment_source_id)
    AND (NOT COALESCE(p_uncategorized_only, false) OR t.category_id IS NULL)
    AND (
      public.transactions_search_pattern(p_search) IS NULL
      -- Mirrors the previous client-side search exactly: description,
      -- amount-as-text, category name, payment source name. Notes are NOT
      -- searched, because the old implementation did not search them.
      OR t.description        ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR t.total_amount::text ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR sa.name              ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR c.name               ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
      OR ps.name              ILIKE public.transactions_search_pattern(p_search) ESCAPE '\'
    );
$$;
CREATE OR REPLACE FUNCTION public.transactions_page(
  p_from                        date    DEFAULT NULL,
  p_to                          date    DEFAULT NULL,
  p_category_id                 bigint  DEFAULT NULL,
  p_payment_source_id           bigint  DEFAULT NULL,
  p_uncategorized_only          boolean DEFAULT false,
  p_search                      text    DEFAULT NULL,
  p_limit                       integer DEFAULT 100,
  p_sort_by                     text    DEFAULT 'transaction_date',
  p_sort_direction              text    DEFAULT 'desc',
  p_cursor_id                   bigint  DEFAULT NULL,
  p_cursor_date                 date    DEFAULT NULL,
  p_cursor_amount               numeric DEFAULT NULL,
  p_cursor_description          text    DEFAULT NULL,
  p_cursor_description_is_null  boolean DEFAULT NULL,
  p_include_totals boolean DEFAULT false,
  p_savings_account_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_probe     integer;
  v_rows      jsonb;
  v_keys      jsonb;
  v_has_more  boolean := false;
  v_next_key  jsonb   := NULL;
  v_totals    jsonb   := NULL;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'transactions_page: p_limit must be a positive integer, got %', p_limit;
  END IF;

  -- One row beyond the page, so has_more is derived from real data rather than
  -- guessed from a full page.
  v_probe := p_limit + 1;

  -- ---------------------------------------------------------------------
  -- transaction_date DESC, id DESC   (the default view)
  -- ---------------------------------------------------------------------
  IF p_sort_by = 'transaction_date' AND p_sort_direction = 'desc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.row_json,
             jsonb_build_object(
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search,p_savings_account_id,NULL) f
      WHERE p_cursor_id IS NULL
         OR f.transaction_date < p_cursor_date
         OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)
      ORDER BY f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- transaction_date ASC, id DESC
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'transaction_date' AND p_sort_direction = 'asc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY p.transaction_date ASC, p.id DESC),
           jsonb_agg(p.k        ORDER BY p.transaction_date ASC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.row_json,
             jsonb_build_object(
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search,p_savings_account_id,NULL) f
      WHERE p_cursor_id IS NULL
         OR f.transaction_date > p_cursor_date
         OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)
      ORDER BY f.transaction_date ASC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- total_amount DESC, transaction_date DESC, id DESC
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'total_amount' AND p_sort_direction = 'desc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY p.total_amount DESC, p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY p.total_amount DESC, p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.total_amount,
             f.row_json,
             jsonb_build_object(
               -- ::text, not a JSON number: NUMERIC must not round-trip a double.
               'av', f.total_amount::text,
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search,p_savings_account_id,NULL) f
      WHERE p_cursor_id IS NULL
         OR f.total_amount < p_cursor_amount
         OR (f.total_amount = p_cursor_amount
             AND (f.transaction_date < p_cursor_date
                  OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)))
      ORDER BY f.total_amount DESC, f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- total_amount ASC, transaction_date DESC, id DESC
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'total_amount' AND p_sort_direction = 'asc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY p.total_amount ASC, p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY p.total_amount ASC, p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.total_amount,
             f.row_json,
             jsonb_build_object(
               'av', f.total_amount::text,
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search,p_savings_account_id,NULL) f
      WHERE p_cursor_id IS NULL
         OR f.total_amount > p_cursor_amount
         OR (f.total_amount = p_cursor_amount
             AND (f.transaction_date < p_cursor_date
                  OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)))
      ORDER BY f.total_amount ASC, f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- description ASC, transaction_date DESC, id DESC   (NULL descriptions last)
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'description' AND p_sort_direction = 'asc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY (p.description IS NULL) ASC,
                                         p.description COLLATE "C" ASC,
                                         p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY (p.description IS NULL) ASC,
                                         p.description COLLATE "C" ASC,
                                         p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.description,
             f.row_json,
             jsonb_build_object(
               'dn', (f.description IS NULL),
               'dv', f.description,
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search,p_savings_account_id,NULL) f
      WHERE p_cursor_id IS NULL
         OR (
           CASE
             -- Still inside the non-NULL block: everything that sorts after the
             -- cursor value, plus the entire NULL block that follows it.
             WHEN NOT p_cursor_description_is_null THEN
                  f.description IS NULL
               OR f.description COLLATE "C" > p_cursor_description COLLATE "C"
               OR (f.description COLLATE "C" = p_cursor_description COLLATE "C"
                   AND (f.transaction_date < p_cursor_date
                        OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)))
             -- Already inside the trailing NULL block: only later NULL rows.
             ELSE
               f.description IS NULL
               AND (f.transaction_date < p_cursor_date
                    OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id))
           END
         )
      ORDER BY (f.description IS NULL) ASC,
               f.description COLLATE "C" ASC,
               f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  -- ---------------------------------------------------------------------
  -- description DESC, transaction_date DESC, id DESC  (NULL descriptions last)
  -- ---------------------------------------------------------------------
  ELSIF p_sort_by = 'description' AND p_sort_direction = 'desc' THEN
    SELECT jsonb_agg(p.row_json ORDER BY (p.description IS NULL) ASC,
                                         p.description COLLATE "C" DESC,
                                         p.transaction_date DESC, p.id DESC),
           jsonb_agg(p.k        ORDER BY (p.description IS NULL) ASC,
                                         p.description COLLATE "C" DESC,
                                         p.transaction_date DESC, p.id DESC)
      INTO v_rows, v_keys
    FROM (
      SELECT f.transaction_date,
             f.id,
             f.description,
             f.row_json,
             jsonb_build_object(
               'dn', (f.description IS NULL),
               'dv', f.description,
               'td', to_char(f.transaction_date, 'YYYY-MM-DD'),
               'id', f.id
             ) AS k
      FROM public.transactions_filtered(
             p_from, p_to, p_category_id, p_payment_source_id,
             p_uncategorized_only, p_search,p_savings_account_id,NULL) f
      WHERE p_cursor_id IS NULL
         OR (
           CASE
             WHEN NOT p_cursor_description_is_null THEN
                  f.description IS NULL
               OR f.description COLLATE "C" < p_cursor_description COLLATE "C"
               OR (f.description COLLATE "C" = p_cursor_description COLLATE "C"
                   AND (f.transaction_date < p_cursor_date
                        OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id)))
             ELSE
               f.description IS NULL
               AND (f.transaction_date < p_cursor_date
                    OR (f.transaction_date = p_cursor_date AND f.id < p_cursor_id))
           END
         )
      ORDER BY (f.description IS NULL) ASC,
               f.description COLLATE "C" DESC,
               f.transaction_date DESC, f.id DESC
      LIMIT v_probe
    ) p;

  ELSE
    RAISE EXCEPTION 'transactions_page: unsupported sort % %', p_sort_by, p_sort_direction;
  END IF;

  -- jsonb_agg over an empty set returns NULL, not '[]'.
  v_rows := COALESCE(v_rows, '[]'::jsonb);
  v_keys := COALESCE(v_keys, '[]'::jsonb);

  v_has_more := jsonb_array_length(v_rows) > p_limit;

  IF v_has_more THEN
    -- Drop the probe row. The explicit ORDER BY on the ordinality keeps the
    -- page order intact through the re-aggregation.
    SELECT jsonb_agg(e ORDER BY o)
      INTO v_rows
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS x(e, o)
    WHERE o <= p_limit;

    -- Keyset position of the LAST ROW ACTUALLY RETURNED (0-based index),
    -- never the probe row.
    v_next_key := v_keys -> (p_limit - 1);
  END IF;

  -- Totals cover the whole filtered set, not the returned page: summing a
  -- single page would understate the user's real totals. Requested on the
  -- first page only, which is why this must be a real conditional.
  IF COALESCE(p_include_totals, false) THEN
    SELECT jsonb_build_object(
             'count',   COUNT(*),
             -- The income/expense split follows the existing movement_type
             -- contract: total_amount carries the magnitude and movement_type
             -- carries the direction. Unchanged from calculateSummaryStats.
             -- (Note: there is no CHECK constraint forcing total_amount >= 0;
             -- this mirrors whatever is stored, it does not assume a sign.)
             'income',  COALESCE(SUM(f.total_amount) FILTER (WHERE f.movement_type = 'income'),  0),
             'expense', COALESCE(SUM(f.total_amount) FILTER (WHERE f.movement_type = 'expense'), 0)
           )
      INTO v_totals
    FROM public.transactions_filtered(
           p_from, p_to, p_category_id, p_payment_source_id,
           p_uncategorized_only, p_search,p_savings_account_id,NULL) f;
  END IF;

  RETURN jsonb_build_object(
    'data',     v_rows,
    'has_more', v_has_more,
    'next_key', v_next_key,
    'totals',   v_totals
  );
END;
$$;
REVOKE ALL ON FUNCTION public.transactions_filtered(date,date,bigint,bigint,boolean,text,bigint,integer),public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transactions_filtered(date,date,bigint,bigint,boolean,text,bigint,integer),public.transactions_page(date,date,bigint,bigint,boolean,text,integer,text,text,bigint,date,numeric,text,boolean,boolean,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.savings_guard_transaction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF num_nonnulls(NEW.voided_at,NEW.void_request_key,NEW.void_fingerprint,NEW.void_reason)>0 THEN RAISE EXCEPTION 'לא ניתן ליצור תנועה שבוטלה מראש' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'תנועה שבוטלה נשמרת לקריאה בלבד' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.savings_entries WHERE transaction_id=OLD.id) THEN RAISE EXCEPTION 'יש לבטל תנועת חיסכון בפקודה הייעודית; אין למחוק היסטוריה' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.savings_entries WHERE transaction_id=OLD.id)
    AND (NEW.transaction_date,NEW.total_amount,NEW.category_id,NEW.payment_source_id,NEW.charge_date,NEW.voided_at) IS DISTINCT FROM
        (OLD.transaction_date,OLD.total_amount,OLD.category_id,OLD.payment_source_id,OLD.charge_date,OLD.voided_at)
    AND (EXISTS (SELECT 1 FROM public.budget_operations o JOIN public.budget_months m ON m.id=o.budget_month_id
      WHERE m.month_start IN (date_trunc('month',OLD.transaction_date)::date,date_trunc('month',NEW.transaction_date)::date) AND o.operation_type='month_close')
      OR EXISTS (SELECT 1 FROM public.budget_operation_items i JOIN public.budget_months m ON m.id=i.budget_month_id
        WHERE m.month_start IN (date_trunc('month',OLD.transaction_date)::date,date_trunc('month',NEW.transaction_date)::date) AND i.item_kind IN ('carryover','unused_disposition','savings_transfer'))) THEN
    RAISE EXCEPTION 'התיקון ישנה היסטוריית תקציב שנלכדה; אין לשנות תנועה זו בנתיב הרגיל' USING ERRCODE='23514',DETAIL='SAVINGS_HISTORY_CORRECTION_BLOCKED';
  END IF;
  IF NEW.voided_at IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM public.savings_entries WHERE transaction_id=OLD.id)
    OR (to_jsonb(NEW)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['voided_at','void_request_key','void_fingerprint','void_reason','updated_at'])) THEN
    RAISE EXCEPTION 'ביטול מחייב תנועת חיסכון שמורה וקבלה תקינה ללא שינוי כספי נוסף' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
COMMIT;
