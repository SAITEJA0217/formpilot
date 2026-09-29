/**
 * Performance by form size.
 *
 * Answers one question: does the engine stay usable as a form gets large, and which stage
 * dominates? Timed at seven sizes from 10 to 500 fields, with repeats, and reported as both
 * total and per-field cost so super-linear growth shows up as a rising per-field number
 * rather than hiding inside a bigger total.
 *
 * The two stages measured are the two the extension actually runs: `normalizeForm`, which
 * detects the fields and then classifies, sections and safety-checks them, and
 * `buildSuggestions`, which matches and resolves values. `detectFields` is timed separately
 * as a component, but it is *not* added into the pipeline total, because `normalizeForm`
 * calls it internally — adding both would charge detection twice. The first version of this
 * harness did exactly that and overstated the total by about a third.
 *
 * Usage:  npm run study:performance
 *
 * **Limits, stated rather than hidden.**
 *  - This runs in jsdom, not a browser. jsdom has no layout engine, so anything involving
 *    geometry is absent and its DOM operations have a different constant factor from Blink's.
 *    The *shape* of the curve transfers; the absolute milliseconds do not. Real in-browser
 *    numbers for one page size are measured by `tests/e2e/specs/performance.spec.ts`, which
 *    is the figure to quote for latency.
 *  - The generated forms are uniform and well-labelled. A real page of the same field count
 *    carries far more unrelated DOM, which affects detection (a document-wide query) more
 *    than matching (per-field work).
 *  - Timings come from `performance.now()` on one machine, in one container, with no attempt
 *    to pin CPU frequency. Run-to-run spread is reported as a standard deviation so a
 *    difference smaller than that spread is not read as a difference.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDomEnvironment } from '../benchmark/domEnv';
import { BENCHMARK_PROFILE } from '../benchmark/profile';
import { mean, round, stdev } from '../benchmark/metrics';

const env = createDomEnvironment();

const { normalizeForm } = await import('../../extension/src/core/normalize/formNormalizer');
const { detectFields } = await import('../../extension/src/core/detect/fieldDetector');
const { buildSuggestions } = await import('../../shared/matching/pipeline');

// ─── Form generation ──────────────────────────────────────────────────────────

/**
 * Label pool for generated forms.
 *
 * A mix of labels the ontology knows and labels it does not, so matching does real work at
 * both ends: a form of 500 fields that all say "Full Name" would measure the alias cache,
 * not the matcher.
 */
const KNOWN = [
  'Full Name', 'Email Address', 'Phone Number', 'Date of Birth', 'City', 'State',
  'PIN Code', 'Country', 'Current Company', 'Job Title', 'Highest Qualification',
  'College Name', 'Graduation Year', 'LinkedIn Profile', 'GitHub Profile',
];
const UNKNOWN = [
  'Referral code', 'Preferred interview slot', 'Favourite ice cream flavour',
  'Vehicle registration', 'Employee ID', 'Locker number', 'Badge colour',
];

/** A form with `count` fields, roughly two thirds of them recognisable. */
function generateForm(count: number): string {
  const rows: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const fromKnown = i % 3 !== 2;
    const pool = fromKnown ? KNOWN : UNKNOWN;
    const label = `${pool[i % pool.length]}${i >= pool.length ? ` ${Math.floor(i / pool.length) + 1}` : ''}`;
    const id = `f${i}`;
    // Wrapped in a section every ten fields, so container grouping does realistic work.
    if (i % 10 === 0) rows.push(`${i > 0 ? '</section>' : ''}<section><h2>Section ${i / 10 + 1}</h2>`);
    rows.push(`<label for="${id}">${label}</label><input id="${id}" name="${id}" />`);
  }
  rows.push('</section>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Generated form (${count} fields)</title></head><body><h1>Generated form</h1><form>${rows.join('')}</form></body></html>`;
}

// ─── Measurement ──────────────────────────────────────────────────────────────

const SIZES = [10, 25, 50, 100, 250, 500];
/** Enough repeats for a usable standard deviation without making the run slow. */
const REPEATS = 5;
/** Discarded, so JIT warm-up is not charged to the first size. */
const WARMUP = 2;

interface Measurement {
  fields: number;
  detectedFields: number;
  detectMs: { mean: number; stdev: number };
  normalizeMs: { mean: number; stdev: number };
  suggestMs: { mean: number; stdev: number };
  totalMs: { mean: number; stdev: number };
  perFieldMs: number;
}

const lines: string[] = [];
const say = (text = ''): void => {
  console.log(text);
  lines.push(text);
};

function measure(count: number): Measurement {
  const markup = generateForm(count);
  const detect: number[] = [];
  const normalize: number[] = [];
  const suggest: number[] = [];
  let detectedFields = 0;

  for (let run = 0; run < REPEATS + WARMUP; run += 1) {
    // A fresh realm per timed stage: the engine stamps bookkeeping attributes onto
    // containers, so re-running against a used document would measure a warmed-up page.
    const detectWindow = env.loadMarkup(markup, 'https://perf.local/form');
    const t0 = performance.now();
    const detection = detectFields({ root: detectWindow.document });
    const detectMs = performance.now() - t0;

    env.loadMarkup(markup, 'https://perf.local/form');
    const t1 = performance.now();
    const normalized = normalizeForm({ href: 'https://perf.local/form' });
    const normalizeMs = performance.now() - t1;

    const t2 = performance.now();
    const { suggestions } = buildSuggestions(normalized.form, BENCHMARK_PROFILE, {
      documents: BENCHMARK_PROFILE.documents,
    });
    const suggestMs = performance.now() - t2;

    if (run < WARMUP) continue;
    detect.push(detectMs);
    normalize.push(normalizeMs);
    suggest.push(suggestMs);
    detectedFields = detection.fields.length;
    void suggestions;
  }

  // Pipeline total is normalize + suggest. Detection is inside normalize already.
  const totals = normalize.map((n, i) => n + suggest[i]);
  return {
    fields: count,
    detectedFields,
    detectMs: { mean: round(mean(detect), 2), stdev: round(stdev(detect), 2) },
    normalizeMs: { mean: round(mean(normalize), 2), stdev: round(stdev(normalize), 2) },
    suggestMs: { mean: round(mean(suggest), 2), stdev: round(stdev(suggest), 2) },
    totalMs: { mean: round(mean(totals), 2), stdev: round(stdev(totals), 2) },
    perFieldMs: round(mean(totals) / count, 3),
  };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

say('FormPilot performance by form size');
say(`  ${REPEATS} timed repeats per size (plus ${WARMUP} discarded warm-up runs), jsdom`);
say('  jsdom has no layout engine; the shape of the curve transfers to a browser, the');
say('  absolute milliseconds do not. See tests/e2e/specs/performance.spec.ts for real ones.');
say();
say('  detect is a component of normalize, not an extra stage: total = normalize + suggest.');
say();
say('  fields  detected     (detect)       normalize       suggest         total      per field');

const results = SIZES.map((size) => {
  const m = measure(size);
  const fmt = (v: { mean: number; stdev: number }): string =>
    `${v.mean.toFixed(1)}±${v.stdev.toFixed(1)}`.padStart(12);
  say(
    `  ${String(m.fields).padStart(6)}  ${String(m.detectedFields).padStart(8)}  ` +
      `${fmt(m.detectMs)}  ${fmt(m.normalizeMs)}  ${fmt(m.suggestMs)}  ${fmt(m.totalMs)}  ` +
      `${m.perFieldMs.toFixed(3)} ms`,
  );
  return m;
});
say();

// Growth: how the per-field cost changes from the smallest to the largest form. A flat
// per-field number means linear scaling; a rising one means the engine gets worse per field
// as the form grows, which is what a quadratic traversal would look like.
const first = results[0];
const last = results[results.length - 1];
const sizeRatio = last.fields / first.fields;
const timeRatio = last.totalMs.mean / first.totalMs.mean;
const perFieldRatio = last.perFieldMs / first.perFieldMs;

say('── Scaling ──');
say(`  ${sizeRatio.toFixed(0)}× the fields costs ${timeRatio.toFixed(1)}× the time`);
say(`  per-field cost ${first.perFieldMs.toFixed(3)} ms → ${last.perFieldMs.toFixed(3)} ms (${perFieldRatio.toFixed(2)}×)`);
say(
  perFieldRatio <= 1.5
    ? '  per-field cost is roughly flat: scaling is close to linear in field count'
    : `  per-field cost rises ${perFieldRatio.toFixed(2)}×: scaling is super-linear and worth investigating`,
);
say();

// Where the time goes at the largest size, which is the one that matters for a worst case.
const share = (v: number): string => `${((v / last.totalMs.mean) * 100).toFixed(0)}%`;
say(`── Stage breakdown at ${last.fields} fields ──`);
say(`  normalize             ${last.normalizeMs.mean.toFixed(1)} ms  (${share(last.normalizeMs.mean)} of pipeline)`);
say(`    of which detect     ${last.detectMs.mean.toFixed(1)} ms  (${((last.detectMs.mean / last.normalizeMs.mean) * 100).toFixed(0)}% of normalize)`);
say(`  suggest               ${last.suggestMs.mean.toFixed(1)} ms  (${share(last.suggestMs.mean)} of pipeline)`);
say();

const outDir = path.join(import.meta.dirname, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'latest.json'),
  `${JSON.stringify(
    {
      environment: { runtime: 'jsdom', repeats: REPEATS, warmupRuns: WARMUP },
      sizes: results,
      scaling: {
        sizeRatio: round(sizeRatio, 2),
        timeRatio: round(timeRatio, 2),
        perFieldRatio: round(perFieldRatio, 2),
      },
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  path.join(outDir, 'latest.md'),
  [
    '# Performance by form size — latest run',
    '',
    'Generated by `npm run study:performance`. Every number is computed from that run.',
    'See the header of `research/performance/run.ts` for what this does and does not measure.',
    '',
    '```',
    ...lines,
    '```',
    '',
  ].join('\n'),
);

say('  wrote research/performance/results/latest.json and latest.md');
