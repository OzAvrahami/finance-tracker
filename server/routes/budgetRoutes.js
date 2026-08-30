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
