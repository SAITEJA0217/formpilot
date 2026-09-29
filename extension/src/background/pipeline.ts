/**
 * Suggestion orchestration in the service worker.
 *
 * The rule engine runs locally and for free. Only the fields it could not resolve
 * on its own are sent to the API, batched into a single request, and only when the
 * user has left AI enabled. A form of twenty fields with two open questions costs
 * one API call, not twenty.
 */
import type { UnifiedForm } from '../../../shared/types/form';
import type { FieldSuggestion } from '../../../shared/types/suggestion';
import type { CorrectionRecord, ProfileDocument } from '../../../shared/types/profile';
import type { SuggestionsResult } from '../../../shared/messaging/messages';
import {
  buildSuggestions,
  mergeAIAnswers,
  summarize,
  DEFAULT_THRESHOLDS,
  type AIFieldAnswer,
  type ConfidenceThresholds,
  type ProfileLike,
} from '../../../shared/matching';
import { authorizedFetch, readJson, STORAGE_KEYS } from './api';
import { redactProfileForAI } from '../../../shared/privacy/redact';

export interface ExtensionSettings {
  allowAI: boolean;
  allowCorrectionLearning: boolean;
  highConfidence: number;
  mediumConfidence: number;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  allowAI: true,
  allowCorrectionLearning: true,
  highConfidence: DEFAULT_THRESHOLDS.high,
  mediumConfidence: DEFAULT_THRESHOLDS.medium,
};

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = stored[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

const CORRECTIONS_TTL_MS = 10 * 60 * 1000;

/**
 * Corrections are cached locally so the deterministic path can reuse a user's own
 * wording without an API round trip on every form.
 */
async function loadCorrections(token: string | undefined): Promise<CorrectionRecord[]> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.corrections, STORAGE_KEYS.correctionsFetchedAt]);
  const cached = (stored[STORAGE_KEYS.corrections] as CorrectionRecord[] | undefined) ?? [];
  const fetchedAt = (stored[STORAGE_KEYS.correctionsFetchedAt] as number | undefined) ?? 0;
  if (!token) return cached;
  if (Date.now() - fetchedAt < CORRECTIONS_TTL_MS) return cached;

  try {
    const response = await authorizedFetch('/api/ai/corrections', { method: 'GET' }, token);
    const body = await readJson<{ corrections: CorrectionRecord[] }>(response, 'Could not load corrections');
    const corrections = Array.isArray(body.corrections) ? body.corrections : [];
    await chrome.storage.local.set({
      [STORAGE_KEYS.corrections]: corrections,
      [STORAGE_KEYS.correctionsFetchedAt]: Date.now(),
    });
    return corrections;
  } catch {
    // Offline or unauthenticated: the cached set is still useful.
    return cached;
  }
}

interface GenerateResponse {
  answers?: AIFieldAnswer[];
  model?: string;
  error?: string;
}

/** Build suggestions for a detected form, calling the API only where it helps. */
export async function buildSuggestionsForForm(form: UnifiedForm): Promise<SuggestionsResult> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.profile, STORAGE_KEYS.token]);
  const profile = stored[STORAGE_KEYS.profile] as ProfileLike | undefined;
  const token = stored[STORAGE_KEYS.token] as string | undefined;

  if (!profile) {
    throw new Error('No profile found. Open the FormPilot dashboard and sign in to sync your profile.');
  }

  const settings = await loadSettings();
  const thresholds: ConfidenceThresholds = {
    high: settings.highConfidence,
    medium: settings.mediumConfidence,
  };
  const corrections = settings.allowCorrectionLearning ? await loadCorrections(token) : [];
  const documents = (profile as { documents?: ProfileDocument[] }).documents;

  const { suggestions, aiRequests } = buildSuggestions(form, profile, {
    thresholds,
    allowAI: settings.allowAI,
    documents,
    corrections,
  });

  let finalSuggestions: FieldSuggestion[] = suggestions;
  let aiCalls = 0;
  let aiError: string | undefined;

  if (aiRequests.length > 0 && settings.allowAI) {
    if (!token) {
      aiError = 'Sign in on the FormPilot dashboard to let the assistant draft the remaining answers.';
    } else {
      try {
        // Send only what the requested modes can use. The server route serialises whatever
        // it receives straight into the prompt, so a whole-profile send means the provider
        // sees the user's phone number, date of birth, saved documents and alternate personas
        // in order to draft one paragraph.
        const { profile: minimised } = redactProfileForAI(
          profile as Record<string, unknown>,
          aiRequests.map((request) => request.mode),
        );
        const response = await authorizedFetch(
          '/api/ai/generate',
          {
            method: 'POST',
            body: JSON.stringify({
              profile: minimised,
              fields: aiRequests,
              formContext: {
                title: form.title,
                platform: form.platform,
                url: form.url,
                sections: form.sections.map((section) => ({ id: section.id, title: section.title })),
              },
            }),
          },
          token,
        );
        const body = await readJson<GenerateResponse>(response, 'The assistant could not be reached');
        aiCalls = 1;
        const answers = (body.answers ?? []).map((answer) => ({ ...answer, model: answer.model ?? body.model }));
        finalSuggestions = mergeAIAnswers(form, suggestions, answers, { thresholds });
      } catch (error) {
        aiError = error instanceof Error ? error.message : 'The assistant could not be reached.';
      }
    }
  }

  return {
    suggestions: finalSuggestions,
    summary: summarize(form, finalSuggestions),
    aiCalls,
    aiError,
  };
}
