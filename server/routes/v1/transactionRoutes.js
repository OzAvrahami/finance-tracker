const express = require('express');
const router = express.Router();
const { createTransaction } = require('../../controllers/v1/transactionController');

router.post('/', createTransaction);

module.exports = router;
