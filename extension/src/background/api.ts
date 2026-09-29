/**
 * Authenticated API access from the service worker.
 *
 * Token lifecycle notes (carried over from v1, which this preserves):
 * Firebase ID tokens last an hour. The dashboard posts a fresh token whenever it
 * loads; when the cached token is rejected with 401, we ask any open dashboard tab
 * to re-post one and retry exactly once. Passwords and refresh tokens are never
 * stored in the extension.
 */

export const STORAGE_KEYS = {
  profile: 'userProfile',
  profileComplete: 'isProfileComplete',
  authenticated: 'isAuthenticated',
  uid: 'userUid',
  token: 'idToken',
  settings: 'formpilot:settings',
  corrections: 'formpilot:corrections',
  correctionsFetchedAt: 'formpilot:correctionsFetchedAt',
} as const;

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (configured && configured.trim()) || 'http://localhost:3000';
}

/** Ask any open dashboard tab to re-post a fresh ID token. */
async function requestTokenRefresh(): Promise<string | null> {
  const baseUrl = getApiBaseUrl().replace(/\/$/, '');
  try {
    const tabs = await chrome.tabs.query({ url: [`${baseUrl}/*`] });
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      const promise = chrome.tabs.sendMessage(tab.id, { action: 'REQUEST_TOKEN_REFRESH' });
      if (promise) promise.catch(() => {});
    }
  } catch {
    // No matching tabs, or no permission for them — fall through to the timeout.
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.storage.onChanged.removeListener(handler);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 4000);
    const handler = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ): void => {
      if (area === 'local' && changes[STORAGE_KEYS.token]?.newValue) {
        finish(changes[STORAGE_KEYS.token].newValue as string);
      }
    };
    chrome.storage.onChanged.addListener(handler);
  });
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Fetch with bearer auth, refreshing the token once on 401. */
export async function authorizedFetch(
  path: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  const url = `${getApiBaseUrl().replace(/\/$/, '')}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  let response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    const fresh = await requestTokenRefresh();
    if (fresh && fresh !== token) {
      response = await fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${fresh}` } });
    }
  }
  return response;
}

/** Read a JSON body, turning a non-2xx response into a typed error. */
export async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    let message = `${fallbackMessage} (HTTP ${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}
