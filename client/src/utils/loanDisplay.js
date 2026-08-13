const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;
const MONEY_SCALE = 10;
const SCALE_FACTOR = 10n ** BigInt(MONEY_SCALE);
const CENT_FACTOR = 10n ** BigInt(MONEY_SCALE - 2);

const toScaled = (value) => {
  const match = DECIMAL_PATTERN.exec(String(value ?? 0).trim());
  if (!match) return 0n;
  const fraction = (match[3] || '').padEnd(MONEY_SCALE, '0').slice(0, MONEY_SCALE);
  const amount = (BigInt(match[2]) * SCALE_FACTOR) + BigInt(fraction || '0');
  return match[1] === '-' ? -amount : amount;
};

const scaledToMoney = (value) => {
  const positive = value > 0n ? value : 0n;
  const cents = (positive + (CENT_FACTOR / 2n)) / CENT_FACTOR;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
};

export const isClosedLoan = (loan) => (
  loan?.status === 'paid'
  || Boolean(loan?.closed_date)
  || Number(loan?.current_balance) <= 0
);

export const isActiveLoan = (loan) => !isClosedLoan(loan)
  && Number(loan?.current_balance) > 0;

export const hasEarlyPayoff = (loanOrPayments) => {
  const payments = Array.isArray(loanOrPayments)
    ? loanOrPayments
    : loanOrPayments?.loan_payments;
  return Array.isArray(payments)
    && payments.some((payment) => payment.payment_kind === 'early_payoff');
};

export const countRegularLoanPayments = (loanOrPayments) => {
  const payments = Array.isArray(loanOrPayments)
    ? loanOrPayments
    : loanOrPayments?.loan_payments;
  return Array.isArray(payments)
    ? payments.filter((payment) => payment.payment_kind === 'installment').length
    : 0;
};

export const formatLoanDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '−';
};

export const buildLoanPaymentHistory = (loan, payments = []) => {
  let balance = toScaled(loan?.original_amount);
  return [...payments]
    .sort((left, right) => (
      String(left.payment_date).localeCompare(String(right.payment_date))
      || Number(left.id) - Number(right.id)
    ))
    .map((payment) => {
      balance -= toScaled(payment.principal_amount);
      balance -= toScaled(payment.balance_adjustment_amount);
      if (balance < 0n) balance = 0n;
      return { ...payment, running_balance: scaledToMoney(balance) };
    });
};
