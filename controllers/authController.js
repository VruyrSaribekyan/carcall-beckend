const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { User } = require('../models');
const { Op } = require('sequelize');
const supabase = require('../config/supabase');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (user) => {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
    );
};

const uploadAvatar = async (file, userId) => {
    if (!file) return null;
    const fileExt = file.originalname.split('.').pop();
    const fileName = `avatars/${userId}_${Date.now()}.${fileExt}`;
    
    const { error } = await supabase.storage
        .from('avatars')
        .upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: true
        });

    if (error) throw error;
    
    const { data } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);
        
    return data.publicUrl;
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ where: { email } });
        if (!user || !user.password) {
            return res.status(401).json({ message: "Неверный email или пароль" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Неверный email или пароль" });
        }

        const token = generateToken(user);

        res.json({ 
            token, 
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                carNumber: user.carNumber,
                phoneNumber: user.phoneNumber, // НОВОЕ
                age: user.age,
                avatarUrl: user.avatarUrl,
                isOnline: user.isOnline || false
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.register = async (req, res) => {
    try {
        const { firstName, lastName, email, age, carNumber, phoneNumber, password } = req.body;

        // Проверяем уникальность email, carNumber и phoneNumber
        const existingUser = await User.findOne({
            where: {
                [Op.or]: [
                    { email }, 
                    { carNumber },
                    { phoneNumber } // НОВОЕ
                ]
            }
        });

        if (existingUser) {
            if (existingUser.email === email) {
                return res.status(400).json({ message: "Email уже занят" });
            }
            if (existingUser.carNumber === carNumber) {
                return res.status(400).json({ message: "Номер машины уже зарегистрирован" });
            }
            if (existingUser.phoneNumber === phoneNumber) {
                return res.status(400).json({ message: "Номер телефона уже зарегистрирован" });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await User.create({
            firstName,
            lastName,
            email,
            age,
            carNumber,
            phoneNumber, // НОВОЕ
            password: hashedPassword
        });

        let avatarUrl = null;
        if (req.file) {
            try {
                avatarUrl = await uploadAvatar(req.file, newUser.id);
                await newUser.update({ avatarUrl });
            } catch (uploadErr) {
                console.error("Ошибка загрузки аватара:", uploadErr);
            }
        }

        const token = generateToken(newUser);

        res.status(201).json({ 
            token, 
            user: {
                id: newUser.id,
                email: newUser.email,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                carNumber: newUser.carNumber,
                phoneNumber: newUser.phoneNumber, // НОВОЕ
                age: newUser.age,
                avatarUrl: avatarUrl || newUser.avatarUrl,
                isOnline: false
            } 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Ошибка сервера при регистрации" });
    }
};

exports.googleAuth = async (req, res) => {
    try {
        const { idToken } = req.body;
        
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        
        const { email, name, sub: googleId, picture } = ticket.getPayload();

        let user = await User.findOne({ where: { email } });

        if (user) {
            if (!user.googleId) {
                user.googleId = googleId;
                await user.save();
            }
        } else {
            const nameParts = name ? name.split(' ') : ['User', ''];
            const firstName = nameParts[0];
            const lastName = nameParts.slice(1).join(' ') || '';

            user = await User.create({
                email,
                firstName,
                lastName,
                googleId,
                avatarUrl: picture,
            });
        }

        const token = generateToken(user);
        res.json({ token, user });

    } catch (err) {
        console.error("Google Auth Error:", err);
        res.status(401).json({ message: "Неверный токен Google" });
    }
};