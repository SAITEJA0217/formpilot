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
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'REQUEST_TOKEN_REFRESH') {
      window.postMessage({ action: 'REQUEST_TOKEN_REFRESH' }, '*');
      sendResponse({ status: 'Refresh requested' });
    }
    return true;
  });
}
