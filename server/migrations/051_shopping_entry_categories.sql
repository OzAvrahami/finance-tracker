-- Extend 050 with atomic typed-category resolution. No historical row rewrites.
BEGIN;
CREATE FUNCTION public.shopping_category_display(p_name text) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path=public AS $$
 SELECT trim(regexp_replace(normalize(p_name,NFKC),
 U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'));
$$;
CREATE FUNCTION public.shopping_category_key(p_name text) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path=public AS $$
 SELECT translate(shopping_category_display(p_name),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
$$;

-- Serialize new normalized names, including writes from the legacy category API.
-- Do not merge/rewrite existing normalization collisions: explicit selection is
-- required when more than one existing identity matches within a scope.
CREATE FUNCTION public.shopping_category_write_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name THEN RETURN NEW; END IF;
 NEW.name:=shopping_category_display(NEW.name);
 IF NEW.name IS NULL OR NEW.name='' THEN RAISE EXCEPTION 'shopping_category_name_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(shopping_category_key(NEW.name),510051));
 IF EXISTS(SELECT 1 FROM shopping_catalog_categories WHERE shopping_category_key(name)=shopping_category_key(NEW.name) AND id IS DISTINCT FROM NEW.id)
 THEN RAISE EXCEPTION 'shopping_category_exists' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shopping_category_name_guard BEFORE INSERT OR UPDATE OF name ON public.shopping_catalog_categories
 FOR EACH ROW EXECUTE FUNCTION public.shopping_category_write_guard();

CREATE FUNCTION public.shopping_resolve_entry_category(p_type bigint,p_name text) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE display text:=shopping_category_display(p_name); key text:=shopping_category_key(p_name); ids bigint[]; cat bigint;
BEGIN
 IF display IS NULL OR length(display) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'shopping_category_name_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(key,510051));
 SELECT array_agg(c.id ORDER BY c.id) INTO ids FROM shopping_catalog_categories c
 JOIN shopping_catalog_category_list_types ct ON ct.category_id=c.id
 WHERE ct.list_type_id=p_type AND (c.is_active OR c.is_neutral) AND shopping_category_key(c.name)=key;
 IF cardinality(ids)>1 THEN RAISE EXCEPTION 'shopping_category_ambiguous'; END IF;
 IF cardinality(ids)=1 THEN RETURN ids[1]; END IF;
 -- A global unique name cannot be cloned or silently linked to another list type.
 IF EXISTS(SELECT 1 FROM shopping_catalog_categories WHERE shopping_category_key(name)=key)
 THEN RAISE EXCEPTION 'shopping_category_scope'; END IF;
 INSERT INTO shopping_catalog_categories(name) VALUES(display) RETURNING id INTO cat;
 INSERT INTO shopping_catalog_category_list_types(category_id,list_type_id) VALUES(cat,p_type);
 RETURN cat;
END $$;

CREATE OR REPLACE FUNCTION public.shopping_add_planned_item(p_list bigint,p_item jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l shopping_lists; c shopping_catalog_items; result shopping_list_items; category shopping_catalog_categories;
 cat bigint; v_name text:=trim(p_item->>'custom_name');
 qty numeric:=COALESCE(NULLIF(p_item->>'quantity','')::numeric,1);
 v_unit text:=NULLIF(trim(p_item->>'unit'),''); v_price numeric:=NULLIF(p_item->>'price','')::numeric;
 reusable boolean:=COALESCE((p_item->>'save_to_catalog')::boolean,false);
 category_name text:=shopping_category_display(p_item->>'category_name');
BEGIN
 SELECT * INTO l FROM shopping_lists WHERE id=p_list FOR UPDATE;
 IF l.id IS NULL THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 IF l.status NOT IN ('draft','active') OR EXISTS(SELECT 1 FROM shopping_checkouts WHERE list_id=p_list)
 THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
 IF NULLIF(p_item->>'catalog_item_id','') IS NOT NULL THEN
   SELECT * INTO c FROM shopping_catalog_items WHERE id=(p_item->>'catalog_item_id')::bigint AND is_active;
   IF c.id IS NULL THEN RAISE EXCEPTION 'shopping_catalog_missing'; END IF;
   cat:=c.category_id;
   IF NOT p_item ? 'unit' THEN v_unit:=c.default_unit; END IF;
   IF NOT p_item ? 'price' THEN v_price:=c.default_price; END IF;
   IF p_item->>'unit_mode'='controlled' AND p_item->>'unit'=c.default_unit THEN v_unit:=c.default_unit; END IF;
 ELSE
   IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'shopping_item_name_required'; END IF;
 END IF;
 -- Validate the entire item before resolving/creating any category.
 IF qty<=0 OR qty>10000 OR qty::text IN ('NaN','Infinity','-Infinity') OR
 (v_price IS NOT NULL AND (v_price<0 OR v_price>100000000 OR v_price::text IN ('NaN','Infinity','-Infinity'))) OR
 (length(COALESCE(v_unit,''))>30 AND NOT (COALESCE(p_item->>'unit_mode','')='controlled' AND c.id IS NOT NULL AND v_unit=c.default_unit)) OR length(COALESCE(p_item->>'notes',''))>2000 OR
 (p_item->>'planned_name' IS NOT NULL AND length(trim(p_item->>'planned_name')) NOT BETWEEN 1 AND 300)
 THEN RAISE EXCEPTION 'shopping_item_invalid'; END IF;
 IF p_item ? 'category_name' AND jsonb_typeof(p_item->'category_name') NOT IN ('string','null') THEN RAISE EXCEPTION 'shopping_category_name_invalid'; END IF;
 IF p_item->>'unit_mode'='controlled' THEN
   IF qty<>round(qty,3) THEN RAISE EXCEPTION 'shopping_item_invalid'; END IF;
   IF v_unit IS NULL OR (v_unit NOT IN ('unit','kg','g','l','ml','pack','pair') AND
     (c.id IS NULL OR v_unit IS DISTINCT FROM c.default_unit)) THEN RAISE EXCEPTION 'shopping_unit_invalid'; END IF;
 END IF;
 IF c.id IS NULL THEN
   cat:=NULLIF(p_item->>'category_id','')::bigint;
   IF cat IS NULL AND NULLIF(category_name,'') IS NOT NULL THEN
     cat:=shopping_resolve_entry_category(l.list_type_id,category_name);
   END IF;
   IF cat IS NULL THEN
     SELECT id INTO cat FROM shopping_catalog_categories WHERE is_neutral;
     IF cat IS NULL THEN RAISE EXCEPTION 'shopping_neutral_missing'; END IF;
     INSERT INTO shopping_catalog_category_list_types(category_id,list_type_id) VALUES(cat,l.list_type_id) ON CONFLICT DO NOTHING;
   END IF;
 END IF;
 SELECT * INTO category FROM shopping_catalog_categories WHERE id=cat;
 IF NOT EXISTS(SELECT 1 FROM shopping_catalog_category_list_types ct
   WHERE ct.category_id=cat AND ct.list_type_id=l.list_type_id AND (category.is_active OR category.is_neutral))
 THEN RAISE EXCEPTION 'shopping_category_scope'; END IF;
 IF c.id IS NULL AND reusable THEN
   INSERT INTO shopping_catalog_items(category_id,name,default_unit,default_price)
    VALUES(cat,v_name,v_unit,v_price) RETURNING * INTO c;
 END IF;
 INSERT INTO shopping_list_items(list_id,catalog_item_id,custom_name,category_id,quantity,unit,price,notes,planned_name)
 VALUES(p_list,c.id,CASE WHEN c.id IS NULL THEN v_name ELSE NULL END,cat,qty,v_unit,v_price,NULLIF(trim(p_item->>'notes'),''),NULLIF(trim(p_item->>'planned_name'),''))
 RETURNING * INTO result;
 UPDATE shopping_lists SET updated_at=now() WHERE id=p_list;
 RETURN to_jsonb(result)||jsonb_build_object('shopping_catalog_categories',to_jsonb(category));
END $$;
REVOKE ALL ON FUNCTION public.shopping_category_display(text),public.shopping_category_key(text),
 public.shopping_category_write_guard(),public.shopping_resolve_entry_category(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_category_display(text),public.shopping_category_key(text),
 public.shopping_resolve_entry_category(bigint,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
