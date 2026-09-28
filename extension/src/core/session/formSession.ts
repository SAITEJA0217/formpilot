/**
 * Form session state.
 *
 * A multi-step application is one task spread over several DOM states. Without a
 * session, every step starts from nothing: suggestions the user already edited are
 * recomputed and their corrections are lost. The session keeps that work keyed by
 * *field identity* (label + type + name) rather than by the generated field id,
 * because ids are positional and shift when the DOM re-renders.
 *
 * The state is plain JSON so it can be persisted in `chrome.storage.session` and
 * restored after a service-worker restart.
 */
import type { UnifiedForm } from '../../../../shared/types/form';
import type { FieldSuggestion, FillOutcome } from '../../../../shared/types/suggestion';
import { normalizeText } from '../../../../shared/matching/normalize';

export interface SessionCorrection {
  fieldKey: string;
  label?: string;
  from: string | null;
  to: string;
  at: number;
}

export interface FormSessionState {
  url: string;
  origin: string;
  platform: string;
  startedAt: number;
  updatedAt: number;
  currentStep: number;
  totalSteps?: number;
  /** Suggestions the user accepted or edited, keyed by stable field key. */
  decisions: Record<string, { value: string | string[] | boolean | null; accepted: boolean; edited: boolean }>;
  /** Fill results per stable field key, for reporting and metrics. */
  outcomes: Record<string, FillOutcome>;
  corrections: SessionCorrection[];
  /** Field keys the user explicitly rejected; never re-suggested this session. */
  rejected: string[];
  /** Per-step completion, for the "step 2 of 5" display. */
  stepsSeen: number[];
}

/**
 * Identity of a field across re-renders. Deliberately excludes the positional id
 * and the selector, both of which change when a framework re-mounts the subtree.
 */
export function fieldKey(field: { label?: string; type: string; name?: string; sectionId?: string }): string {
  const label = normalizeText(field.label ?? '');
  const name = normalizeText(field.name ?? '');
  return [field.type, label || name || 'unlabelled', name && label ? name : ''].filter(Boolean).join('|');
}

export function createSession(form: UnifiedForm): FormSessionState {
  const now = Date.now();
  return {
    url: form.url,
    origin: form.origin,
    platform: form.platform,
    startedAt: now,
    updatedAt: now,
    currentStep: form.metadata.currentStep ?? 1,
    totalSteps: form.metadata.totalSteps,
    decisions: {},
    outcomes: {},
    corrections: [],
    rejected: [],
    stepsSeen: [form.metadata.currentStep ?? 1],
  };
}

/** True when a stored session applies to the form now on screen. */
export function sessionMatchesForm(state: FormSessionState, form: UnifiedForm): boolean {
  return state.origin === form.origin && state.platform === form.platform;
}

export function noteStep(state: FormSessionState, form: UnifiedForm): FormSessionState {
  const step = form.metadata.currentStep ?? state.currentStep;
  const stepsSeen = state.stepsSeen.includes(step) ? state.stepsSeen : [...state.stepsSeen, step];
  return {
    ...state,
    currentStep: step,
    totalSteps: form.metadata.totalSteps ?? state.totalSteps,
    stepsSeen,
    updatedAt: Date.now(),
  };
}

export function recordDecision(
  state: FormSessionState,
  form: UnifiedForm,
  suggestion: FieldSuggestion,
  options: { accepted: boolean; edited: boolean; previousValue?: string | null },
): FormSessionState {
  const field = form.fields.find((f) => f.id === suggestion.fieldId);
  if (!field) return state;
  const key = fieldKey(field);
  const decisions = {
    ...state.decisions,
    [key]: { value: suggestion.value, accepted: options.accepted, edited: options.edited },
  };
  const rejected = options.accepted
    ? state.rejected.filter((k) => k !== key)
    : state.rejected.includes(key)
      ? state.rejected
      : [...state.rejected, key];

  const corrections = [...state.corrections];
  if (options.edited && typeof suggestion.value === 'string') {
    corrections.push({
      fieldKey: key,
      label: suggestion.label,
      from: options.previousValue ?? null,
      to: suggestion.value,
      at: Date.now(),
    });
  }

  return { ...state, decisions, rejected, corrections, updatedAt: Date.now() };
}

export function recordOutcomes(
  state: FormSessionState,
  form: UnifiedForm,
  outcomes: FillOutcome[],
): FormSessionState {
  const next = { ...state.outcomes };
  for (const outcome of outcomes) {
    const field = form.fields.find((f) => f.id === outcome.fieldId);
    if (!field) continue;
    next[fieldKey(field)] = outcome;
  }
  return { ...state, outcomes: next, updatedAt: Date.now() };
}

/**
 * Re-apply remembered decisions to a freshly computed suggestion list. This is what
 * makes a re-scan after a DOM change non-destructive: values the user typed win over
 * anything the engine would suggest again.
 */
export function applySession(
  state: FormSessionState,
  form: UnifiedForm,
  suggestions: FieldSuggestion[],
): FieldSuggestion[] {
  const byKey = new Map(form.fields.map((f) => [f.id, fieldKey(f)]));
  return suggestions.map((suggestion) => {
    const key = byKey.get(suggestion.fieldId);
    if (!key) return suggestion;
    if (state.rejected.includes(key)) {
      return { ...suggestion, accepted: false, value: null, status: 'manual', reason: 'You rejected this earlier.' };
    }
    const decision = state.decisions[key];
    if (!decision) return suggestion;
    return {
      ...suggestion,
      value: decision.value,
      accepted: decision.accepted,
      editedByUser: decision.edited,
      status: decision.accepted ? 'ready' : suggestion.status,
      confidence: decision.edited ? 1 : suggestion.confidence,
      band: decision.edited ? 'high' : suggestion.band,
      provenance: decision.edited
        ? { ...suggestion.provenance, origin: 'user', explanation: 'You entered this value.' }
        : suggestion.provenance,
    };
  });
}

/** Counts for the human-in-the-loop metrics in the research harness. */
export function sessionMetrics(state: FormSessionState): {
  accepted: number;
  rejected: number;
  edited: number;
  filled: number;
  failed: number;
} {
  const decisions = Object.values(state.decisions);
  const outcomes = Object.values(state.outcomes);
  return {
    accepted: decisions.filter((d) => d.accepted).length,
    rejected: state.rejected.length,
    edited: decisions.filter((d) => d.edited).length,
    filled: outcomes.filter((o) => o.filled).length,
    failed: outcomes.filter((o) => !o.filled).length,
  };
}
