import { Link } from 'react-router-dom';
import { budgetDestination } from '../utils/transactionsNavigation';
import { formatBudgetMonth } from '../pages/Budget/budgetMonth';
import './BudgetOriginNotice.css';

export default function BudgetOriginNotice({ origin }) {
  if (!origin) return null;
  return (
    <nav className="budget-origin-notice" aria-label="הקשר התקציב" dir="rtl">
      <span>תנועות מחוץ לתקציב · {formatBudgetMonth(origin.month)}</span>
      <Link to={budgetDestination(origin)}>חזרה לתקציב</Link>
    </nav>
  );
}
