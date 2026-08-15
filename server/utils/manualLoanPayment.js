const { fromMinorUnits, toMinorUnits } = require('./transactionPricing');

const HANDLING_MODES = new Set(['link_only', 'repayment']);
const CENT_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeOptionalDate = (value, fieldName) => {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!ISO_DATE_PATTERN.test(text)) {
    throw new Error(`${fieldName} must be an ISO date`);
  }
  const [year, month, day] = text.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return text;
};

const parseComponent = (value, fieldName) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!CENT_AMOUNT_PATTERN.test(text)) {
    throw new Error(`${fieldName} must be a non-negative amount with at most two decimal places`);
  }
  return toMinorUnits(text, fieldName);
};

const normalizeLoanHandling = ({ transaction, loanHandling }) => {
  const mode = loanHandling?.mode || 'link_only';
  if (!HANDLING_MODES.has(mode)) {
    throw new Error('Invalid loan handling mode');
  }

  if (mode === 'link_only') {
    return { mode, payment: null };
  }

  if (transaction.loan_id === null
    || transaction.loan_id === undefined
    || transaction.loan_id === '') {
    throw new Error('A loan must be selected for a loan repayment');
  }

  const principal = parseComponent(loanHandling.principal_amount, 'principal_amount');
  const interest = parseComponent(loanHandling.interest_amount, 'interest_amount');
  const other = parseComponent(loanHandling.other_amount ?? 0, 'other_amount');
  const total = toMinorUnits(transaction.total_amount, 'total_amount');

  if (total <= 0n) {
    throw new Error('Loan repayment total must be positive');
  }
  if (principal + interest + other !== total) {
    throw new Error('Loan repayment components do not reconcile with transaction total');
  }
  if (!Object.prototype.hasOwnProperty.call(loanHandling, 'next_scheduled_due_date')) {
    throw new Error('next_scheduled_due_date must be supplied for a loan repayment');
  }

  return {
    mode,
    payment: {
      principal_amount: fromMinorUnits(principal),
      interest_amount: fromMinorUnits(interest),
      other_amount: fromMinorUnits(other),
      next_scheduled_due_date: normalizeOptionalDate(
        loanHandling.next_scheduled_due_date,
        'next_scheduled_due_date',
      ),
    },
  };
};

module.exports = {
  normalizeLoanHandling,
};
