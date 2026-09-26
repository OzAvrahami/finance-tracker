-- FLI-03: explicit multi-card authority; APY remains the only financial writer.
BEGIN;
LOCK TABLE public.transactions IN EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.flowlink_card_bindings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid() CHECK(public.flowlink_uuid(id)),
 device_id UUID NOT NULL REFERENCES public.flowlink_devices(id) ON DELETE RESTRICT,
 label TEXT NOT NULL CHECK(public.flowlink_label(label)),
 payment_source_id BIGINT NOT NULL REFERENCES public.payment_sources(id) ON DELETE RESTRICT,
 source_id BIGINT NOT NULL UNIQUE REFERENCES public.transaction_ingestion_sources(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','retired')),
 revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 retired_at TIMESTAMPTZ,
 UNIQUE(device_id,id),
 CHECK((status='retired')=(retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flowlink_live_mapping ON public.flowlink_card_bindings(device_id,payment_source_id) WHERE status<>'retired';
CREATE INDEX IF NOT EXISTS idx_flowlink_binding_status ON public.flowlink_card_bindings(device_id,status,id);
CREATE INDEX IF NOT EXISTS idx_flowlink_binding_history ON public.flowlink_card_bindings(device_id,created_at,id);
CREATE TABLE IF NOT EXISTS public.flowlink_binding_commands (
 request_id UUID PRIMARY KEY CHECK(public.flowlink_uuid(request_id)),
 binding_id UUID NOT NULL REFERENCES public.flowlink_card_bindings(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('create','update')),
 command_hash BYTEA NOT NULL CHECK(octet_length(command_hash)=32),
 result JSONB NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=4096
   AND result ?& ARRAY['id','device_id','label','payment_source_id','source_id','status','revision','created_at','updated_at','retired_at']
   AND result-ARRAY['id','device_id','label','payment_source_id','source_id','status','revision','created_at','updated_at','retired_at']='{}'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_flowlink_binding_commands ON public.flowlink_binding_commands(binding_id,created_at);
CREATE OR REPLACE FUNCTION public.flowlink_binding_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'flowlink_history_protected' USING ERRCODE='23514'; END IF;
 IF OLD.status='retired' OR NEW.revision<>OLD.revision+1 OR
  (to_jsonb(NEW)-ARRAY['label','status','revision','updated_at','retired_at']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['label','status','revision','updated_at','retired_at'])
 THEN RAISE EXCEPTION 'flowlink_binding_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS flowlink_bindings_guard ON public.flowlink_card_bindings;
CREATE TRIGGER flowlink_bindings_guard BEFORE UPDATE OR DELETE ON public.flowlink_card_bindings
 FOR EACH ROW EXECUTE FUNCTION public.flowlink_binding_guard();
DROP TRIGGER IF EXISTS flowlink_commands_guard ON public.flowlink_binding_commands;
CREATE TRIGGER flowlink_commands_guard BEFORE UPDATE OR DELETE ON public.flowlink_binding_commands
 FOR EACH ROW EXECUTE FUNCTION public.apy_append_only();

CREATE OR REPLACE FUNCTION public.flowlink_decimal(v JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}') !~ '^[1-9][0-9]{0,18}$' THEN RETURN false; END IF;
 RETURN (v#>>'{}')::numeric<=9223372036854775807;
END $$;
CREATE OR REPLACE FUNCTION public.flowlink_owner_binding(p_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',id,'device_id',device_id,'label',label,'payment_source_id',payment_source_id::text,
 'source_id',source_id::text,'status',status,'revision',revision::text,'created_at',created_at,'updated_at',updated_at,'retired_at',retired_at)
 FROM public.flowlink_card_bindings WHERE id=p_id
$$;
CREATE OR REPLACE FUNCTION public.flowlink_source_matches(b public.flowlink_card_bindings,s public.transaction_ingestion_sources) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(s.id=b.source_id AND s.source_kind='apple_pay' AND s.instance_key='flowlink:'||b.id::text
 AND s.configuration->'payment_source_ids'=jsonb_build_array(b.payment_source_id::text),false)
$$;

CREATE OR REPLACE FUNCTION public.create_flowlink_binding(p_owner_id UUID,p_request_key UUID,p_command JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE d public.flowlink_devices%ROWTYPE; receipt public.flowlink_binding_commands%ROWTYPE;
 h BYTEA; bid UUID; ps BIGINT; cfg JSONB; src JSONB; result JSONB;
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 IF p_owner_id IS NULL OR NOT public.flowlink_uuid(p_request_key) OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
 OR p_command-ARRAY['device_id','label','payment_source_id']<>'{}'
 OR jsonb_typeof(p_command->'device_id') IS DISTINCT FROM 'string'
 OR coalesce(p_command->>'device_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR jsonb_typeof(p_command->'label') IS DISTINCT FROM 'string' OR NOT public.flowlink_label(p_command->>'label')
 OR NOT public.flowlink_decimal(p_command->'payment_source_id') THEN RETURN public.flowlink_error('invalid_input'); END IF;
 h=decode(public.apy_hash(jsonb_build_object('operation','create','actor',p_owner_id,'command',p_command)),'hex');
 SELECT * INTO receipt FROM public.flowlink_binding_commands WHERE request_id=p_request_key;
 IF FOUND THEN
  IF receipt.command_hash<>h THEN RETURN public.flowlink_error('request_key_conflict'); END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 -- A UUID already used by another APY command must never be repurposed.
 IF EXISTS(SELECT 1 FROM public.transaction_reconciliation_events WHERE request_key=p_request_key) THEN RETURN public.flowlink_error('request_key_conflict'); END IF;
 SELECT * INTO d FROM public.flowlink_devices WHERE id=(p_command->>'device_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RETURN public.flowlink_error('not_found'); END IF;
 IF d.status<>'active' THEN RETURN public.flowlink_error('state_conflict'); END IF;
 ps=(p_command->>'payment_source_id')::bigint;
 IF EXISTS(SELECT 1 FROM public.flowlink_card_bindings WHERE device_id=d.id AND payment_source_id=ps AND status<>'retired') THEN RETURN public.flowlink_error('state_conflict'); END IF;
 IF (SELECT count(*) FROM public.flowlink_card_bindings WHERE device_id=d.id AND status<>'retired')>=32 THEN RETURN public.flowlink_error('rate_limited'); END IF;
 PERFORM id FROM public.payment_sources WHERE id=ps AND is_active FOR SHARE;
 IF NOT FOUND THEN RETURN public.flowlink_error('state_conflict'); END IF;
 bid=gen_random_uuid();
 cfg=jsonb_build_object('payment_source_ids',jsonb_build_array(ps::text),'card_mappings','[]'::jsonb,'aliases','[]'::jsonb,'time_verified',false,'verified_references','[]'::jsonb);
 src=public.configure_ingestion_source(p_request_key,jsonb_build_object('source_kind','apple_pay','instance_key','flowlink:'||bid::text,
 'configuration',cfg,'is_active',true,'actor','flowlink_owner:'||p_owner_id::text));
 INSERT INTO public.flowlink_card_bindings(id,device_id,label,payment_source_id,source_id,created_by)
 VALUES(bid,d.id,p_command->>'label',ps,(src->>'source_id')::bigint,p_owner_id);
 result=public.flowlink_owner_binding(bid);
 INSERT INTO public.flowlink_binding_commands(request_id,binding_id,actor_id,operation,command_hash,result)
 VALUES(p_request_key,bid,p_owner_id,'create',h,result);
 RETURN result||jsonb_build_object('replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.update_flowlink_binding(p_owner_id UUID,p_request_key UUID,p_command JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b public.flowlink_card_bindings%ROWTYPE; d public.flowlink_devices%ROWTYPE; s public.transaction_ingestion_sources%ROWTYPE;
 receipt public.flowlink_binding_commands%ROWTYPE; h BYTEA; result JSONB; newstatus TEXT; newlabel TEXT;
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 IF p_owner_id IS NULL OR NOT public.flowlink_uuid(p_request_key) OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
 OR p_command-ARRAY['binding_id','expected_revision','status','label']<>'{}'
 OR coalesce(p_command->>'binding_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR NOT public.flowlink_decimal(p_command->'expected_revision') OR NOT (p_command ?| ARRAY['status','label'])
 OR (p_command ? 'status' AND coalesce(p_command->>'status','') NOT IN ('active','disabled','retired'))
 OR (p_command ? 'label' AND (jsonb_typeof(p_command->'label') IS DISTINCT FROM 'string' OR NOT public.flowlink_label(p_command->>'label')))
 THEN RETURN public.flowlink_error('invalid_input'); END IF;
 h=decode(public.apy_hash(jsonb_build_object('operation','update','actor',p_owner_id,'command',p_command)),'hex');
 SELECT * INTO receipt FROM public.flowlink_binding_commands WHERE request_id=p_request_key;
 IF FOUND THEN
  IF receipt.command_hash<>h THEN RETURN public.flowlink_error('request_key_conflict'); END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.transaction_reconciliation_events WHERE request_key=p_request_key) THEN RETURN public.flowlink_error('request_key_conflict'); END IF;
 SELECT * INTO b FROM public.flowlink_card_bindings WHERE id=(p_command->>'binding_id')::uuid;
 IF NOT FOUND THEN RETURN public.flowlink_error('not_found'); END IF;
 SELECT * INTO d FROM public.flowlink_devices WHERE id=b.device_id FOR UPDATE;
 SELECT * INTO b FROM public.flowlink_card_bindings WHERE id=b.id FOR UPDATE;
 IF b.revision<>(p_command->>'expected_revision')::bigint THEN RETURN public.flowlink_error('stale_revision'); END IF;
 IF b.status='retired' THEN RETURN public.flowlink_error('state_conflict'); END IF;
 newstatus=coalesce(p_command->>'status',b.status); newlabel=coalesce(p_command->>'label',b.label);
 IF newstatus=b.status AND newlabel=b.label THEN RETURN public.flowlink_error('invalid_input'); END IF;
 SELECT * INTO s FROM public.transaction_ingestion_sources WHERE id=b.source_id FOR UPDATE;
 IF NOT public.flowlink_source_matches(b,s) THEN RETURN public.flowlink_error('flowlink_configuration_invalid'); END IF;
 IF newstatus='active' THEN
  IF d.status<>'active' THEN RETURN public.flowlink_error('state_conflict'); END IF;
  PERFORM id FROM public.payment_sources WHERE id=b.payment_source_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RETURN public.flowlink_error('state_conflict'); END IF;
 END IF;
 -- Preserve the current approved configuration (including aliases), never environment bootstrap.
 PERFORM public.configure_ingestion_source(p_request_key,jsonb_build_object('source_kind',s.source_kind,'instance_key',s.instance_key,
 'expected_revision',s.revision::text,'configuration',s.configuration,'is_active',newstatus='active','actor','flowlink_owner:'||p_owner_id::text));
 UPDATE public.flowlink_card_bindings SET label=newlabel,status=newstatus,revision=revision+1,updated_at=clock_timestamp(),
 retired_at=CASE WHEN newstatus='retired' THEN clock_timestamp() ELSE NULL END WHERE id=b.id;
 result=public.flowlink_owner_binding(b.id);
 INSERT INTO public.flowlink_binding_commands(request_id,binding_id,actor_id,operation,command_hash,result)
 VALUES(p_request_key,b.id,p_owner_id,'update',h,result);
 RETURN result||jsonb_build_object('replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.list_flowlink_payment_sources(p_cursor JSONB DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result JSONB; tail JSONB;
BEGIN
 IF p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor) IS DISTINCT FROM 'object' OR p_cursor-ARRAY['id']<>'{}' OR NOT public.flowlink_decimal(p_cursor->'id'))
 THEN RETURN public.flowlink_error('invalid_input'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'name',x.name,'method',x.method,'issuer',x.issuer,'last4',x.last4,'is_active',x.is_active) ORDER BY x.id),'[]') INTO result
 FROM (SELECT * FROM public.payment_sources WHERE is_active AND (p_cursor IS NULL OR id>(p_cursor->>'id')::bigint) ORDER BY id LIMIT 101) x;
 IF jsonb_array_length(result)>100 THEN
  result=result-100;tail=result->99;
  RETURN jsonb_build_object('payment_sources',result,'next_cursor',jsonb_build_object('id',tail->'id'));
 END IF;
 RETURN jsonb_build_object('payment_sources',result,'next_cursor',NULL);
END $$;
CREATE OR REPLACE FUNCTION public.list_flowlink_owner_bindings(p_device_id UUID,p_cursor JSONB DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result JSONB; tail JSONB; v_date TIMESTAMPTZ; v_id UUID;
BEGIN
 IF NOT public.flowlink_uuid(p_device_id) THEN RETURN public.flowlink_error('invalid_input'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.flowlink_devices WHERE id=p_device_id) THEN RETURN public.flowlink_error('not_found'); END IF;
 IF p_cursor IS NOT NULL THEN
  IF jsonb_typeof(p_cursor) IS DISTINCT FROM 'object' OR p_cursor-ARRAY['created_at','id']<>'{}'
   OR coalesce(p_cursor->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR jsonb_typeof(p_cursor->'created_at') IS DISTINCT FROM 'string' THEN RETURN public.flowlink_error('invalid_input'); END IF;
  BEGIN v_date=(p_cursor->>'created_at')::timestamptz; v_id=(p_cursor->>'id')::uuid;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN public.flowlink_error('invalid_input'); END;
  IF NOT isfinite(v_date) THEN RETURN public.flowlink_error('invalid_input'); END IF;
 END IF;
 SELECT coalesce(jsonb_agg(public.flowlink_owner_binding(x.id) ORDER BY x.created_at,x.id),'[]') INTO result
 FROM (SELECT id,created_at FROM public.flowlink_card_bindings WHERE device_id=p_device_id AND
 (p_cursor IS NULL OR (created_at,id)>(v_date,v_id)) ORDER BY created_at,id LIMIT 51) x;
 IF jsonb_array_length(result)>50 THEN
  result=result-50;tail=result->49;
  RETURN jsonb_build_object('bindings',result,'next_cursor',jsonb_build_object('created_at',tail->'created_at','id',tail->'id'));
 END IF;
 RETURN jsonb_build_object('bindings',result,'next_cursor',NULL);
END $$;
CREATE OR REPLACE FUNCTION public.list_flowlink_bindings(p_credential_sha256 BYTEA) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE auth JSONB; result JSONB;
BEGIN
 auth=public.get_flowlink_device(p_credential_sha256);
 IF auth ? 'error' THEN RETURN auth; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'label',b.label,'status',b.status,'revision',b.revision::text,
 'available',b.status='active' AND s.is_active AND p.is_active AND public.flowlink_source_matches(b,s)) ORDER BY b.id),'[]') INTO result
 FROM public.flowlink_card_bindings b JOIN public.transaction_ingestion_sources s ON s.id=b.source_id
 JOIN public.payment_sources p ON p.id=b.payment_source_id
 WHERE b.device_id=(auth->'device'->>'id')::uuid AND b.status<>'retired';
 RETURN jsonb_build_object('bindings',result);
END $$;

CREATE OR REPLACE FUNCTION public.ingest_flowlink_observation(p_credential_sha256 BYTEA,p_request JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.flowlink_device_credentials%ROWTYPE; d public.flowlink_devices%ROWTYPE;
 b public.flowlink_card_bindings%ROWTYPE; s public.transaction_ingestion_sources%ROWTYPE; k TEXT; observation JSONB;
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 SELECT * INTO c FROM public.flowlink_device_credentials WHERE credential_sha256=p_credential_sha256;
 IF NOT FOUND THEN RETURN public.flowlink_error('unauthorized'); END IF;
 SELECT * INTO d FROM public.flowlink_devices WHERE id=c.device_id FOR UPDATE;
 SELECT * INTO c FROM public.flowlink_device_credentials WHERE id=c.id FOR UPDATE;
 IF d.status<>'active' OR c.status<>'active' THEN RETURN public.flowlink_error('unauthorized'); END IF;
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RETURN public.flowlink_error('invalid_input'); END IF;
 IF p_request-ARRAY['binding_id','amount','currency','merchant','transaction_date','idempotency_key']<>'{}' THEN RETURN public.flowlink_error('unsupported_field'); END IF;
 FOREACH k IN ARRAY ARRAY['binding_id','idempotency_key'] LOOP
  IF jsonb_typeof(p_request->k) IS DISTINCT FROM 'string' OR coalesce(p_request->>k,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN RETURN public.flowlink_error('invalid_input'); END IF;
 END LOOP;
 SELECT * INTO b FROM public.flowlink_card_bindings WHERE id=(p_request->>'binding_id')::uuid FOR UPDATE;
 IF NOT FOUND OR b.device_id<>d.id OR b.status<>'active' THEN RETURN public.flowlink_error('binding_unavailable'); END IF;
 SELECT * INTO s FROM public.transaction_ingestion_sources WHERE id=b.source_id FOR UPDATE;
 IF NOT public.flowlink_source_matches(b,s) OR NOT s.is_active THEN RETURN public.flowlink_error('flowlink_configuration_invalid'); END IF;
 PERFORM id FROM public.payment_sources WHERE id=b.payment_source_id AND is_active FOR SHARE;
 IF NOT FOUND THEN RETURN public.apy_rejected('payment_source_not_found'); END IF;
 IF jsonb_typeof(p_request->'amount') IS DISTINCT FROM 'string' OR coalesce(p_request->>'amount','') !~ '^(0|[1-9][0-9]{0,27})\.[0-9]{2}$'
 THEN RETURN public.apy_rejected('invalid_accounting_amount'); END IF;
 IF (p_request->>'amount')::numeric<=0 THEN RETURN public.apy_rejected('invalid_accounting_amount'); END IF;
 IF p_request->>'currency' IS DISTINCT FROM 'ILS' THEN RETURN public.apy_rejected('accounting_amount_required'); END IF;
 IF jsonb_typeof(p_request->'merchant') IS DISTINCT FROM 'string' OR length(p_request->>'merchant') NOT BETWEEN 1 AND 512
 OR public.apy_merchant(p_request->>'merchant')='' OR (p_request->>'merchant') ~ '[[:cntrl:]]'
 OR btrim(p_request->>'merchant') ~* '^attachment( [0-9]+)?\.txt$' THEN RETURN public.apy_rejected('invalid_merchant'); END IF;
 BEGIN
  IF jsonb_typeof(p_request->'transaction_date') IS DISTINCT FROM 'string' OR coalesce(p_request->>'transaction_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  THEN RETURN public.apy_rejected('invalid_date'); END IF;
  PERFORM public.apy_date(p_request->>'transaction_date');
 EXCEPTION WHEN SQLSTATE '22023' OR invalid_datetime_format OR datetime_field_overflow THEN RETURN public.apy_rejected('invalid_date'); END;
 observation=jsonb_build_object('idempotency_key',p_request->>'idempotency_key','accounting_amount',p_request->>'amount','currency','ILS',
 'movement_type','expense','merchant',p_request->>'merchant','transaction_date',p_request->>'transaction_date','payment_source_id',b.payment_source_id::text);
 RETURN public.ingest_observation(s.id,observation);
END $$;

ALTER TABLE public.flowlink_card_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flowlink_binding_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flowlink_card_bindings,public.flowlink_binding_commands FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE f RECORD; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname IN ('flowlink_binding_guard','flowlink_decimal','flowlink_owner_binding','flowlink_source_matches',
 'create_flowlink_binding','update_flowlink_binding','list_flowlink_bindings','list_flowlink_owner_bindings','list_flowlink_payment_sources','ingest_flowlink_observation')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.proname NOT LIKE 'flowlink_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END IF;
 END LOOP;
END $$;
COMMIT;
