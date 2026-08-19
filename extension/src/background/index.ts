import type { FormQuestion, AIResponse } from '../../../shared/types';

const getApiBaseUrl = () => {
  return import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
};

// ─── Token Lifecycle ──────────────────────────────────────────────────────────
//
// Firebase ID tokens expire after 1 hour.
// The token is cached in chrome.storage.local by dashboardSync.ts when
// the user is on the FormPilot dashboard.
//
// Token refresh strategy:
//  - The dashboard (auth-context.tsx) already calls onAuthStateChanged and
//    posts a fresh token via window.postMessage on every page load.
//  - When the cached token is rejected (HTTP 401), the background worker
//    broadcasts a TOKEN_REFRESH_REQUIRED message to any open dashboard tabs
//    so auth-context can re-post a fresh token automatically.
//  - Passwords and raw refresh tokens are never stored here.
//  - On sign-out (isAuthenticated: false), all auth data is cleared from storage.

async function requestTokenRefresh(): Promise<string | null> {
  // Find an open tab that is the FormPilot dashboard and ask it to re-sync the token.
  const baseUrl = getApiBaseUrl().replace(/\/$/, '');
  const tabs = await chrome.tabs.query({ url: [`${baseUrl}/*`] });
  for (const tab of tabs) {
    if (tab.id) {
      try {
        const promise = chrome.tabs.sendMessage(tab.id, { action: 'REQUEST_TOKEN_REFRESH' });
        if (promise) promise.catch(() => {}); // Catch unhandled promise rejection if content script is missing
      } catch (_) { /* tab may not have the content script */ }
    }
  }
  // Wait up to 4 seconds for the dashboard to post back a fresh token.
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(null); }
    }, 4000);

    const handler = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.idToken?.newValue && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        chrome.storage.onChanged.removeListener(handler);
        resolve(changes.idToken.newValue as string);
      }
    };
    chrome.storage.onChanged.addListener(handler);
  });
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'ANALYZE_FORM') {
    handleAnalyzeForm(request.payload, request.tabId)
      .then(response => sendResponse(response))
      .catch(err => {
        sendResponse({ error: err.message });
      });
    return true; // async
  }
  
  if (request.type === 'SEND_CORRECTION') {
    handleSendCorrection(request.payload)
      .then(response => sendResponse(response))
      .catch(err => {
        sendResponse({ error: err.message });
      });
    return true;
  }

  if (request.type === 'CACHE_PROFILE') {
    chrome.storage.local.set({ 
      userProfile: request.payload.profile,
      isProfileComplete: request.payload.isComplete
    }, () => {
      sendResponse({ status: 'Profile cached' });
    });
    return true;
  }
  
  if (request.type === 'CACHE_AUTH') {
    if (request.payload.isAuthenticated === false) {
      // Sign-out: clear all auth and profile data from local storage
      chrome.storage.local.remove(
        ['isAuthenticated', 'userUid', 'idToken', 'userProfile', 'isProfileComplete'],
        () => { sendResponse({ status: 'Auth cleared' }); }
      );
    } else {
      chrome.storage.local.set({
        isAuthenticated: request.payload.isAuthenticated,
        userUid: request.payload.uid,
        idToken: request.payload.token,
      }, () => {
        sendResponse({ status: 'Auth cached' });
      });
    }
    return true;
  }
});

// Listener for external website pings (from official website via externally_connectable)
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((request, _sender, sendResponse) => {
    if (request.type === 'PING' || request.action === 'PING') {
      sendResponse({ status: 'OK', version: '1.0.0', installed: true });
      return true;
    }
  });
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

async function authorizedFetch(url: string, options: RequestInit, token: string): Promise<Response> {
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  let response = await fetch(url, { ...options, headers: baseHeaders });

  // If the token was rejected, attempt a single token refresh and retry.
  if (response.status === 401) {
    const freshToken = await requestTokenRefresh();
    if (freshToken && freshToken !== token) {
      const retryHeaders = { ...baseHeaders, 'Authorization': `Bearer ${freshToken}` };
      response = await fetch(url, { ...options, headers: retryHeaders });
    }
  }

  return response;
}

async function handleAnalyzeForm(questions: FormQuestion[], targetTabId: number) {
  const data = await chrome.storage.local.get(['userProfile', 'idToken']);
  const profile = data.userProfile;
  const token = data.idToken;
  
  if (!profile) {
    throw new Error('No profile found. Please login to FormPilot dashboard first.');
  }
  if (!token) {
    throw new Error('Authentication expired or missing. Please open the FormPilot dashboard.');
  }

  const response = await authorizedFetch(
    `${getApiBaseUrl()}/api/ai/generate`,
    {
      method: 'POST',
      body: JSON.stringify({ profile, questions })
    },
    token as string
  );

  if (!response.ok) {
    let errorMessage = `Failed to generate answers: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.error) {
        errorMessage = `API Error (${response.status}): ${errorData.error}`;
      }
    } catch (e) {
      // Ignore if no JSON body
    }
    throw new Error(errorMessage);
  }

  const aiData: AIResponse = await response.json();
  
  if (targetTabId) {
    const promise = chrome.tabs.sendMessage(targetTabId, { 
      action: 'SHOW_REVIEW_PANEL', 
      answers: aiData.answers 
    });
    if (promise) promise.catch(() => {});
  }

  return aiData;
}

async function handleSendCorrection(payload: any) {
  const data = await chrome.storage.local.get(['idToken']);
  const token = data.idToken;
  if (!token) throw new Error('Missing token');

  const response = await authorizedFetch(
    `${getApiBaseUrl()}/api/ai/corrections`,
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    token as string
  );

  if (!response.ok) {
    throw new Error('Failed to save correction');
  }

  return await response.json();
}
