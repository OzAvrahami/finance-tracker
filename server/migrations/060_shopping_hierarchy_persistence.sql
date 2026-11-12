-- Issue #102 Gate 3B.2. Forward-only ISOLATED rehearsal candidate.
-- CLI authoring ID 20261110200708; numbered after verified remote/hosted 059.
-- NOT production-ready: live callers are deliberately not switched in this gate.
-- Caller must fence all writers and bind the private mapping in the same transaction.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_setting('shopping.isolated_migration',true) IS DISTINCT FROM
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
 OR current_setting('shopping.isolated_migration',true) NOT LIKE 'shopping102-%'
 THEN RAISE EXCEPTION 'shopping_isolated_migration_required'; END IF;
END $$;

CREATE SCHEMA shopping_private;
REVOKE ALL ON SCHEMA shopping_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA shopping_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE shopping_private.catalog_state(singleton boolean PRIMARY KEY CHECK(singleton), revision bigint NOT NULL CHECK(revision>0));
INSERT INTO shopping_private.catalog_state VALUES(true,1);
CREATE TABLE shopping_private.commands(
 actor uuid NOT NULL, request_key uuid NOT NULL, intent jsonb NOT NULL,
 result jsonb NOT NULL, catalog_revision bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor,request_key));
ALTER TABLE shopping_private.catalog_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_private.commands ENABLE ROW LEVEL SECURITY;

-- Remove exact deployed signatures; absence/dependency errors must abort.
DROP TRIGGER shopping_category_name_guard ON public.shopping_catalog_categories;
DROP FUNCTION public.shopping_receipt_command(bigint,text,jsonb);
DROP FUNCTION public.shopping_move_receipt(bigint,bigint,text);
DROP FUNCTION public.shopping_checkout(bigint,bigint,bigint,jsonb);
DROP FUNCTION public.shopping_approve_product_identifier(jsonb,uuid);
DROP FUNCTION public.shopping_add_planned_item(bigint,jsonb);
DROP FUNCTION public.shopping_accept_suggestion(bigint,bigint,numeric,text);
DROP FUNCTION public.shopping_delete_draft(bigint);
DROP FUNCTION public.shopping_claim_product_lookup(text,text,text);
DROP FUNCTION public.shopping_commercial_command(jsonb,uuid);
DROP FUNCTION public.shopping_receipt_context(bigint);
DROP FUNCTION public.shopping_resolve_entry_category(bigint,text);
DROP FUNCTION public.shopping_category_write_guard();
DROP FUNCTION public.shopping_snapshot(bigint);
DROP FUNCTION public.shopping_commercial_detail(uuid);
DROP FUNCTION public.shopping_unit_factor(text,text);

-- Actual global-name constraint differs between reference and deployed schema.
DO $$ DECLARE n text; c integer; BEGIN
 SELECT count(*),min(conname) INTO c,n FROM pg_constraint WHERE conrelid='public.shopping_catalog_categories'::regclass
 AND contype='u' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.shopping_catalog_categories'::regclass AND attname='name')]::smallint[];
 IF c<>1 THEN RAISE EXCEPTION 'shopping_category_constraint_drift'; END IF;
 EXECUTE format('ALTER TABLE public.shopping_catalog_categories DROP CONSTRAINT %I',n);
END $$;
ALTER TABLE public.shopping_catalog_categories
 ADD COLUMN parent_id bigint REFERENCES public.shopping_catalog_categories(id) ON DELETE RESTRICT,
 ADD COLUMN display_order integer NOT NULL DEFAULT 0,
 ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 ADD CONSTRAINT shopping_parent_integrity CHECK(parent_id IS DISTINCT FROM id AND parent_id IS DISTINCT FROM -1::bigint),
 ADD CONSTRAINT shopping_neutral_integrity CHECK(is_neutral=(id=-1) AND (id<>-1 OR (parent_id IS NULL AND is_active)));
ALTER TABLE public.shopping_catalog_items ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE public.shopping_list_types ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE INDEX shopping_category_parent ON public.shopping_catalog_categories(parent_id);

-- Empty fresh installation only. Existing installations MUST already have -1.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.shopping_catalog_categories) THEN
  INSERT INTO public.shopping_catalog_categories(id,name,is_neutral) VALUES(-1,'ללא קטגוריה',true);
 ELSIF NOT EXISTS(SELECT 1 FROM public.shopping_catalog_categories WHERE id=-1 AND is_active) THEN
  RAISE EXCEPTION 'shopping_neutral_baseline_missing';
 END IF;
END $$;

-- Optional explicitly supplied temporary mapping, never private data in migration text.
-- Synthetic rehearsal uses this same input shape; production payload runner is deferred.
DO $$ DECLARE before_rows text; BEGIN
 IF to_regclass('pg_temp.shopping_mapping_categories') IS NULL AND
  ((SELECT count(*) FROM public.shopping_catalog_categories)>1 OR EXISTS(SELECT 1 FROM public.shopping_catalog_items)
   OR EXISTS(SELECT 1 FROM public.shopping_lists)) THEN RAISE EXCEPTION 'shopping_complete_mapping_required'; END IF;
 IF to_regclass('pg_temp.shopping_mapping_categories') IS NOT NULL THEN
  IF (SELECT count(*) FROM public.shopping_catalog_categories)<>27
   OR (SELECT count(*) FROM public.shopping_catalog_items)<>173
   OR (SELECT count(*) FROM public.shopping_list_items)<>85
   OR (SELECT count(*) FROM public.shopping_list_types)<>6
   OR (SELECT count(*) FROM pg_temp.shopping_mapping_categories)<>99
   OR (SELECT count(*) FROM pg_temp.shopping_mapping_products)<>173
   OR (SELECT count(*) FROM pg_temp.shopping_mapping_links)<>21
   OR EXISTS(SELECT id FROM public.shopping_catalog_categories EXCEPT SELECT id FROM pg_temp.shopping_mapping_categories)
   OR EXISTS(SELECT id FROM public.shopping_catalog_items EXCEPT SELECT id FROM pg_temp.shopping_mapping_products)
   OR EXISTS(SELECT id FROM pg_temp.shopping_mapping_products EXCEPT SELECT id FROM public.shopping_catalog_items)
  THEN RAISE EXCEPTION 'shopping_mapping_coverage_invalid'; END IF;
  SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY id)) INTO before_rows FROM public.shopping_list_items r;
  INSERT INTO public.shopping_catalog_categories(id,name,is_active)
   SELECT id,name,is_active FROM pg_temp.shopping_mapping_categories WHERE id NOT IN(SELECT id FROM public.shopping_catalog_categories);
  UPDATE public.shopping_catalog_categories c SET parent_id=m.parent_id,is_active=m.is_active
   FROM pg_temp.shopping_mapping_categories m WHERE c.id=m.id;
  UPDATE public.shopping_catalog_items p SET category_id=m.category_id FROM pg_temp.shopping_mapping_products m WHERE p.id=m.id;
  DELETE FROM public.shopping_catalog_category_list_types;
  INSERT INTO public.shopping_catalog_category_list_types(category_id,list_type_id) SELECT category_id,list_type_id FROM pg_temp.shopping_mapping_links;
  IF (SELECT count(*) FROM public.shopping_catalog_categories WHERE is_active)<>74
   OR (SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY id)) FROM public.shopping_list_items r) IS DISTINCT FROM before_rows
  THEN RAISE EXCEPTION 'shopping_mapping_preservation_invalid'; END IF;
  PERFORM setval(pg_get_serial_sequence('public.shopping_catalog_categories','id'),(SELECT greatest(1,max(id)) FROM public.shopping_catalog_categories));
 END IF;
END $$;

CREATE UNIQUE INDEX shopping_category_sibling_key ON public.shopping_catalog_categories
 (parent_id,public.shopping_category_key(name)) NULLS NOT DISTINCT WHERE id<>-1;

CREATE FUNCTION shopping_private.category_integrity() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'shopping_category_delete_forbidden' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR (OLD.id=-1 AND
  (NEW.name IS DISTINCT FROM OLD.name OR NEW.parent_id IS NOT NULL OR NOT NEW.is_active)))
 THEN RAISE EXCEPTION 'shopping_neutral_or_identity_protected' USING ERRCODE='23514'; END IF;
 IF public.shopping_category_key(NEW.name)='' THEN RAISE EXCEPTION 'shopping_name_invalid' USING ERRCODE='23514'; END IF;
 IF NEW.parent_id IS NOT NULL AND EXISTS(
  WITH RECURSIVE chain(id,parent_id) AS (
   SELECT c.id,c.parent_id FROM public.shopping_catalog_categories c WHERE c.id=NEW.parent_id
   UNION SELECT c.id,c.parent_id FROM public.shopping_catalog_categories c JOIN chain a ON c.id=a.parent_id)
  SELECT 1 FROM chain WHERE id=NEW.id)
 THEN RAISE EXCEPTION 'shopping_category_cycle' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shopping_category_integrity BEFORE INSERT OR UPDATE OR DELETE ON public.shopping_catalog_categories
 FOR EACH ROW EXECUTE FUNCTION shopping_private.category_integrity();
-- Validate mapped ancestry too (the trigger was not present during mapping).
DO $$ BEGIN
 IF EXISTS(WITH RECURSIVE walk(origin,id,parent_id,seen,cycle) AS (
  SELECT id,id,parent_id,ARRAY[id],false FROM public.shopping_catalog_categories
  UNION ALL SELECT w.origin,c.id,c.parent_id,w.seen||c.id,c.id=ANY(w.seen)
  FROM walk w JOIN public.shopping_catalog_categories c ON c.id=w.parent_id WHERE NOT w.cycle)
  SELECT 1 FROM walk WHERE cycle)
 THEN RAISE EXCEPTION 'shopping_mapping_cycle'; END IF;
END $$;

CREATE FUNCTION shopping_private.keys(p jsonb, allowed text[], required text[] DEFAULT ARRAY[]::text[]) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT k=ANY(allowed))
 OR NOT p ?& required THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
END $$;

-- Raw, complete facts only. No recursive selection, visibility or product policy.
CREATE FUNCTION shopping_private.catalog_facts() RETURNS jsonb LANGUAGE sql STABLE
 SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('catalog_revision',(SELECT revision::text FROM shopping_private.catalog_state WHERE singleton),
 'categories',coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('id',id::text,'parent_id',parent_id::text,'revision',revision::text) ORDER BY id) FROM public.shopping_catalog_categories c),'[]'),
 'products',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('id',id::text,'category_id',category_id::text,'revision',revision::text,'default_price',default_price::text) ORDER BY id) FROM public.shopping_catalog_items p),'[]'),
 'listTypes',coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('id',id::text,'revision',revision::text) ORDER BY id) FROM public.shopping_list_types t),'[]'),
 'links',coalesce((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('category_id',category_id::text,'list_type_id',list_type_id::text) ORDER BY list_type_id,category_id) FROM public.shopping_catalog_category_list_types l),'[]'));
$$;
CREATE FUNCTION shopping_private.scope(p_actor uuid,p_operation text,p_id text,p_ids jsonb) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('actor',p_actor,'operation',p_operation,'id',p_id,'product_ids',coalesce(p_ids,'[]'));
$$;
CREATE FUNCTION shopping_private.token(p_facts jsonb,p_scope jsonb) RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path=pg_catalog AS $$ SELECT encode(sha256(convert_to(jsonb_build_array(p_facts,p_scope)::text,'UTF8')),'hex'); $$;

CREATE FUNCTION public.shopping_state(p_scope text,p_ids jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f jsonb; s jsonb; c shopping_private.commands; tok text; actor_id uuid; op text;
BEGIN
 IF p_scope IS DISTINCT FROM 'catalog' THEN RAISE EXCEPTION 'shopping_invalid_scope' USING ERRCODE='23514'; END IF;
 PERFORM shopping_private.keys(p_ids,ARRAY['actor','request_key','operation','id','product_ids'],ARRAY['actor','operation','product_ids']);
 actor_id=(p_ids->>'actor')::uuid; op=p_ids->>'operation';
 IF actor_id IS NULL OR coalesce(op,'') NOT IN ('catalog.read','category.create','category.change','product.create','product.edit','product.deactivate','product.bulk-category','branches.replace')
 OR jsonb_typeof(p_ids->'product_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'shopping_invalid_scope' USING ERRCODE='23514'; END IF;
 f=shopping_private.catalog_facts(); s=shopping_private.scope(actor_id,op,p_ids->>'id',p_ids->'product_ids'); tok=shopping_private.token(f,s);
 SELECT * INTO c FROM shopping_private.commands WHERE actor=actor_id AND request_key=(p_ids->>'request_key')::uuid;
 RETURN (f-'catalog_revision')||jsonb_build_object('version',1,'scope','catalog','operation',op,'complete',true,
  'expected',jsonb_build_object('catalog_revision',f->>'catalog_revision','token',tok),'etag','"'||tok||'"',
  'counts',jsonb_build_object('categories',jsonb_array_length(f->'categories'),'products',jsonb_array_length(f->'products'),
   'listTypes',jsonb_array_length(f->'listTypes'),'links',jsonb_array_length(f->'links')),
  'command',CASE WHEN c.actor IS NOT NULL THEN jsonb_build_object('actor',c.actor,'key',c.request_key,'intent',c.intent,'result',c.result,'catalog_revision',c.catalog_revision::text) END);
END $$;

CREATE FUNCTION public.shopping_catalog_commit(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,public,pg_temp SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE prior shopping_private.commands; rev bigint; f jsonb; s jsonb; op text; kind text; target bigint;
 v jsonb; u jsonb; ids jsonb='[]'; result jsonb; n integer; requested jsonb;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'shopping_actor_required' USING ERRCODE='42501'; END IF;
 PERFORM shopping_private.keys(p_intent,ARRAY['operation','id','body'],ARRAY['operation','id','body']);
 op=p_intent->>'operation'; kind=p_decision->>'kind'; target=(p_intent->>'id')::bigint;
 IF op IS NULL OR op NOT IN ('category.create','category.change','product.create','product.edit','product.deactivate','product.bulk-category','branches.replace')
 THEN RAISE EXCEPTION 'shopping_invalid_operation' USING ERRCODE='23514'; END IF;
 IF op LIKE 'product.%' AND p_key IS NULL THEN RAISE EXCEPTION 'shopping_key_required' USING ERRCODE='23514'; END IF;
 -- Exact Gate 1 K -> C-X. No lock upgrade and no table-wide runtime locks.
 IF p_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_key::text,102060)); END IF;
 SELECT revision INTO STRICT rev FROM shopping_private.catalog_state WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM shopping_private.commands WHERE actor=p_actor AND request_key=p_key;
 IF FOUND THEN
  IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'shopping_key_conflict'; END IF;
  RETURN jsonb_build_object('committed',true,'replayed',true,'result',prior.result,'catalog_revision',prior.catalog_revision::text);
 END IF;
 IF op='product.bulk-category' THEN
  PERFORM shopping_private.keys(p_intent->'body',ARRAY['product_ids','category_id'],ARRAY['product_ids','category_id']);
  SELECT jsonb_agg((value#>>'{}')::bigint::text ORDER BY (value#>>'{}')::bigint) INTO ids FROM jsonb_array_elements(p_intent#>'{body,product_ids}');
 END IF;
 f=shopping_private.catalog_facts(); s=shopping_private.scope(p_actor,op,p_intent->>'id',ids);
 PERFORM shopping_private.keys(p_expected,ARRAY['catalog_revision','token'],ARRAY['catalog_revision','token']);
 IF p_expected->>'catalog_revision' IS DISTINCT FROM rev::text OR p_expected->>'token' IS DISTINCT FROM shopping_private.token(f,s)
 THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;

 IF op='category.create' THEN
  PERFORM shopping_private.keys(p_decision,ARRAY['kind','values'],ARRAY['kind','values']);
  v=p_decision->'values';
  PERFORM shopping_private.keys(v,ARRAY['name','parent_id','is_active','is_neutral','display_order'],ARRAY['name','parent_id','is_active','is_neutral','display_order']);
  PERFORM shopping_private.keys(p_intent->'body',ARRAY['name','parent_id','is_active','display_order'],ARRAY['name','parent_id']);
  IF kind IS DISTINCT FROM 'category.create' OR target IS NOT NULL OR v->>'name' IS DISTINCT FROM public.shopping_category_display(p_intent#>>'{body,name}')
   OR (v->>'parent_id')::bigint IS DISTINCT FROM (p_intent#>>'{body,parent_id}')::bigint OR v->'is_neutral' IS DISTINCT FROM 'false'::jsonb
   OR v->'is_active' IS DISTINCT FROM coalesce(p_intent#>'{body,is_active}','true')
   OR v->'display_order' IS DISTINCT FROM coalesce(p_intent#>'{body,display_order}','0')
  THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  INSERT INTO public.shopping_catalog_categories(name,parent_id,is_active,display_order)
   VALUES(v->>'name',(v->>'parent_id')::bigint,(v->>'is_active')::boolean,(v->>'display_order')::integer) RETURNING id INTO target;
  result=jsonb_build_object('id',target::text);
 ELSIF op='category.change' THEN
  PERFORM shopping_private.keys(p_decision,ARRAY['kind','id','revision','changes'],ARRAY['kind','id','revision','changes']);
  v=p_decision->'changes';
  IF kind IS DISTINCT FROM 'category.update' OR (p_decision->>'id')::bigint IS DISTINCT FROM target THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.shopping_catalog_categories WHERE id=target AND revision=(p_decision->>'revision')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
  CASE p_intent#>>'{body,type}'
   WHEN 'rename' THEN
    PERFORM shopping_private.keys(p_intent->'body',ARRAY['type','name'],ARRAY['type','name']);
    PERFORM shopping_private.keys(v,ARRAY['name'],ARRAY['name']);
    IF v->>'name' IS DISTINCT FROM public.shopping_category_display(p_intent#>>'{body,name}') THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
    UPDATE public.shopping_catalog_categories SET name=v->>'name',revision=revision+1 WHERE id=target;
   WHEN 'reparent' THEN
    PERFORM shopping_private.keys(p_intent->'body',ARRAY['type','parent_id'],ARRAY['type','parent_id']);
    PERFORM shopping_private.keys(v,ARRAY['parent_id'],ARRAY['parent_id']);
    IF (v->>'parent_id')::bigint IS DISTINCT FROM (p_intent#>>'{body,parent_id}')::bigint THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
    UPDATE public.shopping_catalog_categories SET parent_id=(v->>'parent_id')::bigint,revision=revision+1 WHERE id=target;
   ELSE
    PERFORM shopping_private.keys(p_intent->'body',ARRAY['type'],ARRAY['type']);
    PERFORM shopping_private.keys(v,ARRAY['is_active'],ARRAY['is_active']);
    IF coalesce(p_intent#>>'{body,type}','') NOT IN ('activate','deactivate','delete') OR v->'is_active' IS DISTINCT FROM to_jsonb(p_intent#>>'{body,type}'='activate') THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
    UPDATE public.shopping_catalog_categories SET is_active=(v->>'is_active')::boolean,revision=revision+1 WHERE id=target;
  END CASE;
  result=jsonb_build_object('id',target::text);
 ELSIF op IN ('product.create','product.edit','product.deactivate') THEN
  IF op='product.create' THEN
   PERFORM shopping_private.keys(p_decision,ARRAY['kind','values'],ARRAY['kind','values']); v=p_decision->'values';
   IF kind IS DISTINCT FROM 'product.create' OR target IS NOT NULL THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
   PERFORM shopping_private.keys(v,ARRAY['name','category_id','default_unit','default_price','is_active'],ARRAY['name','category_id','default_unit','default_price','is_active']);
  ELSE
   PERFORM shopping_private.keys(p_decision,ARRAY['kind','id','revision','changes'],ARRAY['kind','id','revision','changes']); v=p_decision->'changes';
   IF kind IS DISTINCT FROM 'product.update' OR (p_decision->>'id')::bigint IS DISTINCT FROM target THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
   PERFORM shopping_private.keys(v,ARRAY['name','category_id','default_unit','default_price','is_active']);
   PERFORM 1 FROM public.shopping_catalog_items WHERE id=target AND revision=(p_decision->>'revision')::bigint FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
  END IF;
  requested=p_intent->'body';
  IF op='product.deactivate' THEN
   IF requested IS DISTINCT FROM '{}'::jsonb OR v IS DISTINCT FROM '{"is_active":false}'::jsonb THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  ELSE
   PERFORM shopping_private.keys(requested,ARRAY['name','category_id','default_unit','default_price','is_active']);
   IF op='product.create' THEN requested=jsonb_build_object('default_unit',null,'default_price',null,'is_active',true)||requested; END IF;
   IF (requested-ARRAY['category_id','default_price']) IS DISTINCT FROM (v-ARRAY['category_id','default_price'])
    OR (requested->>'category_id')::bigint IS DISTINCT FROM (v->>'category_id')::bigint
    OR (requested->>'default_price')::numeric IS DISTINCT FROM (v->>'default_price')::numeric
    OR (requested ? 'category_id') IS DISTINCT FROM (v ? 'category_id') OR (requested ? 'default_price') IS DISTINCT FROM (v ? 'default_price')
   THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  END IF;
  IF op='product.create' THEN
   INSERT INTO public.shopping_catalog_items(name,category_id,default_unit,default_price,is_active)
    VALUES(v->>'name',(v->>'category_id')::bigint,v->>'default_unit',(v->>'default_price')::numeric,(v->>'is_active')::boolean) RETURNING id INTO target;
  ELSE
   UPDATE public.shopping_catalog_items SET name=CASE WHEN v?'name' THEN v->>'name' ELSE name END,
    category_id=CASE WHEN v?'category_id' THEN (v->>'category_id')::bigint ELSE category_id END,
    default_unit=CASE WHEN v?'default_unit' THEN v->>'default_unit' ELSE default_unit END,
    default_price=CASE WHEN v?'default_price' THEN (v->>'default_price')::numeric ELSE default_price END,
    is_active=CASE WHEN v?'is_active' THEN (v->>'is_active')::boolean ELSE is_active END,revision=revision+1 WHERE id=target;
  END IF;
  result=jsonb_build_object('id',target::text);
 ELSIF op='product.bulk-category' THEN
  PERFORM shopping_private.keys(p_decision,ARRAY['kind','updates'],ARRAY['kind','updates']);
  n=jsonb_array_length(p_decision->'updates');
  IF kind IS DISTINCT FROM op OR n NOT BETWEEN 1 AND 100 OR n<>jsonb_array_length(ids)
   OR n<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(ids))
   OR (SELECT jsonb_agg(x->>'id' ORDER BY (x->>'id')::bigint) FROM jsonb_array_elements(p_decision->'updates') x) IS DISTINCT FROM ids
  THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.shopping_catalog_items WHERE id IN (SELECT (value#>>'{}')::bigint FROM jsonb_array_elements(ids)) ORDER BY id FOR UPDATE;
  FOR u IN SELECT value FROM jsonb_array_elements(p_decision->'updates') ORDER BY (value->>'id')::bigint LOOP
   PERFORM shopping_private.keys(u,ARRAY['id','revision','changes'],ARRAY['id','revision','changes']);
   PERFORM shopping_private.keys(u->'changes',ARRAY['category_id'],ARRAY['category_id']);
   IF (u#>>'{changes,category_id}')::bigint IS DISTINCT FROM (p_intent#>>'{body,category_id}')::bigint THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
   UPDATE public.shopping_catalog_items SET category_id=(u#>>'{changes,category_id}')::bigint,revision=revision+1
    WHERE id=(u->>'id')::bigint AND revision=(u->>'revision')::bigint;
   IF NOT FOUND THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
  END LOOP;
  result=jsonb_build_object('updated',n,'product_ids',ids);
 ELSIF op='branches.replace' THEN
  PERFORM shopping_private.keys(p_decision,ARRAY['kind','id','revision','category_ids'],ARRAY['kind','id','revision','category_ids']);
  PERFORM shopping_private.keys(p_intent->'body',ARRAY['categoryIds'],ARRAY['categoryIds']);
  IF kind IS DISTINCT FROM op OR (p_decision->>'id')::bigint IS DISTINCT FROM target
   OR NOT p_decision->'category_ids' @> '["-1"]'::jsonb
   OR (SELECT array_agg(DISTINCT value::bigint ORDER BY value::bigint) FROM jsonb_array_elements_text(p_decision->'category_ids') WHERE value<>'-1')
    IS DISTINCT FROM (SELECT array_agg(DISTINCT value::bigint ORDER BY value::bigint) FROM jsonb_array_elements_text(p_intent#>'{body,categoryIds}'))
  THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.shopping_list_types WHERE id=target AND revision=(p_decision->>'revision')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
  DELETE FROM public.shopping_catalog_category_list_types WHERE list_type_id=target;
  INSERT INTO public.shopping_catalog_category_list_types(category_id,list_type_id) SELECT value::bigint,target FROM jsonb_array_elements_text(p_decision->'category_ids');
  UPDATE public.shopping_list_types SET revision=revision+1 WHERE id=target;
  result=jsonb_build_object('id',target::text);
 END IF;
 UPDATE shopping_private.catalog_state SET revision=revision+1 WHERE singleton RETURNING revision INTO rev;
 IF p_key IS NOT NULL THEN INSERT INTO shopping_private.commands(actor,request_key,intent,result,catalog_revision) VALUES(p_actor,p_key,p_intent,result,rev); END IF;
 RETURN jsonb_build_object('committed',true,'replayed',false,'result',result,'catalog_revision',rev::text);
END $$;

-- Preserve original read predicates; remove all direct write entry points.
DO $$ DECLARE p record; t record; s record; BEGIN
 FOR p IN SELECT * FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'shopping_%' AND cmd<>'SELECT' LOOP
  EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename);
  IF p.cmd='ALL' THEN EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO %s USING (%s)',p.policyname,p.tablename,array_to_string(p.roles,','),coalesce(p.qual,'true')); END IF;
 END LOOP;
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'shopping_%' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.%I FROM PUBLIC,anon,authenticated,service_role',t.tablename);
 END LOOP;
 FOR s IN SELECT c.oid::regclass AS name FROM pg_class c JOIN pg_depend d ON d.objid=c.oid
  JOIN pg_class owned_table ON owned_table.oid=d.refobjid WHERE c.relkind='S' AND owned_table.relnamespace='public'::regnamespace AND owned_table.relname LIKE 'shopping_%' AND d.deptype IN ('a','i') LOOP
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC,anon,authenticated,service_role',s.name);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA shopping_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA shopping_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.shopping_state(text,jsonb),public.shopping_catalog_commit(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_state(text,jsonb),public.shopping_catalog_commit(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.shopping_save_receipt_draft(bigint,integer,integer,jsonb),public.shopping_require_duplicate_review(bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
