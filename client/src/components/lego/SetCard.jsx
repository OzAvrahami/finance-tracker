import React from 'react';
import { BRAND_OPTIONS } from '../../utils/legoHelpers';

const SetCard = ({ set, onStatusChange, onBrandChange }) => {
  const orig = Number(set.original_price) || 0;
  const paid = Number(set.purchase_price) || 0;
  const discountPercent = orig > paid ? Math.round(((orig - paid) / orig) * 100) : 0;

  const raw = String(set.set_number || '').trim();
  const setNumberForImage = /-\d+$/.test(raw) ? raw : `${raw}-1`;
  const imageUrl = `https://images.brickset.com/sets/images/${setNumberForImage}.jpg`;

  const statusBg = set.status === 'New'
    ? 'var(--info-soft)'
    : set.status === 'Built'
    ? 'var(--pos-soft)'
    : 'var(--warn-soft)';

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
            e.currentTarget.src = 'https://via.placeholder.com/400x300/1B1F2E/5A607A?text=No+Image';
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

        <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', height: '45px', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.3', color: 'var(--ink-1)' }}>
          {set.name}
        </h3>

        <div style={{ background: 'var(--surface-3)', padding: '12px', borderRadius: '8px', marginBottom: '15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', color: 'var(--ink-3)' }}>
            <span>שולם:</span>
            <span style={{ fontWeight: 'bold', color: 'var(--ink-1)', fontSize: '1.1rem' }}>
              ₪{paid.toLocaleString()}
            </span>
          </div>

          {orig > paid && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--ink-4)', marginTop: '5px' }}>
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
              border: '1px solid var(--border)',
              background: statusBg,
              color: 'var(--ink-1)',
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
              border: '1px solid var(--border)',
              background: 'var(--surface-3)',
              color: 'var(--ink-1)',
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
  background: 'var(--surface-2)',
  borderRadius: '16px',
  overflow: 'hidden',
  boxShadow: 'var(--shadow-md)',
  border: '1px solid var(--border)',
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
  backgroundColor: 'var(--surface-3)',
  padding: '10px',
  borderBottom: '1px solid var(--border)',
};

const imageStyle = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
};

const setNumberBadge = {
  background: 'var(--surface-3)',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '0.8rem',
  fontWeight: 'bold',
  color: 'var(--ink-3)',
};

const themeBadge = {
  background: 'var(--primary-soft)',
  color: 'var(--primary-hi)',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '0.8rem',
  fontWeight: '600',
};

const brandBadge = {
  background: 'var(--warn-soft)',
  color: 'var(--warn)',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '0.8rem',
  fontWeight: '600',
};

const dealBadge = {
  marginTop: '10px',
  background: 'var(--pos-soft)',
  color: 'var(--pos)',
  padding: '6px',
  borderRadius: '6px',
  fontSize: '0.85rem',
  textAlign: 'center',
  fontWeight: 'bold',
};

export default SetCard;
