import { receiptMatchesPlan, receiptMatchSuggested } from '../../../../shared/shoppingReceiptMatching.mjs';

const token = value => String(value ?? '').normalize('NFKC').toLowerCase().trim();

export function receiptRowConflicts(row) {
  const edited = row.owner_edited_fields ?? [];
  return (row.field_conflicts ?? []).filter(({ field }) => {
    if (['discount', 'line_total', 'price'].includes(field) && edited.includes('price')) return false;
    if (field === 'discount' && edited.includes('row_discount')) return false;
    if (['price', 'line_total'].includes(field) &&
      (edited.includes('original_unit_price') || edited.includes('reviewed_line_total'))) return false;
    return !edited.includes(field);
  });
}

export function receiptRowMatchesSearch(row, index, query) {
  const search = token(query);
  return [row.name, row.original_name, row.lookup_code, row.product_code, index + 1]
    .some(value => token(value).includes(search));
}

export function receiptReplacementOptions(rows, item, query, adding = false) {
  const suggested = [], available = [];
  rows.forEach((row, index) => {
    if (row.review_link?.confirmed || (adding && receiptMatchesPlan(row, item)) || !receiptRowMatchesSearch(row, index, query)) return;
    const options = receiptMatchSuggested(row, item) ? suggested : available;
    options.push({ row, index });
  });
  return { suggested, available };
}

export function changeReceiptLink(rows, plan, index, planId, listId, keepMatches = false) {
  const chosen = rows[index];
  const target = planId == null ? null : plan.find(item => String(item.list_item_id) === String(planId));
  if (!chosen || chosen.review_link?.confirmed || (planId != null && !target)) return rows;
  const link = id => ({ list_id: String(listId), list_item_id: id, confirmed: false });
  return rows.map((row, i) => {
    if (i === index) return { ...row, review_link: link(target ? String(target.list_item_id) : null) };
    if (!keepMatches && !row.review_link?.confirmed && target && receiptMatchesPlan(row, target)) return { ...row, review_link: link(null) };
    return row;
  });
}

export function confirmReceiptLink(rows, item, confirmed, listId, index) {
  const match = rows[index];
  if (item.list_item_id == null || !match || !receiptMatchesPlan(match, item)) return rows;
  return rows.map((row, i) => i === index ? {
    ...row,
    review_link: { list_id: String(listId), list_item_id: String(item.list_item_id), confirmed },
  } : row);
}
