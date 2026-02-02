const express = require('express');
const router = express.Router();
const { createCategory } = require('../controllers/categoryController'); 

router.post('/', createCategory); 

module.exports = router;