const express = require('express');
const router = express.Router();
const legoController = require('../controllers/legoController');

router.get('/', legoController.getAllSets);

router.post('/', legoController.addSet);

router.put('/:id', legoController.updateSet);

module.exports = router;