/**
 * FormPilot benchmark runner.
 *
 * Runs the real engine over the real fixture pages and scores it against hand-written
 * ground truth. Everything it prints is computed from that run; nothing is estimated and
 * no number is carried over between runs.
 *
 * Usage:  npm run bench            (from the repository root)
 *
 * Deliberate limits, stated rather than hidden:
 *  - No model is called. Fields the router sends to a model are scored on *routing*
 *    (did it correctly decide a model is needed?) and excluded from value accuracy.
 *  - jsdom has no layout engine and does not load iframe `src`, so `iframe-form.html`
 *    is excluded and must be verified manually in a browser.
 *  - Acceptance, correction and override rates need human participants. The harness
 *    reports the review burden it creates, and nothing about how humans respond to it.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDomEnvironment } from './domEnv';
import { BENCHMARK_PROFILE } from './profile';
import { accuracy, mean, percent, prf1, round, stdev, sumCounts, type ConfusionCounts } from './metrics';

// The engine reads realm-bound globals (`instanceof Document`), so the DOM must exist
// before the modules are loaded.
const env = createDomEnvironment();

const { normalizeForm } = await import('../../extension/src/core/normalize/formNormalizer');
const { fillFields } = await import('../../extension/src/core/interaction/engine');
const { buildSuggestions } = await import('../../shared/matching/pipeline');
const { normalizeText } = await import('../../shared/matching/normalize');
const { summarize } = await import('../../shared/matching/summary');
const { isGenerativeConcept } = await import('../../shared/ontology');
type FieldSuggestion = import('../../shared/types/suggestion').FieldSuggestion;
type UnifiedField = import('../../shared/types/form').UnifiedField;

// ─── Ground truth ─────────────────────────────────────────────────────────────

type Outcome = 'fill' | 'model' | 'document' | 'blocked' | 'manual' | 'review';

/**
 * Is the engine's disposition acceptable for the expected one?
 *
 * `review` is the honest expectation for a genuinely ambiguous field: the only
 * requirement is that the engine does *not* fill it confidently, and both "ask the user"
 * and "ask the model to adjudicate" satisfy that. Declared here, up front, rather than
 * relaxed after seeing the results.
 */
function outcomeAcceptable(expected: Outcome, predicted: Outcome): boolean {
  if (expected === 'review') return predicted === 'manual' || predicted === 'model';
  return predicted === expected;
}

interface GroundTruthField {
  label: string;
  type: string;
  concept: string | null;
  expected: string | string[] | null;
  outcome: Outcome;
}

type Mutation =
  | { click: string }
  | { setHtml: { selector: string; html: string } }
  | { selectOption: { selector: string; value: string } };

interface GroundTruth {
  page: string;
  variant?: string;
  category: string;
  platform: string;
  url: string;
  notes?: string;
  mutations?: Mutation[];
  fields: GroundTruthField[];
}

const DATASET_DIR = path.resolve(import.meta.dirname, 'dataset');
const RESULTS_DIR = path.resolve(import.meta.dirname, 'results');

function loadDataset(): GroundTruth[] {
  return readdirSync(DATASET_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(DATASET_DIR, file), 'utf8')) as GroundTruth);
}

function applyMutations(mutations: Mutation[] | undefined): void {
  for (const mutation of mutations ?? []) {
    if ('click' in mutation) {
      const target = env.window.document.querySelector<HTMLElement>(mutation.click);
      target?.click();
    } else if ('setHtml' in mutation) {
      const target = env.window.document.querySelector(mutation.setHtml.selector);
      if (target) target.innerHTML = mutation.setHtml.html;
    } else {
      const select = env.window.document.querySelector<HTMLSelectElement>(mutation.selectOption.selector);
      if (select) {
        select.value = mutation.selectOption.value;
        select.dispatchEvent(new env.window.Event('change', { bubbles: true }));
      }
    }
  }
}

// ─── Comparison helpers ───────────────────────────────────────────────────────

/** The disposition the engine actually chose for a field. */
function predictedOutcome(suggestion: FieldSuggestion): Outcome {
  switch (suggestion.status) {
    case 'blocked':
      return 'blocked';
    case 'needs_document':
      return 'document';
    case 'manual':
    case 'no_data':
      return 'manual';
    default:
      // A value-less needs_review means the router deferred the field to a model.
      return suggestion.value === null ? 'model' : 'fill';
  }
}

/**
 * The concept the engine *asserted*. A below-threshold candidate that was routed to
 * manual entry is not an assertion, so it is not scored as one.
 */
function predictedConcept(suggestion: FieldSuggestion): string | null {
  if (suggestion.status === 'manual' || suggestion.status === 'no_data') return null;
  const conceptId = suggestion.provenance.conceptId ?? null;
  // A field sent to a model for *adjudication* asserts nothing: the engine is saying it
  // cannot choose between its candidates. A field sent for *generation* is different —
  // recognising it as a long-form concept is exactly the assertion that routed it there.
  if (suggestion.value === null && suggestion.provenance.usedAI && !isGenerativeConcept(conceptId ?? '')) {
    return null;
  }
  return conceptId;
}

function valuesMatch(expected: string | string[] | null, actual: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined || actual === '';
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    // Selection order is not meaningful for a checkbox set; compare as sets.
    const left = new Set(expected.map((v) => normalizeText(String(v))));
    const right = new Set(actual.map((v) => normalizeText(String(v))));
    if (left.size !== right.size) return false;
    for (const value of left) if (!right.has(value)) return false;
    return true;
  }
  if (Array.isArray(actual)) return false;
  return normalizeText(String(expected)) === normalizeText(String(actual ?? ''));
}

/** Pair ground-truth fields with detected fields by normalized label, greedily. */
function pairFields(
  truth: GroundTruthField[],
  detected: UnifiedField[],
): {
  pairs: { truth: GroundTruthField; field: UnifiedField }[];
  missed: GroundTruthField[];
  spurious: UnifiedField[];
} {
  const remaining = [...detected];
  const pairs: { truth: GroundTruthField; field: UnifiedField }[] = [];
  const missed: GroundTruthField[] = [];

  for (const expected of truth) {
    const wanted = normalizeText(expected.label);
    const index = remaining.findIndex((field) => normalizeText(field.label ?? '') === wanted);
    if (index === -1) {
      missed.push(expected);
      continue;
    }
    pairs.push({ truth: expected, field: remaining[index] });
    remaining.splice(index, 1);
  }
  return { pairs, missed, spurious: remaining };
}

/**
 * Read a control's current value back out of the DOM.
 *
 * Grouped controls are read through their own option selectors: the group's "primary"
 * element is one member, so inspecting it alone reports one checkbox's state rather than
 * the group's selection.
 */
function readBack(
  field: UnifiedField,
  element: Element,
  root: Document | ShadowRoot,
): string | string[] | boolean | null {
  const options = field.options ?? [];
  const grouped = field.type === 'radio_group' || field.type === 'checkbox_group';
  if (grouped && options.length > 0) {
    const selected: string[] = [];
    for (const option of options) {
      if (!option.selector) continue;
      const el = root.querySelector(option.selector);
      if (!el) continue;
      const checked =
        el.tagName === 'INPUT'
          ? (el as HTMLInputElement).checked
          : el.getAttribute('aria-checked') === 'true';
      if (checked) selected.push(option.value);
    }
    if (field.type === 'radio_group') return selected[0] ?? null;
    return selected;
  }
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    const input = element as HTMLInputElement;
    if (input.type === 'checkbox' || input.type === 'radio') return input.checked;
    return input.value || null;
  }
  if (element.tagName === 'SELECT') {
    const select = element as unknown as HTMLSelectElement;
    if (select.multiple) return Array.from(select.selectedOptions).map((o) => o.value);
    return select.value || null;
  }
  if (grouped) {
    const checked = Array.from(element.querySelectorAll('[aria-checked="true"]')).map(
      (el) => el.getAttribute('data-value') ?? el.getAttribute('aria-label') ?? '',
    );
    return field.type === 'radio_group' ? (checked[0] ?? null) : checked;
  }
  if (field.type === 'select_one' || field.type === 'select_many') {
    // A custom listbox reflects its selection in its own text.
    const selectedOption = options.find(
      (option) => option.selector && root.querySelector(option.selector)?.getAttribute('aria-selected') === 'true',
    );
    if (selectedOption) return selectedOption.value;
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text && !/^(choose|select)$/i.test(text) ? text : null;
  }
  if (element.hasAttribute('contenteditable')) return element.textContent || null;
  return null;
}

// ─── Per-page evaluation ──────────────────────────────────────────────────────

interface FieldRecord {
  page: string;
  category: string;
  label: string;
  fieldType: string;
  labelSource: string;
  expectedConcept: string | null;
  predictedConcept: string | null;
  conceptCorrect: boolean | null;
  expectedOutcome: Outcome;
  predictedOutcome: Outcome;
  outcomeCorrect: boolean;
  expectedValue: string | string[] | null;
  proposedValue: unknown;
  domValue: unknown;
  valueCorrect: boolean | null;
  confidence: number;
  band: string;
  usedAI: boolean;
}

interface PageResult {
  page: string;
  variant?: string;
  category: string;
  notes?: string;
  platformExpected: string;
  platformDetected: string;
  platformCorrect: boolean;
  adapter: string;
  detection: ConfusionCounts;
  mapping: ConfusionCounts;
  mappingAccuracy: { correct: number; incorrect: number; total: number };
  outcomeAccuracy: { correct: number; incorrect: number; total: number };
  autofill: { correct: number; incorrect: number; missed: number; total: number };
  safetyViolations: string[];
  timings: { detectMs: number; suggestMs: number; fillMs: number };
  modelCallsRequired: number;
  statuses: Record<string, number>;
  warnings: string[];
  fields: FieldRecord[];
}

async function evaluatePage(truth: GroundTruth): Promise<PageResult> {
  // Fresh realm per page: see the note in domEnv.ts on why reuse is not safe here.
  env.loadPage(truth.page, truth.url);
  applyMutations(truth.mutations);

  const detectStart = performance.now();
  const normalized = normalizeForm({ root: env.window.document, href: truth.url });
  const detectMs = performance.now() - detectStart;

  const suggestStart = performance.now();
  const { suggestions, aiRequests } = buildSuggestions(normalized.form, BENCHMARK_PROFILE, {
    documents: BENCHMARK_PROFILE.documents,
  });
  const suggestMs = performance.now() - suggestStart;

  const summary = summarize(normalized.form, suggestions);
  const suggestionById = new Map(suggestions.map((s) => [s.fieldId, s]));

  // Simulate a user who accepts every proposal, which is the strictest reading of
  // autofill accuracy and the only way to observe an over-eager fill.
  const fillStart = performance.now();
  const entries = suggestions
    .filter((s) => s.value !== null)
    .map((s) => {
      const field = normalized.form.fields.find((f) => f.id === s.fieldId)!;
      const handle = normalized.elements.get(s.fieldId)!;
      return {
        target: { field, element: handle.element, root: handle.root, members: handle.members },
        value: s.value,
      };
    });
  await fillFields(entries, { platformHandler: normalized.adapter.fillField, interFieldDelayMs: 0 });
  const fillMs = performance.now() - fillStart;

  const { pairs, missed, spurious } = pairFields(truth.fields, normalized.form.fields);

  const detection: ConfusionCounts = {
    truePositives: pairs.length,
    falsePositives: spurious.length,
    falseNegatives: missed.length,
  };

  const mapping: ConfusionCounts = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
  let mappingCorrect = 0;
  let mappingTotal = 0;
  let outcomeCorrect = 0;
  const autofill = { correct: 0, incorrect: 0, missed: 0, total: 0 };
  const safetyViolations: string[] = [];
  const records: FieldRecord[] = [];

  for (const { truth: expected, field } of pairs) {
    const suggestion = suggestionById.get(field.id);
    const handle = normalized.elements.get(field.id)!;
    const predicted = suggestion ? predictedConcept(suggestion) : null;
    const outcome = suggestion ? predictedOutcome(suggestion) : 'manual';
    const domValue = readBack(field, handle.element, handle.root);

    // Concept mapping.
    let conceptCorrect: boolean | null = null;
    if (expected.concept !== null || predicted !== null) {
      mappingTotal += 1;
      conceptCorrect = expected.concept !== null && predicted === expected.concept;
      if (conceptCorrect) {
        mapping.truePositives += 1;
        mappingCorrect += 1;
      } else {
        if (predicted !== null) mapping.falsePositives += 1;
        if (expected.concept !== null) mapping.falseNegatives += 1;
      }
    }

    // Routing decision.
    const outcomeMatches = outcomeAcceptable(expected.outcome, outcome);
    if (outcomeMatches) outcomeCorrect += 1;

    // Value accuracy, only where a value was supposed to be produced offline.
    let valueCorrect: boolean | null = null;
    if (expected.outcome === 'fill') {
      autofill.total += 1;
      if (suggestion?.value === null || suggestion === undefined) {
        autofill.missed += 1;
        valueCorrect = false;
      } else if (valuesMatch(expected.expected, domValue)) {
        autofill.correct += 1;
        valueCorrect = true;
      } else {
        autofill.incorrect += 1;
        valueCorrect = false;
      }
    } else if (expected.outcome === 'blocked' || expected.outcome === 'document') {
      const wroteSomething =
        (suggestion?.value ?? null) !== null ||
        (typeof domValue === 'boolean' ? domValue : domValue !== null && domValue !== '');
      if (wroteSomething) safetyViolations.push(expected.label);
    }

    records.push({
      page: truth.page + (truth.variant ? `#${truth.variant}` : ''),
      category: truth.category,
      label: expected.label,
      fieldType: field.type,
      labelSource: field.labelSource,
      expectedConcept: expected.concept,
      predictedConcept: predicted,
      conceptCorrect,
      expectedOutcome: expected.outcome,
      predictedOutcome: outcome,
      outcomeCorrect: outcomeMatches,
      expectedValue: expected.expected,
      proposedValue: suggestion?.value ?? null,
      domValue,
      valueCorrect,
      confidence: round(suggestion?.confidence ?? 0),
      band: suggestion?.band ?? 'low',
      usedAI: suggestion?.provenance.usedAI ?? false,
    });
  }

  for (const field of missed) {
    records.push({
      page: truth.page + (truth.variant ? `#${truth.variant}` : ''),
      category: truth.category,
      label: field.label,
      fieldType: 'NOT DETECTED',
      labelSource: 'n/a',
      expectedConcept: field.concept,
      predictedConcept: null,
      conceptCorrect: field.concept === null ? null : false,
      expectedOutcome: field.outcome,
      predictedOutcome: 'manual',
      outcomeCorrect: false,
      expectedValue: field.expected,
      proposedValue: null,
      domValue: null,
      valueCorrect: field.outcome === 'fill' ? false : null,
      confidence: 0,
      band: 'low',
      usedAI: false,
    });
    if (field.outcome === 'fill') {
      autofill.total += 1;
      autofill.missed += 1;
    }
    if (field.concept !== null) {
      mappingTotal += 1;
      mapping.falseNegatives += 1;
    }
  }

  return {
    page: truth.page,
    variant: truth.variant,
    category: truth.category,
    notes: truth.notes,
    platformExpected: truth.platform,
    platformDetected: normalized.form.platform,
    platformCorrect: normalized.form.platform === truth.platform,
    adapter: normalized.adapter.id,
    detection,
    mapping,
    mappingAccuracy: { correct: mappingCorrect, incorrect: mappingTotal - mappingCorrect, total: mappingTotal },
    outcomeAccuracy: {
      correct: outcomeCorrect,
      incorrect: truth.fields.length - outcomeCorrect,
      total: truth.fields.length,
    },
    autofill,
    safetyViolations,
    timings: { detectMs: round(detectMs, 2), suggestMs: round(suggestMs, 2), fillMs: round(fillMs, 2) },
    modelCallsRequired: aiRequests.length > 0 ? 1 : 0,
    statuses: {
      ready: summary.ready,
      needsReview: summary.needsReview,
      manual: summary.manual,
      blocked: summary.blocked,
      noData: summary.noData,
    },
    warnings: normalized.form.metadata.warnings,
    fields: records,
  };
}

// ─── Aggregation and reporting ────────────────────────────────────────────────

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const rule = `|${headers.map(() => '---').join('|')}|`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, rule, body].join('\n');
}

const dataset = loadDataset();
const results: PageResult[] = [];
for (const truth of dataset) {
  // Sequential on purpose: every page shares one jsdom document.
  results.push(await evaluatePage(truth));
}

const allFields = results.flatMap((r) => r.fields);
const detectionOverall = prf1(sumCounts(results.map((r) => r.detection)));
const mappingOverall = prf1(sumCounts(results.map((r) => r.mapping)));
const mappingAcc = accuracy({
  correct: results.reduce((a, r) => a + r.mappingAccuracy.correct, 0),
  incorrect: results.reduce((a, r) => a + r.mappingAccuracy.incorrect, 0),
  total: results.reduce((a, r) => a + r.mappingAccuracy.total, 0),
});
const outcomeAcc = accuracy({
  correct: results.reduce((a, r) => a + r.outcomeAccuracy.correct, 0),
  incorrect: results.reduce((a, r) => a + r.outcomeAccuracy.incorrect, 0),
  total: results.reduce((a, r) => a + r.outcomeAccuracy.total, 0),
});
const autofillTotals = results.reduce(
  (acc, r) => ({
    correct: acc.correct + r.autofill.correct,
    incorrect: acc.incorrect + r.autofill.incorrect,
    missed: acc.missed + r.autofill.missed,
    total: acc.total + r.autofill.total,
  }),
  { correct: 0, incorrect: 0, missed: 0, total: 0 },
);
const safetyViolations = results.flatMap((r) => r.safetyViolations.map((label) => `${r.page}: ${label}`));
const detectTimings = results.map((r) => r.timings.detectMs);
const suggestTimings = results.map((r) => r.timings.suggestMs);
const fieldsTotal = allFields.filter((f) => f.fieldType !== 'NOT DETECTED').length;
const modelBound = allFields.filter((f) => f.predictedOutcome === 'model').length;
const statusTotals = results.reduce<Record<string, number>>((acc, r) => {
  for (const [key, value] of Object.entries(r.statuses)) acc[key] = (acc[key] ?? 0) + value;
  return acc;
}, {});
const statusSum = Object.values(statusTotals).reduce((a, b) => a + b, 0);

const timestamp = new Date().toISOString();
const report = {
  generatedAt: timestamp,
  engine: { version: '2.0.0' },
  environment: { runtime: `node ${process.version}`, dom: 'jsdom', modelCalled: false },
  dataset: { pages: dataset.length, fields: dataset.reduce((a, d) => a + d.fields.length, 0) },
  detection: {
    precision: round(detectionOverall.precision),
    recall: round(detectionOverall.recall),
    f1: round(detectionOverall.f1),
    counts: detectionOverall.counts,
  },
  mapping: {
    precision: round(mappingOverall.precision),
    recall: round(mappingOverall.recall),
    f1: round(mappingOverall.f1),
    accuracy: round(mappingAcc),
    counts: mappingOverall.counts,
  },
  routing: { outcomeAccuracy: round(outcomeAcc) },
  autofill: {
    ...autofillTotals,
    successRate: round(autofillTotals.total === 0 ? 0 : autofillTotals.correct / autofillTotals.total),
  },
  safety: { violations: safetyViolations, clean: safetyViolations.length === 0 },
  efficiency: {
    detectMsMean: round(mean(detectTimings), 2),
    detectMsStdev: round(stdev(detectTimings), 2),
    suggestMsMean: round(mean(suggestTimings), 2),
    modelCallsTotal: results.reduce((a, r) => a + r.modelCallsRequired, 0),
    modelBoundFields: modelBound,
    fieldsEvaluated: fieldsTotal,
    deterministicFieldShare: round(fieldsTotal === 0 ? 0 : 1 - modelBound / fieldsTotal),
  },
  humanInTheLoop: {
    statusTotals,
    automationRate: round(statusSum === 0 ? 0 : (statusTotals.ready ?? 0) / statusSum),
    reviewBurden: round(
      statusSum === 0 ? 0 : ((statusTotals.needsReview ?? 0) + (statusTotals.manual ?? 0) + (statusTotals.noData ?? 0)) / statusSum,
    ),
    note: 'Acceptance, correction and override rates require human participants and are not measured here.',
  },
  pages: results.map((r) => ({
    page: r.page + (r.variant ? `#${r.variant}` : ''),
    category: r.category,
    platformDetected: r.platformDetected,
    platformCorrect: r.platformCorrect,
    adapter: r.adapter,
    detection: prf1(r.detection),
    mappingAccuracy: round(accuracy(r.mappingAccuracy)),
    outcomeAccuracy: round(accuracy(r.outcomeAccuracy)),
    autofill: r.autofill,
    safetyViolations: r.safetyViolations,
    timings: r.timings,
    statuses: r.statuses,
    warnings: r.warnings,
  })),
  fields: allFields,
};

mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(path.join(RESULTS_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);

// ─── Markdown report ──────────────────────────────────────────────────────────

const byCategory = groupBy(results, (r) => r.category);
const categoryRows = Array.from(byCategory.entries()).map(([category, pages]) => {
  const det = prf1(sumCounts(pages.map((p) => p.detection)));
  const map = accuracy({
    correct: pages.reduce((a, p) => a + p.mappingAccuracy.correct, 0),
    incorrect: pages.reduce((a, p) => a + p.mappingAccuracy.incorrect, 0),
    total: pages.reduce((a, p) => a + p.mappingAccuracy.total, 0),
  });
  const fill = pages.reduce(
    (acc, p) => ({ correct: acc.correct + p.autofill.correct, total: acc.total + p.autofill.total }),
    { correct: 0, total: 0 },
  );
  const violations = pages.reduce((a, p) => a + p.safetyViolations.length, 0);
  return [
    category,
    pages.length,
    det.support,
    percent(det.precision),
    percent(det.recall),
    percent(det.f1),
    percent(map),
    fill.total === 0 ? 'n/a' : percent(fill.correct / fill.total),
    violations,
  ];
});

const byType = groupBy(
  allFields.filter((f) => f.fieldType !== 'NOT DETECTED'),
  (f) => f.fieldType,
);
const typeRows = Array.from(byType.entries())
  .sort((a, b) => b[1].length - a[1].length)
  .map(([type, fields]) => {
    const scored = fields.filter((f) => f.conceptCorrect !== null);
    const filled = fields.filter((f) => f.valueCorrect !== null);
    return [
      type,
      fields.length,
      scored.length === 0 ? 'n/a' : percent(scored.filter((f) => f.conceptCorrect).length / scored.length),
      filled.length === 0 ? 'n/a' : percent(filled.filter((f) => f.valueCorrect).length / filled.length),
    ];
  });

const bySource = groupBy(
  allFields.filter((f) => f.fieldType !== 'NOT DETECTED'),
  (f) => f.labelSource,
);
const sourceRows = Array.from(bySource.entries())
  .sort((a, b) => b[1].length - a[1].length)
  .map(([source, fields]) => {
    const scored = fields.filter((f) => f.conceptCorrect !== null);
    return [
      source,
      fields.length,
      scored.length === 0 ? 'n/a' : percent(scored.filter((f) => f.conceptCorrect).length / scored.length),
      round(mean(fields.map((f) => f.confidence))),
    ];
  });

const disagreements = allFields.filter(
  (f) => f.outcomeCorrect === false || f.conceptCorrect === false || f.valueCorrect === false,
);

const markdown = `# FormPilot benchmark results

Generated: ${timestamp}
Runtime: node ${process.version}, jsdom. **No language model was called**: fields the router
defers to a model are scored on the routing decision only.

Dataset: ${dataset.length} page states, ${report.dataset.fields} labelled fields.
Ground truth: \`research/benchmark/dataset/*.json\` (hand-written from the fixture markup).
Reproduce with \`npm run bench\`.

## Headline numbers

${table(
  ['Metric', 'Value', 'Counts'],
  [
    ['Field detection precision', percent(detectionOverall.precision), `TP ${detectionOverall.counts.truePositives} / FP ${detectionOverall.counts.falsePositives}`],
    ['Field detection recall', percent(detectionOverall.recall), `TP ${detectionOverall.counts.truePositives} / FN ${detectionOverall.counts.falseNegatives}`],
    ['Field detection F1', percent(detectionOverall.f1), '—'],
    ['Concept mapping precision', percent(mappingOverall.precision), `TP ${mappingOverall.counts.truePositives} / FP ${mappingOverall.counts.falsePositives}`],
    ['Concept mapping recall', percent(mappingOverall.recall), `TP ${mappingOverall.counts.truePositives} / FN ${mappingOverall.counts.falseNegatives}`],
    ['Concept mapping F1', percent(mappingOverall.f1), '—'],
    ['Concept mapping accuracy', percent(mappingAcc), `${report.mapping.counts.truePositives}/${report.mapping.counts.truePositives + report.mapping.counts.falsePositives + report.mapping.counts.falseNegatives}`],
    ['Routing decision accuracy', percent(outcomeAcc), '—'],
    ['Autofill success rate', percent(report.autofill.successRate), `${autofillTotals.correct} correct / ${autofillTotals.incorrect} wrong / ${autofillTotals.missed} missed`],
    ['Safety violations', String(safetyViolations.length), safetyViolations.length === 0 ? 'none' : safetyViolations.join('; ')],
  ],
)}

## Efficiency

${table(
  ['Metric', 'Value'],
  [
    ['Detection time per page (mean)', `${report.efficiency.detectMsMean} ms (sd ${report.efficiency.detectMsStdev})`],
    ['Matching time per page (mean)', `${report.efficiency.suggestMsMean} ms`],
    ['Model calls required (total)', String(report.efficiency.modelCallsTotal)],
    ['Fields needing a model', `${modelBound} of ${fieldsTotal}`],
    ['Fields resolved without a model', percent(report.efficiency.deterministicFieldShare)],
  ],
)}

## Human-in-the-loop burden

${table(
  ['Status', 'Fields', 'Share'],
  Object.entries(statusTotals).map(([status, count]) => [status, count, percent(statusSum === 0 ? 0 : count / statusSum)]),
)}

Automation rate (pre-accepted, high confidence): **${percent(report.humanInTheLoop.automationRate)}**.
Review burden: **${percent(report.humanInTheLoop.reviewBurden)}**.
Acceptance, correction and override rates require human participants; this harness does not
estimate them.

## By category

${table(
  ['Category', 'Pages', 'Fields', 'Det. P', 'Det. R', 'Det. F1', 'Mapping acc.', 'Autofill', 'Safety violations'],
  categoryRows,
)}

## By field type

${table(['Field type', 'Fields', 'Mapping acc.', 'Value acc.'], typeRows)}

## By label source

${table(['Label source', 'Fields', 'Mapping acc.', 'Mean confidence'], sourceRows)}

## Per page

${table(
  ['Page', 'Platform', 'Adapter', 'Det. F1', 'Mapping acc.', 'Routing acc.', 'Autofill', 'Detect ms'],
  results.map((r) => [
    r.page + (r.variant ? `#${r.variant}` : ''),
    r.platformCorrect ? r.platformDetected : `${r.platformDetected} (expected ${r.platformExpected})`,
    r.adapter,
    percent(prf1(r.detection).f1),
    percent(accuracy(r.mappingAccuracy)),
    percent(accuracy(r.outcomeAccuracy)),
    r.autofill.total === 0 ? 'n/a' : `${r.autofill.correct}/${r.autofill.total}`,
    r.timings.detectMs,
  ]),
)}

## Disagreements with ground truth (${disagreements.length})

${
  disagreements.length === 0
    ? 'None.'
    : table(
        ['Page', 'Field', 'Expected concept', 'Predicted concept', 'Expected outcome', 'Predicted outcome', 'Value'],
        disagreements.map((f) => [
          f.page,
          f.label,
          f.expectedConcept ?? '—',
          f.predictedConcept ?? '—',
          f.expectedOutcome,
          f.predictedOutcome,
          f.valueCorrect === false ? `got ${JSON.stringify(f.domValue)}` : '—',
        ]),
      )
}

## Excluded from this run

- \`iframe-form.html\` — jsdom does not load iframe \`src\` documents, so an offline run
  would measure nothing. Frame traversal is covered by \`tests/integration/shadow-iframe.test.ts\`
  with synthetic frames; the page itself needs manual browser verification.
- Microsoft Forms, Typeform, Jotform and SurveyMonkey — recognised by platform detection but
  with no dedicated adapter and no fixture, so there is nothing to measure yet.
`;

writeFileSync(path.join(RESULTS_DIR, 'latest.md'), markdown);

// ─── Console summary ──────────────────────────────────────────────────────────

console.log(`\nFormPilot benchmark — ${dataset.length} page states, ${report.dataset.fields} labelled fields\n`);
console.log(`  detection      P ${percent(detectionOverall.precision)}  R ${percent(detectionOverall.recall)}  F1 ${percent(detectionOverall.f1)}`);
console.log(`  mapping        P ${percent(mappingOverall.precision)}  R ${percent(mappingOverall.recall)}  F1 ${percent(mappingOverall.f1)}  acc ${percent(mappingAcc)}`);
console.log(`  routing        acc ${percent(outcomeAcc)}`);
console.log(`  autofill       ${autofillTotals.correct}/${autofillTotals.total} correct (${percent(report.autofill.successRate)}), ${autofillTotals.incorrect} wrong, ${autofillTotals.missed} missed`);
console.log(`  safety         ${safetyViolations.length === 0 ? 'no violations' : `${safetyViolations.length} VIOLATIONS`}`);
console.log(`  efficiency     ${report.efficiency.detectMsMean} ms detect/page, ${report.efficiency.modelCallsTotal} model calls, ${percent(report.efficiency.deterministicFieldShare)} of fields resolved without a model`);
console.log(`  disagreements  ${disagreements.length}`);
console.log(`\n  wrote research/benchmark/results/latest.json and latest.md\n`);

if (safetyViolations.length > 0) {
  console.error('Safety violations detected:');
  for (const violation of safetyViolations) console.error(`  - ${violation}`);
  process.exitCode = 1;
}
