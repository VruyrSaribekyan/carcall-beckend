const { CallHistory, User } = require('../models');
const { Op } = require('sequelize');

// Сохранение звонка
exports.saveCall = async (req, res) => {
    try {
        const { callerCarNumber, receiverCarNumber, callType, status, duration } = req.body;
        
        const call = await CallHistory.create({
            callerCarNumber,
            receiverCarNumber,
            callType: callType || 'audio',
            status: status || 'missed',
            duration: duration || 0,
            startTime: new Date(),
            endTime: duration ? new Date(Date.now() + duration * 1000) : null
        });
        
        res.json({ success: true, call });
    } catch (e) {
        console.error('Save call error:', e);
        res.status(500).json({ error: e.message });
    }
};

// Получение истории звонков
exports.getHistory = async (req, res) => {
    try {
        const { carNumber } = req.params;
        
        const history = await CallHistory.findAll({
            where: {
                [Op.or]: [
                    { callerCarNumber: carNumber },
                    { receiverCarNumber: carNumber }
                ]
            },
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        
        res.json({ success: true, history });
    } catch (e) {
        console.error('Get history error:', e);
        res.status(500).json({ error: e.message });
    }
};