import { MoneyAmount } from '../../components/ui';

const BudgetMoneyAmount = (props) => (
  <MoneyAmount {...props} maximumFractionDigits={2} />
);

export default BudgetMoneyAmount;
