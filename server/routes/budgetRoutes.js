const express = require('express');
const router = express.Router();
const {
  getBudgetsByMonth,
  getAnnualSummary,
  getMonthlyCategoryBreakdown,
  upsertBudget,
  copyBudget,
  deleteBudget
} = require('../controllers/budgetController');

router.get('/annual-summary', getAnnualSummary);
router.get('/monthly-category-breakdown', getMonthlyCategoryBreakdown);
router.get('/', getBudgetsByMonth);
router.post('/copy', copyBudget);
router.post('/', upsertBudget);
router.delete('/:id', deleteBudget);

module.exports = router;
