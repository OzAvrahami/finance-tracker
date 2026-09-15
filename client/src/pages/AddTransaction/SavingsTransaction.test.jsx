import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AddTransaction from './AddTransaction';
import * as api from '../../services/api';
vi.mock('../../services/api', () => ({ createTransaction: vi.fn(), updateTransaction: vi.fn(), getTransactionById: vi.fn(), getSavingsAccounts: vi.fn(), getCategories: vi.fn(), getPaymentSources: vi.fn(), getTags: vi.fn(), getLegoThemes: vi.fn(), getAllLoans: vi.fn(), createCategory: vi.fn(), getLegoSetDetails: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  api.getSavingsAccounts.mockResolvedValue({ data: [{ account_id: '1', name: 'קרן בדיקה', revision: '3', status: 'active' }] });
  api.getCategories.mockResolvedValue({ data: [{ id: '10', name: 'הפקדה לחיסכון', savings_role: 'deposit', type: 'expense' }, { id: '11', name: 'משיכה מחיסכון', savings_role: 'withdrawal', type: 'income' }, { id: '12', name: 'הוצאה רגילה', type: 'expense' }] });
  api.getPaymentSources.mockResolvedValue({ data: [{ id: '2', name: 'בנק', method: 'bank_transfer' }] });
  for (const fn of [api.getTags, api.getLegoThemes, api.getAllLoans]) fn.mockResolvedValue({ data: [] });
  api.createTransaction.mockResolvedValue({ data: { transaction_id: '42' } }); api.updateTransaction.mockResolvedValue({ data: { transaction_id: '42' } });
});
const renderAt = path => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/add" element={<AddTransaction />} /><Route path="/edit-transaction/:id" element={<AddTransaction />} /><Route path="/transactions" element={<p>transaction destination</p>} /><Route path="/savings" element={<p>savings destination</p>} /></Routes></MemoryRouter>);
it.each(['deposit', 'withdrawal', 'interest_payout'])('Savings %s entry uses the ordinary form with account/direction defaults and exact inputs', async role => {
  if (role === 'interest_payout') api.getCategories.mockResolvedValue({ data: [{ id: '13', name: 'ריבית שהתקבלה', savings_role: 'interest_payout', type: 'income' }] });
  const user = userEvent.setup(); renderAt(`/add?savingsAccountId=1&savingsRole=${role}`);
  expect(await screen.findByLabelText(/חשבון חיסכון/)).toHaveValue('1');
  await user.type(screen.getByLabelText(/^תיאור/), 'בדיקת חיסכון'); await user.clear(screen.getByRole('spinbutton', { name: /^סכום/ })); await user.type(screen.getByRole('spinbutton', { name: /^סכום/ }), '120.25');
  expect(screen.queryByLabelText('מספר תשלומים')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'שמור תנועה' }));
  await screen.findByText('savings destination');
  const sent = api.createTransaction.mock.calls[0][0]; expect(sent.transaction.total_amount).toBe('120.25'); expect(sent.transaction.movement_type).toBe(role === 'deposit' ? 'expense' : 'income'); expect(sent.savings_handling.mode).toBe('create'); expect(sent.savings_handling.account_id).toBe('1');
});

it.each(['/add', '/add?savingsRole=unknown'])('ordinary defaults survive nullable Savings roles at %s', async path => {
  api.getCategories.mockResolvedValue({data:[{id:'12',name:'הוצאה רגילה',type:'expense',savings_role:null}]});
  const user=userEvent.setup(); renderAt(path);
  await screen.findByRole('combobox',{name:/קטגוריה/});
  await user.type(screen.getByLabelText(/^תיאור/),'הוצאה רגילה לבדיקה');
  expect(screen.queryByLabelText(/חשבון חיסכון/)).not.toBeInTheDocument();
  expect(screen.getByRole('radio',{name:'פירוט פריטים'})).toBeInTheDocument();
  expect(screen.getByRole('radio',{name:'הוצאה'})).toHaveAttribute('aria-checked','true');
  expect(screen.getByRole('combobox',{name:/קטגוריה/})).toHaveValue('');
  expect(screen.getByLabelText(/^תאריך חיוב/).value).not.toBe(screen.getByLabelText(/^תאריך התנועה/).value);
  expect(api.createTransaction).not.toHaveBeenCalled();
});
it('failed cash saves retain input and the same retry identity, exposing actionable Hebrew feedback', async () => {
  api.createTransaction.mockRejectedValue({ response: { data: { error: 'אין יתרה מספקת' } } });
  const user = userEvent.setup(); renderAt('/add?savingsAccountId=1&savingsRole=withdrawal'); await screen.findByLabelText(/חשבון חיסכון/);
  await user.type(screen.getByLabelText(/^תיאור/), 'בדיקה'); await user.type(screen.getByRole('spinbutton', { name: /^סכום/ }), '10');
  await user.click(screen.getByRole('button', { name: 'שמור תנועה' })); await screen.findByText('אין יתרה מספקת');
  await user.click(screen.getByRole('button', { name: 'שמור תנועה' })); await waitFor(() => expect(api.createTransaction).toHaveBeenCalledTimes(2));
  expect(api.createTransaction.mock.calls[0][0].savings_handling.request_key).toBe(api.createTransaction.mock.calls[1][0].savings_handling.request_key);
});
it('changing an existing ordinary transaction to a Savings role requests explicit link rather than new cash', async () => {
  api.getTransactionById.mockResolvedValue({ data: { id:42, description:'מיובאת', total_amount:'100.00', category_id:'12', payment_source_id:'2', movement_type:'expense', currency:'ILS', transaction_date:'2026-09-10', charge_date:'2026-09-10', transaction_fingerprint:'original' } });
  const user = userEvent.setup(); renderAt('/edit-transaction/42');
  const category = await screen.findByRole('combobox', { name: /קטגוריה/ }); await user.clear(category); await user.type(category, 'הפקדה'); await user.click(screen.getByRole('option', { name: /הפקדה לחיסכון/ }));
  await user.selectOptions(screen.getByLabelText(/חשבון חיסכון/), '1'); await user.click(screen.getByRole('button', { name: 'עדכן תנועה' }));
  await screen.findByText('transaction destination');
  expect(api.createTransaction).not.toHaveBeenCalled(); expect(api.updateTransaction.mock.calls[0][1].savings_handling).toMatchObject({ mode:'link',expected_transaction_fingerprint:'original' });
});

it('restoring voided detached cash selects its Savings role instead of editing the ordinary tombstone', async () => {
  api.getTransactionById.mockResolvedValue({ data: { id:42, description:'בוטלה אחרי ניתוק', total_amount:'100.00', category_id:'12', payment_source_id:'2', movement_type:'expense', currency:'ILS', transaction_date:'2026-09-10', charge_date:'2026-09-10', transaction_fingerprint:'voided', voided_at:'2026-09-11T10:00:00Z', read_only:true,
    savings:{account_id:'1',name:'קרן בדיקה',event_kind:'deposit',entry_id:'20',revision:'3',active:false,reinstatable:true} } });
  const user = userEvent.setup(); renderAt('/edit-transaction/42');
  await user.click(await screen.findByRole('button', {name:'החזרה מפורשת באמצעות תנועה חדשה'}));
  expect(screen.getByLabelText(/חשבון חיסכון/)).toHaveValue('1');
  await user.type(screen.getByLabelText(/סיבת התיקון/), 'החזרה מאושרת');
  await user.click(screen.getByLabelText(/אישור יצירת תנועה חדשה/));
  await user.click(screen.getByRole('button', {name:'עדכן תנועה'}));
  await screen.findByText('transaction destination');
  const sent=api.updateTransaction.mock.calls[0][1];
  expect(sent.transaction.category_id).toBe('10');
  expect(sent.transaction).not.toHaveProperty('voided_at');
  expect(sent.savings_handling).toMatchObject({mode:'reinstate',was_voided:true,entry_id:'20',expected_transaction_fingerprint:'voided'});
});
