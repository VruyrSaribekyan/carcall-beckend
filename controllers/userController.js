const { Op } = require('sequelize');
const supabase = require('../config/supabase');
const { User } = require('../models');

// Получение профиля (Get Me)
exports.getMe = async (req, res) => {
    try {
        const user = await User.findByPk(req.userData.userId, {
            attributes: { exclude: ['password', 'googleId'] }
        });

        if (!user) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }

        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Редактирование профиля
exports.updateProfile = async (req, res) => {
    try {
        const userId = req.userData.userId;
        const { firstName, lastName, age, carNumber, email, phoneNumber } = req.body;
        
        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ message: "Пользователь не найден" });

        // Проверка уникальности
        if (email && email !== user.email) {
            const exists = await User.findOne({ where: { email } });
            if (exists) return res.status(400).json({ message: "Email занят" });
        }
        if (carNumber && carNumber !== user.carNumber) {
            const exists = await User.findOne({ where: { carNumber } });
            if (exists) return res.status(400).json({ message: "Номер машины занят" });
        }
        if (phoneNumber && phoneNumber !== user.phoneNumber) {
            const exists = await User.findOne({ where: { phoneNumber } });
            if (exists) return res.status(400).json({ message: "Номер телефона занят" });
        }

        // Обновляем аватар
        let avatarUrl = user.avatarUrl;
        if (req.file) {
            const fileExt = req.file.originalname.split('.').pop();
            const fileName = `avatars/${userId}_${Date.now()}.${fileExt}`;
            
            const { error } = await supabase.storage
                .from('avatars')
                .upload(fileName, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: true
                });

            if (error) throw error;
            
            const { data } = supabase.storage
                .from('avatars')
                .getPublicUrl(fileName);
                
            avatarUrl = data.publicUrl;
        }

        // Обновление полей
        await user.update({
            firstName: firstName || user.firstName,
            lastName: lastName || user.lastName,
            age: age || user.age,
            carNumber: carNumber || user.carNumber,
            email: email || user.email,
            phoneNumber: phoneNumber || user.phoneNumber,
            avatarUrl
        });

        res.json({ message: "Профиль обновлен", user });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// Поиск пользователей
exports.searchUsersByQuery = async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.length < 2) {
            return res.json({ users: [] });
        }

        const users = await User.findAll({
            where: {
                [Op.or]: [
                    { carNumber: { [Op.like]: `%${query}%` } },
                    { firstName: { [Op.like]: `%${query}%` } },
                    { lastName: { [Op.like]: `%${query}%` } },
                ]
            },
            attributes: ['id', 'firstName', 'lastName', 'carNumber', 'phoneNumber', 'avatarUrl', 'isOnline'],
            limit: 20
        });

        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// НОВЫЙ endpoint: Синхронизация контактов
exports.syncContacts = async (req, res) => {
    try {
        const { phoneNumbers } = req.body;
        
        if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
            return res.status(400).json({ message: "Некорректные данные" });
        }

        // Нормализуем номера телефонов
        const normalizedNumbers = phoneNumbers.map(num => {
            // Убираем все нечисловые символы
            let normalized = num.replace(/\D/g, '');
            
            // Если номер начинается с 8, заменяем на 7 (для России)
            if (normalized.startsWith('8') && normalized.length === 11) {
                normalized = '7' + normalized.slice(1);
            }
            
            // Добавляем + если его нет
            if (!normalized.startsWith('+')) {
                normalized = '+' + normalized;
            }
            
            return normalized;
        });

        // Ищем пользователей с такими номерами
        const matches = await User.findAll({
            where: {
                phoneNumber: {
                    [Op.in]: normalizedNumbers
                },
                id: {
                    [Op.ne]: req.userData.userId // Исключаем себя
                }
            },
            attributes: ['id', 'firstName', 'lastName', 'carNumber', 'phoneNumber', 'avatarUrl', 'isOnline']
        });

        res.json({ 
            matches,
            count: matches.length 
        });

    } catch (err) {
        console.error('Sync contacts error:', err);
        res.status(500).json({ error: err.message });
    }
};