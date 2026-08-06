import { Inbox, SearchX } from 'lucide-react';
import './feedback.css';

const EmptyState = ({
  variant = 'dataset',
  size = 'full',
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className = '',
  ...props
}) => {
  const DefaultIcon = variant === 'filtered' ? SearchX : Inbox;
  const StateIcon = Icon || DefaultIcon;

  return (
    <section
      {...props}
      className={`ui-empty-state ui-empty-state--${variant} ui-empty-state--${size} ${className}`.trim()}
      data-empty-variant={variant}
    >
      <span className="ui-state-icon" aria-hidden="true"><StateIcon size={size === 'compact' ? 20 : 26} /></span>
      <div className="ui-state-copy">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="ui-state-actions">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </section>
  );
};

export default EmptyState;
