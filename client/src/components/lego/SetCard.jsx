import React from 'react';
import { BRAND_OPTIONS } from '../../utils/legoHelpers';

const SetCard = ({ set, onStatusChange, onBrandChange }) => {
  const orig = Number(set.original_price) || 0;
  const paid = Number(set.purchase_price) || 0;
  const discountPercent = orig > paid ? Math.round(((orig - paid) / orig) * 100) : 0;

  const raw = String(set.set_number || '').trim();
  const setNumberForImage = /-\d+$/.test(raw) ? raw : `${raw}-1`;
  const imageUrl = `https://images.brickset.com/sets/images/${setNumberForImage}.jpg`;

  return (
    <div style={cardStyle}>
      <div style={imageContainerStyle}>
        <img
          src={imageUrl}
          alt={set.name}
          style={imageStyle}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = 'https://via.placeholder.com/400x300/f0f2f5/aaaaaa?text=No+Image';
          }}
        />
      </div>

      <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '10px' }}>
          <span style={setNumberBadge}>#{set.set_number}</span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {set.theme && <span style={themeBadge}>{set.theme}</span>}
            {set.brand && set.brand !== 'LEGO' && <span style={brandBadge}>{set.brand}</span>}
          </div>
        </div>

        <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', height: '45px', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.3' }}>
          {set.name}
        </h3>

        <div style={{ background: '#f8f9fa', padding: '12px', borderRadius: '8px', marginBottom: '15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', color: '#666' }}>
            <span>שולם:</span>
            <span style={{ fontWeight: 'bold', color: '#1a1a2e', fontSize: '1.1rem' }}>
              ₪{paid.toLocaleString()}
            </span>
          </div>

          {orig > paid && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#999', marginTop: '5px' }}>
              <span>מחיר שוק:</span>
              <span style={{ textDecoration: 'line-through' }}>₪{orig.toLocaleString()}</span>
            </div>
          )}

          {discountPercent > 0 && <div style={dealBadge}>🔥 חסכת {discountPercent}%</div>}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <select
            value={set.status}
            onChange={(e) => onStatusChange(set.id, e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid #eee',
              background: set.status === 'New' ? '#e3f2fd' : set.status === 'Built' ? '#e8f5e9' : '#fff3e0',
              color: '#333',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            <option value="New">📦 חדש בקופסה</option>
            <option value="In Progress">🚧 בתהליך בנייה</option>
            <option value="Built">✅ מורכב ומוצג</option>
          </select>

          <select
            value={set.brand || 'LEGO'}
            onChange={(e) => onBrandChange(set.id, e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid #eee',
              background: '#fafafa',
              color: '#333',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            {BRAND_OPTIONS.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

// --- Styles ---
const cardStyle = {
  background: 'white',
  borderRadius: '16px',
  overflow: 'hidden',
  boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
  border: '1px solid rgba(0,0,0,0.03)',
  transition: 'transform 0.2s, box-shadow 0.2s',
  display: 'flex',
  flexDirection: 'column',
};

const imageContainerStyle = {
  height: '180px',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#fff',
  padding: '10px',
  borderBottom: '1px solid #f0f0f0',
};

const imageStyle = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
};

const setNumberBadge = {
  background: '#f1f3f5',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '0.8rem',
  fontWeight: 'bold',
  color: '#555',
};

const themeBadge = {
  background: '#fff0f6',
  color: '#c026d3',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '0.8rem',
  fontWeight: '600',
};

const brandBadge = {
  background: '#fffbeb',
  color: '#d97706',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '0.8rem',
  fontWeight: '600',
};

const dealBadge = {
  marginTop: '10px',
  background: '#d1fae5',
  color: '#059669',
  padding: '6px',
  borderRadius: '6px',
  fontSize: '0.85rem',
  textAlign: 'center',
  fontWeight: 'bold',
};

export default SetCard;
