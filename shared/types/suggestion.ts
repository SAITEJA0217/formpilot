/**
 * Suggestion, provenance and confidence types.
 *
 * A `FieldSuggestion` is the unit the human reviews. It always carries *why* it
 * exists (`provenance.signals`) so a reviewer — or an experiment — can audit the
 * decision instead of trusting a bare number.
 */
import type { FieldType } from './form';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export type SuggestionStatus =
  /** Confidence >= high threshold and a value exists: prepared for autofill. */
  | 'ready'
  /** Value exists but confidence is mid-band: requires explicit confirmation. */
  | 'needs_review'
  /** Low confidence: user must type it. */
  | 'manual'
  /** Policy forbids autofill (password, OTP, payment, consent). */
  | 'blocked'
  /** Field understood, but the profile has nothing to fill it with. */
  | 'no_data'
  /** File input: the user must pick a document themselves. */
  | 'needs_document';

export type ValueOrigin =
  | 'profile'
  | 'derived'
  | 'generated'
  | 'correction'
  | 'user'
  | 'none';

/** One weighted piece of evidence behind a match. */
export interface SignalContribution {
  signal: string;
  /** Relative importance of this signal in the final score. */
  weight: number;
  /** 0..1 raw score this signal produced. */
  score: number;
  detail?: string;
}

export interface Provenance {
  origin: ValueOrigin;
  /** Canonical ontology concept, e.g. `person.first_name`. */
  conceptId?: string;
  /** Machine path into the profile, e.g. `education[0].degree`. */
  profilePath?: string;
  /** Same path for humans, e.g. `Education → Degree`. */
  humanPath?: string;
  signals: SignalContribution[];
  explanation: string;
  usedAI: boolean;
  model?: string;
}

export interface ValueValidation {
  valid: boolean;
  /** Value after coercion to the field's expected format. */
  normalizedValue?: string | string[] | boolean | null;
  message?: string;
}

export interface SuggestionAlternative {
  value: string | string[] | boolean | null;
  confidence: number;
  conceptId?: string;
}

export interface FieldSuggestion {
  fieldId: string;
  label?: string;
  fieldType: FieldType;
  value: string | string[] | boolean | null;
  /** 0..1. Product of match confidence and value confidence. */
  confidence: number;
  band: ConfidenceBand;
  status: SuggestionStatus;
  provenance: Provenance;
  alternatives?: SuggestionAlternative[];
  validation?: ValueValidation;
  /** User-facing explanation when status is blocked / manual / no_data. */
  reason?: string;
  editedByUser?: boolean;
  /** Undefined = undecided; false = explicitly rejected by the user. */
  accepted?: boolean;
}

export type FillMethod =
  | 'native-setter'
  | 'select-option'
  | 'click-option'
  | 'checkbox-toggle'
  | 'contenteditable'
  | 'file-picker'
  | 'skipped';

export interface FillOutcome {
  fieldId: string;
  filled: boolean;
  method: FillMethod;
  /** Value read back from the DOM after filling, for verification. */
  verifiedValue?: string | string[] | boolean | null;
  error?: string;
}

export interface FillReport {
  attempted: number;
  filled: number;
  failed: number;
  skipped: number;
  outcomes: FillOutcome[];
}
