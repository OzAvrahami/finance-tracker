// Date-only business values stay calendar dates, never UTC timestamps.
export const isCalendarDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
};

export const currentBusinessDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('-');
};

export const formatCalendarDate = (value) => {
  if (!isCalendarDate(value)) return '−';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};
