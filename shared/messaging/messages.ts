/**
 * Typed message contracts between popup, content script and service worker.
 *
 * Legacy v1 message names (`EXTRACT_QUESTIONS`, `SHOW_REVIEW_PANEL`,
 * `ANALYZE_FORM`, `SEND_CORRECTION`, `CACHE_PROFILE`, `CACHE_AUTH`) are kept so a
 * mixed-version install degrades instead of breaking.
 */
import type { UnifiedForm } from '../types/form';
import type { FieldSuggestion, FillReport } from '../types/suggestion';
import type { ExtendedUserProfile } from '../types/profile';

export interface FormSummary {
  formId: string;
  platform: string;
  title?: string;
  url: string;
  fieldsDetected: number;
  ready: number;
  needsReview: number;
  manual: number;
  blocked: number;
  noData: number;
  isMultiStep: boolean;
  currentStep?: number;
  totalSteps?: number;
  warnings: string[];
}

/** content ← popup/background */
export type ContentRequest =
  | { action: 'PING_CONTENT' }
  | { action: 'SCAN_PAGE' }
  | { action: 'GET_SUMMARY' }
  | { action: 'SHOW_REVIEW_PANEL'; suggestions: FieldSuggestion[]; form?: UnifiedForm }
  | { action: 'APPLY_SUGGESTIONS'; suggestions: FieldSuggestion[] }
  | { action: 'CLOSE_PANEL' }
  /** v1 compatibility */
  | { action: 'EXTRACT_QUESTIONS' };

export type ContentResponse =
  | { ok: true; form: UnifiedForm }
  | { ok: true; summary: FormSummary }
  | { ok: true; report: FillReport }
  | { ok: true }
  | { ok: false; error: string };

/** background ← popup/content */
export type BackgroundRequest =
  | { type: 'BUILD_SUGGESTIONS'; form: UnifiedForm; tabId?: number }
  | { type: 'GET_STATE' }
  | { type: 'CLEAR_LOCAL_DATA' }
  | { type: 'EXPORT_PROFILE' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; settings: Record<string, unknown> }
  | { type: 'SEND_CORRECTION'; payload: Record<string, unknown> }
  | { type: 'CACHE_PROFILE'; payload: { profile: ExtendedUserProfile; isComplete: boolean } }
  | { type: 'CACHE_AUTH'; payload: { isAuthenticated: boolean; uid?: string; token?: string } }
  /** v1 compatibility: legacy question array */
  | { type: 'ANALYZE_FORM'; payload: unknown; tabId?: number };

export interface SuggestionsResult {
  suggestions: FieldSuggestion[];
  summary: FormSummary;
  /** Number of fields that required an AI call. 0 means fully deterministic. */
  aiCalls: number;
  aiError?: string;
}
