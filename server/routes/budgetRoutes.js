const express = require('express');
const router = express.Router();
const {
  getBudgetsByMonth,
  upsertBudget,
  copyBudget,
  deleteBudget
} = require('../controllers/budgetController');

router.get('/', getBudgetsByMonth);
router.post('/copy', copyBudget);
router.post('/', upsertBudget);
router.delete('/:id', deleteBudget);

module.exports = router;
