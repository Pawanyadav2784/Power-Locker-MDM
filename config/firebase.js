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
        priority: 'high',
        notification: { sound: 'default' },
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
