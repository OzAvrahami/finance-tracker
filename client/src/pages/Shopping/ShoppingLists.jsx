import React, { useState, useEffect } from 'react';
import { Plus, X, ShoppingCart, Trash2 } from 'lucide-react';
import { getShoppingLists, getShoppingListTypes, createShoppingList, deleteShoppingList } from '../../services/api';
import ShoppingListDetail from './ShoppingListDetail';

const STATUS_CONFIG = {
  draft:       { bg: 'var(--surface-3)',  text: 'var(--ink-4)',   label: 'טיוטה' },
  active:      { bg: 'var(--info-soft)',  text: 'var(--info)',    label: 'פעילה' },
  checked_out: { bg: 'var(--pos-soft)',   text: 'var(--pos)',     label: 'שולמה' },
  archived:    { bg: 'var(--surface-3)',  text: 'var(--ink-4)',   label: 'ארכיון' },
};

const ShoppingLists = () => {
  const [lists, setLists] = useState([]);
  const [listTypes, setListTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedListId, setSelectedListId] = useState(null);

  const fetchLists = async () => {
    try {
      const res = await getShoppingLists();
      setLists(res.data);
    } catch (error) {
      console.error('Error fetching shopping lists:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const [listsRes, typesRes] = await Promise.all([
          getShoppingLists(),
          getShoppingListTypes(),
        ]);
        setLists(listsRes.data);
        setListTypes(typesRes.data);
      } catch (error) {
        console.error('Error loading shopping data:', error);
        setError('שגיאה בטעינת הרשימות. נסה לרענן את הדף.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleCreate = async (title, listTypeId) => {
    try {
      await createShoppingList({ title, list_type_id: listTypeId });
      setShowCreateModal(false);
      fetchLists();
    } catch (error) {
      console.error('Error creating list:', error);
      alert('שגיאה ביצירת רשימה');
    }
  };

  const handleDelete = async (e, listId) => {
    e.stopPropagation();
    if (!window.confirm('האם למחוק את הרשימה?')) return;
    try {
      await deleteShoppingList(listId);
      fetchLists();
    } catch (error) {
      console.error('Error deleting list:', error);
      alert('שגיאה במחיקת הרשימה');
    }
  };

  const filteredLists = statusFilter === 'all'
    ? lists
    : lists.filter(l => l.status === statusFilter);

  // Detail view
  if (selectedListId) {
    return (
      <ShoppingListDetail
        listId={selectedListId}
        onBack={() => { setSelectedListId(null); fetchLists(); }}
      />
    );
  }

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--ink-4)' }}>טוען רשימות...</div>;
  }

  return (
    <div dir="rtl">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <p style={{ color: 'var(--ink-4)', marginTop: 4, fontSize: 14 }}>ניהול רשימות הקנייה שלך</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} style={addBtnStyle}>
          <Plus size={20} /> רשימה חדשה
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ backgroundColor: 'var(--neg-soft)', border: '1px solid var(--neg)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: 'var(--neg)', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'הכל' },
          { key: 'draft', label: 'טיוטה' },
          { key: 'active', label: 'פעילה' },
          { key: 'checked_out', label: 'שולמה' },
          { key: 'archived', label: 'ארכיון' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            style={{
              padding: '8px 16px',
              borderRadius: 9999,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              transition: 'all 0.2s',
              backgroundColor: statusFilter === f.key ? 'var(--primary)' : 'var(--surface-3)',
              color: statusFilter === f.key ? 'var(--primary-ink)' : 'var(--ink-3)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Cards grid */}
      {filteredLists.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {filteredLists.map(list => {
            const status = STATUS_CONFIG[list.status] || STATUS_CONFIG.draft;
            const typeName = list.shopping_list_types?.name || '';
            const pct = list.item_count > 0 ? Math.round((list.purchased_count / list.item_count) * 100) : 0;

            return (
              <div
                key={list.id}
                onClick={() => setSelectedListId(list.id)}
                style={{ ...cardStyle, cursor: 'pointer', transition: 'box-shadow 0.2s', position: 'relative' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
              >
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* #9B82FF = --primary-hi (Lucide color prop requires hex) */}
                    <ShoppingCart size={20} color="#9B82FF" />
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink-1)' }}>{list.title}</h3>
                  </div>
                  {(list.status === 'draft' || list.status === 'active') && (
                    <button onClick={(e) => handleDelete(e, list.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 4 }}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                {/* Badges */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {typeName && (
                    <span style={{ ...badgeStyle, backgroundColor: 'var(--surface-3)', color: 'var(--ink-3)' }}>{typeName}</span>
                  )}
                  <span style={{ ...badgeStyle, backgroundColor: status.bg, color: status.text }}>{status.label}</span>
                </div>

                {/* Progress */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ink-3)', marginBottom: 6 }}>
                    <span>{list.purchased_count}/{list.item_count} פריטים</span>
                    <span>{pct}%</span>
                  </div>
                  <div style={{ height: 8, backgroundColor: 'var(--surface-3)', borderRadius: 9999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', backgroundColor: pct === 100 ? 'var(--pos)' : 'var(--primary-hi)', width: `${pct}%`, borderRadius: 9999, transition: 'width 0.3s' }} />
                  </div>
                </div>

                {/* Date */}
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>
                  עודכן: {new Date(list.updated_at).toLocaleDateString('he-IL')}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink-4)', border: '2px dashed var(--border)', borderRadius: 12 }}>
          <ShoppingCart size={40} style={{ marginBottom: 12 }} />
          <p>אין רשימות {statusFilter !== 'all' ? `בסטטוס "${STATUS_CONFIG[statusFilter]?.label}"` : 'עדיין'}.</p>
          <p>לחץ על "רשימה חדשה" כדי להתחיל.</p>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateListModal
          listTypes={listTypes}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
};

// --- Create Modal ---
const CreateListModal = ({ listTypes, onClose, onCreate }) => {
  const [title, setTitle] = useState('');
  const [listTypeId, setListTypeId] = useState(listTypes[0]?.id || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return alert('נא להזין שם לרשימה');
    if (!listTypeId) return alert('נא לבחור סוג רשימה');
    onCreate(title, listTypeId);
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: 'var(--ink-1)' }}>רשימה חדשה</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)' }}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>שם הרשימה</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="למשל: קניות שבועיות"
              autoFocus
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>סוג רשימה</label>
            <select value={listTypeId} onChange={e => setListTypeId(e.target.value)} style={inputStyle}>
              {listTypes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" style={{
            width: '100%', padding: 14, background: 'var(--primary-grad)', color: 'var(--primary-ink)',
            border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: 'pointer',
          }}>
            צור רשימה
          </button>
        </form>
      </div>
    </div>
  );
};

// --- Styles ---
const cardStyle = {
  backgroundColor: 'var(--surface-2)', padding: 20, borderRadius: 16,
  boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)',
};
const badgeStyle = {
  display: 'inline-flex', alignItems: 'center', padding: '2px 10px',
  borderRadius: 9999, fontSize: 12, fontWeight: 500,
};
const addBtnStyle = {
  background: 'var(--primary-grad)', color: 'var(--primary-ink)', border: 'none', padding: '12px 24px',
  borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
  fontWeight: 600, fontSize: '1rem',
};
const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999, backdropFilter: 'blur(4px)',
};
const modalStyle = {
  backgroundColor: 'var(--surface-elev)', padding: 30, borderRadius: 16, width: 450, maxWidth: '90%',
  boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-strong)', textAlign: 'right',
};
const labelStyle = { display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 };
const inputStyle = {
  width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 16, boxSizing: 'border-box', backgroundColor: 'var(--surface-3)', color: 'var(--ink-1)',
};

export default ShoppingLists;
