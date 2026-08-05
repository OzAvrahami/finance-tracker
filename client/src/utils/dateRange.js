/**
 * Shared month/date-range helpers.
 *
 * Single owner for "what are the boundaries of a month" on the client. This
 * math was previously rewritten inline in Transactions.jsx (twice) and implied
 * again by the Dashboard's month filtering, which is exactly the duplication
 * the project rules call out for monthly date calculations.
 *
 * Everything here works in LOCAL time and formats to 'YYYY-MM-DD'.
 * Date.toISOString() is deliberately never used: it converts to UTC first, so
 * for a user east of Greenwich the 1st of the month can come back as the last
 * day of the previous month and silently shift a whole financial period.
 */

/** Formats a Date as local-time 'YYYY-MM-DD'. */
export const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Inclusive first/last day of the month containing `date`.
 * Day 0 of the next month is the last day of this one, which also handles
 * February and leap years without special cases.
 */
export const getMonthRange = (date = new Date()) => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: formatLocalDate(start), end: formatLocalDate(end) };
};

/** Inclusive first/last day of the month `offset` months away from `date`. */
export const getRelativeMonthRange = (offset, date = new Date()) =>
  getMonthRange(new Date(date.getFullYear(), date.getMonth() + offset, 1));

/** Inclusive first/last day of the year containing `date`. */
export const getYearRange = (date = new Date()) => ({
  start: formatLocalDate(new Date(date.getFullYear(), 0, 1)),
  end: formatLocalDate(new Date(date.getFullYear(), 11, 31)),
});
