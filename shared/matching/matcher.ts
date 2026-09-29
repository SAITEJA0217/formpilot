/**
 * Semantic field matcher: `UnifiedField` → canonical ontology concept.
 *
 * Deliberately deterministic and fully explainable. Every score is the weighted
 * product of one *source* (where the text came from) and one *signal* (how it
 * matched), so a review panel — or a research run — can print the exact evidence
 * that produced a mapping. No LLM is involved at this stage; the router decides
 * afterwards whether a field is worth an LLM call.
 *
 * Scoring shape:
 *
 *     base    = max over (source, signal, alias) of  sourceFactor * signalWeight * raw
 *     final   = clamp(base + contextBonus + typeBonus) * typeGate * negativeGate
 *
 * `max` rather than a sum: summing correlated evidence (a label that matches an
 * alias both exactly and by tokens) inflates scores without adding information.
 */
import type { FieldType, UnifiedField } from '../types/form';
import type { SignalContribution } from '../types/suggestion';
import { INDEXED_CONCEPTS, conceptForAutocomplete, type IndexedConcept } from '../ontology';
import { normalizeText, tokenSet } from './normalize';
import { containsPhrase, diceCoefficient, tokenContainment, tokenSetF1 } from './similarity';

/** Where a piece of text came from, and how much to trust it. */
const SOURCE_FACTORS = {
  label: 1.0,
  aria: 1.0,
  description: 0.8,
  name: 0.86,
  placeholder: 0.78,
  context: 0.55,
} as const;

type SourceName = keyof typeof SOURCE_FACTORS;

/** How strong each kind of match is, independent of where the text came from. */
const SIGNAL_WEIGHTS = {
  autocomplete: 0.99,
  exact: 0.97,
  pattern: 0.93,
  phrase: 0.9,
  tokens: 0.8,
  chars: 0.55,
} as const;

/** Bonus for a section/nearby-text cue that agrees with the concept. */
const CONTEXT_BONUS = 0.06;
/** Bonus when the control's own type is the natural type for the concept. */
const TYPE_BONUS = 0.05;
/** Multiplier when the concept declares incompatible field types. */
const TYPE_GATE_PENALTY = 0.35;
/**
 * Milder multiplier when the mismatch is between two text-bearing controls (say a
 * concept that expects `text` landing on a `richtext` surface). Without this, a
 * type quibble could drop an exact label match below an unrelated weak token match —
 * which is how `Phone Number` in a contenteditable once scored as a card-number field.
 */
const TYPE_GATE_SOFT_PENALTY = 0.85;
/** Controls that all accept free text, and are therefore mutually substitutable. */
const TEXT_BEARING_TYPES: ReadonlySet<FieldType> = new Set([
  'text',
  'search',
  'textarea',
  'richtext',
  'email',
  'tel',
  'url',
  'number',
  'unknown',
]);
/** Multiplier when a file/non-file mismatch is detected. */
const FILE_GATE_PENALTY = 0.2;
/** Multiplier when a disambiguating negative phrase is present. */
const NEGATIVE_GATE_PENALTY = 0.15;
/**
 * Ceiling for a match that rests entirely on a context-dependent alias.
 *
 * Chosen to sit inside the `medium` confidence band (0.70–0.90), so the suggestion is still
 * produced and still shown with its value, but never arrives pre-accepted. That is the
 * honest disposition for a label like a bare `Company`: FormPilot has a good guess and no
 * way to be sure, so the human decides.
 */
const CONTEXT_DEPENDENT_CEILING = 0.85;
/**
 * Labels that ask for prose *about* something rather than for the thing itself.
 *
 * The discriminator is the question word, not the presence of a question. "What is your job
 * title?" asks for the stored value and `experience.job_title` is the right answer. "Why are
 * you leaving your current role?" contains the same words but wants an explanation, and
 * answering it with "Software Engineer" is nonsense — which is exactly what happened: that
 * label matched `current role` and scored 0.93, high enough to be filled without review.
 */
const PROSE_QUESTION = /^\s*(why|describe|explain|tell\s+us|elaborate|discuss|in\s+your\s+own\s+words|what\s+(makes|motivates)|how\s+(do|did|would)\s+you)\b/i;
/** Multiplier when a stored scalar is offered as the answer to a prose question. */
const PROSE_QUESTION_PENALTY = 0.25;
/** Below this gap the top two concepts are treated as indistinguishable. */
export const AMBIGUITY_MARGIN = 0.08;

/**
 * Signals that modify a score rather than establish it. Always retained in
 * provenance so a bonus or penalty is never invisible to the reviewer.
 */
const MODIFIER_SIGNALS: ReadonlySet<string> = new Set([
  'autocomplete',
  'context.boost',
  'type.natural',
  'type.incompatible',
  'type.fileMismatch',
  'negative',
  'alias.contextDependent',
  'label.proseQuestion',
]);

export interface MatchContext {
  sectionTitle?: string;
  formTitle?: string;
}

export interface MatchCandidate {
  conceptId: string;
  score: number;
  signals: SignalContribution[];
}

export interface MatchResult {
  best?: MatchCandidate;
  /** Sorted descending, best first. Truncated to a small number. */
  candidates: MatchCandidate[];
  /** True when the top two candidates are within `AMBIGUITY_MARGIN`. */
  ambiguous: boolean;
  /** score(best) - score(second), or score(best) when only one candidate. */
  margin: number;
}

/** Normalized text for each source of a field, computed once per field. */
interface FieldText {
  raw: Partial<Record<SourceName, string>>;
  normalized: Partial<Record<SourceName, string>>;
  tokens: Partial<Record<SourceName, Set<string>>>;
  /** Everything concatenated, for context/negative checks. */
  combined: string;
}

function buildFieldText(field: UnifiedField, ctx: MatchContext): FieldText {
  const raw: Partial<Record<SourceName, string>> = {};
  if (field.label) raw.label = field.label;
  if (field.ariaLabel) raw.aria = field.ariaLabel;
  if (field.description) raw.description = field.description;
  const nameLike = [field.name, field.elementId].filter(Boolean).join(' ');
  if (nameLike) raw.name = nameLike;
  if (field.placeholder) raw.placeholder = field.placeholder;
  const contextLike = [field.context, ctx.sectionTitle].filter(Boolean).join(' ');
  if (contextLike) raw.context = contextLike;

  const normalized: Partial<Record<SourceName, string>> = {};
  const tokens: Partial<Record<SourceName, Set<string>>> = {};
  for (const key of Object.keys(raw) as SourceName[]) {
    const norm = normalizeText(raw[key]);
    if (!norm) continue;
    normalized[key] = norm;
    tokens[key] = tokenSet(norm);
  }
  const combined = (Object.keys(normalized) as SourceName[])
    .map((k) => normalized[k])
    .filter(Boolean)
    .join(' ');
  return { raw, normalized, tokens, combined };
}

/** Longer aliases are more reliable evidence when found as a sub-phrase. */
function phraseSpecificity(aliasTokenCount: number): number {
  return Math.min(1, 0.7 + 0.1 * aliasTokenCount);
}

/** Natural control types for a concept's value type. */
function naturalTypes(valueType: string): FieldType[] {
  switch (valueType) {
    case 'email':
      return ['email'];
    case 'tel':
      return ['tel'];
    case 'url':
      return ['url'];
    case 'date':
      return ['date', 'datetime', 'month'];
    case 'number':
    case 'year':
      return ['number'];
    case 'text':
      return ['textarea', 'richtext'];
    case 'file':
      return ['file'];
    case 'boolean':
      return ['checkbox', 'checkbox_group'];
    default:
      return [];
  }
}

function scoreConceptAgainstField(
  concept: IndexedConcept,
  field: UnifiedField,
  text: FieldText,
): MatchCandidate | null {
  const signals: SignalContribution[] = [];
  let base = 0;

  // 1. `autocomplete` is an author-declared, machine-readable claim: trust it most.
  const autoConcept = conceptForAutocomplete(field.autocomplete);
  if (autoConcept && autoConcept.def.id === concept.def.id) {
    base = SIGNAL_WEIGHTS.autocomplete;
    signals.push({
      signal: 'autocomplete',
      weight: SIGNAL_WEIGHTS.autocomplete,
      score: 1,
      detail: field.autocomplete,
    });
  }

  // 2. Text evidence across every source.
  for (const source of Object.keys(text.normalized) as SourceName[]) {
    const normalized = text.normalized[source];
    const sourceTokens = text.tokens[source];
    if (!normalized || !sourceTokens) continue;
    const factor = SOURCE_FACTORS[source];

    for (const pattern of concept.compiledPatterns) {
      if (pattern.test(normalized)) {
        const score = factor * SIGNAL_WEIGHTS.pattern;
        if (score > base) base = score;
        signals.push({
          signal: `${source}.pattern`,
          weight: SIGNAL_WEIGHTS.pattern * factor,
          score: 1,
          detail: pattern.source,
        });
        break;
      }
    }

    for (let i = 0; i < concept.normalizedAliases.length; i += 1) {
      const alias = concept.normalizedAliases[i];
      const aliasTokens = concept.aliasTokens[i];

      if (normalized === alias) {
        const score = factor * SIGNAL_WEIGHTS.exact;
        if (score > base) base = score;
        signals.push({ signal: `${source}.exact`, weight: SIGNAL_WEIGHTS.exact * factor, score: 1, detail: alias });
        continue;
      }

      if (containsPhrase(normalized, alias)) {
        const raw = phraseSpecificity(aliasTokens.size || 1);
        const score = factor * SIGNAL_WEIGHTS.phrase * raw;
        if (score > base) base = score;
        signals.push({ signal: `${source}.phrase`, weight: SIGNAL_WEIGHTS.phrase * factor, score: raw, detail: alias });
        continue;
      }

      const f1 = tokenSetF1(sourceTokens, aliasTokens);
      if (f1 > 0) {
        // Containment keeps long noisy labels from diluting a solid alias hit.
        const contain = tokenContainment(aliasTokens, sourceTokens);
        const raw = Math.max(f1, contain * 0.9);
        const score = factor * SIGNAL_WEIGHTS.tokens * raw;
        if (score > base) base = score;
        if (raw >= 0.5) {
          signals.push({ signal: `${source}.tokens`, weight: SIGNAL_WEIGHTS.tokens * factor, score: raw, detail: alias });
        }
      }

      if (alias.length >= 4 && normalized.length >= 4) {
        const dice = diceCoefficient(normalized, alias);
        if (dice >= 0.75) {
          const score = factor * SIGNAL_WEIGHTS.chars * dice;
          if (score > base) base = score;
          signals.push({ signal: `${source}.chars`, weight: SIGNAL_WEIGHTS.chars * factor, score: dice, detail: alias });
        }
      }
    }
  }

  if (base <= 0) return null;

  // 3. Context agreement (section heading or surrounding copy).
  let bonus = 0;
  for (const cue of concept.normalizedContextBoost) {
    if (containsPhrase(text.combined, cue)) {
      bonus += CONTEXT_BONUS;
      signals.push({ signal: 'context.boost', weight: CONTEXT_BONUS, score: 1, detail: cue });
      break;
    }
  }

  // 4. Control type agreement.
  const natural = naturalTypes(concept.def.valueType);
  if (natural.includes(field.type)) {
    bonus += TYPE_BONUS;
    signals.push({ signal: 'type.natural', weight: TYPE_BONUS, score: 1, detail: field.type });
  }

  let score = Math.min(1, base + bonus);

  // 5. Gates. Multiplicative, so they survive a high base score.
  if (concept.def.fieldTypes && concept.def.fieldTypes.length > 0 && !concept.def.fieldTypes.includes(field.type)) {
    const bothTextBearing =
      TEXT_BEARING_TYPES.has(field.type) && concept.def.fieldTypes.some((t) => TEXT_BEARING_TYPES.has(t));
    const penalty = bothTextBearing ? TYPE_GATE_SOFT_PENALTY : TYPE_GATE_PENALTY;
    score *= penalty;
    signals.push({ signal: 'type.incompatible', weight: penalty, score: 0, detail: field.type });
  }

  const conceptIsFile = concept.def.valueType === 'file';
  const fieldIsFile = field.type === 'file';
  if (conceptIsFile !== fieldIsFile) {
    score *= FILE_GATE_PENALTY;
    signals.push({ signal: 'type.fileMismatch', weight: FILE_GATE_PENALTY, score: 0 });
  }

  const labelish = [text.normalized.label, text.normalized.aria, text.normalized.name, text.normalized.placeholder]
    .filter(Boolean)
    .join(' ');
  for (const negative of concept.normalizedNegatives) {
    if (containsPhrase(labelish, negative)) {
      score *= NEGATIVE_GATE_PENALTY;
      signals.push({ signal: 'negative', weight: NEGATIVE_GATE_PENALTY, score: 0, detail: negative });
      break;
    }
  }

  // 6. A prose question is never answered by a stored value.
  if (!concept.def.generative && PROSE_QUESTION.test(field.label ?? '')) {
    score *= PROSE_QUESTION_PENALTY;
    signals.push({
      signal: 'label.proseQuestion',
      weight: PROSE_QUESTION_PENALTY,
      score: 0,
      detail: 'asks for an explanation, not a value',
    });
  }

  // 7. Context-dependent aliases. When the *whole* label is one of them and nothing in the
  // surrounding text corroborates the concept, cap the score below the auto-accept band.
  // Checked against the whole label rather than as a substring on purpose: `Current Company`
  // contains `company` but says whose, so it must stay fully confident.
  if (concept.normalizedContextDependentAliases.length > 0) {
    const wholeLabel = text.normalized.label || text.normalized.aria;
    const restsOnAmbiguousAlias =
      !!wholeLabel && concept.normalizedContextDependentAliases.includes(wholeLabel);
    const corroborated = signals.some((signal) => signal.signal === 'context.boost');
    if (restsOnAmbiguousAlias && !corroborated && score > CONTEXT_DEPENDENT_CEILING) {
      score = CONTEXT_DEPENDENT_CEILING;
      signals.push({
        signal: 'alias.contextDependent',
        weight: CONTEXT_DEPENDENT_CEILING,
        score: 0,
        detail: wholeLabel,
      });
    }
  }

  if (score <= 0) return null;

  // Provenance is trimmed to stay readable across the message boundary, but the
  // modifiers are always kept: a reviewer needs to see the bonus or penalty that
  // moved the score, not just the text evidence that produced the base.
  const modifiers = signals.filter((signal) => MODIFIER_SIGNALS.has(signal.signal));
  const evidence = signals
    .filter((signal) => !MODIFIER_SIGNALS.has(signal.signal))
    .sort((a, b) => b.weight * b.score - a.weight * a.score)
    .slice(0, 4);
  return { conceptId: concept.def.id, score: Math.min(1, score), signals: [...evidence, ...modifiers] };
}

/** Type-driven deterministic overrides that must win regardless of label text. */
function typeOverride(field: UnifiedField): MatchCandidate | null {
  if (field.type === 'password') {
    return {
      conceptId: 'auth.password',
      score: 0.99,
      signals: [{ signal: 'type.password', weight: 0.99, score: 1, detail: 'input[type=password]' }],
    };
  }
  return null;
}

/**
 * Score every concept against a field and return the ranked candidates.
 * `maxCandidates` bounds the provenance payload that crosses the message boundary.
 */
export function matchField(
  field: UnifiedField,
  ctx: MatchContext = {},
  maxCandidates = 4,
): MatchResult {
  const override = typeOverride(field);
  if (override) {
    return { best: override, candidates: [override], ambiguous: false, margin: override.score };
  }

  const text = buildFieldText(field, ctx);
  if (!text.combined) {
    return { best: undefined, candidates: [], ambiguous: false, margin: 0 };
  }

  const candidates: MatchCandidate[] = [];
  for (const concept of INDEXED_CONCEPTS) {
    const candidate = scoreConceptAgainstField(concept, field, text);
    if (candidate) candidates.push(candidate);
  }

  // Deterministic ordering: score, then ontology order (stable across runs).
  const order = new Map(INDEXED_CONCEPTS.map((c, i) => [c.def.id, i]));
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (order.get(a.conceptId) ?? 0) - (order.get(b.conceptId) ?? 0);
  });

  const top = candidates.slice(0, maxCandidates);
  const best = top[0];
  const second = top[1];
  const margin = best ? best.score - (second?.score ?? 0) : 0;
  return {
    best,
    candidates: top,
    ambiguous: !!best && !!second && margin < AMBIGUITY_MARGIN,
    margin,
  };
}
