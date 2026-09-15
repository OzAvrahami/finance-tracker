import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Archive, CalendarDays, PiggyBank, Plus, Target, Wallet } from 'lucide-react';
import SavingsReport from '../../components/SavingsReport';
import { useLocation, useSearchParams, Link } from 'react-router-dom';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { Alert, Dialog, EmptyState, ErrorState, GlassCard, MoneyAmount, PrimaryButton, ProgressBar, SecondaryButton, Skeleton } from '../../components/ui';
import { createSavingsAccount, getSavingsAccount, getSavingsAccounts, updateSavingsAccount } from '../../services/api';
import { addMoney, approximateMoneyRatio } from '../../utils/money';
import { formatCalendarDate } from '../../utils/calendarDate';
import SavingsAccountDialog from './SavingsAccountDialog';
import SavingsInterestDialog from './SavingsInterestDialog';
import SavingsMonthlyDialog from './SavingsMonthlyDialog';
import './Savings.css';

const eventLabels = { opening: 'יתרת פתיחה', deposit: 'הפקדה', withdrawal: 'משיכה', interest_capitalized: 'ריבית שנצברה', interest_payout: 'ריבית ששולמה לעו״ש', occurrence_skip: 'דילוג על מועד' };
const sum = (rows, key) => rows.reduce((total, row) => addMoney(total, row[key] || '0.00'), '0.00');
const Savings = () => {
  const { setPageHeader } = useContext(PageHeaderContext);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [interest, setInterest] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const monthlyTrigger = useRef(null);
  const interestTrigger = useRef(null);
  const [details, setDetails] = useState(null);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [navigationKey, setNavigationKey] = useState(location.key);
  const [selected, setSelected] = useState(searchParams.get('accountId'));
  if (navigationKey !== location.key) {
    setNavigationKey(location.key);
    setSelected(searchParams.get('accountId'));
  }
  const [detailsError, setDetailsError] = useState('');
  const [pending, setPending] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const trigger = useRef(null);
  const detailTrigger = useRef(null);
  const load = useCallback(async () => {
    setError('');
    try { const { data } = await getSavingsAccounts(); setAccounts(data || []); }
    catch { setError('לא ניתן לטעון את חשבונות החיסכון כרגע'); }
    finally { setLoading(false); }
  }, []);
  const openCreate = useCallback(() => { trigger.current = document.activeElement; setDialog({ account: null }); }, []);
  useEffect(() => { setPageHeader({ title: 'חסכונות', subtitle: 'חשבונות, יעדים ויתרות שנרשמו', primaryAction: { label: 'חיסכון חדש', icon: Plus, onClick: openCreate } }); }, [setPageHeader, openCreate]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener('finance:savings-changed', load); return () => window.removeEventListener('finance:savings-changed', load); }, [load]);
  useEffect(() => {
    if (!selected) return undefined;
    let active = true;
    setDetails(null); setDetailsError('');
    getSavingsAccount(selected).then(({ data }) => { if (active) setDetails(data); }).catch(() => { if (active) setDetailsError('לא ניתן לטעון את פרטי החיסכון'); });
    return () => { active = false; };
  }, [selected]);
  const save = async (payload) => {
    if (dialog.account) await updateSavingsAccount(dialog.account.id, payload); else await createSavingsAccount(payload);
    setDialog(null); await load();
    if (selected) { const { data } = await getSavingsAccount(selected); setDetails(data); }
    window.dispatchEvent(new CustomEvent('finance:savings-changed'));
  };
  const archive = async () => {
    setPending(true); setDetailsError('');
    try {
      const { data } = await updateSavingsAccount(details.account.id, { request_key: crypto.randomUUID(), expected_revision: details.account.revision, account: { status: details.account.status === 'active' ? 'archived' : 'active' } });
      setDetails(data);
      window.dispatchEvent(new CustomEvent('finance:savings-changed'));
    } catch (failure) { setDetailsError(failure.response?.data?.error || 'לא ניתן לשנות את מצב החיסכון'); }
    finally { setPending(false); }
  };
  const moreHistory = async () => {
    setPending(true);
    try { const { data } = await getSavingsAccount(selected, { before: details.next_before_entry_id }); setDetails((old) => ({ ...data, history: [...old.history, ...data.history] })); }
    catch { setDetailsError('טעינת ההיסטוריה נכשלה. נסו שוב.'); }
    finally { setPending(false); }
  };
  const active = accounts.filter((a) => a.status === 'active');
  const archived = accounts.filter((a) => a.status === 'archived');
  const openInterest = (account, entry = null, cancel = false) => { interestTrigger.current = document.activeElement; setInterest({ account, entry, cancel }); };
  const openMonthly = (account, entry = null) => { monthlyTrigger.current = document.activeElement; setMonthly({ account, entry }); };
  const refreshInterest = async () => { await load(); if (selected) { const { data } = await getSavingsAccount(selected); setDetails(data); } };
  const cards = (rows) => <div className="savings-cards">{rows.map((a) => <GlassCard key={a.account_id} padding="20px" style={{ borderRadius: 22 }} className="savings-card">
    <h3><button type="button" className="savings-card-title" onClick={(e) => { detailTrigger.current = e.currentTarget; setSelected(a.account_id); }}>{a.name}</button></h3>
    <MoneyAmount className="savings-card-balance" value={a.current_balance} size="var(--ft-font-size-page-title)" />
    {!a.target_amount && <p>ללא יעד כספי</p>}
    {a.target_amount && <><ProgressBar value={Math.min(100, approximateMoneyRatio(a.current_balance, a.target_amount))} aria-label={`התקדמות ליעד של ${a.name}`} /><p>{approximateMoneyRatio(a.current_balance, a.target_amount).toLocaleString('he-IL', { maximumFractionDigits: 1 })}% מהיעד · יעד: <MoneyAmount value={a.target_amount} /> · נותרו <MoneyAmount value={a.target_remaining} /></p></>}
    <p>{a.target_date ? `תאריך יעד: ${formatCalendarDate(a.target_date)}` : 'ללא תאריך יעד'}</p>
    {a.next_due_date && <p><CalendarDays size={15} aria-hidden="true" /> מועד מתוכנן: {formatCalendarDate(a.next_due_date)}{a.monthly_amount && <> · <MoneyAmount value={a.monthly_amount} /></>}</p>}
    <span className="savings-muted">{a.status === 'archived' ? 'בארכיון · ההיסטוריה והיתרה נשמרות' : a.auto_deposit_enabled ? 'רישום אוטומטי פעיל' : 'רישום אוטומטי כבוי'}</span>
    {a.status === 'active' && a.next_due_date && <SecondaryButton size="sm" onClick={() => openMonthly(a)}>תוכנית חודשית</SecondaryButton>}
    {a.status === 'active' && <div className="savings-cash-actions"><SecondaryButton as={Link} size="sm" to={`/add?savingsAccountId=${a.account_id}&savingsRole=deposit`}>הפקדה</SecondaryButton><SecondaryButton as={Link} size="sm" to={`/add?savingsAccountId=${a.account_id}&savingsRole=withdrawal`}>משיכה</SecondaryButton><SecondaryButton size="sm" onClick={() => openInterest(a)}>רישום ריבית</SecondaryButton></div>}
    <SecondaryButton as={Link} size="sm" to={`/transactions?savingsAccountId=${a.account_id}`}>תנועות החיסכון</SecondaryButton>
  </GlassCard>)}</div>;
  const a = details?.account;
  return <div className="savings-page" dir="rtl">
    {loading ? <Skeleton height={160} /> : error ? <ErrorState title={error} onRetry={load} /> : <>
      {accounts.length === 0 ? <EmptyState icon={PiggyBank} title="עדיין אין חשבונות חיסכון" description="התחילו עם יתרת פתיחה שאומתה ותאריך תחילת מעקב ברור." primaryAction={<PrimaryButton onClick={openCreate}>חיסכון חדש</PrimaryButton>} /> : <>
        <div className="savings-summary">
          {[[<Wallet size={17} aria-hidden="true" />, 'סך יתרות החיסכון', sum(accounts, 'current_balance')], [<Target size={17} aria-hidden="true" />, 'הפקדות שנרשמו', sum(accounts, 'deposits_total')], [<PiggyBank size={17} aria-hidden="true" />, 'ריבית ממומשת שנרשמה', sum(accounts, 'realized_interest_total')], [<Archive size={17} aria-hidden="true" />, 'יתרות בארכיון', sum(archived, 'current_balance')]].map(([icon, label, value]) => <GlassCard key={label} className="savings-summary-card"><span>{icon}{label}</span><MoneyAmount value={value} size="var(--fs-24)" /></GlassCard>)}
        </div>
        <p className="savings-muted">סיכומים לכל תקופת המעקב, כולל ארכיון. רזרבת התקציב הישנה אינה כלולה.</p>
        <SavingsReport selectable />
        <section aria-labelledby="savings-active-title"><h2 id="savings-active-title">חסכונות פעילים ({active.length})</h2>{active.length ? cards(active) : <p>אין חשבונות פעילים כרגע.</p>}</section>
        {archived.length > 0 && <section><SecondaryButton aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>חשבונות בארכיון ({archived.length})</SecondaryButton>{showArchived && cards(archived)}</section>}
      </>}
    </>}
    <Dialog open={Boolean(selected)} title={a?.name || 'פרטי החיסכון'} size="lg" onClose={() => setSelected(null)} returnFocusRef={detailTrigger} closeDisabled={pending}
      footer={a && <><SecondaryButton disabled={pending} onClick={(e) => { trigger.current = e.currentTarget; setDialog({ account: a }); }}>עריכת פרטים</SecondaryButton><SecondaryButton loading={pending} onClick={archive}>{a.status === 'active' ? 'העברה לארכיון' : 'החזרה לפעיל'}</SecondaryButton></>}>
      {detailsError && <Alert variant="error" urgent>{detailsError}</Alert>}
      {!details && !detailsError && <Skeleton height={160} />}
      {a && <div className="savings-details">
        <MoneyAmount value={details.summary.current_balance} size="var(--fs-32)" />
        <p>{a.status === 'archived' ? 'בארכיון. היתרה וההיסטוריה נשמרות.' : 'חשבון פעיל'} · {a.auto_deposit_enabled ? 'רישום אוטומטי פעיל' : 'רישום אוטומטי כבוי'}</p>
        <dl className="savings-details-grid">
          {[['הפקדות שנרשמו', 'deposits_total'], ['משיכות שנרשמו', 'withdrawals_total'], ['ריבית שנצברה בחיסכון', 'capitalized_interest_total'], ['ריבית ששולמה לעו״ש', 'paid_out_interest_total']].map(([label, key]) => <div key={key}><dt>{label}</dt><dd><MoneyAmount value={details.summary[key]} /></dd></div>)}
        </dl>
        <dl className="savings-details-grid">
          {[[ 'מטרה', a.purpose ],['גוף מנהל',a.institution_name],['מוצר',a.product_name],['אסמכתה',a.reference],['תאריך פתיחה',formatCalendarDate(a.opened_on)],['תחילת מעקב',formatCalendarDate(a.tracking_start_date)],['יתרת פתיחה',<MoneyAmount value={details.summary.opening_balance} />],['יעד',a.target_amount && <MoneyAmount value={a.target_amount} />],['תאריך יעד',a.target_date && formatCalendarDate(a.target_date)],['נותרו ליעד',a.target_amount && <MoneyAmount value={details.summary.target_remaining} />],['ריבית שנתית (תיאור בלבד)',a.annual_interest_rate == null ? null : `${a.annual_interest_rate}%`],['תנאים',a.terms],['נזילות',a.liquidity_notes],['מועד שחרור',a.release_date && formatCalendarDate(a.release_date)],['סכום חודשי מתוכנן',a.monthly_amount && <MoneyAmount value={a.monthly_amount} />],['מועד מתוכנן הבא',a.next_due_date && formatCalendarDate(a.next_due_date)],['הערות',a.notes]].filter(([, value]) => value != null && value !== '').map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <h3>היסטוריית החיסכון</h3>
        {a.next_due_date && a.status === 'active' && <SecondaryButton onClick={() => openMonthly(a)}>תוכנית חודשית</SecondaryButton>}
        <ol className="savings-history">{details.history.map((e) => <li key={e.id}><div><strong>{e.entry_action === 'reverse' ? 'ביטול: ' : ''}{eventLabels[e.event_kind] || e.event_kind}</strong><span>{formatCalendarDate(e.effective_date)}</span>{e.reversed_by_entry_id && <span>האירוע בוטל ונשמר להיסטוריה</span>}{e.transaction_id && <Link to={`/edit-transaction/${e.transaction_id}`}>התנועה המקושרת</Link>}{e.reason && <p>{e.reason}</p>}
          {e.occurrence_month && <p>מועד חודשי: {formatCalendarDate(e.scheduled_due_date)} · חודש זה נשאר מוסדר גם לאחר ביטול</p>}
          {e.event_kind === 'occurrence_skip' && e.entry_action === 'post' && e.reinstatable && a.status === 'active' && <SecondaryButton size="sm" onClick={() => openMonthly(a, e)}>החזרת מועד שדולג</SecondaryButton>}
          {e.entry_action === 'post' && ['interest_capitalized', 'interest_payout'].includes(e.event_kind) && <div className="savings-cash-actions">{!e.reversed_by_entry_id ? <><SecondaryButton size="sm" onClick={() => openInterest(a, e)}>תיקון ריבית</SecondaryButton><SecondaryButton size="sm" onClick={() => openInterest(a, e, true)}>ביטול ריבית</SecondaryButton></> : e.reinstatable && a.status === 'active' ? <SecondaryButton size="sm" onClick={() => openInterest(a, e)}>החזרת ריבית</SecondaryButton> : null}</div>}
        </div><MoneyAmount value={e.amount} /></li>)}</ol>
        {details.next_before_entry_id && <SecondaryButton disabled={pending} onClick={moreHistory}>היסטוריה קודמת</SecondaryButton>}
      </div>}
    </Dialog>
    <SavingsAccountDialog open={Boolean(dialog)} account={dialog?.account} onClose={() => setDialog(null)} onSave={save} returnFocusRef={trigger} />
    <SavingsInterestDialog context={interest} accounts={accounts} onClose={() => setInterest(null)} onSaved={refreshInterest} returnFocusRef={interestTrigger} />
    <SavingsMonthlyDialog context={monthly} onClose={() => setMonthly(null)} onSaved={refreshInterest} returnFocusRef={monthlyTrigger} />
  </div>;
};
export default Savings;
