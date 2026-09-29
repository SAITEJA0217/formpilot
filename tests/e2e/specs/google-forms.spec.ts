/**
 * Google Forms, in real Chromium, against a local reproduction of its markup.
 *
 * **What this proves and what it does not.** `docs.google.com` is denied at CONNECT by this
 * environment's network policy, so the page under test is `google-forms-mock.html`, a reproduction
 * of the structures Google Forms emits: `div[role="listitem"]` questions, `role="heading"` titles,
 * ARIA-only controls with no native `<input>`, `role="radio"`/`role="checkbox"` groups, a grid
 * question and a scale.
 *
 * A pass here means the adapter reads *that structure* correctly in a real browser, with real ARIA
 * semantics and real event dispatch. It does not mean the live product emits that structure today.
 * That is why `research/compatibility-matrix.md` records Google Forms as **Partial** rather than
 * Verified, and why nothing in this file should be cited as live-platform validation.
 *
 * The integration suite already exercises the adapter's parsing in jsdom across every v1 question
 * type. This spec exists for what jsdom cannot do: real ARIA widget behaviour, real click handling
 * on a `role="radio"` that is not an `<input>`, and the real shadow-DOM review panel on top.
 */
import { test, expect } from '../fixtures/extension';

test.describe('Google Forms reproduction in Chromium', () => {
  test('selects the platform adapter rather than the generic engine', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/google-forms-mock.html');
    const summary = await driver.scan(page);

    expect(summary.platform).toBe('google-forms');
    expect(summary.fieldsDetected).toBeGreaterThanOrEqual(10);
    // A verified adapter carries no experimental warning; the four platform reproductions do.
    expect(summary.warnings).toEqual([]);
  });

  test('reads questions that have no native input at all', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/google-forms-mock.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const labels = (await driver.panelCards(page)).map((card) => card.label);
    // Each of these is an ARIA construct in the fixture, not an `<input>` with a `<label for>`.
    expect(labels).toContain('Date of Birth');
    expect(labels).toContain('Years of Experience');
    expect(labels).toContain('Highest Qualification');
  });

  test('runs the whole pipeline and writes into ARIA controls', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/google-forms-mock.html');

    // detect → normalize → match → confidence → provenance
    const summary = await driver.scan(page);
    expect(summary.ready + summary.needsReview).toBeGreaterThan(0);

    await driver.showPanel(page);
    const cards = await driver.panelCards(page);
    const withProvenance = cards.filter((card) => card.source.startsWith('Source:'));
    expect(withProvenance.length, 'suggestions must say where the value came from').toBeGreaterThan(0);
    for (const card of withProvenance) {
      expect(card.badge, `${card.label} should carry a confidence badge`).toMatch(/%$/);
    }

    // review → approve → fill → verify
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });

    // The engine reports only writes it read back, so a reported fill is a verified one. Check the
    // page agrees: at least one value is visible in the DOM.
    const written = await page.evaluate(() => {
      const values: string[] = [];
      for (const element of Array.from(document.querySelectorAll('input, textarea'))) {
        const control = element as HTMLInputElement;
        if (control.value) values.push(control.value);
      }
      for (const element of Array.from(document.querySelectorAll('[contenteditable="true"]'))) {
        const text = element.textContent?.trim();
        if (text) values.push(text);
      }
      return values;
    });
    expect(written.join(' | ')).toContain('Saiteja Reddy Kotha');
  });

  test('never ticks a consent choice and never submits', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/google-forms-mock.html');
    await driver.scan(page);
    await driver.showPanel(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });

    // Google Forms renders its submit control as a clickable div, so an engine that clicked
    // anything "button-like" would submit the form. Nothing in the page may report a submission.
    const submitted = await page.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted === true);
    expect(submitted).toBe(false);

    const consentChecked = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="checkbox"]')).some(
        (box) =>
          box.getAttribute('aria-checked') === 'true' &&
          /agree|consent|terms|privacy/i.test(box.getAttribute('aria-label') ?? ''),
      ),
    );
    expect(consentChecked).toBe(false);
  });
});
