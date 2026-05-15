import React, { useState, useEffect } from 'react';
import { Plus, Edit2, X, CreditCard } from 'lucide-react';
import {
  getSettingsPaymentSources,
  createSettingsPaymentSource,
  updateSettingsPaymentSource,
  deleteSettingsPaymentSource,
} from '../../services/api';

const METHOD_CONFIG = {
  credit_card:    { label: 'כרטיס אשראי',  bg: '#EFF6FF', color: '#1D4ED8' },
  debit_card:     { label: 'כרטיס חיוב',   bg: '#F0FDF4', color: '#15803D' },
  cash:           { label: 'מזומן',         bg: '#FEFCE8', color: '#A16207' },
  bank_transfer:  { label: 'העברה בנקאית', bg: '#F5F3FF', color: '#6D28D9' },
  digital_wallet: { label: 'ארנק דיגיטלי', bg: '#FFF7ED', color: '#C2410C' },
  check:          { label: 'המחאה',         bg: '#F8FAFC', color: '#475569' },
};

const METHODS = Object.entries(METHOD_CONFIG).map(([value, { label }]) => ({ value, label }));

const PaymentSourcesTab = () => {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [formName, setFormName] = useState('');
  const [formMethod, setFormMethod] = useState('credit_card');
  const [formIssuer, setFormIssuer] = useState('');
  const [formLast4, setFormLast4] = useState('');
  const [formOwner, setFormOwner] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  const fetchSources = async () => {
    try {
      setError(null);
      const res = await getSettingsPaymentSources();
      setSources(res.data);
    } catch {
      setError('שגיאה בטעינת מקורות התשלום. נסה לרענן את הדף.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSources(); }, []);

  const openCreate = () => {
    setEditingSource(null);
    setFormName('');
    setFormMethod('credit_card');
    setFormIssuer('');
    setFormLast4('');
    setFormOwner('');
    setFormIsActive(true);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (ps) => {
    setEditingSource(ps);
    setFormName(ps.name);
    setFormMethod(ps.method || 'credit_card');
    setFormIssuer(ps.issuer || '');
    setFormLast4(ps.last4 || '');
    setFormOwner(ps.owner || '');
    setFormIsActive(ps.is_active);
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingSource(null);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError('נא להזין שם למקור התשלום');
      return;
    }

    const payload = {
      name:   formName.trim(),
      method: formMethod,
      issuer: formIssuer.trim() || null,
      last4:  formLast4.trim() || null,
      owner:  formOwner.trim() || null,
    };

    if (editingSource) {
      payload.is_active = formIsActive;
    }

    setFormLoading(true);
    setFormError(null);

    try {
      if (editingSource) {
        await updateSettingsPaymentSource(editingSource.id, payload);
      } else {
        await createSettingsPaymentSource(payload);
      }
      closeModal();
      fetchSources();
    } catch (err) {
      setFormError(err.response?.data?.error || 'שגיאה בשמירת מקור התשלום');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivate = async (ps) => {
    if (!window.confirm(
      `לבטל את אמצעי התשלום "${ps.name}"?\n\nהוא לא יופיע בבחירת אמצעי תשלום בתנועות חדשות, אך תנועות קיימות לא יושפעו.`
    )) return;
    try {
      await deleteSettingsPaymentSource(ps.id);
      fetchSources();
    } catch {
      alert('שגיאה בביטול אמצעי התשלום');
    }
  };

  const handleReactivate = async (ps) => {
    try {
      await updateSettingsPaymentSource(ps.id, { is_active: true });
      fetchSources();
    } catch {
      alert('שגיאה בהפעלת אמצעי התשלום מחדש');
    }
  };

  const activeCount   = sources.filter(s => s.is_active).length;
  const inactiveCount = sources.filter(s => !s.is_active).length;
  const displayed     = showInactive ? sources : sources.filter(s => s.is_active);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 48, color: '#64748B' }}>טוען מקורות תשלום...</div>;
  }

  return (
    <>
      {/* Page-level error */}
      {error && (
        <div style={errorBannerStyle}>{error}</div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, color: '#64748B' }}>
            {activeCount} פעיל
            {inactiveCount > 0 && ` · ${inactiveCount} מושבת`}
          </span>
          {inactiveCount > 0 && (
            <button
              onClick={() => setShowInactive(v => !v)}
              style={{
                ...ghostBtnStyle,
                backgroundColor: showInactive ? '#EFF6FF' : '#F8FAFC',
                color: showInactive ? '#2563EB' : '#64748B',
                borderColor: showInactive ? '#BFDBFE' : '#E2E8F0',
              }}
            >
              {showInactive ? 'הסתר מושבתים' : 'הצג מושבתים'}
            </button>
          )}
        </div>
        <button onClick={openCreate} style={addBtnStyle}>
          <Plus size={18} /> מקור תשלום חדש
        </button>
      </div>

      {/* Empty state */}
      {displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', border: '2px dashed #E2E8F0', borderRadius: 12 }}>
          <CreditCard size={36} style={{ marginBottom: 10 }} />
          <p style={{ margin: '0 0 6px' }}>
            {sources.length === 0 ? 'אין מקורות תשלום עדיין.' : 'אין מקורות תשלום פעילים.'}
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>לחץ על "מקור תשלום חדש" כדי להוסיף.</p>
        </div>
      ) : (
        <div style={listCardStyle}>
          {displayed.map((ps, idx) => {
            const methodConf = METHOD_CONFIG[ps.method] || { label: ps.method, bg: '#F8FAFC', color: '#475569' };

            return (
              <div
                key={ps.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '13px 16px',
                  borderTop: idx > 0 ? '1px solid #F1F5F9' : 'none',
                  opacity: ps.is_active ? 1 : 0.55,
                  transition: 'opacity 0.2s',
                }}
              >
                {/* Icon + name + subtitle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 22, width: 32, textAlign: 'center', flexShrink: 0, lineHeight: 1 }}>
                    💳
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#1E293B' }}>
                      {ps.name}{ps.last4 ? ` (${ps.last4})` : ''}
                    </div>
                    {ps.issuer && (
                      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                        {ps.issuer}
                      </div>
                    )}
                  </div>
                </div>

                {/* Badges + actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ ...badgeStyle, background: methodConf.bg, color: methodConf.color }}>
                    {methodConf.label}
                  </span>
                  {!ps.is_active && (
                    <span style={{ ...badgeStyle, background: '#F1F5F9', color: '#94A3B8' }}>
                      מושבת
                    </span>
                  )}
                  <button onClick={() => openEdit(ps)} style={iconBtnStyle} title="עריכה">
                    <Edit2 size={14} />
                  </button>
                  {ps.is_active ? (
                    <button
                      onClick={() => handleDeactivate(ps)}
                      style={{ ...iconBtnStyle, color: '#EF4444' }}
                      title="השבתה"
                    >
                      <X size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReactivate(ps)}
                      style={{ ...iconBtnStyle, color: '#059669', fontSize: 16 }}
                      title="הפעלה מחדש"
                    >
                      ✓
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#1E293B' }}>
                {editingSource ? 'עריכת מקור תשלום' : 'מקור תשלום חדש'}
              </h2>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {/* Inline form error */}
            {formError && (
              <div style={errorBannerStyle}>{formError}</div>
            )}

            {/* Name */}
            <div style={fieldStyle}>
              <label style={labelStyle}>שם *</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="למשל: ויזה 5304, ביט, מזומן..."
                style={inputStyle}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>

            {/* Method */}
            <div style={fieldStyle}>
              <label style={labelStyle}>סוג אמצעי תשלום *</label>
              <select value={formMethod} onChange={e => setFormMethod(e.target.value)} style={inputStyle}>
                {METHODS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Issuer */}
            <div style={fieldStyle}>
              <label style={labelStyle}>מנפיק / בנק</label>
              <input
                type="text"
                value={formIssuer}
                onChange={e => setFormIssuer(e.target.value)}
                placeholder="למשל: לאומי, מזרחי, הפועלים..."
                style={inputStyle}
              />
            </div>

            {/* Last4 */}
            <div style={fieldStyle}>
              <label style={labelStyle}>4 ספרות אחרונות</label>
              <input
                type="text"
                value={formLast4}
                onChange={e => setFormLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                maxLength={4}
                style={{ ...inputStyle, width: 100 }}
              />
            </div>

            {/* Owner */}
            <div style={fieldStyle}>
              <label style={labelStyle}>שם בעל החשבון</label>
              <input
                type="text"
                value={formOwner}
                onChange={e => setFormOwner(e.target.value)}
                placeholder="שם הבעלים (אופציונלי)"
                style={inputStyle}
              />
            </div>

            {/* Is Active — edit mode only */}
            {editingSource && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                <input
                  type="checkbox"
                  id="formPsIsActive"
                  checked={formIsActive}
                  onChange={e => setFormIsActive(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                <label htmlFor="formPsIsActive" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>
                  מקור תשלום פעיל
                </label>
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={cancelBtnStyle}>ביטול</button>
              <button
                onClick={handleSave}
                disabled={formLoading}
                style={{ ...saveBtnStyle, opacity: formLoading ? 0.7 : 1 }}
              >
                {formLoading ? 'שומר...' : 'שמור'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// --- Styles (identical to CategoriesTab) ---
const errorBannerStyle = {
  background: '#FEF2F2', border: '1px solid #FECACA',
  borderRadius: 8, padding: '10px 14px', marginBottom: 16,
  color: '#B91C1C', fontSize: 13,
};
const listCardStyle = {
  background: 'white', borderRadius: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #F1F5F9',
  overflow: 'hidden',
};
const badgeStyle = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 10px', borderRadius: 9999,
  fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
};
const addBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  backgroundColor: '#2563EB', color: 'white',
  border: 'none', borderRadius: 8, padding: '10px 20px',
  cursor: 'pointer', fontWeight: 600, fontSize: 14,
  boxShadow: '0 4px 12px rgba(37,99,235,0.2)',
};
const ghostBtnStyle = {
  display: 'inline-flex', alignItems: 'center',
  border: '1px solid', borderRadius: 6,
  padding: '4px 12px', cursor: 'pointer',
  fontSize: 13, fontWeight: 500, background: 'transparent',
};
const iconBtnStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, borderRadius: 8,
  border: 'none', background: '#F8FAFC',
  cursor: 'pointer', color: '#64748B',
};
const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999,
};
const modalStyle = {
  backgroundColor: 'white', padding: 28, borderRadius: 16,
  width: 480, maxWidth: '90%',
  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.12)',
  textAlign: 'right',
};
const fieldStyle = { marginBottom: 14 };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 };
const inputStyle = {
  width: '100%', padding: '9px 12px',
  border: '1px solid #E2E8F0', borderRadius: 8,
  fontSize: 14, boxSizing: 'border-box',
};
const cancelBtnStyle = {
  padding: '10px 20px', border: '1px solid #E2E8F0', borderRadius: 8,
  background: 'white', cursor: 'pointer', color: '#475569', fontSize: 14,
};
const saveBtnStyle = {
  padding: '10px 24px', border: 'none', borderRadius: 8,
  background: '#2563EB', color: 'white',
  cursor: 'pointer', fontWeight: 600, fontSize: 14,
};

export default PaymentSourcesTab;
