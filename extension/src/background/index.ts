/**
 * Service worker — message router and privileged operations.
 *
 * The worker owns everything the page must not: the cached profile, the Firebase ID
 * token, and all network access. The content script never sees a token and never
 * talks to the API directly.
 *
 * v1 message names are still handled so a half-updated install degrades rather than
 * breaks: `ANALYZE_FORM` (legacy whole-form request), `SEND_CORRECTION`,
 * `CACHE_PROFILE`, `CACHE_AUTH`.
 */
import type { UnifiedForm } from '../../../shared/types/form';
import type { FormQuestion } from '../../../shared/types';
import { authorizedFetch, readJson, STORAGE_KEYS } from './api';
import { buildSuggestionsForForm, loadSettings, saveSettings, type ExtensionSettings } from './pipeline';

type Respond = (response: unknown) => void;

interface IncomingMessage {
  type?: string;
  payload?: unknown;
  form?: UnifiedForm;
  tabId?: number;
  settings?: Partial<ExtensionSettings>;
}

/** Run an async handler and always answer the sender, error or not. */
function handle(promise: Promise<unknown>, respond: Respond): true {
  promise
    .then((result) => respond(result ?? { ok: true }))
    .catch((error: unknown) =>
      respond({ error: error instanceof Error ? error.message : 'Unexpected background error.' }),
    );
  return true;
}

chrome.runtime.onMessage.addListener((request: IncomingMessage, _sender, sendResponse) => {
  switch (request.type) {
    case 'BUILD_SUGGESTIONS': {
      if (!request.form) {
        sendResponse({ error: 'No form supplied.' });
        return false;
      }
      return handle(buildSuggestionsForForm(request.form), sendResponse);
    }

    case 'GET_STATE':
      return handle(getState(), sendResponse);

    case 'GET_SETTINGS':
      return handle(loadSettings(), sendResponse);

    case 'SET_SETTINGS':
      return handle(saveSettings(request.settings ?? {}), sendResponse);

    case 'CLEAR_LOCAL_DATA':
      return handle(clearLocalData(), sendResponse);

    case 'EXPORT_PROFILE':
      return handle(exportProfile(), sendResponse);

    case 'SEND_CORRECTION':
      return handle(sendCorrection(request.payload as Record<string, unknown>), sendResponse);

    case 'DELETE_CORRECTIONS':
      return handle(deleteCorrections(), sendResponse);

    case 'CACHE_PROFILE':
      return handle(cacheProfile(request.payload as { profile: unknown; isComplete: boolean }), sendResponse);

    case 'CACHE_AUTH':
      return handle(cacheAuth(request.payload as { isAuthenticated: boolean; uid?: string; token?: string }), sendResponse);

    // ── v1 compatibility ────────────────────────────────────────────────────
    case 'ANALYZE_FORM':
      return handle(legacyAnalyzeForm(request.payload as FormQuestion[], request.tabId), sendResponse);

    default:
      return false;
  }
});

/** Website install check, unchanged from v1. */
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((request: { type?: string; action?: string }, _sender, sendResponse) => {
    if (request.type === 'PING' || request.action === 'PING') {
      sendResponse({ status: 'OK', version: chrome.runtime.getManifest().version, installed: true });
      return true;
    }
    return false;
  });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function getState(): Promise<{
  isAuthenticated: boolean;
  isProfileComplete: boolean;
  hasProfile: boolean;
  settings: ExtensionSettings;
}> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.authenticated,
    STORAGE_KEYS.profileComplete,
    STORAGE_KEYS.profile,
  ]);
  return {
    isAuthenticated: stored[STORAGE_KEYS.authenticated] === true,
    isProfileComplete: stored[STORAGE_KEYS.profileComplete] === true,
    hasProfile: !!stored[STORAGE_KEYS.profile],
    settings: await loadSettings(),
  };
}

async function cacheProfile(payload: { profile: unknown; isComplete: boolean }): Promise<{ ok: true }> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.profile]: payload.profile,
    [STORAGE_KEYS.profileComplete]: payload.isComplete,
  });
  return { ok: true };
}

async function cacheAuth(payload: {
  isAuthenticated: boolean;
  uid?: string;
  token?: string;
}): Promise<{ ok: true }> {
  if (payload.isAuthenticated === false) {
    // Sign-out clears every trace of the account from local storage.
    await chrome.storage.local.remove([
      STORAGE_KEYS.authenticated,
      STORAGE_KEYS.uid,
      STORAGE_KEYS.token,
      STORAGE_KEYS.profile,
      STORAGE_KEYS.profileComplete,
      STORAGE_KEYS.corrections,
      STORAGE_KEYS.correctionsFetchedAt,
    ]);
    return { ok: true };
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.authenticated]: payload.isAuthenticated,
    [STORAGE_KEYS.uid]: payload.uid,
    [STORAGE_KEYS.token]: payload.token,
  });
  return { ok: true };
}

/** Privacy control: wipe everything FormPilot keeps on this device. */
async function clearLocalData(): Promise<{ ok: true; cleared: string[] }> {
  const keys = Object.values(STORAGE_KEYS);
  await chrome.storage.local.remove(keys as string[]);
  return { ok: true, cleared: keys as string[] };
}

/** Privacy control: hand the user their own cached data back. */
async function exportProfile(): Promise<{ ok: true; export: Record<string, unknown> }> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.profile,
    STORAGE_KEYS.profileComplete,
    STORAGE_KEYS.corrections,
    STORAGE_KEYS.settings,
  ]);
  return {
    ok: true,
    export: {
      exportedAt: new Date().toISOString(),
      profile: stored[STORAGE_KEYS.profile] ?? null,
      isProfileComplete: stored[STORAGE_KEYS.profileComplete] ?? false,
      corrections: stored[STORAGE_KEYS.corrections] ?? [],
      settings: stored[STORAGE_KEYS.settings] ?? null,
    },
  };
}

async function sendCorrection(payload: Record<string, unknown>): Promise<unknown> {
  const settings = await loadSettings();
  if (!settings.allowCorrectionLearning) {
    return { ok: true, skipped: 'Correction learning is turned off.' };
  }
  const stored = await chrome.storage.local.get(STORAGE_KEYS.token);
  const token = stored[STORAGE_KEYS.token] as string | undefined;
  if (!token) throw new Error('Not signed in.');

  const response = await authorizedFetch(
    '/api/ai/corrections',
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
  const result = await readJson<{ success?: boolean; type?: string }>(response, 'Could not save the correction');
  // Invalidate the local cache so the next form sees this correction.
  await chrome.storage.local.remove(STORAGE_KEYS.correctionsFetchedAt);
  return result;
}

/** Privacy control: delete the learned corrections, locally and server-side. */
async function deleteCorrections(): Promise<unknown> {
  await chrome.storage.local.remove([STORAGE_KEYS.corrections, STORAGE_KEYS.correctionsFetchedAt]);
  const stored = await chrome.storage.local.get(STORAGE_KEYS.token);
  const token = stored[STORAGE_KEYS.token] as string | undefined;
  if (!token) return { ok: true, remote: false };
  const response = await authorizedFetch('/api/ai/corrections', { method: 'DELETE' }, token);
  await readJson<{ deleted?: number }>(response, 'Could not delete corrections');
  return { ok: true, remote: true };
}

/**
 * v1 request shape: a bare `FormQuestion[]`. Forwarded to the legacy endpoint
 * unchanged and pushed to the tab with the v1 message name, so an older content
 * script still works against this worker.
 */
async function legacyAnalyzeForm(questions: FormQuestion[], tabId?: number): Promise<unknown> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.profile, STORAGE_KEYS.token]);
  const profile = stored[STORAGE_KEYS.profile];
  const token = stored[STORAGE_KEYS.token] as string | undefined;
  if (!profile) throw new Error('No profile found. Please sign in to the FormPilot dashboard first.');
  if (!token) throw new Error('Authentication expired or missing. Please open the FormPilot dashboard.');

  const response = await authorizedFetch(
    '/api/ai/generate',
    { method: 'POST', body: JSON.stringify({ profile, questions }) },
    token,
  );
  const data = await readJson<{ answers: unknown[] }>(response, 'Failed to generate answers');

  if (tabId !== undefined) {
    const promise = chrome.tabs.sendMessage(tabId, { action: 'SHOW_REVIEW_PANEL', answers: data.answers });
    if (promise) promise.catch(() => {});
  }
  return data;
}
