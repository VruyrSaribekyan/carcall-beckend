const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Message = sequelize.define('Message', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    content: { type: DataTypes.TEXT, allowNull: true },
    type: { 
        type: DataTypes.ENUM('text', 'image'), 
        defaultValue: 'text' 
    },
    mediaUrl: { type: DataTypes.STRING, allowNull: true }, // Ссылка на Supabase
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false }
});

module.exports = Message;