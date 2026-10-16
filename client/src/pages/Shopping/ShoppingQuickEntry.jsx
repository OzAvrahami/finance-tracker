import { useEffect, useRef, useState } from 'react';
import { Alert, GlassCard, IconButton, NumberField, PrimaryButton, SecondaryButton, TextField } from '../../components/ui';
import { addShoppingListItem, getShoppingCatalogCategories, getShoppingCatalogItems } from '../../services/api';
import ShoppingUnitSelect from './ShoppingUnitSelect';
import ShoppingCategoryInput from './ShoppingCategoryInput';
import { defaultPlanningUnit, planningUnit, planningUnitLabel, stepPlanningQuantity, categoryDisplayName } from '../../../../shared/shoppingEntryOptions.mjs';

const blank = () => ({ name: '', quantity: '1', unit: defaultPlanningUnit, price: '', notes: '', category: '', categoryId: '', reusable: true });

export default function ShoppingQuickEntry({ list, onAdded, inputRef }) {
  const [form, setForm] = useState(blank);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoryState, setCategoryState] = useState('loading');
  const [suggestions, setSuggestions] = useState([]);
  const [searchState, setSearchState] = useState('idle');
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(-1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const edits = useRef(new Set());
  const queryVersion = useRef(0);
  const name = form.name.trim();
  const visible = expanded && !!name;
  const update = (key, value) => {
    edits.current.add(key);
    if (key === 'name') {
      ++queryVersion.current; // invalidate immediately, before the next effect/debounce
      setSuggestions([]); setActive(-1); setSearchState('idle'); setExpanded(true);
    }
    setForm(current => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    let alive = true;
    getShoppingCatalogCategories(list.list_type_id).then(({ data }) => {
      if (alive) {
        setCategories(current => [...new Map([...(Array.isArray(data) ? data : []),...current].map(c=>[String(c.id),c])).values()]);
        setCategoryState('ready');
      }
    }).catch(() => { if (alive) setCategoryState('failed'); });
    return () => { alive = false; };
  }, [list.list_type_id]);

  useEffect(() => {
    const version = ++queryVersion.current;
    if (!name || !expanded) return;
    let alive = true;
    const timer = setTimeout(async () => {
      setSearchState('loading');
      try {
        const { data } = await getShoppingCatalogItems({ search: name, list_type_id: list.list_type_id, limit: 8 });
        if (alive && version === queryVersion.current) {
          setSuggestions(Array.isArray(data) ? data.slice(0,8) : []); setActive(-1); setSearchState('ready');
        }
      } catch {
        if (alive && version === queryVersion.current) { setSuggestions([]); setSearchState('failed'); }
      }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [name, list.list_type_id, expanded]);

  useEffect(() => {
    if (visible && active >= 0) document.getElementById(`shopping-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, visible]);

  function choose(item) {
    ++queryVersion.current;
    setSelected(item);
    setForm(current => ({
      ...current,
      // Complete a prefix, but never remove extra words/requirements the owner typed.
      name: item && item.name.toLocaleLowerCase().startsWith(current.name.trim().toLocaleLowerCase()) ? item.name : current.name,
      category: item ? item.shopping_catalog_categories?.name || categories.find(c => String(c.id)===String(item.category_id))?.name || '' : current.category,
      categoryId: item ? String(item.category_id) : current.categoryId,
      unit: item && !edits.current.has('unit') ? planningUnit(item.default_unit) : current.unit,
      price: item && !edits.current.has('price') ? item.default_price ?? '' : current.price,
    }));
    setExpanded(false); setActive(-1); inputRef.current?.focus();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); setActive(-1); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setExpanded(true);
      const count = suggestions.length + 1;
      setActive(index => event.key === 'ArrowDown' ? (index + 1) % count : (index <= 0 ? count - 1 : index - 1));
    }
    if (event.key === 'Enter' && visible && active >= 0) {
      event.preventDefault(); choose(suggestions[active] || null);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    if (!name || !Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0) {
      setError('יש להזין שם וכמות חיובית.'); return;
    }
    busy.current = true; setPending(true); setError(''); setExpanded(false);
    try {
      const { data: saved } = await addShoppingListItem(list.id, {
        entry_mode: 'name_first', catalog_item_id: selected?.id ?? null,
        custom_name: selected ? null : name,
        planned_name: selected && name !== selected.name ? name : null,
        category_id: selected ? null : form.categoryId || null,
        category_name: selected ? null : categoryDisplayName(form.category) || null,
        quantity: form.quantity, unit: form.unit, unit_mode: 'controlled',
        price: form.price === '' ? null : form.price, notes: form.notes.trim() || null,
        save_to_catalog: !selected && form.reusable,
      });
      if (saved?.shopping_catalog_categories) {
        const canonical = saved.shopping_catalog_categories;
        setCategories(current => [...current.filter(c => String(c.id)!==String(canonical.id)),canonical].sort((a,b)=>a.name.localeCompare(b.name,'he')));
      }
      setForm(blank()); setSelected(null); setDetails(false); setSuggestions([]); edits.current.clear();
      await onAdded();
    } catch (failure) {
      setError(failure.response?.data?.error || 'הפריט לא נוסף. הפרטים נשמרו; אפשר לנסות שוב.');
    } finally {
      busy.current = false; setPending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return <GlassCard className="shopping-quick-entry" padding="var(--ft-space-6)">
    <form onSubmit={submit} aria-label="הוספת פריט לרשימה">
      <div className="shopping-quick-row">
        <div className="shopping-name-entry" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) { setExpanded(false); setActive(-1); }
        }}>
          <TextField ref={inputRef} label="מה צריך לקנות?" role="combobox" autoComplete="off"
            dir={form.name ? 'auto' : 'rtl'} style={{ textAlign: form.name ? 'start' : 'right' }}
            aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? 'shopping-name-options' : undefined}
            aria-activedescendant={visible && active >= 0 ? `shopping-option-${active}` : undefined}
            value={form.name} maxLength={300} onValueChange={v => update('name',v)} onKeyDown={onKeyDown}
            onFocus={() => setExpanded(true)} disabled={pending} required placeholder="חלב, מטען, מתנה…" />
          {visible && <div className="shopping-suggestion-popup">
            {searchState === 'loading' && <p role="status">מחפש פריטים שמורים…</p>}
            {searchState === 'failed' && <p role="status">ההצעות אינן זמינות. אפשר להוסיף את השם כפריט חדש.</p>}
            <ul id="shopping-name-options" role="listbox" aria-label="הצעות לפריט">
              {suggestions.map((item,index) => <li key={item.id} role="option" id={`shopping-option-${index}`}
                aria-label={`${item.name} · ${item.shopping_catalog_categories?.name || 'פריט שמור'}${item.default_unit ? ` · ${planningUnitLabel(item.default_unit)}` : ''}`}
                aria-selected={active === index} onMouseDown={e => e.preventDefault()} onClick={() => choose(item)}>
                <strong dir="auto">{item.name}</strong><small>{item.shopping_catalog_categories?.name || 'פריט שמור'}{item.default_unit ? ` · ${planningUnitLabel(item.default_unit)}` : ''}</small>
              </li>)}
              <li role="option" id={`shopping-option-${suggestions.length}`} aria-selected={active === suggestions.length}
                className="shopping-new-option" onMouseDown={e => e.preventDefault()} onClick={() => choose(null)}>
                הוספת “{name}” כפריט חדש
              </li>
            </ul>
          </div>}
        </div>
        <div className="shopping-quick-quantity">
          <IconButton type="button" size="touch" aria-label="הקטנת כמות" disabled={pending || stepPlanningQuantity(form.quantity,-1)===null}
            onClick={() => update('quantity',stepPlanningQuantity(form.quantity,-1))}>−</IconButton>
          <NumberField label="כמות" min="0.001" max="10000" step="0.001" value={form.quantity}
            onValueChange={v => update('quantity',v)} disabled={pending} required />
          <IconButton type="button" size="touch" aria-label="הגדלת כמות" disabled={pending || stepPlanningQuantity(form.quantity,1)===null}
            onClick={() => update('quantity',stepPlanningQuantity(form.quantity,1))}>+</IconButton>
          <ShoppingUnitSelect className="shopping-unit-select" value={form.unit} disabled={pending} onValueChange={v => update('unit',v)}/>
        </div>
        <PrimaryButton type="submit" loading={pending}>הוספה</PrimaryButton>
      </div>
      {selected && <p className="shopping-selected-identity">פריט שמור: <bdi>{selected.name}</bdi> · השינויים כאן הם לרשימה זו בלבד.
        <SecondaryButton type="button" disabled={pending} onClick={() => choose(null)}>הוספה כפריט חדש במקום</SecondaryButton></p>}
      <SecondaryButton type="button" className="shopping-details-toggle" aria-expanded={details} aria-controls="shopping-entry-details"
        disabled={pending} onClick={() => setDetails(!details)}>פרטים נוספים {details ? '⌃' : '⌄'}</SecondaryButton>
      {details && <div id="shopping-entry-details" className="shopping-entry-details">
        <ShoppingCategoryInput value={form.category} categoryId={form.categoryId} categories={categories}
          loading={categoryState==='loading'} failed={categoryState==='failed'} derived={!!selected} disabled={pending || !!selected}
          onChange={(category,categoryId) => setForm(current=>({...current,category,categoryId}))}/>
        <NumberField label="מחיר משוער ליחידה" min="0" max="100000000" step="0.01" prefix="₪" value={form.price}
          disabled={pending} onValueChange={v => update('price',v)} />
        <TextField label="הערות והעדפות" dir={form.notes ? 'auto' : 'rtl'} style={{ textAlign: form.notes ? 'start' : 'right' }}
          value={form.notes} maxLength={2000} disabled={pending}
          placeholder="העדפות או פרטים שחשוב לזכור…" onValueChange={v => update('notes',v)} />
        {!selected && <label className="shopping-reuse-choice"><input type="checkbox" checked={form.reusable} disabled={pending}
          onChange={e => update('reusable',e.target.checked)} />להציע את הפריט גם ברשימות הבאות</label>}
      </div>}
      {error && <Alert variant="error" urgent>{error}</Alert>}
    </form>
  </GlassCard>;
}
