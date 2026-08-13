import { ProgressBar, MoneyAmount, TechnicalValue } from './ui';
import {
  countRegularLoanPayments,
  formatLoanDate,
  hasEarlyPayoff,
  isClosedLoan,
} from '../utils/loanDisplay';

const amortizationLabels = {
  spitzer: 'שפיצר',
  balloon: 'בלון / בוליט',
  grace: 'גרייס',
};

const interestLabels = {
  fixed: 'ריבית קבועה',
  prime: 'פריים',
  cpi_linked: 'צמודת מדד',
};

const LoanCard = ({ loan, onSelect }) => {
  const original = Number(loan.original_amount) || 0;
  const balance = Number(loan.current_balance) || 0;
  const closed = isClosedLoan(loan);
  const earlyPayoff = hasEarlyPayoff(loan);
  const regularPayments = countRegularLoanPayments(loan);
  const regularPaymentsKnown = loan.calculation_mode === 'loan_payments'
    || regularPayments > 0;
  const progressPercent = original > 0
    ? Math.min(100, Math.max(0, ((original - balance) / original) * 100))
    : 0;
  const roundedProgress = Math.round(progressPercent);
  const amortization = amortizationLabels[loan.amortization_type] || loan.amortization_type || 'לא צוין';
  const interestBasis = interestLabels[loan.interest_type] || loan.interest_type || 'לא צוין';
  const interestRate = Number(loan.interest_rate);
  const openDetails = (event) => onSelect?.(loan, event.currentTarget);

  const handleKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDetails(event);
  };

  return (
    <article
      className={`loan-card${closed ? ' is-closed' : ''}`}
      aria-label={`הלוואה: ${loan.name || 'ללא שם'}`}
      role="button"
      tabIndex={0}
      onClick={openDetails}
      onKeyDown={handleKeyDown}
    >
      <header className="loan-card__header">
        <div className="loan-card__identity">
          <h3>{loan.name || 'הלוואה ללא שם'}</h3>
          <p>
            {loan.lender_name || 'מלווה לא צוין'}
            <span aria-hidden="true"> · </span>
            {interestBasis}
            {Number.isFinite(interestRate) && (
              <>
                <span aria-hidden="true"> </span>
                <TechnicalValue>{interestRate.toLocaleString('en-US', { maximumFractionDigits: 2 })}%</TechnicalValue>
              </>
            )}
          </p>
        </div>
        {closed ? (
          <span className={`loan-status-badge ${earlyPayoff ? 'is-early' : 'is-paid'}`}>
            {earlyPayoff ? 'נפרעה מוקדם' : 'נפרעה'}
          </span>
        ) : (
          <span className="loan-card__method">{amortization}</span>
        )}
      </header>

      <div className="loan-card__balance">
        <span>יתרה נוכחית</span>
        <MoneyAmount value={balance} maximumFractionDigits={2} />
      </div>

      <div className="loan-card__progress">
        <ProgressBar
          value={progressPercent}
          tone={closed ? 'pos' : 'primary'}
          height={7}
          aria-label={`אחוז הקרן שנפרע עבור ${loan.name || 'ההלוואה'}`}
          aria-valuetext={`${roundedProgress}% מהקרן נפרעה`}
        />
        <span><TechnicalValue>{roundedProgress}%</TechnicalValue> מהקרן נפרעה</span>
      </div>

      {closed ? (
        <dl className="loan-card__metadata loan-card__metadata--closed">
          <div>
            <dt>תחילת הלוואה</dt>
            <dd><TechnicalValue>{formatLoanDate(loan.start_date)}</TechnicalValue></dd>
          </div>
          <div>
            <dt>תאריך סגירה</dt>
            <dd><TechnicalValue>{formatLoanDate(loan.closed_date)}</TechnicalValue></dd>
          </div>
          <div>
            <dt>תשלומים רגילים</dt>
            <dd>
              <TechnicalValue>
                {regularPaymentsKnown ? `${regularPayments} מתוך ${loan.total_installments ?? '−'}` : '−'}
              </TechnicalValue>
            </dd>
          </div>
          <div>
            <dt>אופן סגירה</dt>
            <dd>{earlyPayoff ? 'פירעון מוקדם' : 'פירעון מלא'}</dd>
          </div>
        </dl>
      ) : (
        <dl className="loan-card__metadata">
          <div>
            <dt>החזר חודשי</dt>
            <dd><MoneyAmount value={loan.monthly_payment} maximumFractionDigits={2} /></dd>
          </div>
          <div>
            <dt>תשלומים שנותרו</dt>
            <dd><TechnicalValue>{loan.remaining_installments ?? '−'}</TechnicalValue></dd>
          </div>
          <div>
            <dt>תחילת ההלוואה</dt>
            <dd><TechnicalValue>{loan.start_date || '−'}</TechnicalValue></dd>
          </div>
          <div>
            <dt>סיום צפוי</dt>
            <dd><TechnicalValue>{loan.end_date || '−'}</TechnicalValue></dd>
          </div>
        </dl>
      )}
    </article>
  );
};

export default LoanCard;
