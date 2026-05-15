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
    <div dir="rtl" style={{ minHeight: '100vh', display: 'flex' }}>
      {/* Sidebar */}
      <aside style={{
        width: 260,
        backgroundColor: 'white',
        borderLeft: '1px solid #F1F5F9',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        zIndex: 20,
        boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
      }}>
        {/* Logo */}
        <div style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            height: 32, width: 32,
            backgroundColor: '#2563EB',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Wallet size={20} color="white" />
          </div>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.025em', color: '#1E293B' }}>פיננסים.</span>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                  gap: 12,
                  padding: '12px 16px',
                  borderRadius: 12,
                  textDecoration: 'none',
                  fontWeight: 500,
                  transition: 'all 0.2s',
                  color: isActive ? '#1D4ED8' : '#475569',
                  backgroundColor: isActive ? '#EFF6FF' : 'transparent',
                }}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div style={{ padding: 16, marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid #F1F5F9' }}>
          <Link
            to="/settings"
            className="nav-item"
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', color: '#475569', borderRadius: 12,
              fontWeight: 500, textDecoration: 'none', transition: 'all 0.2s',
            }}
          >
            <Settings size={20} />
            <span>הגדרות</span>
          </Link>
          <button
            onClick={signOut}
            className="nav-item-red"
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', color: '#DC2626', borderRadius: 12,
              fontWeight: 500, background: 'none', border: 'none',
              cursor: 'pointer', fontSize: '1rem', marginTop: 8,
              textAlign: 'right', width: '100%', transition: 'all 0.2s',
            }}
          >
            <LogOut size={20} />
            <span>התנתק</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, marginRight: 260, overflowY: 'auto' }}>
        {/* Header */}
        <header style={{
          backgroundColor: 'white',
          borderBottom: '1px solid #F1F5F9',
          padding: '20px 32px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 10,
        }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1E293B', margin: 0 }}>{currentTitle}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              height: 40, width: 40,
              backgroundColor: '#DBEAFE', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#1D4ED8', fontWeight: 700,
              border: '2px solid white', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}>
              {userInitials}
            </div>
          </div>
        </header>

        <div style={{ padding: 32, maxWidth: 1280, margin: '0 auto' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
