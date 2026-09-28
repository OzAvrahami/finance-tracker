import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Alert, Dialog, PrimaryButton, SecondaryButton, TextField } from '../../components/ui';
import { createFlowlinkPairing, cancelFlowlinkPairing } from '../../services/api';
import './FlowlinkPairingDialog.css';

// Only this mounted dialog holds the capability. Never persist, log, or send it to a QR service.
export default function FlowlinkPairingDialog({ refreshDevices, onConnected, onClose }) {
  const [label, setLabel] = useState('');
  const [pairing, setPairing] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fallback, setFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const live = useRef(false), current = useRef(null), previous = useRef(new Set());
  const callbacks = useRef({ refreshDevices, onConnected });
  useEffect(() => { callbacks.current = { refreshDevices, onConnected }; }, [refreshDevices, onConnected]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      const id = current.current?.pairing_id; current.current = null;
      if (id) cancelFlowlinkPairing(id).catch(() => {}); // Unmount/navigation: best effort; TTL is server authority.
    };
  }, []);
  const seconds = pairing ? Math.max(0, Math.ceil((Date.parse(pairing.expires_at) - now) / 1000)) : 0;
  useEffect(() => {
    if (!pairing) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [pairing]);
  useEffect(() => {
    if (!pairing || seconds > 0 || !pairing.pairing_text) return;
    setPairing(p => p && { ...p, pairing_text: null }); setFallback(false); setCopied(false);
  }, [pairing, seconds]);
  useEffect(() => {
    if (!pairing?.pairing_text) return undefined;
    let stopped = false, timer;
    async function poll() {
      try {
        const rows = await callbacks.current.refreshDevices();
        if (stopped || !live.current) return;
        const added = rows.filter(d => d.status === 'active' && d.label === pairing.label && !previous.current.has(d.id));
        if (added.length === 1) { callbacks.current.onConnected(added[0]); return; }
        if (added.length > 1) setError('נוספו כמה מכשירים בשם זה. סגרו את החלון ובחרו את המכשיר הרצוי מהרשימה.');
      } catch {
        if (!stopped && live.current) setError('עדכון רשימת המכשירים מתעכב. אפשר להמשיך לסרוק או לרענן לאחר סגירת החלון.');
      }
      if (!stopped) timer = setTimeout(poll, 30000);
    }
    timer = setTimeout(poll, 5000); // First update promptly, then <= 20 normal polls per QR lifetime.
    return () => { stopped = true; clearTimeout(timer); };
  }, [pairing]);
  async function generate(event) {
    event?.preventDefault(); if (busy) return;
    const name = label.trim();
    if (!name || [...name].length > 80 || /[\p{Cc}\p{Cf}]/u.test(name) || /(?:\d[ -]*){13}/.test(name)) {
      setError('הזינו שם קצר למכשיר, ללא מספר כרטיס מלא.'); return;
    }
    setBusy(true); setError(''); setFallback(false); setCopied(false);
    try {
      const rows = await refreshDevices();
      if (rows.some(d => d.status === 'active' && d.label === name)) {
        setError('כבר קיים מכשיר פעיל בשם זה. בחרו שם אחר כדי לזהות את ה־iPhone החדש.'); return;
      }
      previous.current = new Set(rows.map(d => d.id));
      const old = current.current; current.current = null;
      if (old) {
        try { await cancelFlowlinkPairing(old.pairing_id); }
        catch (e) { if (e.response?.status !== 409) throw e; }
      }
      if (!live.current) return;
      const { data } = await createFlowlinkPairing({ purpose: 'enroll', label: name });
      if (!live.current) { cancelFlowlinkPairing(data.pairing_id).catch(() => {}); return; }
      current.current = { pairing_id: data.pairing_id };
      if (typeof data.pairing_text !== 'string' || !/^flpair1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(data.pairing_text)
        || !Number.isFinite(Date.parse(data.expires_at))) throw new Error('invalid response');
      setNow(Date.now()); setPairing({ ...data, label: name });
    } catch {
      if (live.current) setError('לא ניתן ליצור QR כרגע. בדקו אם נוסף מכשיר לפני ניסיון נוסף.');
    } finally { if (live.current) setBusy(false); }
  }
  async function close() {
    if (busy) return;
    setBusy(true); setPairing(null); setFallback(false);
    const id = current.current?.pairing_id; current.current = null;
    let cancelled = true;
    if (id) {
      try { await cancelFlowlinkPairing(id); }
      catch (e) { cancelled = e.response?.status === 409; } // Consumed/terminal: refresh, never revoke a device.
    }
    try { await refreshDevices(); } catch { /* Main list can be refreshed again. */ }
    if (live.current) onClose(cancelled ? '' : 'לא ניתן לאשר שה־QR בוטל. הוא יפוג אוטומטית בתוך עשר דקות מהיצירה.');
  }
  return <Dialog open onClose={close} closeDisabled={busy} title="חיבור iPhone חדש"
    description="פתחו את FlowLink ב־iPhone ובחרו Scan QR. החיבור נעשה פעם אחת בלבד."
    footer={<SecondaryButton disabled={busy} onClick={close}>ביטול</SecondaryButton>}>
    {error && <Alert variant="error" urgent>{error}</Alert>}
    {!pairing ? <form onSubmit={generate} className="settings-dialog-form">
      <TextField label="שם המכשיר" value={label} onValueChange={setLabel} maxLength={80} required disabled={busy} placeholder="Noya iPhone" />
      <PrimaryButton type="submit" disabled={busy}>{busy ? 'מכינים QR…' : 'יצירת QR'}</PrimaryButton>
    </form> : <div className="flowlink-pairing">
      <h3>{pairing.label}</h3>
      {seconds > 0 && pairing.pairing_text ? <>
        <div className="flowlink-pairing__qr"><QRCode value={pairing.pairing_text} size={224} level="M" title="QR לחיבור FlowLink" /></div>
        <p>ה־QR יפוג בעוד <b dir="ltr">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</b></p>
        <p role="status">ממתינים לחיבור ה־iPhone…</p>
        <SecondaryButton onClick={() => setFallback(v => !v)}>לא מצליחים לסרוק?</SecondaryButton>
        {fallback && <div>
          <p>ב־FlowLink בחרו Having trouble scanning? והדביקו את הקוד.</p>
          <code className="flowlink-pairing__code" dir="ltr">{pairing.pairing_text}</code>
          <SecondaryButton onClick={async () => {
            try { await navigator.clipboard.writeText(pairing.pairing_text); if (live.current) setCopied(true); }
            catch { if (live.current) setError('העתקה לא זמינה. אפשר לבחור ולהעתיק את הקוד המוצג.'); }
          }}>{copied ? 'הועתק' : 'העתקת קוד'}</SecondaryButton>
        </div>}
      </> : <>
        <p role="status">תוקף ה־QR פג. אפשר ליצור חדש.</p>
        <PrimaryButton disabled={busy} onClick={generate}>יצירת QR חדש</PrimaryButton>
      </>}
    </div>}
  </Dialog>;
}
