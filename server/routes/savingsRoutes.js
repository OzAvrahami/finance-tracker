const router = require('express').Router();
const savings = require('../controllers/savingsController');
// Mounted after requireAuth. Explicit cash, interest and funded surplus; no jobs.
router.post('/surplus/preview', savings.surplusPreview);
router.post('/surplus', savings.applySurplus);
router.post('/surplus/:id/reverse', savings.reverseSurplus);
router.post('/events', savings.postEvent);
router.post('/events/:id/correct', savings.correctEvent);
router.post('/events/:id/cancel', savings.cancelEvent);
router.post('/transactions/:id/void-detached', savings.voidDetached);
router.get('/report', savings.report);
router.get('/', savings.list);
router.post('/', savings.create);
router.get('/:id', savings.get);
router.patch('/:id', savings.update);
module.exports = router;
