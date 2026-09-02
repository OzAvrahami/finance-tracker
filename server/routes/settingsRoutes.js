const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const shoppingSettingsController = require('../controllers/shoppingSettingsController');

router.get('/categories',      settingsController.getCategories);
router.post('/categories',     settingsController.createCategory);
router.put('/categories/:id',  settingsController.updateCategory);
router.put('/categories/:id/recurring-budget', settingsController.setCategoryRecurringBudget);
router.put('/categories/:id/budget-carryover', settingsController.setCategoryBudgetCarryover);
router.delete('/categories/:id', settingsController.deleteCategory);

router.get('/payment-sources',       settingsController.getPaymentSources);
router.post('/payment-sources',      settingsController.createPaymentSource);
router.put('/payment-sources/:id',   settingsController.updatePaymentSource);
router.delete('/payment-sources/:id', settingsController.deletePaymentSource);

// Shopping Settings
router.get('/shopping/list-types',          shoppingSettingsController.getAdminListTypes);
router.post('/shopping/list-types',         shoppingSettingsController.createAdminListType);
router.put('/shopping/list-types/:id',      shoppingSettingsController.updateAdminListType);
router.delete('/shopping/list-types/:id',   shoppingSettingsController.deactivateAdminListType);

router.get('/shopping/catalog-categories',        shoppingSettingsController.getAdminCatalogCategories);
router.post('/shopping/catalog-categories',       shoppingSettingsController.createAdminCatalogCategory);
router.put('/shopping/catalog-categories/:id',    shoppingSettingsController.updateAdminCatalogCategory);
router.delete('/shopping/catalog-categories/:id', shoppingSettingsController.deactivateAdminCatalogCategory);

router.get('/shopping/list-types/:id/categories', shoppingSettingsController.getListTypeCategoryLinks);
router.put('/shopping/list-types/:id/categories', shoppingSettingsController.setListTypeCategoryLinks);

module.exports = router;
