import { currentBusinessDate, isCalendarDate } from '../../utils/calendarDate';
import { compareMoney } from '../../utils/money';

export const textFields = ['name', 'purpose', 'institution_name', 'product_name', 'reference', 'terms', 'liquidity_notes', 'notes'];
export const optionalFields = ['target_amount', 'target_date', 'annual_interest_rate', 'release_date', 'monthly_amount', 'monthly_day', 'plan_start_date', 'default_payment_source_id'];
export const initialSavingsForm = (account) => Object.fromEntries(
  [...textFields, ...optionalFields, 'opened_on', 'tracking_start_date', 'opening_amount', 'legacy_overlap_amount', 'overlap_reason']
    .map((key) => [key, account?.[key] == null ? '' : String(account[key])]),
);
const validMoney = (value, positive = false) => /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)
  && compareMoney(value, '9999999999999999.99') <= 0 && (!positive || compareMoney(value) > 0);
export const savingsFormError = (form, editing, confirmed, today = currentBusinessDate()) => {
  if (!form.name.trim() || form.name.trim().length > 200) return 'יש להזין שם חיסכון באורך עד 200 תווים';
  if (!editing && (!isCalendarDate(form.opened_on) || !isCalendarDate(form.tracking_start_date)
      || form.opened_on > form.tracking_start_date || form.tracking_start_date > today)) return 'תאריך הפתיחה חייב להיות עד תחילת המעקב, ולא בעתיד';
  if (!editing && (!confirmed || !validMoney(form.opening_amount) || !validMoney(form.legacy_overlap_amount))) return 'יש לאשר יתרת פתיחה וחפיפה לרזרבה במפורש, גם כאשר הסכום אפס';
  if (!editing && (compareMoney(form.legacy_overlap_amount, form.opening_amount) > 0
      || (compareMoney(form.legacy_overlap_amount) > 0 && !form.overlap_reason.trim()))) return 'החפיפה לא יכולה לעלות על יתרת הפתיחה; חפיפה חיובית מחייבת הסבר';
  for (const key of ['target_amount', 'monthly_amount']) if (form[key] && !validMoney(form[key], true)) return 'סכום יעד או תוכנית חייב להיות חיובי, עם עד שתי ספרות אחרי הנקודה';
  for (const key of ['target_date', 'release_date', 'plan_start_date']) if (form[key] && !isCalendarDate(form[key])) return 'יש להזין תאריך לוח שנה תקין';
  if (form.target_date && form.target_date < form.tracking_start_date) return 'תאריך היעד חייב להיות מתחילת המעקב והלאה';
  if (form.release_date && form.release_date < form.opened_on) return 'מועד הנזילות חייב להיות מתאריך הפתיחה והלאה';
  if (form.annual_interest_rate && (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(form.annual_interest_rate)
      || Number(form.annual_interest_rate) > 100)) return 'ריבית תיאורית חייבת להיות בין 0 ל־100, עם עד שש ספרות עשרוניות';
  const plan = [form.monthly_amount, form.monthly_day, form.plan_start_date];
  if (plan.some(Boolean) && (!plan.every(Boolean) || !/^([1-9]|[12][0-9]|3[01])$/.test(form.monthly_day)
      || form.plan_start_date < form.tracking_start_date)) return 'לתוכנית יש להזין סכום, יום 1–31 ותאריך התחלה מתחילת המעקב והלאה';
  return '';
};
export const savingsPayload = (form, editing) => {
  const account = Object.fromEntries([...textFields, ...optionalFields].map((key) => [key, form[key].trim() || null]));
  account.name = form.name.trim();
  if (!editing) Object.assign(account, { opened_on: form.opened_on, tracking_start_date: form.tracking_start_date });
  return editing ? { account } : { account, opening_amount: form.opening_amount,
    legacy_overlap_amount: form.legacy_overlap_amount, overlap_reason: form.overlap_reason.trim() || null };
};
