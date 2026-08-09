import { ProgressBar, MoneyAmount, TechnicalValue } from './ui';

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

const LoanCard = ({ loan }) => {
  const original = Number(loan.original_amount) || 0;
  const balance = Number(loan.current_balance) || 0;
  const progressPercent = original > 0
    ? Math.min(100, Math.max(0, ((original - balance) / original) * 100))
    : 0;
  const roundedProgress = Math.round(progressPercent);
  const amortization = amortizationLabels[loan.amortization_type] || loan.amortization_type || 'לא צוין';
  const interestBasis = interestLabels[loan.interest_type] || loan.interest_type || 'לא צוין';
  const interestRate = Number(loan.interest_rate);

  return (
    <article className="loan-card" aria-label={`הלוואה: ${loan.name || 'ללא שם'}`}>
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
        <span className="loan-card__method">{amortization}</span>
      </header>

      <div className="loan-card__balance">
        <span>יתרה נוכחית</span>
        <MoneyAmount value={balance} maximumFractionDigits={2} />
      </div>

      <div className="loan-card__progress">
        <ProgressBar
          value={progressPercent}
          tone="primary"
          height={7}
          aria-label={`אחוז הקרן שנפרע עבור ${loan.name || 'ההלוואה'}`}
          aria-valuetext={`${roundedProgress}% מהקרן נפרעה`}
        />
        <span><TechnicalValue>{roundedProgress}%</TechnicalValue> מהקרן נפרעה</span>
      </div>

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
    </article>
  );
};

export default LoanCard;
