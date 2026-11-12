// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createCatalogPreview, shoppingPreviewPlugin } from './catalogPreview';
import { createServer } from 'node:http';
import { commandRoute } from '../services/catalogApi';

async function execute(preview, operation, id, body, etag = preview.view().etag, key = randomUUID()) {
  const [method, path] = commandRoute(operation, id);
  return preview.handle(method, path, body, { 'If-Match': etag, 'Idempotency-Key': key });
}
describe('isolated synthetic adapter using the existing server domain', () => {
  it('serves only explicit loopback preview requests and rejects cross-origin or missing markers', async () => {
    let handler;
    const plugin = shoppingPreviewPlugin();
    expect(plugin.apply).toBe('serve');
    plugin.configureServer({ middlewares: { use: (_path, fn) => { handler = fn; } } });
    const server = createServer((req, res) => handler(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/snapshot`;
    try {
      expect((await fetch(url)).status).toBe(403);
      expect((await fetch(url, { headers: { 'X-Shopping-Preview': 'synthetic-only', Origin: 'https://untrusted.example' } })).status).toBe(403);
      const allowed = await fetch(url, { headers: { 'X-Shopping-Preview': 'synthetic-only' } });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('Cache-Control')).toBe('no-store');
      expect(allowed.headers.get('X-Shopping-Preview')).toBe('synthetic-only');
      expect((await allowed.json()).mode).toBe('preview');
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  it('derives all six approved default counts and contains no private products', () => {
    const data = createCatalogPreview().view();
    expect([data.categories.length, data.products.length, data.links.length]).toEqual([99, 173, 21]);
    expect(Object.values(data.visibility).map(v => [v.category_ids.length, v.product_ids.length])).toEqual([[57,144],[11,19],[1,1],[10,21],[9,12],[11,21]]);
    expect(data.products.every(p => p.name.startsWith('מוצר הדגמה'))).toBe(true);
  });
  it('creates/renames/reparents roots with stable identities and rejects sibling collisions', async () => {
    const p = createCatalogPreview();
    const result = await execute(p, 'category.create', null, { name: 'ניסוי', parent_id: null });
    const id = result.result.id;
    await execute(p, 'category.change', id, { type: 'rename', name: 'חדש' });
    await execute(p, 'category.change', id, { type: 'reparent', parent_id: '10001' });
    expect(p.view().categories.find(c => c.id === id).path.map(c => c.name)).toEqual(['מזון ומשקאות', 'חדש']);
    await expect(execute(p, 'category.create', null, { name: 'חדש', parent_id: '10001' })).rejects.toMatchObject({ code: 'shopping_category_sibling_duplicate' });
  });
  it('protects neutral and rejects descendant reparenting', async () => {
    const p = createCatalogPreview();
    await expect(execute(p, 'category.change', '-99', { type: 'deactivate' })).rejects.toMatchObject({ code: 'shopping_neutral_protected' });
    await expect(execute(p, 'category.change', '10001', { type: 'reparent', parent_id: '10002' })).rejects.toMatchObject({ code: 'shopping_category_cycle' });
  });
  it('preserves history and hides descendants after parent deactivation without rewriting flags', async () => {
    const p = createCatalogPreview();
    await execute(p, 'category.change', '10001', { type: 'deactivate' });
    const data = p.view();
    expect(data.categories.find(c => c.id === '10002')).toMatchObject({ is_active: true, effective_active: false });
    expect(data.categories.filter(c => c.historical)).toHaveLength(25);
    expect(data.products).toHaveLength(173);
  });
  it('replays exact keys once and rejects changed payload and stale revisions', async () => {
    const p = createCatalogPreview(), etag = p.view().etag, key = randomUUID();
    const body = { name: 'יצירה', parent_id: null };
    await execute(p, 'category.create', null, body, etag, key);
    expect((await execute(p, 'category.create', null, body, etag, key)).replayed).toBe(true);
    expect(p.view().categories).toHaveLength(100);
    await expect(execute(p, 'category.create', null, { ...body, name: 'אחר' }, etag, key)).rejects.toMatchObject({ code: 'shopping_key_conflict' });
    await expect(execute(p, 'category.change', '10001', { type: 'rename', name: 'אחר' }, etag)).rejects.toMatchObject({ code: 'shopping_revision_stale' });
  });
  it('validates all 100 products before changing any and preserves zero', async () => {
    const p = createCatalogPreview(), before = JSON.stringify(p.view());
    const ids = p.view().products.slice(0, 99).map(p => p.id).concat('9999999');
    await expect(execute(p, 'product.bulk-category', null, { product_ids: ids, category_id: '-99' })).rejects.toMatchObject({ code: 'shopping_product_missing' });
    expect(JSON.stringify(p.view())).toBe(before);
    await execute(p, 'product.edit', '100001', { default_price: '0' });
    expect(p.view().products[0].default_price).toBe('0');
    await expect(execute(p, 'product.bulk-category', null, { product_ids: p.view().products.slice(0,101).map(p => p.id), category_id: '-99' })).rejects.toThrow();
  });
  it('previews overlapping branches without duplicates or mutation and saves an empty ordinary mapping', async () => {
    const p = createCatalogPreview(), before = JSON.stringify(p.view());
    const result = await p.handle('POST', '/visibility-preview/1', { categoryIds: ['10001','10002'] });
    expect(result.category_ids.length).toBe(new Set(result.category_ids).size);
    expect(result.product_ids.length).toBe(118);
    expect(JSON.stringify(p.view())).toBe(before);
    await execute(p, 'branches.replace', '1', { categoryIds: [] });
    expect(p.view().visibility['1'].category_ids).toEqual(['-99']);
  });
});
