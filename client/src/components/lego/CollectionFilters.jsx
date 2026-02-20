import React from 'react';
import { STATUS_OPTIONS } from '../../utils/legoHelpers';

const CollectionFilters = ({ filterStatus, onFilterChange }) => (
  <div style={{
    marginBottom: '30px',
    background: 'white',
    padding: '15px',
    borderRadius: '10px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  }}>
    <span style={{ fontWeight: 'bold', color: '#555' }}>סינון מהיר:</span>
    {STATUS_OPTIONS.map(({ key, label }) => (
      <button
        key={key}
        onClick={() => onFilterChange(key)}
        style={{
          padding: '8px 16px',
          borderRadius: '20px',
          border: 'none',
          cursor: 'pointer',
          background: filterStatus === key ? '#1a1a2e' : '#f1f3f5',
          color: filterStatus === key ? 'white' : '#555',
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
