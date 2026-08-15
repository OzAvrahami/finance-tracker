const CENT_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidIsoDate = (value) => {
  if (!ISO_DATE_PATTERN.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

export const addCalendarMonthIso = (value) => {
  if (!isValidIsoDate(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const targetYear = month === 12 ? year + 1 : year;
  const targetMonth = month === 12 ? 1 : month + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return [
    targetYear,
    String(targetMonth).padStart(2, '0'),
    String(Math.min(day, lastDay)).padStart(2, '0'),
  ].join('-');
};

const toCents = (value) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!CENT_AMOUNT_PATTERN.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, '0'));
};

export const validateManualLoanPayment = ({
  total,
  principal,
  interest,
  other,
  nextScheduledDueDate,
  requiresNextScheduledDate = false,
}) => {
  const totalCents = toCents(total);
  const principalCents = toCents(principal);
  const interestCents = toCents(interest);
  const otherCents = toCents(other);

  if ([principalCents, interestCents, otherCents].some((value) => value === null)) {
    return 'יש להזין קרן, ריבית ואחר בסכומים לא־שליליים ועד שתי ספרות אחרי הנקודה.';
  }
  if (totalCents === null || totalCents <= 0n) {
    return 'סכום התנועה חייב להיות גדול מאפס.';
  }
  if (principalCents + interestCents + otherCents !== totalCents) {
    return 'סכום הקרן, הריבית והאחר חייב להיות שווה בדיוק לסכום התנועה.';
  }
  if (requiresNextScheduledDate && !nextScheduledDueDate) {
    return 'יש להזין את מועד התשלום הבא לפי לוח הסילוקין של הבנק.';
  }
  if (nextScheduledDueDate && !isValidIsoDate(nextScheduledDueDate)) {
    return 'מועד התשלום הבא אינו תאריך תקין.';
  }
  return '';
};
