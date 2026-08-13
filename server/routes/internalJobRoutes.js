const express = require('express');
const { processDueLoans } = require('../controllers/internalJobController');
const { requireLoanJobSecret } = require('../middleware/loanJobAuth');

const router = express.Router();

router.post('/process-due-loans', requireLoanJobSecret, processDueLoans);

module.exports = router;
