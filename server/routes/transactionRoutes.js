const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

// --- Static Routes (Must be defined BEFORE dynamic /:id routes) ---

// Get unique tags for autocomplete
// This fixes the crash if this route was missing or misplaced
router.get('/tags', transactionController.getTags); 

// --- General Routes ---

// Create a new transaction
router.post('/', transactionController.createTransaction);

// Get all transactions (for history/dashboard)
router.get('/', transactionController.getTransactions);

// --- Dynamic Routes ---

// Delete a transaction by ID
router.delete('/:id', transactionController.deleteTransaction);

module.exports = router;