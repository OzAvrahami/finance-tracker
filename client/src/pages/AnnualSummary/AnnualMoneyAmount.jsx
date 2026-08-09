import { MoneyAmount } from '../../components/ui';

const AnnualMoneyAmount = (props) => (
  <MoneyAmount {...props} maximumFractionDigits={2} />
);

export default AnnualMoneyAmount;
