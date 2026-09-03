const { randomUUID } = require('node:crypto');

const callBudgetRpc = async (supabase, name, params) => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
};

const requestKey = (value) => value || randomUUID();

const getFundedBudgetMonth = (supabase, month) => (
  callBudgetRpc(supabase, 'get_funded_budget_month', { p_month: month })
);

const addManualFunding = (supabase, {
  month,
  amount,
  sourceLabel,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'add_manual_budget_funding', {
  p_month: month,
  p_amount: amount,
  p_source_label: sourceLabel,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const establishBudget = (supabase, {
  month,
  categoryId,
  startingAmount,
  startingKind = 'manual',
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'establish_funded_budget', {
  p_month: month,
  p_category_id: categoryId,
  p_starting_amount: startingAmount,
  p_starting_kind: startingKind,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const setBudgetAmount = (supabase, {
  budgetId,
  targetAmount,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'set_funded_budget_amount', {
  p_budget_id: budgetId,
  p_target_amount: targetAmount,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const removeBudget = (supabase, {
  budgetId,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'remove_funded_budget', {
  p_budget_id: budgetId,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const reactivateBudget = (supabase, {
  budgetId,
  additionalAmount = '0.00',
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'reactivate_funded_budget', {
  p_budget_id: budgetId,
  p_additional_amount: additionalAmount,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const reverseOperation = (supabase, {
  operationId,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'reverse_funded_budget_operation', {
  p_operation_id: operationId,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const copyBudgetMonth = (supabase, {
  fromMonth,
  toMonth,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'copy_funded_budget_month', {
  p_from_month: fromMonth,
  p_to_month: toMonth,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const initializeRecurringBudgets = (supabase, {
  month,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'initialize_budget_recurring_defaults', {
  p_month: month,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const setMonthOverride = (supabase, {
  month,
  categoryId,
  amount,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'set_budget_month_override', {
  p_month: month,
  p_category_id: categoryId,
  p_amount: amount,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const removeMonthOverride = (supabase, {
  month,
  categoryId,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'remove_budget_month_override', {
  p_month: month,
  p_category_id: categoryId,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const getCarryoverPreview = async (supabase, month) => {
  const state = await getFundedBudgetMonth(supabase, month);
  return state?.carryover || null;
};

const applyCarryover = (supabase, {
  destinationMonth,
  previewFingerprint,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'apply_budget_carryover', {
  p_destination_month: destinationMonth,
  p_request_key: requestKey(suppliedRequestKey),
  p_preview_fingerprint: previewFingerprint,
  p_reason: reason,
});

const reverseCarryover = (supabase, {
  transferId,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'reverse_budget_carryover', {
  p_transfer_id: transferId,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const getMonthDispositionPreview = (supabase, sourceMonth) => (
  callBudgetRpc(supabase, 'get_budget_month_disposition_preview', { p_source_month: sourceMonth })
);

const applyMonthDisposition = (supabase, {
  sourceMonth,
  previewFingerprint,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'apply_budget_month_disposition', {
  p_source_month: sourceMonth,
  p_request_key: requestKey(suppliedRequestKey),
  p_preview_fingerprint: previewFingerprint,
  p_reason: reason,
});

const reverseMonthDisposition = (supabase, {
  batchId,
  requestKey: suppliedRequestKey,
  reason = null,
}) => callBudgetRpc(supabase, 'reverse_budget_month_disposition', {
  p_batch_id: batchId,
  p_request_key: requestKey(suppliedRequestKey),
  p_reason: reason,
});

const toCompatibilityRows = (state) => (state?.categories || [])
  .filter((category) => category.budget_id && category.lifecycle_state === 'active')
  .map((category) => ({
    id: category.budget_id,
    category_id: category.category_id,
    month: state.month,
    amount: category.final_funded,
    starting_amount: category.starting_amount,
    starting_kind: category.starting_kind,
    adjustment_total: category.adjustment_total,
    fallback_base: category.fallback_base,
    fallback_source: category.fallback_source,
    recurring_default: category.recurring_default,
    month_override: category.month_override,
    override_adjustment_total: category.override_adjustment_total,
    effective_base: category.effective_base,
    incoming_carryover: category.incoming_carryover,
    outgoing_carryover: category.outgoing_carryover,
    other_adjustments: category.other_adjustments,
    actual_spent: category.actual_spent,
    remaining: category.remaining,
    deficit: category.deficit,
    lifecycle_state: category.lifecycle_state,
    categories: category.categories,
  }));

module.exports = {
  addManualFunding,
  applyMonthDisposition,
  applyCarryover,
  copyBudgetMonth,
  establishBudget,
  getCarryoverPreview,
  getMonthDispositionPreview,
  getFundedBudgetMonth,
  initializeRecurringBudgets,
  reactivateBudget,
  removeMonthOverride,
  removeBudget,
  reverseCarryover,
  reverseMonthDisposition,
  reverseOperation,
  setBudgetAmount,
  setMonthOverride,
  toCompatibilityRows,
};
