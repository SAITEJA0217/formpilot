/**
 * Semantic matching study.
 *
 * Three things, over one hand-labelled dataset (`labels.json`):
 *
 *   1. **Accuracy.** Per-concept and macro precision/recall/F1, plus a confusion matrix of
 *      what got mapped to what.
 *   2. **Threshold sweep.** How the commitment threshold trades coverage against errors,
 *      swept from 0.50 to 0.95.
 *   3. **Ablation.** The full matcher against four weaker baselines and against itself with
 *      one signal family removed at a time, so the contribution of each part is visible
 *      rather than asserted.
 *
 * Usage:  npm run study:matching
 *
 * **Limits, stated rather than hidden.**
 *  - 69 cases is a small dataset. Every number here carries that caveat; a difference of
 *    one or two cases is not a meaningful difference. Counts are printed alongside every
 *    rate so the reader can see the support.
 *  - The labels are the author's judgement about what a field means. Where a human could
 *    not resolve it either, the case is marked `ambiguous` and scored on whether the engine
 *    *declined*, not on which concept it picked.
 *  - No model is called. This measures the deterministic matcher only, which is the part
 *    that decides whether a model is needed at all.
 *  - The baselines are re-implementations written for this harness, not published systems.
 *    They show what the ontology and the multi-signal scorer add over the obvious simpler
 *    strategies; they are not a comparison against prior work.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDomEnvironment } from '../benchmark/domEnv';
import { percent, prf1, round, sumCounts, type ConfusionCounts } from '../benchmark/metrics';

// The matcher imports modules that touch realm globals, so the DOM comes first.
createDomEnvironment();

const { matchField, AMBIGUITY_MARGIN } = await import('../../shared/matching/matcher');
const { UNKNOWN_MATCH_SCORE } = await import('../../shared/matching/router');
const { DEFAULT_THRESHOLDS } = await import('../../shared/matching/confidence');

/** The auto-accept band. A `review` case must stay below this. */
const HIGH_BAND = DEFAULT_THRESHOLDS.high;
const { normalizeText, tokenSet } = await import('../../shared/matching/normalize');
const { diceCoefficient, tokenSetF1 } = await import('../../shared/matching/similarity');
const { INDEXED_CONCEPTS, conceptForAutocomplete } = await import('../../shared/ontology');

type FieldType = import('../../shared/types/form').FieldType;
type UnifiedField = import('../../shared/types/form').UnifiedField;

// ─── Dataset ──────────────────────────────────────────────────────────────────

interface Case {
  group: string;
  label: string;
  type: FieldType;
  concept: string | null;
  /** A human could not resolve this from the label either: declining is correct. */
  ambiguous?: boolean;
  /** Present only where a well-built real form would plausibly set the attribute. */
  autocomplete?: string;
  note?: string;
}

const HERE = import.meta.dirname;
const dataset = JSON.parse(readFileSync(path.join(HERE, 'labels.json'), 'utf8')) as {
  cases: Case[];
};
const CASES = dataset.cases;

/** Minimal field record; the study varies only label and type on purpose. */
function fieldFor(testCase: Case): UnifiedField {
  return {
    id: `case_${testCase.label}`,
    type: testCase.type,
    label: testCase.label,
    autocomplete: testCase.autocomplete,
    required: false,
    disabled: false,
    readOnly: false,
    sensitivity: 'normal',
    options: [],
    location: { framePath: [], shadowPath: [] },
    selector: '',
  } as unknown as UnifiedField;
}

// ─── Predictions ──────────────────────────────────────────────────────────────

/** What a strategy decided for one case. `null` means "declined to answer". */
interface Prediction {
  conceptId: string | null;
  score: number;
  declinedBecause?: 'below_threshold' | 'ambiguous' | 'no_candidate';
}

type Strategy = (testCase: Case, threshold: number) => Prediction;

/**
 * The shipped matcher, with its own commitment rules.
 *
 * A match below `threshold` is not committed, and neither is one where the top two
 * candidates are within `AMBIGUITY_MARGIN` — that second rule is the one that makes
 * `Company` come back as "ask the user" rather than a coin flip.
 */
const formpilot: Strategy = (testCase, threshold) => {
  const result = matchField(fieldFor(testCase), {});
  if (!result.best) return { conceptId: null, score: 0, declinedBecause: 'no_candidate' };
  if (result.best.score < threshold) {
    return { conceptId: null, score: result.best.score, declinedBecause: 'below_threshold' };
  }
  if (result.ambiguous) {
    return { conceptId: null, score: result.best.score, declinedBecause: 'ambiguous' };
  }
  return { conceptId: result.best.conceptId, score: result.best.score };
};

/** Baseline 1: the normalized label must equal an alias exactly. */
const exactAlias: Strategy = (testCase) => {
  const label = normalizeText(testCase.label);
  for (const concept of INDEXED_CONCEPTS) {
    for (const alias of concept.normalizedAliases) {
      if (alias === label) return { conceptId: concept.def.id, score: 1 };
    }
  }
  return { conceptId: null, score: 0, declinedBecause: 'no_candidate' };
};

/** Baseline 2: the label contains an alias as a substring. Longest alias wins. */
const substringAlias: Strategy = (testCase) => {
  const label = ` ${normalizeText(testCase.label)} `;
  let best: { id: string; length: number } | null = null;
  for (const concept of INDEXED_CONCEPTS) {
    for (const alias of concept.normalizedAliases) {
      if (label.includes(` ${alias} `) && (!best || alias.length > best.length)) {
        best = { id: concept.def.id, length: alias.length };
      }
    }
  }
  return best
    ? { conceptId: best.id, score: 1 }
    : { conceptId: null, score: 0, declinedBecause: 'no_candidate' };
};

/** Baseline 3: character-level string similarity against aliases, no ontology structure. */
const fuzzyChars: Strategy = (testCase, threshold) => {
  const label = normalizeText(testCase.label);
  let bestId: string | null = null;
  let bestScore = 0;
  for (const concept of INDEXED_CONCEPTS) {
    for (const alias of concept.normalizedAliases) {
      const score = diceCoefficient(label, alias);
      if (score > bestScore) {
        bestScore = score;
        bestId = concept.def.id;
      }
    }
  }
  if (bestId === null || bestScore < threshold) {
    return { conceptId: null, score: bestScore, declinedBecause: 'below_threshold' };
  }
  return { conceptId: bestId, score: bestScore };
};

/** Baseline 4: token-set F1 against aliases. Stopwords removed, no weighting, no gates. */
const fuzzyTokens: Strategy = (testCase, threshold) => {
  const tokens = tokenSet(testCase.label);
  let bestId: string | null = null;
  let bestScore = 0;
  for (const concept of INDEXED_CONCEPTS) {
    for (const alias of concept.normalizedAliases) {
      const score = tokenSetF1(tokens, tokenSet(alias));
      if (score > bestScore) {
        bestScore = score;
        bestId = concept.def.id;
      }
    }
  }
  if (bestId === null || bestScore < threshold) {
    return { conceptId: null, score: bestScore, declinedBecause: 'below_threshold' };
  }
  return { conceptId: bestId, score: bestScore };
};

/**
 * Baseline 5: the `autocomplete` attribute alone.
 *
 * Included because it is the browser's own answer to this problem and the honest upper
 * bound on a non-semantic approach: perfectly precise where present, silent everywhere else.
 * The dataset carries `autocomplete` only on the cases where a well-built real form would
 * plausibly set one, which is how this row quantifies the cost of depending on it.
 */
const autocompleteOnly: Strategy = (testCase) => {
  if (!testCase.autocomplete) return { conceptId: null, score: 0, declinedBecause: 'no_candidate' };
  const concept = conceptForAutocomplete(testCase.autocomplete);
  return concept
    ? { conceptId: concept.def.id, score: 1 }
    : { conceptId: null, score: 0, declinedBecause: 'no_candidate' };
};

/**
 * The matcher with its ambiguity rule switched off: always commit to the top candidate.
 *
 * This isolates what the "decline when the top two are close" rule buys. Higher coverage by
 * construction; the question is what it costs in wrong answers.
 */
const noAmbiguityGuard: Strategy = (testCase, threshold) => {
  const result = matchField(fieldFor(testCase), {});
  if (!result.best || result.best.score < threshold) {
    return { conceptId: null, score: result.best?.score ?? 0, declinedBecause: 'below_threshold' };
  }
  return { conceptId: result.best.conceptId, score: result.best.score };
};

/** The matcher with no threshold at all: commit to whatever scores highest. */
const alwaysCommit: Strategy = (testCase) => {
  const result = matchField(fieldFor(testCase), {});
  return result.best
    ? { conceptId: result.best.conceptId, score: result.best.score }
    : { conceptId: null, score: 0, declinedBecause: 'no_candidate' };
};

const STRATEGIES: { name: string; run: Strategy; note: string }[] = [
  { name: 'FormPilot (full)', run: formpilot, note: 'multi-signal + threshold + ambiguity guard' },
  { name: 'no ambiguity guard', run: noAmbiguityGuard, note: 'ablation: always commit to the top candidate' },
  { name: 'no threshold', run: alwaysCommit, note: 'ablation: no commitment floor and no guard' },
  { name: 'exact alias', run: exactAlias, note: 'baseline: normalized label == alias' },
  { name: 'substring alias', run: substringAlias, note: 'baseline: label contains an alias' },
  { name: 'token-set F1', run: fuzzyTokens, note: 'baseline: token overlap, no weights or gates' },
  { name: 'character dice', run: fuzzyChars, note: 'baseline: character bigram similarity' },
  { name: 'autocomplete only', run: autocompleteOnly, note: 'baseline: the browser attribute alone' },
];

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface Scored {
  correct: number;
  wrong: number;
  declined: number;
  /** Declined a case that had a resolvable concept. */
  missedCoverage: number;
  /** Declined a case where declining was the right answer. */
  correctlyDeclined: number;
  /** Answered a case that should have been declined. */
  overreach: number;
  perConcept: Map<string, ConfusionCounts>;
  confusions: Map<string, number>;
}

/**
 * The concept set the ground truth actually uses.
 *
 * Every strategy is scored against this same fixed set, which is what makes the macro
 * averages comparable. Averaging over "whichever concepts this strategy happened to touch"
 * is the obvious implementation and it is misleading: a strategy that answers fewer cases
 * touches fewer concepts and so is averaged over an easier, smaller denominator. The first
 * version of this harness did exactly that and ranked a plain substring baseline above the
 * full matcher as a result.
 */
const GOLD_CONCEPTS = [...new Set(CASES.map((c) => c.concept).filter((c): c is string => c !== null))].sort();

/**
 * What a case demands of a strategy.
 *
 *  - `resolve`  — one concept is correct and must be named confidently.
 *  - `review`   — a concept is *probably* right but a human could not be sure from the label
 *                 alone, so naming it below the auto-accept band, or declining, both pass;
 *                 naming it confidently fails.
 *  - `decline`  — no concept is correct and nothing may be named.
 *
 * The three-way split exists because the first version of this harness scored `review` cases
 * as if they were `decline` cases. That conflated two different requirements and reported a
 * correct medium-confidence suggestion as an error. The dataset always said "must not answer
 * this *confidently*"; the harness was the part that was wrong.
 */
type Expectation = 'resolve' | 'review' | 'decline';

function expectationFor(testCase: Case): Expectation {
  if (testCase.concept === null) return 'decline';
  return testCase.ambiguous === true ? 'review' : 'resolve';
}

interface Scored {
  /** `resolve` cases answered with the right concept. */
  correct: number;
  /** `resolve` cases answered with the wrong concept. */
  wrong: number;
  /** `resolve` cases declined. */
  missedCoverage: number;
  /** `review` cases handled with due caution (declined, or named below the high band). */
  reviewedProperly: number;
  /** `review` cases named at auto-accept confidence. */
  overconfident: number;
  /** `decline` cases correctly left alone. */
  correctlyDeclined: number;
  /** `decline` cases answered anyway. */
  overreach: number;
  declined: number;
  perConcept: Map<string, ConfusionCounts>;
  confusions: Map<string, number>;
}

/**
 * Score one strategy over the whole dataset.
 *
 * Confusion counts are only ever recorded against concepts in `GOLD_CONCEPTS`. A prediction
 * outside that set is still an error — it shows up in `wrong` or `overreach` and as a false
 * negative on the gold concept — but it does not add a row to the macro average, because a
 * strategy must not be able to change its own denominator.
 */
function score(strategy: Strategy, threshold: number): Scored {
  const result: Scored = {
    correct: 0,
    wrong: 0,
    missedCoverage: 0,
    reviewedProperly: 0,
    overconfident: 0,
    correctlyDeclined: 0,
    overreach: 0,
    declined: 0,
    perConcept: new Map(
      GOLD_CONCEPTS.map((id) => [id, { truePositives: 0, falsePositives: 0, falseNegatives: 0 }]),
    ),
    confusions: new Map(),
  };

  const bump = (conceptId: string, key: keyof ConfusionCounts): void => {
    const counts = result.perConcept.get(conceptId);
    if (counts) counts[key] += 1;
  };
  const note = (key: string): void => {
    result.confusions.set(key, (result.confusions.get(key) ?? 0) + 1);
  };

  for (const testCase of CASES) {
    const prediction = strategy(testCase, threshold);
    const expectation = expectationFor(testCase);
    if (prediction.conceptId === null) result.declined += 1;

    if (expectation === 'decline') {
      if (prediction.conceptId === null) {
        result.correctlyDeclined += 1;
      } else {
        result.overreach += 1;
        bump(prediction.conceptId, 'falsePositives');
        note(`${testCase.label} → ${prediction.conceptId} (nothing should have been named)`);
      }
      continue;
    }

    if (expectation === 'review') {
      if (prediction.conceptId === null || prediction.score < HIGH_BAND) {
        result.reviewedProperly += 1;
        // Naming the likely concept below the high band is the ideal outcome, and it is a
        // true positive for that concept: the suggestion is right, it is just not asserted.
        // `expectation === 'review'` implies a non-null `concept`; narrow explicitly so the
        // compiler agrees rather than being told to trust us.
        if (testCase.concept !== null && prediction.conceptId === testCase.concept) {
          bump(testCase.concept, 'truePositives');
        }
      } else {
        result.overconfident += 1;
        bump(prediction.conceptId, 'falsePositives');
        note(`${testCase.label} → ${prediction.conceptId} at ${prediction.score.toFixed(2)} (too confident)`);
      }
      continue;
    }

    if (prediction.conceptId === null) {
      result.missedCoverage += 1;
      bump(testCase.concept!, 'falseNegatives');
    } else if (prediction.conceptId === testCase.concept) {
      result.correct += 1;
      bump(testCase.concept, 'truePositives');
    } else {
      result.wrong += 1;
      bump(prediction.conceptId, 'falsePositives');
      bump(testCase.concept!, 'falseNegatives');
      note(`${testCase.label}: ${testCase.concept} → ${prediction.conceptId}`);
    }
  }

  return result;
}

/**
 * Macro-averaged P/R/F1 over `GOLD_CONCEPTS`.
 *
 * Every concept counts equally regardless of support, and the denominator is the same for
 * every strategy.
 */
function macro(scored: Scored): { precision: number; recall: number; f1: number } {
  const all = GOLD_CONCEPTS.map((id) => prf1(scored.perConcept.get(id)!));
  return {
    precision: all.reduce((a, b) => a + b.precision, 0) / all.length,
    recall: all.reduce((a, b) => a + b.recall, 0) / all.length,
    f1: all.reduce((a, b) => a + b.f1, 0) / all.length,
  };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const RESOLVE_CASES = CASES.filter((c) => expectationFor(c) === 'resolve');
const REVIEW_CASES = CASES.filter((c) => expectationFor(c) === 'review');
const DECLINE_CASES = CASES.filter((c) => expectationFor(c) === 'decline');

const lines: string[] = [];
const say = (text = ''): void => {
  console.log(text);
  lines.push(text);
};

say(`FormPilot semantic matching study — ${CASES.length} labelled cases`);
say(
  `  ${RESOLVE_CASES.length} must resolve, ${REVIEW_CASES.length} must be offered for review, ` +
    `${DECLINE_CASES.length} must be declined`,
);
say(
  `  commitment threshold ${UNKNOWN_MATCH_SCORE}, ambiguity margin ${AMBIGUITY_MARGIN}, ` +
    `auto-accept band ${HIGH_BAND}`,
);
say();
say('  NOTE: this dataset is no longer held out. It scored 65/69 on its first run; three');
say('  ontology defects and one harness bug were fixed in response, so it now functions as a');
say('  regression suite. See research/matching/README.md before quoting the headline number.');
say();

// 1. Accuracy at the shipped threshold.
const headline = score(formpilot, UNKNOWN_MATCH_SCORE);
const headlineMacro = macro(headline);
const micro = prf1(sumCounts([...headline.perConcept.values()]));
const totalCorrect = headline.correct + headline.reviewedProperly + headline.correctlyDeclined;

say('── Accuracy at the shipped threshold ──');
say(`  must resolve   ${headline.correct}/${RESOLVE_CASES.length} named correctly`);
say(`                 ${headline.wrong} wrong concept, ${headline.missedCoverage} declined`);
say(`  must review    ${headline.reviewedProperly}/${REVIEW_CASES.length} handled with due caution`);
say(`                 ${headline.overconfident} named at auto-accept confidence`);
say(`  must decline   ${headline.correctlyDeclined}/${DECLINE_CASES.length} left alone`);
say(`                 ${headline.overreach} answered anyway`);
say(`  overall        ${totalCorrect}/${CASES.length} (${percent(totalCorrect / CASES.length)})`);
say(`  micro  P ${percent(micro.precision)}  R ${percent(micro.recall)}  F1 ${percent(micro.f1)}`);
say(`  macro  P ${percent(headlineMacro.precision)}  R ${percent(headlineMacro.recall)}  F1 ${percent(headlineMacro.f1)}`);
say();

if (headline.confusions.size > 0) {
  say('── Remaining errors ──');
  for (const [pair, count] of [...headline.confusions].sort((a, b) => b[1] - a[1])) {
    say(`  ${count}×  ${pair}`);
  }
  say();
}

// Per-group accuracy, so a weak area cannot hide inside an overall average.
const groups = [...new Set(CASES.map((c) => c.group))];
say('── Per-group accuracy ──');
const groupRows: { group: string; correct: number; total: number }[] = [];
for (const group of groups) {
  const subset = CASES.filter((c) => c.group === group);
  let correct = 0;
  for (const testCase of subset) {
    const prediction = formpilot(testCase, UNKNOWN_MATCH_SCORE);
    const expectation = expectationFor(testCase);
    const ok =
      expectation === 'decline'
        ? prediction.conceptId === null
        : expectation === 'review'
          ? prediction.conceptId === null || prediction.score < HIGH_BAND
          : prediction.conceptId === testCase.concept;
    if (ok) correct += 1;
  }
  groupRows.push({ group, correct, total: subset.length });
  say(`  ${group.padEnd(20)} ${correct}/${subset.length}`);
}
say();

// 2. Threshold sweep.
const SWEEP = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
say('── Threshold sweep ──');
say('  thr    resolved  wrong  missed  overconf  overreach   coverage');
const sweepRows = SWEEP.map((threshold) => {
  const scored = score(formpilot, threshold);
  const coverage = (scored.correct + scored.wrong) / RESOLVE_CASES.length;
  say(
    `  ${threshold.toFixed(2)}   ${String(scored.correct).padStart(8)}  ${String(scored.wrong).padStart(5)}  ` +
      `${String(scored.missedCoverage).padStart(6)}  ${String(scored.overconfident).padStart(8)}  ` +
      `${String(scored.overreach).padStart(9)}   ${percent(coverage).padStart(6)}`,
  );
  return {
    threshold,
    resolved: scored.correct,
    wrong: scored.wrong,
    missed: scored.missedCoverage,
    overconfident: scored.overconfident,
    overreach: scored.overreach,
    coverage: round(coverage),
  };
});
say();

// 3. Ablation.
say('── Ablation and baselines ──');
say('  strategy               resolved  wrong  declined  overconf  overreach   macro F1');
const ablationRows = STRATEGIES.map(({ name, run, note }) => {
  const scored = score(run, UNKNOWN_MATCH_SCORE);
  const m = macro(scored);
  say(
    `  ${name.padEnd(22)} ${String(scored.correct).padStart(8)}  ${String(scored.wrong).padStart(5)}  ` +
      `${String(scored.declined).padStart(8)}  ${String(scored.overconfident).padStart(8)}  ` +
      `${String(scored.overreach).padStart(9)}   ${percent(m.f1).padStart(6)}`,
  );
  return {
    strategy: name,
    note,
    resolved: scored.correct,
    wrong: scored.wrong,
    declined: scored.declined,
    missedCoverage: scored.missedCoverage,
    reviewedProperly: scored.reviewedProperly,
    overconfident: scored.overconfident,
    correctlyDeclined: scored.correctlyDeclined,
    overreach: scored.overreach,
    macroF1: round(m.f1),
    macroPrecision: round(m.precision),
    macroRecall: round(m.recall),
  };
});
say();

// ─── Write results ────────────────────────────────────────────────────────────

const outDir = path.join(HERE, 'results');
mkdirSync(outDir, { recursive: true });

const json = {
  dataset: {
    cases: CASES.length,
    mustResolve: RESOLVE_CASES.length,
    mustReview: REVIEW_CASES.length,
    mustDecline: DECLINE_CASES.length,
    goldConcepts: GOLD_CONCEPTS.length,
    groups: groupRows,
  },
  settings: {
    commitmentThreshold: UNKNOWN_MATCH_SCORE,
    ambiguityMargin: AMBIGUITY_MARGIN,
    autoAcceptBand: HIGH_BAND,
  },
  headline: {
    correct: headline.correct,
    wrong: headline.wrong,
    missedCoverage: headline.missedCoverage,
    reviewedProperly: headline.reviewedProperly,
    overconfident: headline.overconfident,
    correctlyDeclined: headline.correctlyDeclined,
    overreach: headline.overreach,
    overallCorrect: totalCorrect,
    micro: { precision: round(micro.precision), recall: round(micro.recall), f1: round(micro.f1) },
    macro: {
      precision: round(headlineMacro.precision),
      recall: round(headlineMacro.recall),
      f1: round(headlineMacro.f1),
    },
    errors: [...headline.confusions].map(([pair, count]) => ({ pair, count })),
  },
  perConcept: GOLD_CONCEPTS.map((conceptId) => {
    const m = prf1(headline.perConcept.get(conceptId)!);
    return {
      conceptId,
      support: m.support,
      precision: round(m.precision),
      recall: round(m.recall),
      f1: round(m.f1),
      counts: m.counts,
    };
  }),
  thresholdSweep: sweepRows,
  ablation: ablationRows,
};

writeFileSync(path.join(outDir, 'latest.json'), `${JSON.stringify(json, null, 2)}\n`);
writeFileSync(
  path.join(outDir, 'latest.md'),
  [
    '# Semantic matching study — latest run',
    '',
    'Generated by `npm run study:matching`. Every number is computed from that run.',
    'See the header of `research/matching/run.ts` for what this does and does not measure.',
    '',
    '```',
    ...lines,
    '```',
    '',
  ].join('\n'),
);

say('  wrote research/matching/results/latest.json and latest.md');
