/**
 * Regression tests for the dashboard bridge content script.
 *
 * The listener's *return value* is the whole subject here. Returning `true` from a
 * `chrome.runtime.onMessage` listener promises an asynchronous reply; Chrome then holds the
 * sender's port open until its own ~30 second timeout. Because this script runs on every
 * dashboard-origin page, an unconditional `true` made the popup's first "Scan this page"
 * stall for 30 seconds — measured in real Chromium as 30,068 ms, fixed to 4 ms.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (
  request: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

interface ChromeStub {
  runtime: {
    id: string;
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: { addListener: (listener: Listener) => void };
  };
}

let listener: Listener | undefined;
let stub: ChromeStub;

async function loadBridge(): Promise<void> {
  listener = undefined;
  stub = {
    runtime: {
      id: 'test-extension',
      sendMessage: vi.fn(() => Promise.resolve({})),
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  // Fresh module each time: the script registers its listeners as a side effect of import.
  vi.resetModules();
  await import('../../extension/src/content/dashboardSync');
}

describe('dashboardSync message listener', () => {
  beforeEach(async () => {
    await loadBridge();
  });

  it('registers a runtime message listener', () => {
    expect(listener).toBeTypeOf('function');
  });

  it('answers REQUEST_TOKEN_REFRESH synchronously and closes the channel', () => {
    const sendResponse = vi.fn();
    const kept = listener!({ action: 'REQUEST_TOKEN_REFRESH' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ status: 'Refresh requested' });
    expect(kept).toBe(false);
  });

  it('does not claim a message it cannot answer', () => {
    // The regression: claiming PING_CONTENT here cost 30 seconds per first scan.
    for (const action of ['PING_CONTENT', 'SCAN_PAGE', 'SHOW_REVIEW_PANEL', 'anything-else']) {
      const sendResponse = vi.fn();
      const kept = listener!({ action }, {}, sendResponse);
      expect(kept, `${action} must not keep the port open`).toBe(false);
      expect(sendResponse, `${action} must not be answered`).not.toHaveBeenCalled();
    }
  });

  it('tolerates a malformed message without claiming it', () => {
    for (const message of [undefined, null, {}, 'string', 42]) {
      expect(listener!(message, {}, vi.fn())).toBe(false);
    }
  });
});

describe('dashboardSync window bridge', () => {
  beforeEach(async () => {
    await loadBridge();
  });

  /**
   * Dispatched synchronously rather than via `window.postMessage`, whose delivery jsdom
   * queues as a task — a `setTimeout(0)` assertion races it.
   */
  const post = (data: unknown): void => {
    window.dispatchEvent(new MessageEvent('message', { data, source: window }));
  };

  it('forwards a profile sync to the service worker', () => {
    post({ type: 'FORMPILOT_PROFILE_SYNC', detail: { profile: { userId: 'u' }, isComplete: true } });
    expect(stub.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'CACHE_PROFILE',
      payload: { profile: { userId: 'u' }, isComplete: true },
    });
  });

  it('forwards an auth sync to the service worker', () => {
    post({ type: 'FORMPILOT_AUTH_SYNC', detail: { isAuthenticated: true, uid: 'u', token: 't' } });
    expect(stub.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'CACHE_AUTH',
      payload: { isAuthenticated: true, uid: 'u', token: 't' },
    });
  });

  it('ignores unrelated and malformed window messages', () => {
    post({ type: 'SOMETHING_ELSE', detail: {} });
    post({ type: 'FORMPILOT_AUTH_SYNC' }); // no detail
    post(null);
    post('string');
    expect(stub.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing once the extension context is gone', () => {
    // A reloaded or removed extension leaves `chrome.runtime.id` undefined; touching the
    // messaging API then throws, so the bridge must bail out first.
    stub.runtime.id = '';
    post({ type: 'FORMPILOT_AUTH_SYNC', detail: { isAuthenticated: true } });
    expect(stub.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
