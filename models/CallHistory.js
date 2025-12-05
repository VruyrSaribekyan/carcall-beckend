const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CallHistory = sequelize.define('CallHistory', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    callerCarNumber: { type: DataTypes.STRING, allowNull: false },
    receiverCarNumber: { type: DataTypes.STRING, allowNull: false },
    
    // Тип звонка
    callType: { 
        type: DataTypes.ENUM('audio', 'video'), 
        defaultValue: 'audio' 
    },
    
    // Статус звонка - критически важно для истории
    status: { 
        type: DataTypes.ENUM('missed', 'rejected', 'completed', 'busy', 'failed'), 
        defaultValue: 'missed' 
    },
    
    startTime: { type: DataTypes.DATE, allowNull: true },
    endTime: { type: DataTypes.DATE, allowNull: true },
    duration: { type: DataTypes.INTEGER, defaultValue: 0 }, // В секундах
    
    disconnectReason: { type: DataTypes.STRING, allowNull: true } // Кто сбросил или ошибка сети
});

module.exports = CallHistory;