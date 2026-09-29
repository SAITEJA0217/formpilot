/**
 * AI routing strategy.
 *
 * The cheapest correct answer wins. A field whose label is literally `Email` does
 * not need a language model, and sending it to one costs money, adds latency and
 * introduces a failure mode that rule-based matching does not have. The router
 * decides, per field, which of five paths a field takes.
 */
import type { UnifiedField } from '../types/form';
import { getConceptDef, isGenerativeConcept } from '../ontology';
import { AMBIGUITY_MARGIN, type MatchResult } from './matcher';
import { DEFAULT_THRESHOLDS, type ConfidenceThresholds } from './confidence';
import type { ResolvedValue } from './resolve';

export type FillRoute =
  /** Rule-based match with a stored value. No model call. */
  | 'deterministic'
  /** Understood, but the mapping is uncertain: ask the model to adjudicate. */
  | 'ai_assist'
  /** Long-form answer that must be written, not looked up. */
  | 'ai_generate'
  /** User must supply the value themselves. */
  | 'manual'
  /** Policy forbids autofill. */
  | 'blocked'
  /** File input: the user picks a document. */
  | 'document';

export interface RoutingDecision {
  route: FillRoute;
  reason: string;
}

export interface RoutingOptions {
  thresholds?: ConfidenceThresholds;
  /** When false, no field is routed to a model. */
  allowAI?: boolean;
}

/** Below this the match is treated as "no idea what this field is". */
export const UNKNOWN_MATCH_SCORE = 0.45;

const INTERROGATIVE = /^(why|how|what|describe|tell|explain|share|elaborate|discuss|in your own words)\b/i;

/**
 * A field that wants prose rather than a value. Three independent signals, any of
 * which is sufficient: the control is a multi-line control, the author allowed a
 * long value, or the label reads like a question.
 */
export function isLongFormField(field: UnifiedField): boolean {
  if (field.type === 'textarea' || field.type === 'richtext') return true;
  if (typeof field.maxLength === 'number' && field.maxLength >= 200) return true;
  const label = (field.label ?? '').trim();
  if (label.length >= 20 && INTERROGATIVE.test(label)) return true;
  if (label.endsWith('?') && label.length >= 25) return true;
  return false;
}

export function routeField(
  field: UnifiedField,
  match: MatchResult,
  resolved: ResolvedValue,
  options: RoutingOptions = {},
): RoutingDecision {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const allowAI = options.allowAI !== false;

  if (field.sensitivity === 'blocked') {
    return { route: 'blocked', reason: field.sensitivityReason ?? 'This field is never autofilled.' };
  }
  const conceptDef = match.best ? getConceptDef(match.best.conceptId) : undefined;
  if (conceptDef?.policy === 'never') {
    return { route: 'blocked', reason: 'This field holds a secret or a consent decision.' };
  }
  if (field.disabled || field.readOnly) {
    return { route: 'manual', reason: 'Field is disabled or read-only.' };
  }
  if (field.type === 'file') {
    return { route: 'document', reason: 'Choose which document to attach.' };
  }

  const longForm = isLongFormField(field);

  if (!match.best || match.best.score < UNKNOWN_MATCH_SCORE) {
    if (longForm && allowAI) {
      return { route: 'ai_generate', reason: 'Open-ended question with no direct profile field.' };
    }
    return {
      route: 'manual',
      reason: 'This field could not be confidently mapped. Please review it manually.',
    };
  }

  if (isGenerativeConcept(match.best.conceptId)) {
    if (!allowAI) {
      return { route: 'manual', reason: 'AI generation is turned off for this profile.' };
    }
    // Writing prose into a single-line box is wrong however well the concept matched: a
    // short input labelled `Other` is not an invitation to generate a paragraph.
    if (!longForm) {
      return {
        route: 'manual',
        reason: 'This looks like a short free-text field. Please fill it in yourself.',
      };
    }
    return { route: 'ai_generate', reason: 'Long-form answer generated from your profile.' };
  }

  if (resolved.missing || resolved.value === null) {
    if (longForm && allowAI) {
      return { route: 'ai_generate', reason: 'No stored value; an answer can be drafted from your profile.' };
    }
    return { route: 'manual', reason: 'Your profile has no value for this field yet.' };
  }

  if (match.ambiguous) {
    return allowAI
      ? { route: 'ai_assist', reason: `Two profile fields matched within ${AMBIGUITY_MARGIN} confidence.` }
      : { route: 'manual', reason: 'The field matched more than one profile value.' };
  }

  if (match.best.score < thresholds.medium) {
    return allowAI
      ? { route: 'ai_assist', reason: 'Low-confidence mapping sent for adjudication.' }
      : { route: 'manual', reason: 'Low-confidence mapping.' };
  }

  return { route: 'deterministic', reason: 'Matched directly from your profile.' };
}
