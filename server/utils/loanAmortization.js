const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

const pow10 = (places) => 10n ** BigInt(places);

const toScaled = (value, places) => {
  const match = DECIMAL_PATTERN.exec(String(value));
  if (!match) throw new Error(`Invalid decimal value: ${value}`);

  const negative = match[1] === '-';
  const fraction = match[3] || '';
  const padded = (fraction + '0'.repeat(places + 1)).slice(0, places + 1);
  let scaled = BigInt(match[2]) * pow10(places)
    + BigInt((padded.slice(0, places) || '0'));

  if (padded[places] >= '5') scaled += 1n;
  return negative ? -scaled : scaled;
};

const roundDivide = (numerator, denominator) => {
  if (denominator <= 0n) throw new Error('Denominator must be positive');
  if (numerator < 0n) return -roundDivide(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
};

const formatScaled = (value, places) => {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const digits = magnitude.toString().padStart(places + 1, '0');
  const integer = places === 0 ? digits : digits.slice(0, -places);
  const fraction = places === 0 ? '' : `.${digits.slice(-places)}`;
  return `${negative ? '-' : ''}${integer}${fraction}`;
};

const calculateFixedSchedule = ({
  originalAmount,
  paymentAmount,
  annualInterestRate,
  installments,
}) => {
  let balanceCents = toScaled(originalAmount, 2);
  const paymentCents = toScaled(paymentAmount, 2);
  const rateScale = 6;
  const rate = toScaled(annualInterestRate, rateScale);
  const rateDenominator = 1200n * pow10(rateScale);
  const rows = [];

  for (let installment = 1; installment <= installments; installment += 1) {
    const openingCents = balanceCents;
    const interestCents = roundDivide(openingCents * rate, rateDenominator);
    const principalCents = paymentCents - interestCents;
    if (principalCents < 0n) throw new Error('Payment is less than monthly interest');
    balanceCents -= principalCents;
    rows.push({
      installmentNumber: installment,
      paymentAmount: formatScaled(paymentCents, 2),
      principalAmount: formatScaled(principalCents, 2),
      interestAmount: formatScaled(interestCents, 2),
      closingBalance: formatScaled(balanceCents, 2),
    });
  }

  return rows;
};

const calculateVariableSchedule = ({ originalAmount, periods }) => {
  const amountScale = 10;
  const rateScale = 6;
  let balance = toScaled(originalAmount, amountScale);
  const rows = [];
  let installmentNumber = 0;

  periods.forEach(({ count, paymentAmount, annualInterestRate }) => {
    const payment = toScaled(paymentAmount, amountScale);
    const rate = toScaled(annualInterestRate, rateScale);
    const denominator = 1200n * pow10(rateScale);

    for (let index = 0; index < count; index += 1) {
      installmentNumber += 1;
      const opening = balance;
      const interest = roundDivide(opening * rate, denominator);
      const principal = payment - interest;
      if (principal < 0n) throw new Error('Payment is less than monthly interest');
      balance -= principal;
      rows.push({
        installmentNumber,
        paymentAmount: formatScaled(payment, amountScale),
        principalAmount: formatScaled(principal, amountScale),
        interestAmount: formatScaled(interest, amountScale),
        closingBalance: formatScaled(balance, amountScale),
      });
    }
  });

  return rows;
};

const summarizeSchedule = (rows) => {
  const scale = 10;
  const sum = (field) => rows.reduce(
    (total, row) => total + toScaled(row[field], scale),
    0n,
  );

  return {
    paymentAmount: formatScaled(sum('paymentAmount'), scale),
    principalAmount: formatScaled(sum('principalAmount'), scale),
    interestAmount: formatScaled(sum('interestAmount'), scale),
    closingBalance: rows.length === 0 ? null : rows.at(-1).closingBalance,
  };
};

const summarizeLoanPayments = ({ originalAmount, totalInstallments, payments }) => {
  const scale = 10;
  const original = toScaled(originalAmount, scale);
  const paidPrincipal = payments.reduce(
    (total, payment) => total + toScaled(payment.principalAmount, scale),
    0n,
  );
  const balance = original > paidPrincipal ? original - paidPrincipal : 0n;
  const balanceCents = roundDivide(balance, pow10(scale - 2));

  return {
    currentBalance: formatScaled(balanceCents, 2),
    remainingInstallments: Math.max(totalInstallments - payments.length, 0),
  };
};

const calculateOutstandingPrincipal = ({ originalAmount, payments }) => {
  const scale = 10;
  const original = toScaled(originalAmount, scale);
  const paidPrincipal = payments.reduce(
    (total, payment) => total + toScaled(payment.principalAmount, scale),
    0n,
  );
  return formatScaled(original > paidPrincipal ? original - paidPrincipal : 0n, scale);
};

const calculateDueLoanPayment = ({
  openingPrincipal,
  paymentAmount,
  annualInterestRate,
  interestType,
  isFinalInstallment = false,
}) => {
  const rateScale = 6;
  const rate = toScaled(annualInterestRate, rateScale);
  const rateDenominator = 1200n * pow10(rateScale);

  if (interestType === 'fixed') {
    const opening = toScaled(openingPrincipal, 2);
    const scheduledPayment = toScaled(paymentAmount, 2);
    const calculatedInterest = roundDivide(opening * rate, rateDenominator);
    let payment = scheduledPayment;
    let principal = scheduledPayment - calculatedInterest;
    let interest = calculatedInterest;

    if (isFinalInstallment) {
      principal = opening;
      if (scheduledPayment >= principal) {
        interest = scheduledPayment - principal;
      } else {
        interest = calculatedInterest;
        payment = principal + interest;
      }
    }

    if (principal < 0n || interest < 0n) {
      throw new Error('Payment is less than monthly interest');
    }

    const closing = opening > principal ? opening - principal : 0n;
    return {
      openingPrincipal: formatScaled(opening * pow10(8), 10),
      paymentAmount: formatScaled(payment, 2),
      principalAmount: formatScaled(principal * pow10(8), 10),
      interestAmount: formatScaled(interest * pow10(8), 10),
      closingBalance: formatScaled(closing * pow10(8), 10),
    };
  }

  const scale = 10;
  const opening = toScaled(openingPrincipal, scale);
  const scheduledPayment = toScaled(paymentAmount, scale);
  const calculatedInterest = roundDivide(opening * rate, rateDenominator);
  let payment = scheduledPayment;
  let principal = scheduledPayment - calculatedInterest;
  let interest = calculatedInterest;

  if (isFinalInstallment) {
    principal = opening;
    if (scheduledPayment >= principal) {
      interest = scheduledPayment - principal;
    } else {
      const required = opening + calculatedInterest;
      const paymentCents = roundDivide(required, pow10(scale - 2));
      payment = paymentCents * pow10(scale - 2);
      interest = payment - principal;
    }
  }

  if (principal < 0n || interest < 0n) {
    throw new Error('Payment is less than monthly interest');
  }

  return {
    openingPrincipal: formatScaled(opening, scale),
    paymentAmount: formatScaled(roundDivide(payment, pow10(scale - 2)), 2),
    principalAmount: formatScaled(principal, scale),
    interestAmount: formatScaled(interest, scale),
    closingBalance: formatScaled(opening > principal ? opening - principal : 0n, scale),
  };
};

module.exports = {
  calculateDueLoanPayment,
  calculateFixedSchedule,
  calculateOutstandingPrincipal,
  calculateVariableSchedule,
  summarizeLoanPayments,
  summarizeSchedule,
};
