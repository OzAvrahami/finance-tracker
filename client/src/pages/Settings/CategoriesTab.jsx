import React, { useState, useEffect } from 'react';
import { Plus, Edit2, X, Tag } from 'lucide-react';
import {
  getSettingsCategories,
  createSettingsCategory,
  updateSettingsCategory,
  deleteSettingsCategory,
} from '../../services/api';

const TYPE_CONFIG = {
  expense: { label: 'הוצאה', bg: '#FFF7ED', color: '#C2410C' },
  income:  { label: 'הכנסה', bg: '#F0FDF4', color: '#16A34A' },
};

const CategoriesTab = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null); // null = create mode
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('expense');
  const [formIcon, setFormIcon] = useState('');
  const [formKeywords, setFormKeywords] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  const fetchCategories = async () => {
    try {
      setError(null);
      const res = await getSettingsCategories();
      setCategories(res.data);
    } catch {
      setError('שגיאה בטעינת הקטגוריות. נסה לרענן את הדף.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCategories(); }, []);

  const openCreate = () => {
    setEditingCategory(null);
    setFormName('');
    setFormType('expense');
    setFormIcon('');
    setFormKeywords('');
    setFormIsActive(true);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (cat) => {
    setEditingCategory(cat);
    setFormName(cat.name);
    setFormType(cat.type);
    setFormIcon(cat.icon || '');
    setFormKeywords((cat.keywords || []).join(', '));
    setFormIsActive(cat.is_active);
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCategory(null);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError('נא להזין שם קטגוריה');
      return;
    }

    const keywordsArray = formKeywords
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    const payload = {
      name: formName.trim(),
      type: formType,
      icon: formIcon.trim() || null,
      keywords: keywordsArray,
    };

    if (editingCategory) {
      payload.is_active = formIsActive;
    }

    setFormLoading(true);
    setFormError(null);

    try {
      if (editingCategory) {
        await updateSettingsCategory(editingCategory.id, payload);
      } else {
        await createSettingsCategory(payload);
      }
      closeModal();
      fetchCategories();
    } catch (err) {
      setFormError(err.response?.data?.error || 'שגיאה בשמירת הקטגוריה');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivate = async (cat) => {
    if (!window.confirm(
      `לבטל את הקטגוריה "${cat.name}"?\n\nהיא לא תופיע בתנועות חדשות, אך תנועות קיימות לא יושפעו.`
    )) return;
    try {
      await deleteSettingsCategory(cat.id);
      fetchCategories();
    } catch {
      alert('שגיאה בביטול הקטגוריה');
    }
  };

  const handleReactivate = async (cat) => {
    try {
      await updateSettingsCategory(cat.id, { is_active: true });
      fetchCategories();
    } catch {
      alert('שגיאה בהפעלת הקטגוריה מחדש');
    }
  };

  const activeCount   = categories.filter(c => c.is_active).length;
  const inactiveCount = categories.filter(c => !c.is_active).length;
  const displayed     = showInactive ? categories : categories.filter(c => c.is_active);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 48, color: '#64748B' }}>טוען קטגוריות...</div>;
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
            {activeCount} פעילות
            {inactiveCount > 0 && ` · ${inactiveCount} מושבתות`}
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
              {showInactive ? 'הסתר מושבתות' : 'הצג מושבתות'}
            </button>
          )}
        </div>
        <button onClick={openCreate} style={addBtnStyle}>
          <Plus size={18} /> קטגוריה חדשה
        </button>
      </div>

      {/* Empty state */}
      {displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', border: '2px dashed #E2E8F0', borderRadius: 12 }}>
          <Tag size={36} style={{ marginBottom: 10 }} />
          <p style={{ margin: '0 0 6px' }}>
            {categories.length === 0 ? 'אין קטגוריות עדיין.' : 'אין קטגוריות פעילות.'}
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>לחץ על "קטגוריה חדשה" כדי להוסיף.</p>
        </div>
      ) : (
        <div style={listCardStyle}>
          {displayed.map((cat, idx) => {
            const typeConf   = TYPE_CONFIG[cat.type] || TYPE_CONFIG.expense;
            const kwCount    = (cat.keywords || []).filter(Boolean).length;

            return (
              <div
                key={cat.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '13px 16px',
                  borderTop: idx > 0 ? '1px solid #F1F5F9' : 'none',
                  opacity: cat.is_active ? 1 : 0.55,
                  transition: 'opacity 0.2s',
                }}
              >
                {/* Icon + name + keywords hint */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 22, width: 32, textAlign: 'center', flexShrink: 0, lineHeight: 1 }}>
                    {cat.icon || '🏷️'}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#1E293B' }}>
                      {cat.name}
                    </div>
                    {kwCount > 0 && (
                      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                        {kwCount} מילות מפתח
                      </div>
                    )}
                  </div>
                </div>

                {/* Badges + actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ ...badgeStyle, background: typeConf.bg, color: typeConf.color }}>
                    {typeConf.label}
                  </span>
                  {!cat.is_active && (
                    <span style={{ ...badgeStyle, background: '#F1F5F9', color: '#94A3B8' }}>
                      מושבתת
                    </span>
                  )}
                  <button onClick={() => openEdit(cat)} style={iconBtnStyle} title="עריכה">
                    <Edit2 size={14} />
                  </button>
                  {cat.is_active ? (
                    <button
                      onClick={() => handleDeactivate(cat)}
                      style={{ ...iconBtnStyle, color: '#EF4444' }}
                      title="השבתה"
                    >
                      <X size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReactivate(cat)}
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
                {editingCategory ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}
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
              <label style={labelStyle}>שם הקטגוריה *</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="למשל: מזון, בידור, שכר..."
                style={inputStyle}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>

            {/* Type */}
            <div style={fieldStyle}>
              <label style={labelStyle}>סוג *</label>
              <select value={formType} onChange={e => setFormType(e.target.value)} style={inputStyle}>
                <option value="expense">הוצאה</option>
                <option value="income">הכנסה</option>
              </select>
              {editingCategory && (
                <p style={hintStyle}>שינוי סוג חסום אם קיימות תנועות מקושרות לקטגוריה.</p>
              )}
            </div>

            {/* Icon */}
            <div style={fieldStyle}>
              <label style={labelStyle}>אייקון (אמוג׳י)</label>
              <input
                type="text"
                value={formIcon}
                onChange={e => setFormIcon(e.target.value)}
                placeholder="🏷️"
                style={{ ...inputStyle, fontSize: 20 }}
              />
            </div>

            {/* Keywords */}
            <div style={fieldStyle}>
              <label style={labelStyle}>מילות מפתח לסיווג אוטומטי</label>
              <input
                type="text"
                value={formKeywords}
                onChange={e => setFormKeywords(e.target.value)}
                placeholder="סופר, מכולת, שופרסל (מופרדות בפסיקים)"
                style={inputStyle}
              />
              <p style={hintStyle}>משמשות לסיווג אוטומטי בייבוא קבצים ובבוט WhatsApp.</p>
            </div>

            {/* Is Active — edit mode only */}
            {editingCategory && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                <input
                  type="checkbox"
                  id="formIsActive"
                  checked={formIsActive}
                  onChange={e => setFormIsActive(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                <label htmlFor="formIsActive" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>
                  קטגוריה פעילה
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

// --- Styles ---
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
const hintStyle  = { fontSize: 12, color: '#94A3B8', margin: '4px 0 0' };
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

export default CategoriesTab;
