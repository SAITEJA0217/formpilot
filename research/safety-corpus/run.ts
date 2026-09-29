/**
 * Safety regression corpus runner.
 *
 * Scores `corpus.json` through the **real pipeline** — normalization, matching, routing, the safety
 * policy and suggestion building — rather than by calling `evaluateFieldSafety` directly. That
 * matters: a policy-level assertion passes even if the pipeline downstream ignores the verdict, and
 * the thing that must hold is what the review panel ends up showing the user.
 *
 * Four required dispositions:
 *
 *   refuse   the field is blocked; no value is offered
 *   review   a value may be offered, but must NOT arrive pre-accepted
 *   fill     a value may be offered and may be pre-accepted
 *   decline  no concept is correct; naming one is an error
 *
 * `review` is the one worth dwelling on. The product pre-accepts a suggestion when its status is
 * `ready`, which needs the high confidence band — so "never silently pre-accept" is a statement
 * about the band, not about whether a suggestion exists at all. A field labelled only `Company` gets
 * a suggestion, because that is useful, and never gets it applied without a click.
 *
 * This corpus is a **specification of required behaviour**, authored by this project. It is not an
 * accuracy measurement; `research/heldout/` and `research/heldout-v2/` are.
 *
 * Usage:  npm run study:safety-corpus
 * Exit status is non-zero on any violation, so CI can gate on it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDomEnvironment } from '../benchmark/domEnv';
import { BENCHMARK_PROFILE } from '../benchmark/profile';
import { percent } from '../benchmark/metrics';

const env = createDomEnvironment();

const { normalizeForm } = await import('../../extension/src/core/normalize/formNormalizer');
const { buildSuggestions } = await import('../../shared/matching/pipeline');
const { isAffirmationControl } = await import('../../shared/safety/policy');

type FieldSuggestion = import('../../shared/types/suggestion').FieldSuggestion;

interface Case {
  label: string;
  category: string;
  disposition: 'refuse' | 'review' | 'fill' | 'decline';
  type?: string;
  name?: string;
  autocomplete?: string;
  note?: string;
}

const HERE = import.meta.dirname;
const corpus = JSON.parse(readFileSync(path.join(HERE, 'corpus.json'), 'utf8')) as {
  version: number;
  cases: Case[];
};

/** Render one case as the markup a real page would carry. */
function markupFor(testCase: Case, index: number): string {
  const id = `c${index}`;
  const attrs = [
    `id="${id}"`,
    testCase.name ? `name="${testCase.name}"` : `name="${id}"`,
    testCase.autocomplete ? `autocomplete="${testCase.autocomplete}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const label = testCase.label ? `<label for="${id}">${testCase.label}</label>` : '';
  const kind = testCase.type ?? 'text';

  const control =
    kind === 'textarea'
      ? `<textarea ${attrs} rows="4"></textarea>`
      : kind === 'checkbox'
        ? `<input ${attrs} type="checkbox" />`
        : `<input ${attrs} type="${kind}" />`;

  // A checkbox's label wraps the control, which is how real consent controls are written.
  if (kind === 'checkbox' && testCase.label) {
    return `<p><label><input ${attrs} type="checkbox" /> ${testCase.label}</label></p>`;
  }
  return `<p>${label}${control}</p>`;
}

/**
 * Score one case.
 *
 * Each case is rendered as its own single-field page. One field per page rather than one big form,
 * so a neighbouring field's section heading or context cannot change the verdict — the corpus is
 * about the field's own text.
 */
interface Outcome {
  testCase: Case;
  status: string;
  conceptId: string | null;
  confidence: number;
  preAccepted: boolean;
  ok: boolean;
  why: string;
}

function score(testCase: Case, index: number): Outcome {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>safety case</title></head><body><form>${markupFor(testCase, index)}</form></body></html>`;
  env.loadMarkup(html, 'https://safety.local/form');
  const normalized = normalizeForm({ href: 'https://safety.local/form' });

  if (normalized.form.fields.length === 0) {
    return {
      testCase,
      status: 'not-detected',
      conceptId: null,
      confidence: 0,
      preAccepted: false,
      ok: false,
      why: 'the field was not detected at all, so no disposition could be reached',
    };
  }

  const { suggestions } = buildSuggestions(normalized.form, BENCHMARK_PROFILE, {
    documents: BENCHMARK_PROFILE.documents,
  });
  const suggestion: FieldSuggestion | undefined = suggestions[0];
  const field = normalized.form.fields[0];

  const status = suggestion?.status ?? 'none';
  const conceptId = suggestion?.provenance?.conceptId ?? null;
  const confidence = suggestion?.confidence ?? 0;
  // The product's own rule, from ReviewPanel: ready, and never a lone checkbox.
  const preAccepted = status === 'ready' && !isAffirmationControl(field.type);

  switch (testCase.disposition) {
    case 'refuse':
      return {
        testCase, status, conceptId, confidence, preAccepted,
        ok: status === 'blocked',
        why: status === 'blocked' ? 'refused' : `expected a refusal, got status "${status}"`,
      };
    case 'review':
      return {
        testCase, status, conceptId, confidence, preAccepted,
        ok: !preAccepted,
        why: preAccepted
          ? `pre-accepted at ${percent(confidence)} — must require a click`
          : 'offered for review, not pre-accepted',
      };
    case 'fill':
      return {
        testCase, status, conceptId, confidence, preAccepted,
        ok: status === 'ready' || status === 'needs_review',
        why:
          status === 'ready' || status === 'needs_review'
            ? `offered (${status})`
            : `expected a usable suggestion, got status "${status}"`,
      };
    case 'decline':
      return {
        testCase, status, conceptId, confidence, preAccepted,
        ok: !preAccepted && status !== 'ready',
        why: preAccepted
          ? `named ${conceptId} and pre-accepted it, but no concept is correct`
          : 'not answered confidently',
      };
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const lines: string[] = [];
const say = (text = ''): void => {
  console.log(text);
  lines.push(text);
};

const outcomes = corpus.cases.map((testCase, index) => score(testCase, index));
const violations = outcomes.filter((outcome) => !outcome.ok);

say(`FormPilot safety regression corpus v${corpus.version} — ${corpus.cases.length} cases`);
say('  scored through the real pipeline: normalize → match → route → policy → suggest');
say('  a specification of required behaviour, not an accuracy measurement');
say();

const byDisposition = ['refuse', 'review', 'fill', 'decline'] as const;
say('── By required disposition ──');
const dispositionRows = byDisposition.map((disposition) => {
  const subset = outcomes.filter((outcome) => outcome.testCase.disposition === disposition);
  const passed = subset.filter((outcome) => outcome.ok).length;
  say(`  ${disposition.padEnd(9)} ${String(passed).padStart(3)}/${String(subset.length).padEnd(3)}  ${passed === subset.length ? 'ok' : 'VIOLATIONS'}`);
  return { disposition, passed, total: subset.length };
});
say();

say('── By category ──');
const categories = [...new Set(corpus.cases.map((testCase) => testCase.category))].sort();
const categoryRows = categories.map((category) => {
  const subset = outcomes.filter((outcome) => outcome.testCase.category === category);
  const passed = subset.filter((outcome) => outcome.ok).length;
  say(
    `  ${category.padEnd(26)} ${String(passed).padStart(3)}/${String(subset.length).padEnd(3)}` +
      `${passed === subset.length ? '' : '  VIOLATIONS'}`,
  );
  return { category, passed, total: subset.length };
});
say();

// The number the release brief asks for: how many sensitive controls were refused.
const refuseCases = outcomes.filter((outcome) => outcome.testCase.disposition === 'refuse');
const refused = refuseCases.filter((outcome) => outcome.ok).length;
const reviewCases = outcomes.filter((outcome) => outcome.testCase.disposition === 'review');
const notPreAccepted = reviewCases.filter((outcome) => outcome.ok).length;

say('── Headline ──');
say(`  safety-refusal rate      ${refused}/${refuseCases.length}  (${percent(refuseCases.length === 0 ? 0 : refused / refuseCases.length)})`);
say(`  ambiguous not pre-accepted ${notPreAccepted}/${reviewCases.length}`);
say(`  total violations         ${violations.length}`);
say();

if (violations.length > 0) {
  say('── Violations ──');
  for (const violation of violations) {
    const shown = violation.testCase.label || `(${violation.testCase.name ?? 'unlabelled'})`;
    say(`  [${violation.testCase.disposition}] ${JSON.stringify(shown)}`);
    say(`      ${violation.why}`);
  }
  say();
}

const outDir = path.join(HERE, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'latest.json'),
  `${JSON.stringify(
    {
      corpusVersion: corpus.version,
      cases: corpus.cases.length,
      violations: violations.length,
      safetyRefusalRate: refuseCases.length === 0 ? 0 : refused / refuseCases.length,
      byDisposition: dispositionRows,
      byCategory: categoryRows,
      failures: violations.map((violation) => ({
        label: violation.testCase.label,
        name: violation.testCase.name ?? null,
        category: violation.testCase.category,
        required: violation.testCase.disposition,
        status: violation.status,
        conceptId: violation.conceptId,
        confidence: violation.confidence,
        why: violation.why,
      })),
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  path.join(outDir, 'latest.md'),
  ['# Safety regression corpus — latest run', '', 'Generated by `npm run study:safety-corpus`.', '', '```', ...lines, '```', ''].join('\n'),
);

say('  wrote research/safety-corpus/results/latest.json and latest.md');

if (violations.length > 0) {
  // Non-zero exit so CI fails. A safety violation is not a report, it is a build break.
  process.exitCode = 1;
}
