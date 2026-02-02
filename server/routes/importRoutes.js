const express = require('express');
const router = express.Router();
const multer = require('multer');
const importController = require('../controllers/importController');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// הנתיב: POST /api/import/preview
router.post('/preview', upload.single('file'), importController.previewImport);
router.post('/save', importController.saveImport);

module.exports = router;