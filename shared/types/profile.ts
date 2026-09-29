/**
 * Profile knowledge base.
 *
 * The v1 `UserProfile` shape (see ./index.ts) is preserved verbatim — stored
 * documents load unchanged. Everything added here is optional, so a v1 profile is
 * a valid v2 profile.
 */
import type { UserProfile } from './index';

export interface PostalAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export type DocumentKind =
  | 'resume'
  | 'cover_letter'
  | 'certificate'
  | 'transcript'
  | 'portfolio'
  | 'other';

/**
 * Metadata about a document the user has told FormPilot about. Bytes are never
 * stored by the extension; the user picks the actual file at fill time.
 */
export interface ProfileDocument {
  id: string;
  kind: DocumentKind;
  /** Display name, e.g. `Resume_2026.pdf`. */
  label: string;
  mimeType?: string;
  sizeBytes?: number;
  updatedAt?: number;
  /** Free-text note shown in the document picker. */
  note?: string;
}

export interface Certification {
  id: string;
  name: string;
  issuer?: string;
  year?: string;
}

export interface ProfilePreferences {
  /** Autofill threshold overrides, 0..1. */
  highConfidence?: number;
  mediumConfidence?: number;
  /** When false, no field is sent to an LLM. */
  allowAI?: boolean;
  /** When false, corrections are not persisted. */
  allowCorrectionLearning?: boolean;
  /** Preferred tone for generated long-form answers. */
  answerTone?: 'concise' | 'balanced' | 'detailed';
}

/**
 * A named variant of the profile, e.g. `Internship Profile`. Only the fields that
 * differ from the base profile are stored, so PII is not duplicated.
 */
export interface NamedProfileOverlay {
  id: string;
  name: string;
  /** Sparse overlay merged over the base profile. */
  overrides: Partial<UserProfile>;
  updatedAt?: number;
}

/** v2 additions. All optional — a v1 profile satisfies this type. */
export interface ProfileExtensions {
  address?: PostalAddress;
  documents?: ProfileDocument[];
  certifications?: Certification[];
  languages?: string[];
  preferences?: ProfilePreferences;
  profiles?: NamedProfileOverlay[];
  /** Id of the overlay currently selected in the dashboard. */
  activeProfileId?: string;
}

export type ExtendedUserProfile = UserProfile & ProfileExtensions;

/** A stored user correction, used as a matching hint and as few-shot context. */
export interface CorrectionRecord {
  id?: string;
  originalQuestion: string;
  originalAnswer?: string | null;
  userCorrection: string;
  sourceDetail?: string;
  conceptId?: string;
  type?: 'fact-level' | 'phrasing-level';
  timestamp: number;
}
