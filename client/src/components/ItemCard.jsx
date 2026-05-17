import React from 'react';
import { inputStyle, itemCardStyle, badgeStyle, gridRowStyle, deleteBtnStyle } from './transactions/AddTransaction.styles';
import { BRAND_OPTIONS } from '../utils/legoHelpers';

const ItemCard = ({ item, index, isLego, legoThemes, onItemChange, onRemove, onSetNumberBlur }) => {
  return (
    <div style={itemCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={badgeStyle}>פריט #{index + 1}</span>
        <button type="button" onClick={() => onRemove(index)} style={deleteBtnStyle}>🗑️ הסר</button>
      </div>

      <div style={gridRowStyle}>
        <input type="text" placeholder="שם הפריט" value={item.item_name} onChange={(e) => onItemChange(index, 'item_name', e.target.value)} style={inputStyle} required />
        <input type="number" placeholder="כמות" value={item.quantity} onChange={(e) => onItemChange(index, 'quantity', e.target.value)} style={inputStyle} min="1" />
        <input type="number" placeholder="מחיר ליחידה" value={item.price_per_unit} onChange={(e) => onItemChange(index, 'price_per_unit', e.target.value)} style={inputStyle} min="0" step="0.01" />
      </div>

      <div style={{ ...gridRowStyle, marginTop: '10px' }}>
        {/* משתמשים בפונקציית העזר כדי לבדוק אם זה לגו */}
        {isLego && (
          <>
            <input
              type="text"
              placeholder="מספר סט"
              value={item.set_number}
              onChange={(e) => onItemChange(index, 'set_number', e.target.value)}
              onBlur={(e) => onSetNumberBlur(index, e.target.value)}
              style={{ ...inputStyle, borderColor: item.set_number ? 'var(--primary-hi)' : 'var(--border)' }}
            />

            <input
              type="text"
              list={`themes-${index}`}
              placeholder="נושא (למשל: Star Wars)"
              value={item.theme}
              onChange={(e) => onItemChange(index, 'theme', e.target.value)}
              style={inputStyle}
            />
            <datalist id={`themes-${index}`}>
              {legoThemes.map((t, i) => (
                <option key={i} value={t} />
              ))}
            </datalist>

            <select
              value={item.brand || 'LEGO'}
              onChange={(e) => onItemChange(index, 'brand', e.target.value)}
              style={inputStyle}
            >
              {BRAND_OPTIONS.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </>
        )}

        <div style={{ display: 'flex', gap: '5px' }}>
          <select value={item.discount_type} onChange={(e) => onItemChange(index, 'discount_type', e.target.value)} style={{ ...inputStyle, width: '80px' }}>
            <option value="amount">₪</option>
            <option value="percent">%</option>
          </select>
          <input type="number" placeholder="הנחה" value={item.discount_value} onChange={(e) => onItemChange(index, 'discount_value', e.target.value)} style={inputStyle} />
        </div>
      </div>
    </div>
  );
};

export default ItemCard;
