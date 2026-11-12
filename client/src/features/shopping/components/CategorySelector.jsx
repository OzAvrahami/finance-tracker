import { useState } from 'react';
import { Select, TextField } from '../../../components/ui';

export default function CategorySelector({ categories, value, onChange, label = 'קטגוריית יעד', root = false, excluded = [], neutral = true, disabled = false, activeOnly = true }) {
  const [search, setSearch] = useState('');
  const options = categories.filter(c => !excluded.includes(c.id) && (neutral || !c.is_neutral) && (!activeOnly || c.effective_active || c.id === value));
  const filtered = options.filter(c => c.id === value || c.path.map(p => p.name).join(' / ').includes(search));
  return <div className="shopping-admin-selector">
    <TextField label={`חיפוש עבור ${label}`} value={search} onValueChange={setSearch} disabled={disabled} />
    <Select label={label} value={value ?? ''} onValueChange={id => onChange(id || null)} disabled={disabled} required={!root}>
      <option value="">{root ? 'ברמת השורש' : 'בחירת קטגוריה'}</option>
      {filtered.map(c => <option key={c.id} value={c.id}>{c.path.map(p => p.name).join(' / ')}{c.effective_active ? '' : ' (לא פעילה)'}</option>)}
    </Select>
  </div>;
}
