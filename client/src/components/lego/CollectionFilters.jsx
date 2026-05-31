import React from 'react';
import { STATUS_OPTIONS } from '../../utils/legoHelpers';

const CollectionFilters = ({ filterStatus, onFilterChange, filterTheme, onThemeFilterChange, themes }) => (
  <div style={{
    marginBottom: '30px',
    background: 'var(--surface-2)',
    padding: '15px',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '10px',
  }}>
    <span style={{ fontWeight: 'bold', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>סינון מהיר:</span>
    {STATUS_OPTIONS.map(({ key, label }) => (
      <button
        key={key}
        onClick={() => onFilterChange(key)}
        style={{
          padding: '8px 16px',
          borderRadius: '20px',
          border: 'none',
          cursor: 'pointer',
          background: filterStatus === key ? 'var(--primary)' : 'var(--surface-3)',
          color: filterStatus === key ? 'var(--primary-ink)' : 'var(--ink-3)',
          fontWeight: '500',
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
    ))}

    {themes && themes.length > 0 && (
      <>
        <span style={{ color: 'var(--border-strong)', paddingInline: 4, userSelect: 'none' }}>|</span>
        <select
          value={filterTheme}
          onChange={e => onThemeFilterChange(e.target.value)}
          style={{
            padding: '8px 14px',
            borderRadius: '20px',
            border: '1px solid var(--border)',
            background: filterTheme !== 'All' ? 'var(--primary)' : 'var(--surface-3)',
            color: filterTheme !== 'All' ? 'var(--primary-ink)' : 'var(--ink-3)',
            fontWeight: '500',
            cursor: 'pointer',
            fontSize: 14,
            outline: 'none',
          }}
        >
          <option value="All">כל הנושאים</option>
          {themes.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </>
    )}
  </div>
);

export default CollectionFilters;
