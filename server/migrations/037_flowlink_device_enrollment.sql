-- FLI-02 only. No card bindings, APY sources or financial writes.
BEGIN;
LOCK TABLE public.transactions IN EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.flowlink_uuid(v UUID) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(v::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
$$;
CREATE OR REPLACE FUNCTION public.flowlink_label(v TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(length(v) BETWEEN 1 AND 80 AND v=btrim(v) AND v !~ '[[:cntrl:]]'
   AND v !~ '([0-9][ -]*){13}',false)
$$;
CREATE OR REPLACE FUNCTION public.flowlink_error(code TEXT) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('error',jsonb_build_object('code',code))
$$;

CREATE TABLE IF NOT EXISTS public.flowlink_devices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid() CHECK(public.flowlink_uuid(id)),
 label TEXT NOT NULL CHECK(public.flowlink_label(label)),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 created_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 revoked_at TIMESTAMPTZ, revoked_by UUID,
 CHECK((status='active' AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_flowlink_devices_created ON public.flowlink_devices(created_at,id);
CREATE TABLE IF NOT EXISTS public.flowlink_device_credentials (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid() CHECK(public.flowlink_uuid(id)),
 device_id UUID NOT NULL REFERENCES public.flowlink_devices(id) ON DELETE RESTRICT,
 credential_sha256 BYTEA NOT NULL UNIQUE CHECK(octet_length(credential_sha256)=32),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 revision BIGINT NOT NULL CHECK(revision>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 revoked_at TIMESTAMPTZ, revocation_reason TEXT,
 UNIQUE(device_id,revision),
 CHECK((status='active' AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR (status='revoked' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND revocation_reason IN ('rotated','device_revoked')))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flowlink_one_active_credential
 ON public.flowlink_device_credentials(device_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_flowlink_credentials_device ON public.flowlink_device_credentials(device_id);
CREATE TABLE IF NOT EXISTS public.flowlink_pairing_capabilities (
 id UUID PRIMARY KEY CHECK(public.flowlink_uuid(id)),
 secret_sha256 BYTEA NOT NULL CHECK(octet_length(secret_sha256)=32),
 purpose TEXT NOT NULL CHECK(purpose IN ('enroll','replace_credential')),
 target_device_id UUID REFERENCES public.flowlink_devices(id) ON DELETE RESTRICT,
 device_label TEXT NOT NULL CHECK(public.flowlink_label(device_label)),
 created_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 expires_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','consumed','cancelled','locked','expired')),
 failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
 consumed_at TIMESTAMPTZ,
 redemption_id UUID UNIQUE CHECK(redemption_id IS NULL OR public.flowlink_uuid(redemption_id)),
 claim_hash BYTEA CHECK(claim_hash IS NULL OR octet_length(claim_hash)=32),
 result_device_id UUID REFERENCES public.flowlink_devices(id) ON DELETE RESTRICT,
 result_credential_id UUID REFERENCES public.flowlink_device_credentials(id) ON DELETE RESTRICT,
 cancelled_at TIMESTAMPTZ,
 CHECK(expires_at=created_at+interval '10 minutes'),
 CHECK((purpose='enroll' AND target_device_id IS NULL)
    OR (purpose='replace_credential' AND target_device_id IS NOT NULL)),
 CHECK((status='consumed' AND consumed_at IS NOT NULL AND redemption_id IS NOT NULL
    AND claim_hash IS NOT NULL AND result_device_id IS NOT NULL AND result_credential_id IS NOT NULL)
    OR (status<>'consumed' AND consumed_at IS NULL AND redemption_id IS NULL
    AND claim_hash IS NULL AND result_device_id IS NULL AND result_credential_id IS NULL)),
 CHECK(purpose<>'replace_credential' OR result_device_id IS NULL OR result_device_id=target_device_id),
 CHECK((status='cancelled')=(cancelled_at IS NOT NULL)),
 CHECK((status='locked')=(failed_attempts=5))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flowlink_pending_replacement
 ON public.flowlink_pairing_capabilities(target_device_id) WHERE status='pending' AND purpose='replace_credential';
CREATE INDEX IF NOT EXISTS idx_flowlink_pairing_owner ON public.flowlink_pairing_capabilities(created_by,created_at);
CREATE INDEX IF NOT EXISTS idx_flowlink_pairing_expiry ON public.flowlink_pairing_capabilities(status,expires_at);

CREATE OR REPLACE FUNCTION public.flowlink_identity_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'flowlink_history_protected' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='flowlink_devices' THEN
  IF (to_jsonb(NEW)-ARRAY['status','updated_at','revoked_at','revoked_by']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','updated_at','revoked_at','revoked_by']) OR OLD.status='revoked'
  THEN RAISE EXCEPTION 'flowlink_identity_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='revoked' AND EXISTS(SELECT 1 FROM public.flowlink_device_credentials WHERE device_id=NEW.id AND status='active')
  THEN RAISE EXCEPTION 'flowlink_active_credential' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','revoked_at','revocation_reason']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','revoked_at','revocation_reason']) OR OLD.status='revoked')
  THEN RAISE EXCEPTION 'flowlink_credential_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='active' AND NOT EXISTS(SELECT 1 FROM public.flowlink_devices WHERE id=NEW.device_id AND status='active')
  THEN RAISE EXCEPTION 'flowlink_device_unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.flowlink_pairing_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.created_at>clock_timestamp()-interval '90 days' THEN
   RAISE EXCEPTION 'flowlink_receipt_retained' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF OLD.status<>'pending' OR
   (to_jsonb(NEW)-ARRAY['status','failed_attempts','consumed_at','redemption_id','claim_hash','result_device_id','result_credential_id','cancelled_at'])
    IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','failed_attempts','consumed_at','redemption_id','claim_hash','result_device_id','result_credential_id','cancelled_at'])
   OR NEW.failed_attempts<OLD.failed_attempts OR NEW.failed_attempts>OLD.failed_attempts+1
 THEN RAISE EXCEPTION 'flowlink_pairing_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS flowlink_devices_guard ON public.flowlink_devices;
CREATE TRIGGER flowlink_devices_guard BEFORE UPDATE OR DELETE ON public.flowlink_devices
 FOR EACH ROW EXECUTE FUNCTION public.flowlink_identity_guard();
DROP TRIGGER IF EXISTS flowlink_credentials_guard ON public.flowlink_device_credentials;
CREATE TRIGGER flowlink_credentials_guard BEFORE INSERT OR UPDATE OR DELETE ON public.flowlink_device_credentials
 FOR EACH ROW EXECUTE FUNCTION public.flowlink_identity_guard();
DROP TRIGGER IF EXISTS flowlink_pairings_guard ON public.flowlink_pairing_capabilities;
CREATE TRIGGER flowlink_pairings_guard BEFORE UPDATE OR DELETE ON public.flowlink_pairing_capabilities
 FOR EACH ROW EXECUTE FUNCTION public.flowlink_pairing_guard();

CREATE OR REPLACE FUNCTION public.flowlink_owner_device(p_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('id',d.id,'label',d.label,'status',d.status,'created_at',d.created_at,
  'revoked_at',d.revoked_at,'credential_revision',(SELECT max(c.revision)::text FROM public.flowlink_device_credentials c WHERE c.device_id=d.id))
 FROM public.flowlink_devices d WHERE d.id=p_id
$$;
CREATE OR REPLACE FUNCTION public.cleanup_flowlink_pairings() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n INTEGER; m INTEGER;
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 UPDATE public.flowlink_pairing_capabilities SET status='expired'
 WHERE id IN (SELECT id FROM public.flowlink_pairing_capabilities WHERE status='pending' AND expires_at<=clock_timestamp() ORDER BY id LIMIT 500);
 GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM public.flowlink_pairing_capabilities WHERE id IN
  (SELECT id FROM public.flowlink_pairing_capabilities WHERE created_at<=clock_timestamp()-interval '90 days' ORDER BY id LIMIT 500);
 GET DIAGNOSTICS m=ROW_COUNT;
 RETURN jsonb_build_object('expired',n,'pruned',m);
END $$;

CREATE OR REPLACE FUNCTION public.create_flowlink_pairing(p_owner_id UUID,p_pairing_id UUID,p_secret_sha256 BYTEA,p_command JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE d public.flowlink_devices%ROWTYPE; v_label TEXT; v_now TIMESTAMPTZ;
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 IF p_owner_id IS NULL OR NOT public.flowlink_uuid(p_pairing_id) OR coalesce(octet_length(p_secret_sha256),0)<>32
  OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN RETURN public.flowlink_error('invalid_input'); END IF;
 IF p_command->>'purpose'='enroll' THEN
  IF p_command-ARRAY['purpose','label']<>'{}' OR jsonb_typeof(p_command->'label') IS DISTINCT FROM 'string'
    OR NOT public.flowlink_label(p_command->>'label') THEN RETURN public.flowlink_error('invalid_input'); END IF;
  v_label=p_command->>'label';
 ELSIF p_command->>'purpose'='replace_credential' THEN
  IF p_command-ARRAY['purpose','device_id']<>'{}' OR coalesce(p_command->>'device_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN RETURN public.flowlink_error('invalid_input'); END IF;
  SELECT * INTO d FROM public.flowlink_devices WHERE id=(p_command->>'device_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN public.flowlink_error('not_found'); END IF;
  IF d.status<>'active' THEN RETURN public.flowlink_error('state_conflict'); END IF;
  v_label=d.label;
 ELSE RETURN public.flowlink_error('invalid_input'); END IF;
 PERFORM public.cleanup_flowlink_pairings();
 -- Expire this owner's rows explicitly as well as bounded general maintenance.
 UPDATE public.flowlink_pairing_capabilities SET status='expired'
  WHERE status='pending' AND expires_at<=clock_timestamp() AND (created_by=p_owner_id OR target_device_id=d.id);
 IF (SELECT count(*) FROM public.flowlink_pairing_capabilities WHERE created_by=p_owner_id AND created_at>clock_timestamp()-interval '1 hour')>=10
   OR (SELECT count(*) FROM public.flowlink_pairing_capabilities WHERE created_by=p_owner_id AND status='pending')>=5
 THEN RETURN public.flowlink_error('rate_limited'); END IF;
 IF EXISTS(SELECT 1 FROM public.flowlink_pairing_capabilities WHERE id=p_pairing_id OR (target_device_id=d.id AND status='pending'))
 THEN RETURN public.flowlink_error('state_conflict'); END IF;
 v_now=clock_timestamp();
 INSERT INTO public.flowlink_pairing_capabilities(id,secret_sha256,purpose,target_device_id,device_label,created_by,created_at,expires_at)
 VALUES(p_pairing_id,p_secret_sha256,p_command->>'purpose',d.id,v_label,p_owner_id,v_now,v_now+interval '10 minutes');
 RETURN jsonb_build_object('pairing_id',p_pairing_id,'expires_at',v_now+interval '10 minutes','purpose',p_command->>'purpose','device_id',d.id);
END $$;

CREATE OR REPLACE FUNCTION public.redeem_flowlink_pairing(p_pairing_id UUID,p_secret_sha256 BYTEA,p_redemption_id UUID,p_credential_sha256 BYTEA) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p public.flowlink_pairing_capabilities%ROWTYPE; d public.flowlink_devices%ROWTYPE;
 c public.flowlink_device_credentials%ROWTYPE; h BYTEA; v_revision BIGINT; v_now TIMESTAMPTZ;
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 IF NOT public.flowlink_uuid(p_pairing_id) OR NOT public.flowlink_uuid(p_redemption_id)
  OR coalesce(octet_length(p_secret_sha256),0)<>32 OR coalesce(octet_length(p_credential_sha256),0)<>32
 THEN RETURN public.flowlink_error('invalid_input'); END IF;
 SELECT * INTO p FROM public.flowlink_pairing_capabilities WHERE id=p_pairing_id;
 IF NOT FOUND THEN RETURN public.flowlink_error('pairing_invalid'); END IF;
 -- Global financial lock precedes device -> credential -> capability, also on replay.
 IF coalesce(p.target_device_id,p.result_device_id) IS NOT NULL THEN
  SELECT * INTO d FROM public.flowlink_devices WHERE id=coalesce(p.target_device_id,p.result_device_id) FOR UPDATE;
  PERFORM id FROM public.flowlink_device_credentials WHERE device_id=d.id ORDER BY id FOR UPDATE;
 END IF;
 SELECT * INTO p FROM public.flowlink_pairing_capabilities WHERE id=p_pairing_id FOR UPDATE;
 IF p.secret_sha256<>p_secret_sha256 THEN
  IF p.status='pending' THEN
   UPDATE public.flowlink_pairing_capabilities SET failed_attempts=failed_attempts+1,
    status=CASE WHEN failed_attempts=4 THEN 'locked' ELSE 'pending' END WHERE id=p.id;
  END IF;
  RETURN public.flowlink_error('pairing_invalid');
 END IF;
 h=sha256(convert_to(jsonb_build_object('pairing_id',p_pairing_id,'redemption_id',p_redemption_id,'credential_sha256',encode(p_credential_sha256,'hex'))::text,'UTF8'));
 IF p.status='consumed' THEN
  IF p.claim_hash<>h THEN RETURN public.flowlink_error('pairing_consumed'); END IF;
  IF p.consumed_at+interval '24 hours'<=clock_timestamp() THEN RETURN public.flowlink_error('pairing_unavailable'); END IF;
  SELECT * INTO c FROM public.flowlink_device_credentials WHERE id=p.result_credential_id;
  IF d.status<>'active' OR c.status<>'active' THEN RETURN public.flowlink_error('pairing_superseded'); END IF;
  RETURN jsonb_build_object('outcome','paired','device_id',d.id,'device_label',p.device_label,'credential_id',c.id,'credential_revision',c.revision::text,'replayed',true);
 END IF;
 IF p.status<>'pending' OR p.expires_at<=clock_timestamp() THEN RETURN public.flowlink_error('pairing_unavailable'); END IF;
 IF EXISTS(SELECT 1 FROM public.flowlink_device_credentials WHERE credential_sha256=p_credential_sha256)
 THEN RETURN public.flowlink_error('credential_reused'); END IF;
 IF EXISTS(SELECT 1 FROM public.flowlink_pairing_capabilities WHERE redemption_id=p_redemption_id)
 THEN RETURN public.flowlink_error('state_conflict'); END IF;
 IF p.purpose='enroll' THEN
  IF (SELECT count(*) FROM public.flowlink_devices WHERE status='active')>=100 THEN RETURN public.flowlink_error('rate_limited'); END IF;
  INSERT INTO public.flowlink_devices(label,created_by) VALUES(p.device_label,p.created_by) RETURNING * INTO d;
  v_revision=1;
 ELSE
  IF d.status<>'active' THEN RETURN public.flowlink_error('pairing_superseded'); END IF;
  SELECT coalesce(max(revision),0)+1 INTO v_revision FROM public.flowlink_device_credentials WHERE device_id=d.id;
  UPDATE public.flowlink_device_credentials SET status='revoked',revoked_at=clock_timestamp(),revocation_reason='rotated' WHERE device_id=d.id AND status='active';
 END IF;
 INSERT INTO public.flowlink_device_credentials(device_id,credential_sha256,revision)
 VALUES(d.id,p_credential_sha256,v_revision) RETURNING * INTO c;
 v_now=clock_timestamp();
 UPDATE public.flowlink_pairing_capabilities SET status='consumed',consumed_at=v_now,redemption_id=p_redemption_id,
  claim_hash=h,result_device_id=d.id,result_credential_id=c.id WHERE id=p.id;
 RETURN jsonb_build_object('outcome','paired','device_id',d.id,'device_label',p.device_label,'credential_id',c.id,'credential_revision',c.revision::text,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_flowlink_pairing(p_owner_id UUID,p_pairing_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p public.flowlink_pairing_capabilities%ROWTYPE;
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 IF p_owner_id IS NULL OR NOT public.flowlink_uuid(p_pairing_id) THEN RETURN public.flowlink_error('invalid_input'); END IF;
 SELECT * INTO p FROM public.flowlink_pairing_capabilities WHERE id=p_pairing_id FOR UPDATE;
 IF NOT FOUND THEN RETURN public.flowlink_error('not_found'); END IF;
 IF p.status='cancelled' THEN RETURN jsonb_build_object('pairing_id',p.id,'status','cancelled'); END IF;
 IF p.status<>'pending' THEN RETURN public.flowlink_error('state_conflict'); END IF;
 UPDATE public.flowlink_pairing_capabilities SET status='cancelled',cancelled_at=clock_timestamp() WHERE id=p.id;
 RETURN jsonb_build_object('pairing_id',p.id,'status','cancelled');
END $$;

CREATE OR REPLACE FUNCTION public.revoke_flowlink_device(p_owner_id UUID,p_device_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE d public.flowlink_devices%ROWTYPE;
BEGIN
 LOCK TABLE public.transactions IN EXCLUSIVE MODE;
 IF p_owner_id IS NULL OR NOT public.flowlink_uuid(p_device_id) THEN RETURN public.flowlink_error('invalid_input'); END IF;
 SELECT * INTO d FROM public.flowlink_devices WHERE id=p_device_id FOR UPDATE;
 IF NOT FOUND THEN RETURN public.flowlink_error('not_found'); END IF;
 IF d.status='revoked' THEN RETURN public.flowlink_owner_device(d.id); END IF;
 PERFORM id FROM public.flowlink_device_credentials WHERE device_id=d.id ORDER BY id FOR UPDATE;
 UPDATE public.flowlink_device_credentials SET status='revoked',revoked_at=clock_timestamp(),revocation_reason='device_revoked' WHERE device_id=d.id AND status='active';
 UPDATE public.flowlink_devices SET status='revoked',revoked_at=clock_timestamp(),revoked_by=p_owner_id,updated_at=clock_timestamp() WHERE id=d.id;
 UPDATE public.flowlink_pairing_capabilities SET status='cancelled',cancelled_at=clock_timestamp() WHERE target_device_id=d.id AND status='pending';
 RETURN public.flowlink_owner_device(d.id);
END $$;

CREATE OR REPLACE FUNCTION public.get_flowlink_device(p_credential_sha256 BYTEA) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce((SELECT jsonb_build_object('device',jsonb_build_object('id',d.id,'label',d.label,'status',d.status),
  'credential',jsonb_build_object('id',c.id,'revision',c.revision::text),'protocol_version',1)
 FROM public.flowlink_device_credentials c JOIN public.flowlink_devices d ON d.id=c.device_id
 WHERE c.credential_sha256=p_credential_sha256 AND c.status='active' AND d.status='active'),public.flowlink_error('unauthorized'))
$$;
CREATE OR REPLACE FUNCTION public.list_flowlink_devices(p_cursor JSONB DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_date TIMESTAMPTZ; v_id UUID; result JSONB; tail JSONB;
BEGIN
 IF p_cursor IS NOT NULL THEN
  IF jsonb_typeof(p_cursor)<>'object' OR p_cursor-ARRAY['created_at','id']<>'{}'
   OR coalesce(p_cursor->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR jsonb_typeof(p_cursor->'created_at') IS DISTINCT FROM 'string' THEN RETURN public.flowlink_error('invalid_input'); END IF;
  BEGIN v_date=(p_cursor->>'created_at')::timestamptz; v_id=(p_cursor->>'id')::uuid;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN public.flowlink_error('invalid_input'); END;
  IF NOT isfinite(v_date) THEN RETURN public.flowlink_error('invalid_input'); END IF;
 END IF;
 SELECT coalesce(jsonb_agg(public.flowlink_owner_device(x.id) ORDER BY x.created_at,x.id),'[]') INTO result
 FROM (SELECT id,created_at FROM public.flowlink_devices WHERE p_cursor IS NULL OR (created_at,id)>(v_date,v_id) ORDER BY created_at,id LIMIT 51) x;
 IF jsonb_array_length(result)>50 THEN
  result=result-50; tail=result->49;
  RETURN jsonb_build_object('devices',result,'next_cursor',jsonb_build_object('created_at',tail->'created_at','id',tail->'id'));
 END IF;
 RETURN jsonb_build_object('devices',result,'next_cursor',NULL);
END $$;

ALTER TABLE public.flowlink_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flowlink_device_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flowlink_pairing_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flowlink_devices,public.flowlink_device_credentials,public.flowlink_pairing_capabilities FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE f RECORD; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname LIKE 'flowlink_%' OR p.proname IN
 ('create_flowlink_pairing','redeem_flowlink_pairing','cancel_flowlink_pairing','revoke_flowlink_device','get_flowlink_device','list_flowlink_devices','cleanup_flowlink_pairings')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.proname NOT LIKE 'flowlink_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END IF;
 END LOOP;
END $$;
COMMIT;
