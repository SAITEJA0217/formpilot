/**
 * A six-step application, walked end to end in real Chromium.
 *
 * `tests/integration/multi-step.test.ts` covers step detection and session state in jsdom. This
 * covers what jsdom cannot: the panel replacing its cards as the user advances, decisions surviving
 * a walk forwards and back, and — the part that matters most — that nothing in the flow submits.
 *
 * The release brief asks for field identity, selected value, confidence, provenance and *user edits*
 * to survive the walk. Each of those is a separate assertion below, because they fail separately: a
 * session can keep a value and lose its provenance, or keep both and quietly discard the edit the
 * user made over the top.
 *
 * The fixture is `multi-step-application.html`, whose questions step is prose written to tempt a
 * wrong structured mapping, and whose review step ends in a declaration and a typed signature.
 */
import { test, expect } from '../fixtures/extension';
import type { Page } from '@playwright/test';

const FIXTURE = '/test-forms/multi-step-application.html';

interface Card {
  label: string;
  value: string;
  badge: string;
  source: string;
  blocked: boolean;
  accepted: boolean;
}

const labelsOf = (cards: Card[]): string[] => cards.map((card) => card.label);

/**
 * Advance one step and let the content script's observer notice.
 *
 * The wizard's Next button is at the bottom of the form, away from the panel's column, so unlike the
 * Google Forms fixture this one needs no special viewport.
 */
async function next(page: Page): Promise<void> {
  await page.locator('#next').click();
  await page.waitForTimeout(1_000);
}

async function back(page: Page): Promise<void> {
  await page.locator('#prev').click();
  await page.waitForTimeout(1_000);
}

const currentStep = (page: Page): Promise<string | null> =>
  page.evaluate(
    () => document.querySelector('ol.steps li[aria-current="step"]')?.textContent?.trim() ?? null,
  );

test.describe('six-step application in Chromium', () => {
  test('reports the step the user is on, not the whole form', async ({ driver }) => {
    const page = await driver.openForm(FIXTURE);
    const summary = await driver.scan(page);

    expect(summary.platform).toBe('generic-html');
    // Step one has four fields. Counting all six steps would be reporting fields the user cannot see.
    expect(summary.fieldsDetected).toBe(4);
    expect(await currentStep(page)).toBe('Personal');
  });

  test('re-detects each step as the user walks forward', async ({ driver }) => {
    const page = await driver.openForm(FIXTURE);
    await driver.scan(page);
    await driver.showPanel(page);

    const seen: string[][] = [labelsOf(await driver.panelCards(page))];
    for (let step = 2; step <= 6; step += 1) {
      await next(page);
      seen.push(labelsOf(await driver.panelCards(page)));
    }

    expect(seen[0]).toContain('Full Name');
    expect(seen[1]).toContain('Degree');
    expect(seen[2]).toContain('Current Company');
    expect(seen[3]).toContain('Upload Resume');
    expect(seen[4]).toContain('Where do you see yourself in five years?');
    expect(seen[5]).toContain('Type your full name to sign');

    // Each step replaces the last rather than accumulating.
    expect(seen[1]).not.toContain('Full Name');
    expect(await currentStep(page)).toBe('Review');
  });

  /**
   * Identity, value, confidence and provenance all at once, because the session keys decisions by
   * field identity rather than by DOM id — so a card that comes back with the same label but a
   * different confidence or a missing source has lost something even though it looks present.
   */
  test('a decision survives going forward and coming back, whole', async ({ driver }) => {
    const page = await driver.openForm(FIXTURE);
    await driver.scan(page);
    await driver.showPanel(page);

    const before = (await driver.panelCards(page)).find((card) => card.label === 'Full Name');
    expect(before).toBeTruthy();
    expect(before?.source).toMatch(/^Source:/);

    await next(page);
    await back(page);

    const after = (await driver.panelCards(page)).find((card) => card.label === 'Full Name');
    expect(after, 'the field must be found again by identity').toBeTruthy();
    expect(after?.value, 'the selected value must survive').toBe(before?.value);
    expect(after?.badge, 'the confidence must survive').toBe(before?.badge);
    expect(after?.source, 'the provenance must survive').toBe(before?.source);
    expect(after?.accepted).toBe(before?.accepted);
  });

  test('an edit the user made survives the walk, and is written as edited', async ({ driver }) => {
    const page = await driver.openForm(FIXTURE);
    await driver.scan(page);
    await driver.showPanel(page);

    // Edit the suggestion by hand, the way a user correcting a value would: press Edit, type, Save.
    // The card carries no editor until Edit is pressed.
    const edited = 'S. R. Kotha (edited)';
    const card = page.locator('#formpilot-root .card').filter({ hasText: 'Full Name' }).first();
    await card.locator('.btn', { hasText: /^Edit$/ }).click();
    await card.locator('textarea.value, input.value').first().fill(edited);
    await card.locator('.btn.primary', { hasText: /^Save$/ }).click();
    await page.waitForTimeout(300);

    // Walk to the far end of the wizard and back.
    for (let step = 0; step < 5; step += 1) await next(page);
    for (let step = 0; step < 5; step += 1) await back(page);

    const after = (await driver.panelCards(page)).find((c) => c.label === 'Full Name');
    expect(after?.value, 'the edit must not be replaced by the original suggestion').toBe(edited);

    // And the edit, not the suggestion, is what reaches the page.
    await driver.acceptAll(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });
    expect(await page.inputValue('#a-name')).toBe(edited);
  });

  test('values entered on an earlier step reach the review summary', async ({ driver }) => {
    const page = await driver.openForm(FIXTURE);
    await driver.scan(page);
    await driver.showPanel(page);
    await driver.acceptAll(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });

    for (let step = 0; step < 5; step += 1) await next(page);

    // The fixture's review step reads the form back, so this shows the value survived the walk in
    // the page rather than only in the panel.
    const summary = await page.textContent('[data-summary]');
    expect(summary).toContain('Saiteja Reddy Kotha');
    expect(summary).not.toContain('—\n—');
  });

  /**
   * The prose step, in the browser. Two of these were real defects: "How would your last manager
   * describe you?" was answered with the profile's surname, and "Which company do you admire most
   * and why?" with the user's own employer at 0.93 — above the auto-accept band.
   */
  test('never pre-accepts an answer to a prose question', async ({ driver }) => {
    const page = await driver.openForm(FIXTURE);
    await driver.scan(page);
    await driver.showPanel(page);
    for (let step = 0; step < 4; step += 1) await next(page);

    const cards = await driver.panelCards(page);
    const prose = cards.filter((card) => card.label.endsWith('?'));
    expect(prose.length).toBeGreaterThanOrEqual(3);
    for (const card of prose) {
      expect(card.accepted, `${card.label} must not be pre-accepted`).toBe(false);
    }

    const manager = cards.find((card) => card.label.startsWith('How would your last manager'));
    expect(manager?.value ?? '').not.toContain('Kotha');
  });

  /**
   * The review step, which is where a careless autofill does the most damage: it holds the
   * declaration, the third-party consent and the signature, and the submit button.
   */
  test('refuses the declaration, the consent and the signature', async ({ driver }) => {
    const page = await driver.openForm(FIXTURE);
    await driver.scan(page);
    await driver.showPanel(page);
    for (let step = 0; step < 5; step += 1) await next(page);

    const cards = await driver.panelCards(page);
    const blocked = cards.filter((card) => card.blocked).map((card) => card.label);
    expect(blocked).toContain('I certify that the information in this application is true and correct');
    expect(blocked).toContain('I consent to my data being shared with third-party recruiters');
    expect(blocked, 'a typed signature is the signature').toContain('Type your full name to sign');

    const signature = cards.find((card) => card.label === 'Type your full name to sign');
    expect(signature?.value).toMatch(/only you can do/i);
  });

  test('fills every step without ever submitting', async ({ driver }) => {
    const page = await driver.openForm(FIXTURE);
    await driver.scan(page);
    await driver.showPanel(page);

    for (let step = 1; step <= 6; step += 1) {
      await driver.acceptAll(page);
      // The Documents step offers only a file field, and the review step only blocked controls, so
      // there is nothing to accept and the Fill button is correctly disabled. Pressing it anyway
      // would be testing the harness, not the product.
      const fill = page.locator('#formpilot-root .footer .btn.primary');
      if (await fill.isEnabled()) {
        await driver.fillViaPanel(page);
        await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
          timeout: 30_000,
        });
      }
      expect(
        await page.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted),
        `must not submit on step ${step}`,
      ).not.toBe(true);
      if (step < 6) await next(page);
    }

    // On the last step, nothing that commits the user may have been touched.
    expect(await page.isChecked('#a-certify')).toBe(false);
    expect(await page.isChecked('#a-consent')).toBe(false);
    expect(await page.inputValue('#a-signature')).toBe('');
    expect(
      await page.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted),
    ).not.toBe(true);
  });
});
