import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShoppingCatalogAdmin from './ShoppingCatalogAdmin';
import { createCatalogPreview } from '../preview/catalogPreview';
import { CatalogError, createPreviewApi } from '../services/catalogApi';

function setup() {
  const model = createCatalogPreview();
  const api = createPreviewApi({ enabled: true, location: { hostname: 'localhost' }, transport: async (url, options) => {
    let status = 200, result;
    try { result = await model.handle(options.method, url.replace('/__shopping-preview/api', ''), options.body ? JSON.parse(options.body) : undefined, options.headers); }
    catch (error) { status = 409; result = { code: error.code }; }
    return { ok: status === 200, status, headers: new Headers({ 'X-Shopping-Preview': 'synthetic-only' }), json: async () => JSON.parse(JSON.stringify(result)) };
  } });
  const adapter = { ...api, send: vi.fn(api.send), read: vi.fn(api.read) };
  render(<ShoppingCatalogAdmin adapter={adapter} />);
  return { model, adapter, user: userEvent.setup() };
}
const dialog = () => within(screen.getByRole('dialog'));
const ready = () => screen.findByRole('button', { name: 'קטגוריה חדשה' });
const tab = name => fireEvent.click(screen.getByRole('tab', { name }));
beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); });

describe('Shopping catalog administration', () => {
  it('shows an explicit synthetic banner, RTL layout and shared keyboard tabs', async () => {
    setup(); await ready();
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(/נתונים מלאכותיים/)).toBeVisible();
    const first = screen.getByRole('tab', { name: 'קטגוריות' }); first.focus();
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'מוצרים' })).toHaveFocus();
  });
  it('creates a root category and retains stable category details', async () => {
    const { user, model } = setup(); await user.click(await ready());
    await user.type(dialog().getByRole('textbox', { name: 'שם הקטגוריה' }), 'בדיקת ממשק');
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(model.view().categories.some(c => c.name === 'בדיקת ממשק' && c.parent_id === null)).toBe(true);
  });
  it('keeps a duplicate sibling draft with meaningful server feedback', async () => {
    const { user } = setup(); await user.click(await ready());
    await user.type(dialog().getByRole('textbox', { name: 'שם הקטגוריה' }), 'מזון ומשקאות');
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    expect(await dialog().findByText(/כבר קיימת קטגוריה בשם זה/)).toBeVisible();
    expect(dialog().getByRole('textbox', { name: 'שם הקטגוריה' })).toHaveValue('מזון ומשקאות');
  });
  it('keeps the original draft revision when focus refresh discovers another writer', async () => {
    const { user, model, adapter } = setup(); await user.click(await ready());
    await user.type(dialog().getByRole('textbox', { name: 'שם הקטגוריה' }), 'טיוטה ישנה');
    const original = model.view().etag;
    await model.handle('POST', '/settings/shopping/catalog-categories', { name: 'כותב אחר', parent_id: null }, { 'If-Match': original, 'Idempotency-Key': crypto.randomUUID() });
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(adapter.read.mock.calls.length).toBeGreaterThan(1));
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    expect(await dialog().findByText(/הקטלוג השתנה/)).toBeVisible();
    expect(adapter.send.mock.calls[0][0].headers['If-Match']).toBe(original);
    expect(model.view().categories.some(c => c.name === 'טיוטה ישנה')).toBe(false);
  });
  it('excludes self, descendants and neutral from reparent selection and renames explicitly', async () => {
    const { user } = setup(); await ready();
    await user.click(screen.getByRole('treeitem', { name: /מזון ומשקאות/ }));
    await user.click(screen.getByRole('button', { name: 'העברה להורה אחר' }));
    const parent = dialog().getByLabelText('קטגוריית הורה');
    expect([...parent.options].some(o => ['10001','10002','-99'].includes(o.value))).toBe(false);
    await user.click(dialog().getByRole('button', { name: 'ביטול' }));
    await user.click(screen.getByRole('button', { name: 'שינוי שם' }));
    expect(dialog().getByRole('textbox', { name: 'שם הקטגוריה' })).toHaveValue('מזון ומשקאות');
  });
  it('hides history by default and protects the neutral category', async () => {
    const { user } = setup(); await ready();
    expect(screen.queryByRole('treeitem', { name: /היסטורית/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('מצב קטגוריות'), 'historical');
    expect(screen.getAllByRole('treeitem')).toHaveLength(25);
    await user.selectOptions(screen.getByLabelText('מצב קטגוריות'), 'active');
    await user.click(screen.getByRole('treeitem', { name: /ללא קטגוריה/ }));
    expect(screen.getByText(/קטגוריה ניטרלית מוגנת/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'השבתת קטגוריה' })).not.toBeInTheDocument();
  });
  it('preserves the draft on stale revision, requires refresh/review and uses a new key only afterward', async () => {
    const { user, adapter } = setup(); await user.click(await ready());
    await user.type(dialog().getByRole('textbox', { name: 'שם הקטגוריה' }), 'טיוטה שמורה');
    adapter.send.mockRejectedValueOnce(new CatalogError('shopping_revision_stale', 409));
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    expect(await dialog().findByText(/הקטלוג השתנה/)).toBeVisible();
    expect(dialog().getByRole('button', { name: 'שמירה בהדגמה' })).toBeDisabled();
    await user.click(dialog().getByRole('button', { name: /רענון לבדיקה/ }));
    await waitFor(() => expect(dialog().getByRole('button', { name: 'שמירה בהדגמה' })).toBeEnabled());
    expect(dialog().getByRole('textbox', { name: 'שם הקטגוריה' })).toHaveValue('טיוטה שמורה');
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(adapter.send.mock.calls[0][0].headers['Idempotency-Key']).not.toBe(adapter.send.mock.calls[1][0].headers['Idempotency-Key']);
  });
  it('retries unknown outcomes with identical request and disables draft editing until resolved', async () => {
    const { user, adapter } = setup(); await user.click(await ready());
    await user.type(dialog().getByRole('textbox', { name: 'שם הקטגוריה' }), 'ניסיון חוזר');
    adapter.send.mockRejectedValueOnce(new CatalogError('shopping_network_unknown'));
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    const retry = await dialog().findByRole('button', { name: 'ניסיון חוזר לאותה בקשה' });
    expect(dialog().getByRole('textbox', { name: 'שם הקטגוריה' })).toBeDisabled();
    await user.click(retry);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(adapter.send.mock.calls[0][0]).toEqual(adapter.send.mock.calls[1][0]);
  });
  it('surfaces authorization denial without optimistic changes or draft loss', async () => {
    const { user, adapter, model } = setup(); await user.click(await ready());
    await user.type(dialog().getByRole('textbox', { name: 'שם הקטגוריה' }), 'אין הרשאה');
    adapter.send.mockRejectedValueOnce(new CatalogError('shopping_forbidden', 403));
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    expect(await dialog().findByText(/אין הרשאה לפעולה/)).toBeVisible();
    expect(model.view().categories).toHaveLength(99);
  });
  it('protects unsaved dialog changes on cancel, Escape and browser navigation', async () => {
    const { user } = setup(); await user.click(await ready());
    await user.type(dialog().getByRole('textbox', { name: 'שם הקטגוריה' }), 'לא לאבד');
    window.confirm.mockReturnValue(false);
    await user.click(dialog().getByRole('button', { name: 'ביטול' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.keyboard('{Escape}'); expect(screen.getByRole('dialog')).toBeVisible();
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  });
  it('edits products including zero price, filters by neutral and reviews duplicates without merging', async () => {
    const { user, model } = setup(); await ready(); tab('מוצרים');
    await user.click(screen.getByRole('button', { name: 'עריכת מוצר 100001' }));
    expect(dialog().getByLabelText('מחיר ברירת מחדל')).toHaveValue('0');
    await user.clear(dialog().getByRole('textbox', { name: 'שם המוצר' })); await user.type(dialog().getByRole('textbox', { name: 'שם המוצר' }), 'שם הדגמה חדש');
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(model.view().products[0].default_price).toBe('0');
    await user.click(screen.getByRole('button', { name: 'ללא קטגוריה' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(model.view().products).toHaveLength(173);
  });
  it('enforces the 100-product UI limit and bulk reassignment is explicit', async () => {
    const { user, adapter } = setup(); await ready(); tab('מוצרים');
    await user.click(screen.getByRole('button', { name: 'בחירת עד 100 תוצאות' }));
    expect(screen.getByText(/הגעתם למגבלת 100/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'שיוך קבוצתי' }));
    await user.selectOptions(dialog().getByRole('combobox', { name: 'קטגוריית יעד' }), '-99');
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(adapter.send.mock.calls[0][0].body.product_ids).toHaveLength(100);
  });
  it('creates and reassigns a product through the approved fields only', async () => {
    const { user, model, adapter } = setup(); await ready(); tab('מוצרים');
    await user.click(screen.getByRole('button', { name: 'מוצר חדש' }));
    await user.type(dialog().getByRole('textbox', { name: 'שם המוצר' }), 'מוצר בדיקה חדש');
    await user.selectOptions(dialog().getByRole('combobox', { name: 'קטגוריית יעד' }), '-99');
    await user.type(dialog().getByLabelText('מחיר ברירת מחדל'), '0');
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.type(screen.getByLabelText('חיפוש מוצר'), 'מוצר בדיקה חדש');
    const created = model.view().products.find(p => p.name === 'מוצר בדיקה חדש');
    expect(created.default_price).toBe('0');
    await user.click(screen.getByRole('button', { name: `עריכת מוצר ${created.id}` }));
    await user.selectOptions(dialog().getByRole('combobox', { name: 'קטגוריית יעד' }), '10001');
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(adapter.send.mock.calls.at(-1)[0].body).toEqual({ category_id: '10001' });
    expect(model.view().products.find(p => p.id === created.id).category_id).toBe('10001');
  });
  it('duplicate review and its filters never merge or mutate identities', async () => {
    const { user, adapter, model } = setup(); await ready(); tab('מוצרים');
    const before = JSON.stringify(model.view().products);
    await user.click(screen.getByLabelText(/כפילויות לבדיקה/));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText(/הצעות לבדיקה בלבד/)).toBeVisible();
    expect(adapter.send).not.toHaveBeenCalled();
    expect(JSON.stringify(model.view().products)).toBe(before);
  });
  it('deactivation requires confirmation and cancellation causes no write', async () => {
    const { user, adapter } = setup(); await ready(); tab('מוצרים');
    await user.click(screen.getByRole('button', { name: 'השבתת מוצר 100001' }));
    window.confirm.mockReturnValue(false);
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    expect(adapter.send).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeVisible();
  });
  it('shows list-type counts, previews overlaps and preserves branch drafts across tabs', async () => {
    const { user } = setup(); await ready(); tab('סוגי רשימות');
    expect(await screen.findByText('57 קטגוריות · 144 מוצרים')).toBeVisible();
    const group = screen.getByRole('group', { name: 'ענפי הרשימה' });
    await user.click(within(group).getByLabelText('מזון ומשקאות / ירקות ופירות'));
    await waitFor(() => expect(screen.getByText('57 קטגוריות · 144 מוצרים')).toBeVisible());
    tab('מוצרים'); tab('סוגי רשימות');
    expect(within(screen.getByRole('group', { name: 'ענפי הרשימה' })).getByLabelText('מזון ומשקאות / ירקות ופירות')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'סקירה ושמירת מיפוי' }));
    await user.click(dialog().getByRole('button', { name: 'שמירה בהדגמה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
