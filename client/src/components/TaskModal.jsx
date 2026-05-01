import React, { useState, useEffect } from 'react';
import { getAllLoans, getTransactions, createTask, updateTask } from '../services/api';

const STATUS_OPTIONS = [
  { value: 'open', label: 'פתוח' },
  { value: 'in_progress', label: 'בתהליך' },
  { value: 'waiting', label: 'המתנה' },
  { value: 'done', label: 'הושלם' },
  { value: 'cancelled', label: 'בוטל' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'נמוך' },
  { value: 'medium', label: 'בינוני' },
  { value: 'high', label: 'גבוה' },
  { value: 'urgent', label: 'דחוף' },
];

const CATEGORY_OPTIONS = [
  { value: 'finance', label: 'פיננסי' },
  { value: 'personal', label: 'אישי' },
  { value: 'work', label: 'עבודה' },
  { value: 'system', label: 'מערכת' },
  { value: 'other', label: 'אחר' },
];

const DEFAULT_FORM = {
  title: '',
  notes: '',
  status: 'open',
  priority: 'medium',
  category: 'personal',
  due_date: '',
  transaction_id: '',
  loan_id: '',
};

const TaskModal = ({ show, task, onClose, onSave }) => {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loans, setLoans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingEntities, setLoadingEntities] = useState(false);

  useEffect(() => {
    if (!show) return;
    setLoadingEntities(true);
    Promise.all([
      getAllLoans().catch(() => ({ data: [] })),
      getTransactions().catch(() => ({ data: [] })),
    ]).then(([loansRes, transRes]) => {
      setLoans(loansRes.data || []);
      setTransactions((transRes.data || []).slice(0, 50));
    }).finally(() => setLoadingEntities(false));
  }, [show]);

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title || '',
        notes: task.notes || '',
        status: task.status || 'open',
        priority: task.priority || 'medium',
        category: task.category || 'personal',
        due_date: task.due_date || '',
        transaction_id: task.transaction_id ?? '',
        loan_id: task.loan_id ?? '',
      });
    } else {
      setForm(DEFAULT_FORM);
    }
  }, [task, show]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        due_date: form.due_date || null,
        transaction_id: form.transaction_id ? Number(form.transaction_id) : null,
        loan_id: form.loan_id ? Number(form.loan_id) : null,
      };
      if (task) {
        await updateTask(task.id, payload);
      } else {
        await createTask(payload);
      }
      onSave();
    } catch (error) {
      console.error('TaskModal save error:', error);
      alert('שגיאה בשמירת המשימה');
    } finally {
      setSaving(false);
    }
  };

  if (!show) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()} dir="rtl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', margin: 0 }}>
            {task ? 'עריכת משימה' : 'משימה חדשה'}
          </h2>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Title */}
          <div>
            <label style={labelStyle}>
              כותרת <span style={{ color: '#E11D48' }}>*</span>
            </label>
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="תיאור המשימה..."
              required
              style={inputStyle}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>הערות</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              placeholder="פרטים נוספים..."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Status + Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>סטטוס</label>
              <select name="status" value={form.status} onChange={handleChange} style={inputStyle}>
                {STATUS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>עדיפות</label>
              <select name="priority" value={form.priority} onChange={handleChange} style={inputStyle}>
                {PRIORITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Category + Due Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>קטגוריה</label>
              <select name="category" value={form.category} onChange={handleChange} style={inputStyle}>
                {CATEGORY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>תאריך יעד</label>
              <input
                type="date"
                name="due_date"
                value={form.due_date}
                onChange={handleChange}
                style={{ ...inputStyle, direction: 'ltr' }}
              />
            </div>
          </div>

          {/* Link to Transaction */}
          <div>
            <label style={labelStyle}>קישור לתנועה (אופציונלי)</label>
            <select
              name="transaction_id"
              value={form.transaction_id}
              onChange={handleChange}
              style={inputStyle}
              disabled={loadingEntities}
            >
              <option value="">— ללא —</option>
              {transactions.map(t => (
                <option key={t.id} value={t.id}>
                  {t.description} · ₪{Number(t.total_amount).toLocaleString()} · {t.transaction_date}
                </option>
              ))}
            </select>
          </div>

          {/* Link to Loan */}
          <div>
            <label style={labelStyle}>קישור להלוואה (אופציונלי)</label>
            <select
              name="loan_id"
              value={form.loan_id}
              onChange={handleChange}
              style={inputStyle}
              disabled={loadingEntities}
            >
              <option value="">— ללא —</option>
              {loans.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name} · ₪{Number(l.current_balance).toLocaleString()} יתרה
                </option>
              ))}
            </select>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-start', marginTop: 8 }}>
            <button type="submit" disabled={saving} style={saveBtnStyle}>
              {saving ? 'שומר...' : task ? 'עדכן משימה' : 'צור משימה'}
            </button>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>ביטול</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const overlayStyle = {
  position: 'fixed', inset: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000,
};
const modalStyle = {
  backgroundColor: 'white',
  borderRadius: 16,
  padding: 32,
  width: '100%',
  maxWidth: 560,
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
};
const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#475569',
  marginBottom: 6,
};
const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  fontSize: 14,
  color: '#1E293B',
  backgroundColor: 'white',
  boxSizing: 'border-box',
  outline: 'none',
};
const saveBtnStyle = {
  backgroundColor: '#2563EB',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
const cancelBtnStyle = {
  backgroundColor: '#F1F5F9',
  color: '#475569',
  border: 'none',
  borderRadius: 8,
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
const closeBtnStyle = {
  background: 'none',
  border: 'none',
  fontSize: 20,
  color: '#94A3B8',
  cursor: 'pointer',
  padding: 4,
  lineHeight: 1,
};

export default TaskModal;
