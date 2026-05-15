const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/categories',      settingsController.getCategories);
router.post('/categories',     settingsController.createCategory);
router.put('/categories/:id',  settingsController.updateCategory);
router.delete('/categories/:id', settingsController.deleteCategory);

router.get('/payment-sources',       settingsController.getPaymentSources);
router.post('/payment-sources',      settingsController.createPaymentSource);
router.put('/payment-sources/:id',   settingsController.updatePaymentSource);
router.delete('/payment-sources/:id', settingsController.deletePaymentSource);

module.exports = router;
