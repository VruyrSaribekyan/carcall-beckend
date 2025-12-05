const express = require('express');
const router = express.Router();
const controller = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// Все маршруты ниже требуют авторизации
router.use(authMiddleware);

router.get('/me', controller.getMe);
router.get('/search', controller.searchUsersByQuery);
router.put('/profile', upload.single('avatar'), controller.updateProfile);
router.post('/sync-contacts', controller.syncContacts);
module.exports = router;