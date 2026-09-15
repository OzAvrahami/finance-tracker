import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { MemoryRouter } from 'react-router-dom';
import Savings from './Savings';
import SavingsAccountDialog from './SavingsAccountDialog';
import { initialSavingsForm, savingsFormError, savingsPayload } from './savingsForm';
import * as api from '../../services/api';
vi.mock('../../services/api', () => ({ getSavingsReport: vi.fn().mockResolvedValue({ data: { accounts: [] } }), getPaymentSources: vi.fn(), getSavingsAccounts: vi.fn(), getSavingsAccount: vi.fn(), createSavingsAccount: vi.fn(), updateSavingsAccount: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); api.getPaymentSources.mockResolvedValue({ data: [] }); });

describe('Savings account setup', () => {
  it('requires independent opening/overlap confirmation and preserves exact decimal input', () => {
    const form = { ...initialSavingsForm(), name: 'בדיקה', opened_on: '2020-01-01', tracking_start_date: '2020-01-01', opening_amount: '9007199254740993.01', legacy_overlap_amount: '0' };
    expect(savingsFormError(form, false, false)).toMatch(/לאשר/);
    expect(savingsFormError(form, false, true)).toBe('');
    expect(savingsPayload(form, false).opening_amount).toBe('9007199254740993.01');
    expect(savingsPayload(form, false).account.target_amount).toBeNull();
    expect(savingsFormError({ ...form, legacy_overlap_amount: '1' }, false, true)).toMatch(/הסבר/);
    expect(savingsFormError({ ...form, opening_amount: '1.001' }, false, true)).not.toBe('');
    expect(savingsFormError({ ...form, opened_on: '2026-02-29' }, false, true)).toMatch(/תאריך/);
  });
  it('hydrates editing, explicitly clears goals, and never resubmits opening data', async () => {
    const user = userEvent.setup(); const save = vi.fn().mockResolvedValue();
    const account = { id: '1', revision: '3', name: 'קרן חירום', opened_on: '2020-01-01', tracking_start_date: '2020-01-01', target_amount: '1000.00', notes: 'מידע קודם' };
    render(<SavingsAccountDialog open account={account} onClose={() => {}} onSave={save} />);
    expect(screen.getByRole('textbox', { name: /שם החיסכון/ })).toHaveValue('קרן חירום');
    expect(screen.queryByLabelText('יתרת פתיחה מאומתת (₪)')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('סכום יעד (₪)'));
    await user.click(screen.getByRole('button', { name: 'שמירת החיסכון' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const sent = save.mock.calls[0][0]; expect(sent.account.target_amount).toBeNull(); expect(sent.expected_revision).toBe('3');
    expect(sent.account.opened_on).toBeUndefined(); expect(sent.opening_amount).toBeUndefined(); expect(sent.account.auto_deposit_enabled).toBeUndefined();
  });
  it('retains a request key and entered values after failed saves; shows actionable Hebrew errors', async () => {
    const user = userEvent.setup(); const save = vi.fn().mockRejectedValue({ response: { data: { error: 'אין ברזרבה מספיק כסף' } } });
    render(<SavingsAccountDialog open account={{ id:'1',revision:'1',name:'בדיקה',opened_on:'2020-01-01',tracking_start_date:'2020-01-01' }} onClose={() => {}} onSave={save} />);
    await user.click(screen.getByRole('button', { name: 'שמירת החיסכון' }));
    expect(await screen.findByText('אין ברזרבה מספיק כסף')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'שמירת החיסכון' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[0][0].request_key).toBe(save.mock.calls[1][0].request_key);
    expect(screen.getByRole('textbox', { name: /שם החיסכון/ })).toHaveValue('בדיקה');
  });
});

describe('Savings management', () => {
  const wrap = () => render(<MemoryRouter><PageHeaderContext.Provider value={{ setPageHeader: vi.fn() }}><Savings /></PageHeaderContext.Provider></MemoryRouter>);
  it('keeps styled cash actions as keyboard-accessible navigation links and omits new activity for archived accounts', async () => {
    api.getSavingsAccounts.mockResolvedValue({data:[{account_id:'7',name:'פעיל',status:'active',current_balance:'1200.00'},{account_id:'8',name:'ישן',status:'archived',current_balance:'500.00'}]});
    const user=userEvent.setup(); wrap();
    expect(await screen.findByRole('link',{name:'הפקדה'})).toHaveAttribute('href','/add?savingsAccountId=7&savingsRole=deposit');
    expect(screen.getByRole('link',{name:'משיכה'})).toHaveAttribute('href','/add?savingsAccountId=7&savingsRole=withdrawal');
    await user.click(screen.getByRole('button',{name:'חשבונות בארכיון (1)'}));
    expect(screen.getAllByRole('link',{name:'הפקדה'})).toHaveLength(1);
    expect(screen.getAllByRole('link',{name:'תנועות החיסכון'}).map(link=>link.getAttribute('href'))).toEqual(['/transactions?savingsAccountId=7','/transactions?savingsAccountId=8']);
  });
  it('shows a useful empty state without downstream cash/automation actions', async () => {
    api.getSavingsAccounts.mockResolvedValue({ data: [] }); wrap();
    expect(await screen.findByText('עדיין אין חשבונות חיסכון')).toBeInTheDocument();
    for (const name of ['הפקדה', 'משיכה', 'רישום ריבית', 'הפעלת אוטומציה']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'חיסכון חדש' })).toBeInTheDocument();
  });
  it('loads details/history, archives while preserving money, and refetches the collection', async () => {
    const user = userEvent.setup();
    const account = { id:'1',revision:'1',name:'קרן חירום',status:'active',opened_on:'2020-01-01',tracking_start_date:'2020-01-01' };
    const summary = { account_id:'1',name:account.name,status:'active',current_balance:'1200.00',opening_balance:'1200.00',deposits_total:'0.00',realized_interest_total:'0.00' };
    const detail = { account, summary, history:[{id:'1',event_kind:'opening',entry_action:'post',effective_date:'2020-01-01',amount:'1200.00'}] };
    api.getSavingsAccounts.mockResolvedValueOnce({data:[summary]}).mockResolvedValue({data:[{...summary,status:'archived'}]});
    api.getSavingsAccount.mockResolvedValue({data:detail});
    api.updateSavingsAccount.mockResolvedValue({data:{...detail,account:{...account,status:'archived',revision:'2'}}});
    wrap(); await user.click(await screen.findByRole('button',{name:'קרן חירום'}));
    const dialog = await screen.findByRole('dialog', {name:'קרן חירום'});
    expect(within(dialog).getByText('היסטוריית החיסכון')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button',{name:'העברה לארכיון'}));
    expect(await within(dialog).findByRole('button',{name:'החזרה לפעיל'})).toBeInTheDocument();
    expect(api.updateSavingsAccount.mock.calls[0][1].account).toEqual({status:'archived'});
    expect(api.getSavingsAccounts).toHaveBeenCalledTimes(2);
  });
});
