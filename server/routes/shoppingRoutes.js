const express = require('express');
const router = express.Router();
const shoppingController = require('../controllers/shoppingController');

// Reference data
router.get('/list-types', shoppingController.getListTypes);
router.get('/catalog-categories', shoppingController.getCatalogCategories);
router.get('/catalog-items', shoppingController.getCatalogItems);

// Shopping lists CRUD
router.get('/lists', shoppingController.getShoppingLists);
router.post('/lists', shoppingController.createShoppingList);
router.get('/lists/:id', shoppingController.getShoppingListById);
router.put('/lists/:id', shoppingController.updateShoppingList);
router.delete('/lists/:id', shoppingController.deleteShoppingList);

// List items
router.post('/lists/:id/items', shoppingController.addListItem);
router.put('/lists/:id/items/:itemId', shoppingController.updateListItem);
router.delete('/lists/:id/items/:itemId', shoppingController.removeListItem);
router.patch('/lists/:id/items/:itemId/toggle', shoppingController.toggleItemPurchased);

// Checkout
router.post('/lists/:id/checkout', shoppingController.checkoutList);

module.exports = router;
