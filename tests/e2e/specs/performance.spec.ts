/**
 * Latency in a real browser.
 *
 * `research/performance/run.ts` establishes the *shape* of the scaling curve in jsdom, which
 * has no layout engine and a different constant factor from Blink's. This spec provides the
 * absolute numbers, measured end to end through the shipped extension: injection, detection,
 * matching, and rendering the panel, on real pages in Chromium.
 *
 * It records rather than gates. There are no upper-bound assertions on milliseconds, because
 * a CI runner's wall clock is not a property of the engine and a threshold tuned on this
 * container would fail elsewhere for no useful reason. What it *does* assert is the thing
 * that is a property of the engine: that cost stays roughly proportional to field count, so a
 * quadratic traversal introduced later shows up as a test failure rather than as a slow page.
 *
 * Numbers print to the run log. Quote them with the machine they came from, or not at all.
 */
import { test, expect } from '../fixtures/extension';
import type { Page } from '@playwright/test';

/**
 * Sizes spanning a short form to an unreasonable one.
 *
 * 250 is the top of the range a real page plausibly reaches; 10 is a contact form. The set is
 * fixed so successive runs are comparable.
 */
const SIZES = [10, 25, 50, 100, 250] as const;
/** Repeats per size. Enough to see spread without making the suite slow. */
const REPEATS = 3;

interface Sample {
  fields: number;
  scanMs: number[];
  panelMs: number[];
  detected: number;
  /** JS heap growth across one scan-and-render cycle, in MiB. */
  heapGrowthMiB: number[];
}

/**
 * JS heap size, via Chromium's non-standard `performance.memory`.
 *
 * Coarse and quantised, and it says nothing about the extension's own service-worker heap — only
 * the page's. Reported as an order-of-magnitude check for a leak, never as a precise figure.
 * `null` when the API is unavailable.
 */
async function heapMiB(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return memory ? memory.usedJSHeapSize / (1024 * 1024) : null;
  });
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

test.describe('latency in Chromium', () => {
  // Three sizes × three repeats, each a fresh page load and a real injection.
  test.setTimeout(360_000);

  test('cost stays proportional to field count', async ({ driver, server }) => {
    const samples: Sample[] = [];

    for (const fields of SIZES) {
      const sample: Sample = { fields, scanMs: [], panelMs: [], detected: 0, heapGrowthMiB: [] };

      for (let run = 0; run < REPEATS; run += 1) {
        const page: Page = await driver.openForm(`/__generated-form?fields=${fields}`);
        const heapBefore = await heapMiB(page);

        const beforeScan = Date.now();
        const summary = await driver.scan(page);
        sample.scanMs.push(Date.now() - beforeScan);

        const beforePanel = Date.now();
        await driver.showPanel(page);
        sample.panelMs.push(Date.now() - beforePanel);

        const heapAfter = await heapMiB(page);
        if (heapBefore !== null && heapAfter !== null) {
          sample.heapGrowthMiB.push(heapAfter - heapBefore);
        }

        sample.detected = summary.fieldsDetected;
        await page.close();
      }

      expect(sample.detected, `${fields}-field form`).toBe(fields);
      samples.push(sample);
    }

    // eslint-disable-next-line no-console -- the measurement is the deliverable here.
    console.log(`\n  in-browser latency (Chromium, ${REPEATS} runs per size, median)`);
    console.log('    fields  detected   scan+inject   panel render   total prep   per field   heap growth');
    for (const sample of samples) {
      const scan = median(sample.scanMs);
      const panel = median(sample.panelMs);
      const heap = sample.heapGrowthMiB.length > 0 ? `${median(sample.heapGrowthMiB).toFixed(1)} MiB` : 'n/a';
      console.log(
        `    ${String(sample.fields).padStart(6)}  ${String(sample.detected).padStart(8)}   ` +
          `${`${scan.toFixed(0)} ms`.padStart(11)}   ${`${panel.toFixed(0)} ms`.padStart(12)}   ` +
          `${`${(scan + panel).toFixed(0)} ms`.padStart(10)}   ${`${(scan / sample.fields).toFixed(2)} ms`.padStart(9)}   ` +
          `${heap.padStart(11)}`,
      );
    }
    console.log('    total prep = scan+inject plus panel render, which is what the user waits for.');
    console.log('    heap growth is the page heap over one cycle, via a non-standard API: a leak');
    console.log('    check, not a precise figure.');
    console.log('');

    // The assertion: per-field cost must not blow up as the form grows. A quadratic
    // traversal would show here as a per-field cost several times the small-form one. The
    // bound is loose on purpose — it is a shape check, not a speed limit, and the scan time
    // includes a fixed injection cost that is amortised away at larger sizes.
    const smallest = samples[0];
    const largest = samples[samples.length - 1];
    const perFieldSmall = median(smallest.scanMs) / smallest.fields;
    const perFieldLarge = median(largest.scanMs) / largest.fields;
    expect(
      perFieldLarge,
      `per-field scan cost went from ${perFieldSmall.toFixed(2)} ms at ${smallest.fields} fields ` +
        `to ${perFieldLarge.toFixed(2)} ms at ${largest.fields}; that is a scaling regression, ` +
        'not a slow machine',
    ).toBeLessThan(perFieldSmall * 4);

    void server;
  });

  test('a 250-field form is still filled correctly, not just quickly', async ({ driver }) => {
    // A performance test that stopped checking correctness would be easy to pass.
    const page = await driver.openForm('/__generated-form?fields=250');
    const summary = await driver.scan(page);
    expect(summary.fieldsDetected).toBe(250);
    expect(summary.blocked).toBe(0);

    await driver.showPanel(page);
    await driver.fillViaPanel(page);
    await expect(page.locator('#formpilot-root .toast')).toContainText(/Filled \d+ of \d+/, {
      timeout: 120_000,
    });

    // The generator repeats its label pool, so `Full Name` appears at index 0 and again
    // further down as `Full Name 2`, `Full Name 3` and so on. Every one of them should carry
    // the same value: a field is filled from its label, not from its position.
    const written = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLInputElement>('input'))
        .filter((input) => (input.labels?.[0]?.textContent ?? '').startsWith('Full Name'))
        .map((input) => input.value),
    );
    expect(written.length).toBeGreaterThan(5);
    expect(new Set(written)).toEqual(new Set(['Saiteja Reddy Kotha']));
  });
});
