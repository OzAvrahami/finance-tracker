import { createElement, useMemo } from 'react';
import { Banknote, Landmark, Percent, ReceiptText } from 'lucide-react';
import { MoneyAmount, TechnicalValue } from './ui';
import { isActiveLoan } from '../utils/loanDisplay';

const LoansDashboard = ({ loans }) => {
  const stats = useMemo(() => {
    let totalDebt = 0;
    let monthlyPayment = 0;
    let highestInterest = 0;
    let highestInterestName = '';
    let activeLoanCount = 0;

    loans.forEach((loan) => {
      const balance = parseFloat(loan.current_balance) || 0;
      totalDebt += Math.max(balance, 0);

      if (!isActiveLoan(loan)) return;

      const payment = parseFloat(loan.monthly_payment) || 0;
      const interest = parseFloat(loan.interest_rate) || 0;
      activeLoanCount += 1;
      monthlyPayment += payment;

      if (interest > highestInterest) {
        highestInterest = interest;
        highestInterestName = loan.name;
      }
    });

    return {
      totalDebt, monthlyPayment, highestInterest, highestInterestName, activeLoanCount,
    };
  }, [loans]);

  const cards = [
    {
      label: 'סך החוב הנוכחי',
      icon: Landmark,
      tone: 'debt',
      value: <MoneyAmount value={stats.totalDebt} maximumFractionDigits={2} />,
    },
    {
      label: 'סך ההחזרים החודשיים',
      icon: Banknote,
      tone: 'primary',
      value: <MoneyAmount value={stats.monthlyPayment} maximumFractionDigits={2} />,
    },
    {
      label: 'ההלוואה בריבית הגבוהה ביותר',
      icon: Percent,
      tone: 'warning',
      value: stats.highestInterestName || 'לא קיימת',
      note: stats.highestInterestName
        ? <TechnicalValue>{stats.highestInterest.toLocaleString('en-US', { maximumFractionDigits: 2 })}%</TechnicalValue>
        : undefined,
    },
    {
      label: 'מספר ההלוואות הפעילות',
      icon: ReceiptText,
      tone: 'neutral',
      value: <TechnicalValue>{stats.activeLoanCount}</TechnicalValue>,
    },
  ];

  return (
    <section className="loans-summary-grid" aria-label="סיכום תיק ההלוואות">
      {cards.map(({ label, icon: Icon, tone, value, note }) => (
        <article key={label} className={`loans-summary-card is-${tone}`}>
          <div className="loans-summary-card__heading">
            <span className="loans-summary-card__icon" aria-hidden="true">
              {createElement(Icon, { size: 17 })}
            </span>
            <span>{label}</span>
          </div>
          <div className="loans-summary-card__value">{value}</div>
          {note && <div className="loans-summary-card__note">{note}</div>}
        </article>
      ))}
    </section>
  );
};

export default LoansDashboard;
