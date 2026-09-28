/**
 * End-to-end suggestion pipeline.
 *
 * `UnifiedForm` + knowledge base → `FieldSuggestion[]`, plus the (usually short)
 * list of fields that actually warrant a model call. Pure and synchronous: the
 * caller performs the network request, which keeps this whole file unit-testable
 * and identical in the service worker, the API route and the benchmark runner.
 */
import type { UnifiedForm, UnifiedField, FieldType, FieldOption } from '../types/form';
import type {
  ConfidenceBand,
  FieldSuggestion,
  Provenance,
  SuggestionAlternative,
  SuggestionStatus,
} from '../types/suggestion';
import type { CorrectionRecord, ProfileDocument } from '../types/profile';
import { getConceptDef, isGenerativeConcept } from '../ontology';
import { matchField, type MatchResult } from './matcher';
import { isOptionField, matchOption, matchOptions, resolveConcept, type ProfileLike, type ResolvedValue } from './resolve';
import { routeField, UNKNOWN_MATCH_SCORE, type RoutingOptions } from './router';
import { bandFor, combineConfidence, DEFAULT_THRESHOLDS, type ConfidenceThresholds } from './confidence';
import { validateForField } from '../validation/value';
import { normalizeText } from './normalize';

/** One field handed to the AI layer. Carries no profile values by itself. */
export interface AIFieldRequest {
  fieldId: string;
  label?: string;
  description?: string;
  type: FieldType;
  options?: FieldOption[];
  required: boolean;
  maxLength?: number;
  sectionTitle?: string;
  context?: string;
  /** Candidate concepts the rule engine produced, best first. */
  candidates: { conceptId: string; humanPath: string; score: number }[];
  mode: 'assist' | 'generate';
}

export interface PipelineOptions extends RoutingOptions {
  thresholds?: ConfidenceThresholds;
  documents?: ProfileDocument[];
  corrections?: CorrectionRecord[];
}

export interface PipelineResult {
  suggestions: FieldSuggestion[];
  aiRequests: AIFieldRequest[];
}

function sectionTitles(form: UnifiedForm): Map<string, string> {
  const map = new Map<string, string>();
  for (const section of form.sections) {
    if (section.title) map.set(section.id, section.title);
  }
  return map;
}

/**
 * A stored correction for the same question is stronger evidence than any
 * inference: the user typed it themselves.
 */
function findCorrection(
  field: UnifiedField,
  corrections: CorrectionRecord[] | undefined,
): CorrectionRecord | undefined {
  if (!corrections || corrections.length === 0) return undefined;
  const label = normalizeText(field.label ?? field.ariaLabel ?? field.name);
  if (!label) return undefined;
  // Most recent wins.
  const sorted = [...corrections].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return sorted.find((c) => normalizeText(c.originalQuestion) === label);
}

function toAlternatives(match: MatchResult, profile: ProfileLike): SuggestionAlternative[] {
  const out: SuggestionAlternative[] = [];
  for (const candidate of match.candidates.slice(1, 3)) {
    const resolved = resolveConcept(candidate.conceptId, profile);
    if (resolved.value === null) continue;
    out.push({
      value: resolved.value,
      confidence: combineConfidence(candidate.score, resolved.confidence),
      conceptId: candidate.conceptId,
    });
  }
  return out;
}

/**
 * Build provenance for a suggestion.
 *
 * A concept is only named when the match actually cleared the unknown threshold. Below
 * that the top candidate is noise, and reporting it would tell the user (and an
 * experiment) that the field was recognised as something it was not.
 */
function provenanceFor(
  match: MatchResult,
  resolved: ResolvedValue,
  explanation: string,
  usedAI: boolean,
): Provenance {
  const committed = !!match.best && match.best.score >= UNKNOWN_MATCH_SCORE;
  const conceptId = committed ? match.best?.conceptId : undefined;
  const def = conceptId ? getConceptDef(conceptId) : undefined;
  return {
    origin: resolved.origin,
    conceptId,
    profilePath: resolved.profilePath,
    humanPath: resolved.humanPath ?? def?.humanPath,
    signals: committed ? (match.best?.signals ?? []) : [],
    explanation,
    usedAI,
  };
}

/**
 * Map a resolved scalar/list value onto the control's options, when the control
 * has any. Returns the value to write plus a confidence multiplier.
 */
function applyOptions(
  field: UnifiedField,
  resolved: ResolvedValue,
): { value: string | string[] | null; confidence: number; note?: string } {
  const options = field.options ?? [];
  if (!isOptionField(field) || options.length === 0) {
    return {
      value: Array.isArray(resolved.value)
        ? resolved.value.join(', ')
        : resolved.value === null || typeof resolved.value === 'boolean'
          ? null
          : String(resolved.value),
      confidence: 1,
    };
  }

  const wantsMany = field.type === 'select_many' || field.type === 'checkbox_group';
  const rawValues = Array.isArray(resolved.value)
    ? resolved.value
    : resolved.value === null
      ? []
      : [String(resolved.value)];

  if (rawValues.length === 0) return { value: null, confidence: 0, note: 'No value to select.' };

  if (wantsMany) {
    const { matched, confidence } = matchOptions(rawValues, options);
    if (matched.length === 0) {
      return { value: null, confidence: 0, note: 'None of your values match the available choices.' };
    }
    return { value: matched.map((m) => m.value), confidence };
  }

  const best = matchOption(rawValues[0], options);
  if (!best.option) {
    return { value: null, confidence: 0, note: 'No available choice matches your profile value.' };
  }
  return { value: best.option.value, confidence: best.confidence };
}

function documentHint(field: UnifiedField, documents: ProfileDocument[] | undefined, conceptId?: string): string {
  const kind =
    conceptId === 'documents.resume'
      ? 'resume'
      : conceptId === 'documents.cover_letter'
        ? 'cover_letter'
        : undefined;
  const relevant = (documents ?? []).filter((d) => !kind || d.kind === kind);
  if (relevant.length > 0) {
    return `Choose a file to attach. Saved documents: ${relevant.map((d) => d.label).join(', ')}.`;
  }
  const accept = field.accept ? ` Accepted types: ${field.accept}.` : '';
  return `Choose a file to attach.${accept}`;
}

/**
 * Build one suggestion per field, and collect the fields that need a model call.
 * AI-routed fields come back with `value: null` and are filled in later by
 * `mergeAIAnswers`, so the review panel can render immediately.
 */
export function buildSuggestions(
  form: UnifiedForm,
  profile: ProfileLike,
  options: PipelineOptions = {},
): PipelineResult {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const titles = sectionTitles(form);
  const suggestions: FieldSuggestion[] = [];
  const aiRequests: AIFieldRequest[] = [];

  for (const field of form.fields) {
    if (field.type === 'hidden') continue;

    const sectionTitle = field.sectionId ? titles.get(field.sectionId) : undefined;
    const match = matchField(field, { sectionTitle, formTitle: form.title });
    const conceptId = match.best?.conceptId;
    const resolved = conceptId ? resolveConcept(conceptId, profile) : { value: null, confidence: 0, origin: 'none' as const, missing: true };
    const decision = routeField(field, match, resolved, { thresholds, allowAI: options.allowAI });

    // A user correction for the same question overrides inference entirely.
    const correction = findCorrection(field, options.corrections);
    if (correction && decision.route !== 'blocked' && decision.route !== 'document') {
      const validation = validateForField(field, correction.userCorrection);
      suggestions.push({
        fieldId: field.id,
        label: field.label,
        fieldType: field.type,
        value: validation.normalizedValue ?? correction.userCorrection,
        confidence: 0.95,
        band: bandFor(0.95, thresholds),
        status: 'ready',
        provenance: {
          origin: 'correction',
          conceptId,
          humanPath: 'Your previous correction',
          signals: match.best?.signals ?? [],
          explanation: 'You corrected this exact question before; reusing your wording.',
          usedAI: false,
        },
        validation,
      });
      continue;
    }

    if (decision.route === 'blocked') {
      suggestions.push({
        fieldId: field.id,
        label: field.label,
        fieldType: field.type,
        value: null,
        confidence: 0,
        band: 'low',
        status: 'blocked',
        provenance: provenanceFor(match, resolved, decision.reason, false),
        reason: decision.reason,
      });
      continue;
    }

    if (decision.route === 'document') {
      suggestions.push({
        fieldId: field.id,
        label: field.label,
        fieldType: field.type,
        value: null,
        confidence: 0,
        band: 'low',
        status: 'needs_document',
        provenance: provenanceFor(match, resolved, decision.reason, false),
        reason: documentHint(field, options.documents, conceptId),
      });
      continue;
    }

    if (decision.route === 'ai_assist' || decision.route === 'ai_generate') {
      aiRequests.push({
        fieldId: field.id,
        label: field.label,
        description: field.description,
        type: field.type,
        options: field.options,
        required: field.required,
        maxLength: field.maxLength,
        sectionTitle,
        context: field.context,
        candidates: match.candidates.map((c) => ({
          conceptId: c.conceptId,
          humanPath: getConceptDef(c.conceptId)?.humanPath ?? c.conceptId,
          score: c.score,
        })),
        mode: decision.route === 'ai_generate' ? 'generate' : 'assist',
      });
      suggestions.push({
        fieldId: field.id,
        label: field.label,
        fieldType: field.type,
        value: null,
        confidence: 0,
        band: 'low',
        status: 'needs_review',
        provenance: provenanceFor(match, resolved, decision.reason, true),
        reason: decision.reason,
        alternatives: toAlternatives(match, profile),
      });
      continue;
    }

    if (decision.route === 'manual') {
      // `no_data` means "we understood the field, your profile is missing the value" —
      // an actionable prompt to go and fill in the profile. It requires an actual
      // understanding of the field, so it needs a match above the unknown threshold and
      // a concept that is supposed to have a stored value in the first place.
      const understood = !!match.best && match.best.score >= UNKNOWN_MATCH_SCORE;
      const status: SuggestionStatus =
        resolved.missing && understood && !isGenerativeConcept(match.best!.conceptId) ? 'no_data' : 'manual';
      suggestions.push({
        fieldId: field.id,
        label: field.label,
        fieldType: field.type,
        value: null,
        confidence: 0,
        band: 'low',
        status,
        provenance: provenanceFor(match, resolved, decision.reason, false),
        reason: decision.reason,
        alternatives: toAlternatives(match, profile),
      });
      continue;
    }

    // Deterministic path.
    const mapped = applyOptions(field, resolved);
    if (mapped.value === null) {
      suggestions.push({
        fieldId: field.id,
        label: field.label,
        fieldType: field.type,
        value: null,
        confidence: 0,
        band: 'low',
        status: 'manual',
        provenance: provenanceFor(match, resolved, mapped.note ?? decision.reason, false),
        reason: mapped.note ?? 'No value could be mapped onto this field.',
        alternatives: toAlternatives(match, profile),
      });
      continue;
    }

    const validation = validateForField(field, mapped.value);
    const matchConfidence = match.best?.score ?? 0;
    const confidence = combineConfidence(
      matchConfidence,
      resolved.confidence * mapped.confidence * (validation.valid ? 1 : 0.5),
    );
    const band: ConfidenceBand = bandFor(confidence, thresholds);
    // Only the high band is pre-accepted. A medium- or low-confidence value is still
    // shown, unaccepted, with its true band: discarding a plausible answer helps nobody,
    // and `manual` is reserved for fields where nothing at all could be proposed.
    const status: SuggestionStatus = band === 'high' ? 'ready' : 'needs_review';

    suggestions.push({
      fieldId: field.id,
      label: field.label,
      fieldType: field.type,
      value: validation.normalizedValue ?? mapped.value,
      confidence,
      band,
      status,
      provenance: provenanceFor(match, resolved, decision.reason, false),
      validation,
      alternatives: toAlternatives(match, profile),
      reason: validation.valid ? undefined : validation.message,
    });
  }

  return { suggestions, aiRequests };
}

/** One answer produced by the AI layer for a single field. */
export interface AIFieldAnswer {
  fieldId: string;
  value: string | string[] | null;
  /** 0..1. Values above 1 are treated as percentages by the caller. */
  confidence: number;
  conceptId?: string;
  humanPath?: string;
  explanation?: string;
  model?: string;
}

/**
 * Fold AI answers back into the suggestion list. AI confidence is capped so a
 * model's self-report can never reach the `high` band on its own: a generated
 * answer always passes in front of the user.
 */
export function mergeAIAnswers(
  form: UnifiedForm,
  suggestions: FieldSuggestion[],
  answers: AIFieldAnswer[],
  options: PipelineOptions = {},
): FieldSuggestion[] {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const byId = new Map(answers.map((a) => [a.fieldId, a]));
  const fieldsById = new Map(form.fields.map((f) => [f.id, f]));
  const AI_CONFIDENCE_CAP = 0.89;

  return suggestions.map((suggestion) => {
    const answer = byId.get(suggestion.fieldId);
    if (!answer) return suggestion;
    if (suggestion.status === 'blocked' || suggestion.status === 'needs_document') return suggestion;

    const field = fieldsById.get(suggestion.fieldId);
    if (!field) return suggestion;

    if (answer.value === null || (typeof answer.value === 'string' && !answer.value.trim())) {
      return {
        ...suggestion,
        status: 'no_data',
        reason: answer.explanation ?? 'The assistant had no grounded answer for this field.',
        provenance: { ...suggestion.provenance, usedAI: true, model: answer.model },
      };
    }

    let value: string | string[] | null = answer.value;
    let optionConfidence = 1;
    if (isOptionField(field) && field.options && field.options.length > 0) {
      const raw = Array.isArray(answer.value) ? answer.value : [String(answer.value)];
      if (field.type === 'select_many' || field.type === 'checkbox_group') {
        const { matched, confidence } = matchOptions(raw, field.options);
        if (matched.length === 0) {
          return {
            ...suggestion,
            status: 'manual',
            reason: 'The drafted answer does not match any available choice.',
            provenance: { ...suggestion.provenance, usedAI: true, model: answer.model },
          };
        }
        value = matched.map((m) => m.value);
        optionConfidence = confidence;
      } else {
        const best = matchOption(raw[0], field.options);
        if (!best.option) {
          return {
            ...suggestion,
            status: 'manual',
            reason: 'The drafted answer does not match any available choice.',
            provenance: { ...suggestion.provenance, usedAI: true, model: answer.model },
          };
        }
        value = best.option.value;
        optionConfidence = best.confidence;
      }
    }

    const validation = validateForField(field, value);
    const rawConfidence = answer.confidence > 1 ? answer.confidence / 100 : answer.confidence;
    const confidence = Math.min(
      AI_CONFIDENCE_CAP,
      combineConfidence(rawConfidence, optionConfidence * (validation.valid ? 1 : 0.5)),
    );
    const band = bandFor(confidence, thresholds);

    return {
      ...suggestion,
      value: validation.normalizedValue ?? value,
      confidence,
      band,
      // Generated answers are never pre-accepted, whatever the band.
      status: 'needs_review',
      validation,
      reason: validation.valid ? undefined : validation.message,
      provenance: {
        ...suggestion.provenance,
        origin: 'generated',
        conceptId: answer.conceptId ?? suggestion.provenance.conceptId,
        humanPath: answer.humanPath ?? suggestion.provenance.humanPath,
        explanation: answer.explanation ?? suggestion.provenance.explanation,
        usedAI: true,
        model: answer.model,
      },
    };
  });
}
