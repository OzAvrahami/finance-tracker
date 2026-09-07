const { isValidDateString } = require('./transactionQuery');

function normalizeShoppingListFields(body) {
  const values = {};
  for (const field of ['store', 'link', 'target_date']) {
    if (body[field] === undefined) continue; // Older clients and partial updates preserve stored values.
    const input = body[field];
    if (input !== null && typeof input !== 'string') {
      return { error: field === 'target_date' ? 'יש להזין תאריך יעד תקין בפורמט YYYY-MM-DD' : `יש להזין ${field === 'store' ? 'שם חנות' : 'קישור'} כטקסט` };
    }
    values[field] = input?.trim() || null;
  }
  if (values.link) {
    try {
      const url = new URL(values.link);
      if (!/^https?:\/\//i.test(values.link) || !['http:', 'https:'].includes(url.protocol)
        || !url.hostname || url.username || url.password || /[\p{Cc}\s]/u.test(values.link)) throw new Error('invalid');
    } catch {
      return { error: 'יש להזין קישור מלא שמתחיל ב־https:// או http://, ללא רווחים או פרטי התחברות' };
    }
  }
  if (values.target_date && (!isValidDateString(values.target_date) || values.target_date.startsWith('0000-'))) {
    return { error: 'יש להזין תאריך יעד תקין בפורמט YYYY-MM-DD' };
  }
  return { values };
}

module.exports = { normalizeShoppingListFields };
