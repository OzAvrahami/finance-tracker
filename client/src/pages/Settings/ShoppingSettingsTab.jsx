import { useCallback, useEffect, useMemo, useState } from 'react';
import { Grid2X2, Link2, ListChecks, Minus, Plus, ShoppingBasket } from 'lucide-react';
import {
  Alert,
  ConfirmDialog,
  Dialog,
  PrimaryButton,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TechnicalValue,
  TextField,
} from '../../components/ui';
import {
  createAdminShoppingCatalogCategory,
  createAdminShoppingListType,
  deleteAdminShoppingCatalogCategory,
  deleteAdminShoppingListType,
  getAdminListTypeCategoryLinks,
  getAdminShoppingCatalogCategories,
  getAdminShoppingListTypes,
  setAdminListTypeCategoryLinks,
  updateAdminShoppingCatalogCategory,
  updateAdminShoppingListType,
} from '../../services/api';
import {
  SettingsDialogFooter,
  SettingsEmpty,
  SettingsLoadError,
  SettingsRecord,
  SettingsSkeleton,
  SettingsStatusBadge,
  SettingsToolbar,
} from './SettingsComponents';

const ListTypesSection = () => {
  const [listTypes, setListTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', slug: '', isActive: true });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  const loadListTypes = useCallback(async () => {
    setLoadError(false);
    try {
      const response = await getAdminShoppingListTypes();
      setListTypes(Array.isArray(response.data) ? response.data : []);
      return true;
    } catch {
      setLoadError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadListTypes();
  }, [loadListTypes]);

  const counts = useMemo(() => ({
    active: listTypes.filter((item) => item.is_active).length,
    inactive: listTypes.filter((item) => !item.is_active).length,
  }), [listTypes]);
  const displayed = showInactive ? listTypes : listTypes.filter((item) => item.is_active);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', slug: '', isActive: true });
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({ name: item.name, slug: item.slug, isActive: item.is_active });
    setFormError('');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setEditing(null);
    setFormError('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('נא להזין שם לסוג הרשימה');
      return;
    }
    if (!form.slug.trim()) {
      setFormError('נא להזין מזהה טכני');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(form.slug.trim())) {
      setFormError('המזהה חייב להכיל אותיות לועזיות קטנות, ספרות ומקפים בלבד');
      return;
    }

    const payload = { name: form.name.trim(), slug: form.slug.trim() };
    if (editing) payload.is_active = form.isActive;

    setSaving(true);
    setFormError('');
    try {
      if (editing) await updateAdminShoppingListType(editing.id, payload);
      else await createAdminShoppingListType(payload);
      setDialogOpen(false);
      setEditing(null);
      await loadListTypes();
    } catch (error) {
      setFormError(error.response?.data?.error || 'שגיאה בשמירת סוג הרשימה');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    await deleteAdminShoppingListType(deactivateTarget.id);
    setDeactivateTarget(null);
    await loadListTypes();
  };

  const handleReactivate = async (item) => {
    setMutationError('');
    try {
      await updateAdminShoppingListType(item.id, { is_active: true });
      await loadListTypes();
    } catch (error) {
      setMutationError(error.response?.data?.error || 'הפעלת סוג הרשימה מחדש נכשלה.');
    }
  };

  if (loading) return <SettingsSkeleton label="טעינת סוגי רשימות" />;
  if (loadError) return <SettingsLoadError title="טעינת סוגי הרשימות נכשלה" onRetry={loadListTypes} />;

  return (
    <section className="settings-subsection" aria-label="סוגי רשימות">
      <SettingsToolbar
        title="סוגי רשימות"
        description="כל רשימה משויכת לסוג שקובע אילו קטגוריות קטלוג זמינות לה."
        activeCount={counts.active}
        inactiveCount={counts.inactive}
        activeLabel="פעילים"
        inactiveLabel="לא פעילים"
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive((value) => !value)}
        showInactiveLabel="הצגת לא פעילים"
        hideInactiveLabel="הסתרת לא פעילים"
        addLabel="סוג חדש"
        onAdd={openCreate}
      />
      {mutationError && <Alert variant="error" urgent>{mutationError}</Alert>}
      {displayed.length === 0 ? (
        <SettingsEmpty
          icon={ListChecks}
          title={listTypes.length === 0 ? 'לא הוגדרו סוגי רשימות' : 'אין סוגי רשימות פעילים'}
          description="סוג רשימה נדרש כדי ליצור רשימת קניות חדשה."
          actionLabel={listTypes.length === 0 ? 'יצירת סוג רשימה' : undefined}
          onAction={listTypes.length === 0 ? openCreate : undefined}
        />
      ) : (
        <div className="settings-records">
          {displayed.map((item) => (
            <SettingsRecord
              key={item.id}
              icon={<ListChecks size={18} />}
              title={item.name}
              active={item.is_active}
              metadata={<TechnicalValue>{item.slug}</TechnicalValue>}
              badges={<SettingsStatusBadge active={item.is_active} />}
              editLabel={`עריכת סוג הרשימה ${item.name}`}
              onEdit={() => openEdit(item)}
              onDeactivate={() => setDeactivateTarget(item)}
              onReactivate={() => handleReactivate(item)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? 'עריכת סוג רשימה' : 'סוג רשימה חדש'}
        size="sm"
        className="settings-dialog"
        closeDisabled={saving}
        footer={<SettingsDialogFooter onCancel={closeDialog} onSave={handleSave} loading={saving} />}
      >
        <div className="settings-dialog__form">
          {formError && <Alert variant="error" urgent>{formError}</Alert>}
          <TextField
            label="שם הסוג"
            value={form.name}
            onValueChange={(value) => setForm((current) => ({ ...current, name: value }))}
            placeholder="למשל: סופרמרקט"
            required
          />
          <TextField
            label="מזהה טכני (slug)"
            value={form.slug}
            onValueChange={(value) => setForm((current) => ({
              ...current,
              slug: value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
            }))}
            placeholder="supermarket"
            helperText="אותיות לטיניות קטנות, ספרות ומקפים בלבד."
            technicalLtr
            required
          />
          {editing && (
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              סוג רשימה פעיל
            </label>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
        title={deactivateTarget ? `השבתת „${deactivateTarget.name}”` : 'השבתת סוג רשימה'}
        message="סוג הרשימה לא יוצע לרשימות חדשות. אם רשימות קיימות עדיין תלויות בו, המערכת עשויה למנוע את ההשבתה."
        confirmLabel="השבתה"
        variant="warning"
        errorMessage="לא ניתן להשבית את סוג הרשימה. ייתכן שרשימות קיימות עדיין משויכות אליו."
      />
    </section>
  );
};

const CatalogCategoriesSection = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', icon: '', isActive: true });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  const loadCategories = useCallback(async () => {
    setLoadError(false);
    try {
      const response = await getAdminShoppingCatalogCategories();
      setCategories(Array.isArray(response.data) ? response.data : []);
      return true;
    } catch {
      setLoadError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const counts = useMemo(() => ({
    active: categories.filter((item) => item.is_active).length,
    inactive: categories.filter((item) => !item.is_active).length,
  }), [categories]);
  const displayed = showInactive ? categories : categories.filter((item) => item.is_active);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', icon: '', isActive: true });
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({ name: item.name, icon: item.icon || '', isActive: item.is_active });
    setFormError('');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setEditing(null);
    setFormError('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('נא להזין שם קטגוריה');
      return;
    }
    const payload = { name: form.name.trim(), icon: form.icon.trim() || null };
    if (editing) payload.is_active = form.isActive;

    setSaving(true);
    setFormError('');
    try {
      if (editing) await updateAdminShoppingCatalogCategory(editing.id, payload);
      else await createAdminShoppingCatalogCategory(payload);
      setDialogOpen(false);
      setEditing(null);
      await loadCategories();
    } catch (error) {
      setFormError(error.response?.data?.error || 'שגיאה בשמירת קטגוריית הקטלוג');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    await deleteAdminShoppingCatalogCategory(deactivateTarget.id);
    setDeactivateTarget(null);
    await loadCategories();
  };

  const handleReactivate = async (item) => {
    setMutationError('');
    try {
      await updateAdminShoppingCatalogCategory(item.id, { is_active: true });
      await loadCategories();
    } catch (error) {
      setMutationError(error.response?.data?.error || 'הפעלת קטגוריית הקטלוג מחדש נכשלה.');
    }
  };

  if (loading) return <SettingsSkeleton label="טעינת קטגוריות קטלוג" />;
  if (loadError) return <SettingsLoadError title="טעינת קטגוריות הקטלוג נכשלה" onRetry={loadCategories} />;

  return (
    <section className="settings-subsection" aria-label="קטגוריות קטלוג">
      <SettingsToolbar
        title="קטגוריות קטלוג"
        description="קטגוריות אלה מארגנות פריטי קנייה ואינן קטגוריות של תנועות כספיות."
        activeCount={counts.active}
        inactiveCount={counts.inactive}
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive((value) => !value)}
        addLabel="קטגוריה חדשה"
        onAdd={openCreate}
      />
      {mutationError && <Alert variant="error" urgent>{mutationError}</Alert>}
      {displayed.length === 0 ? (
        <SettingsEmpty
          icon={Grid2X2}
          title={categories.length === 0 ? 'לא הוגדרו קטגוריות קטלוג' : 'אין קטגוריות קטלוג פעילות'}
          description="קטגוריות קטלוג משמשות לארגון פריטים ברשימות קניות."
          actionLabel={categories.length === 0 ? 'יצירת קטגוריית קטלוג' : undefined}
          onAction={categories.length === 0 ? openCreate : undefined}
        />
      ) : (
        <div className="settings-records settings-records--grid">
          {displayed.map((item) => (
            <SettingsRecord
              key={item.id}
              icon={item.icon || '🛒'}
              title={item.name}
              active={item.is_active}
              badges={<SettingsStatusBadge active={item.is_active} feminine />}
              editLabel={`עריכת קטגוריית הקטלוג ${item.name}`}
              onEdit={() => openEdit(item)}
              onDeactivate={() => setDeactivateTarget(item)}
              onReactivate={() => handleReactivate(item)}
            />
          ))}
        </div>
      )}
      <div className="settings-note">
        השבתת קטגוריית קטלוג אינה מסירה אותה מפריטים ברשימות קיימות.
      </div>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? 'עריכת קטגוריית קטלוג' : 'קטגוריית קטלוג חדשה'}
        description="קטגוריה שמארגנת פריטי קנייה, לא קטגוריה של תנועות כספיות."
        size="sm"
        className="settings-dialog"
        closeDisabled={saving}
        footer={<SettingsDialogFooter onCancel={closeDialog} onSave={handleSave} loading={saving} />}
      >
        <div className="settings-dialog__form">
          {formError && <Alert variant="error" urgent>{formError}</Alert>}
          <div className="settings-category-name-grid">
            <TextField
              label="סמל"
              value={form.icon}
              onValueChange={(value) => setForm((current) => ({ ...current, icon: value }))}
              placeholder="🛒"
              inputClassName="settings-emoji-input"
              maxLength={8}
            />
            <TextField
              label="שם הקטגוריה"
              value={form.name}
              onValueChange={(value) => setForm((current) => ({ ...current, name: value }))}
              placeholder="למשל: ירקות ופירות"
              required
            />
          </div>
          {editing && (
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              קטגוריית קטלוג פעילה
            </label>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
        title={deactivateTarget ? `השבתת „${deactivateTarget.name}”` : 'השבתת קטגוריית קטלוג'}
        message="הקטגוריה לא תוצע לפריטים חדשים. פריטים קיימים יישארו משויכים אליה וניתן להפעיל אותה מחדש."
        confirmLabel="השבתה"
        variant="warning"
        errorMessage="השבתת קטגוריית הקטלוג נכשלה. הקטגוריה נשארה פעילה."
      />
    </section>
  );
};

const MappingSection = () => {
  const [listTypes, setListTypes] = useState([]);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [categories, setCategories] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [typesError, setTypesError] = useState(false);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState(null);

  const loadTypes = useCallback(async () => {
    setTypesError(false);
    try {
      const response = await getAdminShoppingListTypes();
      const active = (Array.isArray(response.data) ? response.data : []).filter((item) => item.is_active);
      setListTypes(active);
      setSelectedTypeId((current) => current || (active[0] ? String(active[0].id) : ''));
      return true;
    } catch {
      setTypesError(true);
      return false;
    } finally {
      setLoadingTypes(false);
    }
  }, []);

  useEffect(() => {
    loadTypes();
  }, [loadTypes]);

  const loadLinks = useCallback(async () => {
    if (!selectedTypeId) return false;
    setLinksLoading(true);
    setLinksError(false);
    setSaveState(null);
    try {
      const response = await getAdminListTypeCategoryLinks(selectedTypeId);
      const nextCategories = Array.isArray(response.data) ? response.data : [];
      setCategories(nextCategories);
      setSelectedIds(new Set(nextCategories.filter((category) => category.linked).map((category) => category.id)));
      return true;
    } catch {
      setLinksError(true);
      return false;
    } finally {
      setLinksLoading(false);
    }
  }, [selectedTypeId]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const availableCategories = categories.filter((category) => !selectedIds.has(category.id));
  const mappedCategories = categories.filter((category) => selectedIds.has(category.id));

  const toggleCategory = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSaveState(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveState(null);
    try {
      await setAdminListTypeCategoryLinks(selectedTypeId, { categoryIds: Array.from(selectedIds) });
      setSaveState({ variant: 'success', message: 'המיפוי נשמר.' });
    } catch (error) {
      setSaveState({
        variant: error.response?.status === 409 ? 'warning' : 'error',
        message: error.response?.data?.error || 'שמירת המיפוי נכשלה. הבחירה נשמרה במסך וניתן לנסות שוב.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loadingTypes) return <SettingsSkeleton label="טעינת מיפוי קטגוריות" />;
  if (typesError) return <SettingsLoadError title="טעינת סוגי הרשימות למיפוי נכשלה" onRetry={loadTypes} />;
  if (listTypes.length === 0) {
    return (
      <SettingsEmpty
        icon={Link2}
        title="אין סוגי רשימות פעילים"
        description="יש ליצור או להפעיל סוג רשימה לפני הגדרת מיפוי קטגוריות."
      />
    );
  }

  return (
    <section className="settings-mapping" aria-label="מיפוי קטגוריות לסוג רשימה">
      <div className="settings-mapping__header">
        <div>
          <h2>מיפוי קטגוריות לסוג רשימה</h2>
          <p>קובע אילו קטגוריות קטלוג יוצעו בעת הוספת פריט לרשימה מהסוג הנבחר.</p>
        </div>
        <div className="settings-mapping__selector">
          <Select
            label="סוג רשימה"
            value={selectedTypeId}
            onValueChange={setSelectedTypeId}
          >
            {listTypes.map((type) => (
              <option key={type.id} value={String(type.id)}>{type.name}</option>
            ))}
          </Select>
          <span><TechnicalValue>{selectedIds.size}</TechnicalValue> קטגוריות ממופות</span>
        </div>
      </div>

      {linksLoading ? (
        <div className="settings-mapping__skeleton" role="status" aria-label="טעינת קטגוריות למיפוי">
          <SettingsSkeleton label="טעינת קטגוריות למיפוי" />
          <SettingsSkeleton label="טעינת קטגוריות ממופות" />
        </div>
      ) : linksError ? (
        <SettingsLoadError title="טעינת מיפוי הקטגוריות נכשלה" onRetry={loadLinks} />
      ) : categories.length === 0 ? (
        <SettingsEmpty
          icon={Grid2X2}
          title="אין קטגוריות קטלוג למיפוי"
          description="יש ליצור קטגוריות קטלוג לפני שאפשר לשייך אותן לסוג רשימה."
        />
      ) : (
        <div className="settings-mapping__columns">
          <div className="settings-mapping__column" aria-label="קטגוריות זמינות">
            <h3>קטגוריות זמינות</h3>
            <div className="settings-mapping__list">
              {availableCategories.length === 0 ? (
                <p className="settings-mapping__empty">כל הקטגוריות ממופות לסוג הנבחר.</p>
              ) : availableCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className="settings-mapping__item"
                  onClick={() => toggleCategory(category.id)}
                  aria-label={`הוספת ${category.name} למיפוי`}
                >
                  <span aria-hidden="true">{category.icon || '🛒'}</span>
                  <span>{category.name}</span>
                  {!category.is_active && <span className="settings-status is-inactive">לא פעילה</span>}
                  <Plus size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <div className="settings-mapping__column is-selected" aria-label="קטגוריות ממופות">
            <h3>ממופות לסוג הנבחר</h3>
            <div className="settings-mapping__list">
              {mappedCategories.length === 0 ? (
                <p className="settings-mapping__empty">
                  אין קטגוריות ממופות. לא תוצע קטגוריית קטלוג בעת הוספת פריט.
                </p>
              ) : mappedCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className="settings-mapping__item"
                  onClick={() => toggleCategory(category.id)}
                  aria-label={`הסרת ${category.name} מהמיפוי`}
                >
                  <span aria-hidden="true">{category.icon || '🛒'}</span>
                  <span>{category.name}</span>
                  {!category.is_active && <span className="settings-status is-inactive">לא פעילה</span>}
                  <Minus size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {saveState && <Alert variant={saveState.variant} announce>{saveState.message}</Alert>}
      {!linksLoading && !linksError && categories.length > 0 && (
        <PrimaryButton
          type="button"
          className="settings-mapping__save"
          loading={saving}
          loadingText="שומר מיפוי..."
          onClick={handleSave}
        >
          שמירת שינויים ({selectedIds.size} קטגוריות)
        </PrimaryButton>
      )}
    </section>
  );
};

const SHOPPING_TABS = [
  { value: 'list-types', label: 'סוגי רשימות' },
  { value: 'categories', label: 'קטגוריות קטלוג' },
  { value: 'mapping', label: 'מיפוי קטגוריות' },
];

const ShoppingSettingsTab = () => {
  const [activeSection, setActiveSection] = useState('list-types');

  return (
    <section className="settings-shopping" aria-label="הגדרות קניות">
      <div className="settings-shopping__intro">
        <ShoppingBasket size={18} aria-hidden="true" />
        <div>
          <h2>הגדרות קניות</h2>
          <p>ניהול סוגי הרשימות, קטגוריות הקטלוג והמיפוי ביניהם.</p>
        </div>
      </div>
      <Tabs value={activeSection} onValueChange={setActiveSection} className="settings-nested-tabs">
        <TabList aria-label="אזורי הגדרות קניות" className="settings-nested-tabs__list">
          {SHOPPING_TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value}>{tab.label}</Tab>
          ))}
        </TabList>
        <TabPanel value="list-types">
          {activeSection === 'list-types' && <ListTypesSection />}
        </TabPanel>
        <TabPanel value="categories">
          {activeSection === 'categories' && <CatalogCategoriesSection />}
        </TabPanel>
        <TabPanel value="mapping">
          {activeSection === 'mapping' && <MappingSection />}
        </TabPanel>
      </Tabs>
    </section>
  );
};

export default ShoppingSettingsTab;
