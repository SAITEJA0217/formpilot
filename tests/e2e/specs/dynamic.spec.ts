/**
 * Dynamic pages, in real Chromium: mutation, multi-step, shadow DOM and iframes.
 *
 * These four are grouped because they share one question — what happens when the page the
 * engine scanned is not the page any more. jsdom can model the DOM changes but not the things
 * that actually go wrong: a real MutationObserver with real microtask timing, a real closed
 * shadow root that genuinely cannot be pierced, and a real same-origin policy on a frame.
 *
 * The observer is the riskiest part of the engine, because it re-scans on change and the
 * re-scan renders a panel, which is itself a DOM change. The tests below therefore measure
 * settling from the page's own side rather than trusting that the loop terminates.
 */
import { test, expect } from '../fixtures/extension';
import type { Page } from '@playwright/test';

/** Give the observer's 300 ms debounce room to fire and the re-scan room to finish. */
const SETTLE_MS = 1_200;

/**
 * Count DOM mutations on the page over a window, from inside the page.
 *
 * This is the test for "the observer does not loop": FormPilot's re-scan writes to the DOM
 * (the panel, and container bookkeeping attributes), and those writes are themselves
 * observable. If the engine reacted to its own output the count would never reach zero.
 */
async function mutationsOver(page: Page, windowMs: number): Promise<number> {
  return page.evaluate(async (ms) => {
    let count = 0;
    const observer = new MutationObserver((records) => {
      count += records.length;
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    await new Promise((resolve) => setTimeout(resolve, ms));
    observer.disconnect();
    return count;
  }, windowMs);
}

const labels = (cards: { label: string }[]): string[] => cards.map((card) => card.label);

/** Labels that appear more than once, which is what a duplicate-detection bug looks like. */
function duplicates(values: string[]): string[] {
  const seen = new Map<string, number>();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  return [...seen].filter(([, count]) => count > 1).map(([value]) => value);
}

// ─── Mutation ─────────────────────────────────────────────────────────────────

test.describe('dynamic forms', () => {
  test('picks up conditionally rendered fields exactly once', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/dynamic-form.html');
    const first = await driver.scan(page);
    expect(first.fieldsDetected).toBe(2);

    await driver.showPanel(page);
    await page.selectOption('#d-status', 'employed');
    await page.waitForTimeout(SETTLE_MS);

    const cards = await driver.panelCards(page);
    expect(labels(cards)).toContain('Current Company');
    expect(labels(cards)).toContain('Job Title');
    expect(duplicates(labels(cards))).toEqual([]);
  });

  test('drops fields the page removed, without leaving stale suggestions', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/dynamic-form.html');
    await driver.scan(page);
    await driver.showPanel(page);

    await page.selectOption('#d-status', 'employed');
    await page.waitForTimeout(SETTLE_MS);
    expect(labels(await driver.panelCards(page))).toContain('Current Company');

    // Switching replaces the whole conditional section.
    await page.selectOption('#d-status', 'student');
    await page.waitForTimeout(SETTLE_MS);

    const after = labels(await driver.panelCards(page));
    expect(after).not.toContain('Current Company');
    expect(after).not.toContain('Job Title');
    expect(after).toContain('College Name');
    expect(duplicates(after)).toEqual([]);
  });

  test('survives a burst of mutations without duplicating anything', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/dynamic-form.html');
    await driver.scan(page);
    await driver.showPanel(page);

    // Five rows added as fast as the page will do it, which is the case a debounce exists
    // for: one re-scan should cover all of them, not five.
    await page.evaluate(() => {
      const button = document.getElementById('add-project') as HTMLButtonElement;
      for (let i = 0; i < 5; i += 1) button.click();
    });
    await page.waitForTimeout(SETTLE_MS);

    const cards = labels(await driver.panelCards(page));
    for (let i = 1; i <= 5; i += 1) {
      expect(cards, `project ${i} name`).toContain(`Project ${i} Name`);
      expect(cards, `project ${i} description`).toContain(`Project ${i} Description`);
    }
    expect(duplicates(cards)).toEqual([]);
  });

  test('settles rather than reacting to its own re-scan', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/dynamic-form.html');
    await driver.scan(page);
    await driver.showPanel(page);

    await page.selectOption('#d-status', 'employed');
    await page.waitForTimeout(SETTLE_MS);

    // The panel is open and a re-scan has just run. If the engine observed its own writes,
    // each re-scan would schedule the next and this count would stay non-zero indefinitely.
    expect(await mutationsOver(page, 1_500)).toBe(0);
  });

  test('keeps the fields it already had after re-detecting', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/dynamic-form.html');
    await driver.scan(page);
    await driver.showPanel(page);
    const before = labels(await driver.panelCards(page));
    expect(before).toContain('Full Name');

    await page.selectOption('#d-status', 'student');
    await page.waitForTimeout(SETTLE_MS);

    // Re-detection must not discard what was already understood.
    expect(labels(await driver.panelCards(page))).toContain('Full Name');
  });

  test('fills fields that did not exist at first scan', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/dynamic-form.html');
    await driver.scan(page);
    await driver.showPanel(page);

    await page.selectOption('#d-status', 'employed');
    await page.waitForTimeout(SETTLE_MS);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/);

    expect(await page.inputValue('#d-company')).toBe('Nexturn Solutions');
    expect(await page.inputValue('#d-title')).toBe('Software Engineer');
  });
});

// ─── Multi-step ───────────────────────────────────────────────────────────────

test.describe('multi-step forms', () => {
  test('re-detects each step and reports the form as multi-step', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/multi-step.html');
    const summary = await driver.scan(page);
    expect(summary.isMultiStep).toBe(true);

    await driver.showPanel(page);
    const step1 = labels(await driver.panelCards(page));
    expect(step1.length).toBeGreaterThan(0);

    const next = page.locator('button', { hasText: /next/i }).first();
    await next.click();
    await page.waitForTimeout(SETTLE_MS);

    const step2 = labels(await driver.panelCards(page));
    // A different step must produce a different field set, not the same one again.
    expect(step2).not.toEqual(step1);
    expect(duplicates(step2)).toEqual([]);
  });

  test('never clicks the step button itself', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/multi-step.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const stepBefore = await page.evaluate(
      () => document.querySelector('[data-step-panel]:not([hidden])')?.getAttribute('data-step-panel') ?? null,
    );
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/);

    // `Next` and `Continue` are consequential: filling must never advance the form.
    const stepAfter = await page.evaluate(
      () => document.querySelector('[data-step-panel]:not([hidden])')?.getAttribute('data-step-panel') ?? null,
    );
    expect(stepAfter).toBe(stepBefore);
  });
});

// ─── Shadow DOM ───────────────────────────────────────────────────────────────

test.describe('shadow DOM', () => {
  test('reaches open shadow roots, including a nested one', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/shadow-dom.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const found = labels(await driver.panelCards(page));
    expect(found).toContain('Full Name (light DOM)');
    expect(found).toContain('Email Address');
    expect(found).toContain('Phone Number');
    // One level deeper, inside a second custom element's shadow root.
    expect(found).toContain('LinkedIn Profile');
  });

  test('cannot reach a closed shadow root, and does not pretend otherwise', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/shadow-dom.html');
    await driver.scan(page);
    await driver.showPanel(page);

    // The closed root really is closed: `attachShadow({ mode: 'closed' })` gives the page no
    // handle to it either, which is the security boundary working as intended.
    expect(
      await page.evaluate(() => (document.querySelector('fp-closed-card') as Element).shadowRoot),
    ).toBeNull();
    expect(labels(await driver.panelCards(page))).not.toContain('Hidden field');
  });

  test('fills a field inside a shadow root', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/shadow-dom.html');
    await driver.scan(page);
    await driver.showPanel(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/);

    const written = await page.evaluate(() => {
      const card = document.querySelector('fp-contact-card') as Element;
      const root = card.shadowRoot!;
      return {
        email: (root.querySelector('#s-email') as HTMLInputElement).value,
        phone: (root.querySelector('#s-phone') as HTMLInputElement).value,
        linkedin:
          (
            root
              .querySelector('fp-nested-links')!
              .shadowRoot!.querySelector('#n-linkedin') as HTMLInputElement
          ).value,
      };
    });
    expect(written.email).toBe('saiteja@example.com');
    expect(written.phone).toBe('+91 98765 43210');
    expect(written.linkedin).toContain('linkedin.com');
  });
});

// ─── iframes ──────────────────────────────────────────────────────────────────

test.describe('iframes', () => {
  test('reads a same-origin frame and refuses a cross-origin one', async ({ driver, server }) => {
    const page = await driver.openForm('/pages/cross-origin-frames.html');
    // Both frames serve the same fixture; only the addressing differs.
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('iframe')).every(
          (frame) => (frame as HTMLIFrameElement).src.length > 0,
        ),
      null,
      { timeout: 15_000 },
    );
    await page.waitForLoadState('load');

    const summary = await driver.scan(page);

    // The host field plus the same-origin frame's fields; nothing from the foreign frame.
    expect(summary.fieldsDetected).toBeGreaterThan(1);
    expect(summary.warnings.join(' ')).toMatch(/different origin/i);

    await driver.showPanel(page);
    const found = labels(await driver.panelCards(page));
    expect(found).toContain('Full Name (host page)');
    // basic-html.html's own fields, reached through the same-origin frame.
    expect(found).toContain('Email Address');

    // The foreign frame is genuinely unreadable, and the page cannot read it either.
    const foreignReadable = await page.evaluate((foreign) => {
      const frame = Array.from(document.querySelectorAll('iframe')).find((f) =>
        (f as HTMLIFrameElement).src.startsWith(foreign),
      ) as HTMLIFrameElement | undefined;
      if (!frame) return 'no such frame';
      try {
        return frame.contentDocument === null ? 'blocked' : 'readable';
      } catch {
        return 'blocked';
      }
    }, server.foreignOrigin);
    expect(foreignReadable).toBe('blocked');
  });

  test('fills a field inside a same-origin frame', async ({ driver }) => {
    const page = await driver.openForm('/pages/cross-origin-frames.html');
    await page.waitForLoadState('load');
    await driver.scan(page);
    await driver.showPanel(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/);

    const inFrame = await page.frameLocator('#same').locator('#email').inputValue();
    expect(inFrame).toBe('saiteja@example.com');
  });
});
