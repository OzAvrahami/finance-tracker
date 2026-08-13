import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3 } from 'lucide-react';
import { getLoanDetails } from '../../services/api';
import {
  Drawer,
  MoneyAmount,
  ProgressBar,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TechnicalValue,
} from '../../components/ui';
import {
  buildLoanPaymentHistory,
  countRegularLoanPayments,
  formatLoanDate,
  hasEarlyPayoff,
  isClosedLoan,
} from '../../utils/loanDisplay';

const valueOrDash = (value) => (value === null || value === undefined || value === '' ? '−' : value);

const loanTypeLabels = {
  bank_loan: 'הלוואה בנקאית',
  cal_express: 'כאל אקספרס',
};

const amortizationLabels = {
  spitzer: 'שפיצר',
  balloon: 'בלון / בוליט',
  grace: 'גרייס',
};

const interestLabels = {
  fixed: 'ריבית קבועה',
  prime: 'פריים / משתנה',
  cpi_linked: 'צמודת מדד',
};

const sourceLabels = {
  existing_transaction: 'מתנועה קיימת',
  reconstructed: 'שוחזר',
  manual: 'ידני',
  generated: 'אוטומטי',
};

const OverviewItem = ({ label, children }) => (
  <div>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

const StatusBadge = ({ loan, earlyPayoff }) => {
  if (earlyPayoff) return <span className="loan-status-badge is-early">נפרעה מוקדם</span>;
  if (isClosedLoan(loan)) return <span className="loan-status-badge is-paid">נפרעה</span>;
  if (loan.status === 'defaulted') return <span className="loan-status-badge is-warning">בפיגור</span>;
  return <span className="loan-status-badge is-active">פעילה</span>;
};

const LoanDetailsDrawer = ({ loan: summaryLoan, open, onClose, returnFocusRef }) => {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !summaryLoan?.id) return undefined;
    let current = true;

    getLoanDetails(summaryLoan.id)
      .then((response) => {
        if (current) setDetails(response.data);
      })
      .catch(() => {
        if (current) setError('לא ניתן לטעון את פרטי ההלוואה כרגע.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => { current = false; };
  }, [open, summaryLoan?.id]);

  const loan = details?.loan || summaryLoan;
  const payments = useMemo(() => details?.loan_payments || [], [details]);
  const transactions = details?.related_transactions || [];
  const paymentRows = useMemo(
    () => buildLoanPaymentHistory(loan, payments),
    [loan, payments],
  );
  const paymentTransactionIds = useMemo(
    () => new Set(payments.map((payment) => Number(payment.transaction_id)).filter(Boolean)),
    [payments],
  );
  const earlyPayoff = hasEarlyPayoff(payments)
    || (!details && hasEarlyPayoff(summaryLoan));
  const regularPayments = countRegularLoanPayments(payments.length ? payments : summaryLoan);
  const regularPaymentsLabel = loan?.calculation_mode === 'legacy' && payments.length === 0
    ? '−'
    : `${regularPayments} מתוך ${valueOrDash(loan?.total_installments)}`;
  const original = Number(loan?.original_amount) || 0;
  const balance = Number(loan?.current_balance) || 0;
  const progress = original > 0
    ? Math.min(100, Math.max(0, ((original - balance) / original) * 100))
    : 0;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={loan?.name || 'פרטי הלוואה'}
      description={loan?.lender_name || 'מידע מלא על ההלוואה'}
      side="start"
      size="lg"
      className="loan-details-drawer"
      returnFocusRef={returnFocusRef}
      closeLabel="סגירת פרטי ההלוואה"
    >
      {loading && (
        <div className="loan-details-loading" role="status" aria-label="טעינת פרטי הלוואה">
          <Skeleton height={104} borderRadius="16px" />
          <Skeleton height={44} borderRadius="12px" />
          <Skeleton height={260} borderRadius="16px" />
        </div>
      )}

      {!loading && error && (
        <div className="loan-details-error" role="alert">
          <strong>טעינת הפרטים נכשלה</strong>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && details && (
        <>
          <section className="loan-details-hero" aria-label="מצב ההלוואה">
            <div className="loan-details-hero__status">
              {isClosedLoan(loan) ? <CheckCircle2 size={20} aria-hidden="true" /> : <Clock3 size={20} aria-hidden="true" />}
              <StatusBadge loan={loan} earlyPayoff={earlyPayoff} />
            </div>
            <div className="loan-details-hero__amounts">
              <div>
                <span>סכום מקורי</span>
                <MoneyAmount value={loan.original_amount} maximumFractionDigits={2} />
              </div>
              <div>
                <span>יתרה נוכחית</span>
                <MoneyAmount value={loan.current_balance} maximumFractionDigits={2} />
              </div>
            </div>
            {!isClosedLoan(loan) && (
              <ProgressBar
                value={progress}
                height={7}
                aria-label="התקדמות פירעון הקרן"
                aria-valuetext={`${Math.round(progress)}% מהקרן נפרעה`}
              />
            )}
          </section>

          <Tabs defaultValue="overview" className="loan-details-tabs">
            <TabList aria-label="תצוגת פרטי הלוואה">
              <Tab value="overview">סקירה</Tab>
              <Tab value="payments" badge={payments.length}>לוח תשלומים</Tab>
              <Tab value="transactions" badge={transactions.length}>תנועות קשורות</Tab>
            </TabList>

            <TabPanel value="overview" className="loan-details-panel">
              <dl className="loan-details-overview">
                <OverviewItem label="סכום מקורי"><MoneyAmount value={loan.original_amount} maximumFractionDigits={2} /></OverviewItem>
                <OverviewItem label="יתרה נוכחית"><MoneyAmount value={loan.current_balance} maximumFractionDigits={2} /></OverviewItem>
                <OverviewItem label="מלווה">{valueOrDash(loan.lender_name)}</OverviewItem>
                <OverviewItem label="סוג הלוואה">{loanTypeLabels[loan.loan_type] || valueOrDash(loan.loan_type)}</OverviewItem>
                <OverviewItem label="שיטת סילוק">{amortizationLabels[loan.amortization_type] || valueOrDash(loan.amortization_type)}</OverviewItem>
                <OverviewItem label="בסיס ריבית">{interestLabels[loan.interest_type] || valueOrDash(loan.interest_type)}</OverviewItem>
                <OverviewItem label="ריבית נוכחית"><TechnicalValue>{valueOrDash(loan.interest_rate)}{loan.interest_rate != null ? '%' : ''}</TechnicalValue></OverviewItem>
                {loan.interest_type === 'prime' && (
                  <OverviewItem label="מרווח פריים"><TechnicalValue>{valueOrDash(loan.prime_margin)}%</TechnicalValue></OverviewItem>
                )}
                <OverviewItem label="החזר חודשי"><MoneyAmount value={loan.monthly_payment} maximumFractionDigits={2} /></OverviewItem>
                <OverviewItem label="תשלומים רגילים"><TechnicalValue>{regularPaymentsLabel}</TechnicalValue></OverviewItem>
                <OverviewItem label="תשלומים שנותרו"><TechnicalValue>{valueOrDash(loan.remaining_installments)}</TechnicalValue></OverviewItem>
                <OverviewItem label="תחילת הלוואה"><TechnicalValue>{formatLoanDate(loan.start_date)}</TechnicalValue></OverviewItem>
                <OverviewItem label="סיום מתוכנן"><TechnicalValue>{formatLoanDate(loan.end_date)}</TechnicalValue></OverviewItem>
                {isClosedLoan(loan) && (
                  <OverviewItem label="תאריך סגירה בפועל"><TechnicalValue>{formatLoanDate(loan.closed_date)}</TechnicalValue></OverviewItem>
                )}
                {!isClosedLoan(loan) && (
                  <OverviewItem label="התשלום הבא"><TechnicalValue>{formatLoanDate(loan.next_payment_date)}</TechnicalValue></OverviewItem>
                )}
                <OverviewItem label="מקור תשלום">{loan.payment_source?.name || '−'}</OverviewItem>
                {!isClosedLoan(loan) && (
                  <OverviewItem label="תשלום אוטומטי">{loan.auto_payment_enabled ? 'פעיל' : 'כבוי'}</OverviewItem>
                )}
              </dl>
            </TabPanel>

            <TabPanel value="payments" className="loan-details-panel">
              {paymentRows.length === 0 ? (
                <div className="loan-details-empty">אין להלוואה זו היסטוריית תשלומים חשבונאית.</div>
              ) : (
                <div className="loan-payment-list" role="table" aria-label="לוח תשלומי הלוואה">
                  <div className="loan-payment-list__header" role="row">
                    <span role="columnheader">תשלום</span>
                    <span role="columnheader">תאריך</span>
                    <span role="columnheader">סכום</span>
                    <span role="columnheader">קרן</span>
                    <span role="columnheader">ריבית</span>
                    <span role="columnheader">יתרה</span>
                  </div>
                  {paymentRows.map((payment) => (
                    <div
                      key={payment.id}
                      className={`loan-payment-row${payment.payment_kind === 'early_payoff' ? ' is-payoff' : ''}`}
                      role="row"
                    >
                      <div role="cell" className="loan-payment-row__kind">
                        <strong>{payment.payment_kind === 'early_payoff'
                          ? 'פירעון מוקדם'
                          : `${payment.installment_number}/${loan.total_installments}`}</strong>
                        <span>{sourceLabels[payment.source_kind] || payment.source_kind}</span>
                      </div>
                      <TechnicalValue role="cell">{formatLoanDate(payment.payment_date)}</TechnicalValue>
                      <MoneyAmount role="cell" value={payment.payment_amount} maximumFractionDigits={2} />
                      <MoneyAmount role="cell" value={payment.principal_amount} maximumFractionDigits={2} />
                      <MoneyAmount role="cell" value={payment.interest_amount} maximumFractionDigits={2} />
                      <MoneyAmount role="cell" value={payment.running_balance} maximumFractionDigits={2} />
                      {(Number(payment.other_amount) !== 0 || Number(payment.balance_adjustment_amount) !== 0) && (
                        <div className="loan-payment-row__adjustments">
                          {Number(payment.other_amount) !== 0 && (
                            <span>רכיב נוסף: <MoneyAmount value={payment.other_amount} maximumFractionDigits={2} /></span>
                          )}
                          {Number(payment.balance_adjustment_amount) !== 0 && (
                            <span>התאמת יתרה: <MoneyAmount value={payment.balance_adjustment_amount} maximumFractionDigits={2} /></span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabPanel>

            <TabPanel value="transactions" className="loan-details-panel">
              {transactions.length === 0 ? (
                <div className="loan-details-empty">אין תנועות המקושרות להלוואה זו.</div>
              ) : (
                <div className="loan-transaction-list">
                  {transactions.map((transaction) => {
                    const isPayment = paymentTransactionIds.has(Number(transaction.id));
                    return (
                      <article key={transaction.id} className="loan-transaction-row">
                        <div className="loan-transaction-row__main">
                          <strong>{transaction.description || 'תנועה ללא תיאור'}</strong>
                          <span>
                            <TechnicalValue>{formatLoanDate(transaction.charge_date || transaction.transaction_date)}</TechnicalValue>
                            {' · '}{transaction.category?.name || 'ללא קטגוריה'}
                            {' · '}{transaction.payment_source?.name || 'ללא מקור תשלום'}
                          </span>
                        </div>
                        <div className="loan-transaction-row__amount">
                          <MoneyAmount value={transaction.total_amount} maximumFractionDigits={2} />
                          <span className={isPayment ? 'is-payment' : 'is-related'}>
                            {isPayment ? 'תשלום הלוואה' : 'הוצאה קשורה'}
                          </span>
                        </div>
                        {(transaction.installment_number || transaction.installments_info) && (
                          <TechnicalValue className="loan-transaction-row__installment">
                            {transaction.installments_info
                              || `${transaction.installment_number}/${transaction.installment_count}`}
                          </TechnicalValue>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </TabPanel>
          </Tabs>
        </>
      )}
    </Drawer>
  );
};

export default LoanDetailsDrawer;
