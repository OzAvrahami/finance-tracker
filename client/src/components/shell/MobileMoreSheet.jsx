import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { TechnicalValue } from '../ui';
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
  const sheetRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const firstFocusable = sheetRef.current?.querySelector('a, button');
    firstFocusable?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        returnFocusRef.current?.focus();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = [...(sheetRef.current?.querySelectorAll('a, button') ?? [])]
        .filter((element) => !element.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, returnFocusRef]);

  if (!isOpen) return null;

  const closeAndReturnFocus = () => {
    onClose();
    returnFocusRef.current?.focus();
  };

  return (
    <div className="shell-sheet-layer">
      <button
        type="button"
        className="shell-sheet-backdrop"
        aria-label="סגירת תפריט נוסף"
        onClick={closeAndReturnFocus}
      />
      <section
        ref={sheetRef}
        className="shell-more-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shell-more-title"
      >
        <div className="shell-more-handle" aria-hidden="true" />
        <div className="shell-more-heading">
          <h2 id="shell-more-title">עוד בפיננסים.</h2>
          <button type="button" className="shell-sheet-close" onClick={closeAndReturnFocus} aria-label="סגירה">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

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
      </section>
    </div>
  );
};

export default MobileMoreSheet;
