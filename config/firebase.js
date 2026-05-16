const admin = require('firebase-admin');

let firebaseApp;

const initFirebase = () => {
  if (!firebaseApp) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log('✅ Firebase Admin initialized');
  }
  return firebaseApp;
};

const sendFCM = async (fcmToken, title, body, data = {}) => {
  try {
    initFirebase();
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',             // ✅ HIGH priority = doze mode mein bhi turant wake up
        ttl: 60 * 1000,              // 60 second tak valid rakhna (0 = expire instantly)
        notification: {
          sound: 'default',
          defaultSound: true,
          notificationPriority: 'PRIORITY_MAX',  // Notification tray mein bhi top pe
          channelId: 'mdm_commands', // Android 8+ ke liye channel chahiye
          visibility: 'PUBLIC',
        },
      },
    };
    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('FCM Error:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { initFirebase, sendFCM };
