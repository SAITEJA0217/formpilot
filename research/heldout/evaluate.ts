/**
 * Held-out evaluation, baseline comparison and ablation, on third-party form labels.
 *
 * ## Why this exists
 *
 * Every earlier number in this repository came from a corpus its own author wrote. This one does
 * not. 658 form controls were extracted from 134 HTML files written by unrelated authors — among
 * them Mozilla's own autofill test corpus, Stripe's checkout examples, the Nova Scotia and
 * Government of Canada design systems, WCAG reference forms and a French government COVID form —
 * and the ground truth is each file's *own* `autocomplete` attribute, whose meaning the WHATWG
 * HTML specification fixes.
 *
 * The attribute is withheld from every method under test. The task is: given a label a stranger
 * wrote, infer the concept that stranger's own attribute declares.
 *
 * ## Configuration freeze
 *
 * The matching configuration was frozen at commit `6e01e8e` before this harness was first run, and
 * the SHA-256 of every file that defines matching behaviour was recorded (see
 * `held-out-evaluation.md`). Nothing in the ontology, the matcher, the thresholds or the safety
 * policy has been changed since, and nothing will be changed in response to what this reports. If
 * a defect shows up here it is written down as a limitation, not tuned away.
 *
 * ## Declared before the first run
 *
 * These decisions are stated here rather than chosen after seeing results:
 *
 *  1. **Grouped split.** Records are split by *file*, not by record, so no author's markup appears
 *     in two splits. The split is a hash of the file path — nothing is hand-placed.
 *  2. **40 / 20 / 40** across development, validation and held-out.
 *  3. **Nothing is filtered.** Non-Latin labels stay in, even though `research/limitations.md`
 *     already records that the ontology is English-only and they will therefore fail. Dropping them
 *     would inflate the headline. They are reported as a declared stratum instead.
 *  4. **Unlabelled controls stay in.** 136 records carry no label, only a `name`, `id` or
 *     `placeholder`. Those are exactly the fields a real autofiller struggles with.
 *  5. **Refusal is scored as a class.** 72 records carry a password, one-time-code or payment-card
 *     token. Ground truth for them is "must be refused", and naming any concept is an error. This
 *     is the first test of the safety policy against markup nobody here wrote.
 *
 * ## Metrics
 *
 * Reported per method over the same records:
 *  - **Accuracy** over all scored records: correct concept, or correct refusal.
 *  - **Precision / recall / F1**, macro-averaged over a fixed gold concept set so every method is
 *    averaged over the same denominator. A method cannot shrink its own denominator by answering
 *    less.
 *  - **Mapping errors, false positives, false negatives**, counted explicitly.
 *
 * Usage:  npm run study:heldout
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createDomEnvironment } from '../benchmark/domEnv';
import { percent, prf1, round, type ConfusionCounts } from '../benchmark/metrics';

createDomEnvironment();

const { matchField } = await import('../../shared/matching/matcher');
const { UNKNOWN_MATCH_SCORE } = await import('../../shared/matching/router');
const { normalizeText, tokenSet } = await import('../../shared/matching/normalize');
const { diceCoefficient, tokenSetF1 } = await import('../../shared/matching/similarity');
const { INDEXED_CONCEPTS } = await import('../../shared/ontology');
const { evaluateFieldSafety } = await import('../../shared/safety/policy');

type FieldType = import('../../shared/types/form').FieldType;
type UnifiedField = import('../../shared/types/form').UnifiedField;

// ─── Corpus ───────────────────────────────────────────────────────────────────

interface Record_ {
  provenance: string;
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

/** Deterministic split by file, so one author's markup never spans two splits. */
type Split = 'dev' | 'validation' | 'heldout';
function splitFor(provenance: string): Split {
  const digest = createHash('sha256').update(provenance).digest();
  const bucket = digest[0] % 100;
  if (bucket < 40) return 'dev';
  if (bucket < 60) return 'validation';
  return 'heldout';
}

/** True when a label is mostly outside the Latin range — a declared stratum, not a filter. */
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

/** Every concept the ground truth uses. The macro denominator, identical for every method. */
const GOLD_CONCEPTS = [
  ...new Set(ALL.map((record) => record.expectedConcept).filter((c): c is string => c !== null)),
].sort();

// ─── What each method is allowed to see ───────────────────────────────────────

/** The ablation tiers, in order of increasing information. */
type Visibility = 'label' | 'metadata' | 'context';

/**
 * Build the field a method sees.
 *
 * `autocomplete` is never populated: that is the answer. `type` is withheld below the `context`
 * tier because a `type="email"` control all but names its own concept, which would confound a
 * label-only measurement.
 */
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

  // `context` tier: the control's own type. The corpus carries no section headings — these are
  // fragments of real pages, not whole forms — so the type is the only additional context
  // available, and this tier measures that rather than section context. Stated plainly because
  // calling it "context" and silently measuring something else would be misleading.
  const KNOWN_TYPES = new Set([
    'text', 'email', 'tel', 'url', 'number', 'date', 'password', 'search', 'month', 'time',
  ]);
  base.type = (KNOWN_TYPES.has(record.type) ? record.type : 'text') as FieldType;
  return base as unknown as UnifiedField;
}

/** What a method returned. `null` means it declined to name a concept. */
interface Prediction {
  conceptId: string | null;
  score: number;
}

type Method = (record: (typeof ALL)[number]) => Prediction;

/** Text a baseline may read, at the metadata tier. */
function searchText(record: (typeof ALL)[number]): string[] {
  return [record.label, record.ariaLabel, record.name, record.elementId, record.placeholder]
    .filter((value) => value.length > 0)
    .map((value) => normalizeText(value));
}

/** Baseline A — the normalized label must equal one of a concept's aliases exactly. */
const baselineExactLabel: Method = (record) => {
  const label = normalizeText(record.label);
  if (!label) return { conceptId: null, score: 0 };
  for (const concept of INDEXED_CONCEPTS) {
    if (concept.normalizedAliases.includes(label)) return { conceptId: concept.def.id, score: 1 };
  }
  return { conceptId: null, score: 0 };
};

/** Baseline B — exact alias match against the label, aria-label, name, id or placeholder. */
const baselineExactMetadata: Method = (record) => {
  for (const text of searchText(record)) {
    for (const concept of INDEXED_CONCEPTS) {
      if (concept.normalizedAliases.includes(text)) return { conceptId: concept.def.id, score: 1 };
    }
  }
  return { conceptId: null, score: 0 };
};

/** Baseline C — substring containment, longest alias wins, across all metadata. */
const baselineSubstring: Method = (record) => {
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

/**
 * Baseline D — "semantic" matching without the ontology's structure.
 *
 * Token-set F1 plus character bigram similarity against aliases, taking the best. This is the
 * strongest thing a reasonable implementer builds without weighted signals, type gates, negatives
 * or a commitment threshold, so it is the baseline FormPilot has to beat to justify its
 * complexity.
 */
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

/** FormPilot's matcher at a given visibility tier, with optional gating. */
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

/**
 * The safety policy's own verdict, which is what actually runs in the product.
 *
 * A method that names a concept for a password field is still wrong, but in the shipped system the
 * policy refuses the field before matching happens at all. Both are reported: the method's own
 * behaviour, and the behaviour of the method *with* the policy in front of it.
 */
function policyRefuses(record: (typeof ALL)[number]): boolean {
  return (
    evaluateFieldSafety({
      type: (record.type === 'password' ? 'password' : 'text') as FieldType,
      label: record.label,
      name: record.name,
      elementId: record.elementId,
      ariaLabel: record.ariaLabel,
      placeholder: record.placeholder,
      // `autocomplete` withheld here too: the policy's own autocomplete rule would read the answer.
    }).sensitivity === 'blocked'
  );
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface Score {
  total: number;
  correctConcept: number;
  wrongConcept: number;
  declinedWhenAnswerable: number;
  correctRefusal: number;
  missedRefusal: number;
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
    declinedWhenAnswerable: 0,
    correctRefusal: 0,
    missedRefusal: 0,
    perConcept: new Map(
      GOLD_CONCEPTS.map((id) => [id, { truePositives: 0, falsePositives: 0, falseNegatives: 0 }]),
    ),
    errors: [],
  };
  const bump = (conceptId: string, key: keyof ConfusionCounts): void => {
    const counts = score.perConcept.get(conceptId);
    if (counts) counts[key] += 1;
  };

  for (const record of records) {
    const refusedByPolicy = options.withPolicy && policyRefuses(record);
    const prediction = refusedByPolicy ? { conceptId: null, score: 0 } : method(record);

    if (record.mustRefuse) {
      if (prediction.conceptId === null) {
        score.correctRefusal += 1;
      } else {
        score.missedRefusal += 1;
        bump(prediction.conceptId, 'falsePositives');
        score.errors.push({
          label: record.label || `(${record.name || record.elementId})`,
          expected: null,
          got: prediction.conceptId,
          provenance: record.provenance,
        });
      }
      continue;
    }

    const expected = record.expectedConcept!;
    if (prediction.conceptId === null) {
      score.declinedWhenAnswerable += 1;
      bump(expected, 'falseNegatives');
      score.errors.push({
        label: record.label || `(${record.name || record.elementId})`,
        expected,
        got: null,
        provenance: record.provenance,
      });
    } else if (prediction.conceptId === expected) {
      score.correctConcept += 1;
      bump(expected, 'truePositives');
    } else {
      score.wrongConcept += 1;
      bump(prediction.conceptId, 'falsePositives');
      bump(expected, 'falseNegatives');
      score.errors.push({
        label: record.label || `(${record.name || record.elementId})`,
        expected,
        got: prediction.conceptId,
        provenance: record.provenance,
      });
    }
  }
  return score;
}

const accuracyOf = (score: Score): number =>
  score.total === 0 ? 0 : (score.correctConcept + score.correctRefusal) / score.total;

function macroOf(score: Score): { precision: number; recall: number; f1: number } {
  const rows = GOLD_CONCEPTS.map((id) => prf1(score.perConcept.get(id)!));
  return {
    precision: rows.reduce((a, b) => a + b.precision, 0) / rows.length,
    recall: rows.reduce((a, b) => a + b.recall, 0) / rows.length,
    f1: rows.reduce((a, b) => a + b.f1, 0) / rows.length,
  };
}

// ─── Methods under test ───────────────────────────────────────────────────────

const BASELINES: { name: string; note: string; method: Method }[] = [
  { name: 'A exact label', note: 'normalized label == an alias', method: baselineExactLabel },
  { name: 'B exact + metadata', note: 'as A, over label/aria/name/id/placeholder', method: baselineExactMetadata },
  { name: 'C substring', note: 'longest alias contained in any metadata', method: baselineSubstring },
  { name: 'D semantic', note: 'token-set F1 and char bigrams, no gates', method: baselineSemantic },
  {
    name: 'FormPilot (full)',
    note: 'weighted signals, gates, negatives, threshold, ambiguity guard',
    method: formpilot('context', { threshold: true, guard: true }),
  },
];

const ABLATION: { name: string; note: string; method: Method }[] = [
  { name: '1 label only', note: 'matcher sees the label alone', method: formpilot('label', { threshold: false, guard: false }) },
  { name: '2 + metadata', note: 'plus name, id, placeholder, aria-label', method: formpilot('metadata', { threshold: false, guard: false }) },
  { name: '3 + control type', note: 'plus the input type (see note in the source)', method: formpilot('context', { threshold: false, guard: false }) },
  { name: '4 + confidence floor', note: 'declines below the commitment threshold', method: formpilot('context', { threshold: true, guard: false }) },
  { name: '5 + ambiguity guard', note: 'also declines when the top two are close', method: formpilot('context', { threshold: true, guard: true }) },
  { name: '6 + safety policy', note: 'full shipped pipeline', method: formpilot('context', { threshold: true, guard: true }) },
];

// ─── Report ───────────────────────────────────────────────────────────────────

const lines: string[] = [];
const say = (text = ''): void => {
  console.log(text);
  lines.push(text);
};

const dev = ALL.filter((r) => r.split === 'dev');
const validation = ALL.filter((r) => r.split === 'validation');
const heldout = ALL.filter((r) => r.split === 'heldout');

say('FormPilot held-out evaluation — third-party form labels');
say(`  corpus fetched ${corpus.fetchedAt}`);
say(`  ${ALL.length} controls from ${new Set(ALL.map((r) => r.provenance)).size} files by unrelated authors`);
say(`  ground truth: each file's own autocomplete token, per the WHATWG HTML specification`);
say(`  the token is withheld from every method under test`);
say();
say('  configuration frozen at commit 6e01e8e before this harness first ran.');
say('  nothing in the ontology, matcher, thresholds or safety policy was changed afterwards.');
say();
say(`  split (grouped by file, deterministic hash, 40/20/40):`);
say(`    development  ${dev.length} controls, ${new Set(dev.map((r) => r.provenance)).size} files`);
say(`    validation   ${validation.length} controls, ${new Set(validation.map((r) => r.provenance)).size} files`);
say(`    HELD-OUT     ${heldout.length} controls, ${new Set(heldout.map((r) => r.provenance)).size} files`);
say();
say(`  declared strata: ${ALL.filter((r) => r.nonLatin).length} non-Latin labels (kept in; the`);
say(`  ontology is English-only and limitations.md already says so), ${ALL.filter((r) => !r.label).length} with no label at all,`);
say(`  ${ALL.filter((r) => r.mustRefuse).length} credential or payment controls whose ground truth is refusal.`);
say();

// ── Baselines on the held-out set ──
say('── Baseline comparison, HELD-OUT set ──');
say('  method                 acc      macro P   macro R   macro F1   wrong  declined  missed refusals');
const baselineRows = BASELINES.map(({ name, note, method }) => {
  const score = scoreMethod(method, heldout);
  const macro = macroOf(score);
  say(
    `  ${name.padEnd(22)} ${percent(accuracyOf(score)).padStart(6)}   ` +
      `${percent(macro.precision).padStart(7)}   ${percent(macro.recall).padStart(7)}   ` +
      `${percent(macro.f1).padStart(8)}   ${String(score.wrongConcept).padStart(5)}  ` +
      `${String(score.declinedWhenAnswerable).padStart(8)}  ${String(score.missedRefusal).padStart(15)}`,
  );
  return {
    method: name,
    note,
    accuracy: round(accuracyOf(score)),
    macroPrecision: round(macro.precision),
    macroRecall: round(macro.recall),
    macroF1: round(macro.f1),
    correctConcept: score.correctConcept,
    wrongConcept: score.wrongConcept,
    declinedWhenAnswerable: score.declinedWhenAnswerable,
    correctRefusal: score.correctRefusal,
    missedRefusal: score.missedRefusal,
  };
});
say();

// ── Ablation on the held-out set ──
say('── Ablation, HELD-OUT set ──');
say('  configuration            acc      macro F1   wrong  declined  missed refusals');
const ablationRows = ABLATION.map(({ name, note, method }, index) => {
  const withPolicy = index === ABLATION.length - 1;
  const score = scoreMethod(method, heldout, { withPolicy });
  const macro = macroOf(score);
  say(
    `  ${name.padEnd(24)} ${percent(accuracyOf(score)).padStart(6)}   ` +
      `${percent(macro.f1).padStart(8)}   ${String(score.wrongConcept).padStart(5)}  ` +
      `${String(score.declinedWhenAnswerable).padStart(8)}  ${String(score.missedRefusal).padStart(15)}`,
  );
  return {
    configuration: name,
    note,
    policyApplied: withPolicy,
    accuracy: round(accuracyOf(score)),
    macroF1: round(macro.f1),
    wrongConcept: score.wrongConcept,
    declinedWhenAnswerable: score.declinedWhenAnswerable,
    correctRefusal: score.correctRefusal,
    missedRefusal: score.missedRefusal,
  };
});
say();

// ── The shipped pipeline, stratified ──
const shipped = formpilot('context', { threshold: true, guard: true });
const strata: { name: string; records: typeof ALL }[] = [
  { name: 'all held-out', records: heldout },
  { name: 'Latin labels', records: heldout.filter((r) => !r.nonLatin && r.label !== '') },
  { name: 'non-Latin labels', records: heldout.filter((r) => r.nonLatin) },
  { name: 'no label (name/id only)', records: heldout.filter((r) => r.label === '') },
  { name: 'must-refuse controls', records: heldout.filter((r) => r.mustRefuse) },
];
say('── Shipped pipeline, HELD-OUT, by declared stratum ──');
say('  stratum                    n      acc      macro F1');
const strataRows = strata.map(({ name, records }) => {
  const score = scoreMethod(shipped, records, { withPolicy: true });
  const macro = macroOf(score);
  say(
    `  ${name.padEnd(26)} ${String(records.length).padStart(3)}   ` +
      `${percent(accuracyOf(score)).padStart(6)}   ${percent(macro.f1).padStart(8)}`,
  );
  return {
    stratum: name,
    n: records.length,
    accuracy: round(accuracyOf(score)),
    macroF1: round(macro.f1),
    correctConcept: score.correctConcept,
    wrongConcept: score.wrongConcept,
    declinedWhenAnswerable: score.declinedWhenAnswerable,
    correctRefusal: score.correctRefusal,
    missedRefusal: score.missedRefusal,
  };
});
say();

// ── Per-concept detail for the shipped pipeline ──
const headline = scoreMethod(shipped, heldout, { withPolicy: true });
const headlineMacro = macroOf(headline);
say('── Per-concept, shipped pipeline, HELD-OUT ──');
say('  concept                     support   P        R        F1');
const perConcept = GOLD_CONCEPTS.map((conceptId) => {
  const m = prf1(headline.perConcept.get(conceptId)!);
  if (m.support > 0) {
    say(
      `  ${conceptId.padEnd(27)} ${String(m.support).padStart(7)}   ` +
        `${percent(m.precision).padStart(6)}   ${percent(m.recall).padStart(6)}   ${percent(m.f1).padStart(6)}`,
    );
  }
  return {
    conceptId,
    support: m.support,
    precision: round(m.precision),
    recall: round(m.recall),
    f1: round(m.f1),
    counts: m.counts,
  };
});
say();

say('── Headline, HELD-OUT, shipped pipeline ──');
say(`  records                 ${headline.total}`);
say(`  correct concept         ${headline.correctConcept}`);
say(`  correct refusal         ${headline.correctRefusal}`);
say(`  accuracy                ${percent(accuracyOf(headline))}`);
say(`  macro precision         ${percent(headlineMacro.precision)}`);
say(`  macro recall            ${percent(headlineMacro.recall)}`);
say(`  macro F1                ${percent(headlineMacro.f1)}`);
say(`  wrong concept (FP+FN)   ${headline.wrongConcept}`);
say(`  declined when answerable (FN) ${headline.declinedWhenAnswerable}`);
say(`  missed refusal (FP)     ${headline.missedRefusal}`);
say();

// Every error, named. A held-out evaluation that hides its failures is not one.
say('── Every held-out error, shipped pipeline ──');
const grouped = new Map<string, number>();
for (const error of headline.errors) {
  const key = `${error.expected ?? 'MUST REFUSE'} → ${error.got ?? 'declined'}  |  ${JSON.stringify(error.label).slice(0, 44)}`;
  grouped.set(key, (grouped.get(key) ?? 0) + 1);
}
for (const [key, count] of [...grouped].sort((a, b) => b[1] - a[1])) {
  say(`  ${String(count).padStart(3)}×  ${key}`);
}
say();

const outDir = path.join(HERE, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'latest.json'),
  `${JSON.stringify(
    {
      '//': 'Held-out evaluation on third-party form labels. See evaluate.ts for the procedure.',
      freezeCommit: '6e01e8e99e0c52d1e79024ef20581e7494f4d89b',
      corpusFetchedAt: corpus.fetchedAt,
      dataset: {
        controls: ALL.length,
        files: new Set(ALL.map((r) => r.provenance)).size,
        splits: { dev: dev.length, validation: validation.length, heldout: heldout.length },
        strata: {
          nonLatinLabels: ALL.filter((r) => r.nonLatin).length,
          unlabelled: ALL.filter((r) => !r.label).length,
          mustRefuse: ALL.filter((r) => r.mustRefuse).length,
        },
        goldConcepts: GOLD_CONCEPTS.length,
      },
      heldout: {
        headline: {
          records: headline.total,
          accuracy: round(accuracyOf(headline)),
          macroPrecision: round(headlineMacro.precision),
          macroRecall: round(headlineMacro.recall),
          macroF1: round(headlineMacro.f1),
          correctConcept: headline.correctConcept,
          correctRefusal: headline.correctRefusal,
          wrongConcept: headline.wrongConcept,
          declinedWhenAnswerable: headline.declinedWhenAnswerable,
          missedRefusal: headline.missedRefusal,
        },
        perConcept: perConcept.filter((row) => row.support > 0),
        errors: headline.errors,
      },
      baselines: baselineRows,
      ablation: ablationRows,
      strata: strataRows,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  path.join(outDir, 'latest.md'),
  [
    '# Held-out evaluation — latest run',
    '',
    'Generated by `npm run study:heldout`. Every number is computed from that run.',
    '',
    'Ground truth comes from third-party `autocomplete` attributes, not from this project.',
    'Configuration was frozen at commit `6e01e8e` before the first run. See',
    '`research/held-out-evaluation.md` for the full procedure and what the numbers do and do not',
    'support.',
    '',
    '```',
    ...lines,
    '```',
    '',
  ].join('\n'),
);

say('  wrote research/heldout/results/latest.json and latest.md');
