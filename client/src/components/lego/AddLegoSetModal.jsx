import React, { useState } from 'react';
import { addLegoSet } from '../../services/api';
import { BRAND_OPTIONS, STATUS_OPTIONS } from '../../utils/legoHelpers';

const DEFAULT_FORM = {
  set_number: '',
  name: '',
  theme: '',
  brand: 'LEGO',
  status: 'New',
  pieces: '',
  purchase_price: '',
  original_price: '',
  market_value: '',
  purchase_date: '',
};

const AddLegoSetModal = ({ show, onClose, onSave }) => {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: null }));
  };

  const validate = () => {
    const next = {};
    if (!form.set_number.trim()) next.set_number = 'שדה חובה';
    if (!form.name.trim()) next.name = 'שדה חובה';
    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSaving(true);
    try {
      const numOrNull = (v) => (v !== '' && v != null ? Number(v) : null);
      const payload = {
        set_number: form.set_number.trim(),
        name: form.name.trim(),
        theme: form.theme.trim() || null,
        brand: form.brand,
        status: form.status,
        pieces: numOrNull(form.pieces),
        purchase_price: numOrNull(form.purchase_price),
        original_price: numOrNull(form.original_price),
        market_value: numOrNull(form.market_value),
        purchase_date: form.purchase_date || null,
      };
      await addLegoSet(payload);
      setForm(DEFAULT_FORM);
      setErrors({});
      onSave();
    } catch (err) {
      console.error('AddLegoSetModal save error:', err);
      alert('שגיאה בשמירת הסט. נסה שנית.');
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = () => {
    if (!saving) onClose();
  };

  if (!show) return null;

  const statusForForm = STATUS_OPTIONS.filter(o => o.key !== 'All');

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle} onClick={e => e.stopPropagation()} dir="rtl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>
            הוספת סט לגו
          </h2>
          <button onClick={onClose} disabled={saving} style={closeBtnStyle}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* set_number + name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>
                מספר סט <span style={{ color: 'var(--neg)' }}>*</span>
              </label>
              <input
                name="set_number"
                value={form.set_number}
                onChange={handleChange}
                placeholder="לדוגמה: 10278-1"
                style={errors.set_number ? { ...inputStyle, borderColor: 'var(--neg)' } : inputStyle}
              />
              {errors.set_number && <span style={errorStyle}>{errors.set_number}</span>}
            </div>
            <div>
              <label style={labelStyle}>
                שם הסט <span style={{ color: 'var(--neg)' }}>*</span>
              </label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="לדוגמה: תחנת משטרה"
                style={errors.name ? { ...inputStyle, borderColor: 'var(--neg)' } : inputStyle}
              />
              {errors.name && <span style={errorStyle}>{errors.name}</span>}
            </div>
          </div>

          {/* theme + brand */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>ערכת נושא</label>
              <input
                name="theme"
                value={form.theme}
                onChange={handleChange}
                placeholder="לדוגמה: City"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>מותג</label>
              <select name="brand" value={form.brand} onChange={handleChange} style={inputStyle}>
                {BRAND_OPTIONS.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>

          {/* status + pieces */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>סטטוס</label>
              <select name="status" value={form.status} onChange={handleChange} style={inputStyle}>
                {statusForForm.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>מספר חלקים</label>
              <input
                type="number"
                name="pieces"
                value={form.pieces}
                onChange={handleChange}
                placeholder="לדוגמה: 2923"
                min="0"
                style={inputStyle}
              />
            </div>
          </div>

          {/* purchase_price + original_price */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>מחיר קנייה (₪)</label>
              <input
                type="number"
                name="purchase_price"
                value={form.purchase_price}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="0.01"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>מחיר מחירון (₪)</label>
              <input
                type="number"
                name="original_price"
                value={form.original_price}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="0.01"
                style={inputStyle}
              />
            </div>
          </div>

          {/* market_value + purchase_date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>שווי שוק (₪)</label>
              <input
                type="number"
                name="market_value"
                value={form.market_value}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="0.01"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>תאריך רכישה</label>
              <input
                type="date"
                name="purchase_date"
                value={form.purchase_date}
                onChange={handleChange}
                style={{ ...inputStyle, direction: 'ltr' }}
              />
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-start', marginTop: 8 }}>
            <button type="submit" disabled={saving} style={saveBtnStyle}>
              {saving ? 'שומר...' : 'הוסף סט'}
            </button>
            <button type="button" onClick={onClose} disabled={saving} style={cancelBtnStyle}>
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalStyle = {
  backgroundColor: 'var(--surface-elev)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--r-16)',
  padding: 32,
  width: '100%',
  maxWidth: 560,
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: 'var(--shadow-md)',
};

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--ink-3)',
  marginBottom: 6,
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--r-8)',
  fontSize: 14,
  color: 'var(--ink-1)',
  backgroundColor: 'var(--surface-3)',
  boxSizing: 'border-box',
  outline: 'none',
};

const errorStyle = {
  display: 'block',
  fontSize: 12,
  color: 'var(--neg)',
  marginTop: 4,
};

const saveBtnStyle = {
  background: 'var(--primary-grad)',
  color: 'var(--primary-ink)',
  border: 'none',
  borderRadius: 'var(--r-8)',
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 0 16px rgba(124,92,255,0.25)',
};

const cancelBtnStyle = {
  backgroundColor: 'var(--surface-3)',
  color: 'var(--ink-2)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--r-8)',
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const closeBtnStyle = {
  background: 'none',
  border: 'none',
  fontSize: 20,
  color: 'var(--ink-4)',
  cursor: 'pointer',
  padding: 4,
  lineHeight: 1,
};

export default AddLegoSetModal;
