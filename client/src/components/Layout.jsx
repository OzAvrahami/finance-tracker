import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, List, PiggyBank, Package, Landmark, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const Layout = () => {
  const location = useLocation();
  const { signOut } = useAuth();

  const menuItems = [
    { path: '/', label: 'לוח בקרה', icon: <LayoutDashboard size={20} /> },
    { path: '/add', label: 'הוספת הוצאה/הכנסה', icon: <LayoutDashboard size={20} /> },
    { path: '/transactions', label: 'יומן תנועות', icon: <List size={20} /> },
    { path: '/loans', label: 'הלוואות ומשכנתא', icon: <Landmark size={20} /> },
    { path: '/investments', label: 'פנסיה וגמל', icon: <PiggyBank size={20} /> },
    { path: '/lego', label: 'מלאי LEGO', icon: <Package size={20} /> },
    { path: '/settings', label: 'הגדרות', icon: <Settings size={20} /> },
  ];

  return (
    <div className="app-container" dir="rtl" style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f8f9fa' }}>
      
      <aside style={{ 
        width: '260px', 
        backgroundColor: '#fff', 
        borderLeft: '1px solid #e9ecef', 
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        height: '100%',
        right: 0
      }}>
        <div style={{ marginBottom: '40px', fontSize: '1.5rem', fontWeight: 'bold', color: '#2c3e50', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.8rem' }}>💎</span> MyFinance
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link 
                key={item.path} 
                to={item.path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 15px',
                  borderRadius: '10px',
                  textDecoration: 'none',
                  color: isActive ? '#fff' : '#6c757d',
                  backgroundColor: isActive ? '#3498db' : 'transparent',
                  fontWeight: isActive ? 'bold' : 'normal',
                  transition: 'all 0.2s ease'
                }}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
          <button
            onClick={signOut}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 15px',
              borderRadius: '10px',
              border: 'none',
              background: 'transparent',
              color: '#6c757d',
              cursor: 'pointer',
              fontSize: '1rem',
              width: '100%',
              textAlign: 'right'
            }}
          >
            <LogOut size={20} />
            התנתקות
          </button>
        </div>
      </aside>

      <main style={{ 
        marginRight: '260px', 
        flex: 1, 
        padding: '30px',
        width: 'calc(100% - 260px)'
      }}>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;