import * as admin from 'firebase-admin';

function getAdminApp() {
  if (!admin.apps.length) {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;

    if (projectId && clientEmail && privateKey) {
      try {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
      } catch (error: any) {
        console.error('Firebase admin initialization error', error.stack);
      }
    }
  }
  return admin.apps.length ? admin.app() : null;
}

export const adminAuth = {
  verifyIdToken: async (token: string) => {
    const app = getAdminApp();
    if (!app) {
      throw new Error("Firebase Admin Credentials Missing. Please check FIREBASE_PRIVATE_KEY and FIREBASE_CLIENT_EMAIL environment variables.");
    }
    return admin.auth(app).verifyIdToken(token);
  }
};

export const adminDb = new Proxy({} as admin.firestore.Firestore, {
  get(_target, prop) {
    const app = getAdminApp();
    if (!app) {
      throw new Error("Firebase Admin Credentials Missing. Please check FIREBASE_PRIVATE_KEY and FIREBASE_CLIENT_EMAIL environment variables.");
    }
    const db = admin.firestore(app);
    const value = Reflect.get(db, prop);
    return typeof value === 'function' ? value.bind(db) : value;
  }
});

