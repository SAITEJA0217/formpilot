import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  initializeAuth, 
  browserLocalPersistence, 
  indexedDBLocalPersistence,
  browserPopupRedirectResolver 
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? process.env.NEXT_PUBLIC_FIREBASE_API_KEY : (typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env.VITE_FIREBASE_API_KEY : ''),
  authDomain: typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ? process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN : (typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN : ''),
  projectId: typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID : (typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env.VITE_FIREBASE_PROJECT_ID : ''),
  storageBucket: typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET : (typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env.VITE_FIREBASE_STORAGE_BUCKET : ''),
  messagingSenderId: typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ? process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID : (typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env.VITE_FIREBASE_MESSAGING_SENDER_ID : ''),
  appId: typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_APP_ID ? process.env.NEXT_PUBLIC_FIREBASE_APP_ID : (typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env.VITE_FIREBASE_APP_ID : '')
};

// Initialize Firebase only if not already initialized
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Safe Auth initialization for browser local persistence
function initAuth() {
  if (typeof window !== 'undefined') {
    try {
      return initializeAuth(app, {
        persistence: [browserLocalPersistence, indexedDBLocalPersistence],
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch (e) {
      return getAuth(app);
    }
  }
  return getAuth(app);
}

export const auth = initAuth();
export const db = getFirestore(app);
export const storage = getStorage(app);

// Re-export common firestore functions to prevent Next.js from creating duplicate module instances
// which causes the "Expected first argument to doc() to be a FirebaseFirestore" error
export { doc, getDoc, setDoc } from 'firebase/firestore';
