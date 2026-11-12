-- Issue #102 Gate 3B.2a; CLI authoring ID 20261111175902.
-- Forward-only after preserved 060; hosted ledger/remote latest 059 verified read-only.
-- ISOLATED ONLY. No route activation, permission cutover or private mapping payload.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_setting('shopping.isolated_migration',true) IS DISTINCT FROM
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
 OR current_setting('shopping.isolated_migration',true) NOT LIKE 'shopping102-%'
 THEN RAISE EXCEPTION 'shopping_isolated_migration_required'; END IF;
END $$;


ALTER TABLE shopping_private.commands ADD COLUMN http jsonb CHECK(http IS NULL OR jsonb_typeof(http)='object');
-- Pure canonical-byte check matching JavaScript trim; not icon selection policy.
CREATE FUNCTION shopping_private.category_icon(value text) RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path=pg_catalog AS $$ SELECT nullif(btrim(value,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)),''); $$;
REVOKE ALL ON FUNCTION shopping_private.category_icon(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.shopping_state(p_scope text,p_ids jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f jsonb; s jsonb; c shopping_private.commands; tok text; actor_id uuid; op text;
BEGIN
 IF p_scope IS DISTINCT FROM 'catalog' THEN RAISE EXCEPTION 'shopping_invalid_scope' USING ERRCODE='23514'; END IF;
 PERFORM shopping_private.keys(p_ids,ARRAY['actor','request_key','operation','id','product_ids'],ARRAY['actor','operation','product_ids']);
 actor_id=(p_ids->>'actor')::uuid; op=p_ids->>'operation';
 IF actor_id IS NULL OR coalesce(op,'') NOT IN ('catalog.read','category.create','category.change','category.edit','product.create','product.edit','product.deactivate','product.bulk-category','branches.replace')
 OR jsonb_typeof(p_ids->'product_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'shopping_invalid_scope' USING ERRCODE='23514'; END IF;
 f=shopping_private.catalog_facts(); s=shopping_private.scope(actor_id,op,p_ids->>'id',p_ids->'product_ids'); tok=shopping_private.token(f,s);
 SELECT * INTO c FROM shopping_private.commands WHERE actor=actor_id AND request_key=(p_ids->>'request_key')::uuid;
 RETURN (f-'catalog_revision')||jsonb_build_object('version',1,'scope','catalog','operation',op,'complete',true,
  'expected',jsonb_build_object('catalog_revision',f->>'catalog_revision','token',tok),'etag','"'||tok||'"',
  'counts',jsonb_build_object('categories',jsonb_array_length(f->'categories'),'products',jsonb_array_length(f->'products'),
   'listTypes',jsonb_array_length(f->'listTypes'),'links',jsonb_array_length(f->'links')),
  'command',CASE WHEN c.actor IS NOT NULL THEN jsonb_build_object('actor',c.actor,'key',c.request_key,'intent',c.intent,'result',c.result,'catalog_revision',c.catalog_revision::text,'http',c.http) END);
END $$;

CREATE OR REPLACE FUNCTION public.shopping_catalog_commit(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,public,pg_temp SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE prior shopping_private.commands; rev bigint; f jsonb; s jsonb; op text; kind text; target bigint;
 v jsonb; u jsonb; ids jsonb='[]'; result jsonb; n integer; requested jsonb; response_http jsonb; response_token text; projection jsonb;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'shopping_actor_required' USING ERRCODE='42501'; END IF;
 PERFORM shopping_private.keys(p_intent,ARRAY['operation','id','body'],ARRAY['operation','id','body']);
 op=p_intent->>'operation'; kind=p_decision->>'kind'; target=(p_intent->>'id')::bigint;
 IF op IS NULL OR op NOT IN ('category.create','category.change','category.edit','product.create','product.edit','product.deactivate','product.bulk-category','branches.replace')
 THEN RAISE EXCEPTION 'shopping_invalid_operation' USING ERRCODE='23514'; END IF;
 IF op LIKE 'product.%' AND p_key IS NULL THEN RAISE EXCEPTION 'shopping_key_required' USING ERRCODE='23514'; END IF;
 -- Exact Gate 1 K -> C-X. No lock upgrade and no table-wide runtime locks.
 IF p_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_key::text,102060)); END IF;
 SELECT revision INTO STRICT rev FROM shopping_private.catalog_state WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM shopping_private.commands WHERE actor=p_actor AND request_key=p_key;
 IF FOUND THEN
  IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'shopping_key_conflict'; END IF;
  RETURN jsonb_build_object('committed',true,'replayed',true,'result',prior.result,'catalog_revision',prior.catalog_revision::text,'http',prior.http);
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
  PERFORM shopping_private.keys(p_decision,ARRAY['kind','values','response'],ARRAY['kind','values','response']);
  v=p_decision->'values';
  PERFORM shopping_private.keys(v,ARRAY['name','icon','parent_id','is_active','is_neutral','display_order'],ARRAY['name','parent_id','is_active','is_neutral','display_order']);
  PERFORM shopping_private.keys(p_intent->'body',ARRAY['name','icon','parent_id','is_active','display_order'],ARRAY['name','parent_id']);
  IF kind IS DISTINCT FROM 'category.create' OR target IS NOT NULL OR v->>'name' IS DISTINCT FROM public.shopping_category_display(p_intent#>>'{body,name}')
   OR (v->>'parent_id')::bigint IS DISTINCT FROM (p_intent#>>'{body,parent_id}')::bigint OR v->'is_neutral' IS DISTINCT FROM 'false'::jsonb
   OR v->'is_active' IS DISTINCT FROM coalesce(p_intent#>'{body,is_active}','true')
   OR v->'display_order' IS DISTINCT FROM coalesce(p_intent#>'{body,display_order}','0')
   OR v->>'icon' IS DISTINCT FROM shopping_private.category_icon(p_intent#>>'{body,icon}')
  THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  INSERT INTO public.shopping_catalog_categories(name,icon,parent_id,is_active,display_order)
   VALUES(v->>'name',v->>'icon',(v->>'parent_id')::bigint,(v->>'is_active')::boolean,(v->>'display_order')::integer) RETURNING id INTO target;
  result=jsonb_build_object('id',target::text);
 ELSIF op='category.edit' THEN
  IF target=-1 THEN RAISE EXCEPTION 'shopping_neutral_or_identity_protected' USING ERRCODE='23514'; END IF;
  PERFORM shopping_private.keys(p_decision,ARRAY['kind','id','revision','changes','response'],ARRAY['kind','id','revision','changes','response']);
  v=p_decision->'changes'; requested=p_intent->'body';
  PERFORM shopping_private.keys(requested,ARRAY['name','icon','parent_id','is_active','display_order']);
  PERFORM shopping_private.keys(v,ARRAY['name','icon','parent_id','is_active','display_order']);
  IF requested='{}'::jsonb OR kind IS DISTINCT FROM 'category.update' OR (p_decision->>'id')::bigint IS DISTINCT FROM target
   OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(requested) k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k)
   OR (v-ARRAY['name','icon','parent_id']) IS DISTINCT FROM (requested-ARRAY['name','icon','parent_id'])
   OR (requested?'name' AND v->>'name' IS DISTINCT FROM public.shopping_category_display(requested->>'name'))
   OR (requested?'icon' AND v->>'icon' IS DISTINCT FROM shopping_private.category_icon(requested->>'icon'))
   OR (requested?'parent_id' AND (v->>'parent_id')::bigint IS DISTINCT FROM (requested->>'parent_id')::bigint)
  THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.shopping_catalog_categories WHERE id=target AND revision=(p_decision->>'revision')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
  UPDATE public.shopping_catalog_categories SET
   name=CASE WHEN v?'name' THEN v->>'name' ELSE name END,
   icon=CASE WHEN v?'icon' THEN v->>'icon' ELSE icon END,
   parent_id=CASE WHEN v?'parent_id' THEN (v->>'parent_id')::bigint ELSE parent_id END,
   is_active=CASE WHEN v?'is_active' THEN (v->>'is_active')::boolean ELSE is_active END,
   display_order=CASE WHEN v?'display_order' THEN (v->>'display_order')::integer ELSE display_order END,
   revision=revision+1 WHERE id=target;
 ELSIF op='category.change' THEN
  IF target=-1 THEN RAISE EXCEPTION 'shopping_neutral_or_identity_protected' USING ERRCODE='23514'; END IF;
  PERFORM shopping_private.keys(p_decision,ARRAY['kind','id','revision','changes','response'],ARRAY['kind','id','revision','changes','response']);
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
 IF op IN ('category.create','category.change','category.edit') THEN
  -- Presentation is the trusted JavaScript decision, not a second SQL hierarchy engine.
  -- Bind it to the exact source facts above, then substitute only the allocated ID.
  projection=p_decision->'response';
  PERFORM shopping_private.keys(projection,ARRAY['path','effective_active','counts'],ARRAY['path','effective_active','counts']);
  IF jsonb_typeof(projection->'path') IS DISTINCT FROM 'array' OR jsonb_array_length(projection->'path')=0
   OR jsonb_typeof(projection->'effective_active') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(projection->'counts') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  projection=jsonb_set(projection,ARRAY['path',(jsonb_array_length(projection->'path')-1)::text,'id'],to_jsonb(target::text),false);
  SELECT projection || to_jsonb(c) || jsonb_build_object('id',c.id::text,'parent_id',c.parent_id::text,'revision',c.revision::text)
   INTO STRICT result FROM public.shopping_catalog_categories c WHERE id=target;
  response_token='"'||shopping_private.token(shopping_private.catalog_facts(),shopping_private.scope(p_actor,
    CASE WHEN op='category.change' THEN op ELSE 'category.edit' END,target::text,'[]'))||'"';
  response_http=jsonb_build_object('status',CASE WHEN op='category.create' THEN 201 ELSE 200 END,'headers',jsonb_build_object('ETag',response_token));
 END IF;
 IF p_key IS NOT NULL THEN INSERT INTO shopping_private.commands(actor,request_key,intent,result,catalog_revision,http) VALUES(p_actor,p_key,p_intent,result,rev,response_http); END IF;
 RETURN jsonb_build_object('committed',true,'replayed',false,'result',result,'catalog_revision',rev::text,'http',response_http);
END $$;


-- CREATE OR REPLACE preserves ownership/ACL. Reassert the same service-only facade.
REVOKE ALL ON FUNCTION public.shopping_state(text,jsonb),public.shopping_catalog_commit(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_state(text,jsonb),public.shopping_catalog_commit(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
