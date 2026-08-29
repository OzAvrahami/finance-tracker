import { MoneyAmount } from '../../components/ui';

const AnnualMoneyAmount = (props) => (
  <MoneyAmount {...props} minimumFractionDigits={0} maximumFractionDigits={2} />
);

export default AnnualMoneyAmount;
