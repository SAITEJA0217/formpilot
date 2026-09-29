/**
 * The complete workflow, in real Chromium, with the real built extension.
 *
 * install → open site → open FormPilot → detect → extract → normalize → match →
 * suggest → confidence → provenance → review → accept → fields populated.
 *
 * Every assertion here is against a real browser: real MV3 service worker, real
 * `chrome.scripting.executeScript` injection of the shipped bundle, real content script,
 * real shadow-DOM panel, real DOM writes.
 */
import { test, expect } from '../fixtures/extension';

test.describe('full workflow in real Chromium', () => {
  test('the extension installs and its service worker registers', async ({ driver }) => {
    expect(driver.extensionId).toMatch(/^[a-p]{32}$/);
    const manifest = await driver.privileged.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe('2.0.0');
    // The permission reduction is part of the product; assert it in the real browser.
    expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting']);
    expect(manifest.host_permissions).not.toContain('https://docs.google.com/forms/*');
  });

  test('the profile arrives through the shipped dashboard bridge', async ({ driver }) => {
    const stored = await driver.privileged.evaluate(async () => {
      const data = (await chrome.storage.local.get([
        'userProfile',
        'isAuthenticated',
        'isProfileComplete',
      ])) as {
        userProfile?: { basicProfile?: { fullName?: string } };
        isAuthenticated?: boolean;
        isProfileComplete?: boolean;
      };
      return {
        authenticated: data.isAuthenticated,
        complete: data.isProfileComplete,
        name: data.userProfile?.basicProfile?.fullName,
      };
    });
    expect(stored.authenticated).toBe(true);
    expect(stored.complete).toBe(true);
    expect(stored.name).toBe('Saiteja Reddy Kotha');
  });

  test('detects, matches and reports a generic HTML form', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/basic-html.html');
    const summary = await driver.scan(page);

    expect(summary.fieldsDetected).toBe(9);
    expect(summary.platform).toBe('generic-html');
    expect(summary.ready).toBeGreaterThanOrEqual(6);
    expect(summary.blocked).toBe(0);
  });

  test('renders the review panel with confidence, provenance and evidence', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/basic-html.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const cards = await driver.panelCards(page);
    expect(cards.length).toBe(9);

    const fullName = cards.find((c) => c.label === 'Full Name');
    expect(fullName).toBeDefined();
    expect(fullName!.value).toBe('Saiteja Reddy Kotha');
    // Confidence is shown as a percentage badge, and the band drives its colour class.
    expect(fullName!.badge).toMatch(/^\d{1,3}%$/);
    expect(fullName!.band).toBe('high');
    // Provenance is visible without opening anything.
    expect(fullName!.source).toBe('Source: Personal → Full name');
    // High confidence arrives pre-accepted; that is what the band is for.
    expect(fullName!.accepted).toBe(true);

    // The evidence view exposes the concept, the profile path and the signals.
    const card = page.locator('#formpilot-root .card', { hasText: 'Full Name' }).first();
    await card.getByRole('button', { name: 'Why?' }).click();
    const why = card.locator('.why');
    await expect(why).toBeVisible();
    await expect(why).toContainText('basicProfile.fullName');
    await expect(why).toContainText('person.full_name');
  });

  test('accepting in the panel populates the real form fields', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/basic-html.html');
    await driver.scan(page);
    await driver.showPanel(page);

    // Nothing is written before the user acts.
    await expect(page.locator('#full-name')).toHaveValue('');

    await driver.fillViaPanel(page);

    await expect(page.locator('#full-name')).toHaveValue('Saiteja Reddy Kotha');
    await expect(page.locator('#email')).toHaveValue('saiteja@example.com');
    await expect(page.locator('#phone')).toHaveValue('+91 98765 43210');
    await expect(page.locator('#dob')).toHaveValue('2001-07-14');
    await expect(page.locator('#website')).toHaveValue('https://saiteja.dev');
    await expect(page.locator('#city')).toHaveValue('Hyderabad');
    await expect(page.locator('#zip')).toHaveValue('500081');

    // The panel reports the outcome back to the user.
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/);
  });

  test('a rejected suggestion is not written', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/basic-html.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const card = page.locator('#formpilot-root .card', { hasText: 'City' }).first();
    await card.getByRole('button', { name: 'Reject' }).click();
    await driver.fillViaPanel(page);

    await expect(page.locator('#full-name')).toHaveValue('Saiteja Reddy Kotha');
    await expect(page.locator('#city')).toHaveValue('');
  });

  test('an edited suggestion is written as edited', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/basic-html.html');
    await driver.scan(page);
    await driver.showPanel(page);

    const card = page.locator('#formpilot-root .card', { hasText: 'Full Name' }).first();
    await card.getByRole('button', { name: 'Edit' }).click();
    const editor = card.locator('textarea.value');
    await editor.fill('S. R. Kotha');
    await card.getByRole('button', { name: 'Save' }).click();
    await driver.fillViaPanel(page);

    await expect(page.locator('#full-name')).toHaveValue('S. R. Kotha');
  });

  test('closing the panel leaves the page exactly as it was found', async ({ driver }) => {
    const page = await driver.openForm('/test-forms/basic-html.html');
    await driver.scan(page);
    await driver.showPanel(page);
    await expect(page.locator('#formpilot-root .panel')).toBeVisible();

    await page.locator('#formpilot-root .icon-btn[aria-label="Close FormPilot"]').click();
    await expect(page.locator('#formpilot-root')).toHaveCount(0);
    // The page's own markup is untouched: no leftover attributes on the controls.
    const leftovers = await page.locator('[data-formpilot-container]').count();
    expect(leftovers).toBe(0);
  });
});
