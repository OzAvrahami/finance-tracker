const { SSF } = require('xlsx');
const { isValidDateString } = require('./transactionQuery');

// CSV date text follows the profiles' day/month/year convention. Actual
// spreadsheet numeric dates use their workbook epoch, never locale guessing.
function importDate(value, { date1904 = false, optional = false, field = 'transaction_date' } = {}) {
  if (optional && (value == null || value === '')) return value;
  let result;
  if (typeof value === 'string') {
    const text = value.trim();
    const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
    result = parts
      ? `${parts[3].length === 2 ? `20${parts[3]}` : parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
      : text;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const parts = SSF.parse_date_code(value, { date1904 });
    if (parts) result = `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
  } else if (value instanceof Date && Number.isFinite(value.getTime())) {
    result = value.toISOString().slice(0, 10);
  }
  if (!isValidDateString(result)) {
    throw Object.assign(new Error(`Invalid ${field}`), { status: 400 });
  }
  return result;
}

module.exports = { importDate };
