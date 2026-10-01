-- SYNTHETIC LOCAL REVIEW ONLY. Never run against production.
-- Caller must explicitly SET apy83.local_review='yes' on a verified disposable database.
BEGIN;
DO $$
DECLARE payment BIGINT; apple BIGINT; cal BIGINT; r JSONB; cfg JSONB; n INTEGER; obs JSONB;
BEGIN
 IF current_setting('apy83.local_review',true) IS DISTINCT FROM 'yes' THEN
  RAISE EXCEPTION 'Disposable fixture requires explicit local opt-in';
 END IF;
 SELECT id INTO payment FROM public.payment_sources WHERE slug='apy83-local-review';
 IF payment IS NULL THEN
  INSERT INTO public.payment_sources(name,slug,method,last4,is_active)
  VALUES('APY83 — synthetic local review','apy83-local-review','credit_card','2755',true) RETURNING id INTO payment;
 END IF;
 cfg=jsonb_build_object('payment_source_ids',jsonb_build_array(payment::text),'card_mappings','[]'::jsonb,'aliases','[]'::jsonb,'time_verified',false,'verified_references','[]'::jsonb);
 r=public.configure_ingestion_source('83000000-0000-4000-8000-000000000001',jsonb_build_object('source_kind','apple_pay','instance_key','apy83-local-apple','configuration',cfg,'actor','isolated fixture'));
 apple=(r->>'source_id')::bigint;
 r=public.configure_ingestion_source('83000000-0000-4000-8000-000000000002',jsonb_build_object('source_kind','cal','instance_key','apy83-local-cal','configuration',cfg,'actor','isolated fixture'));
 cal=(r->>'source_id')::bigint;
 FOR n IN 1..3 LOOP
  obs=jsonb_build_object('idempotency_key','apy83-local-'||n,'merchant',CASE WHEN n=1 THEN 'Ninja Star Ltd' ELSE 'Israel Post' END,
   'accounting_amount',CASE WHEN n=1 THEN '10.00' ELSE '6.00' END,'currency','ILS','movement_type','expense','transaction_date','2026-09-30','payment_source_id',payment::text);
  r=public.ingest_observation(apple,obs);
  IF r->>'outcome'='created' THEN UPDATE public.transactions SET description='APY83 בדיקה מקומית — '||(obs->>'merchant') WHERE id=(r->>'transaction_id')::integer; END IF;
 END LOOP;
 FOR n IN 1..3 LOOP
  obs=jsonb_build_object('idempotency_key','apy83-local-cal-'||n,'merchant',CASE WHEN n=1 THEN 'נינג''ה סטאר' ELSE 'נאייקס ישראל מכונות אוטומ…' END,
   'accounting_amount',CASE WHEN n=1 THEN '10.00' ELSE '6.00' END,'currency','ILS','movement_type','expense','transaction_date','2026-09-30','charge_date','2026-10-01','payment_source_id',payment::text);
  PERFORM public.ingest_observation(cal,obs);
 END LOOP;
END $$;
COMMIT;
