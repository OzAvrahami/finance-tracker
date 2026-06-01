import React, { useState, useEffect } from 'react';
import { addLegoSet, updateLegoSet, deleteLegoSet, getLegoSetDetails } from '../../services/api';
import { BRAND_OPTIONS, STATUS_OPTIONS } from '../../utils/legoHelpers';

const ACQUISITION_OPTIONS = [
  { key: 'purchased', label: 'נרכש' },
  { key: 'gift',      label: 'מתנה' },
  { key: 'trade',     label: 'החלפה' },
  { key: 'other',     label: 'אחר' },
];

const DEFAULT_FORM = {
  set_number: '',
  name: '',
  theme: '',
  brand: 'LEGO',
  status: 'New',
  pieces: '',
  acquisition_type: 'purchased',
  purchase_date: '',
  purchase_price: '',
  original_price: '',
  market_value: '',
};

const AddLegoSetModal = ({ show, onClose, onSave, initialData = null, existingSets = [] }) => {
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState({});
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState(null);

  const isEditMode = Boolean(initialData);

  // Populate form from initialData when opening in edit mode
  useEffect(() => {
    if (show && initialData) {
      setForm({
        set_number: initialData.set_number || '',
        name: initialData.name || '',
        theme: initialData.theme || '',
        brand: initialData.brand || 'LEGO',
        status: initialData.status || 'New',
        pieces: initialData.pieces ?? '',
        acquisition_type: initialData.acquisition_type || 'purchased',
        purchase_date: initialData.purchase_date || '',
        purchase_price: initialData.purchase_price ?? '',
        original_price: initialData.original_price ?? '',
        market_value: initialData.market_value ?? '',
      });
      setErrors({});
      setLookupError(null);
      setLookingUp(false);
    }
  }, [show, initialData]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: null }));
    if (name === 'set_number') setLookupError(null);
  };

  const resetForm = () => {
    setForm({ ...DEFAULT_FORM });
    setErrors({});
    setLookupError(null);
    setLookingUp(false);
    setDeleting(false);
  };

  const handleClose = () => {
    if (saving || deleting) return;
    resetForm();
    onClose();
  };

  const isDuplicateSetNumber = (trimmed) =>
    existingSets.some(s =>
      s.set_number === trimmed && (!initialData || s.id !== initialData.id)
    );

  const runLookup = async () => {
    const trimmed = form.set_number.trim();
    if (!trimmed) return;

    // Duplicate check takes priority — skip Rebrickable if already in collection
    if (isDuplicateSetNumber(trimmed)) {
      setLookupError('הסט כבר קיים באוסף');
      return;
    }

    // In edit mode, skip Rebrickable if set_number is unchanged
    if (isEditMode && trimmed === initialData.set_number) return;

    setLookingUp(true);
    setLookupError(null);
    try {
      const res = await getLegoSetDetails(trimmed);
      setForm(prev => ({
        ...prev,
        name:   !prev.name   ? (res.data.name  ?? prev.name)   : prev.name,
        theme:  !prev.theme  ? (res.data.theme ?? prev.theme)  : prev.theme,
        pieces: !prev.pieces ? (res.data.parts ?? prev.pieces) : prev.pieces,
      }));
    } catch {
      setLookupError('סט לא נמצא');
    } finally {
      setLookingUp(false);
    }
  };

  const validate = () => {
    const next = {};
    if (!form.set_number.trim()) {
      next.set_number = 'שדה חובה';
    } else if (isDuplicateSetNumber(form.set_number.trim())) {
      next.set_number = 'הסט כבר קיים באוסף';
    }
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
        acquisition_type: form.acquisition_type,
        pieces: numOrNull(form.pieces),
        purchase_price: numOrNull(form.purchase_price),
        original_price: numOrNull(form.original_price),
        market_value: numOrNull(form.market_value),
        purchase_date: form.purchase_date || null,
      };
      if (isEditMode) {
        await updateLegoSet(initialData.id, payload);
      } else {
        await addLegoSet(payload);
      }
      resetForm();
      onSave();
    } catch (err) {
      console.error('AddLegoSetModal save error:', err);
      if (err.response?.status === 409) {
        setErrors(prev => ({ ...prev, set_number: 'הסט כבר קיים באוסף' }));
      } else {
        alert('שגיאה בשמירת הסט. נסה שנית.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('למחוק את הסט לצמיתות?')) return;
    setDeleting(true);
    try {
      await deleteLegoSet(initialData.id);
      resetForm();
      onSave();
    } catch (err) {
      console.error('AddLegoSetModal delete error:', err);
      alert('שגיאה במחיקת הסט. נסה שנית.');
      setDeleting(false);
    }
  };

  const handleOverlayClick = () => {
    if (!saving && !deleting) handleClose();
  };

  if (!show) return null;

  const statusForForm = STATUS_OPTIONS.filter(o => o.key !== 'All');
  const busy = saving || deleting;

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle} onClick={e => e.stopPropagation()} dir="rtl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>
            {isEditMode ? 'עריכת סט לגו' : 'הוספת סט לגו'}
          </h2>
          <button onClick={handleClose} disabled={busy} style={closeBtnStyle}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ===== Section 1: פרטי הסט ===== */}
          <div style={sectionTitleStyle}>פרטי הסט</div>

          {/* set_number (with lookup button) + name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>
                מספר סט <span style={{ color: 'var(--neg)' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  name="set_number"
                  value={form.set_number}
                  onChange={handleChange}
                  onBlur={runLookup}
                  placeholder="לדוגמה: 10278-1"
                  style={
                    errors.set_number || lookupError
                      ? { ...inputStyle, borderColor: 'var(--neg)' }
                      : lookingUp
                      ? { ...inputStyle, borderColor: 'var(--ink-4)' }
                      : inputStyle
                  }
                />
                <button
                  type="button"
                  onClick={runLookup}
                  disabled={busy || lookingUp || !form.set_number.trim()}
                  style={lookupBtnStyle}
                >
                  טען פרטי סט
                </button>
              </div>
              {errors.set_number && <span style={errorStyle}>{errors.set_number}</span>}
              {lookingUp && (
                <span style={{ ...errorStyle, color: 'var(--ink-4)' }}>מחפש...</span>
              )}
              {lookupError && !lookingUp && (
                <span style={errorStyle}>{lookupError}</span>
              )}
              {!errors.set_number && !lookingUp && !lookupError && (
                <span style={hintStyle}>הקלד מספר סט וטען פרטים אוטומטית</span>
              )}
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

          {/* theme + pieces */}
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

          {/* brand + status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>מותג</label>
              <select name="brand" value={form.brand} onChange={handleChange} style={inputStyle}>
                {BRAND_OPTIONS.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>סטטוס</label>
              <select name="status" value={form.status} onChange={handleChange} style={inputStyle}>
                {statusForForm.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ===== Section 2: רכישה ושווי ===== */}
          <div style={{ ...sectionTitleStyle, marginTop: 8 }}>רכישה ושווי</div>

          {/* acquisition_type + purchase_date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>אופן קבלה</label>
              <select
                name="acquisition_type"
                value={form.acquisition_type}
                onChange={handleChange}
                style={inputStyle}
              >
                {ACQUISITION_OPTIONS.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>תאריך כניסה לאוסף</label>
              <input
                type="date"
                name="purchase_date"
                value={form.purchase_date}
                onChange={handleChange}
                style={{ ...inputStyle, direction: 'ltr' }}
              />
            </div>
          </div>

          {/* purchase_price + original_price */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>מחיר ששולם (₪)</label>
              <input
                type="number"
                name="purchase_price"
                value={form.purchase_price}
                onChange={handleChange}
                placeholder="אופציונלי"
                min="0"
                step="0.01"
                style={inputStyle}
              />
              {form.acquisition_type === 'gift' && (
                <span style={hintStyle}>בדרך כלל נשאר ריק עבור מתנה</span>
              )}
            </div>
            <div>
              <label style={labelStyle}>מחיר מחירון (₪)</label>
              <input
                type="number"
                name="original_price"
                value={form.original_price}
                onChange={handleChange}
                placeholder="אופציונלי"
                min="0"
                step="0.01"
                style={inputStyle}
              />
            </div>
          </div>

          {/* market_value */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>שווי שוק (₪)</label>
              <input
                type="number"
                name="market_value"
                value={form.market_value}
                onChange={handleChange}
                placeholder="אופציונלי"
                min="0"
                step="0.01"
                style={inputStyle}
              />
            </div>
            <div />
          </div>

          {/* Actions: save+cancel on right (RTL start), delete on left (RTL end) */}
          <div style={{
            display: 'flex',
            justifyContent: isEditMode ? 'space-between' : 'flex-start',
            alignItems: 'center',
            marginTop: 8,
          }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="submit" disabled={busy} style={saveBtnStyle}>
                {saving ? 'שומר...' : isEditMode ? 'שמור שינויים' : 'הוסף סט'}
              </button>
              <button type="button" onClick={handleClose} disabled={busy} style={cancelBtnStyle}>
                ביטול
              </button>
            </div>
            {isEditMode && (
              <button type="button" onClick={handleDelete} disabled={busy} style={deleteBtnStyle}>
                {deleting ? 'מוחק...' : 'מחק סט'}
              </button>
            )}
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

const hintStyle = {
  display: 'block',
  fontSize: 12,
  color: 'var(--ink-4)',
  marginTop: 4,
};

const sectionTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--ink-2)',
  paddingBottom: 6,
  borderBottom: '1px solid var(--border)',
};

const lookupBtnStyle = {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  backgroundColor: 'var(--surface-3)',
  color: 'var(--ink-2)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--r-8)',
  padding: '0 12px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
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

const deleteBtnStyle = {
  backgroundColor: 'transparent',
  color: 'var(--neg)',
  border: '1px solid var(--neg)',
  borderRadius: 'var(--r-8)',
  padding: '10px 20px',
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
