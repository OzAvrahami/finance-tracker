const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// Aggregate-only endpoints. These return small, bounded payloads so the
// Dashboard never downloads transaction rows just to compute totals.
router.get('/summary', dashboardController.getSummary);
router.get('/monthly-series', dashboardController.getMonthlySeries);

module.exports = router;
