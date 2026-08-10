import { useCallback, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, Sparkles } from 'lucide-react';
import { useAuth } from '../context/auth-context';
import { useTheme } from '../context/theme-context';
import { usePageHeaderContext } from '../context/PageHeaderContext';
import PageHeaderProvider from '../context/PageHeaderProvider';
import { TechnicalValue } from './ui';
import MobileMoreSheet from './shell/MobileMoreSheet';
import PageHeader from './shell/PageHeader';
import {
  addTransactionItem,
  isNavigationItemActive,
  mobileMoreItems,
  mobilePrimaryItems,
  resolveRouteMetadata,
  standardNavigationItems,
} from './shell/navigation';
import './Layout.css';

const AddTransactionIcon = addTransactionItem.icon;

const Brand = ({ compact = false }) => (
  <Link className={`shell-brand${compact ? ' is-compact' : ''}`} to="/" aria-label="פיננסים. — לוח בקרה">
    <span className="shell-brand-mark" aria-hidden="true">
      <Sparkles size={compact ? 20 : 22} />
    </span>
    {!compact && (
      <span className="shell-brand-copy">
        <strong>פיננסים.</strong>
        <small>ניהול כספים אישי</small>
      </span>
    )}
  </Link>
);

const NavigationLink = ({ item, pathname, compact = false, onNavigate }) => {
  const active = isNavigationItemActive(item, pathname);
  const Icon = item.icon;

  return (
    <Link
      to={item.path}
      className={`shell-nav-link${compact ? ' is-compact' : ''}${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? item.label : undefined}
      title={compact ? item.label : undefined}
      onClick={onNavigate}
    >
      <Icon size={20} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
      {!compact && <span>{item.label}</span>}
    </Link>
  );
};

const DesktopSidebar = ({ pathname, userEmail, userInitials, onSignOut }) => (
  <aside className="shell-sidebar" aria-label="סרגל היישום">
    <Brand />
    <nav className="shell-desktop-nav" aria-label="ניווט ראשי">
      {standardNavigationItems.map((item) => (
        <NavigationLink key={item.path} item={item} pathname={pathname} />
      ))}
    </nav>
    <div className="shell-user-card">
      <span className="shell-user-avatar" aria-hidden="true">{userInitials}</span>
      <span className="shell-user-copy">
        <span className="shell-user-email" title={userEmail}>
          <TechnicalValue>{userEmail || 'משתמש'}</TechnicalValue>
        </span>
        <small>חשבון מחובר</small>
      </span>
      <button type="button" className="shell-logout-button" onClick={onSignOut} aria-label="התנתקות">
        <LogOut size={18} aria-hidden="true" />
      </button>
    </div>
  </aside>
);

const TabletRail = ({ pathname, userEmail, userInitials, onSignOut, showAdd }) => (
  <aside className="shell-rail" aria-label="סרגל ניווט מצומצם">
    <Brand compact />
    {showAdd && (
      <Link
        className="shell-rail-add"
        to={addTransactionItem.path}
        aria-label={addTransactionItem.label}
        title={addTransactionItem.label}
      >
        <AddTransactionIcon size={21} aria-hidden="true" />
      </Link>
    )}
    <nav className="shell-rail-nav" aria-label="ניווט לטאבלט">
      {standardNavigationItems.map((item) => (
        <NavigationLink key={item.path} item={item} pathname={pathname} compact />
      ))}
    </nav>
    <div className="shell-rail-session">
      <span className="shell-rail-avatar" title={userEmail} aria-label={`חשבון מחובר: ${userEmail || 'משתמש'}`}>
        {userInitials}
      </span>
      <button type="button" className="shell-rail-logout" onClick={onSignOut} aria-label="התנתקות" title="התנתקות">
        <LogOut size={18} aria-hidden="true" />
      </button>
    </div>
  </aside>
);

const MobileBottomNavigation = ({ pathname, onOpenMore, moreButtonRef, isMoreOpen }) => {
  const moreActive = mobileMoreItems.some((item) => isNavigationItemActive(item, pathname));

  return (
    <nav className="shell-mobile-nav" aria-label="ניווט נייד">
      {mobilePrimaryItems.map((item) => {
        const active = isNavigationItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`shell-mobile-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={21} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
            <span>{item.shortLabel || item.label}</span>
          </Link>
        );
      })}
      <button
        ref={moreButtonRef}
        type="button"
        className={`shell-mobile-link shell-more-trigger${moreActive || isMoreOpen ? ' is-active' : ''}`}
        onClick={onOpenMore}
        aria-haspopup="dialog"
        aria-expanded={isMoreOpen}
      >
        <Menu size={21} aria-hidden="true" />
        <span>עוד</span>
      </button>
    </nav>
  );
};

const ShellFrame = ({ route, pathname }) => {
  const { signOut, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { pageHeader } = usePageHeaderContext();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreButtonRef = useRef(null);
  const closeMore = useCallback(() => setIsMoreOpen(false), []);
  const openMore = useCallback(() => setIsMoreOpen(true), []);
  const userEmail = user?.email || '';
  const userInitials = userEmail ? userEmail.charAt(0).toUpperCase() : '?';

  return (
    <div className="app-shell" dir="rtl">
      <a className="shell-skip-link" href="#main-content">דילוג לתוכן הראשי</a>
      <div className="shell-aurora" aria-hidden="true">
        <span className="shell-aurora-blob shell-aurora-one" />
        <span className="shell-aurora-blob shell-aurora-two" />
        <span className="shell-aurora-blob shell-aurora-three" />
        <span className="shell-aurora-blob shell-aurora-four" />
      </div>

      <DesktopSidebar
        pathname={pathname}
        userEmail={userEmail}
        userInitials={userInitials}
        onSignOut={signOut}
      />
      <TabletRail
        pathname={pathname}
        userEmail={userEmail}
        userInitials={userInitials}
        onSignOut={signOut}
        showAdd={!route.hideGlobalAdd}
      />

      <main id="main-content" className="shell-main" tabIndex="-1">
        <PageHeader
          pageHeader={pageHeader}
          theme={theme}
          toggleTheme={toggleTheme}
          showGlobalAdd={!route.hideGlobalAdd}
        />
        <div className={`shell-page-content${route.key === 'dashboard' ? ' is-dashboard' : ''}`}>
          <Outlet />
        </div>
      </main>

      <MobileBottomNavigation
        pathname={pathname}
        onOpenMore={openMore}
        moreButtonRef={moreButtonRef}
        isMoreOpen={isMoreOpen}
      />
      <MobileMoreSheet
        isOpen={isMoreOpen}
        onClose={closeMore}
        returnFocusRef={moreButtonRef}
        items={mobileMoreItems}
        pathname={pathname}
        userEmail={userEmail}
        onSignOut={signOut}
      />
    </div>
  );
};

const Layout = () => {
  const { pathname } = useLocation();
  const route = resolveRouteMetadata(pathname);

  return (
    <PageHeaderProvider key={route.key} defaultHeader={route}>
      <ShellFrame route={route} pathname={pathname} />
    </PageHeaderProvider>
  );
};

export default Layout;
