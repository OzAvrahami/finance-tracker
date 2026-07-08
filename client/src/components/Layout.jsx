import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Home, CreditCard, PieChart, DollarSign, Settings, LogOut, Wallet, Package,
  Upload, ShoppingCart, CheckSquare, BarChart2, Sun, Moon,
  Sparkles, Search, Calendar, Bell, Plus, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import './Layout.css';

const Layout = () => {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Preserved navigation links (existing routes). Settings is appended so it
  // lives in the nav (matching the reference) while remaining the same route.
  const menuItems = [
    { path: '/', label: 'דשבורד', icon: Home },
    { path: '/add', label: 'הוספת תנועה', icon: Wallet },
    { path: '/transactions', label: 'תנועות', icon: CreditCard },
    { path: '/budget', label: 'תקציב', icon: PieChart },
    { path: '/annual-summary', label: 'סיכום שנתי', icon: BarChart2 },
    { path: '/loans', label: 'הלוואות', icon: DollarSign },
    { path: '/shopping', label: 'רשימות קניות', icon: ShoppingCart },
    { path: '/tasks', label: 'משימות', icon: CheckSquare },
    { path: '/import', label: 'ייבוא קובץ', icon: Upload },
    { path: '/lego', label: 'אוסף LEGO', icon: Package },
    { path: '/settings', label: 'הגדרות', icon: Settings },
  ];

  const pageTitle = {
    '/': 'סקירה כללית',
    '/add': 'הוספת תנועה',
    '/transactions': 'יומן תנועות',
    '/budget': 'תקציב חודשי',
    '/annual-summary': 'סיכום שנתי',
    '/loans': 'ניהול הלוואות',
    '/shopping': 'רשימות קניות',
    '/tasks': 'יומן משימות',
    '/import': 'ייבוא עסקאות',
    '/lego': 'אוסף LEGO',
    '/settings': 'הגדרות',
  };

  const pageSubtitle = {
    '/add': 'הוספת הכנסה או הוצאה',
    '/transactions': 'כל ההכנסות וההוצאות שלך',
    '/budget': 'מעקב תקציב חודשי לפי קטגוריה',
    '/annual-summary': 'ניתוח מגמות והשוואות שנתיות',
    '/loans': 'מעקב הלוואות והחזרים',
    '/shopping': 'תכנון וניהול רשימות',
    '/tasks': 'תכנון וניהול משימות',
    '/import': 'ייבוא תנועות מקובץ',
    '/lego': 'מעקב סטים ושווי האוסף',
    '/settings': 'העדפות, ערכת נושא וניהול נתונים',
  };

  const currentTitle = pageTitle[location.pathname] || 'פיננסים';
  const currentSubtitle = pageSubtitle[location.pathname] || '';
  const userInitials = user?.email ? user.email.charAt(0).toUpperCase() : '?';
  const userEmail = user?.email || '';
  const isDashboard = location.pathname === '/';

  const pillBase = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--v2-glass)',
    border: '1px solid var(--v2-border)',
    borderRadius: 13,
    backdropFilter: 'var(--v2-blur)',
    WebkitBackdropFilter: 'var(--v2-blur)',
    fontFamily: 'inherit',
    color: 'var(--v2-text)',
  };
  const iconBtnBase = {
    ...pillBase,
    justifyContent: 'center',
    width: 40,
    height: 40,
    padding: 0,
    cursor: 'pointer',
    position: 'relative',
  };

  return (
    <div dir="rtl" style={{ minHeight: '100vh', backgroundColor: 'var(--bg)', position: 'relative' }}>

      {/* Aurora backdrop — subtle animated gradient behind the whole app */}
      <div className="v2-aurora" aria-hidden="true">
        <div className="v2-aurora-blob" style={{ top: '-18%', insetInlineEnd: '-8%', width: 680, height: 680, background: 'radial-gradient(circle, var(--v2-aurora-1), transparent 62%)', animationDuration: '22s' }} />
        <div className="v2-aurora-blob" style={{ top: '18%', insetInlineStart: '-12%', width: 620, height: 620, background: 'radial-gradient(circle, var(--v2-aurora-2), transparent 62%)', animationDuration: '26s', animationDirection: 'reverse' }} />
        <div className="v2-aurora-blob" style={{ bottom: '-22%', insetInlineStart: '24%', width: 640, height: 640, background: 'radial-gradient(circle, var(--v2-aurora-3), transparent 62%)', animationDuration: '30s' }} />
        <div className="v2-aurora-blob" style={{ top: '42%', insetInlineEnd: '26%', width: 480, height: 480, background: 'radial-gradient(circle, var(--v2-aurora-4), transparent 64%)', animationDuration: '24s', animationDirection: 'reverse' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', minHeight: '100vh' }}>

        {/* ░░░ SIDEBAR (right, RTL) ░░░ */}
        <aside style={{
          width: 262,
          flexShrink: 0,
          position: 'fixed',
          top: 0,
          right: 0,  /* physical right: position:fixed is viewport-relative and <html> has no dir="rtl" */
          height: '100vh',
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          padding: '18px 14px',
          background: 'var(--v2-glass)',
          backdropFilter: 'var(--v2-blur)',
          WebkitBackdropFilter: 'var(--v2-blur)',
          borderInlineEnd: '1px solid var(--v2-border)',  /* divider on the LEFT edge (toward content) in RTL */
        }}>

          {/* Logo / brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px 18px' }}>
            <div style={{
              width: 44, height: 44, borderRadius: 14, flexShrink: 0,
              background: 'linear-gradient(145deg, var(--v2-primary-2), var(--v2-primary-strong))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 22px -4px rgba(124,58,237,0.6)',
            }}>
              <Sparkles size={22} color="#fff" />
            </div>
            <div style={{ lineHeight: 1.15, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.01em', color: 'var(--v2-text)' }}>פיננסים.</div>
              <div style={{ fontSize: 11, color: 'var(--v2-text-faint)', fontWeight: 600, letterSpacing: '0.04em' }}>ניהול פיננסי חכם</div>
            </div>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 0' }}>
            {menuItems.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`v2-nav-item${isActive ? ' is-active' : ''}`}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 13px',
                    borderRadius: 13,
                    textDecoration: 'none',
                    fontSize: 13.5,
                    fontWeight: isActive ? 700 : 600,
                    color: isActive ? 'var(--v2-text)' : 'var(--v2-text-muted)',
                    background: isActive ? 'linear-gradient(100deg, var(--v2-primary-weak), transparent)' : 'transparent',
                    border: isActive ? '1px solid var(--v2-primary-border)' : '1px solid transparent',
                    boxShadow: isActive ? '0 0 22px -8px var(--v2-primary)' : 'none',
                  }}
                >
                  {isActive && (
                    <span style={{
                      position: 'absolute', insetInlineStart: 0, top: '50%', transform: 'translateY(-50%)',
                      width: 3, height: 20, borderRadius: 3,
                      background: 'linear-gradient(var(--v2-primary-2), var(--v2-cyan))',
                      boxShadow: '0 0 10px var(--v2-primary)',
                    }} />
                  )}
                  <span style={{ display: 'flex', flexShrink: 0, color: isActive ? 'var(--v2-primary-2)' : 'var(--v2-text-faint)' }}>
                    <Icon size={20} strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User card (bottom) — logout preserved */}
          <div className="v2-user-card" style={{
            marginTop: 8, padding: 9, borderRadius: 16,
            background: 'var(--v2-glass-2)', border: '1px solid var(--v2-border)',
            display: 'flex', alignItems: 'center', gap: 11,
            transition: 'border-color 0.16s',
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 12, flexShrink: 0,
              background: 'linear-gradient(140deg, #ec4899, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 15,
              boxShadow: '0 6px 16px -4px rgba(236,72,153,0.5)',
            }}>
              {userInitials}
            </div>
            <div style={{ flex: 1, lineHeight: 1.2, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--v2-text)' }}>
                {userEmail || 'משתמש'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--v2-text-faint)' }}>חשבון מחובר</div>
            </div>
            <button
              onClick={signOut}
              className="v2-icon-btn"
              title="התנתק"
              aria-label="התנתק"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                background: 'transparent', border: '1px solid transparent',
                color: 'var(--v2-text-faint)', cursor: 'pointer',
                transition: 'border-color 0.16s',
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </aside>

        {/* ░░░ MAIN ░░░ */}
        <main style={{ flex: 1, minWidth: 0, marginInlineStart: 262, overflowY: 'auto' }}>

          {/* Global header — rendered on every page. On the dashboard the title
              is omitted so it doesn't duplicate the dashboard's own page title. */}
          <header style={{
            position: 'sticky', top: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '12px 24px',
            background: 'color-mix(in srgb, var(--bg) 60%, transparent)',
            backdropFilter: 'var(--v2-blur)',
            WebkitBackdropFilter: 'var(--v2-blur)',
            borderBottom: '1px solid var(--v2-border)',
          }}>
            {!isDashboard && (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--v2-text)' }}>
                  {currentTitle}
                </div>
                {currentSubtitle && (
                  <div style={{ fontSize: 12, color: 'var(--v2-text-muted)', marginTop: 2 }}>{currentSubtitle}</div>
                )}
              </div>
            )}

            <div style={{ flex: 1 }} />

            {/* TODO(phase 2): wire search to a real query/filter. Presentational only. */}
            <label className="v2-search" style={{ ...pillBase, padding: '9px 13px', width: 220, maxWidth: '22vw', transition: 'border-color 0.16s, box-shadow 0.16s' }}>
              <Search size={17} style={{ color: 'var(--v2-text-faint)', flexShrink: 0 }} />
              <input
                placeholder="חיפוש…"
                aria-label="חיפוש"
                style={{ border: 0, background: 'transparent', outline: 'none', color: 'var(--v2-text)', fontFamily: 'inherit', fontSize: 13.5, width: '100%' }}
              />
            </label>

            {/* TODO(phase 2): wire month selection to the app's month/date-range state. Presentational only. */}
            <button type="button" className="v2-pill" style={{ ...pillBase, padding: '9px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'border-color 0.16s' }}>
              <Calendar size={16} style={{ color: 'var(--v2-text-muted)' }} />
              <span>יוני 2026</span>
              <ChevronDown size={15} style={{ color: 'var(--v2-text-faint)' }} />
            </button>

            {/* Theme toggle — functional */}
            <button
              type="button"
              onClick={toggleTheme}
              className="v2-icon-btn"
              title="ערכת נושא"
              aria-label="החלף ערכת נושא"
              style={{ ...iconBtnBase, transition: 'border-color 0.16s' }}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* TODO(phase 2): wire notifications feed. Presentational only (static unread dot). */}
            <button type="button" className="v2-icon-btn" aria-label="התראות" style={{ ...iconBtnBase, transition: 'border-color 0.16s' }}>
              <Bell size={18} />
              <span style={{ position: 'absolute', top: 9, insetInlineStart: 10, width: 7, height: 7, borderRadius: '50%', background: 'var(--v2-rose)', boxShadow: '0 0 8px var(--v2-rose)' }} />
            </button>

            {/* New transaction — functional link to /add */}
            <Link
              to="/add"
              className="v2-cta"
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: 'linear-gradient(135deg, var(--v2-primary-2), var(--v2-primary-strong))',
                color: '#fff', border: 0, borderRadius: 13, padding: '10px 16px',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
                cursor: 'pointer', whiteSpace: 'nowrap',
                boxShadow: '0 8px 22px -6px rgba(124,58,237,0.65)',
                transition: 'filter 0.16s',
              }}
            >
              <Plus size={18} />
              <span>תנועה חדשה</span>
            </Link>

            {/* User avatar */}
            <div title={userEmail} style={{
              height: 40, width: 40, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(140deg, #ec4899, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 14,
              boxShadow: '0 6px 16px -4px rgba(236,72,153,0.45)',
            }}>
              {userInitials}
            </div>
          </header>

          {isDashboard ? (
            <Outlet />
          ) : (
            <div style={{ padding: 'var(--s-32)', maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Layout;
