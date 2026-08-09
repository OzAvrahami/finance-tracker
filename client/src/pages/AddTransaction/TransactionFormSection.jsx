import { GlassCard } from '../../components/ui';

const TransactionFormSection = ({
  step,
  title,
  description,
  headerAside,
  children,
  className = '',
}) => (
  <GlassCard
    className={`transaction-form-section${description ? ' has-description' : ''} ${className}`.trim()}
    padding="22px"
  >
    <div className="transaction-form-section__heading">
      <span className="transaction-form-section__step" aria-hidden="true">{step}</span>
      <h2>{title}</h2>
      {headerAside && <div className="transaction-form-section__aside">{headerAside}</div>}
    </div>
    {description && <p className="transaction-form-section__description">{description}</p>}
    <div className="transaction-form-section__body">{children}</div>
  </GlassCard>
);

export default TransactionFormSection;
