import React, { useState, useEffect } from 'react';
import { Plus, Edit2, X, List, Grid, Link2 } from 'lucide-react';
import {
  getAdminShoppingListTypes,
  createAdminShoppingListType,
  updateAdminShoppingListType,
  deleteAdminShoppingListType,
  getAdminShoppingCatalogCategories,
  createAdminShoppingCatalogCategory,
  updateAdminShoppingCatalogCategory,
  deleteAdminShoppingCatalogCategory,
  getAdminListTypeCategoryLinks,
  setAdminListTypeCategoryLinks,
} from '../../services/api';

// ============================================================
// List Types Section
// ============================================================

const ListTypesSection = () => {
  const [listTypes, setListTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  const fetchListTypes = async () => {
    try {
      setError(null);
      const res = await getAdminShoppingListTypes();
      setListTypes(res.data);
    } catch {
      setError('שגיאה בטעינת סוגי הרשימות. נסה לרענן את הדף.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchListTypes(); }, []);

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormSlug('');
    setFormIsActive(true);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setFormName(item.name);
    setFormSlug(item.slug);
    setFormIsActive(item.is_active);
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) { setFormError('נא להזין שם'); return; }
    if (!formSlug.trim()) { setFormError('נא להזין slug'); return; }
    if (!/^[a-z0-9-]+$/.test(formSlug.trim())) {
      setFormError('slug חייב להכיל אותיות לועזיות קטנות, ספרות ומקפים בלבד');
      return;
    }

    const payload = { name: formName.trim(), slug: formSlug.trim() };
    if (editing) payload.is_active = formIsActive;

    setFormLoading(true);
    setFormError(null);
    try {
      if (editing) {
        await updateAdminShoppingListType(editing.id, payload);
      } else {
        await createAdminShoppingListType(payload);
      }
      closeModal();
      fetchListTypes();
    } catch (err) {
      setFormError(err.response?.data?.error || 'שגיאה בשמירה');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivate = async (item) => {
    if (!window.confirm(
      `להשבית את "${item.name}"?\n\nסוג זה לא יופיע ברשימות חדשות. רשימות קיימות לא יושפעו.`
    )) return;
    try {
      await deleteAdminShoppingListType(item.id);
      fetchListTypes();
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה בהשבתת הסוג');
    }
  };

  const handleReactivate = async (item) => {
    try {
      await updateAdminShoppingListType(item.id, { is_active: true });
      fetchListTypes();
    } catch {
      alert('שגיאה בהפעלת הסוג מחדש');
    }
  };

  const activeCount   = listTypes.filter(t => t.is_active).length;
  const inactiveCount = listTypes.filter(t => !t.is_active).length;
  const displayed     = showInactive ? listTypes : listTypes.filter(t => t.is_active);

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink-4)' }}>טוען...</div>;

  return (
    <>
      {error && <div style={errorBannerStyle}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, color: 'var(--ink-4)' }}>
            {activeCount} פעילים
            {inactiveCount > 0 && ` · ${inactiveCount} מושבתים`}
          </span>
          {inactiveCount > 0 && (
            <button
              onClick={() => setShowInactive(v => !v)}
              style={{
                ...ghostBtnStyle,
                backgroundColor: showInactive ? 'var(--primary-soft)' : 'var(--surface-3)',
                color: showInactive ? 'var(--primary-hi)' : 'var(--ink-4)',
                borderColor: showInactive ? 'var(--primary-hi)' : 'var(--border)',
              }}
            >
              {showInactive ? 'הסתר מושבתים' : 'הצג מושבתים'}
            </button>
          )}
        </div>
        <button onClick={openCreate} style={addBtnStyle}>
          <Plus size={18} /> סוג חדש
        </button>
      </div>

      {displayed.length === 0 ? (
        <div style={emptyStyle}>
          <List size={36} style={{ marginBottom: 10 }} />
          <p style={{ margin: '0 0 6px' }}>
            {listTypes.length === 0 ? 'אין סוגי רשימות עדיין.' : 'אין סוגי רשימות פעילים.'}
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>לחץ על "סוג חדש" כדי להוסיף.</p>
        </div>
      ) : (
        <div style={listCardStyle}>
          {displayed.map((item, idx) => (
            <div
              key={item.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '13px 16px',
                borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                opacity: item.is_active ? 1 : 0.55,
                transition: 'opacity 0.2s',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink-1)' }}>{item.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2, direction: 'ltr', textAlign: 'right' }}>
                  {item.slug}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {!item.is_active && (
                  <span style={{ ...badgeStyle, background: 'var(--surface-3)', color: 'var(--ink-4)' }}>
                    מושבת
                  </span>
                )}
                <button onClick={() => openEdit(item)} style={iconBtnStyle} title="עריכה">
                  <Edit2 size={14} />
                </button>
                {item.is_active ? (
                  <button
                    onClick={() => handleDeactivate(item)}
                    style={{ ...iconBtnStyle, color: 'var(--neg)' }}
                    title="השבת"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => handleReactivate(item)}
                    style={{ ...iconBtnStyle, color: 'var(--pos)', fontSize: 16 }}
                    title="הפעל מחדש"
                  >
                    ✓
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--ink-1)' }}>
                {editing ? 'עריכת סוג רשימה' : 'סוג רשימה חדש'}
              </h2>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {formError && <div style={errorBannerStyle}>{formError}</div>}

            <div style={fieldStyle}>
              <label style={labelStyle}>שם *</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="למשל: סופר, בית, לגן..."
                style={inputStyle}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Slug *</label>
              <input
                type="text"
                value={formSlug}
                onChange={e => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="super, home, gan..."
                style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }}
              />
              <p style={hintStyle}>אותיות לועזיות קטנות, ספרות ומקפים בלבד. חייב להיות ייחודי.</p>
            </div>

            {editing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                <input
                  type="checkbox"
                  id="ltIsActive"
                  checked={formIsActive}
                  onChange={e => setFormIsActive(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                <label htmlFor="ltIsActive" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>
                  פעיל
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={cancelBtnStyle}>ביטול</button>
              <button onClick={handleSave} disabled={formLoading} style={{ ...saveBtnStyle, opacity: formLoading ? 0.7 : 1 }}>
                {formLoading ? 'שומר...' : 'שמור'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ============================================================
// Catalog Categories Section
// ============================================================

const CatalogCategoriesSection = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formName, setFormName] = useState('');
  const [formIcon, setFormIcon] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  const fetchCategories = async () => {
    try {
      setError(null);
      const res = await getAdminShoppingCatalogCategories();
      setCategories(res.data);
    } catch {
      setError('שגיאה בטעינת הקטגוריות. נסה לרענן את הדף.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCategories(); }, []);

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormIcon('');
    setFormIsActive(true);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setFormName(item.name);
    setFormIcon(item.icon || '');
    setFormIsActive(item.is_active);
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) { setFormError('נא להזין שם קטגוריה'); return; }

    const payload = { name: formName.trim(), icon: formIcon.trim() || null };
    if (editing) payload.is_active = formIsActive;

    setFormLoading(true);
    setFormError(null);
    try {
      if (editing) {
        await updateAdminShoppingCatalogCategory(editing.id, payload);
      } else {
        await createAdminShoppingCatalogCategory(payload);
      }
      closeModal();
      fetchCategories();
    } catch (err) {
      setFormError(err.response?.data?.error || 'שגיאה בשמירה');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivate = async (item) => {
    if (!window.confirm(
      `להשבית את "${item.name}"?\n\nהיא לא תופיע בפריטים חדשים. פריטים קיימים לא יושפעו.`
    )) return;
    try {
      await deleteAdminShoppingCatalogCategory(item.id);
      fetchCategories();
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה בהשבתת הקטגוריה');
    }
  };

  const handleReactivate = async (item) => {
    try {
      await updateAdminShoppingCatalogCategory(item.id, { is_active: true });
      fetchCategories();
    } catch {
      alert('שגיאה בהפעלת הקטגוריה מחדש');
    }
  };

  const activeCount   = categories.filter(c => c.is_active).length;
  const inactiveCount = categories.filter(c => !c.is_active).length;
  const displayed     = showInactive ? categories : categories.filter(c => c.is_active);

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink-4)' }}>טוען...</div>;

  return (
    <>
      {error && <div style={errorBannerStyle}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, color: 'var(--ink-4)' }}>
            {activeCount} פעילות
            {inactiveCount > 0 && ` · ${inactiveCount} מושבתות`}
          </span>
          {inactiveCount > 0 && (
            <button
              onClick={() => setShowInactive(v => !v)}
              style={{
                ...ghostBtnStyle,
                backgroundColor: showInactive ? 'var(--primary-soft)' : 'var(--surface-3)',
                color: showInactive ? 'var(--primary-hi)' : 'var(--ink-4)',
                borderColor: showInactive ? 'var(--primary-hi)' : 'var(--border)',
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

      {displayed.length === 0 ? (
        <div style={emptyStyle}>
          <Grid size={36} style={{ marginBottom: 10 }} />
          <p style={{ margin: '0 0 6px' }}>
            {categories.length === 0 ? 'אין קטגוריות קטלוג עדיין.' : 'אין קטגוריות פעילות.'}
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>לחץ על "קטגוריה חדשה" כדי להוסיף.</p>
        </div>
      ) : (
        <div style={listCardStyle}>
          {displayed.map((item, idx) => (
            <div
              key={item.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '13px 16px',
                borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                opacity: item.is_active ? 1 : 0.55,
                transition: 'opacity 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 22, width: 32, textAlign: 'center', flexShrink: 0, lineHeight: 1 }}>
                  {item.icon || '🛒'}
                </span>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink-1)' }}>{item.name}</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {!item.is_active && (
                  <span style={{ ...badgeStyle, background: 'var(--surface-3)', color: 'var(--ink-4)' }}>
                    מושבתת
                  </span>
                )}
                <button onClick={() => openEdit(item)} style={iconBtnStyle} title="עריכה">
                  <Edit2 size={14} />
                </button>
                {item.is_active ? (
                  <button
                    onClick={() => handleDeactivate(item)}
                    style={{ ...iconBtnStyle, color: 'var(--neg)' }}
                    title="השבת"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => handleReactivate(item)}
                    style={{ ...iconBtnStyle, color: 'var(--pos)', fontSize: 16 }}
                    title="הפעל מחדש"
                  >
                    ✓
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--ink-1)' }}>
                {editing ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}
              </h2>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {formError && <div style={errorBannerStyle}>{formError}</div>}

            <div style={fieldStyle}>
              <label style={labelStyle}>שם הקטגוריה *</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="למשל: ירקות ופירות, מוצרי חלב..."
                style={inputStyle}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>אייקון (אמוג׳י)</label>
              <input
                type="text"
                value={formIcon}
                onChange={e => setFormIcon(e.target.value)}
                placeholder="🛒"
                style={{ ...inputStyle, fontSize: 20 }}
              />
            </div>

            {editing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                <input
                  type="checkbox"
                  id="ccIsActive"
                  checked={formIsActive}
                  onChange={e => setFormIsActive(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                <label htmlFor="ccIsActive" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>
                  קטגוריה פעילה
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={closeModal} style={cancelBtnStyle}>ביטול</button>
              <button onClick={handleSave} disabled={formLoading} style={{ ...saveBtnStyle, opacity: formLoading ? 0.7 : 1 }}>
                {formLoading ? 'שומר...' : 'שמור'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ============================================================
// Mapping Section
// ============================================================

const MappingSection = () => {
  const [listTypes, setListTypes] = useState([]);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [categoriesWithLinks, setCategoriesWithLinks] = useState([]);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [linksLoading, setLinksLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getAdminShoppingListTypes();
        const active = res.data.filter(t => t.is_active);
        setListTypes(active);
        if (active.length > 0) setSelectedTypeId(String(active[0].id));
      } catch {
        // silent — empty state handles this
      } finally {
        setLoadingTypes(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedTypeId) return;
    const loadLinks = async () => {
      setLinksLoading(true);
      try {
        const res = await getAdminListTypeCategoryLinks(selectedTypeId);
        setCategoriesWithLinks(res.data);
        setCheckedIds(new Set(res.data.filter(c => c.linked).map(c => c.id)));
      } catch {
        alert('שגיאה בטעינת הקישורים');
      } finally {
        setLinksLoading(false);
      }
    };
    loadLinks();
  }, [selectedTypeId]);

  const toggleCategory = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setAdminListTypeCategoryLinks(selectedTypeId, { categoryIds: Array.from(checkedIds) });
      alert('הקישורים עודכנו בהצלחה');
    } catch (err) {
      alert(err.response?.data?.error || 'שגיאה בשמירת הקישורים');
    } finally {
      setSaving(false);
    }
  };

  if (loadingTypes) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink-4)' }}>טוען...</div>;

  if (listTypes.length === 0) {
    return (
      <div style={emptyStyle}>
        <Link2 size={36} style={{ marginBottom: 10 }} />
        <p style={{ margin: 0 }}>
          אין סוגי רשימות פעילים. הוסף סוג קודם בלשונית "סוגי רשימות".
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>סוג רשימה</label>
        <select
          value={selectedTypeId}
          onChange={e => setSelectedTypeId(e.target.value)}
          style={{ ...inputStyle, maxWidth: 280 }}
        >
          {listTypes.map(t => (
            <option key={t.id} value={String(t.id)}>{t.name}</option>
          ))}
        </select>
      </div>

      {linksLoading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink-4)' }}>טוען קטגוריות...</div>
      ) : (
        <>
          {categoriesWithLinks.length === 0 ? (
            <div style={emptyStyle}>
              <p style={{ margin: 0 }}>
                אין קטגוריות קטלוג. הוסף קטגוריות בלשונית "קטגוריות קטלוג".
              </p>
            </div>
          ) : (
            <div style={listCardStyle}>
              {categoriesWithLinks.map((cat, idx) => (
                <label
                  key={cat.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '13px 16px', cursor: 'pointer',
                    borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                    opacity: cat.is_active ? 1 : 0.55,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>
                      {cat.icon || '🛒'}
                    </span>
                    <span style={{ fontSize: 15, color: 'var(--ink-1)', fontWeight: 500 }}>
                      {cat.name}
                    </span>
                    {!cat.is_active && (
                      <span style={{ ...badgeStyle, background: 'var(--surface-3)', color: 'var(--ink-4)', fontSize: 11 }}>
                        מושבתת
                      </span>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={checkedIds.has(cat.id)}
                    onChange={() => toggleCategory(cat.id)}
                    style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}
                  />
                </label>
              ))}
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ ...saveBtnStyle, opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'שומר...' : `שמור שינויים (${checkedIds.size} קטגוריות)`}
            </button>
          </div>
        </>
      )}
    </>
  );
};

// ============================================================
// Main Tab
// ============================================================

const SECTIONS = [
  { key: 'list-types',  label: 'סוגי רשימות' },
  { key: 'categories',  label: 'קטגוריות קטלוג' },
  { key: 'mapping',     label: 'קישורים' },
];

const ShoppingSettingsTab = () => {
  const [activeSection, setActiveSection] = useState('list-types');

  return (
    <>
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        borderBottom: '1px solid var(--border)',
      }}>
        {SECTIONS.map(s => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: activeSection === s.key ? 700 : 500,
              color: activeSection === s.key ? 'var(--primary-hi)' : 'var(--ink-4)',
              borderBottom: `2px solid ${activeSection === s.key ? 'var(--primary-hi)' : 'transparent'}`,
              marginBottom: -1,
              whiteSpace: 'nowrap',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === 'list-types'  && <ListTypesSection />}
      {activeSection === 'categories'  && <CatalogCategoriesSection />}
      {activeSection === 'mapping'     && <MappingSection />}
    </>
  );
};

export default ShoppingSettingsTab;

// --- Shared Styles ---
const errorBannerStyle = {
  background: 'var(--neg-soft)', border: '1px solid var(--neg)',
  borderRadius: 8, padding: '10px 14px', marginBottom: 16,
  color: 'var(--neg)', fontSize: 13,
};
const listCardStyle = {
  background: 'var(--surface-2)', borderRadius: 16,
  border: '1px solid var(--border)', overflow: 'hidden',
};
const emptyStyle = {
  textAlign: 'center', padding: 48, color: 'var(--ink-4)',
  border: '2px dashed var(--border)', borderRadius: 12,
};
const badgeStyle = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 10px', borderRadius: 9999,
  fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
};
const addBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: 'var(--primary-grad)', color: 'var(--primary-ink)',
  border: 'none', borderRadius: 8, padding: '10px 20px',
  cursor: 'pointer', fontWeight: 600, fontSize: 14,
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
  border: 'none', background: 'var(--surface-3)',
  cursor: 'pointer', color: 'var(--ink-4)',
};
const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999,
};
const modalStyle = {
  backgroundColor: 'var(--surface-elev)', padding: 28, borderRadius: 16,
  width: 480, maxWidth: '90%',
  boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-strong)',
  textAlign: 'right',
};
const fieldStyle  = { marginBottom: 14 };
const labelStyle  = { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 };
const hintStyle   = { fontSize: 12, color: 'var(--ink-4)', margin: '4px 0 0' };
const inputStyle  = {
  width: '100%', padding: '9px 12px',
  border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 14, boxSizing: 'border-box',
  backgroundColor: 'var(--surface-3)', color: 'var(--ink-1)',
};
const cancelBtnStyle = {
  padding: '10px 20px', border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--surface-3)', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 14,
};
const saveBtnStyle = {
  padding: '10px 24px', border: 'none', borderRadius: 8,
  background: 'var(--primary-grad)', color: 'var(--primary-ink)',
  cursor: 'pointer', fontWeight: 600, fontSize: 14,
};
