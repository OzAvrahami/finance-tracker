import { useMemo, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  addLegoSet,
  deleteLegoSet,
  getLegoSetDetails,
  getLegoSets,
  updateLegoSet,
} from '../../services/api';
import LegoCollection from './LegoCollection';

vi.mock('../../services/api', () => ({
  addLegoSet: vi.fn(),
  deleteLegoSet: vi.fn(),
  getLegoSetDetails: vi.fn(),
  getLegoSets: vi.fn(),
  updateLegoSet: vi.fn(),
}));

const collection = [
  {
    id: 1,
    set_number: '75367-1',
    name: 'Venator-Class Republic Attack Cruiser',
    theme: 'Star Wars',
    pieces: 5374,
    brand: 'LEGO',
    status: 'Built',
    acquisition_type: 'purchase',
    purchase_date: '2025-02-14',
    purchase_price: 2400.1000000000004,
    receipt_price: 2500.2,
    original_price: 2799.9,
  },
  {
    id: 2,
    set_number: '10307-1',
    name: 'Eiffel Tower',
    theme: 'Icons',
    pieces: 10001,
    brand: 'CaDA',
    status: 'In Progress',
    acquisition_type: 'gift',
    purchase_date: null,
    purchase_price: 0,
    receipt_price: 0,
    original_price: 2999.95,
  },
];

const HeaderHarness = ({ children }) => {
  const [header, setHeader] = useState(null);
  const contextValue = useMemo(() => ({ setPageHeader: setHeader }), []);

  return (
    <PageHeaderContext.Provider value={contextValue}>
      {header?.primaryAction && (
        <button type="button" onClick={header.primaryAction.onClick}>{header.primaryAction.label}</button>
      )}
      {children}
    </PageHeaderContext.Provider>
  );
};

const renderPage = () => render(<LegoCollection />, { wrapper: HeaderHarness });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.resetAllMocks();
  getLegoSets.mockResolvedValue({ data: collection });
  getLegoSetDetails.mockResolvedValue({
    data: { name: 'Millennium Falcon', theme: 'Star Wars', parts: 7541 },
  });
  addLegoSet.mockResolvedValue({ data: { id: 3 } });
  updateLegoSet.mockResolvedValue({ data: {} });
  deleteLegoSet.mockResolvedValue({ data: { success: true } });
});

describe('LEGO collection loading, summary, filters, and cards', () => {
  it('uses the shell action, loads once, and renders the four real metrics without precision artifacts', async () => {
    renderPage();

    expect(screen.getByLabelText('טעינת אוסף לגו')).toBeInTheDocument();
    const summary = await screen.findByRole('region', { name: 'סיכום אוסף לגו' });

    expect(getLegoSets).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת סט' })).toBeInTheDocument();
    for (const label of ['מספר הסטים', 'מחיר מחירון כולל', 'סך ששולם', 'פער ממחיר מחירון']) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    }
    expect(within(summary).getByText('2')).toBeInTheDocument();
    expect(screen.queryByText(/000000000|999999999/)).not.toBeInTheDocument();
    expect(screen.queryByText(/שווי מוצג|שווי מוערך|שווי שוק חי|תשואה|השקעה/)).not.toBeInTheDocument();
  });

  it('preserves real card content, technical direction, financial values, and image fallback', async () => {
    renderPage();

    const card = await screen.findByRole('article', { name: /Venator-Class/ });
    const mediaStage = card.querySelector('.lego-set-card__media');
    expect(mediaStage).toBeInTheDocument();
    expect(mediaStage).toContainElement(within(card).getByRole('img', { name: /תמונת Venator/ }));
    expect(within(card).getByText('#75367-1')).toHaveAttribute('dir', 'ltr');
    expect(within(card).getByText('Star Wars')).toBeInTheDocument();
    expect(within(card).getByText('LEGO', { selector: 'bdi' })).toHaveAttribute('dir', 'ltr');
    expect(within(card).getByText('5374')).toHaveAttribute('dir', 'ltr');
    expect(within(card).queryByText('מתנה')).not.toBeInTheDocument();
    expect(within(card).queryByText('GWP')).not.toBeInTheDocument();
    expect(within(card).getByText('2025-02-14')).toHaveAttribute('dir', 'ltr');
    expect(within(card).getByText('₪2,400.10')).toBeInTheDocument();
    expect(within(card).getByText('₪2,500.20')).toBeInTheDocument();
    expect(within(card).queryByText('שווי מוצג')).not.toBeInTheDocument();

    fireEvent.error(within(card).getByRole('img', { name: /תמונת Venator/ }));
    const fallback = within(card).getByRole('img', { name: /אין תמונה זמינה/ });
    expect(fallback).toBeInTheDocument();
    expect(mediaStage).toContainElement(fallback);
  });

  it('shows compact acquisition ribbons only for Gift and GWP cards', async () => {
    getLegoSets.mockResolvedValueOnce({ data: [
      collection[0],
      collection[1],
      { ...collection[1], id: 3, set_number: '40763-1', name: 'Teddy Bear GWP', acquisition_type: 'gwp' },
    ] });
    renderPage();

    const purchaseCard = await screen.findByRole('article', { name: /Venator-Class/ });
    const giftCard = screen.getByRole('article', { name: /Eiffel Tower/ });
    const gwpCard = screen.getByRole('article', { name: /Teddy Bear GWP/ });
    expect(purchaseCard.querySelector('.lego-acquisition-ribbon')).not.toBeInTheDocument();
    expect(giftCard.querySelector('.lego-acquisition-ribbon')).toHaveTextContent('מתנה');
    expect(gwpCard.querySelector('.lego-acquisition-ribbon')).toHaveTextContent('GWP');
  });

  it('combines status and real theme filters and distinguishes filtered empty from dataset empty', async () => {
    renderPage();
    await screen.findByRole('article', { name: /Venator-Class/ });

    await userEvent.selectOptions(screen.getByLabelText('סטטוס הרכבה'), 'Built');
    expect(screen.getByRole('article', { name: /Venator-Class/ })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /Eiffel Tower/ })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('נושא'), 'Icons');
    expect(screen.getByText('לא נמצאו סטים למסננים שנבחרו')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'ניקוי מסננים' })[0]);
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('renders a true empty collection and a retryable initial error without fake totals', async () => {
    getLegoSets.mockRejectedValueOnce(new Error('offline'));
    renderPage();

    expect(await screen.findByText('טעינת אוסף הלגו נכשלה')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'סיכום אוסף לגו' })).not.toBeInTheDocument();
    getLegoSets.mockResolvedValueOnce({ data: [] });
    await userEvent.click(screen.getByRole('button', { name: 'נסו שוב' }));
    expect(await screen.findByText('האוסף עדיין ריק')).toBeInTheDocument();
  });
});

describe('LEGO quick mutations and deletion', () => {
  it('preserves quick status and brand payloads and refreshes after each successful update', async () => {
    renderPage();
    const card = await screen.findByRole('article', { name: /Venator-Class/ });

    await userEvent.selectOptions(within(card).getByLabelText(/עדכון סטטוס/), 'In Progress');
    await waitFor(() => expect(updateLegoSet).toHaveBeenCalledWith(1, { status: 'In Progress' }));
    await userEvent.selectOptions(within(card).getByLabelText(/עדכון מותג/), 'Cobi');
    await waitFor(() => expect(updateLegoSet).toHaveBeenCalledWith(1, { brand: 'Cobi' }));
    expect(getLegoSets).toHaveBeenCalledTimes(3);
  });

  it('shows quick-update failure without changing the displayed set or claiming success', async () => {
    updateLegoSet.mockRejectedValueOnce(new Error('failed'));
    renderPage();
    const card = await screen.findByRole('article', { name: /Venator-Class/ });

    await userEvent.selectOptions(within(card).getByLabelText(/עדכון סטטוס/), 'New');
    expect(await screen.findByText('עדכון סטטוס הסט נכשל.')).toBeInTheDocument();
    expect(card).toBeInTheDocument();
    expect(getLegoSets).toHaveBeenCalledTimes(1);
  });

  it('uses accessible confirmation, cancels safely, and retains the set when deletion fails', async () => {
    deleteLegoSet.mockRejectedValueOnce(new Error('failed'));
    renderPage();
    const card = await screen.findByRole('article', { name: /Venator-Class/ });

    const deleteButton = within(card).getByRole('button', { name: /מחיקת Venator/ });
    await userEvent.click(deleteButton);
    const dialog = screen.getByRole('dialog', { name: 'מחיקת סט מהאוסף' });
    expect(within(dialog).getByRole('button', { name: 'ביטול' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'ביטול' }));
    expect(deleteLegoSet).not.toHaveBeenCalled();

    await userEvent.click(deleteButton);
    await userEvent.click(screen.getByRole('button', { name: 'מחיקת סט' }));
    expect(await screen.findByText(/הסט נשאר באוסף/)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /Venator-Class/ })).toBeInTheDocument();

    getLegoSets.mockResolvedValueOnce({ data: [collection[1]] });
    await userEvent.click(screen.getByRole('button', { name: 'מחיקת סט' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'מחיקת סט מהאוסף' })).not.toBeInTheDocument());
    expect(deleteLegoSet).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('article', { name: /Venator-Class/ })).not.toBeInTheDocument();
  });
});

describe('LEGO add and edit dialog', () => {
  it('looks up a set, preserves the real add payload, and keeps live-market features absent', async () => {
    renderPage();
    await screen.findByRole('article', { name: /Venator-Class/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת סט' }));

    const dialog = screen.getByRole('dialog', { name: 'הוספת סט לאוסף' });
    expect(within(dialog).queryByRole('heading', { name: 'פרטי הסט' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: 'רכישה ושווי' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('note')).toHaveTextContent('שם, נושא ומספר חלקים');
    const footerButtons = within(dialog.querySelector('.lego-dialog__footer')).getAllByRole('button');
    expect(footerButtons.map((button) => button.textContent)).toEqual(['הוספת הסט', 'ביטול']);
    const setNumber = within(dialog).getByLabelText(/מספר סט/);
    await userEvent.type(setNumber, '75192-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'חיפוש פרטי הסט' }));
    expect(await within(dialog).findByDisplayValue('Millennium Falcon')).toBeInTheDocument();
    expect(getLegoSetDetails).toHaveBeenCalledWith('75192-1');
    expect(within(dialog).queryByLabelText(/שווי מוצג|שווי מוערך/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/סנכרון|Marketplace|BrickLink|מחיר חי/)).not.toBeInTheDocument();

    await userEvent.selectOptions(within(dialog).getByLabelText('מותג'), 'Mould King');
    await userEvent.selectOptions(within(dialog).getByLabelText('סטטוס'), 'In Progress');
    expect(within(dialog).getByLabelText('אופן קבלה')).toHaveValue('purchase');
    await userEvent.type(within(dialog).getByLabelText('תאריך כניסה לאוסף'), '2026-08-10');
    await userEvent.type(within(dialog).getByLabelText('מחיר ששולם'), '1500.25');
    await userEvent.type(within(dialog).getByLabelText('מחיר בקבלה'), '1600');
    await userEvent.type(within(dialog).getByLabelText('מחיר לפני הנחת פריט'), '1800');
    await userEvent.click(within(dialog).getByRole('button', { name: 'הוספת הסט' }));

    await waitFor(() => expect(addLegoSet).toHaveBeenCalledWith({
      set_number: '75192-1',
      name: 'Millennium Falcon',
      theme: 'Star Wars',
      brand: 'Mould King',
      status: 'In Progress',
      acquisition_type: 'purchase',
      pieces: 7541,
      purchase_price: 1500.25,
      receipt_price: 1600,
      original_price: 1800,
      purchase_date: '2026-08-10',
    }));
  });

  it('blocks duplicate set numbers without lookup or submit and retains the entered form', async () => {
    renderPage();
    await screen.findByRole('article', { name: /Venator-Class/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת סט' }));
    const dialog = screen.getByRole('dialog', { name: 'הוספת סט לאוסף' });

    await userEvent.type(within(dialog).getByLabelText(/מספר סט/), '75367-1');
    await userEvent.type(within(dialog).getByLabelText(/שם הסט/), 'Duplicate');
    await userEvent.click(within(dialog).getByRole('button', { name: 'הוספת הסט' }));

    expect((await within(dialog).findAllByText('הסט כבר קיים באוסף')).length).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText(/מספר סט/)).toHaveValue('75367-1');
    expect(addLegoSet).not.toHaveBeenCalled();
    expect(getLegoSetDetails).not.toHaveBeenCalled();
  });

  it('allows manual continuation after lookup failure and retains values after save failure', async () => {
    getLegoSetDetails.mockRejectedValueOnce({ response: { status: 404 } });
    addLegoSet.mockRejectedValueOnce(new Error('save failed'));
    renderPage();
    await screen.findByRole('article', { name: /Venator-Class/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת סט' }));
    const dialog = screen.getByRole('dialog', { name: 'הוספת סט לאוסף' });

    await userEvent.type(within(dialog).getByLabelText(/מספר סט/), '99999-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'חיפוש פרטי הסט' }));
    expect(await within(dialog).findByText(/אפשר לבדוק את המספר או להמשיך בהזנה ידנית/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/שם הסט/), 'Manual Set');
    await userEvent.click(within(dialog).getByRole('button', { name: 'הוספת הסט' }));

    expect(await within(dialog).findByText(/הפרטים נשמרו בטופס/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/שם הסט/)).toHaveValue('Manual Set');
    expect(screen.getByRole('dialog', { name: 'הוספת סט לאוסף' })).toBeInTheDocument();
  });

  it('loads edit values, updates the same record, and does not imply transaction synchronization', async () => {
    renderPage();
    const card = await screen.findByRole('article', { name: /Venator-Class/ });
    await userEvent.click(within(card).getByRole('button', { name: /עריכת Venator/ }));
    const dialog = screen.getByRole('dialog', { name: 'עריכת סט באוסף' });

    expect(within(dialog).getByLabelText(/מספר סט/)).toHaveValue('75367-1');
    expect(within(dialog).getByLabelText(/שם הסט/)).toHaveValue('Venator-Class Republic Attack Cruiser');
    expect(within(dialog).getByLabelText('מחיר בקבלה')).toHaveValue(2500.2);
    await userEvent.clear(within(dialog).getByLabelText(/שם הסט/));
    await userEvent.type(within(dialog).getByLabelText(/שם הסט/), 'Venator Updated');
    await userEvent.click(within(dialog).getByRole('button', { name: 'שמירת שינויים' }));

    await waitFor(() => expect(updateLegoSet).toHaveBeenCalledWith(1, expect.objectContaining({
      set_number: '75367-1',
      name: 'Venator Updated',
      purchase_price: 2400.1000000000004,
    })));
    expect(screen.queryByText(/סנכרון תנועה|עדכון תנועה/)).not.toBeInTheDocument();
  });

  it('creates a regular Gift with zero paid cost and no GWP classification', async () => {
    renderPage();
    await screen.findByRole('article', { name: /Venator-Class/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת סט' }));
    const dialog = screen.getByRole('dialog', { name: 'הוספת סט לאוסף' });

    await userEvent.type(within(dialog).getByLabelText(/מספר סט/), '40649-1');
    await userEvent.type(within(dialog).getByLabelText(/שם הסט/), 'Birthday Simba');
    await userEvent.selectOptions(within(dialog).getByLabelText('אופן קבלה'), 'gift');
    await userEvent.type(within(dialog).getByLabelText('מחיר לפני הנחת פריט'), '109.32');
    expect(within(dialog).queryByLabelText('מחיר בקבלה')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('מחיר ששולם')).toHaveValue(0);
    expect(within(dialog).getByLabelText('מחיר ששולם')).toHaveAttribute('readonly');
    expect(within(dialog).queryByLabelText(/שווי/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'הוספת הסט' }));

    await waitFor(() => expect(addLegoSet).toHaveBeenCalledWith(expect.objectContaining({
      acquisition_type: 'gift',
      original_price: 109.32,
      receipt_price: 0,
      purchase_price: 0,
    })));
  });

  it('supports explicit manual GWP selection with the same zero-cost invariant', async () => {
    renderPage();
    await screen.findByRole('article', { name: /Venator-Class/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת סט' }));
    const dialog = screen.getByRole('dialog', { name: 'הוספת סט לאוסף' });

    await userEvent.type(within(dialog).getByLabelText(/מספר סט/), '40763-1');
    await userEvent.type(within(dialog).getByLabelText(/שם הסט/), 'Teddy Bear GWP');
    await userEvent.selectOptions(within(dialog).getByLabelText('אופן קבלה'), 'gwp');
    expect(within(dialog).getByText(/כחלק מרכישה או מבצע/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('מחיר ששולם')).toHaveValue(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'הוספת הסט' }));

    await waitFor(() => expect(addLegoSet).toHaveBeenCalledWith(expect.objectContaining({
      acquisition_type: 'gwp',
      receipt_price: 0,
      purchase_price: 0,
    })));
  });

  it('switches free acquisitions back to editable Purchase pricing without inventing a paid value', async () => {
    renderPage();
    await screen.findByRole('article', { name: /Venator-Class/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת סט' }));
    const dialog = screen.getByRole('dialog', { name: 'הוספת סט לאוסף' });

    const acquisition = within(dialog).getByLabelText('אופן קבלה');
    await userEvent.selectOptions(acquisition, 'gift');
    expect(within(dialog).getByLabelText('מחיר ששולם')).toHaveAttribute('readonly');
    await userEvent.selectOptions(acquisition, 'purchase');
    expect(within(dialog).getByLabelText('מחיר בקבלה')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('מחיר ששולם')).not.toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText('מחיר ששולם')).toHaveValue(0);
  });

  it('prevents duplicate add submission while the existing create request is pending', async () => {
    const pendingCreate = deferred();
    addLegoSet.mockReturnValueOnce(pendingCreate.promise);
    renderPage();
    await screen.findByRole('article', { name: /Venator-Class/ });
    await userEvent.click(screen.getByRole('button', { name: 'הוספת סט' }));
    const dialog = screen.getByRole('dialog', { name: 'הוספת סט לאוסף' });

    await userEvent.type(within(dialog).getByLabelText(/מספר סט/), '42115-1');
    await userEvent.type(within(dialog).getByLabelText(/שם הסט/), 'Lamborghini Sián');
    await userEvent.click(within(dialog).getByRole('button', { name: 'הוספת הסט' }));
    const pendingButton = within(dialog).getByRole('button', { name: 'מוסיף את הסט…' });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(addLegoSet).toHaveBeenCalledTimes(1);

    await act(async () => pendingCreate.resolve({ data: { id: 3 } }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'הוספת סט לאוסף' })).not.toBeInTheDocument());
  });
});

describe('LEGO product truth', () => {
  it('does not expose unsupported marketplace, wishlist, sale, pricing-history, or synchronization actions', async () => {
    renderPage();
    await screen.findByRole('article', { name: /Venator-Class/ });

    expect(screen.queryByRole('button', { name: /מכירה|רשימת משאלות|מחירון חי|התראת מחיר|סנכרון/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/BrickLink|Marketplace|היסטוריית שווי|תשואת השקעה/)).not.toBeInTheDocument();
  });
});
