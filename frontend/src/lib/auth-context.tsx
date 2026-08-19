"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, app, db, doc, getDoc, setDoc } from '../../../shared/utils/firebase';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        
        // Sync auth state to extension via window.postMessage bridge
        if (typeof window !== 'undefined') {
          const token = await user.getIdToken();
          window.postMessage({ type: 'FORMPILOT_AUTH_SYNC', detail: { isAuthenticated: true, uid: user.uid, token } }, '*');
        }

        // Ensure user document exists in Firestore
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            userId: user.uid,
            email: user.email,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }, { merge: true });
        }
      } else {
        setUser(null);
        if (typeof window !== 'undefined') {
          window.postMessage({ type: 'FORMPILOT_AUTH_SYNC', detail: { isAuthenticated: false } }, '*');
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Listen for token refresh requests from the extension background worker.
  // When the cached token has expired (401 from API), the background broadcasts
  // REQUEST_TOKEN_REFRESH to any open dashboard tab. We force-refresh the token
  // from Firebase and re-sync it via postMessage so the background can retry.
  useEffect(() => {
    const handleExtensionMessage = async (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.action !== 'REQUEST_TOKEN_REFRESH') return;
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      try {
        const freshToken = await currentUser.getIdToken(/* forceRefresh= */ true);
        window.postMessage({ type: 'FORMPILOT_AUTH_SYNC', detail: { isAuthenticated: true, uid: currentUser.uid, token: freshToken } }, '*');
      } catch (_) {
        // If refresh fails the user will need to log in again.
      }
    };
    window.addEventListener('message', handleExtensionMessage);
    return () => window.removeEventListener('message', handleExtensionMessage);
  }, []);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
        return;
      }
      if (error.code === 'auth/operation-not-allowed' || error.code === 'auth/invalid-api-key') {
        toast.error("Google Sign-In is disabled in Firebase Console. Please enable Google under Authentication -> Sign-in method.");
        return;
      }
      toast.error("Google Sign-In requires enabling Google Provider in Firebase Console. Please sign in with Email.");
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const getFirebaseApiKey = () => {
    return process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '';
  };

  const signInWithEmail = async (email: string, pass: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err: any) {
      if (err.code === 'auth/network-request-failed') {
        const apiKey = getFirebaseApiKey();
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pass, returnSecureToken: true })
        });
        const data = await res.json();
        if (!res.ok) {
          const restError = data.error?.message;
          const code = (restError === 'EMAIL_NOT_FOUND' || restError === 'INVALID_PASSWORD' || restError === 'INVALID_LOGIN_CREDENTIALS') 
            ? 'auth/invalid-credential' 
            : 'auth/network-request-failed';
          const errorObj = new Error(data.error?.message || 'Authentication failed') as any;
          errorObj.code = code;
          throw errorObj;
        }
        window.location.href = '/dashboard';
        return;
      }
      throw err;
    }
  };

  const signUpWithEmail = async (email: string, pass: string) => {
    try {
      await createUserWithEmailAndPassword(auth, email, pass);
    } catch (err: any) {
      if (err.code === 'auth/network-request-failed') {
        const apiKey = getFirebaseApiKey();
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pass, returnSecureToken: true })
        });
        const data = await res.json();
        if (!res.ok) {
          const restError = data.error?.message;
          const code = restError === 'EMAIL_EXISTS' ? 'auth/email-already-in-use' : (restError === 'WEAK_PASSWORD' ? 'auth/weak-password' : 'auth/network-request-failed');
          const errorObj = new Error(data.error?.message || 'Sign up failed') as any;
          errorObj.code = code;
          throw errorObj;
        }
        window.location.href = '/dashboard';
        return;
      }
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
