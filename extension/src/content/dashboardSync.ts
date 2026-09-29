// Content script injected into web dashboard to listen for auth/profile postMessage events
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || !event.data) return;

  // Safe check to ensure the extension hasn't been reloaded/invalidated
  if (!chrome.runtime?.id) return;

  try {
    if (event.data.type === 'FORMPILOT_PROFILE_SYNC' && event.data.detail) {
      const promise = chrome.runtime.sendMessage({ type: 'CACHE_PROFILE', payload: event.data.detail });
      if (promise) promise.catch(() => {});
    }

    if (event.data.type === 'FORMPILOT_AUTH_SYNC' && event.data.detail) {
      const promise = chrome.runtime.sendMessage({ type: 'CACHE_AUTH', payload: event.data.detail });
      if (promise) promise.catch(() => {});
    }
  } catch (e) {
    // Ignore errors if context becomes invalid mid-execution
  }
});

// Forward messages from the extension background script to the web page
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (request: { action?: string }, _sender, sendResponse: (response: unknown) => void) => {
      if (request?.action === 'REQUEST_TOKEN_REFRESH') {
        window.postMessage({ action: 'REQUEST_TOKEN_REFRESH' }, '*');
        sendResponse({ status: 'Refresh requested' });
        // Answered synchronously, so the channel can close now.
        return false;
      }

      // Returning `true` here would claim the message and promise a reply that never comes.
      // Chrome then holds the sender's port open until its own ~30s timeout instead of
      // reporting "no receiver" immediately — which stalled the popup's first scan on any
      // dashboard-origin tab by a full 30 seconds. Only claim messages we actually handle.
      return false;
    },
  );
}

// This file is a side-effect-only content script: it registers listeners and exports no
// values. The empty export marks it as a module anyway, so a test can `await import()` it
// to re-register those listeners against a fresh stub. Without it TypeScript treats the
// file as a global script and rejects the import with TS2306.
export {};
