import { createElement } from 'react';
import { Blocks, HandCoins, PiggyBank, WalletCards } from 'lucide-react';
import { GlassCard, MoneyAmount, TechnicalValue } from '../ui';

const SUMMARY_ITEMS = [
  {
    key: 'totalSets',
    label: 'מספר הסטים',
    note: 'כל הסטים באוסף',
    icon: Blocks,
    tone: 'primary',
    money: false,
  },
  {
    key: 'totalValue',
    label: 'שווי מוצג',
    note: 'לפי הנתונים שהוזנו לאוסף',
    icon: WalletCards,
    tone: 'primary',
    money: true,
  },
  {
    key: 'totalPaid',
    label: 'סך ששולם',
    note: 'מחירי הרכישה המתועדים',
    icon: HandCoins,
    tone: 'expense',
    money: true,
  },
  {
    key: 'totalSaved',
    label: 'חיסכון',
    note: 'פער מול הערך המחושב הקיים',
    icon: PiggyBank,
    tone: 'positive',
    money: true,
  },
];

const StatsDashboard = ({ stats }) => (
  <section className="lego-summary" aria-label="סיכום אוסף לגו">
    {SUMMARY_ITEMS.map(({ key, label, note, icon: Icon, tone, money }) => (
      <GlassCard key={key} className={`lego-summary-card is-${tone}`} padding="18px">
        <div className="lego-summary-card__label">
          <span className="lego-summary-card__icon" aria-hidden="true">{createElement(Icon, { size: 17 })}</span>
          <span>{label}</span>
        </div>
        {money ? (
          <MoneyAmount
            className="lego-summary-card__value"
            value={stats[key]}
            minimumFractionDigits={2}
            maximumFractionDigits={2}
          />
        ) : (
          <TechnicalValue className="lego-summary-card__value">{stats[key]}</TechnicalValue>
        )}
        <p>{note}</p>
      </GlassCard>
    ))}
  </section>
);

export default StatsDashboard;
