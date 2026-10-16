import { useEffect, useId, useRef, useState } from 'react';
import { TextField } from '../../components/ui';
import { categoryDisplayName, categoryNameKey, categoryNameLimit } from '../../../../shared/shoppingEntryOptions.mjs';

export default function ShoppingCategoryInput({ value, categoryId, onChange, categories, loading, failed, disabled, derived = false }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const input = useRef(null), id = useId();
  const key = categoryNameKey(value), display = categoryDisplayName(value);
  const options = categories.filter(c => categoryNameKey(c.name).includes(key));
  const exact = categories.some(c => categoryNameKey(c.name) === key);
  const expanded = open && !disabled;
  useEffect(() => {
    if (expanded && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({block:'nearest'});
  }, [active, expanded, id]);
  const select = option => { onChange(option.name,String(option.id)); setOpen(false); setActive(-1); input.current?.focus(); };
  const close = () => { setOpen(false); setActive(-1); };
  return <div className="shopping-category-entry" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <TextField ref={input} label="קטגוריה" role="combobox" dir="auto" value={value} maxLength={categoryNameLimit}
      disabled={disabled} placeholder="ללא קטגוריה" autoComplete="off" aria-autocomplete="list"
      aria-expanded={expanded} aria-controls={expanded ? id : undefined}
      aria-activedescendant={expanded && active >= 0 && options[active] ? `${id}-${active}` : undefined}
      helperText={derived ? 'הקטגוריה נגזרת מהפריט השמור; זהותו אינה משתנה.' : 'רשות — בחרו קטגוריה או כתבו שם חדש.'}
      onFocus={() => { setOpen(true); setActive(-1); }}
      onValueChange={text => { onChange(text,''); setOpen(true); setActive(-1); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab') close();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          if (options.length) setActive(index => event.key === 'ArrowDown' ? (index+1)%options.length : index<=0 ? options.length-1 : index-1);
        }
        if (event.key === 'Enter' && expanded && options[active]) { event.preventDefault(); select(options[active]); }
      }} />
    {expanded && <div className="shopping-suggestion-popup">
      {loading && <p role="status">טוען קטגוריות…</p>}
      <ul id={id} role="listbox" aria-label="הצעות לקטגוריה">
        {options.map((option,index) => <li key={option.id} id={`${id}-${index}`} role="option" dir="auto"
          aria-selected={String(option.id)===String(categoryId)} className={active===index ? 'is-active' : ''}
          onPointerDown={e => e.preventDefault()}
          onMouseDown={e => e.preventDefault()} onClick={() => select(option)}>{option.name}</li>)}
      </ul>
    </div>}
    {!derived && display && !categoryId && !exact && !loading && !failed &&
      <p className="shopping-category-pending" role="status">קטגוריה חדשה תיווצר בהוספה: <bdi>{display}</bdi></p>}
    {!derived && failed && <p role="status">טעינת ההצעות נכשלה. הקטגוריה תיבדק לפי השם בעת ההוספה{display ? `: ${display}` : ''}; אם אינה קיימת, תיווצר קטגוריה חדשה.</p>}
  </div>;
}
