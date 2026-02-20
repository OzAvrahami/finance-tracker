import React, { useState, useEffect, useMemo } from 'react';
import { ChevronRight, Plus, X, Check, Trash2, ShoppingBag, Package } from 'lucide-react';
import {
  getShoppingListById, updateShoppingList,
  getShoppingCatalogCategories, getShoppingCatalogItems,
  addShoppingListItem, removeShoppingListItem, toggleShoppingItemPurchased,
  checkoutShoppingList, getPaymentSources, getCategories,
} from '../services/api';

const STATUS_CONFIG = {
  draft:       { bg: '#F1F5F9', text: '#64748B', label: 'טיוטה' },
  active:      { bg: '#EFF6FF', text: '#2563EB', label: 'פעילה' },
  checked_out: { bg: '#ECFDF5', text: '#059669', label: 'שולמה' },
  archived:    { bg: '#F8FAFC', text: '#94A3B8', label: 'ארכיון' },
};

const ShoppingListDetail = ({ listId, onBack }) => {
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [catalogCategories, setCatalogCategories] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [isCustomItem, setIsCustomItem] = useState(false);

  // Add item form state
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState('');
  const [customName, setCustomName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');

  // Checkout state
  const [paymentSources, setPaymentSources] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [checkoutPaymentSourceId, setCheckoutPaymentSourceId] = useState('');
  const [checkoutCategoryId, setCheckoutCategoryId] = useState('');

  const fetchList = async () => {
    try {
      const res = await getShoppingListById(listId);
      setList(res.data);
    } catch (error) {
      console.error('Error fetching list:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [listId]);

  // Load catalog categories when list is loaded
  useEffect(() => {
    if (list?.list_type_id) {
      getShoppingCatalogCategories(list.list_type_id)
        .then(res => setCatalogCategories(res.data))
        .catch(console.error);
    }
  }, [list?.list_type_id]);

  // Load catalog items when category changes
  useEffect(() => {
    if (selectedCategoryId) {
      getShoppingCatalogItems({ category_id: selectedCategoryId })
        .then(res => setCatalogItems(res.data))
        .catch(console.error);
    } else {
      setCatalogItems([]);
    }
  }, [selectedCategoryId]);

  // Auto-fill from catalog item
  useEffect(() => {
    if (selectedCatalogItemId) {
      const item = catalogItems.find(i => String(i.id) === String(selectedCatalogItemId));
      if (item) {
        if (item.default_unit) setUnit(item.default_unit);
        if (item.default_price) setPrice(item.default_price);
      }
    }
  }, [selectedCatalogItemId, catalogItems]);

  // Stats
  const stats = useMemo(() => {
    if (!list?.shopping_list_items) return { total: 0, purchased: 0, estimatedCost: 0, purchasedCost: 0 };
    const items = list.shopping_list_items;
    const total = items.length;
    const purchased = items.filter(i => i.is_purchased).length;
    const estimatedCost = items.reduce((s, i) => s + ((Number(i.quantity) || 1) * (Number(i.price) || 0)), 0);
    const purchasedCost = items.filter(i => i.is_purchased).reduce((s, i) => s + ((Number(i.quantity) || 1) * (Number(i.price) || 0)), 0);
    return { total, purchased, estimatedCost, purchasedCost };
  }, [list]);

  // Group items by category
  const groupedItems = useMemo(() => {
    if (!list?.shopping_list_items) return {};
    const groups = {};
    const sorted = [...list.shopping_list_items].sort((a, b) => {
      if (a.is_purchased !== b.is_purchased) return a.is_purchased ? 1 : -1;
      return (a.shopping_catalog_categories?.name || '').localeCompare(b.shopping_catalog_categories?.name || '', 'he');
    });
    sorted.forEach(item => {
      const catName = item.shopping_catalog_categories?.name || 'כללי';
      const catIcon = item.shopping_catalog_categories?.icon || '';
      const key = catName;
      if (!groups[key]) groups[key] = { name: catName, icon: catIcon, items: [] };
      groups[key].items.push(item);
    });
    return groups;
  }, [list]);

  const handleAddItem = async () => {
    if (!isCustomItem && !selectedCatalogItemId) return alert('נא לבחור פריט מהקטלוג');
    if (isCustomItem && !customName.trim()) return alert('נא להזין שם פריט');
    if (!selectedCategoryId) return alert('נא לבחור קטגוריה');

    try {
      await addShoppingListItem(listId, {
        catalog_item_id: isCustomItem ? null : selectedCatalogItemId,
        custom_name: isCustomItem ? customName : null,
        category_id: selectedCategoryId,
        quantity: quantity || 1,
        unit: unit || null,
        price: price || null,
        notes: notes || null,
      });
      // Reset form
      setSelectedCatalogItemId('');
      setCustomName('');
      setQuantity(1);
      setUnit('');
      setPrice('');
      setNotes('');
      fetchList();
    } catch (error) {
      console.error('Error adding item:', error);
      alert('שגיאה בהוספת פריט');
    }
  };

  const handleToggle = async (itemId) => {
    try {
      await toggleShoppingItemPurchased(listId, itemId);
      fetchList();
    } catch (error) {
      console.error('Error toggling item:', error);
    }
  };

  const handleRemoveItem = async (itemId) => {
    try {
      await removeShoppingListItem(listId, itemId);
      fetchList();
    } catch (error) {
      console.error('Error removing item:', error);
    }
  };

  const handleActivate = async () => {
    try {
      await updateShoppingList(listId, { status: 'active' });
      fetchList();
    } catch (error) {
      console.error('Error activating list:', error);
    }
  };

  const openCheckout = async () => {
    try {
      const [psRes, catRes] = await Promise.all([getPaymentSources(), getCategories()]);
      setPaymentSources(psRes.data);
      setExpenseCategories(catRes.data);
      if (psRes.data.length > 0) setCheckoutPaymentSourceId(psRes.data[0].id);
      setShowCheckout(true);
    } catch (error) {
      console.error('Error loading checkout data:', error);
    }
  };

  const handleCheckout = async () => {
    if (!window.confirm(`לסיים את הרשימה ולייצר תנועה בסך ₪${stats.purchasedCost.toLocaleString()}?`)) return;
    try {
      await checkoutShoppingList(listId, {
        payment_source_id: checkoutPaymentSourceId || null,
        category_id: checkoutCategoryId || null,
      });
      alert('הרשימה נסגרה ותנועה חדשה נוצרה בהצלחה!');
      setShowCheckout(false);
      fetchList();
    } catch (error) {
      console.error('Error checking out:', error);
      alert('שגיאה בסגירת הרשימה');
    }
  };

  if (loading) return <div style={{ textAlign: 'center', marginTop: 80, color: '#64748B' }}>טוען רשימה...</div>;
  if (!list) return <div style={{ textAlign: 'center', marginTop: 80, color: '#E11D48' }}>רשימה לא נמצאה</div>;

  const status = STATUS_CONFIG[list.status] || STATUS_CONFIG.draft;
  const isEditable = list.status === 'draft' || list.status === 'active';

  return (
    <div dir="rtl">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }}>
            <ChevronRight size={24} />
          </button>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1E293B' }}>{list.title}</h2>
          <span style={{ ...badgeStyle, backgroundColor: status.bg, color: status.text }}>{status.label}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {list.status === 'draft' && (
            <button onClick={handleActivate} style={{ ...actionBtnStyle, backgroundColor: '#2563EB', color: 'white' }}>
              הפעל רשימה
            </button>
          )}
          {list.status === 'active' && (
            <button onClick={openCheckout} style={{ ...actionBtnStyle, backgroundColor: '#059669', color: 'white' }}>
              <Check size={16} /> סיום וחיוב
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={statCardStyle}>
          <div style={{ fontSize: 13, color: '#64748B', marginBottom: 4 }}>פריטים</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1E293B' }}>{stats.purchased}/{stats.total}</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: 13, color: '#64748B', marginBottom: 4 }}>עלות משוערת</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1E293B' }} dir="ltr">₪{stats.estimatedCost.toLocaleString()}</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ fontSize: 13, color: '#64748B', marginBottom: 4 }}>נקנה בפועל</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#059669' }} dir="ltr">₪{stats.purchasedCost.toLocaleString()}</div>
        </div>
      </div>

      {/* Add Item Section */}
      {isEditable && (
        <div style={{ marginBottom: 24 }}>
          {!showAddForm ? (
            <button onClick={() => setShowAddForm(true)} style={{ ...actionBtnStyle, backgroundColor: '#EFF6FF', color: '#2563EB', width: '100%', justifyContent: 'center' }}>
              <Plus size={18} /> הוסף פריט
            </button>
          ) : (
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1E293B' }}>הוספת פריט</h3>
                <button onClick={() => setShowAddForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                  <X size={18} />
                </button>
              </div>

              {/* Toggle catalog/custom */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button
                  onClick={() => setIsCustomItem(false)}
                  style={{ ...pillStyle, backgroundColor: !isCustomItem ? '#2563EB' : '#F1F5F9', color: !isCustomItem ? 'white' : '#475569' }}
                >
                  <Package size={14} /> מהקטלוג
                </button>
                <button
                  onClick={() => setIsCustomItem(true)}
                  style={{ ...pillStyle, backgroundColor: isCustomItem ? '#2563EB' : '#F1F5F9', color: isCustomItem ? 'white' : '#475569' }}
                >
                  פריט מותאם
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Category */}
                <div>
                  <label style={formLabelStyle}>קטגוריה</label>
                  <select value={selectedCategoryId} onChange={e => setSelectedCategoryId(e.target.value)} style={formInputStyle}>
                    <option value="">בחר קטגוריה...</option>
                    {catalogCategories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Item selection */}
                {!isCustomItem ? (
                  <div>
                    <label style={formLabelStyle}>פריט</label>
                    <select value={selectedCatalogItemId} onChange={e => setSelectedCatalogItemId(e.target.value)} style={formInputStyle} disabled={!selectedCategoryId}>
                      <option value="">בחר פריט...</option>
                      {catalogItems.map(i => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label style={formLabelStyle}>שם הפריט</label>
                    <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="הזן שם..." style={formInputStyle} />
                  </div>
                )}

                {/* Quantity */}
                <div>
                  <label style={formLabelStyle}>כמות</label>
                  <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} style={formInputStyle} />
                </div>

                {/* Unit */}
                <div>
                  <label style={formLabelStyle}>יחידה</label>
                  <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="ק״ג / יח׳ / ליטר" style={formInputStyle} />
                </div>

                {/* Price */}
                <div>
                  <label style={formLabelStyle}>מחיר</label>
                  <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="₪" style={formInputStyle} />
                </div>

                {/* Notes */}
                <div>
                  <label style={formLabelStyle}>הערות</label>
                  <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="אופציונלי" style={formInputStyle} />
                </div>
              </div>

              <button onClick={handleAddItem} style={{ ...actionBtnStyle, backgroundColor: '#2563EB', color: 'white', marginTop: 16, width: '100%', justifyContent: 'center' }}>
                <Plus size={16} /> הוסף
              </button>
            </div>
          )}
        </div>
      )}

      {/* Items List */}
      {Object.keys(groupedItems).length > 0 ? (
        Object.values(groupedItems).map(group => (
          <div key={group.name} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>{group.icon} {group.name}</span>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>({group.items.length})</span>
            </div>
            <div style={cardStyle}>
              {group.items.map((item, idx) => {
                const itemName = item.shopping_catalog_items?.name || item.custom_name || 'פריט';
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 0',
                      borderTop: idx > 0 ? '1px solid #F1F5F9' : 'none',
                      backgroundColor: item.is_purchased ? '#F0FDF4' : 'transparent',
                      borderRadius: item.is_purchased ? 8 : 0,
                      paddingLeft: 8, paddingRight: 8,
                      margin: item.is_purchased ? '2px 0' : 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                      {isEditable && (
                        <button onClick={() => handleToggle(item.id)} style={{
                          width: 22, height: 22, borderRadius: 6,
                          border: item.is_purchased ? 'none' : '2px solid #CBD5E1',
                          backgroundColor: item.is_purchased ? '#059669' : 'white',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          {item.is_purchased && <Check size={14} color="white" />}
                        </button>
                      )}
                      <div style={{ flex: 1 }}>
                        <span style={{
                          fontWeight: 500, color: item.is_purchased ? '#94A3B8' : '#1E293B',
                          textDecoration: item.is_purchased ? 'line-through' : 'none',
                        }}>
                          {itemName}
                        </span>
                        {item.notes && (
                          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{item.notes}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <span style={{ fontSize: 13, color: '#64748B', whiteSpace: 'nowrap' }}>
                        {item.quantity || 1} {item.unit || 'יח׳'}
                      </span>
                      {item.price && (
                        <span style={{ fontSize: 13, fontWeight: 600, color: item.is_purchased ? '#94A3B8' : '#1E293B', whiteSpace: 'nowrap' }} dir="ltr">
                          ₪{Number(item.price).toLocaleString()}
                        </span>
                      )}
                      {isEditable && (
                        <button onClick={() => handleRemoveItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: 2 }}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      ) : (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', border: '2px dashed #E2E8F0', borderRadius: 12 }}>
          <ShoppingBag size={36} style={{ marginBottom: 8 }} />
          <p>הרשימה ריקה. הוסף פריטים כדי להתחיל.</p>
        </div>
      )}

      {/* Checkout Modal */}
      {showCheckout && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#1E293B' }}>סיום וחיוב</h2>
              <button onClick={() => setShowCheckout(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                <X size={20} />
              </button>
            </div>

            {/* Summary */}
            <div style={{ textAlign: 'center', padding: 16, backgroundColor: '#EFF6FF', borderRadius: 12, border: '1px solid #DBEAFE', marginBottom: 20 }}>
              <p style={{ fontSize: 14, color: '#1D4ED8', margin: '0 0 4px 0', fontWeight: 500 }}>סכום לחיוב (פריטים שנקנו)</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: '#1E293B', margin: 0 }} dir="ltr">₪{stats.purchasedCost.toLocaleString()}</p>
              <p style={{ fontSize: 12, color: '#64748B', margin: '4px 0 0 0' }}>{stats.purchased} פריטים מתוך {stats.total}</p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={formLabelStyle}>אמצעי תשלום</label>
              <select value={checkoutPaymentSourceId} onChange={e => setCheckoutPaymentSourceId(e.target.value)} style={formInputStyle}>
                <option value="">ללא</option>
                {paymentSources.map(ps => (
                  <option key={ps.id} value={ps.id}>{ps.name}{ps.last4 ? ` (${ps.last4})` : ''}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={formLabelStyle}>קטגוריית הוצאה</label>
              <select value={checkoutCategoryId} onChange={e => setCheckoutCategoryId(e.target.value)} style={formInputStyle}>
                <option value="">ללא קטגוריה</option>
                {expenseCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>

            <button onClick={handleCheckout} style={{
              width: '100%', padding: 14, backgroundColor: '#059669', color: 'white',
              border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: 'pointer',
            }}>
              סיים וצור תנועה
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Styles ---
const cardStyle = {
  backgroundColor: 'white', padding: 16, borderRadius: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #F1F5F9',
};
const statCardStyle = {
  backgroundColor: 'white', padding: 16, borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #F1F5F9',
  textAlign: 'center',
};
const badgeStyle = {
  display: 'inline-flex', alignItems: 'center', padding: '4px 12px',
  borderRadius: 9999, fontSize: 13, fontWeight: 500,
};
const actionBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
  border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14,
};
const pillStyle = {
  padding: '6px 14px', borderRadius: 9999, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
};
const formLabelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#475569', marginBottom: 4 };
const formInputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8,
  fontSize: 14, boxSizing: 'border-box',
};
const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999, backdropFilter: 'blur(4px)',
};
const modalStyle = {
  backgroundColor: 'white', padding: 30, borderRadius: 16, width: 450, maxWidth: '90%',
  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', textAlign: 'right',
};

export default ShoppingListDetail;
