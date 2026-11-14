'use strict';
const { fromMinorUnits } = require('../../utils/money');
const { fail, date, storedMinor } = require('./normalization');

const protectedMessage = 'לתנועה זו יש היסטוריה מוגנת. יש לתקן דרך מסך ההלוואה, החיסכון, הקנייה או התקציב המקושר; להחזר חדש יש ליצור הוצאה נפרדת בסכום שלילי.';
const isNegative = value => /^-/.test(String(value).trim());

// Only called for an authenticated owner command. Never infer external intent.
function manualRow(input) {
  const row = { ...input }; delete row.bank_movement;
  const amount = storedMinor(row.total_amount);
  if (!isNegative(row.total_amount)) return row;
  if (amount == null || amount >= 0n || !/^-\d{1,28}\.\d{2}$/.test(fromMinorUnits(amount))) fail('invalid_accounting_amount');
  if (row.movement_type !== 'expense') fail('סכום שלילי מותר רק להוצאה המייצגת זיכוי, ולא להכנסה.');
  if (row.loan_id || String(row.category_id) === '24' || row.parent_transaction_id || row.installment_number != null
    || Number(row.installment_count || 1) > 1 || row.installments_info || Number(row.global_discount || 0) !== 0) fail(protectedMessage);
  date(row.transaction_date); if (row.charge_date) date(row.charge_date);
  return { ...row, total_amount: fromMinorUnits(amount), bank_movement: 'refund',
    installment_count: null, installment_number: null, installments_info: null };
}

function assertRequest(body) {
  if (!isNegative(body.transaction?.total_amount)) return;
  if (body.items?.length || body.loan_handling || body.savings_handling) fail(protectedMessage);
  manualRow(body.transaction);
}

function decideEdit(facts, scope) {
  const { protectedCash, capturedCash } = require('./reconciliation');
  const { sameId } = require('./policy');
  const old = facts.transactions.find(t => sameId(t.id, scope.command.transaction_id));
  if (!old) fail('transaction_not_found');
  // FX provenance is ordinary owner data, not a linked domain. Retain it;
  // protected histories/items/series still use the existing guarded workflow.
  const domainProtected = protectedCash({ ...old, currency: 'ILS', original_amount: null, exchange_rate: null });
  if (old.voided_at || domainProtected || capturedCash(old) || String(old.category_id) === '24') fail(protectedMessage);
  const row = manualRow(scope.command.transaction);
  if (row.bank_movement !== 'refund') fail('invalid_accounting_amount');
  if (!facts.payments.some(p => sameId(p.id, row.payment_source_id) && p.is_active)) fail('payment_source_not_found');
  if (row.category_id != null && !facts.categories.some(c => sameId(c.id, row.category_id) && c.is_active
    && c.type === 'expense' && c.savings_role == null)) fail('invalid_category');
  return { action: 'owner_refund_edit', transaction: row, transaction_id: String(old.id) };
}

module.exports = { manualRow, assertRequest, decideEdit, isNegative, protectedMessage };
