import React, { useState } from 'react';
import CategoriesTab from './CategoriesTab';

const TABS = [
  { key: 'categories', label: 'קטגוריות' },
];

const Settings = () => {
  const [activeTab, setActiveTab] = useState('categories');

  return (
    <div dir="rtl">
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1E293B', margin: 0 }}>הגדרות</h1>
        <p style={{ color: '#64748B', marginTop: 4, fontSize: 14, marginBottom: 0 }}>ניהול נתוני המערכת</p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '2px solid #F1F5F9', marginBottom: 24 }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: activeTab === tab.key ? 700 : 500,
              color: activeTab === tab.key ? '#2563EB' : '#64748B',
              borderBottom: `2px solid ${activeTab === tab.key ? '#2563EB' : 'transparent'}`,
              marginBottom: -2,
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'categories' && <CategoriesTab />}
    </div>
  );
};

export default Settings;
