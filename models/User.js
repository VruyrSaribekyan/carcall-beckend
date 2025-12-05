const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
    id: { 
        type: DataTypes.INTEGER, 
        autoIncrement: true, 
        primaryKey: true 
    },
    // Основной уникальный идентификатор для входа
    carNumber: { 
        type: DataTypes.STRING, 
        allowNull: false, 
        unique: true 
    },
    password: { 
        type: DataTypes.STRING, 
        allowNull: false // Хэшированный
    }, 
    
    firstName: { 
        type: DataTypes.STRING, 
        allowNull: true
    },
    lastName: { 
        type: DataTypes.STRING, 
        allowNull: true
    },
    email: { 
        type: DataTypes.STRING, 
        allowNull: true,
        unique: true, 
        validate: { isEmail: true }
    },
    age: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    
    // НОВОЕ: номер телефона для синхронизации контактов
    phoneNumber: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        validate: {
            is: /^\+?[1-9]\d{1,14}$/ // Международный формат E.164
        }
    },

    // Технические поля
    avatarUrl: { 
        type: DataTypes.STRING, 
        allowNull: true
    }, 
    fcmToken: { 
        type: DataTypes.STRING, 
        allowNull: true
    }, 
    isOnline: { 
        type: DataTypes.BOOLEAN, 
        defaultValue: false 
    },
    lastSeen: { 
        type: DataTypes.DATE, 
        defaultValue: DataTypes.NOW 
    }
});

module.exports = User;