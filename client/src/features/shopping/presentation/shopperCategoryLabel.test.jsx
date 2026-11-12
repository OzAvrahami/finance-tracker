import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { shopperCategoryLabel } from './shopperCategoryLabel';
import CategorySelector from '../components/CategorySelector';
import ShoppingCategoryInput from '../../../pages/Shopping/ShoppingCategoryInput';

const category = names => ({ id: String(names.length), name: names.at(-1), effective_active: true,
  path: names.map((name, i) => ({ id: String(i + 1), name })) });

// Match the existing popup tests: jsdom otherwise reports a zero-width anchor.
beforeEach(() => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 20, right: 320, top: 100, bottom: 144, width: 300, height: 44 }));

it.each([
  [['שורש', 'ילד'], 'ילד'],
  [['מזון ומשקאות', 'מוצרי חלב וביצים', 'חלב ומשקאות חלב'], 'מוצרי חלב וביצים / חלב ומשקאות חלב'],
  [['שורש', 'א', 'ב', 'ג'], 'א / ב / ג'],
  [['שורש'], 'שורש'],
  [['שורש', 'שם / עם לוכסן', 'עלה'], 'שם / עם לוכסן / עלה'],
])('omits only the actual first segment of %j', (names, expected) => {
  const value = category(names);
  const original = structuredClone(value);
  Object.freeze(value.path);value.path.forEach(Object.freeze);Object.freeze(value);
  expect(shopperCategoryLabel(value)).toBe(expected);
  expect(value).toEqual(original);
});

it('supports arbitrary depth and leaves canonical/relative paths untouched', () => {
  const names = Array.from({ length: 1000 }, (_, i) => `node-${i}`);
  const value = { ...category(names), relative_path: [{ id: '1000', name: 'different relative display' }] };
  expect(shopperCategoryLabel(value)).toBe(names.slice(1).join(' / '));
  expect(value.path.map(p => p.name)).toEqual(names);
});

it.each([{ id: -1, name: 'כללי' }, { id: '-1', path: [] }, { id: '99', name: 'Legacy', is_neutral: true }])(
  'renders the protected neutral category exactly (%j)', value => {
    expect(shopperCategoryLabel(value, 'fallback')).toBe('ללא קטגוריה');
  });

it.each([undefined, [], 'שורש / ילד', [null], [{ name: 'child' }],
  [{ id: '2', name: '' }], [{ id: '3', name: 'wrong target' }],
  [{ id: '2', name: 'root' }, { id: '2', name: 'cycle' }],
].map(path => [path]))('preserves the category-name fallback for unresolved path %j', path => {
  expect(shopperCategoryLabel({ id: '2', name: 'Existing / literal name', path })).toBe('Existing / literal name');
});

it('preserves caller-specific missing-category fallbacks', () => {
  expect(shopperCategoryLabel(undefined, 'כללי')).toBe('כללי');
  expect(shopperCategoryLabel(null, 'פריט שמור')).toBe('פריט שמור');
  expect(shopperCategoryLabel({ id: '7' })).toBe('');
});

it('shows shopper selection context while keeping the canonical name and selected ID', () => {
  const c = category(['מזון ומשקאות', 'מוצרי חלב וביצים', 'חלב']);const onChange = vi.fn();
  render(<ShoppingCategoryInput value={c.name} categoryId={c.id} categories={[c]} onChange={onChange} />);
  expect(screen.getByRole('combobox', { name: 'קטגוריה' })).toHaveValue('חלב');
  expect(screen.getByText('מוצרי חלב וביצים / חלב')).toBeInTheDocument();
  fireEvent.focus(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: 'מוצרי חלב וביצים / חלב' }));
  expect(onChange).toHaveBeenCalledWith('חלב', c.id);
  expect(screen.queryByText(/מזון ומשקאות/)).not.toBeInTheDocument();
});

it('shows the exact neutral label in the selected shopper input', () => {
  render(<ShoppingCategoryInput value="כללי" categoryId="-1" categories={[{ id: -1, name: 'כללי', is_neutral: true }]} onChange={vi.fn()} />);
  expect(screen.getByRole('combobox')).toHaveValue('ללא קטגוריה');
  fireEvent.focus(screen.getByRole('combobox'));
  expect(screen.getByRole('option', { name: 'ללא קטגוריה' })).toBeInTheDocument();
});

it('keeps the existing administration selector on its full canonical path', () => {
  const c = category(['מזון ומשקאות', 'מוצרי חלב וביצים', 'חלב']);
  render(<CategorySelector categories={[c]} value={c.id} onChange={vi.fn()} />);
  expect(screen.getByRole('option', { name: 'מזון ומשקאות / מוצרי חלב וביצים / חלב' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'מוצרי חלב וביצים / חלב' })).not.toBeInTheDocument();
});
