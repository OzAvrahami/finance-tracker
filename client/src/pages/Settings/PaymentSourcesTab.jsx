import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard } from 'lucide-react';
import {
  Alert,
  ConfirmDialog,
  Dialog,
  Select,
  TechnicalValue,
  TextField,
} from '../../components/ui';
import {
  createSettingsPaymentSource,
  deleteSettingsPaymentSource,
  getSettingsPaymentSources,
  updateSettingsPaymentSource,
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

const METHODS = [
  { value: 'credit_card', label: 'כרטיס אשראי' },
  { value: 'debit_card', label: 'כרטיס חיוב' },
  { value: 'cash', label: 'מזומן' },
  { value: 'bank_transfer', label: 'העברה בנקאית' },
  { value: 'digital_wallet', label: 'ארנק דיגיטלי' },
  { value: 'check', label: 'המחאה' },
];

const METHOD_LABELS = Object.fromEntries(METHODS.map(({ value, label }) => [value, label]));

const initialForm = {
  name: '',
  method: 'credit_card',
  issuer: '',
  last4: '',
  owner: '',
  isActive: true,
};

const PaymentSourcesTab = () => {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  const loadSources = useCallback(async () => {
    setLoadError(false);
    try {
      const response = await getSettingsPaymentSources();
      setSources(Array.isArray(response.data) ? response.data : []);
      return true;
    } catch {
      setLoadError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const counts = useMemo(() => ({
    active: sources.filter((source) => source.is_active).length,
    inactive: sources.filter((source) => !source.is_active).length,
  }), [sources]);

  const displayedSources = useMemo(
    () => showInactive ? sources : sources.filter((source) => source.is_active),
    [showInactive, sources],
  );

  const openCreate = () => {
    setEditingSource(null);
    setForm(initialForm);
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (source) => {
    setEditingSource(source);
    setForm({
      name: source.name,
      method: source.method || 'credit_card',
      issuer: source.issuer || '',
      last4: source.last4 || '',
      owner: source.owner || '',
      isActive: source.is_active,
    });
    setFormError('');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setEditingSource(null);
    setFormError('');
  };

  const updateForm = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('נא להזין שם לאמצעי התשלום');
      return;
    }

    const payload = {
      name: form.name.trim(),
      method: form.method,
      issuer: form.issuer.trim() || null,
      last4: form.last4.trim() || null,
      owner: form.owner.trim() || null,
    };
    if (editingSource) payload.is_active = form.isActive;

    setSaving(true);
    setFormError('');
    try {
      if (editingSource) {
        await updateSettingsPaymentSource(editingSource.id, payload);
      } else {
        await createSettingsPaymentSource(payload);
      }
      setDialogOpen(false);
      setEditingSource(null);
      await loadSources();
    } catch (error) {
      setFormError(error.response?.data?.error || 'שגיאה בשמירת אמצעי התשלום');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    await deleteSettingsPaymentSource(deactivateTarget.id);
    setDeactivateTarget(null);
    await loadSources();
  };

  const handleReactivate = async (source) => {
    setMutationError('');
    try {
      await updateSettingsPaymentSource(source.id, { is_active: true });
      await loadSources();
    } catch (error) {
      setMutationError(error.response?.data?.error || 'הפעלת אמצעי התשלום מחדש נכשלה.');
    }
  };

  if (loading) return <SettingsSkeleton label="טעינת אמצעי תשלום" />;

  if (loadError) {
    return <SettingsLoadError title="טעינת אמצעי התשלום נכשלה" onRetry={loadSources} />;
  }

  return (
    <section className="settings-section" aria-label="אמצעי תשלום">
      <SettingsToolbar
        title="אמצעי תשלום"
        description="כרטיסים, חשבונות ואמצעים אחרים שמשויכים לתנועות."
        activeCount={counts.active}
        inactiveCount={counts.inactive}
        activeLabel="פעילים"
        inactiveLabel="לא פעילים"
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive((value) => !value)}
        showInactiveLabel="הצגת לא פעילים"
        hideInactiveLabel="הסתרת לא פעילים"
        addLabel="אמצעי תשלום חדש"
        onAdd={openCreate}
      />

      {mutationError && <Alert variant="error" urgent>{mutationError}</Alert>}

      {displayedSources.length === 0 ? (
        <SettingsEmpty
          icon={CreditCard}
          title={sources.length === 0 ? 'לא הוגדרו אמצעי תשלום' : 'אין אמצעי תשלום פעילים להצגה'}
          description={sources.length === 0
            ? 'אפשר להוסיף אמצעי תשלום ולשייך אותו לתנועות חדשות.'
            : 'אפשר להציג אמצעים לא פעילים ולהפעיל אותם מחדש.'}
          actionLabel={sources.length === 0 ? 'יצירת אמצעי תשלום' : undefined}
          onAction={sources.length === 0 ? openCreate : undefined}
        />
      ) : (
        <div className="settings-records" aria-label="רשימת אמצעי תשלום">
          {displayedSources.map((source) => (
            <SettingsRecord
              key={source.id}
              icon={<CreditCard size={18} />}
              title={source.name}
              active={source.is_active}
              metadata={(
                <>
                  {source.issuer && <TechnicalValue>{source.issuer}</TechnicalValue>}
                  {source.issuer && source.last4 && <span aria-hidden="true">·</span>}
                  {source.last4 && <TechnicalValue>•••• {source.last4}</TechnicalValue>}
                  {(source.issuer || source.last4) && source.owner && <span aria-hidden="true">·</span>}
                  {source.owner && <span>{source.owner}</span>}
                  {!source.issuer && !source.last4 && !source.owner && <span>ללא פרטים נוספים</span>}
                </>
              )}
              badges={(
                <>
                  <span className={`settings-method-badge is-${source.method}`}>
                    {METHOD_LABELS[source.method] || source.method}
                  </span>
                  <SettingsStatusBadge active={source.is_active} />
                </>
              )}
              editLabel={`עריכת אמצעי התשלום ${source.name}`}
              onEdit={() => openEdit(source)}
              onDeactivate={() => setDeactivateTarget(source)}
              onReactivate={() => handleReactivate(source)}
            />
          ))}
        </div>
      )}

      <div className="settings-note">
        המערכת אינה שומרת יתרת חשבון, מסגרת אשראי או אשראי פנוי לאמצעי תשלום.
      </div>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editingSource ? 'עריכת אמצעי תשלום' : 'אמצעי תשלום חדש'}
        size="md"
        className="settings-dialog"
        closeDisabled={saving}
        footer={<SettingsDialogFooter onCancel={closeDialog} onSave={handleSave} loading={saving} />}
      >
        <div className="settings-dialog__form">
          {formError && <Alert variant="error" urgent>{formError}</Alert>}
          <TextField
            label="שם התצוגה"
            value={form.name}
            onValueChange={updateForm('name')}
            placeholder="למשל: ויזה כאל — יומיומי"
            required
          />
          <div className="settings-form-grid settings-form-grid--two">
            <Select label="אמצעי" value={form.method} onValueChange={updateForm('method')}>
              {METHODS.map((method) => (
                <option key={method.value} value={method.value}>{method.label}</option>
              ))}
            </Select>
            <TextField
              label="מנפיק או בנק"
              value={form.issuer}
              onValueChange={updateForm('issuer')}
              placeholder="למשל: Visa Cal"
              technicalLtr
            />
          </div>
          <div className="settings-form-grid settings-form-grid--two">
            <TextField
              label="ארבע ספרות אחרונות"
              value={form.last4}
              onValueChange={(value) => updateForm('last4')(value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              maxLength={4}
              placeholder="1234"
              technicalLtr
            />
            <TextField
              label="בעלים"
              value={form.owner}
              onValueChange={updateForm('owner')}
              placeholder="שם הבעלים"
            />
          </div>
          {editingSource && (
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => updateForm('isActive')(event.target.checked)}
              />
              אמצעי תשלום פעיל
            </label>
          )}
          <div className="settings-note settings-note--compact">
            לא נשמרים כאן יתרה, מסגרת אשראי או אשראי פנוי.
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
        title={deactivateTarget ? `השבתת „${deactivateTarget.name}”` : 'השבתת אמצעי תשלום'}
        message="האמצעי לא יוצע בתנועות חדשות. תנועות היסטוריות יישארו משויכות אליו וניתן להפעיל אותו מחדש."
        confirmLabel="השבתה"
        variant="warning"
        errorMessage="השבתת אמצעי התשלום נכשלה. האמצעי נשאר פעיל."
      />
    </section>
  );
};

export default PaymentSourcesTab;
