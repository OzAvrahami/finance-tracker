import { moneyText, priceBreakdown, scaled } from '../../../../shared/receiptPricing.mjs';
import { receiptMatchesPlan, receiptPlanningQuantity } from '../../../../shared/shoppingReceiptMatching.mjs';
import { receiptRowConflicts } from './receiptReviewLinks';

export function receiptIssues(rows, plan) {
  return rows.flatMap((row, index) => {
    const links = plan.filter(item => receiptMatchesPlan(row, item));
    const price = priceBreakdown(row);
    const conflicts = receiptRowConflicts(row);
    const source = price.row.raw_price;
    const gross = scaled(source.gross_total, 2);
    const discount = scaled(source.discount, 2);
    const quantityValid = scaled(String(row.quantity ?? ''), 3) > 0n;
    let kind, label, expected;
    if (price.source_mismatch || price.final === null && quantityValid) {
      kind = 'price';
      label = price.final === null ? 'סכום חסר' : 'פער מחיר';
      if (quantityValid && gross !== null && discount !== null && gross >= discount &&
        !conflicts.some(c => ['line_total', 'discount', 'quantity'].includes(c.field))) expected = moneyText(gross - discount);
    } else if (!quantityValid || !row.unit?.trim() || !row.name?.trim() || conflicts.length || row.overlap_uncertain) {
      kind = 'source';
      label = conflicts.length ? 'קריאות מקור סותרות' : row.overlap_uncertain ? 'חפיפה לא ודאית' : 'פרטי שורה חסרים';
    } else if (!row.review_link?.confirmed && links.some(item => item.status === 'unresolved')) {
      kind = 'match'; label = 'התאמה או יחידות לבדיקה';
    } else if (!row.review_link && !row.mapping_snapshot && row.match_requires_review && links.length) {
      kind = 'match'; label = 'שיוך לבדיקה';
    } else if (!row.review_link && !links.length && row.match_requires_review && row.possible_substitutions?.length) {
      kind = 'substitution'; label = 'תחליף אפשרי';
    } else return [];
    const target = links.length === 1 ? links[0] : null;
    const unitReview = kind === 'match' && target?.list_item_id != null &&
      receiptPlanningQuantity(row, target) === null &&
      rows.filter(other => receiptMatchesPlan(other, target)).length === 1;
    return [{ id: row.row_id ?? index, row, index, kind, label, expected, links, conflicts, price, unitReview }];
  });
}
