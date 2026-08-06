import { Link } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { BottomSheet, TechnicalValue } from '../ui';
import { isNavigationItemActive } from './navigation';

const MobileMoreSheet = ({
  isOpen,
  onClose,
  returnFocusRef,
  items,
  pathname,
  userEmail,
  onSignOut,
}) => {
  return (
    <BottomSheet
      open={isOpen}
      onClose={onClose}
      title="עוד בפיננסים."
      closeLabel="סגירה"
      backdropLabel="סגירת תפריט נוסף"
      returnFocusRef={returnFocusRef}
      className="shell-sheet-layer"
      panelClassName="shell-more-sheet"
      handleClassName="shell-more-handle"
      headerClassName="shell-more-heading"
      bodyClassName="shell-more-body"
    >
        <nav className="shell-more-nav" aria-label="ניווט נוסף">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isNavigationItemActive(item, pathname);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`shell-more-link${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={onClose}
              >
                <Icon size={21} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="shell-mobile-session">
          <div className="shell-mobile-user-copy">
            <span>חשבון מחובר</span>
            <TechnicalValue title={userEmail}>{userEmail || 'משתמש'}</TechnicalValue>
          </div>
          <button type="button" className="shell-mobile-logout" onClick={onSignOut}>
            <LogOut size={18} aria-hidden="true" />
            <span>התנתקות</span>
          </button>
        </div>
    </BottomSheet>
  );
};

export default MobileMoreSheet;
