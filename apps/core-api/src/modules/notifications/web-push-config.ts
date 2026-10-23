/** Firebase web config for browsers (public by design) and which FIREBASE_* settings are missing. */
export function webPushConfig() {
  const web = {
    apiKey: process.env.FIREBASE_WEB_API_KEY,
    projectId: process.env.FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_WEB_APP_ID,
  };
  const vapidKey = process.env.FIREBASE_VAPID_KEY || null;
  const missing = [
    ['FIREBASE_WEB_API_KEY', web.apiKey],
    ['FIREBASE_PROJECT_ID', web.projectId],
    ['FIREBASE_MESSAGING_SENDER_ID', web.messagingSenderId],
    ['FIREBASE_WEB_APP_ID', web.appId],
    ['FIREBASE_VAPID_KEY', vapidKey],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k as string);
  const webReady = missing.length === 0;
  return { webReady, missing, web: webReady ? { ...web, authDomain: `${web.projectId}.firebaseapp.com` } : null, vapidKey: webReady ? vapidKey : null };
}
