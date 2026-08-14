const supabase = require('../config/supabase');
const {
  calculateDueLoanPayment,
  calculateOutstandingPrincipal,
} = require('../utils/loanAmortization');

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOAN_CATEGORY_NAMES = ['הלוואות', 'הלוואה', 'Loans', 'Loan'];

const getJerusalemDate = (instant = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const assertIsoDate = (value) => {
  if (!ISO_DATE_PATTERN.test(String(value))) {
    throw new Error('today must be an ISO date in YYYY-MM-DD format');
  }
  return String(value);
};

const isEligibleDueLoan = (loan, today) => loan.calculation_mode === 'loan_payments'
  && loan.status === 'active'
  && loan.auto_payment_enabled === true
  // CPI-linked principal/payment calculation is intentionally unsupported until
  // an authoritative index feed and indexation engine exist.
  && (loan.indexation_type ?? 'none') === 'none'
  && Number(loan.remaining_installments) > 0
  && typeof loan.next_payment_date === 'string'
  && loan.next_payment_date <= today;

const resolveLoanPaymentCategoryId = async (supabaseClient) => {
  const { data, error } = await supabaseClient
    .from('categories')
    .select('id,name,type,is_active')
    .eq('type', 'expense')
    .eq('is_active', true);

  if (error) throw error;
  const categories = Array.isArray(data) ? data : [];
  const category = LOAN_CATEGORY_NAMES
    .map((name) => categories.find((candidate) => candidate.name === name))
    .find(Boolean);

  if (!category) {
    throw new Error('An active loan-payment expense category is required');
  }
  return category.id;
};

const fetchDueLoans = async (supabaseClient, today) => {
  const { data, error } = await supabaseClient
    .from('loans')
    .select([
      'id',
      'name',
      'original_amount',
      'monthly_payment',
      'interest_rate',
      'interest_type',
      'indexation_type',
      'total_installments',
      'remaining_installments',
      'status',
      'calculation_mode',
      'auto_payment_enabled',
      'next_payment_date',
      'payment_source_id',
    ].join(','))
    .eq('calculation_mode', 'loan_payments')
    .eq('status', 'active')
    .eq('auto_payment_enabled', true)
    .eq('indexation_type', 'none')
    .gt('remaining_installments', 0)
    .not('next_payment_date', 'is', null)
    .lte('next_payment_date', today)
    .order('next_payment_date', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

const fetchLoanPayments = async (supabaseClient, loanId) => {
  const { data, error } = await supabaseClient
    .from('loan_payments')
    .select([
      'id',
      'transaction_id',
      'installment_number',
      'payment_date',
      'payment_amount',
      'principal_amount',
      'interest_amount',
      'annual_interest_rate',
      'source_kind',
      'payment_kind',
      'installments_covered',
      'other_amount',
      'balance_adjustment_amount',
    ].join(','))
    .eq('loan_id', loanId)
    .order('payment_date', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

const validateAccountingState = (loan, payments) => {
  const installments = [];
  let coveredInstallments = 0;
  payments.forEach((payment) => {
    const kind = payment.payment_kind;
    if (kind === 'balance_adjustment') return;
    if (kind === 'early_payoff') return;
    if (kind === 'irregular_payment') return;
    const covered = Number(payment.installments_covered);
    if (!Number.isInteger(covered) || covered < 1) {
      throw new Error('Loan payment installment coverage is invalid');
    }
    if (kind === 'catch_up') {
      coveredInstallments += covered;
      return;
    }
    if (kind !== 'installment' || covered !== 1) {
      throw new Error('Loan payment kind is invalid for automatic processing');
    }
    const installmentNumber = Number(payment.installment_number);
    if (!Number.isInteger(installmentNumber)
      || installmentNumber !== coveredInstallments + 1) {
      throw new Error('Loan payment installments are not contiguous');
    }
    installments.push(payment);
    coveredInstallments += 1;
  });

  const totalInstallments = Number(loan.total_installments);
  const remainingInstallments = Number(loan.remaining_installments);
  if (!Number.isInteger(totalInstallments) || totalInstallments <= 0) {
    throw new Error('Loan total installments are invalid');
  }
  if (coveredInstallments > totalInstallments) {
    throw new Error('Loan payment coverage exceeds total installments');
  }
  if (remainingInstallments !== totalInstallments - coveredInstallments) {
    throw new Error('Loan remaining-installment summary has drifted');
  }

  return {
    totalInstallments,
    installments,
    coveredInstallments,
    nextInstallmentNumber: coveredInstallments + 1,
  };
};

const normalizeRpcResult = (data) => (Array.isArray(data) ? data[0] : data) || {};

const processDueLoanPayments = async ({
  today = getJerusalemDate(),
  supabaseClient = supabase,
  logger = console,
} = {}) => {
  const businessDate = assertIsoDate(today);
  const candidates = await fetchDueLoans(supabaseClient, businessDate);
  const summary = {
    today: businessDate,
    processed: 0,
    alreadyProcessed: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  let categoryId;
  for (const loan of candidates) {
    if (!isEligibleDueLoan(loan, businessDate)) {
      summary.skipped += 1;
      continue;
    }

    try {
      const payments = await fetchLoanPayments(supabaseClient, loan.id);
      const accounting = validateAccountingState(loan, payments);
      const dueDatePayments = accounting.installments.filter(
        (payment) => payment.payment_date === loan.next_payment_date,
      );
      if (dueDatePayments.length > 1) {
        throw new Error('Multiple loan payments share the current due date');
      }

      let installmentNumber = accounting.nextInstallmentNumber;
      let payment;
      if (dueDatePayments.length === 1) {
        const existing = dueDatePayments[0];
        if (Number(existing.installment_number) !== accounting.coveredInstallments) {
          throw new Error('A non-latest loan payment matches the current due date');
        }
        installmentNumber = Number(existing.installment_number);
        payment = {
          paymentAmount: String(existing.payment_amount),
          principalAmount: String(existing.principal_amount),
          interestAmount: String(existing.interest_amount),
        };
      } else {
        const openingPrincipal = calculateOutstandingPrincipal({
          originalAmount: loan.original_amount,
          payments: payments.map((row) => ({
            principalAmount: row.principal_amount,
            balanceAdjustmentAmount: row.balance_adjustment_amount,
          })),
        });
        payment = calculateDueLoanPayment({
          openingPrincipal,
          paymentAmount: loan.monthly_payment,
          annualInterestRate: loan.interest_rate,
          interestType: loan.interest_type,
          isFinalInstallment: installmentNumber === accounting.totalInstallments,
        });
      }

      if (categoryId === undefined) {
        categoryId = await resolveLoanPaymentCategoryId(supabaseClient);
      }
      const { data, error } = await supabaseClient.rpc('create_due_loan_payment', {
        p_loan_id: loan.id,
        p_expected_due_date: loan.next_payment_date,
        p_expected_installment_number: installmentNumber,
        p_payment_amount: payment.paymentAmount,
        p_principal_amount: payment.principalAmount,
        p_interest_amount: payment.interestAmount,
        p_annual_interest_rate: loan.interest_rate,
        p_category_id: categoryId,
      });
      if (error) throw error;

      const result = normalizeRpcResult(data);
      if (result.status === 'already_processed') {
        summary.alreadyProcessed += 1;
      } else if (result.status === 'processed') {
        summary.processed += 1;
      } else {
        throw new Error('Due-loan RPC returned an unknown status');
      }
      summary.results.push({
        loanId: loan.id,
        dueDate: loan.next_payment_date,
        status: result.status,
        installmentNumber: result.installment_number,
        transactionId: result.transaction_id,
        loanPaymentId: result.loan_payment_id,
        nextPaymentDate: result.next_payment_date,
      });
    } catch (error) {
      summary.failed += 1;
      summary.results.push({
        loanId: loan.id,
        dueDate: loan.next_payment_date,
        status: 'failed',
        error: error.message,
      });
      logger.error('Due loan payment failed', {
        loanId: loan.id,
        dueDate: loan.next_payment_date,
        message: error.message,
      });
    }
  }

  return summary;
};

module.exports = {
  getJerusalemDate,
  processDueLoanPayments,
};
