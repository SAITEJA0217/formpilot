/**
 * Google Forms with conditional sections, in real Chromium.
 *
 * `google-forms.spec.ts` drives the single-page fixture. This one drives
 * `google-forms-advanced-mock.html`, whose sections are reached by pressing Next and whose *next*
 * section depends on an answer. Three things need a real browser rather than jsdom:
 *
 *   - the fixture's own navigation script runs, rather than a helper standing in for it
 *   - the MutationObserver in the content script has to notice the swap and re-detect on its own,
 *     with no rescan triggered from the test
 *   - the review panel has to replace its cards, which is what the user actually sees
 *
 * The fixture reproduces Google's published markup. It is not the live product, and nothing here is
 * evidence about `docs.google.com`; `research/compatibility-matrix.md` records what is.
 */
import { test, expect } from '../fixtures/extension';
import type { Page } from '@playwright/test';

const FIXTURE = '/test-forms/google-forms-advanced-mock.html';

/**
 * Open the fixture in a window wide enough that the panel is not over the form's own buttons.
 *
 * The panel is a fixed 400px column against the right edge. This fixture centres a 680px form, so
 * in the harness's default 1280px window the panel sits on top of the form's Next button and
 * Chromium refuses to click it. That overlap is a real constraint with its own test at the bottom of
 * this file; these tests are about section navigation, so they use a window where the two do not
 * fight, as a user on a normal desktop would have.
 *
 * Sized on the page rather than through `test.use({ viewport })`: the browser context here is
 * worker-scoped, so a spec-level viewport option never reaches it and would silently do nothing.
 */
async function openWide(driver: { openForm(path: string): Promise<Page> }): Promise<Page> {
  const page = await driver.openForm(FIXTURE);
  await page.setViewportSize({ width: 1600, height: 900 });
  return page;
}

const labelsOf = (cards: { label: string }[]): string[] => cards.map((card) => card.label);

/** Choose a branch, press Next, and let the observer settle. */
async function advance(page: Page, choice?: string): Promise<void> {
  if (choice) await page.locator(`[data-value="${choice}"]`).click();
  await page.locator('[data-section]:not([hidden]) [data-next]').click();
  await page.waitForTimeout(1_200);
}

test.describe('Google Forms sections in Chromium', () => {
  test('still selects the Google Forms adapter on this markup', async ({ driver }) => {
    const page = await openWide(driver);
    const summary = await driver.scan(page);

    expect(summary.platform).toBe('google-forms');
    // A Verified adapter carries no experimental warning.
    expect(summary.warnings.join(' ')).not.toMatch(/experimental/i);
    // Only the first section is in the DOM as visible content.
    expect(summary.fieldsDetected).toBe(8);
  });

  test('splits a date question into parts the user can tell apart', async ({ driver }) => {
    const page = await openWide(driver);
    await driver.scan(page);
    await driver.showPanel(page);

    const labels = labelsOf(await driver.panelCards(page));
    expect(labels).toContain('Start date — Day');
    expect(labels).toContain('Start date — Month');
    expect(labels).toContain('Start date — Year');
    // Three cards reading "Start date" would be three cards the user cannot choose between.
    expect(labels.filter((label) => label === 'Start date')).toHaveLength(0);
  });

  test('re-detects on its own when a section is replaced', async ({ driver }) => {
    const page = await openWide(driver);
    await driver.scan(page);
    await driver.showPanel(page);

    const before = labelsOf(await driver.panelCards(page));
    expect(before).toContain('Full Name');

    // No rescan from the test: the content script's observer has to see this itself.
    await advance(page, 'Full time');

    const after = labelsOf(await driver.panelCards(page));
    expect(after).toContain('Current Company');
    expect(after).not.toContain('Full Name');
  });

  test('follows the branch the answer chooses', async ({ driver }) => {
    const page = await openWide(driver);
    await driver.scan(page);
    await driver.showPanel(page);

    await advance(page, 'Contract');

    const after = labelsOf(await driver.panelCards(page));
    expect(after).toContain('Registered company name');
    expect(after).not.toContain('Current Company');
  });

  test('reads a checkbox grid as one multi-answer question per row', async ({ driver }) => {
    const page = await openWide(driver);
    await driver.scan(page);
    await driver.showPanel(page);
    await advance(page, 'Full time');

    const labels = labelsOf(await driver.panelCards(page));
    expect(labels).toContain('Which days can you work on site?: London office');
    expect(labels).toContain('Which days can you work on site?: Client site');
  });

  test('never presses Next or Submit, on any section', async ({ driver }) => {
    const page = await openWide(driver);
    await driver.scan(page);
    await driver.showPanel(page);

    const sectionNow = (): Promise<string | null> =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-section]:not([hidden])')
            ?.getAttribute('data-section') ?? null,
      );

    // Section 1, then the last section, since a rule that only holds on the first screen is not one.
    for (const step of [undefined, 'Contract'] as const) {
      if (step) {
        await advance(page, step);
        await advance(page);
      }
      const before = await sectionNow();
      await driver.acceptAll(page);
      await driver.fillViaPanel(page);
      await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
        timeout: 30_000,
      });
      expect(await sectionNow(), 'filling must not advance the form').toBe(before);
    }

    expect(
      await page.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted),
    ).not.toBe(true);
  });

  test('refuses the declaration on the final section', async ({ driver }) => {
    const page = await openWide(driver);
    await driver.scan(page);
    await driver.showPanel(page);
    await advance(page, 'Contract');
    await advance(page);

    const cards = await driver.panelCards(page);
    const declaration = cards.find((card) => card.label === 'Declaration');
    expect(declaration, 'the declaration must reach the panel').toBeTruthy();
    expect(declaration?.blocked).toBe(true);
    expect(declaration?.value).toMatch(/must be made by you/i);

    // Accept everything the panel offers. The declaration is blocked, so it has no Accept button
    // to click — which is the first half of the guarantee. Then fill, and check it stayed unticked.
    await driver.acceptAll(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="checkbox"]')).some(
          (box) => box.getAttribute('aria-checked') === 'true',
        ),
      ),
      'the declaration must stay unticked',
    ).toBe(false);
  });
});

/**
 * The panel overlaps a centred form in a narrow window.
 *
 * Not a hypothetical: the section-navigation tests above had to be given a wider window because
 * Chromium refused to click the form's own Next button — the panel was genuinely on top of it. This
 * records that behaviour rather than leaving it as a quirk of those tests, because a user whose
 * browser window is 1280px wide meets it on any centred form: the panel is a fixed 400px column on
 * the right, and a 680px form centred in 1280px reaches to within 300px of the right edge.
 *
 * It is a layout constraint, not a safety problem — the panel has a Close button and the page is
 * fully usable again the moment it is closed, which is what this asserts. `research/limitations.md`
 * records it as a known limitation.
 */
test.describe('the panel in a narrow window', () => {
  test('can cover the form\'s own buttons, and closing it gives them back', async ({ driver }) => {
    // The harness default, 1280x720: the window where the overlap happens.
    const page = await driver.openForm(FIXTURE);
    await driver.scan(page);
    await driver.showPanel(page);

    const next = page.locator('[data-section]:not([hidden]) [data-next]');
    await next.scrollIntoViewIfNeeded();

    // Chromium's own hit test at the button's centre, which is what decides whether a click lands.
    // Measuring the rectangles instead would have missed it: the overlap only appears once the
    // button is scrolled into view, which is the position a user clicking it is looking at.
    const topmostAtButton = await page.evaluate(() => {
      const button = document.querySelector('[data-section]:not([hidden]) [data-next]');
      if (!button) return null;
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit?.id || hit?.tagName || null;
    });
    expect(topmostAtButton, 'this test is about the case where the panel is on top').toBe(
      'formpilot-root',
    );

    // Closing the panel hands the page back, unchanged.
    await page.locator('#formpilot-root [aria-label="Close FormPilot"]').click();
    await expect(page.locator('#formpilot-root')).toHaveCount(0);
    await next.click({ timeout: 5_000 });
    await expect(page.locator('[data-section="2"], [data-section="3"]').first()).toBeVisible();
  });
});
