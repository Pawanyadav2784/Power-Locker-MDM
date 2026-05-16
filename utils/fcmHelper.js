const admin = require('firebase-admin');

let initialized = false;

const initFirebase = () => {
  if (!initialized) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    initialized = true;
  }
};

// Send FCM push notification
const sendFCM = async (fcmToken, title, body, data = {}) => {
  try {
    initFirebase();
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',             // ✅ HIGH priority = doze mode mein bhi turant wake up
        ttl: 60 * 1000,              // 60 sec valid
        notification: {
          sound: 'default',
          defaultSound: true,
          notificationPriority: 'PRIORITY_MAX',
          channelId: 'mdm_commands',
          visibility: 'PUBLIC',
        },
      },
    };
    const response = await admin.messaging().send(message);
    console.log(`✅ FCM sent: ${title} → ${response}`);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ FCM Error:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { sendFCM, initFirebase };
