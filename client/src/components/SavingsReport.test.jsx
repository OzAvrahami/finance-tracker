import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SavingsReport from './SavingsReport';
import { getSavingsReport } from '../services/api';
vi.mock('../services/api', () => ({ getSavingsReport: vi.fn() }));
const fixture = () => ({ current_balance:'1560.00', period:{deposits:'400.00',withdrawals:'50.00',capitalized_interest:'10.00',paid_out_interest:'5.00',realized_interest:'15.00'},
  cash:{ordinary_expenses:'700.00',expenses:'1100.00',deposits:'400.00',funded_deposits:'300.00',other_income:'0.00',withdrawals:'50.00',paid_out_interest:'5.00',income:'55.00'},
  accounts:[{account_id:'1',name:'קרן חירום',status:'archived',current_balance:'1560.00',deposits:'400.00',withdrawals:'50.00',realized_interest:'15.00'}] });
beforeEach(() => { vi.resetAllMocks(); getSavingsReport.mockResolvedValue({data:fixture()}); });
const view = props => <MemoryRouter><SavingsReport from="2026-09-01" to="2026-09-30" {...props} /></MemoryRouter>;
it('separates current holdings, period flows and reconciled cash; archived account navigation retains identity',async()=>{
 const user=userEvent.setup();render(view());
 expect(await screen.findByText('יתרת חיסכון נוכחית — כל תקופת המעקב')).toBeInTheDocument();
 expect(screen.getByText('הפקדות בתקופה (ללא יתרות פתיחה)')).toBeInTheDocument();
 await user.click(screen.getByText('פירוט והתאמה לתנועות הכספיות'));
 expect(screen.getByText('ריבית שנשארה בחיסכון — ללא הכנסה כספית')).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'קרן חירום'})).toHaveAttribute('href','/savings?accountId=1');
 expect(screen.getByRole('link',{name:'הפקדות'})).toHaveAttribute('href','/transactions?from=2026-09-01&to=2026-09-30&savingsFlow=deposit');
 expect(screen.getByText(/סך הוצאות כספיות/)).toHaveTextContent('1,100');
 expect(screen.getByText(/סך הכנסות כספיות/)).toHaveTextContent('55');
});
it('uses the selected month including leap-day and preserves exact account identifiers',async()=>{
 const user = userEvent.setup();
 render(view({from:undefined,to:undefined,selectable:true,accountId:'9007199254740993'}));
 await screen.findByText('יתרת חיסכון נוכחית — כל תקופת המעקב');
 await user.click(screen.getByText('פירוט והתאמה לתנועות הכספיות'));
 fireEvent.change(screen.getByLabelText('חודש דוח החיסכון'),{target:{value:'2024-02'}});
 await waitFor(()=>expect(getSavingsReport).toHaveBeenLastCalledWith({from:'2024-02-01',to:'2024-02-29',accountId:'9007199254740993'}));
 await screen.findByText('יתרת חיסכון נוכחית — כל תקופת המעקב');
 expect(screen.getByText('פירוט והתאמה לתנועות הכספיות').closest('details')).toHaveAttribute('open');
});
it('refetches after cash and capitalized-interest events, and ignores a stale period response',async()=>{
 let resolveOld;getSavingsReport.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
 const {rerender}=render(view());rerender(view({from:'2025-01-01',to:'2025-12-31'}));
 await screen.findByText('יתרת חיסכון נוכחית — כל תקופת המעקב');
 await act(async()=>resolveOld({data:{...fixture(),current_balance:'99999.00'}}));
 expect(screen.queryByText(/99,999/)).not.toBeInTheDocument();
 for(const type of ['finance:cash-changed','finance:savings-changed']){
  const calls=getSavingsReport.mock.calls.length;act(()=>window.dispatchEvent(new Event(type)));
  await waitFor(()=>expect(getSavingsReport).toHaveBeenCalledTimes(calls+1));
 }
});
it('provides retryable errors and hides the report when there are no Savings accounts',async()=>{
 getSavingsReport.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({data:{accounts:[]}});
 const user=userEvent.setup();render(view());
 await user.click(await screen.findByRole('button',{name:'טעינה חוזרת'}));
 await waitFor(()=>expect(screen.queryByText('חיסכון ותזרים בתקופה')).not.toBeInTheDocument());
});
