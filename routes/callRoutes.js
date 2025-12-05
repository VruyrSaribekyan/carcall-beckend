const express = require('express');
const router = express.Router();
const controller = require('../controllers/callController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/save', authMiddleware, controller.saveCall);
router.get('/history/:carNumber', authMiddleware, controller.getHistory);

module.exports = router;