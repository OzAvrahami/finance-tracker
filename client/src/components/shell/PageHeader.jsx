import React from 'react';
import { Link } from 'react-router-dom';
import { Moon, Plus, Sun } from 'lucide-react';
import { IconButton } from '../ui';

const HeaderAction = ({ action }) => {
  if (!action) return null;
  if (React.isValidElement(action)) return action;

  const Icon = action.icon;
  if (action.to) {
    return (
      <Link className="shell-context-action" to={action.to}>
        {Icon && <Icon size={18} aria-hidden="true" />}
        <span>{action.label}</span>
      </Link>
    );
  }

  return (
    <button className="shell-context-action" type="button" onClick={action.onClick}>
      {Icon && <Icon size={18} aria-hidden="true" />}
      <span>{action.label}</span>
    </button>
  );
};

const PageHeader = ({
  pageHeader,
  theme,
  toggleTheme,
  showGlobalAdd,
}) => (
  <header className="shell-page-header">
    <div className="shell-page-heading">
      <h1>{pageHeader.title}</h1>
      {pageHeader.subtitle && <p>{pageHeader.subtitle}</p>}
    </div>

    <div className="shell-page-header-spacer" />
    {pageHeader.secondaryContent && (
      <div className="shell-header-secondary">{pageHeader.secondaryContent}</div>
    )}
    <div className="shell-page-actions">
      <IconButton
        className="shell-theme-toggle"
        title={theme === 'dark' ? 'מעבר לערכת נושא בהירה' : 'מעבר לערכת נושא כהה'}
        onClick={toggleTheme}
        size={40}
      >
        {theme === 'dark'
          ? <Sun size={19} aria-hidden="true" />
          : <Moon size={19} aria-hidden="true" />}
      </IconButton>
      <HeaderAction action={pageHeader.primaryAction} />
      {showGlobalAdd && !pageHeader.primaryAction && (
        <Link className="shell-header-add" to="/add">
          <Plus size={18} aria-hidden="true" />
          <span>תנועה חדשה</span>
        </Link>
      )}
    </div>
  </header>
);

export default PageHeader;
