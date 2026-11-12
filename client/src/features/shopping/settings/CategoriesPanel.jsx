import { useState } from 'react';
import { PrimaryButton, SecondaryButton, Select, TextField } from '../../../components/ui';
import CategoryTree from '../components/CategoryTree';
import CategorySelector from '../components/CategorySelector';
import EditDialog from '../components/EditDialog';

export default function CategoriesPanel({ data, api, refresh }) {
  const [selected, setSelected] = useState(null), [search, setSearch] = useState(''), [filter, setFilter] = useState('active'), [edit, setEdit] = useState(null);
  const node = data.categories.find(c => c.id === selected);
  const create = parent => setEdit({ type: 'create', initial: { name: '', parent_id: parent, ...(api.mode === 'isolated' ? { icon:'', list_type_id:'' } : {}) } });
  return <section aria-label="ניהול קטגוריות">
    <div className="shopping-admin-toolbar">
      <TextField label="חיפוש קטגוריה או נתיב" value={search} onValueChange={setSearch} />
      <Select label="מצב קטגוריות" value={filter} onValueChange={setFilter}>
        <option value="active">פעילות</option><option value="all">הכול</option><option value="inactive">לא פעילות</option><option value="historical">היסטוריות</option>
      </Select>
      <PrimaryButton onClick={() => create(null)}>קטגוריה חדשה</PrimaryButton>
    </div>
    <div className="shopping-admin-columns">
      <CategoryTree categories={data.categories} selected={selected} onSelect={setSelected} search={search} filter={filter} />
      <aside className="shopping-admin-detail" aria-label="פרטי קטגוריה">
        {node ? <><h2>{node.name}</h2><p className="shopping-admin-path">{node.path.map(p => p.name).join(' / ')}</p>
          <dl><dt>מזהה קבוע</dt><dd>{node.id}</dd><dt>מוצרים פעילים ישירות</dt><dd>{node.direct_count}</dd><dt>מוצרים פעילים בענף (כולל קטגוריות מוסתרות)</dt><dd>{node.subtree_count}</dd><dt>זמינות לבחירה</dt><dd>{node.effective_active ? 'פעילה' : 'לא פעילה — הקטגוריה או אחד מאבותיה מושבתים'}</dd></dl>
          {node.is_neutral ? <p>קטגוריה ניטרלית מוגנת. זמינה תמיד; לא ניתן לערוך, להעביר או להשבית אותה.</p> : <div className="shopping-admin-actions">
            {api.mode === 'isolated' && <SecondaryButton onClick={() => setEdit({ type:'edit',id:node.id,initial:{name:node.name,icon:node.icon??'',parent_id:node.parent_id,is_active:node.is_active,display_order:node.display_order??0} })}>עריכת פרטי קטגוריה</SecondaryButton>}
            <SecondaryButton disabled={!node.effective_active} onClick={() => create(node.id)}>הוספת תת־קטגוריה</SecondaryButton>
            <SecondaryButton onClick={() => setEdit({ type: 'rename', id: node.id, initial: { name: node.name } })}>שינוי שם</SecondaryButton>
            <SecondaryButton onClick={() => setEdit({ type: 'reparent', id: node.id, initial: { parent_id: node.parent_id } })}>העברה להורה אחר</SecondaryButton>
            <SecondaryButton onClick={() => setEdit({ type: node.is_active ? 'deactivate' : 'activate', id: node.id, initial: {} })}>{node.is_active ? 'השבתת קטגוריה' : 'הפעלת קטגוריה'}</SecondaryButton>
          </div>}
          <p>היסטוריה ומזהים נשמרים. השבתת הורה מסתירה את הענף מבחירות חדשות, בלי לשנות את דגלי הילדים או רשימות קיימות.</p>
        </> : <p>בחרו קטגוריה להצגת הנתיב, המוצרים ואפשרויות העריכה.</p>}
      </aside>
    </div>
    {edit && <EditDialog key={`${edit.type}-${edit.id}`} title={{ edit:'עריכת פרטי קטגוריה', create: 'קטגוריה חדשה', rename: 'שינוי שם קטגוריה', reparent: 'העברת קטגוריה', activate: 'הפעלת קטגוריה', deactivate: 'השבתת קטגוריה' }[edit.type]}
      {...{ data, api, refresh }} id={edit.id} initial={edit.initial} onClose={() => setEdit(null)}
      operation={edit.type === 'create' ? 'category.create' : edit.type === 'edit' ? 'category.edit' : 'category.change'} body={values => {
        if(edit.type === 'edit')return Object.fromEntries(Object.entries(values).filter(([key,value])=>value!==edit.initial[key]).map(([key,value])=>[key,key==='icon'&&value===''?null:value]));
        if(edit.type === 'create')return Object.fromEntries(Object.entries(values).filter(([key,value])=>key!=='list_type_id'||value!==''));
        return {type:edit.type,...values};
      }}
      confirmation={edit.type === 'deactivate' ? 'להשבית את הקטגוריה ולהסתיר את הענף מבחירות חדשות? הרשומות ההיסטוריות יישמרו.' : undefined}>
      {(values, change, current) => <>
        {['create', 'rename','edit'].includes(edit.type) && <TextField label="שם הקטגוריה" required value={values.name} onValueChange={v => change('name', v)} />}
        {api.mode === 'isolated' && ['create','edit'].includes(edit.type) && <TextField label="סמל הקטגוריה" value={values.icon} onValueChange={v=>change('icon',v)} />}
        {edit.type === 'edit' && <><TextField label="סדר תצוגה" type="number" required value={values.display_order} onValueChange={v=>change('display_order',Number(v))}/><label><input type="checkbox" checked={values.is_active} onChange={e=>change('is_active',e.target.checked)}/>קטגוריה פעילה</label></>}
        {api.mode === 'isolated' && edit.type === 'create' && <Select label="שיוך ראשוני לסוג רשימה (רשות)" value={values.list_type_id} onValueChange={v=>change('list_type_id',v)}><option value="">ללא שיוך ראשוני</option>{current.listTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        {['create', 'reparent','edit'].includes(edit.type) && <CategorySelector categories={current.categories} value={values.parent_id} onChange={v => change('parent_id', v)} label="קטגוריית הורה" root neutral={false}
          excluded={edit.id ? [edit.id, ...(current.categories.find(c => c.id === edit.id)?.descendant_ids || [])] : []} />}
        {['activate', 'deactivate'].includes(edit.type) && <p>הפעולה משנה זמינות בלבד. אין מחיקה של קטגוריות או מוצרים.</p>}
      </>}
    </EditDialog>}
  </section>;
}
