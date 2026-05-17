import React from 'react';
import { STATUS_OPTIONS } from '../../utils/legoHelpers';

const CollectionFilters = ({ filterStatus, onFilterChange }) => (
  <div style={{
    marginBottom: '30px',
    background: 'var(--surface-2)',
    padding: '15px',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  }}>
    <span style={{ fontWeight: 'bold', color: 'var(--ink-3)' }}>סינון מהיר:</span>
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
        }}
      >
        {label}
      </button>
    ))}
  </div>
);

export default CollectionFilters;
