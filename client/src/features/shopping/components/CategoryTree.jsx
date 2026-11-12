import { useMemo, useRef, useState } from 'react';

// Display-only flattening of server supplied ancestry. No domain validation here.
function visibleTreeRows(categories, expanded, search = '', filter = 'active') {
  return categories.filter(c => (filter === 'all' || (filter === 'historical' ? c.historical : filter === 'inactive' ? !c.effective_active : c.effective_active))
    && (search ? c.path.some(p => p.name.includes(search)) : ['inactive', 'historical'].includes(filter) || c.ancestor_ids.every(id => expanded.has(id))));
}

export default function CategoryTree({ categories, selected, onSelect, search, filter }) {
  const [expanded, setExpanded] = useState(new Set());
  const [limit, setLimit] = useState(100);
  const [focused, setFocused] = useState(null);
  const container = useRef(null);
  const rows = useMemo(() => visibleTreeRows(categories, expanded, search, filter), [categories, expanded, search, filter]);
  const flatResults = Boolean(search) || ['inactive', 'historical'].includes(filter);
  const renderedIds = new Set(rows.slice(0, limit).map(c => c.id));
  const toggle = id => setExpanded(previous => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; });
  function keyDown(event, node, index) {
    const controls = [...container.current.querySelectorAll('[role="treeitem"]')];
    let target;
    if (event.key === 'ArrowDown') target = controls[index + 1];
    else if (event.key === 'ArrowUp') target = controls[index - 1];
    else if (event.key === 'Home') target = controls[0];
    else if (event.key === 'End') target = controls.at(-1);
    else if (event.key === 'ArrowLeft') {
      if (flatResults) target = controls.find(c => node.child_ids.includes(c.dataset.id));
      else if (node.child_ids.length && !expanded.has(node.id)) toggle(node.id);
      else if (node.child_ids.length) target = controls[index + 1];
    } else if (event.key === 'ArrowRight') {
      if (!flatResults && expanded.has(node.id)) toggle(node.id);
      else target = controls.find(c => c.dataset.id === node.parent_id);
    } else return;
    event.preventDefault(); target?.focus();
  }
  return <div>
    <div ref={container} role="tree" aria-label="עץ קטגוריות" className="shopping-admin-tree">
      {rows.slice(0, limit).map((c, index) => <div key={c.id} className="shopping-admin-tree-row" style={{ paddingInlineStart: `${Math.min(c.ancestor_ids.length, 10) * 14}px` }}>
        {!flatResults && c.child_ids.length > 0 && <button type="button" tabIndex={-1} aria-label={`${expanded.has(c.id) ? 'כיווץ' : 'הרחבת'} ${c.name}`} onClick={() => toggle(c.id)}>{expanded.has(c.id) ? '−' : '+'}</button>}
        <button role="treeitem" data-id={c.id} aria-level={c.ancestor_ids.length + 1} aria-selected={selected === c.id}
          aria-expanded={c.child_ids.length ? (flatResults ? c.child_ids.some(id => renderedIds.has(id)) : expanded.has(c.id)) : undefined} tabIndex={(focused || selected) === c.id || (!renderedIds.has(focused || selected) && index === 0) ? 0 : -1}
          onFocus={() => setFocused(c.id)}
          onKeyDown={event => keyDown(event, c, index)} onClick={() => onSelect(c.id)} title={c.path.map(p => p.name).join(' / ')}>
          <span>{c.name}</span><small>{c.is_neutral ? 'מוגנת' : !c.effective_active ? 'לא פעילה' : `${c.direct_count} מוצרים`}</small>
        </button>
      </div>)}
    </div>
    {!rows.length && <p role="status">אין קטגוריות התואמות לסינון.</p>}
    {rows.length > limit && <button type="button" onClick={() => setLimit(n => n + 100)}>הצגת 100 קטגוריות נוספות</button>}
  </div>;
}
