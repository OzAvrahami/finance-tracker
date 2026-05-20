import React, { useState } from 'react';
import CategoriesTab from './CategoriesTab';
import PaymentSourcesTab from './PaymentSourcesTab';
import ShoppingSettingsTab from './ShoppingSettingsTab';

const TABS = [
  { key: 'categories',      label: 'קטגוריות' },
  { key: 'payment-sources', label: 'מקורות תשלום' },
  { key: 'shopping',        label: 'הגדרות קניות' },
];

const Settings = () => {
  const [activeTab, setActiveTab] = useState('categories');

  return (
    <div dir="rtl">
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>הגדרות</h1>
        <p style={{ color: 'var(--ink-4)', marginTop: 4, fontSize: 14, marginBottom: 0 }}>ניהול נתוני המערכת</p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border-strong)', marginBottom: 24 }}>
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
              color: activeTab === tab.key ? 'var(--primary-hi)' : 'var(--ink-4)',
              borderBottom: `2px solid ${activeTab === tab.key ? 'var(--primary-hi)' : 'transparent'}`,
              marginBottom: -2,
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'categories'      && <CategoriesTab />}
      {activeTab === 'payment-sources' && <PaymentSourcesTab />}
      {activeTab === 'shopping'        && <ShoppingSettingsTab />}
    </div>
  );
};

export default Settings;
