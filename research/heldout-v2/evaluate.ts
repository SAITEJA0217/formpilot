/**
 * Held-out evaluation **v2**: independent measurement after the payment-field safety fix.
 *
 * ## Why a second one
 *
 * v1 exposed four payment-field safety misses. Fixing them made v1 a training set for that fix, so
 * a post-fix score on v1 measures whether the patch worked — it does, 4 misses to 0 — and nothing
 * about generalisation. v2 is a fresh corpus, **disjoint from v1 by construction**: every v1 source
 * file was excluded before fetching, and the two share no file.
 *
 * ## Population
 *
 * 467 form controls from 105 HTML files written by unrelated authors, found by GitHub code search
 * over WHATWG `autocomplete` tokens with results taken in the order GitHub returned them. Ground
 * truth is each file's own `autocomplete` attribute, whose meaning the specification fixes, and the
 * attribute is withheld from every method under test.
 *
 * The population is deliberately payment- and credential-heavy: **166 of 467 controls must be
 * refused**, against 72 of 658 in v1. Token families were chosen so the safety fix is measured
 * against markup it has never seen, which is the whole point of running a second evaluation. That
 * also means v2's accuracy is not comparable to v1's as a like-for-like number — the mix is
 * different — and the report says so rather than inviting the comparison.
 *
 * ## Configuration freeze
 *
 * Frozen at commit `62eb9c0`, 2026-09-29T05:46:19Z, before this harness was first run. SHA-256 of
 * every file that determines matching behaviour is recorded in `held-out-evaluation-v2.md` and
 * re-checked after the run. **Nothing is tuned in response to what this reports.**
 *
 * ## Metrics
 *
 * Beyond accuracy and macro P/R/F1, three rates the release brief asks for:
 *
 *  - **abstention rate** — share of all records where no concept was named. Not an error on its own;
 *    on a must-refuse record it is the correct outcome.
 *  - **incorrect-fill rate** — share of records where a concept was named *and was wrong*, counting
 *    a named concept on a must-refuse record as wrong. This is the rate that matters for a system a
 *    human reviews: it is how often FormPilot would put something wrong in front of them.
 *  - **safety-refusal rate** — share of must-refuse records correctly refused.
 *
 * Proportions carry 95% Wilson score intervals. Wilson rather than the normal approximation because
 * several strata are small and some proportions sit near 0 or 1, where the normal interval runs
 * outside [0, 1] and understates uncertainty.
 *
 * Usage:  npm run study:heldout-v2
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createDomEnvironment } from '../benchmark/domEnv';
import { percent, prf1, round, type ConfusionCounts } from '../benchmark/metrics';

createDomEnvironment();

const { matchField } = await import('../../shared/matching/matcher');
const { UNKNOWN_MATCH_SCORE } = await import('../../shared/matching/router');
const { DEFAULT_THRESHOLDS } = await import('../../shared/matching/confidence');
const { normalizeText, tokenSet } = await import('../../shared/matching/normalize');
const { diceCoefficient, tokenSetF1 } = await import('../../shared/matching/similarity');
const { INDEXED_CONCEPTS } = await import('../../shared/ontology');
const { evaluateFieldSafety } = await import('../../shared/safety/policy');
const { getConceptDef } = await import('../../shared/ontology');

type FieldType = import('../../shared/types/form').FieldType;
type UnifiedField = import('../../shared/types/form').UnifiedField;

const HIGH_BAND = DEFAULT_THRESHOLDS.high;

// ─── Statistics ───────────────────────────────────────────────────────────────

/**
 * 95% Wilson score interval for a binomial proportion.
 *
 * Chosen over the normal approximation because several strata here are small and several
 * proportions sit at or near 1, where the normal interval extends past 1 and reports an
 * impossibly narrow band.
 */
function wilson(successes: number, total: number): { low: number; high: number } {
  if (total === 0) return { low: 0, high: 0 };
  const z = 1.959964; // two-sided 95%
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
  };
}

const ci = (successes: number, total: number): string => {
  const { low, high } = wilson(successes, total);
  return `[${percent(low)}, ${percent(high)}]`;
};

// ─── Corpus ───────────────────────────────────────────────────────────────────

interface Record_ {
  provenance: string;
  sourceSha256: string;
  autocomplete: string;
  expectedConcept: string | null;
  mustRefuse: boolean;
  label: string;
  name: string;
  elementId: string;
  placeholder: string;
  type: string;
  required: boolean;
  ariaLabel: string;
}

const HERE = import.meta.dirname;
const corpus = JSON.parse(readFileSync(path.join(HERE, 'corpus.json'), 'utf8')) as {
  fetchedAt: string;
  fieldCount: number;
  records: Record_[];
};

type Split = 'dev' | 'validation' | 'heldout';
function splitFor(provenance: string): Split {
  // Grouped by file and salted differently from v1, so the two evaluations do not inherit the
  // same bucket assignment for any file that might coincidentally appear in both.
  const digest = createHash('sha256').update(`v2:${provenance}`).digest();
  const bucket = digest[0] % 100;
  if (bucket < 40) return 'dev';
  if (bucket < 60) return 'validation';
  return 'heldout';
}

function isNonLatin(text: string): boolean {
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  if (letters.length === 0) return false;
  const latin = letters.filter((character) => /\p{Script=Latin}/u.test(character)).length;
  return latin / letters.length < 0.5;
}

const ALL = corpus.records.map((record) => ({
  ...record,
  split: splitFor(record.provenance),
  nonLatin: isNonLatin(record.label || record.placeholder || record.name),
}));

const GOLD_CONCEPTS = [
  ...new Set(ALL.map((record) => record.expectedConcept).filter((c): c is string => c !== null)),
].sort();

// ─── Methods ──────────────────────────────────────────────────────────────────

type Visibility = 'label' | 'metadata' | 'context';

function fieldFor(record: (typeof ALL)[number], visibility: Visibility): UnifiedField {
  const base: Record<string, unknown> = {
    id: 'f',
    required: record.required,
    disabled: false,
    readOnly: false,
    sensitivity: 'normal',
    options: [],
    location: { framePath: [], shadowPath: [] },
    selector: '',
    label: record.label,
    type: 'text' as FieldType,
  };
  if (visibility === 'label') return base as unknown as UnifiedField;
  base.name = record.name;
  base.elementId = record.elementId;
  base.placeholder = record.placeholder;
  base.ariaLabel = record.ariaLabel;
  if (visibility === 'metadata') return base as unknown as UnifiedField;
  const KNOWN_TYPES = new Set(['text', 'email', 'tel', 'url', 'number', 'date', 'password', 'search', 'month', 'time']);
  base.type = (KNOWN_TYPES.has(record.type) ? record.type : 'text') as FieldType;
  return base as unknown as UnifiedField;
}

interface Prediction {
  conceptId: string | null;
  score: number;
}
type Method = (record: (typeof ALL)[number]) => Prediction;

const searchText = (record: (typeof ALL)[number]): string[] =>
  [record.label, record.ariaLabel, record.name, record.elementId, record.placeholder]
    .filter((value) => value.length > 0)
    .map((value) => normalizeText(value));

/** Baseline A — exact label match against a concept alias. */
const baselineExactLabel: Method = (record) => {
  const label = normalizeText(record.label);
  if (!label) return { conceptId: null, score: 0 };
  for (const concept of INDEXED_CONCEPTS) {
    if (concept.normalizedAliases.includes(label)) return { conceptId: concept.def.id, score: 1 };
  }
  return { conceptId: null, score: 0 };
};

/** Baseline B — substring containment, longest alias wins, label only. */
const baselineSubstring: Method = (record) => {
  const padded = ` ${normalizeText(record.label)} `;
  let bestId: string | null = null;
  let bestLength = 0;
  for (const concept of INDEXED_CONCEPTS) {
    for (const alias of concept.normalizedAliases) {
      if (padded.includes(` ${alias} `) && alias.length > bestLength) {
        bestLength = alias.length;
        bestId = concept.def.id;
      }
    }
  }
  return bestId ? { conceptId: bestId, score: 1 } : { conceptId: null, score: 0 };
};

/** Baseline C — exact or substring match across label, aria-label, name, id, placeholder. */
const baselineMetadata: Method = (record) => {
  let bestId: string | null = null;
  let bestLength = 0;
  for (const text of searchText(record)) {
    const padded = ` ${text} `;
    for (const concept of INDEXED_CONCEPTS) {
      for (const alias of concept.normalizedAliases) {
        if (padded.includes(` ${alias} `) && alias.length > bestLength) {
          bestLength = alias.length;
          bestId = concept.def.id;
        }
      }
    }
  }
  return bestId ? { conceptId: bestId, score: 1 } : { conceptId: null, score: 0 };
};

/** Baseline D — token and character similarity against aliases, no gates. */
const baselineSemantic: Method = (record) => {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const text of searchText(record)) {
    const tokens = tokenSet(text);
    for (const concept of INDEXED_CONCEPTS) {
      for (const alias of concept.normalizedAliases) {
        const score = Math.max(tokenSetF1(tokens, tokenSet(alias)), diceCoefficient(text, alias) * 0.9);
        if (score > bestScore) {
          bestScore = score;
          bestId = concept.def.id;
        }
      }
    }
  }
  if (!bestId || bestScore < 0.5) return { conceptId: null, score: bestScore };
  return { conceptId: bestId, score: bestScore };
};

function formpilot(visibility: Visibility, gates: { threshold: boolean; guard: boolean }): Method {
  return (record) => {
    const result = matchField(fieldFor(record, visibility), {});
    if (!result.best) return { conceptId: null, score: 0 };
    if (gates.threshold && result.best.score < UNKNOWN_MATCH_SCORE) {
      return { conceptId: null, score: result.best.score };
    }
    if (gates.guard && result.ambiguous) return { conceptId: null, score: result.best.score };
    return { conceptId: result.best.conceptId, score: result.best.score };
  };
}

/** The safety policy, with `autocomplete` withheld so it cannot read the answer. */
const policyRefuses = (record: (typeof ALL)[number]): boolean =>
  evaluateFieldSafety({
    type: (record.type === 'password' ? 'password' : 'text') as FieldType,
    label: record.label,
    name: record.name,
    elementId: record.elementId,
    ariaLabel: record.ariaLabel,
    placeholder: record.placeholder,
  }).sensitivity === 'blocked';

/**
 * A concept the ontology forbids filling is a refusal, not a mapping.
 *
 * `shared/matching/router.ts` routes a field to `blocked` when its matched concept declares
 * `policy: 'never'` — `auth.otp`, `auth.password`, `payment.card_number` and the rest. Omitting this
 * check misrepresents the product: the first version of this harness scored a field labelled
 * "verification input" as a *missed refusal* because it mapped to `auth.otp`, when the shipped
 * pipeline refuses exactly that field for exactly that reason.
 *
 * Recorded as a harness correction rather than a quiet edit: it was made after seeing the v2 results
 * and it moves the safety-refusal rate up. It changes the *measurement* to match the product, not
 * the product to match the measurement, which is the distinction the freeze protects.
 */
const conceptForbidsFilling = (conceptId: string | null): boolean =>
  conceptId !== null && getConceptDef(conceptId)?.policy === 'never';

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface Score {
  total: number;
  correctConcept: number;
  wrongConcept: number;
  abstained: number;
  correctRefusal: number;
  missedRefusal: number;
  /** Abstained on a record that had a correct concept. */
  missedCoverage: number;
  /** A concept was named at auto-accept confidence on a must-refuse record. */
  confidentOnRefusable: number;
  perConcept: Map<string, ConfusionCounts>;
  errors: { label: string; expected: string | null; got: string | null; provenance: string }[];
}

function scoreMethod(
  method: Method,
  records: typeof ALL,
  options: { withPolicy: boolean } = { withPolicy: false },
): Score {
  const score: Score = {
    total: records.length,
    correctConcept: 0,
    wrongConcept: 0,
    abstained: 0,
    correctRefusal: 0,
    missedRefusal: 0,
    missedCoverage: 0,
    confidentOnRefusable: 0,
    perConcept: new Map(GOLD_CONCEPTS.map((id) => [id, { truePositives: 0, falsePositives: 0, falseNegatives: 0 }])),
    errors: [],
  };
  const bump = (conceptId: string, key: keyof ConfusionCounts): void => {
    const counts = score.perConcept.get(conceptId);
    if (counts) counts[key] += 1;
  };

  for (const record of records) {
    const refused = options.withPolicy && policyRefuses(record);
    const prediction = refused ? { conceptId: null, score: 0 } : method(record);
    const shown = record.label || `(${record.name || record.elementId})`;

    // A concept the ontology forbids filling yields no value, so it counts as an abstention.
    if (prediction.conceptId === null || conceptForbidsFilling(prediction.conceptId)) {
      score.abstained += 1;
    }

    if (record.mustRefuse) {
      if (prediction.conceptId === null || conceptForbidsFilling(prediction.conceptId)) {
        score.correctRefusal += 1;
      } else {
        score.missedRefusal += 1;
        if (prediction.score >= HIGH_BAND) score.confidentOnRefusable += 1;
        bump(prediction.conceptId, 'falsePositives');
        score.errors.push({ label: shown, expected: null, got: prediction.conceptId, provenance: record.provenance });
      }
      continue;
    }

    const expected = record.expectedConcept!;
    if (prediction.conceptId === null) {
      score.missedCoverage += 1;
      bump(expected, 'falseNegatives');
      score.errors.push({ label: shown, expected, got: null, provenance: record.provenance });
    } else if (prediction.conceptId === expected) {
      score.correctConcept += 1;
      bump(expected, 'truePositives');
    } else {
      score.wrongConcept += 1;
      bump(prediction.conceptId, 'falsePositives');
      bump(expected, 'falseNegatives');
      score.errors.push({ label: shown, expected, got: prediction.conceptId, provenance: record.provenance });
    }
  }
  return score;
}

const accuracyOf = (s: Score): number => (s.total === 0 ? 0 : (s.correctConcept + s.correctRefusal) / s.total);
/** Named a concept and it was wrong, including any concept named on a must-refuse record. */
const incorrectFillOf = (s: Score): number => (s.total === 0 ? 0 : (s.wrongConcept + s.missedRefusal) / s.total);
const abstentionOf = (s: Score): number => (s.total === 0 ? 0 : s.abstained / s.total);

function macroOf(s: Score): { precision: number; recall: number; f1: number } {
  const rows = GOLD_CONCEPTS.map((id) => prf1(s.perConcept.get(id)!));
  return {
    precision: rows.reduce((a, b) => a + b.precision, 0) / rows.length,
    recall: rows.reduce((a, b) => a + b.recall, 0) / rows.length,
    f1: rows.reduce((a, b) => a + b.f1, 0) / rows.length,
  };
}

// ─── Report ───────────────────────────────────────────────────────────────────

const lines: string[] = [];
const say = (text = ''): void => {
  console.log(text);
  lines.push(text);
};

const dev = ALL.filter((r) => r.split === 'dev');
const validation = ALL.filter((r) => r.split === 'validation');
const heldout = ALL.filter((r) => r.split === 'heldout');

const shipped = formpilot('context', { threshold: true, guard: true });
const headline = scoreMethod(shipped, heldout, { withPolicy: true });
const headlineMacro = macroOf(headline);

say('FormPilot held-out evaluation v2 — independent, after the payment-field safety fix');
say(`  corpus fetched ${corpus.fetchedAt}`);
say(`  ${ALL.length} controls from ${new Set(ALL.map((r) => r.provenance)).size} files by unrelated authors`);
say('  ZERO file overlap with v1: every v1 source was excluded before fetching');
say("  ground truth: each file's own autocomplete token, per the WHATWG HTML specification");
say('  the token is withheld from every method under test');
say();
say('  configuration frozen at commit 62eb9c0 before this harness first ran.');
say('  nothing was tuned in response to these results.');
say();
say('── Test population ──');
say(`  development  ${dev.length} controls, ${new Set(dev.map((r) => r.provenance)).size} files`);
say(`  validation   ${validation.length} controls, ${new Set(validation.map((r) => r.provenance)).size} files`);
say(`  HELD-OUT     ${heldout.length} controls, ${new Set(heldout.map((r) => r.provenance)).size} files`);
say();
const hoRefusable = heldout.filter((r) => r.mustRefuse).length;
say(`  of the held-out split: ${hoRefusable} must be refused (${percent(hoRefusable / heldout.length)}),`);
say(`  ${heldout.filter((r) => !r.label).length} carry no label, ${heldout.filter((r) => r.nonLatin).length} are non-Latin.`);
say('  The mix is deliberately payment- and credential-heavy so the safety fix is measured on');
say('  markup it has never seen. That makes v2 accuracy NOT comparable to v1 as a like-for-like');
say('  number — different population, different base rates.');
say();

say('── Held-out result, shipped pipeline ──');
say(`  records                  ${headline.total}`);
say(`  accuracy                 ${percent(accuracyOf(headline))}  95% CI ${ci(headline.correctConcept + headline.correctRefusal, headline.total)}`);
say(`  macro precision          ${percent(headlineMacro.precision)}`);
say(`  macro recall             ${percent(headlineMacro.recall)}`);
say(`  macro F1                 ${percent(headlineMacro.f1)}`);
say(`  abstention rate          ${percent(abstentionOf(headline))}  95% CI ${ci(headline.abstained, headline.total)}`);
say(`  incorrect-fill rate      ${percent(incorrectFillOf(headline))}  95% CI ${ci(headline.wrongConcept + headline.missedRefusal, headline.total)}`);
say(`  safety-refusal rate      ${headline.correctRefusal}/${hoRefusable} = ${percent(hoRefusable === 0 ? 0 : headline.correctRefusal / hoRefusable)}  95% CI ${ci(headline.correctRefusal, hoRefusable)}`);
say(`  correct concept          ${headline.correctConcept}`);
say(`  wrong concept            ${headline.wrongConcept}`);
say(`  abstained when answerable ${headline.missedCoverage}`);
say(`  missed refusals          ${headline.missedRefusal}   (of which at auto-accept confidence: ${headline.confidentOnRefusable})`);
say();

const BASELINES: { name: string; method: Method; note: string }[] = [
  { name: 'A exact label', method: baselineExactLabel, note: 'normalized label == an alias' },
  { name: 'B substring', method: baselineSubstring, note: 'longest alias inside the label' },
  { name: 'C metadata', method: baselineMetadata, note: 'as B, over label/aria/name/id/placeholder' },
  { name: 'D semantic', method: baselineSemantic, note: 'token and character similarity, no gates' },
  { name: 'FormPilot (match only)', method: shipped, note: 'no safety policy in front' },
];

say('── Baselines, held-out, matching only (no safety policy) ──');
say('  method                    acc      macro F1   abstain  incorrect-fill  missed refusals');
const baselineRows = BASELINES.map(({ name, method, note }) => {
  const s = scoreMethod(method, heldout);
  const m = macroOf(s);
  say(
    `  ${name.padEnd(25)} ${percent(accuracyOf(s)).padStart(6)}   ${percent(m.f1).padStart(8)}   ` +
      `${percent(abstentionOf(s)).padStart(7)}  ${percent(incorrectFillOf(s)).padStart(14)}  ${String(s.missedRefusal).padStart(15)}`,
  );
  return {
    method: name, note,
    accuracy: round(accuracyOf(s)), accuracyCI: wilson(s.correctConcept + s.correctRefusal, s.total),
    macroPrecision: round(m.precision), macroRecall: round(m.recall), macroF1: round(m.f1),
    abstentionRate: round(abstentionOf(s)), incorrectFillRate: round(incorrectFillOf(s)),
    correctConcept: s.correctConcept, wrongConcept: s.wrongConcept,
    correctRefusal: s.correctRefusal, missedRefusal: s.missedRefusal,
  };
});
say();

const ABLATION: { name: string; method: Method; policy: boolean; note: string }[] = [
  { name: '1 label only', method: formpilot('label', { threshold: false, guard: false }), policy: false, note: 'the label alone' },
  { name: '2 + name/id', method: formpilot('metadata', { threshold: false, guard: false }), policy: false, note: 'plus name, id, placeholder, aria-label' },
  { name: '3 + control type', method: formpilot('context', { threshold: false, guard: false }), policy: false, note: 'plus the input type' },
  { name: '4 + semantic gates', method: formpilot('context', { threshold: true, guard: false }), policy: false, note: 'plus the commitment threshold' },
  { name: '5 + confidence calib.', method: formpilot('context', { threshold: true, guard: true }), policy: false, note: 'plus the ambiguity guard' },
  { name: '6 full system', method: shipped, policy: true, note: 'plus the safety policy' },
];

say('── Ablation, held-out ──');
say('  configuration             acc      macro F1   abstain  incorrect-fill  missed refusals');
const ablationRows = ABLATION.map(({ name, method, policy, note }) => {
  const s = scoreMethod(method, heldout, { withPolicy: policy });
  const m = macroOf(s);
  say(
    `  ${name.padEnd(25)} ${percent(accuracyOf(s)).padStart(6)}   ${percent(m.f1).padStart(8)}   ` +
      `${percent(abstentionOf(s)).padStart(7)}  ${percent(incorrectFillOf(s)).padStart(14)}  ${String(s.missedRefusal).padStart(15)}`,
  );
  return {
    configuration: name, note, policyApplied: policy,
    accuracy: round(accuracyOf(s)), macroF1: round(m.f1),
    abstentionRate: round(abstentionOf(s)), incorrectFillRate: round(incorrectFillOf(s)),
    wrongConcept: s.wrongConcept, missedRefusal: s.missedRefusal, correctRefusal: s.correctRefusal,
  };
});
say();

const strata: { name: string; records: typeof ALL }[] = [
  { name: 'all held-out', records: heldout },
  { name: 'must-refuse', records: heldout.filter((r) => r.mustRefuse) },
  { name: 'answerable', records: heldout.filter((r) => !r.mustRefuse) },
  { name: 'Latin labels', records: heldout.filter((r) => !r.nonLatin && r.label !== '') },
  { name: 'non-Latin labels', records: heldout.filter((r) => r.nonLatin) },
  { name: 'no label', records: heldout.filter((r) => r.label === '') },
];
say('── By declared stratum, shipped pipeline ──');
say('  stratum                    n      acc      95% CI                abstain  incorrect-fill');
const strataRows = strata.map(({ name, records }) => {
  const s = scoreMethod(shipped, records, { withPolicy: true });
  say(
    `  ${name.padEnd(26)} ${String(records.length).padStart(3)}   ${percent(accuracyOf(s)).padStart(6)}   ` +
      `${ci(s.correctConcept + s.correctRefusal, s.total).padEnd(20)}  ${percent(abstentionOf(s)).padStart(7)}  ${percent(incorrectFillOf(s)).padStart(14)}`,
  );
  return {
    stratum: name, n: records.length,
    accuracy: round(accuracyOf(s)), accuracyCI: wilson(s.correctConcept + s.correctRefusal, s.total),
    abstentionRate: round(abstentionOf(s)), incorrectFillRate: round(incorrectFillOf(s)),
    correctConcept: s.correctConcept, wrongConcept: s.wrongConcept,
    correctRefusal: s.correctRefusal, missedRefusal: s.missedRefusal,
  };
});
say();

say('── Per concept, shipped pipeline ──');
say('  concept                     support   P        R        F1');
const perConcept = GOLD_CONCEPTS.map((conceptId) => {
  const m = prf1(headline.perConcept.get(conceptId)!);
  if (m.support > 0) {
    say(
      `  ${conceptId.padEnd(27)} ${String(m.support).padStart(7)}   ${percent(m.precision).padStart(6)}   ` +
        `${percent(m.recall).padStart(6)}   ${percent(m.f1).padStart(6)}`,
    );
  }
  return { conceptId, support: m.support, precision: round(m.precision), recall: round(m.recall), f1: round(m.f1), counts: m.counts };
}).filter((row) => row.support > 0);
say();

say('── Every held-out error, shipped pipeline ──');
const grouped = new Map<string, number>();
for (const error of headline.errors) {
  const key = `${error.expected ?? 'MUST REFUSE'} → ${error.got ?? 'abstained'}  |  ${JSON.stringify(error.label).slice(0, 44)}`;
  grouped.set(key, (grouped.get(key) ?? 0) + 1);
}
for (const [key, count] of [...grouped].sort((a, b) => b[1] - a[1])) say(`  ${String(count).padStart(3)}×  ${key}`);
say();

const outDir = path.join(HERE, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'latest.json'),
  `${JSON.stringify(
    {
      '//': 'Held-out v2. Independent measurement after the payment-field safety fix.',
      '//notComparableToV1':
        'v2 is payment- and credential-heavy by design so the safety fix is measured on unseen ' +
        'markup. Base rates differ from v1, so the accuracy figures are not like-for-like.',
      freezeCommit: '62eb9c073d31a2a1b3f55cc6adb3e197470f81e3',
      corpusFetchedAt: corpus.fetchedAt,
      population: {
        controls: ALL.length,
        files: new Set(ALL.map((r) => r.provenance)).size,
        splits: { dev: dev.length, validation: validation.length, heldout: heldout.length },
        heldout: {
          controls: heldout.length,
          files: new Set(heldout.map((r) => r.provenance)).size,
          mustRefuse: hoRefusable,
          unlabelled: heldout.filter((r) => !r.label).length,
          nonLatin: heldout.filter((r) => r.nonLatin).length,
        },
        goldConcepts: GOLD_CONCEPTS.length,
      },
      headline: {
        records: headline.total,
        accuracy: round(accuracyOf(headline)),
        accuracyCI95: wilson(headline.correctConcept + headline.correctRefusal, headline.total),
        macroPrecision: round(headlineMacro.precision),
        macroRecall: round(headlineMacro.recall),
        macroF1: round(headlineMacro.f1),
        abstentionRate: round(abstentionOf(headline)),
        abstentionCI95: wilson(headline.abstained, headline.total),
        incorrectFillRate: round(incorrectFillOf(headline)),
        incorrectFillCI95: wilson(headline.wrongConcept + headline.missedRefusal, headline.total),
        safetyRefusalRate: round(hoRefusable === 0 ? 0 : headline.correctRefusal / hoRefusable),
        safetyRefusalCI95: wilson(headline.correctRefusal, hoRefusable),
        correctConcept: headline.correctConcept,
        wrongConcept: headline.wrongConcept,
        abstainedWhenAnswerable: headline.missedCoverage,
        correctRefusal: headline.correctRefusal,
        missedRefusal: headline.missedRefusal,
        missedRefusalAtAutoAccept: headline.confidentOnRefusable,
      },
      baselines: baselineRows,
      ablation: ablationRows,
      strata: strataRows,
      perConcept,
      errors: headline.errors,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  path.join(outDir, 'latest.md'),
  [
    '# Held-out evaluation v2 — latest run',
    '',
    'Generated by `npm run study:heldout-v2`. Every number is computed from that run.',
    '',
    'Independent: ground truth from third-party `autocomplete` attributes, corpus disjoint from v1,',
    'configuration frozen at `62eb9c0` before the first run. See',
    '`research/held-out-evaluation-v2.md` for the population description and what the numbers do and',
    'do not support.',
    '',
    '```',
    ...lines,
    '```',
    '',
  ].join('\n'),
);

say('  wrote research/heldout-v2/results/latest.json and latest.md');
