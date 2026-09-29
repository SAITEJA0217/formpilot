/**
 * The four experimental platform adapters, in real Chromium, against local reproductions.
 *
 * **What this proves and what it does not.** `forms.office.com`, `form.typeform.com`,
 * `www.jotform.com` and `www.surveymonkey.com` are all denied at CONNECT by this environment's
 * network policy — `./research/platform-probe/probe.sh` records the evidence. So every page here is
 * a reproduction of the markup its platform publishes, not the platform.
 *
 * A pass means the adapter reads *that structure* correctly in a real browser, with real ARIA
 * semantics, real click handling on controls that are not native inputs, and the real shadow-DOM
 * review panel on top. It does **not** mean the live product still emits that structure. That is why
 * `research/compatibility-matrix.md` records all four as **Experimental** and why no row here may be
 * cited as live-platform validation.
 *
 * The integration suite already exercises the adapters' parsing in jsdom. This spec exists for what
 * jsdom cannot do: real event dispatch into non-native controls, real rendering, and the
 * one-question-per-screen advance that Typeform's markup implies.
 */
import { test, expect } from '../fixtures/extension';
import type { Page } from '@playwright/test';

interface PlatformCase {
  name: string;
  fixture: string;
  platform: string;
  adapterId: string;
  /** Fields the ground truth says this page has. */
  fields: number;
  /** Labels that must appear in the panel — the ones the adapter has to work for. */
  mustSee: string[];
  /**
   * A value that must end up in the DOM.
   *
   * Per platform rather than shared, because Jotform splits one logical question across several
   * inputs: its name control fills "Saiteja" and "Reddy Kotha" into separate boxes and the full
   * name never appears as a single value. Asserting a full name there would be asserting that the
   * composite handling is broken.
   */
  expectWritten: string;
}

const PLATFORMS: PlatformCase[] = [
  {
    name: 'Microsoft Forms',
    fixture: '/test-forms/microsoft-forms-mock.html',
    platform: 'microsoft-forms',
    adapterId: 'microsoft-forms@1-experimental',
    fields: 10,
    mustSee: ['Full Name', 'Years of Experience', 'Technical Skills', 'Rate your React proficiency'],
    expectWritten: 'Saiteja Reddy Kotha',
  },
  {
    name: 'Jotform',
    fixture: '/test-forms/jotform-mock.html',
    platform: 'jotform',
    adapterId: 'jotform@1-experimental',
    fields: 15,
    // The composite controls are the adapter's whole reason to exist: Jotform splits one
    // logical question across several inputs with sub-labels.
    mustSee: ['Name — First Name', 'Address — City', 'Address — Postal / Zip Code'],
    // The composite name fills first and last separately, so the given name is what to look for.
    expectWritten: 'Saiteja',
  },
  {
    name: 'SurveyMonkey',
    fixture: '/test-forms/surveymonkey-mock.html',
    platform: 'surveymonkey',
    adapterId: 'surveymonkey@1-experimental',
    fields: 8,
    // Matrix rows flatten to one field each, which is what the row labels prove.
    mustSee: ['Rate your confidence: Frontend', 'Rate your confidence: Backend'],
    expectWritten: 'Saiteja Reddy Kotha',
  },
];

const labelsOf = (cards: { label: string }[]): string[] => cards.map((card) => card.label);

for (const platform of PLATFORMS) {
  test.describe(`${platform.name} reproduction in Chromium`, () => {
    test('selects the platform adapter and labels it experimental', async ({ driver }) => {
      const page = await driver.openForm(platform.fixture);
      const summary = await driver.scan(page);

      expect(summary.platform).toBe(platform.platform);
      expect(summary.fieldsDetected).toBe(platform.fields);
      // An experimental adapter must say so. A user acting on its suggestions is entitled to know
      // it has never been run against the live product.
      expect(summary.warnings.join(' ')).toMatch(/experimental/i);
      expect(summary.warnings.join(' ')).toMatch(/review every suggestion/i);
    });

    test('reads the structures the adapter exists for', async ({ driver }) => {
      const page = await driver.openForm(platform.fixture);
      await driver.scan(page);
      await driver.showPanel(page);

      const labels = labelsOf(await driver.panelCards(page));
      for (const expected of platform.mustSee) {
        expect(labels, `${platform.name} should surface "${expected}"`).toContain(expected);
      }
    });

    test('runs the pipeline through to a verified write', async ({ driver }) => {
      const page = await driver.openForm(platform.fixture);
      const summary = await driver.scan(page);
      expect(summary.ready + summary.needsReview).toBeGreaterThan(0);

      await driver.showPanel(page);
      const cards = await driver.panelCards(page);
      // Provenance and a confidence badge on every suggestion that carries a value. A file field
      // is the exception by design: it shows "your choice" rather than a percentage, because the
      // user picks the document and there is no confidence in that.
      const withValue = cards.filter((card) => card.source.startsWith('Source:'));
      expect(withValue.length).toBeGreaterThan(0);
      const NON_NUMERIC_BADGES = /^(your choice|protected)$/i;
      for (const card of withValue) {
        expect(card.badge, `${card.label} needs a confidence badge or a stated reason`).toMatch(
          new RegExp(`%$|${NON_NUMERIC_BADGES.source.slice(1, -1)}`, 'i'),
        );
      }

      // Accept everything the panel offers, the way a user reviewing it would. `fillViaPanel`
      // writes only accepted suggestions, and a medium-confidence one is not pre-accepted —
      // Jotform's composite labels ("Name — First Name") land at 0.84–0.86, just under the
      // auto-accept band, because splitting a composite control is inherently less certain than
      // reading a plain label. Filling without accepting first would test the wrong thing.
      await driver.acceptAll(page);

      await driver.fillViaPanel(page);
      await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
        timeout: 30_000,
      });

      // The engine reports only writes it read back, so check the page agrees.
      const written = await page.evaluate(() => {
        const values: string[] = [];
        for (const element of Array.from(document.querySelectorAll('input, textarea, select'))) {
          const control = element as HTMLInputElement;
          if (control.type !== 'checkbox' && control.type !== 'radio' && control.value) {
            values.push(control.value);
          }
        }
        for (const element of Array.from(document.querySelectorAll('[contenteditable="true"]'))) {
          const text = element.textContent?.trim();
          if (text) values.push(text);
        }
        return values.join(' | ');
      });
      expect(written).toContain(platform.expectWritten);
    });

    test('never submits and never ticks a consent control', async ({ driver }) => {
      const page = await driver.openForm(platform.fixture);
      await driver.scan(page);
      await driver.showPanel(page);
      await driver.fillViaPanel(page);
      await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
        timeout: 30_000,
      });

      const submitted = await page.evaluate(
        () => (window as unknown as { __submitted?: boolean }).__submitted === true,
      );
      expect(submitted).toBe(false);

      // Consent phrasing on any boolean control, native or ARIA.
      const consentTicked = await page.evaluate(() => {
        const consent = /agree|consent|terms|privacy|certify|declare/i;
        const native = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).some(
          (box) => box.checked && consent.test(box.labels?.[0]?.textContent ?? box.getAttribute('aria-label') ?? ''),
        );
        const aria = Array.from(document.querySelectorAll('[role="checkbox"]')).some(
          (box) =>
            box.getAttribute('aria-checked') === 'true' &&
            consent.test(box.getAttribute('aria-label') ?? box.textContent ?? ''),
        );
        return native || aria;
      });
      expect(consentTicked).toBe(false);
    });
  });
}

/**
 * Typeform, separately, because its interaction model is different.
 *
 * Typeform shows one question at a time and advances on a button press. The reproduction does the
 * same, so the adapter must detect only the visible block and the engine must re-detect after the
 * page advances — which is the multi-step path, exercised here on platform markup rather than on a
 * generic wizard.
 */
test.describe('Typeform reproduction in Chromium', () => {
  /** Advance past the visible block and let the observer settle. */
  async function advance(page: Page): Promise<void> {
    await page.locator('[data-qa="ok-button"]').first().click();
    await page.waitForTimeout(1_200);
  }

  test('sees only the block on screen', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/typeform-mock.html');
    const summary = await driver.scan(page);

    expect(summary.platform).toBe('typeform');
    // One question per screen: detecting the whole form would be the bug.
    expect(summary.fieldsDetected).toBe(1);
    expect(summary.warnings.join(' ')).toMatch(/experimental/i);

    await driver.showPanel(page);
    expect(labelsOf(await driver.panelCards(page))).toContain('What is your full name?');
  });

  test('re-detects after the form advances', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/typeform-mock.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const first = labelsOf(await driver.panelCards(page));
    await advance(page);
    const second = labelsOf(await driver.panelCards(page));

    // A different question, not the same one again and not both at once.
    expect(second).not.toEqual(first);
    expect(second.length).toBeGreaterThan(0);
  });

  test('never presses the advance button itself', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/typeform-mock.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const before = await page.evaluate(
      () => document.querySelectorAll('[data-qa="block-container"]:not([hidden])').length,
    );
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/);

    // `OK` advances the form. Filling must never do that — the user decides when to move on.
    const after = await page.evaluate(
      () => document.querySelectorAll('[data-qa="block-container"]:not([hidden])').length,
    );
    expect(after).toBe(before);
  });
});

/**
 * Degradation, in a real browser.
 *
 * An adapter must require its platform's *markup*, not just a URL that looks right. This is the
 * failure mode that actually bit: a selector-composition bug once let the SurveyMonkey adapter claim
 * any page containing a single `<fieldset>`, and a plain React page came back labelled as a platform
 * reproduction.
 */
test.describe('adapter selection is conservative', () => {
  test('a plain page is never claimed by a platform adapter', async ({ driver }) => {
    for (const fixture of ['/test-forms/basic-html.html', '/apps/react.html', '/apps/vue.html']) {
      const page = await driver.openForm(fixture);
      const summary = await driver.scan(page);
      expect(summary.platform, `${fixture} must fall to the generic engine`).toBe('generic-html');
      expect(summary.warnings, `${fixture} must carry no experimental warning`).toEqual([]);
      await page.close();
    }
  });
});
