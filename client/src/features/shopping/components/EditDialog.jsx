import { useState } from 'react';
import { Alert, Dialog, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { confirmDiscard, useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { CatalogError } from '../services/catalogApi';

export default function EditDialog({ title, initial, children, operation, id, body, api, data, refresh, onClose, onSaved, confirmation, expectedEtag }) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [request, setRequest] = useState(null);
  const [revision, setRevision] = useState(expectedEtag || data.etag);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial) || Boolean(request);
  useUnsavedChanges(dirty);
  const close = () => { if (!saving && confirmDiscard(dirty)) onClose(); };
  const submit = async event => {
    event.preventDefault();
    if (saving) return;
    if (confirmation && !request && !window.confirm(confirmation)) return;
    setSaving(true); setError(null);
    let committed = false;
    try {
      const command = request || await api.prepare(operation, id, body(values), revision);
      setRequest(command);
      await api.send(command);
      committed = true;
      await refresh(); // Unknown refresh outcome retains the same command for replay.
      onSaved?.();
      onClose();
    } catch (failure) { setError(committed ? new CatalogError('shopping_refresh_failed', 503) : failure); setReviewed(false); }
    finally { setSaving(false); }
  };
  const stale = error?.code === 'shopping_revision_stale';
  return <Dialog open onClose={close} closeDisabled={saving} title={title} description={api.mode === 'isolated' ? 'השינויים יישמרו במסד הבדיקה המקומי המבודד בלבד.' : 'השינויים נשמרים בזיכרון ההדגמה המקומית בלבד.'}>
    <form onSubmit={submit} className="shopping-admin-form">
      {dirty && <p role="status">שינויים ממתינים לשמירה</p>}
      {error && <Alert variant="error" urgent>{error.message}</Alert>}
      {stale && <SecondaryButton type="button" onClick={async () => {
        try { const latest = await refresh(); setRevision(latest.etag); setRequest(null); setReviewed(true); } catch (failure) { setError(failure); }
      }}>רענון לבדיקה — שמירת הטיוטה</SecondaryButton>}
      {reviewed && <p role="status">הנתונים רועננו. בדקו את הטיוטה לפני שמירה מחדש.</p>}
      <fieldset disabled={saving || Boolean(error?.uncertain)}>
        {children(values, (key, value) => { setValues(v => ({ ...v, [key]: value })); setRequest(null); }, data)}
      </fieldset>
      <div className="shopping-admin-actions">
        <PrimaryButton type="submit" loading={saving} disabled={stale && !reviewed}>{error?.uncertain ? 'ניסיון חוזר לאותה בקשה' : api.mode === 'isolated' ? 'שמירה במסד המקומי' : 'שמירה בהדגמה'}</PrimaryButton>
        <SecondaryButton type="button" disabled={saving} onClick={close}>ביטול</SecondaryButton>
      </div>
    </form>
  </Dialog>;
}
