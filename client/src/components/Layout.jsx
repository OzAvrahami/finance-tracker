import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, CreditCard, PieChart, DollarSign, Settings, LogOut, Wallet, Package, Upload, ShoppingCart, CheckSquare, BarChart2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const Layout = () => {
  const location = useLocation();
  const { signOut, user } = useAuth();

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

  const currentTitle = pageTitle[location.pathname] || 'פיננסים';
  const userInitials = user?.email ? user.email.charAt(0).toUpperCase() : '?';

  return (
    <div dir="rtl" style={{ minHeight: '100vh', display: 'flex', backgroundColor: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside style={{
        width: 260,
        backgroundColor: 'var(--surface-1)',
        borderInlineEnd: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        right: 0,  /* kept physical: position:fixed is relative to viewport; <html> has no dir="rtl" yet */
        height: '100vh',
        zIndex: 20,
        boxShadow: '0 0 20px rgba(0,0,0,0.4)',
      }}>
        {/* Logo */}
        <div style={{ padding: 'var(--s-24)', display: 'flex', alignItems: 'center', gap: 'var(--s-12)', marginBottom: 'var(--s-24)' }}>
          <div style={{
            height: 32, width: 32,
            background: 'var(--primary-grad)',
            borderRadius: 'var(--r-8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 16px rgba(124,92,255,0.3)',
            flexShrink: 0,
          }}>
            <Wallet size={18} color="white" />
          </div>
          <span style={{ fontSize: 'var(--fs-20)', fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--ink-1)' }}>פיננסים.</span>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, paddingInline: 'var(--s-16)', display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={isActive ? undefined : 'nav-item'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-12)',
                  padding: '10px 14px',
                  borderRadius: 'var(--r-10)',
                  textDecoration: 'none',
                  fontWeight: 500,
                  fontSize: 'var(--fs-14)',
                  transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
                  color: isActive ? 'var(--ink-1)' : 'var(--ink-3)',
                  backgroundColor: isActive ? 'var(--primary-soft)' : 'transparent',
                  border: isActive ? '1px solid rgba(124,92,255,0.25)' : '1px solid transparent',
                }}
              >
                <span style={{ color: isActive ? 'var(--primary-hi)' : 'inherit', display: 'flex', flexShrink: 0 }}>
                  <Icon size={18} />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div style={{
          padding: 'var(--s-16)',
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--s-2)',
          borderBlockStart: '1px solid var(--border)',
        }}>
          <Link
            to="/settings"
            className="nav-item"
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--s-12)',
              padding: '10px 14px', color: 'var(--ink-3)', borderRadius: 'var(--r-10)',
              fontWeight: 500, fontSize: 'var(--fs-14)', textDecoration: 'none',
              transition: 'background-color 0.15s, color 0.15s',
              border: '1px solid transparent',
            }}
          >
            <Settings size={18} />
            <span>הגדרות</span>
          </Link>
          <button
            onClick={signOut}
            className="nav-item-red"
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--s-12)',
              padding: '10px 14px', color: 'var(--neg)', borderRadius: 'var(--r-10)',
              fontWeight: 500, fontSize: 'var(--fs-14)',
              background: 'none', border: '1px solid transparent',
              cursor: 'pointer', marginTop: 'var(--s-4)',
              textAlign: 'start', width: '100%',
              transition: 'background-color 0.15s, color 0.15s',
            }}
          >
            <LogOut size={18} />
            <span>התנתק</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, marginInlineStart: 260, overflowY: 'auto' }}>
        {/* Header / Top bar */}
        <header style={{
          backgroundColor: 'var(--surface-1)',
          borderBlockEnd: '1px solid var(--border)',
          padding: '18px 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 10,
        }}>
          <h1 style={{ fontSize: 'var(--fs-20)', fontWeight: 700, color: 'var(--ink-1)', margin: 0, letterSpacing: '-0.015em' }}>
            {currentTitle}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-16)' }}>
            <div style={{
              height: 36, width: 36,
              backgroundColor: 'var(--surface-3)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--primary-hi)', fontWeight: 700, fontSize: 'var(--fs-13)',
              border: '1px solid var(--border-strong)',
            }}>
              {userInitials}
            </div>
          </div>
        </header>

        <div style={{ padding: 'var(--s-32)', maxWidth: 1280, margin: '0 auto' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
