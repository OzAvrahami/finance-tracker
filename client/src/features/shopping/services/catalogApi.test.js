import { describe, expect, it, vi } from 'vitest';
import { CatalogError, createPreviewApi } from './catalogApi';

const response = (data, status = 200, marker = 'synthetic-only') => ({ ok: status < 400, status, json: async () => data, headers: new Headers({ 'X-Shopping-Preview': marker }) });
const local = { hostname: 'localhost' };
describe('preview-only HTTP boundary', () => {
  it.each([{}, { enabled: true, location: { hostname: 'production.example' } }, { enabled: false, location: local }])('fails closed outside an explicit local preview (%j)', options => {
    expect(() => createPreviewApi(options)).toThrow();
  });
  it('sends fixed preview prefix, no credentials, exact strong revision and stable replay key', async () => {
    const transport = vi.fn().mockResolvedValue(response({ committed: true }));
    const api = createPreviewApi({ enabled: true, location: local, transport });
    const command = api.prepare('product.edit', '10', { default_price: '0' }, '"token"');
    await api.send(command); await api.send(command);
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
    expect(transport.mock.calls[0][0]).toBe('/__shopping-preview/api/settings/shopping/catalog-items/10');
    expect(transport.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { 'If-Match': '"token"', 'Idempotency-Key': command.headers['Idempotency-Key'] } });
  });
  it.each([[401,'shopping_unauthenticated'],[403,'shopping_forbidden'],[409,'shopping_revision_stale'],[428,'shopping_precondition_required']])('translates HTTP %s without automatic retry', async (status, code) => {
    const transport = vi.fn().mockResolvedValue(response({ code }, status));
    const api = createPreviewApi({ enabled: true, location: local, transport });
    await expect(api.read()).rejects.toMatchObject({ code, status, uncertain: false });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not accept an unmarked live response or silently retry network errors', async () => {
    const transport = vi.fn().mockResolvedValueOnce(response({}, 200, '')).mockRejectedValueOnce(new Error('network'));
    const api = createPreviewApi({ enabled: true, location: local, transport });
    await expect(api.read()).rejects.toBeInstanceOf(CatalogError);
    await expect(api.read()).rejects.toMatchObject({ uncertain: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
