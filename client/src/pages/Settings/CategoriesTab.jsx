import { useCallback, useEffect, useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
import {
  Alert,
  ConfirmDialog,
  Dialog,
  Select,
  TextArea,
  TextField,
} from '../../components/ui';
import {
  createSettingsCategory,
  deleteSettingsCategory,
  getSettingsCategories,
  updateSettingsCategory,
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

const TYPE_LABELS = {
  expense: 'הוצאה',
  income: 'הכנסה',
};

const initialForm = {
  name: '',
  type: 'expense',
  icon: '',
  keywords: '',
  isActive: true,
};

const CategoriesTab = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  const loadCategories = useCallback(async () => {
    setLoadError(false);
    try {
      const response = await getSettingsCategories();
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
    active: categories.filter((category) => category.is_active).length,
    inactive: categories.filter((category) => !category.is_active).length,
  }), [categories]);

  const displayedCategories = useMemo(
    () => showInactive ? categories : categories.filter((category) => category.is_active),
    [categories, showInactive],
  );

  const openCreate = () => {
    setEditingCategory(null);
    setForm(initialForm);
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (category) => {
    setEditingCategory(category);
    setForm({
      name: category.name,
      type: category.type,
      icon: category.icon || '',
      keywords: (category.keywords || []).join(', '),
      isActive: category.is_active,
    });
    setFormError('');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setEditingCategory(null);
    setFormError('');
  };

  const updateForm = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('נא להזין שם קטגוריה');
      return;
    }

    const payload = {
      name: form.name.trim(),
      type: form.type,
      icon: form.icon.trim() || null,
      keywords: form.keywords.split(',').map((keyword) => keyword.trim()).filter(Boolean),
    };
    if (editingCategory) payload.is_active = form.isActive;

    setSaving(true);
    setFormError('');
    try {
      if (editingCategory) {
        await updateSettingsCategory(editingCategory.id, payload);
      } else {
        await createSettingsCategory(payload);
      }
      setDialogOpen(false);
      setEditingCategory(null);
      await loadCategories();
    } catch (error) {
      setFormError(error.response?.data?.error || 'שגיאה בשמירת הקטגוריה');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    await deleteSettingsCategory(deactivateTarget.id);
    setDeactivateTarget(null);
    await loadCategories();
  };

  const handleReactivate = async (category) => {
    setMutationError('');
    try {
      await updateSettingsCategory(category.id, { is_active: true });
      await loadCategories();
    } catch (error) {
      setMutationError(error.response?.data?.error || 'הפעלת הקטגוריה מחדש נכשלה.');
    }
  };

  if (loading) return <SettingsSkeleton label="טעינת קטגוריות" />;

  if (loadError) {
    return <SettingsLoadError title="טעינת הקטגוריות נכשלה" onRetry={loadCategories} />;
  }

  return (
    <section className="settings-section" aria-label="קטגוריות תנועות">
      <SettingsToolbar
        title="קטגוריות תנועות"
        description="מילות הזיהוי משמשות לסיווג אוטומטי בעת ייבוא תנועות."
        activeCount={counts.active}
        inactiveCount={counts.inactive}
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive((value) => !value)}
        addLabel="קטגוריה חדשה"
        onAdd={openCreate}
      />

      {mutationError && <Alert variant="error" urgent>{mutationError}</Alert>}

      {displayedCategories.length === 0 ? (
        <SettingsEmpty
          icon={Tag}
          title={categories.length === 0 ? 'לא הוגדרו קטגוריות' : 'אין קטגוריות פעילות להצגה'}
          description={categories.length === 0
            ? 'בלי קטגוריות, תנועות יכולות להישמר ללא קטגוריה.'
            : 'אפשר להציג קטגוריות לא פעילות ולהפעיל אותן מחדש.'}
          actionLabel={categories.length === 0 ? 'יצירת קטגוריה' : undefined}
          onAction={categories.length === 0 ? openCreate : undefined}
        />
      ) : (
        <div className="settings-records" aria-label="רשימת קטגוריות">
          {displayedCategories.map((category) => {
            const keywordCount = (category.keywords || []).filter(Boolean).length;
            return (
              <SettingsRecord
                key={category.id}
                icon={category.icon || '🏷️'}
                title={category.name}
                active={category.is_active}
                metadata={keywordCount > 0 ? `${keywordCount} מילות זיהוי` : 'ללא מילות זיהוי'}
                badges={(
                  <>
                    <span className={`settings-type-badge is-${category.type}`}>
                      {TYPE_LABELS[category.type] || category.type}
                    </span>
                    <SettingsStatusBadge active={category.is_active} feminine />
                  </>
                )}
                editLabel={`עריכת הקטגוריה ${category.name}`}
                onEdit={() => openEdit(category)}
                onDeactivate={() => setDeactivateTarget(category)}
                onReactivate={() => handleReactivate(category)}
              />
            );
          })}
        </div>
      )}

      <div className="settings-note">
        השבתה אינה מוחקת: תנועות היסטוריות נשארות משויכות לקטגוריה, והיא לא תוצע לתנועות חדשות.
      </div>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editingCategory ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}
        size="md"
        className="settings-dialog"
        closeDisabled={saving}
        footer={<SettingsDialogFooter onCancel={closeDialog} onSave={handleSave} loading={saving} />}
      >
        <div className="settings-dialog__form">
          {formError && (
            <Alert variant={formError.includes('סוג') ? 'warning' : 'error'} urgent>
              {formError}
            </Alert>
          )}
          <div className="settings-category-name-grid">
            <TextField
              label="סמל"
              value={form.icon}
              onValueChange={updateForm('icon')}
              placeholder="🏷️"
              inputClassName="settings-emoji-input"
              maxLength={8}
            />
            <TextField
              label="שם הקטגוריה"
              value={form.name}
              onValueChange={updateForm('name')}
              placeholder="למשל: מזון וסופר"
              required
            />
          </div>
          <Select
            label="סוג"
            value={form.type}
            onValueChange={updateForm('type')}
            helperText={editingCategory ? 'אם קיימות תנועות מקושרות, ייתכן שלא ניתן לשנות את הסוג.' : undefined}
          >
            <option value="expense">הוצאה</option>
            <option value="income">הכנסה</option>
          </Select>
          <TextArea
            label="מילות זיהוי לסיווג אוטומטי"
            value={form.keywords}
            onValueChange={updateForm('keywords')}
            placeholder="רמי לוי, שופרסל, ויקטורי"
            helperText="מופרדות בפסיקים ומשמשות בעת ייבוא תנועות."
            rows={3}
          />
          {editingCategory && (
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => updateForm('isActive')(event.target.checked)}
              />
              קטגוריה פעילה
            </label>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
        title={deactivateTarget ? `השבתת „${deactivateTarget.name}”` : 'השבתת קטגוריה'}
        message="הקטגוריה לא תוצע לתנועות חדשות. תנועות היסטוריות יישארו משויכות אליה וניתן להפעיל אותה מחדש."
        confirmLabel="השבתה"
        variant="warning"
        errorMessage="השבתת הקטגוריה נכשלה. הקטגוריה נשארה פעילה."
      />
    </section>
  );
};

export default CategoriesTab;
