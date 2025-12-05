const express = require('express');
const router = express.Router();
const controller = require('../controllers/authController');
const upload = require('../middleware/uploadMiddleware'); // Твой Multer
const { validateRegistration } = require('../middleware/validation');

// Регистрация с файлом и валидацией
router.post('/register', upload.single('avatar'), validateRegistration, controller.register);

// Обычный логин
router.post('/login', controller.login);

// Google OAuth
router.post('/google', controller.googleAuth);

module.exports = router;