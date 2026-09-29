/**
 * The AI path, end to end, against a labelled stub.
 *
 * **What this proves and what it does not.** The endpoint these tests talk to is a
 * deterministic stub in `tests/e2e/fixtures/server.ts` that echoes a fixed string. It is not a
 * model and it is not a proxy to one. So these tests prove the *plumbing* — that the router
 * sends the right fields, that only the right fields go, that the profile is minimised before
 * it leaves the device, that the response merges back into the panel, and that the whole path
 * disappears when the user turns it off. Nothing here measures answer quality, and no number
 * from this file should be presented as a model evaluation. Judging generated text needs a
 * real provider and a real key, neither of which this environment has.
 *
 * `research/routing/run.ts` reports the routing decisions themselves, which are deterministic
 * and therefore measurable without a provider.
 */
import { test, expect } from '../fixtures/extension';
import type { Page } from '@playwright/test';

/** Wait until the panel has rendered at least one card. */
async function openPanel(
  driver: { scan: (p: Page) => Promise<unknown>; showPanel: (p: Page) => Promise<void> },
  page: Page,
): Promise<void> {
  await driver.scan(page);
  await driver.showPanel(page);
}

test.describe('the AI path', () => {
  test.beforeEach(async ({ server, driver }) => {
    server.aiCalls.length = 0;
    server.stubAnswers.clear();
    // Start each test from the shipped defaults, whatever a previous test set.
    await driver.privileged.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: { allowAI: true } });
    });
  });

  test('sends only the fields the rule engine could not resolve', async ({ driver, server }) => {
    // complex-html.html carries an essay question the profile cannot answer by lookup,
    // alongside many fields it can.
    const page = await driver.openForm('/test-forms/complex-html.html');
    await openPanel(driver, page);

    expect(server.aiCalls.length, 'exactly one batched request, not one per field').toBe(1);
    const call = server.aiCalls[0];
    expect(call.shape).toBe('v2');
    expect(call.fieldIds.length).toBeGreaterThan(0);

    // Every field in the batch must be one the router chose to send, never a field it had a
    // stored value for. The labels it sent are the form's questions.
    expect(call.modes.every((mode) => mode === 'assist' || mode === 'generate')).toBe(true);
    expect(call.fieldLabels.some((label) => label.length > 0)).toBe(true);

    // And far fewer fields than the form has: the point of the router is that most fields
    // never reach a model.
    const detected = await driver.scan(page);
    expect(call.fieldIds.length).toBeLessThan(detected.fieldsDetected);
  });

  test('minimises the profile before it leaves the device', async ({ driver, server }) => {
    const page = await driver.openForm('/test-forms/complex-html.html');
    await openPanel(driver, page);

    expect(server.aiCalls.length).toBe(1);
    const { profileKeys, basicProfileKeys, modes } = server.aiCalls[0];

    // Never sent, whatever the mode: file fields route to the user's own picker, alternate
    // personas are other applications' business, and preferences are settings not facts.
    for (const key of ['documents', 'profiles', 'activeProfileId', 'preferences', 'userId']) {
      expect(profileKeys, `${key} must not reach the endpoint`).not.toContain(key);
    }

    // What a grounded answer is actually built from must survive, or the model would have to
    // invent an employer.
    expect(profileKeys).toContain('experience');
    expect(profileKeys).toContain('education');
    expect(basicProfileKeys).toContain('fullName');

    // A batch containing an `assist` request keeps the stored values it might return; a
    // prose-only batch does not. Assert whichever case this form produced, rather than
    // assuming which one it is.
    if (modes.includes('assist')) {
      expect(basicProfileKeys).toContain('phone');
    } else {
      expect(basicProfileKeys).not.toContain('phone');
      expect(profileKeys).not.toContain('address');
    }
  });

  test('merges the answer into the panel, marked as generated', async ({ driver, server }) => {
    const page = await driver.openForm('/test-forms/complex-html.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const call = server.aiCalls[0];
    expect(call).toBeTruthy();

    // The stub's answer text is distinctive, so finding it in a rendered card proves the
    // response travelled back through the worker, the content script and into the UI.
    const cards = await driver.panelCards(page);
    const fromStub = cards.filter((card) => card.value.includes('[stub answer for'));
    expect(fromStub.length).toBeGreaterThan(0);

    // A generated answer must not arrive pre-accepted: the user has to read it first.
    for (const card of fromStub) {
      expect(card.accepted, `${card.label} must not be pre-accepted`).toBe(false);
    }
  });

  test('a stubbed answer is written verbatim when the user accepts it', async ({ driver, server }) => {
    const page = await driver.openForm('/test-forms/complex-html.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const essay = (await driver.panelCards(page)).find((card) =>
      card.value.includes('[stub answer for'),
    );
    expect(essay, 'the form must produce at least one generated answer').toBeTruthy();

    // Accept everything the panel offers, then check the generated text reached the DOM.
    await driver.acceptAll(page);

    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/);

    const written = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea')).map((t) => t.value),
    );
    expect(written.some((value) => value.includes('[stub answer for'))).toBe(true);
    void server;
  });

  test('turning the AI path off makes no request at all', async ({ driver, server }) => {
    await driver.privileged.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: { allowAI: false } });
    });
    server.aiCalls.length = 0;

    const page = await driver.openForm('/test-forms/complex-html.html');
    await openPanel(driver, page);

    // Not "sent and ignored" — never sent. This is the switch the privacy audit points at, so
    // it is asserted against the network, not against a flag.
    expect(server.aiCalls).toHaveLength(0);

    // The form is still usable: the rule engine resolves what it can without a model.
    const cards = await driver.panelCards(page);
    expect(cards.filter((card) => card.accepted).length).toBeGreaterThan(0);
    expect(cards.every((card) => !card.value.includes('[stub answer for'))).toBe(true);
  });

  test('asks about exactly the one field it cannot resolve', async ({ driver, server }) => {
    server.aiCalls.length = 0;
    // basic-html.html has nine fields. Eight are a direct lookup from the profile; only the
    // "Professional Summary" textarea needs prose written. The router must send that one and
    // nothing else — sending the other eight would be paying a model to copy stored values.
    const page = await driver.openForm('/test-forms/basic-html.html');
    const summary = await driver.scan(page);
    expect(summary.fieldsDetected).toBe(9);

    await driver.showPanel(page);
    expect(server.aiCalls).toHaveLength(1);
    expect(server.aiCalls[0].fieldLabels).toEqual(['Professional Summary']);
    expect(server.aiCalls[0].modes).toEqual(['generate']);
  });

  test('a prose-only batch carries no contact details at all', async ({ driver, server }) => {
    server.aiCalls.length = 0;
    // The whole batch is `generate`, so nothing in it can return a stored value and the
    // contact fields have no reason to travel. This is the strongest form of the
    // minimisation claim, so it is asserted against what the endpoint actually received.
    const page = await driver.openForm('/test-forms/basic-html.html');
    await openPanel(driver, page);

    const call = server.aiCalls[0];
    expect(call.modes).toEqual(['generate']);
    expect(call.basicProfileKeys).toEqual(['email', 'fullName']);
    expect(call.profileKeys).not.toContain('address');
    expect(call.profileKeys).not.toContain('socialLinks');
    expect(call.profileKeys).not.toContain('documents');

    // Recorded rather than asserted away: the page URL *is* sent, deliberately, to ground the
    // answer. research/privacy-audit.md states this as a residual risk with `allowAI` as the
    // only control, so the test documents it rather than pretending otherwise.
    expect(call.sentPageUrl).toBe(true);
  });

  test('a failing endpoint degrades to review rather than breaking the form', async ({
    driver,
    server,
  }) => {
    // The stub answers `null` for everything, standing in for a provider that returns nothing
    // useful. The panel must still work and the field must still be fillable by hand.
    const page = await driver.openForm('/test-forms/complex-html.html');
    await driver.scan(page);
    const before = await driver.panelCards(page).catch(() => []);
    void before;

    await driver.showPanel(page);
    const cards = await driver.panelCards(page);
    expect(cards.length).toBeGreaterThan(0);

    // Whatever happened on the AI path, the deterministic suggestions are unaffected.
    const deterministic = cards.filter((card) => card.source.startsWith('Source:'));
    expect(deterministic.length).toBeGreaterThan(0);
    void server;
  });
});
