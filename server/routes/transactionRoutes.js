const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

const { z } = require("zod");
const { validateBody } = require('../middleware/validate');

const createTransactionSchema = z.object({
  amount: z.number(),
  date: z.string(),
  description: z.string().max(200).optional(),
  categoryId: z.string().optional()
});

// --- General Routes ---
// Get unique tags for autocomplete
router.get('/tags', transactionController.getTags);
router.get('/categories', transactionController.getCategories);
router.get('/payment-sources', transactionController.getPaymentSources);

// Create a new transaction
router.post('/', transactionController.createTransaction);

// Get all transactions (for history/dashboard)
router.get('/', transactionController.getTransactions);
router.get('/lego/details/:setNum', transactionController.getLegoSetDetails);

// --- Dynamic Routes ---
// Update transaction by ID
router.get('/:id', transactionController.getTransactionById);
router.put('/:id', transactionController.updateTransaction);

// Delete a transaction by ID
router.delete('/:id', transactionController.deleteTransaction);

module.exports = router;