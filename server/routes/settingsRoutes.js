const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/categories',      settingsController.getCategories);
router.post('/categories',     settingsController.createCategory);
router.put('/categories/:id',  settingsController.updateCategory);
router.delete('/categories/:id', settingsController.deleteCategory);

module.exports = router;
