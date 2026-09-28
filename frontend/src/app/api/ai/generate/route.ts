/**
 * Answer generation endpoint.
 *
 * Accepts two request shapes:
 *
 *  - **v1 (legacy)** `{ profile, questions }` — a whole form of `FormQuestion`s in one
 *    call, answered with the original prompt and post-processing. Byte-compatible with
 *    what the v1 extension expects, so an extension that has not updated keeps working.
 *
 *  - **v2** `{ profile, fields, formContext }` — only the fields the client-side rule
 *    engine could not resolve, each tagged `assist` (pick among candidate concepts) or
 *    `generate` (write prose). Deterministic fields never reach this endpoint at all,
 *    which is where the cost and latency savings come from.
 */
import { NextResponse } from 'next/server';
import {
  FIELD_ASSIST_PROMPT,
  FORMPILOT_SYSTEM_PROMPT,
  LONG_FORM_PROMPT,
} from '../../../../../../shared/prompts';
import type { AIAnswer, FormQuestion, UserProfile } from '../../../../../../shared/types';
import type { AIFieldRequest } from '../../../../../../shared/matching/pipeline';
import { evaluateFieldSafety } from '../../../../../../shared/safety/policy';
import { adminDb } from '../../../../lib/firebase-admin';
import { corsHeaders, enforceRateLimit, errorResponse, HttpError, preflight, requireAuth } from '../../../../lib/api/guards';
import { getProvider, parseJsonObject, AIConfigurationError, type AIProvider } from '../../../../lib/ai';

export async function OPTIONS(req: Request) {
  return preflight(req);
}

interface LegacyBody {
  profile?: UserProfile;
  questions?: FormQuestion[];
}

interface V2Body {
  profile?: UserProfile;
  fields?: AIFieldRequest[];
  formContext?: {
    title?: string;
    platform?: string;
    url?: string;
    sections?: { id: string; title?: string }[];
  };
}

/** Recent corrections, used as few-shot phrasing examples. */
async function loadCorrectionsContext(uid: string): Promise<string> {
  try {
    const snapshot = await adminDb
      .collection(`users/${uid}/corrections`)
      .orderBy('timestamp', 'desc')
      .limit(15)
      .get();
    if (snapshot.empty) return '';
    const lines = snapshot.docs.map((doc) => {
      const data = doc.data() as { originalQuestion?: string; userCorrection?: string };
      return `- For question: "${data.originalQuestion ?? ''}"\n  User corrected to: "${data.userCorrection ?? ''}"`;
    });
    return `USER'S PAST CORRECTIONS (USE THESE PREFERENCES):\n${lines.join('\n')}`;
  } catch (error) {
    console.error('[ai/generate] could not load corrections', error instanceof Error ? error.message : error);
    return '';
  }
}

export async function POST(req: Request) {
  const headers = corsHeaders(req);

  try {
    const { uid } = await requireAuth(req);
    const body = (await req.json()) as LegacyBody & V2Body;

    if (!body.profile) {
      throw new HttpError(400, 'Missing profile');
    }

    let provider: AIProvider;
    try {
      provider = getProvider();
    } catch (error) {
      if (error instanceof AIConfigurationError) {
        throw new HttpError(500, error.message);
      }
      throw error;
    }

    await enforceRateLimit(uid);
    const corrections = await loadCorrectionsContext(uid);

    if (Array.isArray(body.fields)) {
      return await handleV2(body, provider, corrections, headers);
    }
    if (Array.isArray(body.questions)) {
      return await handleLegacy(body, provider, corrections, headers);
    }
    throw new HttpError(400, 'Request must include either "fields" (v2) or "questions" (v1)');
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error('[ai/generate] unexpected error', error instanceof Error ? error.message : error);
    }
    return errorResponse(error, headers);
  }
}

// ─── v2 ───────────────────────────────────────────────────────────────────────

interface V2Answer {
  fieldId: string;
  value: string | string[] | null;
  confidence: number;
  conceptId?: string;
  humanPath?: string;
  explanation?: string;
  model?: string;
}

/** Fields the safety policy refuses are dropped before any prompt is built. */
function dropUnsafeFields(fields: AIFieldRequest[]): { safe: AIFieldRequest[]; refused: string[] } {
  const safe: AIFieldRequest[] = [];
  const refused: string[] = [];
  for (const field of fields) {
    const verdict = evaluateFieldSafety({
      type: field.type,
      label: field.label,
      placeholder: undefined,
      autocomplete: undefined,
    });
    if (verdict.sensitivity === 'blocked') {
      refused.push(field.fieldId);
    } else {
      safe.push(field);
    }
  }
  return { safe, refused };
}

function describeField(field: AIFieldRequest): Record<string, unknown> {
  return {
    fieldId: field.fieldId,
    label: field.label,
    description: field.description,
    type: field.type,
    required: field.required,
    maxLength: field.maxLength,
    section: field.sectionTitle,
    nearbyText: field.context,
    options: field.options?.slice(0, 40).map((option) => option.label),
    candidateConcepts: field.candidates.slice(0, 4),
  };
}

async function runBatch(
  provider: AIProvider,
  system: string,
  profile: UserProfile,
  fields: AIFieldRequest[],
  corrections: string,
  formContext: V2Body['formContext'],
): Promise<V2Answer[]> {
  if (fields.length === 0) return [];
  const user = [
    corrections,
    `FORM CONTEXT:\n${JSON.stringify(formContext ?? {}, null, 2)}`,
    `USER PROFILE:\n${JSON.stringify(profile, null, 2)}`,
    `FIELDS:\n${JSON.stringify(fields.map(describeField), null, 2)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await provider.generate({ system, user, temperature: 0.2 });
  const parsed = parseJsonObject<{ answers?: V2Answer[] }>(result.text);
  const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
  const known = new Set(fields.map((field) => field.fieldId));
  return answers
    .filter((answer) => answer && typeof answer.fieldId === 'string' && known.has(answer.fieldId))
    .map((answer) => ({
      ...answer,
      confidence: typeof answer.confidence === 'number' ? answer.confidence : 0,
      model: result.model,
    }));
}

async function handleV2(
  body: V2Body,
  provider: AIProvider,
  corrections: string,
  headers: Record<string, string>,
) {
  const profile = body.profile as UserProfile;
  const { safe, refused } = dropUnsafeFields(body.fields ?? []);
  const assist = safe.filter((field) => field.mode === 'assist');
  const generate = safe.filter((field) => field.mode === 'generate');

  // One call per mode at most: the two prompts are incompatible, everything else batches.
  const [assistAnswers, generateAnswers] = await Promise.all([
    runBatch(provider, FIELD_ASSIST_PROMPT, profile, assist, corrections, body.formContext),
    runBatch(provider, LONG_FORM_PROMPT, profile, generate, corrections, body.formContext),
  ]);

  const providerCalls = (assist.length > 0 ? 1 : 0) + (generate.length > 0 ? 1 : 0);
  return NextResponse.json(
    {
      answers: [...assistAnswers, ...generateAnswers],
      refusedFieldIds: refused,
      model: provider.model,
      provider: provider.id,
      providerCalls,
    },
    { headers },
  );
}

// ─── v1 (legacy) ──────────────────────────────────────────────────────────────

/**
 * Unchanged v1 behaviour, including the confidence penalty applied to generated
 * answers. Kept verbatim so a v1 extension sees identical responses.
 */
async function handleLegacy(
  body: LegacyBody,
  provider: AIProvider,
  corrections: string,
  headers: Record<string, string>,
) {
  const { profile, questions } = body;
  if (!profile || !questions) {
    throw new HttpError(400, 'Missing profile or questions');
  }

  const user = [
    corrections,
    `USER PROFILE:\n${JSON.stringify(profile, null, 2)}`,
    `FORM QUESTIONS:\n${JSON.stringify(questions, null, 2)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await provider.generate({ system: FORMPILOT_SYSTEM_PROMPT, user, temperature: 0.2 });
  const parsed = parseJsonObject<{ answers?: (AIAnswer & { isGenerated?: boolean })[] }>(result.text);
  if (!Array.isArray(parsed.answers)) {
    throw new HttpError(502, 'AI returned invalid response format. Please try again.');
  }

  const answers = parsed.answers.map((answer) => {
    let source: AIAnswer['source'] = 'generated';
    let confidence = answer.confidence ?? 0;
    if (!answer.answer) {
      source = 'missing';
      confidence = 0;
    } else if (answer.isGenerated || !answer.sourceDetail || answer.sourceDetail.trim() === '') {
      confidence = Math.min(confidence, 70);
      source = 'generated';
    } else {
      source = 'profile';
    }
    return { ...answer, source, confidence };
  });

  return NextResponse.json({ answers, model: provider.model, provider: provider.id }, { headers });
}
