// utils/pushNotifications.js
require('dotenv').config();
const admin = require('firebase-admin');
const fetch = require('node-fetch'); // для Expo push (если нужно)

// Инициализация из ENV (как у тебя)
const requiredEnvVars = [
  "GOOGLE_PROJECT_ID",
  "GOOGLE_PRIVATE_KEY_ID",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_CLIENT_EMAIL",
  "GOOGLE_CLIENT_ID",
];

let missing = false;
requiredEnvVars.forEach((k) => {
  if (!process.env[k]) {
    console.error(`❌ Missing ENV: ${k}`);
    missing = true;
  }
});
if (missing) {
  console.warn('⚠️ Some GOOGLE env vars missing — Firebase Admin may fail to init');
}

try {
  if (!admin.apps.length && process.env.GOOGLE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        type: "service_account",
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
        token_uri: "https://oauth2.googleapis.com/token",
        universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN || "googleapis.com",
      }),
    });
    console.log('✅ Firebase Admin initialized');
  }
} catch (e) {
  console.error('❌ Firebase init error:', e.message);
}

/**
 * Helper: send push via FCM (admin.messaging) with both notification + data fields.
 * Returns { success: boolean, id?, error?, shouldRemoveToken?: boolean }
 */
async function sendViaFCM(token, payload) {
  if (!admin.apps.length) return { success: false, error: 'Firebase not initialized' };
  try {
    const response = await admin.messaging().send(payload);
    return { success: true, id: response };
  } catch (err) {
    console.error('FCM send error:', err.code, err.message || err);
    if (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token') {
      return { success: false, error: err.message, shouldRemoveToken: true };
    }
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Helper: send push via Expo Push API (for Expo-managed apps)
 * token: Expo token like ExponentPushToken[...]
 */
async function sendViaExpo(expoToken, message) {
  try {
    const body = [{
      to: expoToken,
      sound: 'default',
      title: message.title,
      body: message.body,
      data: message.data || {},
    }];
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { success: true, result: json };
  } catch (err) {
    console.error('Expo push error:', err);
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * MAIN: sendCallNotification
 * fcmTokenOrExpoToken: either FCM token or Expo Push Token
 * callData: { fromCarNumber, fromName, isVideo, signal }
 */
async function sendCallNotification(fcmTokenOrExpoToken, callData = {}) {
  if (!fcmTokenOrExpoToken) return { success: false, error: 'No token' };

  const title = `📞 Входящий ${callData.isVideo ? 'видео' : 'аудио'} звонок`;
  const body = `${callData.fromName || callData.fromCarNumber} звонит вам`;

  // common payload fields for data
  const data = {
    type: 'incoming_call',
    callerCarNumber: callData.fromCarNumber || '',
    callerName: callData.fromName || '',
    isVideo: String(!!callData.isVideo),
    timestamp: String(Date.now()),
    // caution: signal can be large; you may want to send it only via socket or via server fetch endpoint
    signal: callData.signal ? JSON.stringify(callData.signal) : '',
  };

  // Heuristic: Expo tokens start with "ExponentPushToken" or "ExpoPushToken"
  if (fcmTokenOrExpoToken.startsWith && (fcmTokenOrExpoToken.startsWith('ExponentPushToken') || fcmTokenOrExpoToken.startsWith('ExpoPushToken'))) {
    return await sendViaExpo(fcmTokenOrExpoToken, { title, body, data });
  }

  // otherwise attempt FCM
  const message = {
    token: fcmTokenOrExpoToken,
    notification: { title, body }, // ensures system displays notification in background
    data,
    android: {
      priority: 'high',
      ttl: 60 * 1000, // 1 min
      notification: {
        channelId: 'call_channel',
        sound: 'default',
        tag: 'incoming_call',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          alert: { title, body },
          sound: 'default',
          badge: 1,
          'content-available': 1,
          category: 'CALL_INVITATION',
        },
      },
    },
  };

  return await sendViaFCM(fcmTokenOrExpoToken, message);
}

/**
 * Notify call ended
 */
async function sendCallEndedNotification(fcmTokenOrExpoToken, callData = {}) {
  if (!fcmTokenOrExpoToken) return { success: false, error: 'No token' };
  const title = 'Звонок завершён';
  const body = `${callData.callerCarNumber || ''} — ${callData.reason || 'завершён'}`;
  const data = { type: 'call_ended', callerCarNumber: callData.callerCarNumber || '', reason: callData.reason || 'ended' };

  if (fcmTokenOrExpoToken.startsWith && (fcmTokenOrExpoToken.startsWith('ExponentPushToken') || fcmTokenOrExpoToken.startsWith('ExpoPushToken'))) {
    return await sendViaExpo(fcmTokenOrExpoToken, { title, body, data });
  }

  const message = {
    token: fcmTokenOrExpoToken,
    notification: { title, body },
    data,
    android: { priority: 'high' },
    apns: { headers: { 'apns-priority': '10' } },
  };

  return await sendViaFCM(fcmTokenOrExpoToken, message);
}

/**
 * Validate token (simple FCM dry run)
 */
async function validateFCMToken(fcmToken) {
  if (!fcmToken) return false;
  if (fcmToken.startsWith && (fcmToken.startsWith('ExponentPushToken') || fcmToken.startsWith('ExpoPushToken'))) {
    // Expo tokens: we cannot dry-run easily — assume true (server will report errors later)
    return true;
  }
  if (!admin.apps.length) return false;
  try {
    await admin.messaging().send({ token: fcmToken, data: { type: 'test' } }, true);
    return true;
  } catch (err) {
    console.warn('Token validation failed', err.code || err.message);
    return false;
  }
}

module.exports = {
  sendCallNotification,
  sendCallEndedNotification,
  validateFCMToken,
};
