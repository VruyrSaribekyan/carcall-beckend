const express = require('express');
const router = express.Router();
const controller = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const { User }= require('../models/User');

// Все маршруты ниже требуют авторизации
router.use(authMiddleware);
router.post('/update-fcm-token', authMiddleware, async (req, res) => {
    try {
        const { carNumber, fcmToken } = req.body;

        console.log('═══════════════════════════════════════════');
        console.log('📝 FCM Token Update Request');
        console.log(`   Car Number: ${carNumber}`);
        console.log(`   Token: ${fcmToken ? fcmToken.substring(0, 30) + '...' : 'NULL'}`);
        console.log('═══════════════════════════════════════════');

        if (!carNumber || !fcmToken) {
            console.log('❌ Missing required fields');
            return res.status(400).json({
                success: false,
                message: 'carNumber and fcmToken are required'
            });
        }

        const user = await User.findOne({ where: { carNumber } });

        if (!user) {
            console.log('❌ User not found');
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Проверяем, изменился ли токен
        if (user.fcmToken === fcmToken) {
            console.log('✅ Token unchanged, skipping update');
            return res.json({
                success: true,
                message: 'FCM token already up to date'
            });
        }

        // Обновляем токен
        await user.update({ fcmToken });

        console.log('✅ FCM token updated successfully');
        console.log('═══════════════════════════════════════════\n');

        res.json({
            success: true,
            message: 'FCM token updated successfully'
        });

    } catch (error) {
        console.error('❌ Update FCM token error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

/**
 * Удаление FCM токена (при logout)
 * POST /api/users/remove-fcm-token
 */
router.post('/remove-fcm-token', authMiddleware, async (req, res) => {
    try {
        const { carNumber } = req.body;

        if (!carNumber) {
            return res.status(400).json({
                success: false,
                message: 'carNumber is required'
            });
        }

        console.log(`🗑️ Removing FCM token for ${carNumber}`);

        await User.update(
            { fcmToken: null },
            { where: { carNumber } }
        );

        console.log(`✅ FCM token removed for ${carNumber}`);

        res.json({
            success: true,
            message: 'FCM token removed successfully'
        });

    } catch (error) {
        console.error('❌ Remove FCM token error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

/**
 * Тестовая отправка push-уведомления
 * POST /api/users/test-push
 */
router.post('/test-push', authMiddleware, async (req, res) => {
    try {
        const { carNumber } = req.body;
        
        const user = await User.findOne({ where: { carNumber } });
        
        if (!user || !user.fcmToken) {
            return res.status(404).json({
                success: false,
                message: 'User or FCM token not found'
            });
        }

        const { sendCallNotification } = require('../utils/pushNotifications');
        
        const result = await sendCallNotification(user.fcmToken, {
            fromCarNumber: 'TEST',
            fromName: 'Test User',
            isVideo: false,
            signal: { type: 'test' }
        });

        res.json({
            success: result.success,
            message: result.success ? 'Test push sent' : 'Failed to send push',
            data: result
        });

    } catch (error) {
        console.error('❌ Test push error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});
router.get('/me', controller.getMe);
router.get('/search', controller.searchUsersByQuery);
router.put('/profile', upload.single('avatar'), controller.updateProfile);
router.post('/sync-contacts', controller.syncContacts);
module.exports = router;