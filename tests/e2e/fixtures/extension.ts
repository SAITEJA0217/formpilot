/**
 * Playwright fixtures for running the **real built extension in real Chromium**.
 *
 * Nothing here relaxes the extension: it loads `extension/dist` exactly as `Load unpacked`
 * would, on the origin the shipped manifest already trusts, and drives it through the same
 * message contracts the popup uses. The one thing it does not exercise is the popup's own
 * `chrome.tabs.query` tab resolution, because Playwright cannot click browser chrome; the
 * popup's rendering and state handling are covered by their own spec.
 */
import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, type TestServer } from './server';
import { E2E_PROFILE } from './profile';
import type { FormSummary } from '../../../shared/messaging/messages';
import type { FieldSuggestion, FillReport } from '../../../shared/types/suggestion';

/** One review card as rendered in the panel. */
export interface PanelCard {
  label: string;
  value: string;
  badge: string;
  band: string;
  source: string;
  accepted: boolean;
  blocked: boolean;
  /** The group heading the card sits under, when it is the first card in its group. */
  group: string;
}

const ROOT = path.resolve(import.meta.dirname, '../../..');
const EXTENSION_DIR = path.join(ROOT, 'extension/dist');
/** The engine bundle the popup injects, at its fixed build path. */
const ENGINE_BUNDLE = 'injected/universal.js';

export interface EngineDriver {
  /**
   * Open a served page as the form under test.
   *
   * A path is resolved against the local test server; an absolute `http://` URL is opened
   * as given, which is how the Next.js dev server on port 3100 is reached.
   *
   * A unique nonce is appended to the URL because tab resolution matches on URL: without it,
   * two tests opening the same fixture produce two tabs with identical URLs and every
   * operation lands on whichever was opened first.
   */
  openForm(pathOrUrl: string): Promise<Page>;
  /** Inject the engine and scan, exactly as the popup does. */
  scan(page: Page): Promise<FormSummary>;
  /** Open the in-page review panel. */
  showPanel(page: Page): Promise<void>;
  /** Read the cards as the user sees them, from the panel's shadow DOM. */
  panelCards(page: Page): Promise<PanelCard[]>;
  /**
   * Click every unaccepted suggestion's Accept button, the way a reviewer would.
   *
   * Re-queries after each click rather than iterating a fixed count: accepting a card changes its
   * button text to "Accepted", so the locator set shrinks as the loop runs and an index-based loop
   * eventually clicks nothing and times out.
   *
   * Needed because `fillViaPanel` writes only accepted suggestions, and anything below the
   * auto-accept band starts unaccepted — Jotform's composite labels land at 0.84–0.86, for
   * instance. Returns how many were accepted.
   */
  acceptAll(page: Page): Promise<number>;
  /** Apply a fill through the panel's own accept/fill buttons. */
  fillViaPanel(page: Page): Promise<void>;
  /** Ask the content script to fill a given set directly (bypassing the UI). */
  applyDirect(page: Page, suggestions: FieldSuggestion[]): Promise<FillReport>;
  /** Close every page this driver opened. Called automatically after each test. */
  closeOpenedPages(): Promise<void>;
  extensionId: string;
  /** A privileged extension page used to call chrome.* APIs. */
  privileged: Page;
}

/** No test-scoped fixtures: everything expensive is shared per worker. */
type TestFixtures = Record<never, never>;

interface WorkerFixtures {
  /** Named `extensionContext` because Playwright already owns a test-scoped `context`. */
  extensionContext: BrowserContext;
  server: TestServer;
  driver: EngineDriver;
}

/**
 * Source trees whose contents end up inside the injected bundle.
 *
 * `shared/` is in the list because that is where the safety policy lives, and a stale bundle there
 * is the dangerous case rather than a merely inconvenient one.
 */
const BUNDLED_SOURCES = ['extension/src', 'shared'];

/** The newest mtime under a directory tree, ignoring build output. */
function newestSourceMtime(dir: string): { path: string; mtimeMs: number } {
  let newest = { path: dir, mtimeMs: 0 };
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|js|json|css|html)$/.test(entry.name)) {
        const { mtimeMs } = fs.statSync(full);
        if (mtimeMs > newest.mtimeMs) newest = { path: full, mtimeMs };
      }
    }
  };
  walk(dir);
  return newest;
}

/**
 * Refuse to run against a bundle that is missing, or older than the sources it was built from.
 *
 * The existence check alone was not enough, and the gap was not hypothetical: a safety-policy fix
 * landed in `shared/safety/policy.ts`, every unit test and the whole safety corpus went green, and
 * three E2E specs kept failing against the previous bundle — which looked like the fix being wrong
 * rather than the build being old. The reverse is what makes this worth a hard failure: a bundle
 * built *before* a safety regression was introduced will pass the E2E suite and say nothing, so a
 * green run would mean the opposite of what it appears to mean.
 */
function assertBuilt(): void {
  const manifest = path.join(EXTENSION_DIR, 'manifest.json');
  const engine = path.join(EXTENSION_DIR, ENGINE_BUNDLE);
  if (!fs.existsSync(manifest) || !fs.existsSync(engine)) {
    throw new Error(
      `extension/dist is missing ${fs.existsSync(manifest) ? ENGINE_BUNDLE : 'manifest.json'}. ` +
        'Run `npm run build:extension` before the e2e suite.',
    );
  }

  const builtAt = fs.statSync(engine).mtimeMs;
  for (const relative of BUNDLED_SOURCES) {
    const newest = newestSourceMtime(path.join(ROOT, relative));
    if (newest.mtimeMs > builtAt) {
      const behindBy = Math.round((newest.mtimeMs - builtAt) / 1000);
      throw new Error(
        `extension/dist/${ENGINE_BUNDLE} is ${behindBy}s older than ` +
          `${path.relative(ROOT, newest.path)}, so this suite would test a stale build. ` +
          'Run `npm run build:extension` first.',
      );
    }
  }
}

/**
 * Fixtures are **worker-scoped**: launching Chromium and seeding a profile takes ~20s, and
 * doing it per test made the suite unusable. Each test still opens its own page, so tests
 * remain isolated in everything except extension storage — which is the one thing they all
 * want to share (the seeded profile).
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [
    async ({}, use) => {
      const server = await startTestServer(3000);
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  extensionContext: [
    async ({}, use, workerInfo) => {
    assertBuilt();
    const profileDir = path.join(ROOT, 'tests/e2e/.artifacts', `chrome-profile-w${workerInfo.workerIndex}`);
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.mkdirSync(profileDir, { recursive: true });

    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      // Pinned rather than left to the default. The context is worker-scoped, so a spec's
      // `test.use({ viewport })` never reaches it — a spec that needs a different size calls
      // `page.setViewportSize()` on its own page. Stating it here makes that visible instead of
      // leaving specs to depend on whatever Chromium's default happens to be.
      viewport: { width: 1280, height: 720 },
      // The image ships Chromium at a fixed path; use it rather than downloading one.
      executablePath: '/opt/pw-browsers/chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  driver: [
    async ({ extensionContext: context, server }, use) => {
    // Resolve the extension id from the MV3 service worker.
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
    const extensionId = new URL(worker.url()).host;

    // Seed auth + profile through the shipped dashboard bridge, not by writing storage.
    const bridge = await context.newPage();
    await bridge.goto(`${server.origin}/pages/sync-bridge.html`);
    await bridge.evaluate((profile) => {
      window.postMessage(
        { type: 'FORMPILOT_AUTH_SYNC', detail: { isAuthenticated: true, uid: 'e2e-user', token: 'e2e-token' } },
        '*',
      );
      window.postMessage({ type: 'FORMPILOT_PROFILE_SYNC', detail: { profile, isComplete: true } }, '*');
      document.getElementById('status')!.textContent = 'posted';
    }, E2E_PROFILE);

    // A privileged extension page: real production page, used as a chrome.* context.
    const privileged = await context.newPage();
    await privileged.goto(`chrome-extension://${extensionId}/options.html`);

    // Wait until the service worker has actually stored the profile.
    await expect
      .poll(
        async () =>
          privileged.evaluate(async () => {
            const stored = await chrome.storage.local.get(['userProfile', 'isAuthenticated']);
            return !!stored.userProfile && stored.isAuthenticated === true;
          }),
        { timeout: 15_000, message: 'profile never reached chrome.storage.local via the sync bridge' },
      )
      .toBe(true);
    await bridge.close();

    const openedPages: Page[] = [];
    /** The nonce stamped into each opened page's URL, which is how its tab is found. */
    const pageNonces = new Map<Page, string>();
    let nonce = 0;

    /**
     * Resolve the tab id for a page by focusing it and asking for the active tab.
     *
     * Matching on `tab.url` is the obvious approach and it does not work. Without the
     * `tabs` permission — which FormPilot deliberately does not request — `chrome.tabs`
     * only reveals a tab's URL for origins covered by `host_permissions`. The Next.js dev
     * server on port 3100 is not one of them, so every tab came back with an empty URL and
     * nothing matched. Focusing the page and reading the active tab needs no URL at all,
     * and it is what the popup itself does under `activeTab`, so the harness resolves tabs
     * the same way the product does.
     *
     * The nonce is still stamped into each URL and verified here whenever Chrome is willing
     * to tell us the URL, which keeps the original guarantee: an operation can never
     * silently land on the wrong tab.
     */
    const tabIdFor = async (page: Page): Promise<number> => {
      const token = pageNonces.get(page);
      if (!token) throw new Error(`page ${page.url()} was not opened through driver.openForm`);
      await page.bringToFront();
      const active = await privileged.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return tab ? { id: tab.id ?? -1, url: tab.url ?? '' } : null;
      });
      if (!active || active.id < 0) {
        throw new Error(`no active tab after focusing ${page.url()}`);
      }
      // `url` is empty for an origin the manifest does not cover; only check it when given.
      if (active.url && !new RegExp(`[?&]fp=${token}(?:&|$)`).test(active.url)) {
        throw new Error(
          `active tab is ${active.url}, which does not carry fp=${token}; refusing to act on the wrong tab`,
        );
      }
      return active.id;
    };

    const ensureEngine = async (page: Page): Promise<number> => {
      const tabId = await tabIdFor(page);
      await privileged.evaluate(
        async ({ id, bundle }) => {
          // Mirrors the popup, including its bounded ping: `tabs.sendMessage` can hang for
          // ~30s when the page holds a listener that claims messages without answering.
          const ping = chrome.tabs
            .sendMessage(id, { action: 'PING_CONTENT' })
            .then((response: { ok?: boolean } | undefined) => response?.ok === true)
            .catch(() => false);
          const timeout = new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), 400);
          });
          if (await Promise.race([ping, timeout])) return;
          await chrome.scripting.executeScript({ target: { tabId: id }, files: [bundle] });
        },
        { id: tabId, bundle: ENGINE_BUNDLE },
      );
      return tabId;
    };

    const driver: EngineDriver = {
      extensionId,
      privileged,

      async openForm(pathOrUrl: string): Promise<Page> {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        nonce += 1;
        // `e2e` prefixed so `fp=1` cannot be confused with `fp=10` by a prefix match.
        const token = `e2e${nonce}`;
        pageNonces.set(page, token);
        const base = pathOrUrl.startsWith('http') ? pathOrUrl : `${server.origin}${pathOrUrl}`;
        const separator = base.includes('?') ? '&' : '?';
        await page.goto(`${base}${separator}fp=${token}`, { waitUntil: 'load' });
        if (errors.length > 0) {
          throw new Error(`page errors on ${pathOrUrl}: ${errors.join('; ')}`);
        }
        openedPages.push(page);
        return page;
      },

      async closeOpenedPages(): Promise<void> {
        while (openedPages.length > 0) {
          const page = openedPages.pop();
          if (!page) continue;
          pageNonces.delete(page);
          if (!page.isClosed()) await page.close();
        }
      },

      async scan(page: Page): Promise<FormSummary> {
        const tabId = await ensureEngine(page);
        const response = await privileged.evaluate(
          (id) => chrome.tabs.sendMessage(id, { action: 'SCAN_PAGE' }),
          tabId,
        );
        if (!response?.ok) throw new Error(`SCAN_PAGE failed: ${response?.error ?? 'no response'}`);
        return response.summary as FormSummary;
      },

      async showPanel(page: Page): Promise<void> {
        const tabId = await ensureEngine(page);
        const response = await privileged.evaluate(
          (id) => chrome.tabs.sendMessage(id, { action: 'SHOW_REVIEW_PANEL' }),
          tabId,
        );
        if (!response?.ok) throw new Error(`SHOW_REVIEW_PANEL failed: ${response?.error ?? 'none'}`);
        await page.locator('#formpilot-root .panel').waitFor({ state: 'visible', timeout: 10_000 });
      },

      async panelCards(page: Page): Promise<PanelCard[]> {
        // Read what is rendered, not internal state: an end-to-end assertion should hold
        // against the thing the user actually sees.
        return page.locator('#formpilot-root .card').evaluateAll((cards) =>
          cards.map((card) => {
            const text = (selector: string): string =>
              (card.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
            const group = card.previousElementSibling?.classList.contains('group-label')
              ? (card.previousElementSibling.textContent ?? '').trim()
              : '';
            const editor = card.querySelector('textarea.value') as HTMLTextAreaElement | null;
            const badge = card.querySelector('.badge');
            return {
              label: text('.label'),
              value: editor ? editor.value : text('.value'),
              badge: text('.badge'),
              band: badge ? Array.from(badge.classList).filter((c) => c !== 'badge').join(' ') : '',
              source: text('.source'),
              accepted: card.classList.contains('accepted'),
              blocked: card.classList.contains('blocked'),
              group,
            };
          }),
        );
      },

      async acceptAll(page: Page): Promise<number> {
        let accepted = 0;
        // Bounded so a UI that never updates its button text fails the test instead of hanging.
        for (let guard = 0; guard < 200; guard += 1) {
          // `:not([disabled])` matters: the panel disables Accept on a card with no value to
          // apply — a blocked field, or one the profile has nothing for. A disabled button never
          // changes to "Accepted", so without this the loop re-clicks it until Playwright times out.
          const pending = page.locator('#formpilot-root .card .btn:not([disabled])', {
            hasText: /^Accept$/,
          });
          if ((await pending.count()) === 0) break;
          await pending.first().click();
          accepted += 1;
        }
        return accepted;
      },

      async fillViaPanel(page: Page): Promise<void> {
        const fill = page.locator('#formpilot-root .footer .btn.primary');
        await fill.waitFor({ state: 'visible' });
        await fill.click();
      },

      async applyDirect(page: Page, suggestions: FieldSuggestion[]): Promise<FillReport> {
        const tabId = await ensureEngine(page);
        const response = await privileged.evaluate(
          ({ id, list }) => chrome.tabs.sendMessage(id, { action: 'APPLY_SUGGESTIONS', suggestions: list }),
          { id: tabId, list: suggestions },
        );
        if (!response?.ok) throw new Error(`APPLY_SUGGESTIONS failed: ${response?.error ?? 'none'}`);
        return response.report as FillReport;
      },
    };

      await use(driver);
    },
    { scope: 'worker' },
  ],
});

/**
 * Close every page a test opened.
 *
 * Registered here rather than in each spec so no spec can forget: a leaked tab breaks the
 * next test's tab resolution, which is exactly the failure this hook exists to prevent.
 */
test.afterEach(async ({ driver }) => {
  await driver.closeOpenedPages();
});

export { expect };
