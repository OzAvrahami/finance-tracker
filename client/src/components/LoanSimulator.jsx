import { useMemo, useState } from 'react';
import { Calculator, Coins, Info, Percent } from 'lucide-react';
import {
  Alert,
  MoneyAmount,
  NumberField,
  PrimaryButton,
  TechnicalValue,
} from './ui';

const LoanSimulator = ({ loans }) => {
  const [amountToPay, setAmountToPay] = useState('');
  const [submittedEmpty, setSubmittedEmpty] = useState(false);
  const currentPrime = 6.0;
  const numericAmount = parseFloat(amountToPay);
  const isInvalid = amountToPay !== '' && (!Number.isFinite(numericAmount) || numericAmount <= 0);

  const recommendation = useMemo(() => {
    if (!amountToPay || Number.isNaN(Number(amountToPay)) || loans.length === 0) return null;

    const cash = parseFloat(amountToPay);
    const sortedLoans = loans
      .map((loan) => {
        const margin = parseFloat(loan.prime_margin) || 0;
        const fixedRate = parseFloat(loan.interest_rate) || 0;
        const effectiveRate = loan.interest_type === 'prime'
          ? currentPrime + margin
          : fixedRate;

        return { ...loan, effectiveRate };
      })
      .filter((loan) => parseFloat(loan.current_balance) > 0)
      .sort((first, second) => second.effectiveRate - first.effectiveRate);

    const targetLoan = sortedLoans[0];
    if (!targetLoan) return null;

    const balance = parseFloat(targetLoan.current_balance);
    const paymentAmount = Math.min(cash, balance);
    const yearlySavings = (paymentAmount * targetLoan.effectiveRate) / 100;

    return {
      loanName: targetLoan.name,
      lenderName: targetLoan.lender_name,
      loanRate: targetLoan.effectiveRate.toFixed(2),
      paymentAmount,
      remainingBalance: Math.max(balance - paymentAmount, 0),
      yearlySavings: yearlySavings.toFixed(0),
      isFullPayoff: cash >= balance,
    };
  }, [amountToPay, currentPrime, loans]);

  const handleAmountChange = (event) => {
    setAmountToPay(event.target.value);
    setSubmittedEmpty(false);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setSubmittedEmpty(amountToPay === '');
  };

  const hasSuitableLoan = loans.some((loan) => parseFloat(loan.current_balance) > 0);
  const showNoLoan = amountToPay !== '' && !isInvalid && !hasSuitableLoan;
  const showResult = recommendation && !isInvalid;

  return (
    <section className="loan-simulator" aria-labelledby="loan-simulator-title">
      <div className="loan-simulator__heading">
        <span className="loan-simulator__icon" aria-hidden="true"><Calculator size={19} /></span>
        <div>
          <h2 id="loan-simulator-title">סימולטור פירעון מוקדם</h2>
          <p>בודק את ההלוואות הקיימות וממליץ על זו עם הריבית האפקטיבית הגבוהה.</p>
        </div>
      </div>

      <form className="loan-simulator__controls" onSubmit={handleSubmit} noValidate>
        <NumberField
          id="loan-simulator-amount"
          className="loan-simulator__field"
          label="סכום לפירעון מוקדם"
          placeholder="0"
          min="0"
          step="any"
          value={amountToPay}
          onChange={handleAmountChange}
          error={isInvalid ? 'הסכום חייב להיות גדול מאפס' : undefined}
          suffix="₪"
        />
        <PrimaryButton type="submit">
          <Coins size={16} aria-hidden="true" />
          חישוב חיסכון משוער
        </PrimaryButton>
        <p className="loan-simulator__context">מחושב לפי נתוני הריבית הקיימים במערכת</p>
      </form>

      {submittedEmpty && (
        <Alert variant="warning" announce>יש להזין סכום לפירעון מוקדם.</Alert>
      )}

      {!amountToPay && !submittedEmpty && (
        <div className="loan-simulator__idle" role="status">
          <Percent size={19} aria-hidden="true" />
          <span>הזן סכום כדי לראות הערכת חיסכון בריבית לשנה.</span>
        </div>
      )}

      {showNoLoan && (
        <Alert variant="info" announce>לא נמצאה הלוואה פעילה שמתאימה לפירעון מוקדם.</Alert>
      )}

      {showResult && (
        <div className="loan-simulator__result" role="status" aria-live="polite">
          <div className="loan-simulator__recommendation">
            <span className="loan-simulator__result-icon" aria-hidden="true"><Coins size={17} /></span>
            <div>
              <span>המלצה לפי הריבית האפקטיבית הגבוהה בתיק</span>
              <strong>
                {recommendation.loanName}
                {recommendation.lenderName ? ` — ${recommendation.lenderName}` : ''}
              </strong>
            </div>
            <TechnicalValue className="loan-simulator__rate">{recommendation.loanRate}%</TechnicalValue>
          </div>

          <dl className="loan-simulator__metrics">
            <div>
              <dt>סכום הפירעון</dt>
              <dd><MoneyAmount value={recommendation.paymentAmount} maximumFractionDigits={2} /></dd>
            </div>
            <div className="is-positive">
              <dt>חיסכון משוער בריבית · שנה</dt>
              <dd><MoneyAmount value={recommendation.yearlySavings} maximumFractionDigits={2} /></dd>
            </div>
            <div>
              <dt>יתרה לאחר הפירעון</dt>
              <dd><MoneyAmount value={recommendation.remainingBalance} maximumFractionDigits={2} /></dd>
            </div>
          </dl>

          <p className="loan-simulator__disclaimer">
            <Info size={15} aria-hidden="true" />
            זוהי הערכה המבוססת על נתוני ההלוואה והריבית הקיימים במערכת, ואינה התחייבות לתוצאה או תחליף ללוח סילוקין מהמלווה.
          </p>
          {recommendation.isFullPayoff && <span className="loan-simulator__payoff">הסכום מכסה את מלוא היתרה</span>}
        </div>
      )}
    </section>
  );
};

export default LoanSimulator;
