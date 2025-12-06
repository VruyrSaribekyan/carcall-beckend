// utils/pushNotifications.js
const admin = require('firebase-admin');
const path = require('path');

// Путь к Service Account JSON
const serviceAccountPath = path.join(__dirname, '../config/carcall-cff03-firebase-adminsdk-fbsvc-1361ac3055.json');

// Проверяем существование файла
const fs = require('fs');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Service Account JSON not found at:', serviceAccountPath);
  console.error('⚠️ Push notifications will NOT work!');
} else {
  try {
    const serviceAccount = require(serviceAccountPath);
    
    // Инициализация Firebase Admin SDK
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('✅ Firebase Admin SDK initialized successfully');
    }
  } catch (error) {
    console.error('❌ Firebase Admin initialization error:', error.message);
  }
}

/**
 * Отправка push-уведомления о входящем звонке
 * @param {string} fcmToken - FCM токен получателя
 * @param {Object} callData - Данные о звонке
 */
async function sendCallNotification(fcmToken, callData) {
  if (!fcmToken) {
    console.log('⚠️ No FCM token provided, skipping push notification');
    return { success: false, error: 'No FCM token' };
  }

  if (!admin.apps.length) {
    console.error('❌ Firebase Admin not initialized, cannot send push');
    return { success: false, error: 'Firebase not initialized' };
  }

  try {
    console.log('📤 Sending call notification to:', fcmToken.substring(0, 20) + '...');
    console.log('📞 Call data:', {
      from: callData.fromCarNumber,
      isVideo: callData.isVideo
    });

    const message = {
      token: fcmToken,
      data: {
        type: 'incoming_call',
        callerCarNumber: callData.fromCarNumber,
        callerName: callData.fromName || callData.fromCarNumber,
        isVideo: String(callData.isVideo),
        signalData: JSON.stringify(callData.signal),
        timestamp: String(Date.now()),
      },
      android: {
        priority: 'high',
        ttl: 30000, // 30 секунд
        notification: {
          title: `📞 Входящий ${callData.isVideo ? 'видео' : 'аудио'}звонок`,
          body: `${callData.fromName || callData.fromCarNumber} звонит вам`,
          channelId: 'call_channel',
          priority: 'high',
          sound: 'default',
          tag: 'incoming_call',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            alert: {
              title: `📞 Входящий ${callData.isVideo ? 'видео' : 'аудио'}звонок`,
              body: `${callData.fromName || callData.fromCarNumber} звонит вам`,
            },
            sound: 'default',
            badge: 1,
            category: 'CALL_INVITATION',
            'content-available': 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log('✅ Push notification sent successfully:', response);
    
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Send notification error:', error.code, error.message);
    
    // Обработка специфичных ошибок
    if (error.code === 'messaging/registration-token-not-registered') {
      console.log('⚠️ FCM token is invalid or expired');
      return { success: false, error: 'Invalid token', shouldRemoveToken: true };
    }
    
    if (error.code === 'messaging/invalid-registration-token') {
      console.log('⚠️ FCM token format is invalid');
      return { success: false, error: 'Invalid token format', shouldRemoveToken: true };
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Отправка уведомления об окончании звонка
 */
async function sendCallEndedNotification(fcmToken, callData) {
  if (!fcmToken || !admin.apps.length) {
    return { success: false };
  }

  try {
    const message = {
      token: fcmToken,
      data: {
        type: 'call_ended',
        callerCarNumber: callData.fromCarNumber,
        reason: callData.reason || 'ended',
      },
    };

    await admin.messaging().send(message);
    console.log('✅ Call ended notification sent');
    return { success: true };
  } catch (error) {
    console.error('❌ Send call ended notification error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Проверка валидности FCM токена
 */
async function validateFCMToken(fcmToken) {
  if (!fcmToken || !admin.apps.length) {
    return false;
  }

  try {
    // Отправляем тестовое сообщение для проверки (dry run)
    await admin.messaging().send({
      token: fcmToken,
      data: { type: 'test' },
    }, true); // dryRun = true

    return true;
  } catch (error) {
    console.error('❌ Token validation failed:', error.code);
    return false;
  }
}

module.exports = {
  sendCallNotification,
  sendCallEndedNotification,
  validateFCMToken,
};