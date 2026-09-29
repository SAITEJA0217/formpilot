/**
 * Framework-controlled forms, in real Chromium.
 *
 * A controlled input's value belongs to the framework, not the DOM. React rewrites it on
 * every render; Vue's `v-model` and Angular's `ngModel` only update their model when the
 * event they listen for is dispatched; an Angular `FormControl` treats the DOM purely as a
 * view. So "the input shows the right text" proves nothing on its own — the next render can
 * wipe it.
 *
 * Every test here therefore asserts twice:
 *   1. against `window.__appState()`, which each app implements by reading its *framework*
 *      state (React `useState`, Vue `reactive`, Angular's model and `FormGroup`); and
 *   2. against the DOM after `window.__nudge()` has forced a render that touches no field,
 *      which is when a write that never reached state disappears.
 *
 * The apps are real framework builds (React 19, Vue 3 with the runtime template compiler so
 * real `v-model` codegen runs, Angular 18 JIT), built by `tests/e2e/apps/build.mjs`. The
 * Next.js case uses the repository's own App Router route against a real `next dev` server,
 * so server rendering and hydration are in the path too.
 */
import { test, expect } from '../fixtures/extension';
import type { Page } from '@playwright/test';

/** The subset of the seeded profile these forms can be filled from. */
const EXPECTED = {
  fullName: 'Saiteja Reddy Kotha',
  email: 'saiteja@example.com',
  phone: '+91 98765 43210',
  company: 'Nexturn Solutions',
  jobTitle: 'Software Engineer',
  country: 'India',
} as const;

interface AppHooks {
  __appState: () => Record<string, unknown>;
  __nudge: () => void;
  __submitted: boolean;
}

function hooks(page: Page): Promise<void> {
  return page.waitForFunction(
    () => typeof (window as unknown as AppHooks).__appState === 'function',
    null,
    { timeout: 30_000 },
  ) as unknown as Promise<void>;
}

const appState = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => (window as unknown as AppHooks).__appState());

const wasSubmitted = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as AppHooks).__submitted === true);

/**
 * Fill through the panel and wait for it to report completion.
 *
 * The engine writes fields one at a time and awaits each verification, so reading state
 * straight after the click reads it mid-fill. The panel's own toast is the completion
 * signal the user sees, which makes it the right thing to wait on.
 */
async function fillAndSettle(
  driver: { fillViaPanel: (page: Page) => Promise<void> },
  page: Page,
): Promise<void> {
  await driver.fillViaPanel(page);
  await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
    timeout: 30_000,
  });
}

/** Force a render that changes no field, then read the DOM back. */
async function domAfterRerender(page: Page): Promise<Record<string, string>> {
  await page.evaluate(() => (window as unknown as AppHooks).__nudge());
  // One frame is enough for React and Vue; Angular's tick() is synchronous.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const element of Array.from(document.querySelectorAll('input, textarea, select'))) {
      const control = element as HTMLInputElement;
      if (control.type === 'checkbox' || control.type === 'radio') {
        if (control.checked) out[control.name] = control.value || 'on';
      } else if (control.value) {
        out[control.name] = control.value;
      }
    }
    return out;
  });
}

const CLIENT_APPS = [
  { name: 'React 19 (controlled components)', path: '/apps/react.html', fields: 10, consent: 2 },
  { name: 'Vue 3 (v-model)', path: '/apps/vue.html', fields: 10, consent: 2 },
  { name: 'Angular 18 (ngModel + reactive FormGroup)', path: '/apps/angular.html', fields: 9, consent: 1 },
] as const;

for (const app of CLIENT_APPS) {
  test.describe(app.name, () => {
    test('writes reach framework state and survive a re-render', async ({ driver }) => {
      const page = await driver.openForm(app.path);
      await hooks(page);

      const summary = await driver.scan(page);
      expect(summary.fieldsDetected).toBe(app.fields);
      expect(summary.platform).toBe('generic-html');
      // A plain application page must not be claimed by any platform adapter, and so must
      // carry no warning. This caught a real bug: four adapters composed their marker
      // selectors as `${LIST_A} ${LIST_B}`, which CSS parses as a list whose last member is
      // a bare `legend`, so a page with one `<fieldset>` was claimed by SurveyMonkey.
      expect(summary.warnings).toEqual([]);

      await driver.showPanel(page);
      await fillAndSettle(driver, page);

      const state = await appState(page);
      for (const [key, value] of Object.entries(EXPECTED)) {
        expect(state[key], `${key} should be in framework state`).toBe(value);
      }

      // The real proof: a render that touches no field must not wipe the written values.
      const dom = await domAfterRerender(page);
      for (const [key, value] of Object.entries(EXPECTED)) {
        expect(dom[key], `${key} should survive a re-render`).toBe(value);
      }
    });

    test('never fills a consent control and never submits', async ({ driver }) => {
      const page = await driver.openForm(app.path);
      await hooks(page);

      const summary = await driver.scan(page);
      expect(summary.blocked).toBe(app.consent);

      await driver.showPanel(page);
      const cards = await driver.panelCards(page);
      const blocked = cards.filter((card) => card.blocked);
      expect(blocked).toHaveLength(app.consent);
      for (const card of blocked) {
        expect(card.value).toMatch(/must be made by you/i);
        expect(card.accepted).toBe(false);
      }

      await fillAndSettle(driver, page);

      const state = await appState(page);
      expect(state.newsletter, 'marketing consent must stay off').toBe(false);
      if (app.consent === 2) {
        expect(state.terms, 'legal agreement must stay off').toBe(false);
      }
      expect(
        await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).some(
            (box) => box.checked,
          ),
        ),
        'no checkbox may be checked by autofill',
      ).toBe(false);
      expect(await wasSubmitted(page), 'the form must never be submitted').toBe(false);
    });
  });
}

test.describe('Next.js 16 App Router (server-rendered, then hydrated)', () => {
  // Served through the test server's reverse proxy so the origin is one the extension can
  // inject into; the HTML, the JS and the hydration all come from a real `next dev`.
  const NEXT_FORM = '/next/test-forms/react';

  test('fills a hydrated controlled form and leaves the agreement alone', async ({ driver }) => {
    const page = await driver.openForm(NEXT_FORM);
    await page.locator('#r-name').waitFor({ state: 'visible' });

    // Hydration has to finish before React owns the inputs; until it does, a write would land
    // on server-rendered markup that hydration then replaces. `window.next.router` is Next's
    // own post-hydration marker, which is a better signal for a Next.js page than poking at
    // React's internal fiber keys — React 19 does not expose those as enumerable properties.
    await page.waitForFunction(
      () => {
        const next = (window as unknown as { next?: { router?: unknown } }).next;
        return !!next?.router;
      },
      null,
      { timeout: 30_000 },
    );

    const summary = await driver.scan(page);
    expect(summary.platform).toBe('generic-html');
    expect(summary.fieldsDetected).toBeGreaterThanOrEqual(10);
    expect(summary.warnings).toEqual([]);

    await driver.showPanel(page);
    await fillAndSettle(driver, page);

    const read = (): Promise<Record<string, string | boolean | null>> =>
      page.evaluate(() => ({
        fullName: document.querySelector<HTMLInputElement>('#r-name')?.value ?? '',
        email: document.querySelector<HTMLInputElement>('#r-email')?.value ?? '',
        phone: document.querySelector<HTMLInputElement>('#r-phone')?.value ?? '',
        company: document.querySelector<HTMLInputElement>('#r-company')?.value ?? '',
        agreed: document.querySelector<HTMLInputElement>('input[name="agreed"]')?.checked ?? null,
      }));

    const values = await read();

    // The marker above says hydration started; this says the writes survived it. If React had
    // hydrated after the fill it would reset every controlled input from its own empty state,
    // so a second read a moment later would come back blank.
    await page.waitForTimeout(1_000);
    expect(await read()).toEqual(values);

    expect(values.fullName).toBe(EXPECTED.fullName);
    expect(values.email).toBe(EXPECTED.email);
    expect(values.phone).toBe(EXPECTED.phone);
    expect(values.company).toBe(EXPECTED.company);
    expect(values.agreed, 'the agreement checkbox must stay unchecked').toBe(false);
  });
});
