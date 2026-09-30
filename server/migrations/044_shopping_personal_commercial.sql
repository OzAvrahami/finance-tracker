-- 044: Separate personal planning items from exact commercial products (#92).
-- Existing catalog IDs, receipt JSON, confirmed history and financial records stay intact.
BEGIN;
CREATE TABLE public.shopping_commercial_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_name text NOT NULL CHECK(length(receipt_name) BETWEEN 1 AND 200),
 approved_name text CHECK(length(approved_name) BETWEEN 1 AND 200),
 brand text CHECK(length(brand)<=200),
 package_quantity numeric(12,3) CHECK(package_quantity>0),
 package_unit text CHECK(package_unit IN ('unit','package','pack','g','kg','ml','l')),
 provenance jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(provenance)='object' AND octet_length(provenance::text)<=4096),
 mapping_revision integer NOT NULL DEFAULT 0 CHECK(mapping_revision>=0),
 approved_by uuid, approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((package_quantity IS NULL)=(package_unit IS NULL))
);
CREATE TABLE public.shopping_product_mappings (
 commercial_product_id uuid NOT NULL REFERENCES public.shopping_commercial_products(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>0),
 personal_item_id bigint REFERENCES public.shopping_catalog_items(id) ON DELETE RESTRICT,
 personal_name text, planning_unit text CHECK(length(planning_unit)<=30),
 receipt_unit text CHECK(receipt_unit IN ('unit','package','pack','g','kg','ml','l')),
 factor numeric(15,6) CHECK(factor>0 AND factor<=100000),
 request_key uuid UNIQUE, request_payload jsonb,
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(commercial_product_id,revision),
 CHECK(personal_item_id IS NOT NULL OR (factor IS NULL AND planning_unit IS NULL))
);
CREATE INDEX shopping_mapping_personal ON public.shopping_product_mappings(personal_item_id);
ALTER TABLE public.shopping_product_identifiers ADD COLUMN commercial_product_id uuid REFERENCES public.shopping_commercial_products(id) ON DELETE RESTRICT;
-- 042's approval columns are retained as legacy evidence only. New authority lives
-- in commercial products and versioned mappings, not these historical fields.
ALTER TABLE public.shopping_product_identifiers ALTER COLUMN catalog_item_id DROP NOT NULL,
 ALTER COLUMN approved_name DROP NOT NULL, ALTER COLUMN lookup_source DROP NOT NULL,
 ALTER COLUMN approved_by DROP NOT NULL, ALTER COLUMN approved_at DROP NOT NULL,
 ALTER COLUMN approved_at DROP DEFAULT;
DO $$ DECLARE i public.shopping_product_identifiers; p uuid; c public.shopping_catalog_items;
BEGIN
 FOR i IN SELECT * FROM shopping_product_identifiers LOOP
  SELECT * INTO c FROM shopping_catalog_items WHERE id=i.catalog_item_id;
  INSERT INTO shopping_commercial_products(receipt_name,approved_name,approved_by,approved_at,mapping_revision,provenance)
   VALUES(i.approved_name,i.approved_name,i.approved_by,i.approved_at,1,jsonb_build_object('source','legacy_042')) RETURNING id INTO p;
  INSERT INTO shopping_product_mappings(commercial_product_id,revision,personal_item_id,personal_name,planning_unit,receipt_unit,factor,approved_by,approved_at)
   VALUES(p,1,c.id,c.name,c.default_unit,NULL,NULL,i.approved_by,i.approved_at);
  UPDATE shopping_product_identifiers SET commercial_product_id=p WHERE (kind,retailer_scope,code)=(i.kind,i.retailer_scope,i.code);
 END LOOP;
END $$;
ALTER TABLE public.shopping_product_identifiers ALTER COLUMN commercial_product_id SET NOT NULL;
CREATE INDEX shopping_identifier_commercial ON public.shopping_product_identifiers(commercial_product_id);

ALTER TABLE public.shopping_product_lookup_cache ADD COLUMN provider text NOT NULL DEFAULT 'open_food_facts' CHECK(provider IN ('open_food_facts','open_products_facts'));
ALTER TABLE public.shopping_product_lookup_cache DROP CONSTRAINT shopping_product_lookup_cache_pkey;
ALTER TABLE public.shopping_product_lookup_cache ADD PRIMARY KEY(provider,environment,code);
DROP FUNCTION public.shopping_claim_product_lookup(text,text);
CREATE FUNCTION public.shopping_claim_product_lookup(p_code text,p_environment text,p_provider text DEFAULT 'open_food_facts') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.shopping_product_lookup_cache;
BEGIN
 IF NOT shopping_gtin_valid(p_code) OR p_environment NOT IN ('staging','production') OR p_provider NOT IN ('open_food_facts','open_products_facts') THEN RAISE EXCEPTION 'shopping_input_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(420092);
 SELECT * INTO c FROM shopping_product_lookup_cache WHERE code=p_code AND environment=p_environment AND provider=p_provider;
 IF FOUND AND c.expires_at>now() THEN RETURN jsonb_build_object('claimed',false,'result',c.result); END IF;
 IF (SELECT count(*) FROM shopping_product_lookup_cache WHERE requested_at>now()-interval '1 minute')>=12 THEN RETURN jsonb_build_object('claimed',false,'result',jsonb_build_object('status','rate_limited')); END IF;
 INSERT INTO shopping_product_lookup_cache(code,environment,provider,result,expires_at) VALUES(p_code,p_environment,p_provider,'{"status":"pending"}',now()+interval '5 minutes')
 ON CONFLICT(provider,environment,code) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at,requested_at=now();
 RETURN jsonb_build_object('claimed',true);
END $$;

CREATE FUNCTION public.shopping_commercial_detail(p_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT to_jsonb(p)-'approved_by' || jsonb_build_object(
  'identifiers',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',i.kind,'code',i.code,'retailer_scope',i.retailer_scope)) FROM shopping_product_identifiers i WHERE i.commercial_product_id=p.id),'[]'),
  'mapping',(SELECT to_jsonb(m)-'approved_by' FROM shopping_product_mappings m WHERE m.commercial_product_id=p.id AND m.revision=p.mapping_revision))
 FROM shopping_commercial_products p WHERE p.id=p_id;
$$;
CREATE FUNCTION public.shopping_unit_factor(p_from text,p_to text) RETURNS numeric
 LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN p_from=p_to AND p_from IN ('unit','package','pack','g','kg','ml','l') THEN 1::numeric
  WHEN (p_from,p_to) IN (('kg','g'),('l','ml')) THEN 1000::numeric
  WHEN (p_from,p_to) IN (('g','kg'),('ml','l')) THEN 0.001::numeric ELSE NULL END;
$$;
CREATE FUNCTION public.shopping_commercial_command(p_data jsonb,p_owner uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.shopping_commercial_products; c public.shopping_catalog_items; m public.shopping_product_mappings;
 v_id uuid; v_personal bigint; v_factor numeric; a text=p_data->>'action'; k text=p_data->>'kind'; s text=COALESCE(p_data->>'retailer_scope',''); v_code text=p_data->>'code';
BEGIN
 IF p_owner IS NULL OR a NOT IN ('register','approve_name','map') THEN RAISE EXCEPTION 'shopping_input_invalid'; END IF;
 -- Same lock as receipt confirmation: mapping and financial snapshot commands serialize.
 PERFORM pg_advisory_xact_lock(390092);
 IF p_data->>'commercial_product_id' IS NOT NULL THEN v_id=(p_data->>'commercial_product_id')::uuid;
 ELSE
  IF v_code IS NULL OR k NOT IN ('gtin','retailer') OR (k='gtin' AND NOT shopping_gtin_valid(v_code)) OR (k='retailer' AND (s='' OR v_code!~'^[0-9]{3,20}$')) THEN RAISE EXCEPTION 'shopping_identifier_invalid'; END IF;
  SELECT commercial_product_id INTO v_id FROM shopping_product_identifiers WHERE (kind,retailer_scope,shopping_product_identifiers.code)=(k,s,v_code);
  IF v_id IS NULL THEN
   INSERT INTO shopping_commercial_products(receipt_name,brand,package_quantity,package_unit,provenance)
    VALUES(p_data->>'name',p_data->>'brand',(p_data->>'package_quantity')::numeric,p_data->>'package_unit',COALESCE(p_data->'provenance','{}')) RETURNING id INTO v_id;
   INSERT INTO shopping_product_identifiers(kind,retailer_scope,code,commercial_product_id) VALUES(k,s,v_code,v_id);
  END IF;
 END IF;
 SELECT * INTO p FROM shopping_commercial_products WHERE id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'shopping_product_invalid'; END IF;
 IF a='approve_name' THEN
  UPDATE shopping_commercial_products SET approved_name=p_data->>'name',approved_by=p_owner,approved_at=now(),
   brand=CASE WHEN p_data ? 'brand' THEN p_data->>'brand' ELSE brand END,
   package_quantity=CASE WHEN p_data ? 'package_quantity' THEN (p_data->>'package_quantity')::numeric ELSE package_quantity END,
   package_unit=CASE WHEN p_data ? 'package_unit' THEN p_data->>'package_unit' ELSE package_unit END,
   provenance=COALESCE(p_data->'provenance',provenance),updated_at=now() WHERE id=v_id;
 ELSIF a='map' THEN
  IF p_data->>'request_key' IS NOT NULL THEN
   SELECT * INTO m FROM shopping_product_mappings WHERE request_key=(p_data->>'request_key')::uuid;
   IF FOUND THEN
    IF m.commercial_product_id<>v_id OR m.request_payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'shopping_mapping_conflict'; END IF;
    RETURN shopping_commercial_detail(v_id);
   END IF;
  END IF;
  IF (p_data->>'expected_revision')::int IS DISTINCT FROM p.mapping_revision THEN RAISE EXCEPTION 'shopping_mapping_stale'; END IF;
  v_personal=(p_data->>'personal_item_id')::bigint;
  IF p_data->'new_personal' IS NOT NULL AND p_data->'new_personal'<>'null' THEN
   IF v_personal IS NOT NULL THEN RAISE EXCEPTION 'shopping_input_invalid'; END IF;
   IF NOT EXISTS(SELECT 1 FROM shopping_catalog_categories WHERE id=(p_data->'new_personal'->>'category_id')::bigint AND is_active) THEN RAISE EXCEPTION 'shopping_category_invalid'; END IF;
   INSERT INTO shopping_catalog_items(category_id,name,default_unit,is_active) VALUES((p_data->'new_personal'->>'category_id')::bigint,p_data->'new_personal'->>'name',p_data->'new_personal'->>'unit',true) RETURNING id INTO v_personal;
  END IF;
  IF v_personal IS NOT NULL THEN
   SELECT * INTO c FROM shopping_catalog_items WHERE id=v_personal AND is_active FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'shopping_product_invalid'; END IF;
   IF p_data->>'factor' IS NOT NULL THEN v_factor=(p_data->>'factor')::numeric;
   ELSE
    v_factor=shopping_unit_factor(p_data->>'receipt_unit',p_data->>'planning_unit_code');
    IF v_factor IS NULL AND p_data->>'receipt_unit' IN ('unit','package') AND p.package_quantity IS NOT NULL THEN
     v_factor=p.package_quantity*shopping_unit_factor(p.package_unit,p_data->>'planning_unit_code');
    END IF;
   END IF;
  END IF;
  SELECT * INTO m FROM shopping_product_mappings WHERE commercial_product_id=v_id AND revision=p.mapping_revision;
  IF (p_data->>'expected_revision')::int IS DISTINCT FROM p.mapping_revision THEN RAISE EXCEPTION 'shopping_mapping_stale'; END IF;
  INSERT INTO shopping_product_mappings(commercial_product_id,revision,personal_item_id,personal_name,planning_unit,receipt_unit,factor,approved_by,request_key,request_payload)
   VALUES(v_id,p.mapping_revision+1,v_personal,c.name,CASE WHEN v_personal IS NULL THEN NULL ELSE p_data->>'planning_unit' END,p_data->>'receipt_unit',v_factor,p_owner,(p_data->>'request_key')::uuid,p_data);
  UPDATE shopping_commercial_products SET mapping_revision=mapping_revision+1,updated_at=now() WHERE id=v_id;
 END IF;
 RETURN shopping_commercial_detail(v_id);
END $$;
-- Keep the old private signature as name approval only. It must never rename/create a personal item.
CREATE OR REPLACE FUNCTION public.shopping_approve_product_identifier(p_data jsonb,p_owner uuid) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT shopping_commercial_command(p_data||'{"action":"approve_name"}',p_owner);
$$;
ALTER TABLE public.shopping_commercial_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_product_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shopping_commercial_products,public.shopping_product_mappings FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.shopping_commercial_products TO service_role;
GRANT SELECT,INSERT ON public.shopping_product_mappings TO service_role;
REVOKE ALL ON FUNCTION public.shopping_claim_product_lookup(text,text,text),public.shopping_commercial_detail(uuid),public.shopping_unit_factor(text,text),public.shopping_commercial_command(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_claim_product_lookup(text,text,text),public.shopping_commercial_detail(uuid),public.shopping_unit_factor(text,text),public.shopping_commercial_command(jsonb,uuid) TO service_role;
COMMIT;
