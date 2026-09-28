import { useCallback, useEffect, useState } from 'react';
import { Alert, ConfirmDialog, PrimaryButton, SecondaryButton, Select, TextField } from '../../components/ui';
import { createFlowlinkBinding, getFlowlinkBindings, getFlowlinkDevices, getFlowlinkPaymentSources, updateFlowlinkBinding } from '../../services/api';
import FlowlinkPairingDialog from './FlowlinkPairingDialog';
import { SettingsSkeleton } from './SettingsComponents';

const statusLabels = { active: 'פעיל', disabled: 'מושבת', retired: 'הוצא משימוש' };
async function pages(fetchPage, key) {
  const rows = [];let cursor;
  do {
    const { data } = await fetchPage(cursor);
    rows.push(...data[key]);cursor = data.next_cursor;
  } while (cursor);
  return rows;
}
export default function FlowlinkBindingsTab() {
  const [devices, setDevices] = useState([]), [sources, setSources] = useState([]), [bindings, setBindings] = useState([]);
  const [deviceId, setDeviceId] = useState(''), [paymentId, setPaymentId] = useState(''), [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true), [listLoading, setListLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [allowed, setAllowed] = useState(false), [reload, setReload] = useState(0);
  const [pending, setPending] = useState(null), [retiring, setRetiring] = useState(null), [notice, setNotice] = useState('');
  useEffect(() => {
    let current = true;setLoading(true);
    Promise.all([pages(getFlowlinkDevices, 'devices'), pages(getFlowlinkPaymentSources, 'payment_sources')])
      .then(([d, p]) => { if (current) { setDevices(d);setSources(p);setAllowed(true); } })
      .catch(e => { if (current) { setAllowed(false);setError(e.response?.status === 403
        ? 'ניהול FlowLink זמין רק לבעלי הרשאה.' : 'לא ניתן לטעון את ניהול FlowLink כרגע.'); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [reload]);
  useEffect(() => {
    let current = true;setBindings([]);
    if (!deviceId) return undefined;
    setListLoading(true);
    pages(cursor => getFlowlinkBindings(deviceId, cursor), 'bindings')
      .then(rows => { if (current) setBindings(rows); })
      .catch(() => { if (current) setError('טעינת השיוכים נכשלה. נסו לרענן.'); })
      .finally(() => { if (current) setListLoading(false); });
    return () => { current = false; };
  }, [deviceId, reload]);
  const [pairingOpen, setPairingOpen] = useState(false);
  const refreshDevices = useCallback(async () => {
    const rows = await pages(getFlowlinkDevices, 'devices'); setDevices(rows); return rows;
  }, []);
  const selected = devices.find(d => d.id === deviceId);
  async function execute(command) {
    setPending(command);setBusy(true);setError('');setNotice('');
    try {
      if (command.kind === 'create') await createFlowlinkBinding(command.id, command.body);
      else await updateFlowlinkBinding(command.id, command.body);
      setPending(null);setRetiring(null);setLabel('');setPaymentId('');setNotice('השיוך עודכן.');setReload(v => v + 1);
    } catch (e) {
      const status = e.response?.status;
      if (status && status < 500 && status !== 429) {
        setPending(null);setRetiring(null);setReload(v => v + 1);
        setError(status === 409 ? 'השיוך השתנה או שהפעולה אינה אפשרית במצבו הנוכחי. בדקו את הרשימה המעודכנת.' : 'הפעולה נדחתה. בדקו את ההרשאה ואת פרטי השיוך.');
      } else setError('לא ניתן לאשר אם הפעולה הושלמה. נסו שוב את אותה פעולה כדי לקבל את התוצאה בבטחה.');
    } finally { setBusy(false); }
  }
  function update(binding, status) {
    return execute({ kind: 'update', id: binding.id, body: { request_id: crypto.randomUUID(), expected_revision: binding.revision, status } });
  }
  if (loading && !allowed) return <SettingsSkeleton label="טוען ניהול FlowLink" />;
  return <section className="settings-section flowlink-bindings" aria-label="שיוכי FlowLink">
    <h2>שיוכי כרטיסים ב־FlowLink</h2>
    <p>בחרו מכשיר רשום ואמצעי תשלום במפורש. החלפת כרטיס מחייבת הוצאת השיוך הישן משימוש ויצירת שיוך חדש.</p>
    {error && <Alert variant="error" role="alert">{error}</Alert>}
    {notice && <p role="status">{notice}</p>}
    {pending && <SecondaryButton disabled={busy} onClick={() => execute(pending)}>ניסיון חוזר לאותה פעולה</SecondaryButton>}
    {!pending && <SecondaryButton disabled={busy} onClick={() => setReload(v => v + 1)}>רענון</SecondaryButton>}
    {allowed && <>
      <PrimaryButton disabled={busy || Boolean(pending)} onClick={() => setPairingOpen(true)}>חיבור iPhone חדש</PrimaryButton>
      {pairingOpen && <FlowlinkPairingDialog refreshDevices={refreshDevices}
        onConnected={device => { setPaymentId(''); setLabel(''); setDeviceId(device.id); setPairingOpen(false); setNotice('ה־iPhone נוסף לרשימה. בדקו את שמו ב־FlowLink והוסיפו לו שיוך כרטיס.'); }}
        onClose={message => { setPairingOpen(false); if (message) setNotice(message); }} />}

      <Select label="מכשיר FlowLink" value={deviceId} onValueChange={setDeviceId} disabled={busy || Boolean(pending)}>
        <option value="">בחרו מכשיר</option>
        {devices.map(d => <option key={d.id} value={d.id}>{d.label} · {d.id.slice(0, 8)}{d.status === 'revoked' ? ' · בוטל' : ''}</option>)}
      </Select>
      {!devices.length && <p>אין מכשירים רשומים.</p>}
      {selected?.status === 'revoked' && <p>הרשאת המכשיר בוטלה. השיוכים נשמרים כהיסטוריה ואינם מאפשרים קליטה.</p>}
      {selected?.status === 'active' && <form className="settings-dialog-form" onSubmit={e => {
        e.preventDefault();if (busy || pending) return;
        execute({ kind: 'create', id: deviceId, body: { request_id: crypto.randomUUID(), label, payment_source_id: paymentId } });
      }}>
        <TextField label="שם השיוך" value={label} onValueChange={setLabel} required maxLength={80} disabled={busy || Boolean(pending)} helperText="שם לתצוגה בלבד. אין להזין מספר כרטיס מלא." />
        <Select label="אמצעי תשלום לשיוך" value={paymentId} onValueChange={setPaymentId} required disabled={busy || Boolean(pending)}>
          <option value="">בחרו אמצעי תשלום</option>
          {sources.map(p => <option key={p.id} value={p.id}>{p.name}{p.last4 ? ` · ${p.last4}` : ''}</option>)}
        </Select>
        <PrimaryButton type="submit" disabled={busy || Boolean(pending) || !label.trim() || !paymentId}>יצירת שיוך</PrimaryButton>
      </form>}
      {listLoading ? <SettingsSkeleton label="טוען שיוכים" /> : <div className="flowlink-binding-list">
        {deviceId && !bindings.length && <p>אין שיוכים למכשיר זה.</p>}
        {bindings.map(b => <article className="settings-record" key={b.id} aria-label={b.label}>
          <div className="settings-record__identity"><h3>{b.label}</h3><p>{sources.find(p => p.id === b.payment_source_id)?.name || 'אמצעי תשלום לא פעיל'} · {b.id.slice(0, 8)}</p></div>
          <span>{statusLabels[b.status]}</span>
          {b.status !== 'retired' && <div className="settings-record__actions">
            <SecondaryButton disabled={busy || Boolean(pending) || (b.status === 'disabled' && selected?.status !== 'active')} onClick={() => update(b, b.status === 'active' ? 'disabled' : 'active')}>
              {b.status === 'active' ? 'השבתה' : 'הפעלה מחדש'}
            </SecondaryButton>
            <SecondaryButton disabled={busy || Boolean(pending)} onClick={() => setRetiring(b)}>הוצאה משימוש</SecondaryButton>
          </div>}
        </article>)}
      </div>}
    </>}
    <ConfirmDialog open={Boolean(retiring)} onClose={() => setRetiring(null)} onConfirm={() => update(retiring, 'retired')}
      title="הוצאת שיוך משימוש" message="זו פעולה סופית. קליטות שממתינות לשיוך הזה לא יועברו לשיוך חדש. ההיסטוריה נשמרת."
      confirmLabel="הוצאה משימוש" variant="warning" />
  </section>;
}
