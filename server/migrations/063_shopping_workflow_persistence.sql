-- Issue #102 Gate 3E.1. CLI authoring ID 20261111203921.
-- Forward-only after byte-preserved 060/061/062. ISOLATED ONLY.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF coalesce(current_setting('shopping.isolated_migration',true),'') NOT LIKE 'shopping102-%'
 OR current_setting('shopping.isolated_migration',true) IS DISTINCT FROM
 (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())
 THEN RAISE EXCEPTION 'shopping_isolated_migration_required'; END IF;
END $$;

ALTER TABLE public.shopping_lists ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE public.shopping_product_lookup_cache ADD COLUMN lease_id uuid;

-- Preserve the verified catalog reader behind the same public facade.
ALTER FUNCTION public.shopping_state(text,jsonb) SET SCHEMA shopping_private;
ALTER FUNCTION shopping_private.shopping_state(text,jsonb) RENAME TO catalog_state_snapshot;
REVOKE ALL ON FUNCTION shopping_private.catalog_state_snapshot(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION shopping_private.list_facts(p_id bigint,p_all boolean DEFAULT false) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT shopping_private.catalog_facts() || jsonb_build_object(
 'lists',coalesce((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('id',id::text,'list_type_id',list_type_id::text,'revision',revision::text) ORDER BY id) FROM public.shopping_lists l WHERE id=p_id OR p_all),'[]'),
 'items',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('id',id::text,'list_id',list_id::text,'catalog_item_id',catalog_item_id::text,'category_id',category_id::text,'quantity',quantity::text,'price',price::text) ORDER BY id) FROM public.shopping_list_items i WHERE list_id=p_id OR p_all),'[]'),
 'plans',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY list_id) FROM public.shopping_purchase_plans p WHERE list_id=p_id),'[]'),
 'receipts',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.shopping_receipts r WHERE list_id=p_id),'[]'),
 'confirmed',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY list_id) FROM public.shopping_confirmed_purchases c WHERE list_id=p_id),'[]'),
 'checkouts',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.shopping_checkouts c WHERE list_id=p_id),'[]'));
$$;

CREATE FUNCTION shopping_private.list_scope(p_actor uuid,p_operation text,p_id text,p_item text) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('actor',p_actor,'operation',p_operation,'id',p_id,'item_id',p_item);
$$;

CREATE FUNCTION shopping_private.list_read_tokens(p_actor uuid,p_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f jsonb=shopping_private.list_facts(p_id);r jsonb='{}';i jsonb;op text;
BEGIN
 FOREACH op IN ARRAY ARRAY['list.edit','list.delete','item.append','suggestion.accept'] LOOP
 r=jsonb_set(r,ARRAY[op],to_jsonb('"'||shopping_private.token(f,shopping_private.list_scope(p_actor,op,p_id::text,NULL))||'"'));END LOOP;
 FOR i IN SELECT value FROM jsonb_array_elements(f->'items') LOOP
 FOREACH op IN ARRAY ARRAY['item.edit','item.remove','item.toggle'] LOOP
 r=jsonb_set(r,ARRAY[op||':'||(i->>'id')],to_jsonb('"'||shopping_private.token(f,shopping_private.list_scope(p_actor,op,p_id::text,i->>'id'))||'"'));END LOOP;END LOOP;
 RETURN r||jsonb_build_object('checkout','"'||shopping_private.token(shopping_private.workflow_facts('checkout',p_id),shopping_private.list_scope(p_actor,'checkout',p_id::text,NULL))||'"');
END $$;
CREATE FUNCTION public.shopping_state(p_scope text,p_ids jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f jsonb;s jsonb;op text;v_actor uuid;c shopping_private.commands;tok text;
BEGIN
 IF p_scope='catalog' THEN RETURN shopping_private.catalog_state_snapshot(p_scope,p_ids); END IF;
 IF p_scope IS DISTINCT FROM 'list' THEN RETURN shopping_private.workflow_state(p_scope,p_ids); END IF;
 PERFORM shopping_private.keys(p_ids,ARRAY['actor','request_key','operation','id','item_id'],ARRAY['actor','operation','id','item_id']);
 v_actor=(p_ids->>'actor')::uuid;op=p_ids->>'operation';
 IF v_actor IS NULL OR coalesce(op,'') NOT IN ('list.read','list.create','list.edit','list.delete','item.append','item.edit','item.remove','item.toggle','suggestion.accept')
 THEN RAISE EXCEPTION 'shopping_invalid_scope' USING ERRCODE='23514'; END IF;
 f=shopping_private.list_facts((p_ids->>'id')::bigint,op='list.read' AND p_ids->>'id' IS NULL);
 s=shopping_private.list_scope(v_actor,op,p_ids->>'id',p_ids->>'item_id');tok=shopping_private.token(f,s);
 SELECT * INTO c FROM shopping_private.commands WHERE commands.actor=v_actor AND request_key=(p_ids->>'request_key')::uuid;
 RETURN f||jsonb_build_object('version',1,'scope','list','operation',op,'complete',true,'db_time',statement_timestamp(),
  'read_tokens',CASE WHEN op='list.read' THEN coalesce((SELECT jsonb_object_agg(l->>'id',shopping_private.list_read_tokens(v_actor,(l->>'id')::bigint)) FROM jsonb_array_elements(f->'lists') l),'{}') ELSE '{}'::jsonb END,
  'expected',jsonb_build_object('catalog_revision',f->>'catalog_revision','token',tok),'etag','"'||tok||'"',
  'command',CASE WHEN c.actor IS NOT NULL THEN jsonb_build_object('actor',c.actor,'key',c.request_key,'intent',c.intent,'result',c.result,'http',c.http) END);
END $$;
REVOKE ALL ON FUNCTION public.shopping_state(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_state(text,jsonb) TO service_role;

CREATE FUNCTION shopping_private.list_item_result(p_id bigint) RETURNS jsonb LANGUAGE sql STABLE
 SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT to_jsonb(i)||jsonb_build_object('id',i.id::text,'list_id',i.list_id::text,'catalog_item_id',i.catalog_item_id::text,
 'category_id',i.category_id::text,'quantity',i.quantity::text,'price',i.price::text,
 'shopping_catalog_items',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('name',p.name,'default_unit',p.default_unit,'default_price',p.default_price::text) END,
 'shopping_catalog_categories',to_jsonb(c)) FROM public.shopping_list_items i
 LEFT JOIN public.shopping_catalog_items p ON p.id=i.catalog_item_id
 JOIN public.shopping_catalog_categories c ON c.id=i.category_id WHERE i.id=p_id;
$$;

CREATE FUNCTION public.shopping_list_commit(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
 SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE op text=p_intent->>'operation';target bigint=(p_intent->>'id')::bigint;item_id bigint=(p_intent->>'item_id')::bigint;
 kind text=p_decision->>'kind';f jsonb;s jsonb;prior shopping_private.commands;rev bigint;v jsonb;result jsonb;http jsonb;
 v_category bigint;v_product bigint;changes_catalog boolean;created_id bigint;l public.shopping_lists;
BEGIN
 IF op IN ('regular.set','regular.remove') THEN RETURN shopping_private.regular_commit(p_actor,p_key,p_intent,p_expected,p_decision); END IF;
 IF p_actor IS NULL THEN RAISE EXCEPTION 'shopping_actor_required' USING ERRCODE='42501'; END IF;
 PERFORM shopping_private.keys(p_intent,ARRAY['operation','id','item_id','body'],ARRAY['operation','id','item_id','body']);
 IF coalesce(op,'') NOT IN ('list.create','list.edit','list.delete','item.append','item.edit','item.remove','item.toggle','suggestion.accept')
 OR (op='item.toggle' AND p_key IS NULL) THEN RAISE EXCEPTION 'shopping_invalid_operation' USING ERRCODE='23514'; END IF;
 IF p_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_key::text,102060)); END IF;
 -- Creation potential is fixed before taking C. No C-S -> C-X upgrade.
 changes_catalog=op='item.append' AND (p_decision->'create_category'<>'null'::jsonb OR p_decision->'create_product'<>'null'::jsonb);
 IF changes_catalog THEN SELECT revision INTO STRICT rev FROM shopping_private.catalog_state WHERE singleton FOR UPDATE;
 ELSE SELECT revision INTO STRICT rev FROM shopping_private.catalog_state WHERE singleton FOR SHARE; END IF;
 SELECT * INTO prior FROM shopping_private.commands WHERE actor=p_actor AND request_key=p_key;
 IF FOUND THEN
  IF prior.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'shopping_key_conflict'; END IF;
  IF prior.http IS NULL THEN RAISE EXCEPTION 'shopping_legacy_result_unavailable'; END IF;
  RETURN jsonb_build_object('committed',true,'replayed',true,'result',prior.result,'http',prior.http);
 END IF;
 IF target IS NOT NULL THEN
  SELECT * INTO l FROM public.shopping_lists WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 END IF;
 f=shopping_private.list_facts(target);s=shopping_private.list_scope(p_actor,op,p_intent->>'id',p_intent->>'item_id');
 PERFORM shopping_private.keys(p_expected,ARRAY['catalog_revision','token'],ARRAY['catalog_revision','token']);
 IF p_expected->>'token' IS DISTINCT FROM shopping_private.token(f,s) OR p_expected->>'catalog_revision' IS DISTINCT FROM rev::text THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
 IF target IS NOT NULL AND (l.status NOT IN ('draft','active') OR EXISTS(SELECT 1 FROM public.shopping_checkouts WHERE list_id=target)) THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
 IF op='list.create' THEN
  PERFORM shopping_private.keys(p_decision,ARRAY['kind','values'],ARRAY['kind','values']);v=p_decision->'values';
  PERFORM shopping_private.keys(v,ARRAY['title','list_type_id','store','link','target_date','status'],ARRAY['title','list_type_id','status']);
  IF kind IS DISTINCT FROM op OR target IS NOT NULL OR item_id IS NOT NULL OR v->>'status' IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  INSERT INTO public.shopping_lists(title,list_type_id,store,link,target_date,status) VALUES(v->>'title',(v->>'list_type_id')::bigint,v->>'store',v->>'link',(v->>'target_date')::date,'draft') RETURNING id INTO target;
 ELSIF op='list.edit' THEN
  PERFORM shopping_private.keys(p_decision,ARRAY['kind','changes'],ARRAY['kind','changes']);v=p_decision->'changes';
  PERFORM shopping_private.keys(v,ARRAY['title','list_type_id','store','link','target_date','status']);
  IF kind IS DISTINCT FROM op OR v->>'status'='checked_out' THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  UPDATE public.shopping_lists SET title=CASE WHEN v?'title' THEN v->>'title' ELSE title END,
   list_type_id=CASE WHEN v?'list_type_id' THEN (v->>'list_type_id')::bigint ELSE list_type_id END,
   store=CASE WHEN v?'store' THEN v->>'store' ELSE store END,link=CASE WHEN v?'link' THEN v->>'link' ELSE link END,
   target_date=CASE WHEN v?'target_date' THEN (v->>'target_date')::date ELSE target_date END,
   status=CASE WHEN v?'status' THEN v->>'status' ELSE status END WHERE id=target;
 ELSIF op='list.delete' THEN
  PERFORM shopping_private.keys(p_decision,ARRAY['kind'],ARRAY['kind']);
  IF kind IS DISTINCT FROM op OR l.status NOT IN ('draft','active') OR f->'plans'<>'[]' OR f->'receipts'<>'[]' OR f->'confirmed'<>'[]' OR f->'checkouts'<>'[]' THEN RAISE EXCEPTION 'shopping_reference_conflict'; END IF;
  DELETE FROM public.shopping_list_items WHERE list_id=target;
  DELETE FROM public.shopping_lists WHERE id=target;result='{"success":true}';
 ELSIF op IN ('item.append','suggestion.accept') THEN
  IF kind='item.existing' AND op='suggestion.accept' THEN
   PERFORM shopping_private.keys(p_decision,ARRAY['kind','item_id'],ARRAY['kind','item_id']);
   item_id=(p_decision->>'item_id')::bigint;
   PERFORM 1 FROM public.shopping_list_items WHERE id=item_id AND list_id=target AND catalog_item_id=(p_intent#>>'{body,catalog_item_id}')::bigint;
   IF NOT FOUND THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  ELSE
   PERFORM shopping_private.keys(p_decision,ARRAY['kind','values','create_category','create_product'],ARRAY['kind','values','create_category','create_product']);
   IF kind IS DISTINCT FROM 'item.append' OR (op='suggestion.accept' AND (p_decision->'create_category'<>'null' OR p_decision->'create_product'<>'null')) THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
   v=p_decision->'values';
   PERFORM shopping_private.keys(v,ARRAY['catalog_item_id','custom_name','category_id','quantity','unit','price','notes','planned_name','is_purchased'],ARRAY['catalog_item_id','custom_name','category_id','quantity','unit','price','notes','planned_name','is_purchased']);
   v_category=(v->>'category_id')::bigint;v_product=(v->>'catalog_item_id')::bigint;
   IF p_decision->'create_category'<>'null' THEN
    PERFORM shopping_private.keys(p_decision->'create_category',ARRAY['name','parent_id','is_active','is_neutral','display_order'],ARRAY['name','parent_id','is_active','is_neutral','display_order']);
    IF v_product IS NOT NULL OR v_category IS NOT NULL OR p_decision#>'{create_category,is_neutral}'<>'false' THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
    INSERT INTO public.shopping_catalog_categories(name,parent_id,is_active,display_order) VALUES(p_decision#>>'{create_category,name}',(p_decision#>>'{create_category,parent_id}')::bigint,(p_decision#>>'{create_category,is_active}')::boolean,(p_decision#>>'{create_category,display_order}')::integer) RETURNING id INTO v_category;
   END IF;
   IF p_decision->'create_product'<>'null' THEN
    PERFORM shopping_private.keys(p_decision->'create_product',ARRAY['name','category_id','default_unit','default_price','is_active'],ARRAY['name','category_id','default_unit','default_price','is_active']);
    IF v_product IS NOT NULL OR v->>'custom_name' IS NOT NULL THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
    INSERT INTO public.shopping_catalog_items(name,category_id,default_unit,default_price,is_active) VALUES(p_decision#>>'{create_product,name}',v_category,p_decision#>>'{create_product,default_unit}',(p_decision#>>'{create_product,default_price}')::numeric,(p_decision#>>'{create_product,is_active}')::boolean) RETURNING id INTO v_product;
   END IF;
   IF v->'is_purchased' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
   INSERT INTO public.shopping_list_items(list_id,catalog_item_id,custom_name,category_id,quantity,unit,price,notes,planned_name)
    VALUES(target,v_product,v->>'custom_name',v_category,(v->>'quantity')::numeric,v->>'unit',(v->>'price')::numeric,v->>'notes',v->>'planned_name') RETURNING id INTO item_id;
  END IF;
  result=shopping_private.list_item_result(item_id);
 ELSIF op IN ('item.edit','item.toggle','item.remove') THEN
  IF (p_decision->>'item_id')::bigint IS DISTINCT FROM item_id THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.shopping_list_items WHERE id=item_id AND list_id=target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shopping_item_missing'; END IF;
  IF op='item.remove' THEN
   PERFORM shopping_private.keys(p_decision,ARRAY['kind','item_id'],ARRAY['kind','item_id']);
   IF kind IS DISTINCT FROM op THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
   DELETE FROM public.shopping_list_items WHERE id=item_id AND list_id=target;result='{"success":true}';
  ELSE
   PERFORM shopping_private.keys(p_decision,ARRAY['kind','item_id','changes'],ARRAY['kind','item_id','changes']);v=p_decision->'changes';
   PERFORM shopping_private.keys(v,ARRAY['quantity','unit','price','notes','planned_name','custom_name','category_id','is_purchased']);
   IF kind IS DISTINCT FROM 'item.edit' OR (op='item.toggle' AND v-ARRAY['is_purchased']<>'{}') THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
   UPDATE public.shopping_list_items SET quantity=CASE WHEN v?'quantity' THEN (v->>'quantity')::numeric ELSE quantity END,
    unit=CASE WHEN v?'unit' THEN v->>'unit' ELSE unit END,price=CASE WHEN v?'price' THEN (v->>'price')::numeric ELSE price END,
    notes=CASE WHEN v?'notes' THEN v->>'notes' ELSE notes END,planned_name=CASE WHEN v?'planned_name' THEN v->>'planned_name' ELSE planned_name END,
    custom_name=CASE WHEN v?'custom_name' THEN v->>'custom_name' ELSE custom_name END,
    category_id=CASE WHEN v?'category_id' THEN (v->>'category_id')::bigint ELSE category_id END,
    is_purchased=CASE WHEN v?'is_purchased' THEN (v->>'is_purchased')::boolean ELSE is_purchased END,
    purchased_at=CASE WHEN v?'is_purchased' THEN CASE WHEN (v->>'is_purchased')::boolean THEN now() ELSE NULL END ELSE purchased_at END,
    updated_at=now() WHERE id=item_id AND list_id=target;
   result=shopping_private.list_item_result(item_id);
  END IF;
 END IF;
 IF changes_catalog THEN UPDATE shopping_private.catalog_state SET revision=revision+1 WHERE singleton RETURNING revision INTO rev; END IF;
 IF op NOT IN ('list.create','list.delete') AND kind<>'item.existing' THEN UPDATE public.shopping_lists SET revision=revision+1,updated_at=now() WHERE id=target; END IF;
 IF op IN ('list.create','list.edit') THEN SELECT to_jsonb(x)||jsonb_build_object('id',id::text,'list_type_id',list_type_id::text,'revision',revision::text) INTO result FROM public.shopping_lists x WHERE id=target; END IF;
 http=jsonb_build_object('status',CASE WHEN op IN ('list.create','item.append') THEN 201 ELSE 200 END,
  'headers',jsonb_build_object('ETag','"'||shopping_private.token(shopping_private.list_facts(target),shopping_private.list_scope(p_actor,CASE WHEN op='list.create' THEN 'list.edit' ELSE op END,target::text,p_intent->>'item_id'))||'"'));
 IF p_key IS NOT NULL THEN INSERT INTO shopping_private.commands(actor,request_key,intent,result,catalog_revision,http) VALUES(p_actor,p_key,p_intent,result,rev,http); END IF;
 RETURN jsonb_build_object('committed',true,'replayed',false,'result',result,'http',http);
END $$;
REVOKE ALL ON FUNCTION public.shopping_list_commit(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_list_commit(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;
-- Shared protocol for the remaining fixed workflow families. No table/column
-- names or arbitrary SQL are accepted as effects.
CREATE FUNCTION shopping_private.workflow_facts(p_op text,p_id bigint,p_target bigint DEFAULT NULL) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN p_op LIKE 'lookup.%' THEN jsonb_build_object('cache',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY provider,environment,code) FROM public.shopping_product_lookup_cache c),'[]'))
 ELSE shopping_private.list_facts(CASE WHEN p_op LIKE 'receipt.%' OR p_op='checkout' THEN p_id END,p_op LIKE 'type.%')||jsonb_build_object(
 'cache',CASE WHEN p_op='receipt.read' THEN coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY provider,environment,code) FROM public.shopping_product_lookup_cache c),'[]') ELSE '[]'::jsonb END,
 'regulars',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY catalog_item_id) FROM public.shopping_regular_products r),'[]'),
 'history',CASE WHEN p_op='receipt.read' THEN coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY purchase_date DESC,list_id) FROM public.shopping_confirmed_purchases h),'[]') ELSE '[]'::jsonb END,
 'commercial',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('package_quantity',package_quantity::text) ORDER BY id) FROM public.shopping_commercial_products p),'[]'),
 'identifiers',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY kind,retailer_scope,code) FROM public.shopping_product_identifiers i),'[]'),
 'mappings',coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('personal_item_id',personal_item_id::text,'factor',factor::text) ORDER BY commercial_product_id,revision) FROM public.shopping_product_mappings m),'[]'),
 'receipt_set',CASE WHEN p_op LIKE 'receipt.%' OR p_op='checkout' THEN coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.shopping_receipts r),'[]') ELSE '[]'::jsonb END,
 'target',CASE WHEN p_target IS NOT NULL THEN shopping_private.list_facts(p_target) END) END;
$$;

CREATE FUNCTION shopping_private.workflow_read_tokens(p_actor uuid,p_list bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f jsonb=shopping_private.workflow_facts('regular.set',NULL);r jsonb='{}';i jsonb;op text;
BEGIN
 FOR i IN SELECT value FROM jsonb_array_elements(f->'products') LOOP
 FOREACH op IN ARRAY ARRAY['regular.set','regular.remove'] LOOP
 r=jsonb_set(r,ARRAY[op||':'||(i->>'id')],to_jsonb('"'||shopping_private.token(f,shopping_private.list_scope(p_actor,op,i->>'id',NULL))||'"'));END LOOP;END LOOP;
 RETURN r||jsonb_build_object('commercial.approve','"'||shopping_private.token(shopping_private.workflow_facts('commercial.approve',NULL),shopping_private.list_scope(p_actor,'commercial.approve',NULL,NULL))||'"')||shopping_private.list_read_tokens(p_actor,p_list);
END $$;
CREATE FUNCTION shopping_private.type_read_tokens(p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f jsonb=shopping_private.workflow_facts('type.read',NULL);r jsonb='{}';i jsonb;op text;
BEGIN
 FOR i IN SELECT value FROM jsonb_array_elements(f->'listTypes') LOOP
 FOREACH op IN ARRAY ARRAY['type.edit','type.deactivate'] LOOP
 r=jsonb_set(r,ARRAY[op||':'||(i->>'id')],to_jsonb('"'||shopping_private.token(f,shopping_private.list_scope(p_actor,op,i->>'id',NULL))||'"'));END LOOP;END LOOP;
 RETURN r;
END $$;
CREATE FUNCTION shopping_private.workflow_state(p_scope text,p_ids jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f jsonb;s jsonb;c shopping_private.commands;actor_id uuid=(p_ids->>'actor')::uuid;op text=p_ids->>'operation';tok text;
BEGIN
 PERFORM shopping_private.keys(p_ids,ARRAY['actor','request_key','operation','id','target_id'],ARRAY['actor','operation','id','target_id']);
 IF actor_id IS NULL OR p_scope NOT IN ('receipt','commercial','lookup','regular','checkout','type','entry')
 OR coalesce(op,'') NOT IN ('receipt.read','receipt.begin','receipt.progress','receipt.extracted','receipt.failed','receipt.draft','receipt.confirm','receipt.move','commercial.read','commercial.approve','commercial.map','lookup.read','lookup.claim','lookup.finalize','regular.set','regular.remove','checkout','type.read','type.create','type.edit','type.deactivate','entry.category')
 OR (op<>'checkout' AND split_part(op,'.',1)<>p_scope) OR (op='checkout' AND p_scope<>'checkout')
 THEN RAISE EXCEPTION 'shopping_invalid_scope' USING ERRCODE='23514'; END IF;
 f=shopping_private.workflow_facts(op,(p_ids->>'id')::bigint,(p_ids->>'target_id')::bigint);
 s=shopping_private.list_scope(actor_id,op,p_ids->>'id',p_ids->>'target_id');tok=shopping_private.token(f,s);
 SELECT * INTO c FROM shopping_private.commands WHERE actor=actor_id AND request_key=(p_ids->>'request_key')::uuid;
 RETURN f||jsonb_build_object('version',1,'scope',p_scope,'operation',op,'complete',true,'db_time',statement_timestamp(),
 'read_tokens',CASE WHEN op='receipt.read' THEN shopping_private.workflow_read_tokens(actor_id,(p_ids->>'id')::bigint) WHEN op='type.read' THEN shopping_private.type_read_tokens(actor_id) ELSE '{}'::jsonb END,
 'expected',jsonb_build_object('token',tok),'etag','"'||tok||'"',
 'command',CASE WHEN c.actor IS NOT NULL THEN jsonb_build_object('actor',c.actor,'key',c.request_key,'intent',c.intent,'result',c.result,'http',c.http) END);
END $$;

CREATE FUNCTION shopping_private.workflow_lock(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE op text=p_intent->>'operation';p_id bigint=(p_intent->>'id')::bigint;p_target bigint;f jsonb;s jsonb;c shopping_private.commands;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'shopping_actor_required' USING ERRCODE='42501'; END IF;
 PERFORM shopping_private.keys(p_intent,ARRAY['operation','id','body'],ARRAY['operation','id','body']);
 IF op='receipt.move' THEN p_target=(p_intent#>>'{body,target_list_id}')::bigint; END IF;
 -- F first: the approved existing financial lock precedes Shopping locks.
 IF op='checkout' THEN LOCK TABLE public.transactions IN EXCLUSIVE MODE; END IF;
 IF p_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_key::text,102060)); END IF;
 IF op LIKE 'lookup.%' THEN PERFORM pg_advisory_xact_lock(420092);
 ELSIF op IN ('commercial.approve','commercial.map','regular.set','regular.remove','receipt.confirm','type.create','type.edit','type.deactivate','entry.category') THEN
  PERFORM 1 FROM shopping_private.catalog_state WHERE singleton FOR UPDATE;
 ELSE PERFORM 1 FROM shopping_private.catalog_state WHERE singleton FOR SHARE; END IF;
 IF op LIKE 'receipt.%' OR op='checkout' THEN
  PERFORM pg_advisory_xact_lock(390092);
  PERFORM 1 FROM public.shopping_lists WHERE id IN(p_id,p_target) ORDER BY id FOR UPDATE;
 END IF;
 SELECT * INTO c FROM shopping_private.commands WHERE actor=p_actor AND request_key=p_key;
 IF FOUND THEN
  IF c.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'shopping_key_conflict'; END IF;
  IF c.http IS NULL THEN RAISE EXCEPTION 'shopping_legacy_result_unavailable'; END IF;
  RETURN jsonb_build_object('replay',jsonb_build_object('committed',true,'replayed',true,'result',c.result,'http',c.http));
 END IF;
 IF op='checkout' AND EXISTS(SELECT 1 FROM public.shopping_checkouts WHERE list_id=p_id) THEN
  RETURN jsonb_build_object('replay',shopping_private.workflow_result(p_actor,p_key,p_intent,
   shopping_private.checkout_financial(p_id,(p_intent#>>'{body,category_id}')::bigint,(p_intent#>>'{body,payment_source_id}')::bigint,coalesce(p_intent#>'{body,duplicate_reviewed_ids}','[]'),'[]')));
 END IF;
 f=shopping_private.workflow_facts(op,p_id,p_target);s=shopping_private.list_scope(p_actor,op,p_intent->>'id',p_target::text);
 PERFORM shopping_private.keys(p_expected,ARRAY['token'],ARRAY['token']);
 IF p_expected->>'token' IS DISTINCT FROM shopping_private.token(f,s) THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
 RETURN jsonb_build_object('facts',f);
END $$;

CREATE FUNCTION shopping_private.workflow_result(p_actor uuid,p_key uuid,p_intent jsonb,p_result jsonb,p_status integer DEFAULT 200) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f jsonb;s jsonb;h jsonb;r bigint;target bigint;
BEGIN
 IF p_intent->>'operation'='receipt.move' THEN target=(p_intent#>>'{body,target_list_id}')::bigint; END IF;
 f=shopping_private.workflow_facts(p_intent->>'operation',(p_intent->>'id')::bigint,target);
 s=shopping_private.list_scope(p_actor,p_intent->>'operation',p_intent->>'id',target::text);
 h=jsonb_build_object('status',p_status,'headers',jsonb_build_object('ETag','"'||shopping_private.token(f,s)||'"'));
 -- Lookup-only work never takes C, including when recording a durable result.
 r=coalesce((f->>'catalog_revision')::bigint,0);
 IF p_key IS NOT NULL THEN INSERT INTO shopping_private.commands(actor,request_key,intent,result,catalog_revision,http) VALUES(p_actor,p_key,p_intent,p_result,r,h); END IF;
 RETURN jsonb_build_object('committed',true,'replayed',false,'result',p_result,'http',h);
END $$;

CREATE FUNCTION shopping_private.regular_commit(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state jsonb;v jsonb=p_decision->'values';target bigint=(p_intent->>'id')::bigint;
BEGIN
 state=shopping_private.workflow_lock(p_actor,p_key,p_intent,p_expected);IF state?'replay' THEN RETURN state->'replay'; END IF;
 PERFORM shopping_private.keys(p_decision,ARRAY['kind','values'],ARRAY['kind','values']);
 IF p_decision->>'kind' IS DISTINCT FROM p_intent->>'operation' THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
 IF p_intent->>'operation'='regular.remove' THEN
  IF v<>'{}' THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  DELETE FROM public.shopping_regular_products WHERE catalog_item_id=target;
 ELSE
  PERFORM shopping_private.keys(v,ARRAY['quantity','unit'],ARRAY['quantity','unit']);
  INSERT INTO public.shopping_regular_products(catalog_item_id,quantity,unit) VALUES(target,(v->>'quantity')::numeric,v->>'unit')
   ON CONFLICT(catalog_item_id) DO UPDATE SET quantity=excluded.quantity,unit=excluded.unit,updated_at=now();
 END IF;
 UPDATE shopping_private.catalog_state SET revision=revision+1 WHERE singleton;
 RETURN shopping_private.workflow_result(p_actor,p_key,p_intent,'{"ok":true}');
END $$;

CREATE FUNCTION shopping_private.commercial_row(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT to_jsonb(p)||jsonb_build_object('package_quantity',p.package_quantity::text,
 'mapping',(SELECT to_jsonb(m)||jsonb_build_object('personal_item_id',m.personal_item_id::text,'factor',m.factor::text) FROM public.shopping_product_mappings m WHERE m.commercial_product_id=p.id AND m.revision=p.mapping_revision),
 'identifiers',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY kind,retailer_scope,code) FROM public.shopping_product_identifiers i WHERE i.commercial_product_id=p.id),'[]'))
 FROM public.shopping_commercial_products p WHERE p.id=p_id;
$$;

CREATE FUNCTION shopping_private.apply_commercial(p_actor uuid,p_effects jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target uuid=(p_effects->>'id')::uuid;v jsonb;k jsonb=p_effects->'identifier';personal bigint;
BEGIN
 IF p_effects->>'kind'='commercial.historical-replay' THEN
  PERFORM shopping_private.keys(p_effects,ARRAY['kind','id'],ARRAY['kind','id']);RETURN shopping_private.commercial_row(target);
 END IF;
 PERFORM shopping_private.keys(p_effects,ARRAY['kind','id','identifier','create','approve','mapping','create_personal'],ARRAY['kind','id','identifier','create','approve','mapping','create_personal']);
 IF p_effects->>'kind' IS DISTINCT FROM 'commercial.write' THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
 PERFORM shopping_private.keys(k,ARRAY['kind','retailer_scope','code'],ARRAY['kind','retailer_scope','code']);
 IF p_effects->'create'<>'null' THEN
  v=p_effects->'create';PERFORM shopping_private.keys(v,ARRAY['receipt_name','brand','package_quantity','package_unit','provenance'],ARRAY['receipt_name','brand','package_quantity','package_unit','provenance']);
  INSERT INTO public.shopping_commercial_products(id,receipt_name,brand,package_quantity,package_unit,provenance)
   VALUES(target,v->>'receipt_name',v->>'brand',(v->>'package_quantity')::numeric,v->>'package_unit',v->'provenance');
  INSERT INTO public.shopping_product_identifiers(kind,retailer_scope,code,commercial_product_id) VALUES(k->>'kind',k->>'retailer_scope',k->>'code',target);
 ELSE
  PERFORM 1 FROM public.shopping_product_identifiers WHERE kind=k->>'kind' AND retailer_scope=k->>'retailer_scope' AND code=k->>'code' AND commercial_product_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
 END IF;
 IF p_effects->'approve'<>'null' THEN
  v=p_effects->'approve';PERFORM shopping_private.keys(v,ARRAY['approved_name','brand','package_quantity','package_unit','provenance'],ARRAY['approved_name']);
  UPDATE public.shopping_commercial_products SET approved_name=v->>'approved_name',approved_by=p_actor,approved_at=now(),
   brand=CASE WHEN v?'brand' THEN v->>'brand' ELSE brand END,package_quantity=CASE WHEN v?'package_quantity' THEN (v->>'package_quantity')::numeric ELSE package_quantity END,
   package_unit=CASE WHEN v?'package_unit' THEN v->>'package_unit' ELSE package_unit END,provenance=CASE WHEN v?'provenance' THEN v->'provenance' ELSE provenance END,updated_at=now() WHERE id=target;
 END IF;
 IF p_effects->'mapping'<>'null' THEN
  v=p_effects->'mapping';PERFORM shopping_private.keys(v,ARRAY['revision','personal_item_id','personal_name','planning_unit','receipt_unit','factor','request_key','request_payload','approved_by'],ARRAY['revision','personal_item_id','personal_name','planning_unit','receipt_unit','factor','request_key','request_payload','approved_by']);
  IF (v->>'approved_by')::uuid IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  personal=(v->>'personal_item_id')::bigint;
  IF p_effects->'create_personal'<>'null' THEN
   PERFORM shopping_private.keys(p_effects->'create_personal',ARRAY['name','default_unit','category_id'],ARRAY['name','default_unit','category_id']);
   IF personal IS NOT NULL THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
   INSERT INTO public.shopping_catalog_items(name,default_unit,category_id) VALUES(p_effects#>>'{create_personal,name}',p_effects#>>'{create_personal,default_unit}',(p_effects#>>'{create_personal,category_id}')::bigint) RETURNING id INTO personal;
  END IF;
  UPDATE public.shopping_commercial_products SET mapping_revision=mapping_revision+1,updated_at=now() WHERE id=target AND mapping_revision=(v->>'revision')::int-1;
  IF NOT FOUND THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
  INSERT INTO public.shopping_product_mappings(commercial_product_id,revision,personal_item_id,personal_name,planning_unit,receipt_unit,factor,request_key,request_payload,approved_by)
   VALUES(target,(v->>'revision')::int,personal,v->>'personal_name',v->>'planning_unit',v->>'receipt_unit',(v->>'factor')::numeric,(v->>'request_key')::uuid,v->'request_payload',p_actor);
 END IF;
 RETURN shopping_private.commercial_row(target);
END $$;

-- Wire projection only; no lookup, matching, eligibility, conversion or totals.
CREATE FUNCTION shopping_private.commercial_http(p_row jsonb,p_key jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('kind',p_key->'kind','retailer_scope',p_key->'retailer_scope','code',p_key->'code',
 'commercial_product_id',p_row->'id','full_name',coalesce(p_row->>'approved_name',p_row->>'receipt_name'),'brand',coalesce(p_row->>'brand',''),
 'package_quantity',p_row->>'package_quantity','package_unit',p_row->'package_unit','source','owner_catalog','owner_approved',coalesce(p_row->>'approved_name','')<>'',
 'mapping_revision',p_row->'mapping_revision','mapping',CASE WHEN p_row->'mapping' IS DISTINCT FROM 'null'::jsonb AND p_row?'mapping' THEN
 jsonb_build_object('commercial_product_id',p_row#>'{mapping,commercial_product_id}','revision',p_row#>'{mapping,revision}',
 'personal_item_id',p_row#>>'{mapping,personal_item_id}','personal_name',p_row#>'{mapping,personal_name}','planning_unit',p_row#>'{mapping,planning_unit}',
 'receipt_unit',p_row#>'{mapping,receipt_unit}','factor',p_row#>>'{mapping,factor}') END);
$$;
CREATE FUNCTION public.shopping_commercial_commit(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE state jsonb;result jsonb;
BEGIN
 IF coalesce(p_intent->>'operation','') NOT IN ('commercial.approve','commercial.map') THEN RAISE EXCEPTION 'shopping_invalid_operation' USING ERRCODE='23514'; END IF;
 state=shopping_private.workflow_lock(p_actor,p_key,p_intent,p_expected);IF state?'replay' THEN RETURN state->'replay'; END IF;
 result=shopping_private.commercial_http(shopping_private.apply_commercial(p_actor,p_decision),p_intent->'body');
 IF p_decision->>'kind'<>'commercial.historical-replay' THEN UPDATE shopping_private.catalog_state SET revision=revision+1 WHERE singleton; END IF;
 RETURN shopping_private.workflow_result(p_actor,p_key,p_intent,result);
END $$;
REVOKE ALL ON FUNCTION public.shopping_commercial_commit(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_commercial_commit(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;


-- Approved receipt-only and financial exceptions. Catalog selection, matching,
-- conversion and list presentation have been extracted to JavaScript. These
-- helpers are owner-only and callable only under the outer F/K/C/R/L protocol.
-- Integrity only: the complete projection must contain every current row once.
-- Monetary values are always read from locked rows by checkout_financial.
CREATE FUNCTION shopping_private.assert_projection(p_list bigint,p_projection jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF jsonb_typeof(p_projection) IS DISTINCT FROM 'array' OR
 jsonb_array_length(p_projection)<>(SELECT count(*) FROM public.shopping_list_items WHERE list_id=p_list) OR
 (SELECT count(DISTINCT value->>'list_item_id') FROM jsonb_array_elements(p_projection))<>jsonb_array_length(p_projection) OR
 EXISTS(SELECT 1 FROM jsonb_array_elements(p_projection) v LEFT JOIN public.shopping_list_items i ON i.id=(v->>'list_item_id')::bigint AND i.list_id=p_list WHERE i.id IS NULL)
 THEN RAISE EXCEPTION 'shopping_invalid_projection' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION shopping_private.receipt_context(p_list bigint,p_projection jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('store',l.store,'current_items',p_projection,'plan',p.items,'receipt',to_jsonb(r),
 'token',md5(jsonb_build_array(l.id,l.store,l.status,p_projection,p.items,r.attempts,r.draft_revision,r.extracted)::text))
 FROM public.shopping_lists l LEFT JOIN public.shopping_receipts r ON r.list_id=l.id LEFT JOIN public.shopping_purchase_plans p ON p.list_id=l.id WHERE l.id=p_list;
$$;
CREATE FUNCTION public.shopping_receipt_context_for_projection(p_list bigint,p_projection jsonb,p_expected jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f jsonb;s jsonb;
BEGIN
 PERFORM shopping_private.keys(p_expected,ARRAY['token','actor','operation','target_id'],ARRAY['token','actor','operation','target_id']);
 IF (p_expected->>'actor')::uuid IS NULL OR coalesce(p_expected->>'operation','') NOT IN ('receipt.read','receipt.confirm','receipt.move') OR jsonb_typeof(p_projection) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'shopping_invalid_scope' USING ERRCODE='23514'; END IF;
 f=shopping_private.workflow_facts(p_expected->>'operation',p_list,(p_expected->>'target_id')::bigint);
 s=shopping_private.list_scope((p_expected->>'actor')::uuid,p_expected->>'operation',p_list::text,p_expected->>'target_id');
 IF p_expected->>'token' IS DISTINCT FROM shopping_private.token(f,s) THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
 RETURN shopping_private.receipt_context(p_list,p_projection);
END $$;
REVOKE ALL ON FUNCTION public.shopping_receipt_context_for_projection(bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_receipt_context_for_projection(bigint,jsonb,jsonb) TO service_role;
CREATE FUNCTION shopping_private.apply_receipt(p_actor uuid,p_list bigint,p_action text,p_effects jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $receipt$
DECLARE r public.shopping_receipts; v_items jsonb; v_item jsonb; v_date date; v_hashes text[]; v_product jsonb; v_mapping jsonb; v_final jsonb; v_seen jsonb='{}'; v_key text; p_data jsonb=p_effects;
BEGIN
 -- Cross-list receipt decisions serialize before parent locks; no network inside this transaction.
 PERFORM pg_advisory_xact_lock(390092);
 PERFORM 1 FROM public.shopping_lists WHERE id=p_list FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 SELECT * INTO r FROM public.shopping_receipts WHERE list_id=p_list FOR UPDATE;
 IF p_action='begin' THEN
  IF NOT EXISTS(SELECT 1 FROM shopping_list_items WHERE list_id=p_list) THEN RAISE EXCEPTION 'receipt_list_empty'; END IF;
  IF EXISTS(SELECT 1 FROM shopping_lists WHERE id=p_list AND status IN ('archived','checked_out')) THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
  IF p_data ? 'reprocess_key' AND r.id IS NOT NULL AND r.reprocess_key=(p_data->>'reprocess_key')::uuid THEN
   IF r.image_hash IS DISTINCT FROM p_data->>'image_hash' OR (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts-1 THEN RAISE EXCEPTION 'receipt_reprocess_conflict'; END IF;
   RETURN to_jsonb(r)||jsonb_build_object('processing_replay',true);
  END IF;
  IF p_data->>'reprocess'='true' AND (r.id IS NULL OR p_data->>'reprocess_key' IS NULL OR (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts) THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  IF p_data ? 'review_draft' AND (jsonb_typeof(p_data->'review_draft')<>'object' OR octet_length((p_data->'review_draft')::text)>2097152) THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
  SELECT array_agg(value) INTO v_hashes FROM jsonb_array_elements_text(p_data->'image_hashes');
  IF v_hashes IS NULL THEN v_hashes=ARRAY[p_data->>'image_hash']; END IF;
  IF cardinality(v_hashes) NOT BETWEEN 1 AND 24 OR EXISTS(SELECT 1 FROM unnest(v_hashes) h WHERE h IS NULL OR h !~ '^[a-f0-9]{64}$')
   OR (SELECT count(DISTINCT h) FROM unnest(v_hashes) h)<>cardinality(v_hashes) THEN RAISE EXCEPTION 'receipt_images_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM shopping_receipts WHERE list_id<>p_list AND image_hashes && v_hashes) THEN RAISE EXCEPTION 'receipt_duplicate'; END IF;
  IF r.id IS NOT NULL THEN
   IF r.image_hash=p_data->>'image_hash' AND r.state IN ('review','confirmed') AND p_data->>'reprocess' IS DISTINCT FROM 'true' THEN RETURN to_jsonb(r); END IF;
   IF r.state='confirmed' THEN RAISE EXCEPTION 'receipt_already_exists'; END IF;
   IF r.state='extracting' AND COALESCE(r.lease_expires_at,r.updated_at+interval '2 minutes')>now() THEN RAISE EXCEPTION 'receipt_processing'; END IF;
   IF r.image_hash<>p_data->>'image_hash' AND (p_data->>'expected_attempt')::int IS DISTINCT FROM r.attempts THEN RAISE EXCEPTION 'receipt_stale'; END IF;
   IF r.attempts>=5 THEN RAISE EXCEPTION 'receipt_attempt_limit'; END IF;
   IF r.review_draft IS NOT NULL THEN
    IF (p_data->>'draft_revision')::int IS DISTINCT FROM r.draft_revision THEN RAISE EXCEPTION 'receipt_stale'; END IF;
    IF NOT (p_data ? 'review_draft') THEN p_data=jsonb_set(p_data,'{review_draft}',r.review_draft); END IF;
   END IF;
   UPDATE public.shopping_receipts SET
    previous_drafts=previous_drafts||jsonb_build_array(jsonb_build_object('attempt',r.attempts,'extracted',r.extracted,'review_draft',p_data->'review_draft','image_hashes',r.image_hashes,'saved_at',now())),
    review_draft=NULL,draft_revision=draft_revision+1,reprocess_key=(p_data->>'reprocess_key')::uuid,
    image_hash=p_data->>'image_hash',image_hashes=v_hashes,state='extracting',extracted=NULL,
    attempts=attempts+1,updated_at=now(),error_code=NULL WHERE id=r.id RETURNING * INTO r;
  ELSE
   IF COALESCE((p_data->>'expected_attempt')::int,0)<>0 THEN RAISE EXCEPTION 'receipt_stale'; END IF;
   INSERT INTO public.shopping_purchase_plans(list_id,items) VALUES(p_list,p_data->'_projection') ON CONFLICT DO NOTHING;
   INSERT INTO public.shopping_receipts(list_id,image_hash,image_hashes,state) VALUES(p_list,p_data->>'image_hash',v_hashes,'extracting') RETURNING * INTO r;
  END IF;
  UPDATE shopping_receipts SET lease_expires_at=now()+make_interval(secs=>LEAST(660,GREATEST(60,COALESCE((p_data->>'duration_ms')::int,480000)/1000+60))),
   progress='{"stage":"preparing","completed":0,"total":0}' WHERE id=r.id RETURNING * INTO r;
 ELSIF p_action='progress' THEN
  IF r.state<>'extracting' OR r.attempts IS DISTINCT FROM (p_data->>'attempt')::int THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  UPDATE shopping_receipts SET progress=p_data->'progress' WHERE id=r.id RETURNING * INTO r;
 ELSIF p_action IN ('extracted','failed') THEN
  IF r.id IS NULL OR r.state<>'extracting' OR r.attempts<>(p_data->>'attempt')::int THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  UPDATE public.shopping_receipts SET state=CASE WHEN p_action='extracted' THEN 'review' ELSE 'failed' END,
   extracted=CASE WHEN p_action='extracted' THEN p_data->'extracted' ELSE NULL END,
   error_code=CASE WHEN p_action='failed' THEN 'extraction_failed' ELSE NULL END,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 ELSIF p_action='confirm' THEN
  IF r.state='confirmed' AND r.confirmation_request IS NOT NULL THEN
   IF r.confirmation_request IS DISTINCT FROM p_data->'_request' THEN RAISE EXCEPTION 'receipt_confirmation_conflict'; END IF;
   RETURN to_jsonb(r);
  END IF;
  IF p_data->>'context_token' IS DISTINCT FROM shopping_private.receipt_context(p_list,p_data->'_projection')->>'token' OR p_data->>'_owner' IS NULL THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  IF NOT EXISTS(SELECT 1 FROM shopping_list_items WHERE list_id=p_list) THEN RAISE EXCEPTION 'receipt_list_empty'; END IF;
  IF EXISTS(SELECT 1 FROM shopping_lists WHERE id=p_list AND status IN ('archived','checked_out')) THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
  IF p_data->>'_merchant_state' IS NULL THEN RAISE EXCEPTION 'receipt_merchant_review_required'; END IF;
  UPDATE shopping_receipts SET confirmation_request=p_data->'_request' WHERE id=r.id;
  v_final='[]';
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'items') LOOP
   IF v_item ? '_commercial_effect' THEN
    v_key=v_item#>>'{_commercial_effect,id}';
    v_product=v_seen->v_key;
    IF v_product IS NULL THEN
     v_product=shopping_private.apply_commercial(p_actor,v_item->'_commercial_effect');
     v_seen=jsonb_set(v_seen,ARRAY[v_key],v_product);
    END IF;
    v_mapping=v_product->'mapping';
    v_item=(v_item-'_commercial_effect')||jsonb_build_object('commercial_product_id',v_product->>'id','mapping_snapshot',
     jsonb_build_object('commercial_product_id',v_product->>'id','revision',v_mapping->'revision','personal_item_id',v_mapping->>'personal_item_id',
     'personal_name',v_mapping->>'personal_name','planning_unit',v_mapping->>'planning_unit','receipt_unit',v_mapping->>'receipt_unit','factor',v_mapping->>'factor'));
   END IF;
   v_final=v_final||jsonb_build_array(v_item);
  END LOOP;
  UPDATE shopping_list_items SET is_purchased=true WHERE list_id=p_list AND id IN (SELECT value::bigint FROM jsonb_array_elements_text(p_data->'_fulfilled')) AND NOT is_purchased;
  p_data=jsonb_set(p_data-'_owner'-'_request'-'_fulfilled'-'_merchant_state'-'_projection','{items}',v_final);
  IF r.state<>'confirmed' AND r.review_draft IS NOT NULL AND (p_data->>'draft_revision')::int IS DISTINCT FROM r.draft_revision THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  IF p_data->>'reviewed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'receipt_review_required'; END IF;
  IF r.state='confirmed' THEN
   IF r.confirmed<>p_data THEN RAISE EXCEPTION 'receipt_confirmation_conflict'; END IF;
   RETURN to_jsonb(r);
  END IF;
  IF r.id IS NULL OR r.state<>'review' THEN RAISE EXCEPTION 'receipt_not_reviewable'; END IF;
  PERFORM public.shopping_require_duplicate_review(p_list,COALESCE(p_data->'identity',r.extracted->'identity'),p_data->'duplicate_reviewed_ids');
  IF (p_data->>'extraction_attempt')::int IS DISTINCT FROM r.attempts THEN RAISE EXCEPTION 'receipt_stale'; END IF;
  v_items=p_data->'items'; v_date=(p_data->>'purchase_date')::date;
  IF v_date IS NULL OR jsonb_typeof(v_items)<>'array' OR jsonb_array_length(v_items) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
   IF (v_item->>'price' IS NULL AND NOT (v_item->>'price_basis'='line_discount' AND v_item->>'final_total' IS NOT NULL)) OR v_item->>'quantity' IS NULL OR COALESCE(v_item->>'name','')='' OR (v_item->>'quantity')::numeric<=0 OR (v_item->>'price')::numeric<0 THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
   IF v_item->>'price_basis'='line_discount' THEN
    IF v_item->>'row_discount' IS NULL OR v_item->>'final_total' IS NULL OR
      (v_item->>'final_total')::numeric<0 OR
      (v_item->>'final_total')::numeric IS DISTINCT FROM round((v_item->>'calculated_gross_total')::numeric,2)-(v_item->>'row_discount')::numeric THEN RAISE EXCEPTION 'receipt_invalid'; END IF;
   END IF;
   -- Category/product eligibility was decided in JS from the locked source facts.
  END LOOP;
  UPDATE public.shopping_receipts SET state='confirmed',confirmed=p_data,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  -- Replace a checkout snapshot, never append a second shopping event or change financial cash.
  INSERT INTO public.shopping_confirmed_purchases(list_id,purchase_date,items,basis,receipt_id)
   VALUES(p_list,v_date,v_items,'receipt',r.id)
   ON CONFLICT(list_id) DO UPDATE SET purchase_date=excluded.purchase_date,items=excluded.items,basis='receipt',receipt_id=excluded.receipt_id,confirmed_at=now();
 ELSE RAISE EXCEPTION 'receipt_action_invalid'; END IF;
 RETURN to_jsonb(r);
END $receipt$;
CREATE FUNCTION shopping_private.receipt_move(p_list bigint,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $move$
DECLARE r shopping_receipts; p_target bigint=(p_data->>'target_list_id')::bigint;p_token text=p_data->>'context_token';
BEGIN
 PERFORM pg_advisory_xact_lock(390092);
 PERFORM 1 FROM shopping_lists WHERE id IN (p_list,p_target) ORDER BY id FOR UPDATE;
 IF p_token IS DISTINCT FROM shopping_private.receipt_context(p_list,p_data->'_projection')->>'token' THEN RAISE EXCEPTION 'receipt_stale'; END IF;
 SELECT * INTO r FROM shopping_receipts WHERE list_id=p_list FOR UPDATE;
 IF r.state IS DISTINCT FROM 'review' THEN RAISE EXCEPTION 'receipt_not_reviewable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shopping_lists WHERE id=p_target AND status NOT IN ('checked_out','archived')) THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM shopping_list_items WHERE list_id=p_target) THEN RAISE EXCEPTION 'receipt_list_empty'; END IF;
 IF EXISTS(SELECT 1 FROM shopping_receipts WHERE list_id=p_target) OR EXISTS(SELECT 1 FROM shopping_checkouts WHERE list_id=p_target) THEN RAISE EXCEPTION 'receipt_already_exists'; END IF;
 INSERT INTO shopping_purchase_plans(list_id,items) VALUES(p_target,p_data->'_target_projection') ON CONFLICT DO NOTHING;
 UPDATE shopping_receipts SET list_id=p_target,origin_plan=COALESCE(origin_plan,jsonb_build_object('list_id',p_list,'items',(SELECT items FROM shopping_purchase_plans WHERE list_id=p_list))),
  draft_revision=draft_revision+1 WHERE id=r.id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $move$;
CREATE FUNCTION shopping_private.checkout_financial(p_list bigint,p_category bigint,p_source bigint,p_duplicate_reviewed_ids jsonb,p_projection jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $financial$
DECLARE l public.shopping_lists; c public.shopping_checkouts; v_items jsonb; v_total numeric; v_transaction bigint; v_date date=(now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(390092);
 SELECT * INTO l FROM public.shopping_lists WHERE id=p_list FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 SELECT * INTO c FROM public.shopping_checkouts WHERE list_id=p_list;
 IF FOUND THEN
  IF c.category_id IS DISTINCT FROM p_category OR c.payment_source_id IS DISTINCT FROM p_source THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
  RETURN jsonb_build_object('checkout',to_jsonb(c),'transaction_id',c.transaction_id,'total_amount',c.total_amount,'replay',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.shopping_receipts WHERE list_id=p_list AND state='extracting') THEN RAISE EXCEPTION 'receipt_processing'; END IF;
 PERFORM public.shopping_require_duplicate_review(p_list,NULL,p_duplicate_reviewed_ids);
 IF l.status IN ('checked_out','archived') THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
 IF p_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=p_category AND is_active AND type='expense' AND savings_role IS NULL) THEN RAISE EXCEPTION 'checkout_category_invalid'; END IF;
 IF p_source IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payment_sources WHERE id=p_source AND is_active) THEN RAISE EXCEPTION 'checkout_source_invalid'; END IF;
 INSERT INTO public.shopping_purchase_plans(list_id,items) VALUES(p_list,p_projection) ON CONFLICT DO NOTHING;
 SELECT items,purchase_date INTO v_items,v_date FROM public.shopping_confirmed_purchases WHERE list_id=p_list;
 IF FOUND AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) WHERE value->>'price' IS NULL AND value->>'final_total' IS NULL) THEN RAISE EXCEPTION 'checkout_receipt_price_required'; END IF;
 IF v_items IS NULL THEN
  v_date=(now() AT TIME ZONE 'Asia/Jerusalem')::date;
  SELECT COALESCE(jsonb_agg(value||jsonb_build_object('quantity',coalesce(i.quantity,1)::text,'price',i.price::text,'is_purchased',i.is_purchased) ORDER BY i.id),'[]') INTO v_items
   FROM jsonb_array_elements(p_projection) value JOIN public.shopping_list_items i ON i.id=(value->>'list_item_id')::bigint
   WHERE i.list_id=p_list AND i.is_purchased;
 END IF;
 IF jsonb_array_length(v_items)=0 THEN RAISE EXCEPTION 'checkout_empty'; END IF;
 SELECT round(sum(CASE WHEN value->>'price_basis'='line_discount' THEN (value->>'final_total')::numeric ELSE (value->>'quantity')::numeric * COALESCE((value->>'price')::numeric,0) END),2) INTO v_total FROM jsonb_array_elements(v_items);
 IF v_total<0 THEN RAISE EXCEPTION 'checkout_total_invalid'; END IF;
 INSERT INTO public.transactions(description,movement_type,category_id,payment_source_id,total_amount,transaction_date,charge_date)
 VALUES(l.title,'expense',p_category,p_source,v_total,v_date,v_date) RETURNING id INTO v_transaction;
 INSERT INTO public.shopping_checkouts(list_id,checkout_date,total_amount,payment_source_id,category_id,transaction_id)
 VALUES(p_list,v_date,v_total,p_source,p_category,v_transaction) RETURNING * INTO c;
 INSERT INTO public.shopping_confirmed_purchases(list_id,purchase_date,items,basis) VALUES(p_list,v_date,v_items,'checkout') ON CONFLICT DO NOTHING;
 UPDATE public.shopping_lists SET status='checked_out',updated_at=now() WHERE id=p_list;
 RETURN jsonb_build_object('checkout',to_jsonb(c),'transaction_id',v_transaction,'total_amount',v_total,'replay',false);
END $financial$;
CREATE FUNCTION public.shopping_receipt_commit(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE state jsonb;result jsonb;op text=p_intent->>'operation';target bigint=(p_intent->>'id')::bigint;v jsonb=p_decision->'data';
BEGIN
 IF coalesce(op,'') NOT IN ('receipt.begin','receipt.progress','receipt.extracted','receipt.failed','receipt.draft','receipt.confirm','receipt.move') THEN RAISE EXCEPTION 'shopping_invalid_operation' USING ERRCODE='23514'; END IF;
 state=shopping_private.workflow_lock(p_actor,p_key,p_intent,p_expected);IF state?'replay' THEN RETURN state->'replay'; END IF;
 PERFORM shopping_private.keys(p_decision,ARRAY['action','data'],ARRAY['action','data']);
 IF p_decision->>'action' IS DISTINCT FROM split_part(op,'.',2) OR jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
 IF v?'_projection' THEN PERFORM shopping_private.assert_projection(target,v->'_projection'); END IF;
 IF op='receipt.move' THEN PERFORM shopping_private.assert_projection((v->>'target_list_id')::bigint,v->'_target_projection'); END IF;
 IF op='receipt.draft' THEN
  PERFORM shopping_private.keys(v,ARRAY['attempt','revision','draft'],ARRAY['attempt','revision','draft']);
  result=public.shopping_save_receipt_draft(target,(v->>'attempt')::int,(v->>'revision')::int,v->'draft');
 ELSIF op='receipt.move' THEN result=shopping_private.receipt_move(target,v);
 ELSE
  IF op='receipt.confirm' AND (v->>'_owner')::uuid IS DISTINCT FROM p_actor AND NOT EXISTS(SELECT 1 FROM public.shopping_receipts receipt WHERE receipt.list_id=target AND receipt.state='confirmed') THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  result=shopping_private.apply_receipt(p_actor,target,p_decision->>'action',v);
 END IF;
 -- Retained helper effects are part of the aggregate revision protocol.
 IF (SELECT to_jsonb(r) FROM public.shopping_receipts r WHERE list_id=target) IS DISTINCT FROM (state#>'{facts,receipts,0}') THEN
  UPDATE public.shopping_lists SET revision=revision+1,updated_at=now() WHERE id=target OR (op='receipt.move' AND id=(v->>'target_list_id')::bigint);
  IF op='receipt.confirm' THEN UPDATE shopping_private.catalog_state SET revision=revision+1 WHERE singleton; END IF;
 END IF;
 RETURN shopping_private.workflow_result(p_actor,p_key,p_intent,result);
END $$;
CREATE FUNCTION public.shopping_checkout_commit(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE state jsonb;result jsonb;target bigint=(p_intent->>'id')::bigint;
BEGIN
 IF p_intent->>'operation' IS DISTINCT FROM 'checkout' THEN RAISE EXCEPTION 'shopping_invalid_operation' USING ERRCODE='23514'; END IF;
 state=shopping_private.workflow_lock(p_actor,p_key,p_intent,p_expected);IF state?'replay' THEN RETURN state->'replay'; END IF;
 PERFORM shopping_private.keys(p_intent->'body',ARRAY['category_id','payment_source_id','duplicate_reviewed_ids']);
 PERFORM shopping_private.keys(p_decision,ARRAY['projection'],ARRAY['projection']);
 IF jsonb_typeof(p_decision->'projection') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
 PERFORM shopping_private.assert_projection(target,p_decision->'projection');
 result=shopping_private.checkout_financial(target,(p_intent#>>'{body,category_id}')::bigint,(p_intent#>>'{body,payment_source_id}')::bigint,coalesce(p_intent#>'{body,duplicate_reviewed_ids}','[]'),p_decision->'projection');
 IF result->>'replay'='false' THEN UPDATE public.shopping_lists SET revision=revision+1 WHERE id=target; END IF;
 RETURN shopping_private.workflow_result(p_actor,p_key,p_intent,result);
END $$;
REVOKE ALL ON FUNCTION public.shopping_receipt_commit(uuid,uuid,jsonb,jsonb,jsonb),public.shopping_checkout_commit(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_receipt_commit(uuid,uuid,jsonb,jsonb,jsonb),public.shopping_checkout_commit(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.shopping_lookup_commit(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE state jsonb;v jsonb=p_intent->'body';result jsonb;
BEGIN
 IF coalesce(p_intent->>'operation','') NOT IN ('lookup.claim','lookup.finalize') OR p_key IS NULL THEN RAISE EXCEPTION 'shopping_invalid_operation' USING ERRCODE='23514'; END IF;
 state=shopping_private.workflow_lock(p_actor,p_key,p_intent,p_expected);IF state?'replay' THEN RETURN state->'replay'; END IF;
 PERFORM shopping_private.keys(v,ARRAY['code','provider','environment','lease_id','result'],ARRAY['code','provider','environment','lease_id']);
 PERFORM shopping_private.keys(p_decision,ARRAY['kind','lease_id','expires_at','valid_until','result'],ARRAY['kind','valid_until']);
 IF (p_decision->>'valid_until')::timestamptz IS NULL OR clock_timestamp()>=(p_decision->>'valid_until')::timestamptz THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
 IF p_decision->>'kind'='lookup.result' AND p_intent->>'operation'='lookup.claim' THEN result=p_decision->'result';
 ELSIF p_decision->>'kind'='lookup.claim' AND p_intent->>'operation'='lookup.claim' THEN
  IF (p_decision->>'lease_id')::uuid IS DISTINCT FROM (v->>'lease_id')::uuid THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  INSERT INTO public.shopping_product_lookup_cache(code,provider,environment,result,expires_at,lease_id) VALUES(v->>'code',v->>'provider',v->>'environment','{"status":"pending"}',(p_decision->>'expires_at')::timestamptz,(v->>'lease_id')::uuid)
   ON CONFLICT(provider,environment,code) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at,lease_id=excluded.lease_id,requested_at=now();
  result=jsonb_build_object('claimed',true,'lease_id',v->>'lease_id');
 ELSIF p_decision->>'kind'='lookup.finalize' AND p_intent->>'operation'='lookup.finalize' THEN
  IF p_decision->'result' IS DISTINCT FROM v->'result' OR (p_decision->>'lease_id')::uuid IS DISTINCT FROM (v->>'lease_id')::uuid THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
  UPDATE public.shopping_product_lookup_cache SET result=p_decision->'result',expires_at=(p_decision->>'expires_at')::timestamptz
   WHERE code=v->>'code' AND provider=v->>'provider' AND environment=v->>'environment' AND lease_id=(v->>'lease_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'shopping_revision_stale'; END IF;
  result=p_decision->'result';
 ELSE RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
 RETURN shopping_private.workflow_result(p_actor,p_key,p_intent,result);
END $$;
REVOKE ALL ON FUNCTION public.shopping_lookup_commit(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_lookup_commit(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;

-- Existing 062 catalog primitive is preserved; dispatch only the newly typed effects.
ALTER FUNCTION public.shopping_catalog_commit(uuid,uuid,jsonb,jsonb,jsonb) SET SCHEMA shopping_private;
ALTER FUNCTION shopping_private.shopping_catalog_commit(uuid,uuid,jsonb,jsonb,jsonb) RENAME TO catalog_commit_062;
CREATE FUNCTION public.shopping_catalog_commit(p_actor uuid,p_key uuid,p_intent jsonb,p_expected jsonb,p_decision jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET lock_timeout='3s' SET statement_timeout='15s' AS $$
DECLARE op text=p_intent->>'operation';v jsonb=p_decision->'values';target bigint=(p_intent->>'id')::bigint;state jsonb;result jsonb;
BEGIN
 IF op NOT IN ('type.create','type.edit','type.deactivate','entry.category') THEN RETURN shopping_private.catalog_commit_062(p_actor,p_key,p_intent,p_expected,p_decision); END IF;
 state=shopping_private.workflow_lock(p_actor,p_key,p_intent,p_expected);IF state?'replay' THEN RETURN state->'replay'; END IF;
 PERFORM shopping_private.keys(p_decision,ARRAY['kind','values','list_type_id'],ARRAY['kind','values']);
 IF p_decision->>'kind' IS DISTINCT FROM op THEN RAISE EXCEPTION 'shopping_invalid_effect' USING ERRCODE='23514'; END IF;
 IF op='entry.category' THEN
  PERFORM shopping_private.keys(v,ARRAY['name','icon','parent_id','is_active','is_neutral','display_order'],ARRAY['name','parent_id','is_active','is_neutral','display_order']);
  INSERT INTO public.shopping_catalog_categories(name,icon,parent_id,is_active,display_order) VALUES(v->>'name',v->>'icon',(v->>'parent_id')::bigint,(v->>'is_active')::boolean,(v->>'display_order')::int) RETURNING to_jsonb(shopping_catalog_categories) INTO result;
  INSERT INTO public.shopping_catalog_category_list_types(category_id,list_type_id) VALUES((result->>'id')::bigint,(p_decision->>'list_type_id')::bigint);
  UPDATE public.shopping_list_types SET revision=revision+1 WHERE id=(p_decision->>'list_type_id')::bigint;
 ELSE
  PERFORM shopping_private.keys(v,ARRAY['name','slug','is_active']);
  IF op='type.create' THEN
   INSERT INTO public.shopping_list_types(name,slug,is_active) VALUES(v->>'name',v->>'slug',(v->>'is_active')::boolean) RETURNING id INTO target;
   INSERT INTO public.shopping_catalog_category_list_types(category_id,list_type_id) VALUES(-1,target);
  ELSE
   UPDATE public.shopping_list_types SET name=CASE WHEN v?'name' THEN v->>'name' ELSE name END,slug=CASE WHEN v?'slug' THEN v->>'slug' ELSE slug END,is_active=CASE WHEN v?'is_active' THEN (v->>'is_active')::boolean ELSE is_active END,revision=revision+1 WHERE id=target;
   IF NOT FOUND THEN RAISE EXCEPTION 'shopping_list_type_missing'; END IF;
  END IF;
  SELECT to_jsonb(t) INTO result FROM public.shopping_list_types t WHERE id=target;
 END IF;
 UPDATE shopping_private.catalog_state SET revision=revision+1 WHERE singleton;
 RETURN shopping_private.workflow_result(p_actor,p_key,p_intent,result,CASE WHEN op IN ('type.create','entry.category') THEN 201 ELSE 200 END);
END $$;
REVOKE ALL ON FUNCTION public.shopping_catalog_commit(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_catalog_commit(uuid,uuid,jsonb,jsonb,jsonb) TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA shopping_private FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
