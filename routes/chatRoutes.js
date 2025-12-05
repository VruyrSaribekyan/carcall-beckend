const express = require('express');
const router = express.Router();
const controller = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// Создать чат с пользователем
router.post('/', authMiddleware, controller.createChat);

// Получить список всех чатов
router.get('/', authMiddleware, controller.getChats);

// Получить историю сообщений конкретного чата
router.get('/:chatId/messages', authMiddleware, controller.getChatMessages);

// Отправить сообщение (текст или картинку)
router.post('/message', authMiddleware, upload.single('image'), controller.sendMessage);

module.exports = router;