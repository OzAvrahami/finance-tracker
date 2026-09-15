-- Migration 032: Realized Savings interest (SAV-04).
-- Requires 031. Function replacements only; no data migration, new objects or estimated interest.
BEGIN;

-- Private command engine. Public wrappers construct the operation envelope;
-- clients cannot submit internal operation/receipt fields as financial input.
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
    IF e.event_kind NOT IN ('opening','deposit','withdrawal','interest_capitalized','interest_payout') OR e.source_kind='budget_surplus' OR e.occurrence_month IS NOT NULL THEN
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
  IF op='post_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash','noncash')) THEN RAISE EXCEPTION 'יש לבחור רישום כספי, קישור או ריבית בחיסכון' USING ERRCODE='22023'; END IF;
  IF op='correct_savings_event' AND (action IS NULL OR action NOT IN ('create_cash','link_cash','detach','noncash')) THEN RAISE EXCEPTION 'יש לבחור תיקון, ניתוק או החזרה מפורשת' USING ERRCODE='22023'; END IF;
  IF op='cancel_savings_event' AND action IS DISTINCT FROM (CASE WHEN e.event_kind='interest_capitalized' THEN 'none' ELSE 'void' END) THEN
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
      IF amount IS NULL OR amount<0 OR (kind<>'opening' AND amount=0) OR kind IS NULL OR kind NOT IN ('deposit','withdrawal','opening','interest_capitalized','interest_payout') THEN RAISE EXCEPTION 'סכום או סוג אירוע אינם תקינים' USING ERRCODE='22023'; END IF;
      IF effective IS NULL OR effective<a.tracking_start_date OR effective>timezone('Asia/Jerusalem',statement_timestamp())::date
        OR (kind<>'opening' AND effective=a.tracking_start_date AND c->'cutoff_confirmed' IS DISTINCT FROM 'true'::jsonb) THEN
        RAISE EXCEPTION 'התאריך חייב להיות בתחום המעקב; ביום הפתיחה יש לאשר שהכסף אינו כלול ביתרת הפתיחה' USING ERRCODE='22023',DETAIL='SAVINGS_CUTOFF_VIOLATION';
      END IF;
      IF e.id IS NULL AND kind='opening' THEN RAISE EXCEPTION 'יתרת פתיחה נוצרת רק עם החשבון' USING ERRCODE='22023'; END IF;
      IF e.id IS NOT NULL AND kind<>e.event_kind AND NOT (kind IN ('interest_capitalized','interest_payout') AND e.event_kind IN ('interest_capitalized','interest_payout')) THEN RAISE EXCEPTION 'אין להפוך הפקדה למשיכה; יש לבטל ולרשום אירוע נפרד' USING ERRCODE='22023'; END IF;
      IF reinstate AND kind<>e.event_kind THEN RAISE EXCEPTION 'החזרה משחזרת את יעד האירוע המקורי; תיקון יעד נעשה לאחר מכן בנפרד' USING ERRCODE='22023'; END IF;
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
    INSERT INTO public.savings_entries(account_id,command_id,command_index,command_kind,command_fingerprint,event_kind,amount,effective_date,source_kind,transaction_id,cash_movement_type,cash_category_id,cash_payment_source_id,cash_charge_date,supersedes_entry_id,reason)
      VALUES(account_id,p_request_key,entry_index,op,fp,kind,amount,effective,CASE WHEN kind='opening' THEN 'opening' WHEN e.id IS NOT NULL THEN e.source_kind WHEN action='link_cash' THEN 'existing_transaction' ELSE 'manual' END,
        transaction_id,CASE WHEN kind IN ('opening','interest_capitalized') THEN NULL WHEN kind='deposit' THEN 'expense' ELSE 'income' END,category_id,source_id,charge,e.id,reason) RETURNING id INTO entry_id;
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

-- History remains paginated; eligibility is determined across the complete chain.
CREATE OR REPLACE FUNCTION public.get_savings_account(p_account_id BIGINT,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL,p_before_entry_id BIGINT DEFAULT NULL,p_limit INTEGER DEFAULT 50) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.savings_accounts%ROWTYPE; v_history JSONB; v_summary JSONB; v_period JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_from>p_to OR (p_from IS NOT NULL AND NOT isfinite(p_from)) OR (p_to IS NOT NULL AND NOT isfinite(p_to)) THEN RAISE EXCEPTION 'טווח תאריכים או גודל עמוד אינו תקין' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.savings_accounts WHERE id=p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'חשבון החיסכון לא נמצא' USING ERRCODE='P0002'; END IF;
  SELECT to_jsonb(s)||jsonb_build_object('account_id',s.account_id::text,'revision',s.revision::text,'plan_revision',s.plan_revision::text) INTO v_summary FROM public.savings_account_summary s WHERE account_id=p_account_id;
  SELECT coalesce(jsonb_agg(row ORDER BY id DESC),'[]') INTO v_history FROM (
    SELECT e.id,to_jsonb(e)||jsonb_build_object('reinstatable',e.entry_action='post' AND e.reversed_by_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.savings_entries replacement WHERE replacement.supersedes_entry_id=e.id),'id',e.id::text,'account_id',e.account_id::text,'amount',e.amount::text,'reverses_entry_id',e.reverses_entry_id::text,'reversed_by_entry_id',e.reversed_by_entry_id::text,'supersedes_entry_id',e.supersedes_entry_id::text,'occurrence_root_id',e.occurrence_root_id::text,'plan_revision',e.plan_revision::text,'cash_category_id',e.cash_category_id::text,'cash_payment_source_id',e.cash_payment_source_id::text) AS row
    FROM public.savings_entries e WHERE account_id=p_account_id AND (p_before_entry_id IS NULL OR e.id<p_before_entry_id) AND (p_from IS NULL OR effective_date>=p_from) AND (p_to IS NULL OR effective_date<=p_to) ORDER BY id DESC LIMIT p_limit
  ) page;
  SELECT jsonb_build_object('from',p_from,'to',p_to,'deposits',coalesce(sum(amount*CASE WHEN entry_action='post' THEN 1 ELSE -1 END) FILTER (WHERE event_kind='deposit'),0)::numeric(18,2)::text,
    'withdrawals',coalesce(sum(amount*CASE WHEN entry_action='post' THEN 1 ELSE -1 END) FILTER (WHERE event_kind='withdrawal'),0)::numeric(18,2)::text,
    'realized_interest',coalesce(sum(amount*CASE WHEN entry_action='post' THEN 1 ELSE -1 END) FILTER (WHERE event_kind IN ('interest_capitalized','interest_payout')),0)::numeric(18,2)::text) INTO v_period
    FROM public.savings_entries WHERE account_id=p_account_id AND (p_from IS NULL OR effective_date>=p_from) AND (p_to IS NULL OR effective_date<=p_to);
  RETURN jsonb_build_object('account',(to_jsonb(a)-ARRAY['creation_fingerprint','last_config_fingerprint'])||jsonb_build_object('id',a.id::text,'revision',a.revision::text,'plan_revision',a.plan_revision::text,'default_payment_source_id',a.default_payment_source_id::text,'target_amount',a.target_amount::text,'monthly_amount',a.monthly_amount::text,'annual_interest_rate',a.annual_interest_rate::text),
    'summary',v_summary,'history',v_history,'period',v_period,'next_before_entry_id',CASE WHEN jsonb_array_length(v_history)=p_limit THEN v_history->-1->>'id' END);
END $$;

REVOKE ALL ON FUNCTION public.savings_post_event_locked(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_savings_account(BIGINT,DATE,DATE,BIGINT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_savings_account(BIGINT,DATE,DATE,BIGINT,INTEGER) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
