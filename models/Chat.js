const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Chat = sequelize.define('Chat', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    lastMessage: { type: DataTypes.TEXT, allowNull: true },
    lastMessageAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

module.exports = Chat;