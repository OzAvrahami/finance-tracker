'use strict';
// Existing public synthetic cutover fixture; no production rows.
const { approvedFixture } = require('../../modules/shopping/list-types/fixtures/approvedTaxonomy');
const { quote } = require('../../scripts/shoppingProductionBundle');
function seed(env) {
  const f = approvedFixture();
  const ids = new Map(f.categories.map((c, i) => [String(c.id), c.is_neutral ? -1 : i === 0 ? 1 : 1000 + i]));
  const target = f.categories.map(c => ({ id: ids.get(String(c.id)), name: c.name,
    parent: c.parent_id === null ? null : ids.get(String(c.parent_id)), active: true }));
  for (let i = 2; i <= 26; i++) target.push({ id: i, name: `Synthetic history ${i}`, parent: null, active: false });
  const rows = f.products.map((p, i) => ({ id: i + 1, old: 1 + i % 26, target: ids.get(String(p.category_id)) }));
  const links = f.links.map(l => `(${ids.get(String(l.category_id))},${l.list_type_id})`);
  for (let i = 1; i <= 6; i++) links.push(`(-1,${i})`);
  env.sql(`INSERT INTO shopping_list_types(id,name,slug) SELECT i,'Synthetic type '||i,'synthetic-'||i FROM generate_series(1,6)i;
    INSERT INTO shopping_catalog_categories(id,name) VALUES ${target.filter(c => c.id >= 1 && c.id <= 26).map(c => `(${c.id},${quote(c.name)})`).join(',')};
    INSERT INTO shopping_catalog_items(id,name,category_id,default_price,default_unit) VALUES ${rows.map(r => `(${r.id},'Synthetic product ${r.id}',${r.old},0,'unit')`).join(',')};
    INSERT INTO shopping_lists(id,title,list_type_id) VALUES(1,'Synthetic retained list',1);
    INSERT INTO shopping_list_items(id,list_id,catalog_item_id,category_id,quantity,unit,price,is_purchased,purchased_at,notes)
    SELECT i,1,i,1,1.25,'unit',0,i<=50,CASE WHEN i<=50 THEN '2026-01-02 12:34:56.123456Z'::timestamptz END,'Synthetic retained note' FROM generate_series(1,85)i;
    INSERT INTO shopping_purchase_plans(list_id,items) VALUES(1,'[{"catalog_item_id":1,"category_id":1,"price":0}]');
    INSERT INTO shopping_receipts(list_id,image_hash,image_hashes,state,extracted,review_draft) VALUES(1,repeat('a',64),ARRAY[repeat('a',64)],'review','{"identity":{"merchant":"Synthetic"}}','{"items":[]}');
    INSERT INTO transactions(description,total_amount,movement_type,transaction_date,charge_date) VALUES('Synthetic retained financial identity',12.34,'expense','2026-01-01','2026-01-01');
    SELECT setval(pg_get_serial_sequence('shopping_lists','id'),1);
    GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON shopping_lists TO service_role;
    GRANT USAGE,SELECT ON SEQUENCE shopping_lists_id_seq TO service_role;`);
  return `CREATE TEMP TABLE shopping_mapping_categories(id bigint PRIMARY KEY,name text,parent_id bigint,is_active boolean);
    CREATE TEMP TABLE shopping_mapping_products(id bigint PRIMARY KEY,category_id bigint);
    CREATE TEMP TABLE shopping_mapping_links(category_id bigint,list_type_id bigint,PRIMARY KEY(category_id,list_type_id));
    INSERT INTO shopping_mapping_categories VALUES ${target.map(c => `(${c.id},${quote(c.name)},${c.parent ?? 'NULL'},${c.active})`).join(',')};
    INSERT INTO shopping_mapping_products VALUES ${rows.map(r => `(${r.id},${r.target})`).join(',')};
    INSERT INTO shopping_mapping_links VALUES ${links.join(',')};`;
}

module.exports = { seed };
