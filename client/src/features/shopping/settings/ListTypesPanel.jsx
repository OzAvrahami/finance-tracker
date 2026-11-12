import { useEffect, useMemo, useState } from 'react';
import { Alert, PrimaryButton, SecondaryButton, Select, TextField } from '../../../components/ui';
import EditDialog from '../components/EditDialog';
import { confirmDiscard, useUnsavedChanges } from '../hooks/useUnsavedChanges';

function BranchEditor({ type, data, api, refresh }) {
  const initial = useMemo(() => data.links.filter(l => String(l.list_type_id) === type.id && !data.categories.find(c => c.id === l.category_id)?.is_neutral).map(l => l.category_id), [data.links, data.categories, type.id]);
  const [draft, setDraft] = useState(null), [search, setSearch] = useState(''), [preview, setPreview] = useState(null), [error, setError] = useState(null), [retry, setRetry] = useState(0), [saving, setSaving] = useState(false);
  const selected = draft?.ids || initial;
  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...initial].sort());
  useUnsavedChanges(dirty);
  useEffect(() => {
    const controller = new AbortController();
    api.previewBranches(type.id, selected, controller.signal).then(result => {
      if (!controller.signal.aborted) { setPreview({ ...result, etag: data.etag }); setError(null); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, [api, type.id, selected, retry, data.etag]);
  const categories = data.categories.filter(c => !c.is_neutral && (c.effective_active || selected.includes(c.id)) && c.path.some(p => p.name.includes(search)));
  // A response remains associated with its exact selection until a fresh one arrives.
  const currentPreview = preview?.etag === data.etag && JSON.stringify([...preview.branch_ids].sort()) === JSON.stringify([...selected].sort());
  return <div className="shopping-admin-columns">
    <div>
      <TextField label="חיפוש ענף למיפוי" value={search} onValueChange={setSearch} />
      <div className="shopping-admin-branches" role="group" aria-label="ענפי הרשימה">
        {categories.map(c => <label key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={e => setDraft({ etag: draft?.etag || data.etag, ids: e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id) })} />{c.path.map(p => p.name).join(' / ')}{c.effective_active ? '' : ' (מוסתר)'}</label>)}
      </div>
      <p>כל הצאצאים נכללים אוטומטית. ענפים חופפים נספרים פעם אחת. הקטגוריה הניטרלית נכללת תמיד.</p>
      {dirty && <p role="status">שינויים ממתינים לשמירה</p>}
      {dirty && draft.etag !== data.etag && <Alert variant="warning">הקטלוג השתנה מאז תחילת העריכה. השמירה תדרוש רענון ובדיקה של הטיוטה.</Alert>}
      <div className="shopping-admin-actions"><PrimaryButton disabled={!dirty} onClick={() => setSaving(true)}>סקירה ושמירת מיפוי</PrimaryButton><SecondaryButton disabled={!draft} onClick={() => { if (confirmDiscard(dirty)) setDraft(null); }}>ביטול שינויים</SecondaryButton></div>
    </div>
    <aside className="shopping-admin-detail" aria-label="תצוגת זמינות">
      <h2>זמינות עבור {type.name}</h2>
      {error ? <><Alert variant="error">{error.message}</Alert><SecondaryButton onClick={() => setRetry(n => n + 1)}>ניסיון חוזר לתצוגה</SecondaryButton></> : !currentPreview ? <p role="status">מחשב תצוגה…</p> : <>
        <p role="status">{preview.category_ids.length} קטגוריות · {preview.product_ids.length} מוצרים</p>
        <p>{dirty ? 'תצוגה של הטיוטה — טרם נשמרה' : api.mode === 'isolated' ? 'המיפוי השמור במסד המקומי' : 'המיפוי השמור בהדגמה'}</p>
        <details><summary>מוצרים זמינים</summary><ul>{data.products.filter(p => preview.product_ids.includes(p.id)).map(p => <li key={p.id}>{p.name} <small>({p.id})</small></li>)}</ul></details>
      </>}
    </aside>
    {saving && <EditDialog {...{ data, api, refresh }} expectedEtag={draft?.etag} title="שמירת ענפי רשימה" operation="branches.replace" id={type.id} initial={{ categoryIds: selected }} body={v => v} onSaved={() => setDraft(null)} onClose={() => setSaving(false)}>
      {() => <p>ישמרו {selected.length} ענפים מפורשים. לא יועתקו מוצרים ולא ישתנו רשימות קיימות.</p>}
    </EditDialog>}
  </div>;
}

export default function ListTypesPanel({ data, api, refresh }) {
  const [id, setId] = useState(data.listTypes[0]?.id || '');
  const [visited, setVisited] = useState([id]);
  // Mount on first visit; retain visited editors so drafts cannot disappear.
  return <section aria-label="ניהול סוגי רשימות">
    <Select label="סוג רשימה לעריכה" value={id} onValueChange={value => { setId(value); setVisited(previous => previous.includes(value) ? previous : [...previous, value]); }}>{data.listTypes.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_active ? '' : ' (לא פעיל)'}</option>)}</Select>
    {data.listTypes.filter(type => visited.includes(type.id)).map(type => <div key={type.id} hidden={id !== type.id}><BranchEditor {...{ type, data, api, refresh }} /></div>)}
  </section>;
}
