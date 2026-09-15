import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSavingsReport } from '../services/api';
import { Alert, GlassCard, MoneyAmount, SecondaryButton, Select, Skeleton, TextField } from './ui';
import { currentBusinessDate, formatCalendarDate } from '../utils/calendarDate';
import { getMonthRange } from '../utils/dateRange';
import { addMoney } from '../utils/money';
import './SavingsReport.css';

// Shared read-only presentation: report dates never turn the current balance into an as-of balance.
export default function SavingsReport({ from, to, accountId, selectable = false }) {
  const [month, setMonth] = useState(() => currentBusinessDate().slice(0, 7));
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ key: null, data: null, error: '' });
  const [year, monthNumber] = month.split('-').map(Number);
  const range = getMonthRange(new Date(year, monthNumber - 1, 1));
  const start = from || range.start, end = to || range.end;
  const queryKey = JSON.stringify([start, end, accountId, version]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { data } = await getSavingsReport({ from: start, to: end, accountId });
        if (active) setState({ key: queryKey, data, error: '' });
      } catch {
        if (active) setState({ key: queryKey, data: null, error: 'לא ניתן לטעון את דוח החיסכון. נסו שוב.' });
      }
    };
    load();
    return () => { active = false; };
  }, [start, end, accountId, queryKey]);
  useEffect(() => {
    const refresh = () => setVersion(v => v + 1);
    window.addEventListener('finance:savings-changed', refresh);
    window.addEventListener('finance:cash-changed', refresh);
    return () => { window.removeEventListener('finance:savings-changed', refresh); window.removeEventListener('finance:cash-changed', refresh); };
  }, []);
  const loading = state.key !== queryKey;
  const data = loading ? null : state.data;
  const error = loading ? '' : state.error;
  if (!loading && !error && !data?.accounts.length) return null;
  const metric = (label, value) => <div key={label}><dt>{label}</dt><dd><MoneyAmount value={value} /></dd></div>;
  const cashLink = kind => `/transactions?from=${start}&to=${end}&savingsFlow=${kind}${accountId ? `&savingsAccountId=${accountId}` : ''}`;
  return <GlassCard className="savings-report" padding="20px" dir="rtl">
    <div className="savings-report-heading"><h2>חיסכון ותזרים בתקופה</h2><SecondaryButton as={Link} size="sm" to="/savings">לחשבונות החיסכון</SecondaryButton></div>
    {selectable && <TextField type="month" label="חודש דוח החיסכון" value={month} onValueChange={value => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && !value.startsWith('0000')) setMonth(value); }} />}
    <p className="savings-report-note">{formatCalendarDate(start)} – {formatCalendarDate(end)} · כולל פעילות חשבונות בארכיון</p>
    {loading ? <Skeleton height={100} /> : error ? <><Alert variant="error">{error}</Alert><SecondaryButton onClick={() => setVersion(v => v + 1)}>טעינה חוזרת</SecondaryButton></> : data && <>
      <dl className="savings-report-metrics">
        {metric('יתרת חיסכון נוכחית — כל תקופת המעקב', data.current_balance)}
        {metric('הפקדות בתקופה (ללא יתרות פתיחה)', data.period.deposits)}
        {metric('משיכות בתקופה', data.period.withdrawals)}
        {metric('ריבית נטו שמומשה בתקופה', data.period.realized_interest)}
      </dl>
      <details open={expanded}><summary onClick={event => { event.preventDefault(); setExpanded(value => !value); }}>פירוט והתאמה לתנועות הכספיות</summary>
        <p>היתרה הנוכחית אינה יתרה לסוף התקופה. הפקדות, משיכות וריבית לפי תאריך האירוע המתוקן; תזרים לפי תאריך התנועה, ולא לפי מועד חיוב בנקאי. זהו דוח תנועות, לא יתרת בנק.</p>
        <dl className="savings-report-metrics">
          {metric('ריבית שנשארה בחיסכון — ללא הכנסה כספית', data.period.capitalized_interest)}
          {metric('ריבית ששולמה לעו״ש', data.period.paid_out_interest)}
        </dl>
        <p>הוצאות שאינן הפקדות <MoneyAmount value={data.cash.ordinary_expenses} /> + הפקדות <MoneyAmount value={data.cash.deposits} /> = סך הוצאות כספיות <MoneyAmount value={data.cash.expenses} />.</p>
        <p>הכנסות אחרות <MoneyAmount value={data.cash.other_income} /> + משיכות <MoneyAmount value={data.cash.withdrawals} /> + ריבית לעו״ש <MoneyAmount value={data.cash.paid_out_interest} /> = סך הכנסות כספיות <MoneyAmount value={data.cash.income} />.</p>
        <p>מתוך ההפקדות, <MoneyAmount value={data.cash.funded_deposits} /> הן העברות עודף ממומן. הן כלולות בתזרים והוחרגו מהוצאות המעטפת בלבד. משיכות וריבית לעו״ש יחד: <MoneyAmount value={addMoney(data.cash.withdrawals, data.cash.paid_out_interest)} />. רזרבת התקציב הישנה אינה נכס חיסכון בדוח זה.</p>
        <div className="savings-report-links">{[['ordinary_expense','הוצאות אחרות'],['deposit','הפקדות'],['withdrawal','משיכות'],['interest_payout','ריבית לעו״ש']].map(([kind,label]) => <SecondaryButton as={Link} size="sm" key={kind} to={cashLink(kind)}>{label}</SecondaryButton>)}</div>
        {data.accounts.length > 1 && <Select label="פירוט לפי חשבון" value={selected} onValueChange={setSelected}><option value="">כל החשבונות</option>{data.accounts.map(a => <option key={a.account_id} value={a.account_id}>{a.name}{a.status === 'archived' ? ' (בארכיון)' : ''}</option>)}</Select>}
        <ul className="savings-report-accounts">{data.accounts.filter(a => !selected || a.account_id === selected).map(a => <li key={a.account_id}><Link to={`/savings?accountId=${a.account_id}`}>{a.name}</Link>{a.status === 'archived' && ' · בארכיון'}<p>יתרה נוכחית <MoneyAmount value={a.current_balance} /> · הפקדות בתקופה <MoneyAmount value={a.deposits} /> · משיכות <MoneyAmount value={a.withdrawals} /> · ריבית <MoneyAmount value={a.realized_interest} /></p></li>)}</ul>
      </details>
    </>}
  </GlassCard>;
}
