import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SavingsInterestDialog from './SavingsInterestDialog';
import * as api from '../../services/api';
vi.mock('../../services/api', () => ({ getCategories: vi.fn(), getPaymentSources: vi.fn(), getTransactionById: vi.fn(), getTransactions: vi.fn(), postSavingsEvent: vi.fn(), correctSavingsEvent: vi.fn(), cancelSavingsEvent: vi.fn() }));
const account = { account_id: '1', id: '1', name: 'בדיקה', status: 'active', revision: '4' };
const cash = { id: 9, total_amount: '40.00', transaction_date: '2026-09-12', charge_date: '2026-09-12', movement_type: 'income', payment_source_id: '2', description: 'ריבית בפועל', transaction_fingerprint: 'expected-cash' };
beforeEach(() => {
  vi.clearAllMocks(); api.getCategories.mockResolvedValue({ data: [{ id: '3', savings_role: 'interest_payout' }] });
  api.getPaymentSources.mockResolvedValue({ data: [{ id: '2', name: 'העברה בנקאית' }] });
  api.getTransactionById.mockResolvedValue({ data: cash });
  api.getTransactions.mockResolvedValue({ data: { data: [cash], pagination: { nextCursor: null } } });
  for (const fn of [api.postSavingsEvent, api.correctSavingsEvent, api.cancelSavingsEvent]) fn.mockResolvedValue({ data: { affected_account_ids: ['1'] } });
});
const setup = (entry = null, cancel = false) => {
  const saved = vi.fn(), close = vi.fn(); render(<SavingsInterestDialog context={{ account, entry, cancel }} accounts={[account]} onClose={close} onSaved={saved} />);
  return { user: userEvent.setup(), saved, close };
};
const confirm = async user => user.click(screen.getByRole('checkbox', { name: /אישרתי את הסכום/ }));
describe('realized interest account workflow', () => {
  it('requires explicit destination/confirmation and sends precise capitalized money without cash fields', async () => {
    const { user, saved } = setup();
    await user.type(screen.getByLabelText('סכום הריבית נטו (₪)', { exact: false }), '90071992547409.91');
    await user.selectOptions(screen.getByLabelText('לאן התקבלה הריבית?', { exact: false }), 'interest_capitalized');
    await user.click(screen.getByRole('button', { name: 'שמירת הריבית' })); expect(api.postSavingsEvent).not.toHaveBeenCalled();
    await confirm(user); await user.click(screen.getByRole('button', { name: 'שמירת הריבית' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.postSavingsEvent.mock.calls[0][0].command).toMatchObject({ action: 'noncash', event_kind: 'interest_capitalized', amount: '90071992547409.91', expected_revision: '4' });
    expect(api.postSavingsEvent.mock.calls[0][0].command).not.toHaveProperty('payment_source_id');
  });
  it('links deliberately selected income, preserving its exact date/amount/source and fingerprint', async () => {
    const { user } = setup(); await user.selectOptions(screen.getByLabelText('לאן התקבלה הריבית?', { exact: false }), 'interest_payout');
    await user.selectOptions(screen.getByLabelText('רישום ההכנסה', { exact: false }), 'link');
    await screen.findByRole('option', { name: /ריבית בפועל/ });
    await user.selectOptions(screen.getByLabelText('הכנסה קיימת לקישור', { exact: false }), '9');
    await waitFor(() => expect(screen.getByLabelText('סכום הריבית נטו (₪)', { exact: false })).toHaveValue('40.00'));
    expect(screen.getByLabelText('סכום הריבית נטו (₪)', { exact: false })).toBeDisabled();
    await confirm(user); await user.click(screen.getByRole('button', { name: 'שמירת הריבית' }));
    await waitFor(() => expect(api.postSavingsEvent).toHaveBeenCalledOnce());
    expect(api.postSavingsEvent.mock.calls[0][0].command).toMatchObject({ action: 'link_cash', transaction_id: '9', expected_transaction_fingerprint: 'expected-cash', amount: '40.00', effective_date: '2026-09-12', payment_source_id: '2', event_kind: 'interest_payout' });
  });
  it('payout to capitalization removes payment fields, retains the old cash identity for audited void, and requires a reason', async () => {
    const { user } = setup({ id: '5', account_id: '1', event_kind: 'interest_payout', amount: '40.00', effective_date: '2026-09-12', transaction_id: 9, cash_payment_source_id: '2', cash_charge_date: '2026-09-12' });
    await waitFor(() => expect(api.getTransactionById).toHaveBeenCalledWith(9));
    await user.selectOptions(screen.getByLabelText('לאן התקבלה הריבית?', { exact: false }), 'interest_capitalized');
    expect(screen.queryByLabelText('אמצעי תשלום / מקור ההכנסה')).not.toBeInTheDocument();
    expect(screen.getByText(/יבטל את ההכנסה המקורית/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('סיבת התיקון / הביטול', { exact: false }), 'היעד הנכון הוא החיסכון'); await confirm(user);
    await user.click(screen.getByRole('button', { name: 'שמירת הריבית' }));
    await waitFor(() => expect(api.correctSavingsEvent).toHaveBeenCalledOnce());
    expect(api.correctSavingsEvent.mock.calls[0][1].replacement).toMatchObject({ action: 'noncash', event_kind: 'interest_capitalized', transaction_id: '9', expected_transaction_fingerprint: 'expected-cash' });
    expect(api.correctSavingsEvent.mock.calls[0][1].replacement).not.toHaveProperty('category_id');
  });
  for (const payout of [false, true]) it(`cancels ${payout ? 'payout cash' : 'noncash interest'} through its explicit audited action`, async () => {
    const { user } = setup({ id: '5', account_id: '1', event_kind: payout ? 'interest_payout' : 'interest_capitalized', amount: '40.00', effective_date: '2026-09-12', transaction_id: payout ? 9 : null }, true);
    await user.type(screen.getByLabelText('סיבת התיקון / הביטול', { exact: false }), 'רישום שגוי'); await confirm(user);
    await user.click(screen.getByRole('button', { name: 'אישור ביטול הריבית' }));
    await waitFor(() => expect(api.cancelSavingsEvent).toHaveBeenCalledOnce());
    expect(api.cancelSavingsEvent.mock.calls[0]).toEqual(['5', expect.objectContaining({ cash_action: payout ? 'void' : 'none', expected_revision: '4', reason: 'רישום שגוי' })]);
  });
  it('keeps failed inputs and the request key for retries, and explains historical-solvency rejection', async () => {
    api.postSavingsEvent.mockRejectedValue({ response: { data: { error: 'לא ניתן ליצור יתרה שלילית בהיסטוריה' } } });
    const { user } = setup(); await user.selectOptions(screen.getByLabelText('לאן התקבלה הריבית?', { exact: false }), 'interest_capitalized'); await user.type(screen.getByLabelText('סכום הריבית נטו (₪)', { exact: false }), '40'); await confirm(user);
    await user.click(screen.getByRole('button', { name: 'שמירת הריבית' })); await screen.findByText('לא ניתן ליצור יתרה שלילית בהיסטוריה');
    await user.click(screen.getByRole('button', { name: 'שמירת הריבית' })); await waitFor(() => expect(api.postSavingsEvent).toHaveBeenCalledTimes(2));
    expect(api.postSavingsEvent.mock.calls[0][0].request_key).toEqual(api.postSavingsEvent.mock.calls[1][0].request_key);
  });
});
