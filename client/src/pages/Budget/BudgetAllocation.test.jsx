import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeficitResolutionDialog, UnbudgetedResolutionDialog } from './BudgetFundingActions';
import * as api from '../../services/api';

vi.mock('../../services/api', () => Object.fromEntries([
  'applyBudgetReallocation', 'getBudgetReallocationPreview', 'applyDeficitResolution',
  'getDeficitResolutionPreview', 'applyUnbudgetedResolution', 'getUnbudgetedResolutionPreview',
].map(name => [name, vi.fn()])));
const row = { id: 11, category_id: 1, categoryName: 'חוגים לילדים', planned: '400.00', actual: '530.00', sourceCapacity: '0.00' };
const source = { id: 12, category_id: 2, categoryName: 'תחבורה', sourceCapacity: '75.00' };
let props;
const response = (amount = '130.00', fingerprint = 'first') => ({ data: {
  can_apply: true, fingerprint, requested_resolution: amount,
  resulting_funded: amount === '130.00' ? '530.00' : '450.00', remaining_deficit: amount === '130.00' ? '0.00' : '80.00',
} });
beforeEach(() => {
  vi.resetAllMocks();
  props = { open: true, month: '2026-08', row, rows: [row, source], unallocated: '200.00', savings: '0.00', onClose: vi.fn(), onApplied: vi.fn() };
  api.getDeficitResolutionPreview.mockResolvedValue(response());
  api.applyDeficitResolution.mockResolvedValue({ data: {} });
  api.getUnbudgetedResolutionPreview.mockResolvedValue({ data: { ...response().data, resolution_mode: 'created' } });
  api.applyUnbudgetedResolution.mockResolvedValue({ data: {} });
});
const applyButton = () => screen.getByRole('button', { name: 'פתרון החריגה' });
const waitPreview = async () => { await waitFor(() => expect(applyButton()).toBeEnabled()); };

describe('shared compact allocation with explicit operation types', () => {
  it.each(['130.00', '50.00'])('suggests the deficit, previews and applies full/partial additional funding %s without creating a category', async amount => {
    render(<DeficitResolutionDialog {...props} />);
    expect(screen.getByRole('dialog', { name: 'פתרון חריגה — חוגים לילדים' })).toBeInTheDocument();
    const context = screen.getByLabelText('פרטי ההוצאה והתקציב');
    expect(context).toHaveTextContent('אוגוסט 2026');
    for (const value of ['400', '530', '130']) expect(context).toHaveTextContent(value);
    expect(screen.getByLabelText('סכום להקצאה')).toHaveValue(130);
    expect(screen.queryByLabelText('מקור נוסף')).not.toBeInTheDocument();
    expect(screen.queryByText(/חיסכון.*זמין/)).not.toBeInTheDocument();
    api.getDeficitResolutionPreview.mockResolvedValue(response(amount));
    if (amount !== '130.00') fireEvent.change(screen.getByLabelText('סכום להקצאה'), { target: { value: amount } });
    await waitPreview();
    expect(api.getDeficitResolutionPreview).toHaveBeenLastCalledWith('2026-08', 1, { legs: [{ source_kind: 'unallocated', amount }] });
    const preview = screen.getByLabelText('סקירת פתרון חריגה');
    expect(preview).toHaveTextContent(amount === '130.00' ? '530' : '450');
    expect(preview).toHaveTextContent(amount === '130.00' ? 'חריגה שתישאר ₪0' : 'חריגה שתישאר ₪80');
    await userEvent.click(applyButton());
    expect(api.applyDeficitResolution).toHaveBeenCalledWith('2026-08', 1, { legs: [{ source_kind: 'unallocated', amount }], preview_fingerprint: 'first', request_key: expect.any(String) });
    expect(api.applyUnbudgetedResolution).not.toHaveBeenCalled();
    expect(api.getUnbudgetedResolutionPreview).not.toHaveBeenCalled();
    expect(props.onApplied).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledWith('applied');
    expect(context).toHaveTextContent('530'); // actual spending is never edited by this form
  });

  it('retains the upper unbudgeted operation and its requested_amount contract', async () => {
    render(<UnbudgetedResolutionDialog {...props} category={{ category_id: 3, actual_spent: '130.00', categories: { name: 'בריאות' } }} />);
    const apply = screen.getByRole('button', { name: 'הקצה תקציב לבריאות' });
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);
    expect(api.applyUnbudgetedResolution).toHaveBeenCalledWith('2026-08', 3, { requested_amount: '130.00', legs: [{ source_kind: 'unallocated', amount: '130.00' }], preview_fingerprint: 'first', request_key: expect.any(String) });
    expect(api.applyDeficitResolution).not.toHaveBeenCalled();
  });

  it('cancels without applying and progressively offers only available sources', async () => {
    render(<DeficitResolutionDialog {...props} unallocated="0.00" />);
    await userEvent.click(screen.getByRole('button', { name: 'הוספת מקור נוסף' }));
    const select = screen.getByLabelText('מקור נוסף');
    expect(within(select).getByRole('option', { name: /תחבורה/ })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /חיסכון|חוגים/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'סגירה', exact: true }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onApplied).not.toHaveBeenCalled();
    expect(api.applyDeficitResolution).not.toHaveBeenCalled();
  });

  it('rejects over-capacity and non-exact amounts without rounding or crashing', async () => {
    render(<DeficitResolutionDialog {...props} />);
    await waitPreview();
    fireEvent.change(screen.getByLabelText('סכום להקצאה'), { target: { value: '0.001' } });
    expect(applyButton()).toBeDisabled();
    expect(screen.getByText(/עד שתי ספרות/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('סכום להקצאה'), { target: { value: '130' } });
    await userEvent.click(screen.getByRole('button', { name: 'שינוי מקור המימון' }));
    fireEvent.change(screen.getByLabelText('סכום ממקור זה'), { target: { value: '201' } });
    expect(applyButton()).toBeDisabled();
    expect(screen.getByText(/גבוה מהיתרה הזמינה/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('סכום ממקור זה'), { target: { value: '1.001' } });
    expect(applyButton()).toBeDisabled();
    expect(screen.getByText(/עד שתי ספרות/)).toBeInTheDocument();
  });

  it('ignores late previews from an old proposal and from a previous category/month', async () => {
    let oldResolve;
    api.getDeficitResolutionPreview.mockReturnValueOnce(new Promise(resolve => { oldResolve = resolve; }));
    const { rerender } = render(<DeficitResolutionDialog {...props} />);
    await waitFor(() => expect(api.getDeficitResolutionPreview).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('סכום להקצאה'), { target: { value: '50.00' } });
    api.getDeficitResolutionPreview.mockResolvedValue(response('50.00', 'new'));
    await waitPreview();
    await act(async () => oldResolve(response('130.00', 'old')));
    expect(screen.getByLabelText('סקירת פתרון חריגה')).toHaveTextContent('450');
    rerender(<DeficitResolutionDialog {...props} month="2026-09" row={{ ...row, category_id: 4 }} />);
    expect(applyButton()).toBeDisabled();
    await waitPreview();
    expect(api.getDeficitResolutionPreview.mock.calls.at(-1)[0]).toBe('2026-09');
    expect(api.getDeficitResolutionPreview.mock.calls.at(-1)[1]).toBe(4);
  });

  it('blocks duplicate submission, freezes source edits, and reuses the receipt on uncertain retry', async () => {
    let rejectApply;
    api.applyDeficitResolution.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectApply = reject; }));
    render(<DeficitResolutionDialog {...props} />);
    await waitPreview();
    const button = applyButton();
    fireEvent.click(button); fireEvent.click(button);
    expect(api.applyDeficitResolution).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('סכום להקצאה')).toBeDisabled();
    const firstKey = api.applyDeficitResolution.mock.calls[0][2].request_key;
    await act(async () => rejectApply(new Error('network')));
    await userEvent.click(applyButton());
    expect(api.applyDeficitResolution.mock.calls[1][2].request_key).toBe(firstKey);
  });

  it('keeps a server-forbidden month or operation disabled', async () => {
    api.getDeficitResolutionPreview.mockResolvedValue({ data: { ...response().data, can_apply: false, reason: 'BUDGET_MONTH_ALREADY_CLOSED' } });
    render(<DeficitResolutionDialog {...props} />);
    await screen.findByLabelText('סקירת פתרון חריגה');
    expect(applyButton()).toBeDisabled();
    expect(api.applyDeficitResolution).not.toHaveBeenCalled();
  });
});
