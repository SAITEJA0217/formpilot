/**
 * AI routing study: what the router decides, and what turning the model off costs.
 *
 * Two configurations over the whole benchmark corpus:
 *
 *   **Mode A — deterministic only** (`allowAI: false`). The rule engine alone. No request is
 *   made to any endpoint.
 *   **Mode B — deterministic + model** (`allowAI: true`). Identical, except fields the rule
 *   engine cannot resolve are routed to a model instead of being handed to the user.
 *
 * **What this measures.** The routing decisions and their consequences: how many fields each
 * mode resolves without help, how many it hands to a model, how many it hands to the user, and
 * which kinds of field drive the difference. All of that is deterministic and reproducible.
 *
 * **What this does not measure, and why.** The *quality* of a generated answer. Mode B's model
 * calls are counted, not executed: there is no provider key in this environment and no
 * provider is reachable from it. So this study reports the size and shape of the model's job,
 * never how well it does it. A number from here must never be presented as a model evaluation.
 *
 * What *is* verified about the model path, elsewhere:
 *  - `tests/e2e/specs/ai-routing.spec.ts` drives the real path end to end against a labelled
 *    deterministic stub, and asserts which fields are sent, that the profile is minimised
 *    first, that answers merge back unaccepted, and that `allowAI: false` sends nothing.
 *  - `tests/unit/router.test.ts` pins the routing rules themselves.
 *  - `tests/unit/redact.test.ts` pins the minimisation.
 *
 * Usage:  npm run study:routing
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDomEnvironment } from '../benchmark/domEnv';
import { BENCHMARK_PROFILE } from '../benchmark/profile';
import { percent, round } from '../benchmark/metrics';

const env = createDomEnvironment();

const { normalizeForm } = await import('../../extension/src/core/normalize/formNormalizer');
const { buildSuggestions } = await import('../../shared/matching/pipeline');
const { redactProfileForAI } = await import('../../shared/privacy/redact');

type SuggestionStatus = import('../../shared/types/suggestion').SuggestionStatus;
type FieldType = import('../../shared/types/form').FieldType;
type UnifiedField = import('../../shared/types/form').UnifiedField;

/**
 * Mode C — send every fillable field to the model.
 *
 * The strategy an implementation takes when it has no router: if a model can answer anything, ask
 * it about everything. Counted rather than executed, like Mode B. A field the safety policy refuses
 * and a file input are excluded even here, because sending those to a model would be a safety
 * failure rather than a routing choice.
 */
function alwaysAiCandidates(fields: readonly UnifiedField[]): UnifiedField[] {
  return fields.filter((field) => field.sensitivity !== 'blocked' && field.type !== 'file');
}

/**
 * Bytes on the wire for one request carrying `count` fields.
 *
 * A cost proxy that is actually measurable here. Real provider cost is per token and depends on a
 * price list this environment cannot see, so no currency figure is reported — only the payload the
 * request would carry, which is what a token count is computed from.
 */
function payloadBytes(profile: unknown, fieldRecords: unknown[], formContext: unknown): number {
  return Buffer.byteLength(JSON.stringify({ profile, fields: fieldRecords, formContext }), 'utf8');
}

// ─── Corpus ───────────────────────────────────────────────────────────────────

interface GroundTruthPage {
  page: string;
  category: string;
  url: string;
  mutations?: unknown[];
  fields: { label: string; type: string; concept: string | null; outcome: string }[];
}

const DATASET_DIR = path.join(import.meta.dirname, '../benchmark/dataset');
const PAGES: GroundTruthPage[] = readdirSync(DATASET_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(path.join(DATASET_DIR, name), 'utf8')) as GroundTruthPage)
  // Pages needing scripted interaction to reach their state are excluded: this study is about
  // routing, and replaying mutations here would duplicate the benchmark runner for no gain.
  .filter((page) => !page.mutations || page.mutations.length === 0)
  .sort((a, b) => a.page.localeCompare(b.page));

// ─── Measurement ──────────────────────────────────────────────────────────────

interface ModeTotals {
  fields: number;
  /** Filled or ready without any model involvement. */
  resolvedLocally: number;
  /** Routed to a model. */
  routedToModel: number;
  /** Handed to the user to type. */
  handedToUser: number;
  /** Refused by policy. */
  blocked: number;
  /** File inputs, which are always the user's own choice. */
  documents: number;
  /** Understood, but the profile holds nothing for it. */
  noData: number;
  /** One batched request per page that needed one. */
  modelCalls: number;
  byStatus: Record<string, number>;
}

function emptyTotals(): ModeTotals {
  return {
    fields: 0,
    resolvedLocally: 0,
    routedToModel: 0,
    handedToUser: 0,
    blocked: 0,
    documents: 0,
    noData: 0,
    modelCalls: 0,
    byStatus: {},
  };
}

interface PageResult {
  page: string;
  category: string;
  fields: number;
  modeA: { resolvedLocally: number; handedToUser: number };
  modeB: { resolvedLocally: number; routedToModel: number; handedToUser: number };
  /** Field kinds the model was asked about on this page. */
  modelFieldTypes: string[];
  modelFieldLabels: string[];
}

/** Which fields the model is asked about, keyed by type, across the whole corpus. */
const modelDemandByType = new Map<FieldType, number>();
const modelDemandByMode = new Map<string, number>();
const modeA = emptyTotals();
const modeB = emptyTotals();
/** Mode C totals: the always-ask-the-model strategy. */
const modeC = { fields: 0, routedToModel: 0, modelCalls: 0, payloadBytes: 0 };
const modeBPayload = { bytes: 0 };
const pageResults: PageResult[] = [];

function tally(totals: ModeTotals, status: SuggestionStatus, routedToModel: boolean): void {
  totals.fields += 1;
  totals.byStatus[status] = (totals.byStatus[status] ?? 0) + 1;
  if (routedToModel) {
    totals.routedToModel += 1;
    return;
  }
  switch (status) {
    case 'ready':
    case 'needs_review':
      totals.resolvedLocally += 1;
      break;
    case 'blocked':
      totals.blocked += 1;
      break;
    case 'needs_document':
      totals.documents += 1;
      break;
    case 'no_data':
      totals.noData += 1;
      break;
    default:
      totals.handedToUser += 1;
  }
}

for (const page of PAGES) {
  env.loadPage(page.page, page.url);
  const normalized = normalizeForm({ href: page.url });

  const withoutAI = buildSuggestions(normalized.form, BENCHMARK_PROFILE, {
    allowAI: false,
    documents: BENCHMARK_PROFILE.documents,
  });
  const withAI = buildSuggestions(normalized.form, BENCHMARK_PROFILE, {
    allowAI: true,
    documents: BENCHMARK_PROFILE.documents,
  });

  const aiFieldIds = new Set(withAI.aiRequests.map((request) => request.fieldId));

  for (const suggestion of withoutAI.suggestions) tally(modeA, suggestion.status, false);
  for (const suggestion of withAI.suggestions) {
    tally(modeB, suggestion.status, aiFieldIds.has(suggestion.fieldId));
  }
  if (withAI.aiRequests.length > 0) modeB.modelCalls += 1;

  for (const request of withAI.aiRequests) {
    modelDemandByType.set(request.type, (modelDemandByType.get(request.type) ?? 0) + 1);
    modelDemandByMode.set(request.mode, (modelDemandByMode.get(request.mode) ?? 0) + 1);
  }

  // Mode C: every fillable field, batched per page the same way Mode B batches.
  const everything = alwaysAiCandidates(normalized.form.fields);
  modeC.fields += normalized.form.fields.length;
  modeC.routedToModel += everything.length;
  if (everything.length > 0) modeC.modelCalls += 1;

  const formContext = {
    title: normalized.form.title,
    platform: normalized.form.platform,
    url: normalized.form.url,
    sections: normalized.form.sections.map((section) => ({ id: section.id, title: section.title })),
  };
  // Mode C has no router, so it cannot know which requests are prose-only and must send the whole
  // profile. Mode B's payload is measured after redaction, as the extension actually sends it.
  if (everything.length > 0) {
    modeC.payloadBytes += payloadBytes(
      BENCHMARK_PROFILE,
      everything.map((field) => ({
        fieldId: field.id,
        label: field.label,
        type: field.type,
        options: field.options,
        required: field.required,
        mode: 'assist',
      })),
      formContext,
    );
  }
  if (withAI.aiRequests.length > 0) {
    const { profile: minimised } = redactProfileForAI(
      BENCHMARK_PROFILE as unknown as Record<string, unknown>,
      withAI.aiRequests.map((request) => request.mode),
    );
    modeBPayload.bytes += payloadBytes(minimised, withAI.aiRequests, formContext);
  }

  const aCounts = { resolvedLocally: 0, handedToUser: 0 };
  for (const suggestion of withoutAI.suggestions) {
    if (suggestion.status === 'ready' || suggestion.status === 'needs_review') aCounts.resolvedLocally += 1;
    else if (suggestion.status === 'manual') aCounts.handedToUser += 1;
  }
  const bCounts = { resolvedLocally: 0, routedToModel: 0, handedToUser: 0 };
  for (const suggestion of withAI.suggestions) {
    if (aiFieldIds.has(suggestion.fieldId)) bCounts.routedToModel += 1;
    else if (suggestion.status === 'ready' || suggestion.status === 'needs_review') bCounts.resolvedLocally += 1;
    else if (suggestion.status === 'manual') bCounts.handedToUser += 1;
  }

  pageResults.push({
    page: page.page,
    category: page.category,
    fields: normalized.form.fields.length,
    modeA: aCounts,
    modeB: bCounts,
    modelFieldTypes: withAI.aiRequests.map((request) => request.type),
    modelFieldLabels: withAI.aiRequests.map((request) => request.label ?? '(unlabelled)'),
  });
}

// ─── Report ───────────────────────────────────────────────────────────────────

const lines: string[] = [];
const say = (text = ''): void => {
  console.log(text);
  lines.push(text);
};

say(`FormPilot AI routing study — ${PAGES.length} pages, ${modeA.fields} fields`);
say('  Mode A = deterministic only (allowAI: false). Mode B = deterministic + model.');
say('  Model calls are COUNTED, NOT EXECUTED: no provider is reachable from this');
say('  environment, so nothing here says anything about generated answer quality.');
say();

const share = (value: number, of: number): string => percent(of === 0 ? 0 : value / of);

say('── Mode A: deterministic only ──');
say(`  resolved without a model   ${modeA.resolvedLocally}/${modeA.fields}  (${share(modeA.resolvedLocally, modeA.fields)})`);
say(`  handed to the user         ${modeA.handedToUser}  (${share(modeA.handedToUser, modeA.fields)})`);
say(`  refused by policy          ${modeA.blocked}`);
say(`  document to attach         ${modeA.documents}`);
say(`  understood, no stored data ${modeA.noData}`);
say(`  network requests made      0`);
say();

say('── Mode B: deterministic + model ──');
say(`  resolved without a model   ${modeB.resolvedLocally}/${modeB.fields}  (${share(modeB.resolvedLocally, modeB.fields)})`);
say(`  routed to a model          ${modeB.routedToModel}  (${share(modeB.routedToModel, modeB.fields)})`);
say(`  handed to the user         ${modeB.handedToUser}  (${share(modeB.handedToUser, modeB.fields)})`);
say(`  refused by policy          ${modeB.blocked}`);
say(`  document to attach         ${modeB.documents}`);
say(`  batched requests           ${modeB.modelCalls} (one per page that needed one, not one per field)`);
say();

// The difference is the whole point: what does the model actually buy?
const coverageDelta = modeB.routedToModel;
const userBurdenDelta = modeA.handedToUser - modeB.handedToUser;
say('── What the model changes ──');
say(`  fields the model is asked about        ${coverageDelta}`);
say(`  fewer fields left for the user to type ${userBurdenDelta}`);
say(
  `  requests per page that needs one       ${
    modeB.modelCalls === 0 ? 'n/a' : round(coverageDelta / modeB.modelCalls, 1)
  } fields per call`,
);
say('  answer quality                         NOT MEASURED — see the header of this file');
say();

say('── Mode C: always ask the model ──');
say(`  routed to a model          ${modeC.routedToModel}/${modeC.fields}  (${share(modeC.routedToModel, modeC.fields)})`);
say(`  batched requests           ${modeC.modelCalls}`);
say(`  request payload            ${(modeC.payloadBytes / 1024).toFixed(1)} KiB total`);
say(`  resolved without a model   0`);
say();

say('── Hybrid routing against always-ask ──');
const callRatio = modeC.modelCalls === 0 ? 0 : modeB.modelCalls / modeC.modelCalls;
const fieldRatio = modeC.routedToModel === 0 ? 0 : modeB.routedToModel / modeC.routedToModel;
const byteRatio = modeC.payloadBytes === 0 ? 0 : modeBPayload.bytes / modeC.payloadBytes;
say(`  fields sent to a model     ${modeB.routedToModel} vs ${modeC.routedToModel}  (${percent(fieldRatio)} of always-ask)`);
say(`  batched requests           ${modeB.modelCalls} vs ${modeC.modelCalls}  (${percent(callRatio)})`);
say(`  request payload            ${(modeBPayload.bytes / 1024).toFixed(1)} KiB vs ${(modeC.payloadBytes / 1024).toFixed(1)} KiB  (${percent(byteRatio)})`);
say(`  accuracy of either         NOT MEASURED — no provider is reachable from this environment`);
say(`  latency, cost, long-form quality, correction rate  NOT MEASURED — same reason`);
say('  Payload is the honest cost proxy available here: provider pricing is per token against a');
say('  price list this environment cannot see, so no currency figure is reported.');
say();

say('── What the model is asked about, by control type ──');
for (const [type, count] of [...modelDemandByType].sort((a, b) => b[1] - a[1])) {
  say(`  ${String(type).padEnd(16)} ${count}`);
}
say();
say('── ...and by request mode ──');
for (const [mode, count] of [...modelDemandByMode].sort((a, b) => b[1] - a[1])) {
  const explanation =
    mode === 'generate'
      ? 'prose the profile cannot supply by lookup'
      : 'an uncertain mapping for the model to adjudicate';
  say(`  ${mode.padEnd(10)} ${String(count).padStart(3)}  ${explanation}`);
}
say();

say('── Per page ──');
say('  page                        fields   A local  A manual │  B local  B model  B manual');
for (const result of pageResults) {
  say(
    `  ${result.page.padEnd(26)} ${String(result.fields).padStart(6)}   ` +
      `${String(result.modeA.resolvedLocally).padStart(7)}  ${String(result.modeA.handedToUser).padStart(8)} │  ` +
      `${String(result.modeB.resolvedLocally).padStart(7)}  ${String(result.modeB.routedToModel).padStart(7)}  ` +
      `${String(result.modeB.handedToUser).padStart(8)}`,
  );
}
say();

const questions = pageResults.flatMap((result) => result.modelFieldLabels);
if (questions.length > 0) {
  say('── Every field the model would be asked about ──');
  for (const label of [...new Set(questions)].sort()) say(`  ${label}`);
  say();
}

// ─── Write results ────────────────────────────────────────────────────────────

const outDir = path.join(import.meta.dirname, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'latest.json'),
  `${JSON.stringify(
    {
      caveat:
        'Model calls are counted, not executed. No provider is reachable from the build ' +
        'environment, so this file contains no measurement of generated answer quality.',
      corpus: { pages: PAGES.length, fields: modeA.fields },
      modeA,
      modeB,
      delta: { fieldsRoutedToModel: coverageDelta, userBurdenReduced: userBurdenDelta },
      modeC: {
        ...modeC,
        note: 'Always-ask-the-model. Counted, not executed. Safety-refused and file fields excluded.',
      },
      hybridVsAlwaysAsk: {
        fieldsSentRatio: round(fieldRatio, 3),
        callsRatio: round(callRatio, 3),
        payloadRatio: round(byteRatio, 3),
        modeBPayloadBytes: modeBPayload.bytes,
        modeCPayloadBytes: modeC.payloadBytes,
        notMeasured: ['accuracy', 'latency', 'monetary cost', 'long-form quality', 'correction rate'],
      },
      modelDemandByType: Object.fromEntries(modelDemandByType),
      modelDemandByMode: Object.fromEntries(modelDemandByMode),
      pages: pageResults,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  path.join(outDir, 'latest.md'),
  [
    '# AI routing study — latest run',
    '',
    'Generated by `npm run study:routing`. Every number is computed from that run.',
    '',
    '**Model calls are counted, not executed.** No provider is reachable from the build',
    'environment, so nothing in this file measures generated answer quality. See the header of',
    '`research/routing/run.ts` for what is and is not verified about the model path.',
    '',
    '```',
    ...lines,
    '```',
    '',
  ].join('\n'),
);

say('  wrote research/routing/results/latest.json and latest.md');
