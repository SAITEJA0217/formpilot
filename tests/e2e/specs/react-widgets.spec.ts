/**
 * React 19: uncontrolled inputs, widgets built from divs, and fields split across components.
 *
 * `frameworks.spec.ts` drives the controlled-component apps, which is the hard case for *writing* —
 * React reverts a naive `element.value = x` on its next render. This spec covers the cases that
 * break different assumptions, all of which the release brief names under generic web-form coverage:
 *
 *   - UNCONTROLLED inputs, where the DOM owns the value and React only learns of a change if the
 *     right events fired. The opposite failure: a write that sticks in the DOM and never reaches the
 *     app. `window.__readRefs()` reads through React's refs, so the two are distinguishable.
 *   - a CUSTOM SELECT with no `<select>` and no value property, whose options exist in the DOM only
 *     while it is open.
 *   - CUSTOM CHECKBOXES and a CUSTOM RADIO GROUP built from divs, with consent on a custom control
 *     so the safety rule cannot lean on `type="checkbox"`.
 *   - NESTED components, where the label and the input are rendered by different components several
 *     levels apart.
 */
import { test, expect } from '../fixtures/extension';

const APP = '/apps/react-widgets.html';

interface AppState {
  country: string;
  experience: string;
  marketing: boolean;
  agreed: boolean;
  company: string;
  jobTitle: string;
}

const labelsOf = (cards: { label: string }[]): string[] => cards.map((card) => card.label);

test.describe('React custom widgets', () => {
  test('falls to the generic engine with no platform warning', async ({ driver }) => {
    const page = await driver.openForm(APP);
    const summary = await driver.scan(page);

    expect(summary.platform).toBe('generic-html');
    expect(summary.warnings).toEqual([]);
  });

  /**
   * The defect this app was written to find.
   *
   * Two independent custom checkboxes — a marketing opt-in and a legal consent — sat side by side in
   * one `<fieldset>`. Because neither carries a `name`, the detector grouped ARIA options by shared
   * parent element, and the two became a single field labelled with the fieldset's legend: one
   * control standing for two unrelated decisions, under a label naming neither.
   */
  test('keeps two independent custom checkboxes as two separate questions', async ({ driver }) => {
    const page = await driver.openForm(APP);
    await driver.scan(page);
    await driver.showPanel(page);

    const labels = labelsOf(await driver.panelCards(page));
    expect(labels).toContain('Send me product updates');
    expect(labels).toContain('I agree to the terms and conditions');
    // The fieldset's legend is a section heading, never a question.
    expect(labels).not.toContain('Custom widgets');
  });

  test('refuses both, each with its own card', async ({ driver }) => {
    const page = await driver.openForm(APP);
    await driver.scan(page);
    await driver.showPanel(page);

    const blocked = (await driver.panelCards(page)).filter((card) => card.blocked);
    expect(blocked.map((card) => card.label).sort()).toEqual([
      'I agree to the terms and conditions',
      'Send me product updates',
    ]);
    for (const card of blocked) {
      expect(card.accepted).toBe(false);
      expect(card.value).toMatch(/must be made by you/i);
    }
  });

  test('reads an uncontrolled input and the app sees the value', async ({ driver }) => {
    const page = await driver.openForm(APP);
    const summary = await driver.scan(page);
    expect(summary.fieldsDetected).toBe(9);

    await driver.showPanel(page);
    await driver.acceptAll(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });

    // Read through React's own refs: a write that skipped the events would leave these empty even
    // though the DOM looked right.
    const refs = await page.evaluate(() =>
      (window as unknown as { __readRefs(): Record<string, string> }).__readRefs(),
    );
    expect(refs.fullName).toBe('Saiteja Reddy Kotha');
    expect(refs.email).toBe('saiteja@example.com');
    expect(refs.phone).toBeTruthy();
  });

  test('drives a select that has no select element', async ({ driver }) => {
    const page = await driver.openForm(APP);
    await driver.scan(page);
    await driver.showPanel(page);
    await driver.acceptAll(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });

    const state = await page.evaluate(() =>
      (window as unknown as { __appState(): AppState }).__appState(),
    );
    // The value has to be in React state, not just shown in the div: the options only exist while
    // the listbox is open, so a write that did not open it could not have selected anything.
    expect(state.country).toBe('India');
    // And the widget must be left closed, the way a user leaves it.
    expect(await page.locator('[role="option"]').count()).toBe(0);
  });

  test('reads a field whose label and input are in different components', async ({ driver }) => {
    const page = await driver.openForm(APP);
    await driver.scan(page);
    await driver.showPanel(page);

    const labels = labelsOf(await driver.panelCards(page));
    expect(labels).toContain('Current company');
    expect(labels).toContain('Job title');

    await driver.acceptAll(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });

    const state = await page.evaluate(() =>
      (window as unknown as { __appState(): AppState }).__appState(),
    );
    expect(state.company).toBeTruthy();
    expect(state.jobTitle).toBeTruthy();
  });

  test('writes survive a render that touches no field', async ({ driver }) => {
    const page = await driver.openForm(APP);
    await driver.scan(page);
    await driver.showPanel(page);
    await driver.acceptAll(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });

    const before = await page.evaluate(() =>
      (window as unknown as { __appState(): AppState }).__appState(),
    );
    await page.evaluate(() => (window as unknown as { __nudge(): void }).__nudge());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() =>
      (window as unknown as { __appState(): AppState }).__appState(),
    );
    expect(after).toEqual(before);
  });

  test('never ticks either custom checkbox and never submits', async ({ driver }) => {
    const page = await driver.openForm(APP);
    await driver.scan(page);
    await driver.showPanel(page);
    await driver.acceptAll(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 30_000,
    });

    const state = await page.evaluate(() =>
      (window as unknown as { __appState(): AppState }).__appState(),
    );
    expect(state.agreed, 'legal consent must stay off').toBe(false);
    expect(state.marketing, 'marketing consent must stay off').toBe(false);

    // And in the DOM, on controls the policy cannot recognise by input type.
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="checkbox"]')).some(
          (box) => box.getAttribute('aria-checked') === 'true',
        ),
      ),
    ).toBe(false);
    expect(
      await page.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted),
    ).toBe(false);
  });
});
