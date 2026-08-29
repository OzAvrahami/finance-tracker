import { MoneyAmount } from '../../components/ui';

const BudgetMoneyAmount = (props) => (
  <MoneyAmount {...props} minimumFractionDigits={0} maximumFractionDigits={2} />
);

export default BudgetMoneyAmount;
