// server/routes/transactionRoutes.js
const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

// נתיב להוספת הוצאה עם פריטים
router.post('/', transactionController.createTransaction);

// נתיב לקבלת כל ההוצאות
router.get('/', transactionController.getAllTransactions);

module.exports = router;