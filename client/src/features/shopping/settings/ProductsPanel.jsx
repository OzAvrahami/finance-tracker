import { useMemo, useState } from 'react';
import { Alert, PrimaryButton, SecondaryButton, Select, TextField } from '../../../components/ui';
import CategorySelector from '../components/CategorySelector';
import EditDialog from '../components/EditDialog';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';

export default function ProductsPanel({ data, api, refresh }) {
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [type, setType] = useState(''), [activity, setActivity] = useState('active');
  const [descendants, setDescendants] = useState(true), [duplicates, setDuplicates] = useState(false), [selected, setSelected] = useState([]), [edit, setEdit] = useState(null), [limit, setLimit] = useState(50);
  useUnsavedChanges(selected.length > 0);
  const categories = useMemo(() => new Map(data.categories.map(c => [c.id, c])), [data.categories]);
  const duplicateIds = new Set(data.duplicateCandidates.flat());
  const target = categories.get(category);
  const visible = new Set(type ? data.visibility[type]?.product_ids : data.products.map(p => p.id));
  const products = data.products.filter(p => p.name.includes(search) && visible.has(p.id)
    && (!category || p.category_id === category || (descendants && target?.descendant_ids.includes(p.category_id)))
    && (activity === 'all' || (activity === 'active' ? p.is_active : !p.is_active)) && (!duplicates || duplicateIds.has(p.id)));
  function select(id) { setSelected(ids => ids.includes(id) ? ids.filter(v => v !== id) : ids.length < 100 ? [...ids, id] : ids); }
  const openProduct = product => setEdit({ kind: product ? 'edit' : 'create', id: product?.id, initial: {
    name: product?.name || '', category_id: product?.category_id || '', default_unit: product?.default_unit ?? '', default_price: product?.default_price ?? '', is_active: product?.is_active ?? true,
  } });
  return <section aria-label="ניהול מוצרים">
    <div className="shopping-admin-toolbar">
      <TextField label="חיפוש מוצר" value={search} onValueChange={setSearch} />
      <Select label="סינון קטגוריה" value={category} onValueChange={setCategory}><option value="">כל הקטגוריות</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.path.map(p => p.name).join(' / ')}</option>)}</Select>
      <Select label="סינון סוג רשימה" value={type} onValueChange={setType}><option value="">כל סוגי הרשימות</option>{data.listTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      <Select label="מצב מוצרים" value={activity} onValueChange={setActivity}><option value="active">פעילים</option><option value="inactive">לא פעילים</option><option value="all">הכול</option></Select>
    </div>
    <div className="shopping-admin-actions">
      <label><input type="checkbox" checked={descendants} onChange={e => setDescendants(e.target.checked)} />כולל תת־קטגוריות</label>
      <label><input type="checkbox" checked={duplicates} onChange={e => setDuplicates(e.target.checked)} />כפילויות לבדיקה ({data.duplicateCandidates.length} קבוצות)</label>
      <SecondaryButton onClick={() => setCategory(data.categories.find(c => c.is_neutral).id)}>ללא קטגוריה</SecondaryButton>
      <PrimaryButton onClick={() => openProduct(null)}>מוצר חדש</PrimaryButton>
    </div>
    {duplicates && <Alert>אלו הצעות לבדיקה בלבד. פתיחת מוצר אינה ממזגת, מוחקת או משנה את שמו.</Alert>}
    <div className="shopping-admin-bulk" role="region" aria-label="בחירה קבוצתית">
      <span aria-live="polite">נבחרו {selected.length} מתוך 100 · {products.length} תוצאות</span>
      <SecondaryButton disabled={!products.length} onClick={() => setSelected(products.slice(0, 100).map(p => p.id))}>בחירת עד 100 תוצאות</SecondaryButton>
      <SecondaryButton disabled={!selected.length} onClick={() => setSelected([])}>ניקוי בחירה</SecondaryButton>
      <PrimaryButton disabled={!selected.length} onClick={() => setEdit({ kind: 'bulk', initial: { category_id: '' }, ids: [...selected] })}>שיוך קבוצתי</PrimaryButton>
    </div>
    {selected.length === 100 && <p role="status">הגעתם למגבלת 100 מוצרים. בטלו בחירה כדי לבחור מוצר נוסף.</p>}
    <div className="shopping-admin-products">
      {products.slice(0, limit).map(p => <article key={p.id} className="shopping-admin-product" aria-label={p.name}>
        <input type="checkbox" aria-label={`בחירת ${p.name} (${p.id})`} checked={selected.includes(p.id)} disabled={selected.length >= 100 && !selected.includes(p.id)} onChange={() => select(p.id)} />
        <div><h3>{p.name}</h3><p className="shopping-admin-path">{categories.get(p.category_id)?.path.map(c => c.name).join(' / ')}</p><small>מזהה {p.id} · {p.is_active ? 'פעיל' : 'לא פעיל'}{duplicateIds.has(p.id) ? ' · מועמד לבדיקת כפילות' : ''}</small></div>
        <SecondaryButton onClick={() => openProduct(p)} aria-label={`עריכת מוצר ${p.id}`}>פרטים ועריכה</SecondaryButton>
        {p.is_active && <SecondaryButton onClick={() => setEdit({ kind: 'deactivate', id: p.id, initial: {} })} aria-label={`השבתת מוצר ${p.id}`}>השבתה</SecondaryButton>}
      </article>)}
    </div>
    {!products.length && <p role="status">אין מוצרים התואמים לסינון.</p>}
    {products.length > limit && <SecondaryButton onClick={() => setLimit(n => n + 50)}>הצגת 50 מוצרים נוספים</SecondaryButton>}
    {edit && <EditDialog key={`${edit.kind}-${edit.id}`} {...{ data, api, refresh }} id={edit.id} initial={edit.initial}
      title={edit.kind === 'bulk' ? `שיוך ${edit.ids.length} מוצרים` : edit.kind === 'deactivate' ? 'השבתת מוצר' : edit.kind === 'create' ? 'מוצר חדש' : 'עריכת מוצר'}
      onClose={() => setEdit(null)} operation={{ bulk: 'product.bulk-category', create: 'product.create', edit: 'product.edit', deactivate: 'product.deactivate' }[edit.kind]}
      onSaved={() => { if (edit.kind === 'bulk') setSelected([]); }}
      confirmation={['bulk', 'deactivate'].includes(edit.kind) ? `לאשר את השינוי ${api.mode === 'isolated' ? 'במסד המקומי' : 'בהדגמה'}? מזהי המוצרים וההיסטוריה יישמרו.` : undefined}
      body={values => {
        if (edit.kind === 'bulk') return { category_id: values.category_id, product_ids: edit.ids };
        if (edit.kind === 'deactivate') return {};
        const changed = edit.kind === 'edit' ? Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== edit.initial[key])) : values;
        return Object.fromEntries(Object.entries(changed).map(([key, value]) => [key, ['default_price', 'default_unit'].includes(key) && value === '' ? null : value]));
      }}>
      {(values, change, current) => <>
        {['create', 'edit'].includes(edit.kind) && <>
          <TextField label="שם המוצר" required value={values.name} onValueChange={v => change('name', v)} />
          <TextField label="יחידת ברירת מחדל" value={values.default_unit} onValueChange={v => change('default_unit', v)} />
          <TextField label="מחיר ברירת מחדל" inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" value={values.default_price} onValueChange={v => change('default_price', v)} helperText="ריק משמעו ללא מחיר. אפס נשמר כאפס." />
          <label><input type="checkbox" checked={values.is_active} onChange={e => change('is_active', e.target.checked)} />מוצר פעיל</label>
        </>}
        {edit.kind !== 'deactivate' && <CategorySelector categories={current.categories} value={values.category_id} onChange={v => change('category_id', v)} />}
        {edit.kind === 'bulk' && <p>כל המוצרים יעודכנו יחד, או שאף מוצר לא יעודכן. אין הצלחה חלקית.</p>}
        {edit.kind === 'deactivate' && <p>המוצר יוסתר מבחירות חדשות. מזהה המוצר והפניות קיימות יישמרו.</p>}
      </>}
    </EditDialog>}
  </section>;
}
