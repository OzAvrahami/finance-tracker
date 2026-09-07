import { isCalendarDate } from '../../utils/calendarDate';

export const safeShoppingLink = (value) => {
  if (typeof value !== 'string') return null;
  const link = value.trim();
  try {
    const url = new URL(link);
    if (!/^https?:\/\//i.test(link) || !['http:', 'https:'].includes(url.protocol)
      || !url.hostname || url.username || url.password || /[\p{Cc}\s]/u.test(link)) return null;
    return link;
  } catch { return null; }
};

export const shoppingListFieldErrors = ({ link, target_date }) => ({
  link: link.trim() && !safeShoppingLink(link)
    ? 'יש להזין קישור מלא שמתחיל ב־https:// או http://, ללא רווחים או פרטי התחברות' : undefined,
  target_date: target_date.trim() && !isCalendarDate(target_date.trim())
    ? 'יש לבחור תאריך יעד תקין' : undefined,
});
