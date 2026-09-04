const express = require('express');
const router = express.Router();
const {
  getBudgetsByMonth,
  getFundedBudgetMonth,
  getBudgetHistory,
  getAnnualSummary,
  getMonthlyCategoryBreakdown,
  addManualFunding,
  establishBudget,
  adjustBudget,
  removeBudget,
  reactivateBudget,
  reverseOperation,
  initializeRecurringBudgets,
  setMonthOverride,
  removeMonthOverride,
  reverseCarryover,
  getMonthDispositionPreview,
  applyMonthDisposition,
  reverseMonthDisposition,
  getBudgetReallocationPreview,
  applyBudgetReallocation,
  getDeficitResolutionPreview,
  applyDeficitResolution,
  reverseBudgetFundingAction,
  getUnbudgetedResolutionPreview,
  applyUnbudgetedResolution,
  reverseUnbudgetedResolution,
  upsertBudget,
  copyBudget,
  deleteBudget
} = require('../controllers/budgetController');

router.get('/annual-summary', getAnnualSummary);
router.get('/monthly-category-breakdown', getMonthlyCategoryBreakdown);
router.get('/funded/history', getBudgetHistory);
router.get('/funded', getFundedBudgetMonth);
router.post('/funded/funding', addManualFunding);
router.post('/funded/recurring/initialize', initializeRecurringBudgets);
router.put('/funded/months/:month/categories/:categoryId/override', setMonthOverride);
router.post('/funded/months/:month/categories/:categoryId/override/remove', removeMonthOverride);
router.get('/funded/month-close/preview', getMonthDispositionPreview);
router.post('/funded/month-close/apply', applyMonthDisposition);
router.post('/funded/month-close/batches/:id/reverse', reverseMonthDisposition);
router.post('/funded/months/:month/reallocations/preview', getBudgetReallocationPreview);
router.post('/funded/months/:month/reallocations', applyBudgetReallocation);
router.post('/funded/months/:month/categories/:categoryId/deficit-resolution/preview', getDeficitResolutionPreview);
router.post('/funded/months/:month/categories/:categoryId/deficit-resolution', applyDeficitResolution);
router.post('/funded/funding-actions/:id/reverse', reverseBudgetFundingAction);
router.post('/funded/months/:month/categories/:categoryId/unbudgeted-resolution/preview', getUnbudgetedResolutionPreview);
router.post('/funded/months/:month/categories/:categoryId/unbudgeted-resolution', applyUnbudgetedResolution);
router.post('/funded/unbudgeted-resolutions/:id/reverse', reverseUnbudgetedResolution);
router.post('/funded/carryover/transfers/:id/reverse', reverseCarryover);
router.post('/funded/categories', establishBudget);
router.patch('/funded/categories/:id', adjustBudget);
router.post('/funded/categories/:id/remove', removeBudget);
router.post('/funded/categories/:id/reactivate', reactivateBudget);
router.post('/funded/operations/:id/reverse', reverseOperation);
router.get('/', getBudgetsByMonth);
router.post('/copy', copyBudget);
router.post('/', upsertBudget);
router.delete('/:id', deleteBudget);

module.exports = router;
