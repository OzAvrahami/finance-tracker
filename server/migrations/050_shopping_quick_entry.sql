-- Name-first planning. Forward-only; no changes to historical plans or financial data.
BEGIN;
ALTER TABLE public.shopping_list_items ADD COLUMN planned_name text
 CHECK(planned_name IS NULL OR length(trim(planned_name)) BETWEEN 1 AND 300);

-- A stable system identity, independent of the displayed category name.
ALTER TABLE public.shopping_catalog_categories ADD COLUMN is_neutral boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX shopping_one_neutral_category ON public.shopping_catalog_categories(is_neutral) WHERE is_neutral;
-- Reserve a negative system ID; leave the positive owner category sequence untouched.
INSERT INTO public.shopping_catalog_categories(id,name,is_neutral) VALUES(-1,'ללא קטגוריה',true)
 ON CONFLICT(name) DO UPDATE SET is_neutral=true;
INSERT INTO public.shopping_catalog_category_list_types(category_id,list_type_id)
 SELECT c.id,t.id FROM public.shopping_catalog_categories c CROSS JOIN public.shopping_list_types t
 WHERE c.is_neutral ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.shopping_snapshot(p_list bigint) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('list_item_id',i.id::text,'catalog_item_id',i.catalog_item_id::text,
 'notes',i.notes,'name',COALESCE(i.planned_name,c.name,i.custom_name),'quantity',COALESCE(i.quantity,1)::text,
 'unit',COALESCE(i.unit,'יח׳'),'price',i.price::text,'is_purchased',i.is_purchased) ORDER BY i.id),'[]')
 FROM shopping_list_items i LEFT JOIN shopping_catalog_items c ON c.id=i.catalog_item_id WHERE i.list_id=p_list;
$$;

-- New opt-in contract; existing add-item callers keep their existing behavior.
-- Catalog creation, fallback scoping and the list insertion succeed or roll back together.
CREATE FUNCTION public.shopping_add_planned_item(p_list bigint,p_item jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l shopping_lists; c shopping_catalog_items; result shopping_list_items;
 cat bigint; v_name text:=trim(p_item->>'custom_name');
 qty numeric:=COALESCE(NULLIF(p_item->>'quantity','')::numeric,1);
 v_unit text:=NULLIF(trim(p_item->>'unit'),''); v_price numeric:=NULLIF(p_item->>'price','')::numeric;
BEGIN
 SELECT * INTO l FROM shopping_lists WHERE id=p_list FOR UPDATE;
 IF l.id IS NULL THEN RAISE EXCEPTION 'shopping_list_missing'; END IF;
 IF l.status NOT IN ('draft','active') OR EXISTS(SELECT 1 FROM shopping_checkouts WHERE list_id=p_list)
 THEN RAISE EXCEPTION 'shopping_list_closed'; END IF;
 IF qty<=0 OR qty>10000 OR qty::text IN ('NaN','Infinity','-Infinity') OR
 (v_price IS NOT NULL AND (v_price<0 OR v_price>100000000 OR v_price::text IN ('NaN','Infinity','-Infinity'))) OR
 length(COALESCE(v_unit,''))>30 OR length(COALESCE(p_item->>'notes',''))>2000 OR
 (p_item->>'planned_name' IS NOT NULL AND length(trim(p_item->>'planned_name')) NOT BETWEEN 1 AND 300)
 THEN RAISE EXCEPTION 'shopping_item_invalid'; END IF;
 IF NULLIF(p_item->>'catalog_item_id','') IS NOT NULL THEN
   SELECT * INTO c FROM shopping_catalog_items WHERE id=(p_item->>'catalog_item_id')::bigint AND is_active;
   IF c.id IS NULL THEN RAISE EXCEPTION 'shopping_catalog_missing'; END IF;
   cat:=c.category_id;
   -- Only omitted defaults are inherited; explicit null clears the estimate/unit.
   IF NOT p_item ? 'unit' THEN v_unit:=c.default_unit; END IF;
   IF NOT p_item ? 'price' THEN v_price:=c.default_price; END IF;
 ELSE
   IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'shopping_item_name_required'; END IF;
   cat:=NULLIF(p_item->>'category_id','')::bigint;
   IF cat IS NULL THEN
     SELECT id INTO cat FROM shopping_catalog_categories WHERE is_neutral;
     IF cat IS NULL THEN RAISE EXCEPTION 'shopping_neutral_missing'; END IF;
     -- Also covers types created after this migration, without owner setup.
     INSERT INTO shopping_catalog_category_list_types(category_id,list_type_id) VALUES(cat,l.list_type_id) ON CONFLICT DO NOTHING;
   END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM shopping_catalog_category_list_types ct JOIN shopping_catalog_categories cc ON cc.id=ct.category_id
   WHERE ct.category_id=cat AND ct.list_type_id=l.list_type_id AND (cc.is_active OR cc.is_neutral))
 THEN RAISE EXCEPTION 'shopping_category_scope'; END IF;
 IF c.id IS NULL AND COALESCE((p_item->>'save_to_catalog')::boolean,false) THEN
   -- A collision must be resolved by selecting the existing suggestion, never by overwriting it.
   INSERT INTO shopping_catalog_items(category_id,name,default_unit,default_price)
    VALUES(cat,v_name,v_unit,v_price) RETURNING * INTO c;
 END IF;
 INSERT INTO shopping_list_items(list_id,catalog_item_id,custom_name,category_id,quantity,unit,price,notes,planned_name)
 VALUES(p_list,c.id,CASE WHEN c.id IS NULL THEN v_name ELSE NULL END,cat,qty,v_unit,v_price,NULLIF(trim(p_item->>'notes'),''),NULLIF(trim(p_item->>'planned_name'),''))
 RETURNING * INTO result;
 UPDATE shopping_lists SET updated_at=now() WHERE id=p_list;
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.shopping_add_planned_item(bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shopping_add_planned_item(bigint,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
