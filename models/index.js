const sequelize = require('../config/database');
const User = require('./User');
const CallHistory = require('./CallHistory');
const Chat = require('./Chat');
const Message = require('./Message');
const { DataTypes } = require('sequelize');

// Таблица связи для чатов (Many-to-Many)
const UserChats = sequelize.define('UserChats', {
    userId: {
        type: DataTypes.INTEGER,
        references: { model: User, key: 'id' }
    },
    chatId: {
        type: DataTypes.INTEGER,
        references: { model: Chat, key: 'id' }
    }
});

// Связи
User.belongsToMany(Chat, { through: UserChats });
Chat.belongsToMany(User, { through: UserChats });

Chat.hasMany(Message, { foreignKey: 'chatId' });
Message.belongsTo(Chat, { foreignKey: 'chatId' });

User.hasMany(Message, { foreignKey: 'senderId' });
Message.belongsTo(User, { foreignKey: 'senderId' });

// Связи для звонков
User.hasMany(CallHistory, { as: 'OutgoingCalls', foreignKey: 'callerId' });
User.hasMany(CallHistory, { as: 'IncomingCalls', foreignKey: 'receiverId' });

module.exports = {
    sequelize,
    User,
    CallHistory,
    Chat,
    Message,
    UserChats
};