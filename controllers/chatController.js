const { Chat, Message, User } = require('../models');
const { Op } = require('sequelize');

// Отправка сообщения (Текст или Картинка)
exports.sendMessage = async (req, res) => {
    try {
        const { chatId, content, type } = req.body;
        const senderId = req.userData.userId;
        let mediaUrl = null;

        // Если есть файл (картинка)
        if (req.file) {
            // В продакшене тут загрузка в Supabase Storage и получение URL
            // Сейчас локальный путь
            mediaUrl = `/uploads/${req.file.filename}`; 
        }

        const message = await Message.create({
            chatId,
            senderId,
            content,
            type: req.file ? 'image' : 'text',
            mediaUrl
        });

        // Обновляем "последнее сообщение" в чате
        await Chat.update(
            { lastMessage: content || 'Image', lastMessageAt: new Date() },
            { where: { id: chatId } }
        );

        // Тут можно эмитить событие socket.io для мгновенной доставки
        
        res.status(201).json(message);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
// Создать чат с пользователем
exports.createChat = async (req, res) => {
    res.status(200).json({ message: "createChat not implemented yet" });
};

// Получить историю сообщений конкретного чата
exports.getChatMessages = async (req, res) => {
    res.status(200).json({ message: "getChatMessages not implemented yet" });
};

exports.getChats = async (req, res) => {
    const userId = req.userData.userId;
    // Сложный запрос для получения чатов пользователя с данными собеседника
    // Реализуется через User.findAll с include Chat
    // Для краткости пропустим полный SQL, но логика здесь.
    res.json({ message: "List of chats logic here" });
};