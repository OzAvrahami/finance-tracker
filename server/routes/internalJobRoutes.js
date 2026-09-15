const express = require('express');
const { processDueLoans } = require('../controllers/internalJobController');
const { requireLoanJobSecret } = require('../middleware/loanJobAuth');
const { requireSavingsJobSecret } = require('../middleware/savingsJobAuth');
const { processDueSavings } = require('../controllers/savingsJobController');

const router = express.Router();

router.post('/process-due-loans', requireLoanJobSecret, processDueLoans);
router.post('/process-due-savings', requireSavingsJobSecret, processDueSavings);

module.exports = router;
