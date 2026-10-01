import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconciliationProvider, ReconciliationToolbar, ReconciliationBadge } from './Reconciliation';
import { getReconciliationSummary, getReconciliationPending, getReconciliationDetail, resolveReconciliation } from '../../services/api';
import { FINANCE_CHANGED } from '../../utils/financeInvalidation';
vi.mock('../../services/api',()=>({getReconciliationSummary:vi.fn(),getReconciliationPending:vi.fn(),getReconciliationDetail:vi.fn(),resolveReconciliation:vi.fn()}));
const evidence = {id:'20',source:'cal',merchant:'נאייקס ישראל מכונות אוטומ…',amount:'6.00',currency:'ILS',transaction_date:'2026-09-30',charge_date:'2026-10-01',occurred_at:null,observed_at:'2026-10-01T08:00:00Z',payment_context:'credit_card •••• 2755',transaction_id:null,revision:'1'};
const candidate = id => ({id,description:`תיאור בעלים ${id}`,amount:'6.00',transaction_date:'2026-09-30',fingerprint:'a'.repeat(32),can_link:true,observations:[{...evidence,id:`${id}0`,source:'apple_pay',merchant:'Israel Post',transaction_id:id}]});
const detail = () => ({observation:evidence,candidates:[candidate('1'),candidate('2')],candidate_fingerprints:{1:'a'.repeat(32),2:'a'.repeat(32)},can_separate:true});
function mount() {return render(<ReconciliationProvider rows={[{id:1},{id:2}]}><ReconciliationToolbar/><ReconciliationBadge id="1"/><ReconciliationBadge id="2"/></ReconciliationProvider>);}
async function openReview(user) {mount();await user.click(await screen.findByRole('button',{name:/התאמת עסקאות/}));await user.click(await screen.findByRole('button',{name:/בדיקה:/}));await screen.findByRole('radio',{name:/אפשרות 1/});}
beforeEach(()=>{
 vi.resetAllMocks();sessionStorage.clear();
 getReconciliationSummary.mockResolvedValue({data:{transactions:{1:{status:'awaiting_cal'},2:{status:'reconciled'}},pending_count:1}});
 getReconciliationPending.mockResolvedValue({data:{items:[evidence],next_cursor:null}});
 getReconciliationDetail.mockResolvedValue({data:detail()});resolveReconciliation.mockResolvedValue({data:{outcome:'reconciled'}});
});
describe('owner reconciliation workflow',()=>{
 it('shows server-derived compact status and distinct pending evidence without another expense',async()=>{
  const user=userEvent.setup();mount();expect(await screen.findByRole('button',{name:/פרטי התאמה: Apple Pay/})).toBeVisible();
  expect(screen.getByRole('button',{name:/פרטי התאמה: אושרה/})).toBeVisible();await user.click(screen.getByRole('button',{name:/התאמת עסקאות/}));
  expect(await screen.findByText('טרם נרשמה הוצאה מהדיווח')).toBeVisible();expect(screen.getByText(/מכל התקופות/)).toBeVisible();
  expect(screen.queryByText(/credit_card|ILS|2026-10-01T/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:/בדיקה:/}));await user.click((await screen.findAllByText('פרטים נוספים'))[0]);expect(screen.getAllByText('לא נמסר — תאריך בלבד')[0]).toBeVisible();expect(screen.getAllByText('קליטה בשרת (אינה מועד רכישה)')[0]).toBeVisible();
  expect(screen.getAllByText(/שעון ישראל/)[0]).toBeVisible();expect(screen.queryByText('2026-10-01T08:00:00Z')).not.toBeInTheDocument();
 });
 it.each(['1','2'])('explicitly links candidate %s and invalidates financial readers',async id=>{
  const user=userEvent.setup(),listener=vi.fn();window.addEventListener(FINANCE_CHANGED,listener);
  await openReview(user);expect(screen.getAllByRole('radio').every(r=>!r.checked)).toBe(true);
  expect(screen.getByRole('button',{name:'אישור התאמה'})).toBeDisabled();
  await user.click(screen.getByRole('radio',{name:new RegExp(`אפשרות ${id}`)}));
  expect(screen.getByText('הקישור לא יוסיף הוצאה.')).toBeVisible();await user.click(screen.getByRole('button',{name:'קישור ללא הוצאה נוספת'}));
  await waitFor(()=>expect(resolveReconciliation).toHaveBeenCalledTimes(1));
  expect(resolveReconciliation.mock.calls[0][1]).toMatchObject({action:'link',transaction_id:id,expected_revision:'1'});
  expect(listener).toHaveBeenCalled();window.removeEventListener(FINANCE_CHANGED,listener);
 });
 it('separate choice explains new cash and submits no chosen transaction',async()=>{
  const user=userEvent.setup();await openReview(user);await user.click(screen.getByRole('radio',{name:/זו קנייה נפרדת/}));
  expect(screen.getByText(/תתווסף הוצאה של/)).toBeVisible();await user.click(screen.getByRole('button',{name:'יצירת הוצאה נפרדת'}));
  const command=resolveReconciliation.mock.calls[0][1];expect(command.action).toBe('separate');expect(command.transaction_id).toBeUndefined();
 });
 it('Escape cancels without mutation and restores the queue opener focus',async()=>{
  const user=userEvent.setup();mount();const opener=await screen.findByRole('button',{name:/התאמת עסקאות/});await user.click(opener);
  await screen.findByText('טרם נרשמה הוצאה מהדיווח');await user.keyboard('{Escape}');await waitFor(()=>expect(opener).toHaveFocus());expect(resolveReconciliation).not.toHaveBeenCalled();
 });
 it('stale decisions refresh evidence and clear selection before renewed submission',async()=>{
  const user=userEvent.setup();await openReview(user);resolveReconciliation.mockRejectedValueOnce({response:{status:409}});
  await user.click(screen.getByRole('radio',{name:/אפשרות 1/}));await user.click(screen.getByRole('button',{name:'קישור ללא הוצאה נוספת'}));
  await screen.findByText(/המידע השתנה/);await waitFor(()=>expect(getReconciliationDetail).toHaveBeenCalledTimes(2));
  expect(screen.getAllByRole('radio').every(r=>!r.checked)).toBe(true);expect(screen.getByRole('button',{name:'אישור התאמה'})).toBeDisabled();
 });
 it('double clicks send once; lost response and reopened dialog reuse exact persisted command',async()=>{
  const user=userEvent.setup();await openReview(user);let reject;resolveReconciliation.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));
  await user.click(screen.getByRole('radio',{name:/אפשרות 2/}));const button=screen.getByRole('button',{name:'קישור ללא הוצאה נוספת'});fireEvent.click(button);fireEvent.click(button);
  expect(resolveReconciliation).toHaveBeenCalledTimes(1);const original=resolveReconciliation.mock.calls[0][1];reject(Error('offline'));
  await screen.findByRole('button',{name:'ניסיון חוזר לאותה החלטה'});await user.click(screen.getByRole('button',{name:'ביטול'}));
  // A committed-but-lost response can already have linked the observation on reopen.
  getReconciliationDetail.mockResolvedValue({data:{...detail(),observation:{...evidence,transaction_id:'2'}}});
  await user.click(screen.getByRole('button',{name:/התאמת עסקאות/}));await user.click(await screen.findByRole('button',{name:/בדיקה:/}));
  await user.click(await screen.findByRole('button',{name:'ניסיון חוזר לאותה החלטה'}));expect(resolveReconciliation.mock.calls[1][1]).toEqual(original);
 });
 it('compares either arrival order, with clickable option labels and no guessed purchase timezone',async()=>{
  const d=detail();d.observation={...evidence,source:'apple_pay',merchant:'Israel Post',occurred_at:'2026-09-30T10:46:01.123'};
  d.candidates=[{...candidate('1'),observations:[{...evidence,transaction_id:'1'}]}];
  getReconciliationDetail.mockResolvedValue({data:d});
  const user=userEvent.setup();await openReview(user);
  expect(screen.getByRole('dialog')).toHaveAccessibleName('האם זו אותה קנייה?');
  expect(screen.getByText('הדיווח שהתקבל')).toBeVisible();expect(screen.getByText('בחירת הוצאה קיימת')).toBeVisible();
  expect(screen.getByText(/CAL:/)).toHaveTextContent(evidence.merchant);
  await user.click(screen.getByText('תיאור בעלים 1'));expect(screen.getByRole('radio',{name:/אפשרות 1/})).toBeChecked();
  await user.click(screen.getAllByText('פרטים נוספים')[0]);
  expect(screen.getByText('30/09/2026 10:46 (אזור זמן לא נמסר)')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'ביטול'}));expect(resolveReconciliation).not.toHaveBeenCalled();
 });
 it('protected candidates and unavailable separate action cannot be selected',async()=>{
  getReconciliationDetail.mockResolvedValue({data:{...detail(),can_separate:false,candidates:[{...candidate('1'),can_link:false,cancelled:true}]}});
  const user=userEvent.setup();await openReview(user);expect(screen.getByRole('radio')).toBeDisabled();expect(screen.queryByRole('radio',{name:/זו קנייה נפרדת/})).not.toBeInTheDocument();
 });
 it('ordinary non-owner cannot access review; summary failure can retry',async()=>{
  getReconciliationSummary.mockRejectedValueOnce({response:{status:403}});const mounted=mount();await waitFor(()=>expect(getReconciliationSummary).toHaveBeenCalled());expect(screen.queryByRole('button')).not.toBeInTheDocument();mounted.unmount();
  getReconciliationSummary.mockRejectedValueOnce(Error('offline'));mount();await screen.findByText(/מצב התאמה אינו זמין/);await userEvent.click(screen.getByRole('button',{name:'נסה שוב'}));expect(await screen.findByRole('button',{name:/התאמת עסקאות/})).toBeVisible();
 });
 it('posted detail separates provider names from preserved canonical description',async()=>{
  getReconciliationDetail.mockResolvedValue({data:{description:'תיאור בעלים',observations:[{...evidence,source:'apple_pay',merchant:'Ninja Star Ltd',id:'30'},{...evidence,merchant:"נינג'ה סטאר",id:'31'}]}});
  const user=userEvent.setup();mount();await user.click(await screen.findByRole('button',{name:/פרטי התאמה: Apple Pay/}));
  const dialog=await screen.findByRole('dialog');expect(await within(dialog).findByText('תיאור בעלים')).toBeVisible();expect(within(dialog).getByText('Ninja Star Ltd')).toBeVisible();expect(within(dialog).getByText("נינג'ה סטאר")).toBeVisible();expect(within(dialog).getByText(/כבר נכללת בסיכומים/)).toBeVisible();
 });
});
