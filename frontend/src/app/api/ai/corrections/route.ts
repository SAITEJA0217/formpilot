/**
 * Correction learning endpoint.
 *
 * `POST` records a correction and classifies it (does it change a durable fact, or
 * just the wording?). `GET` and `DELETE` are new in v2 and exist for privacy: the user
 * can see exactly what has been learned about them, and delete it.
 *
 * Nothing here writes back into the profile. A fact-level correction is recorded and
 * surfaced; changing stored profile data stays an explicit action in the dashboard.
 */
import { NextResponse } from 'next/server';
import type { CorrectionRecord } from '../../../../../../shared/types/profile';
import { adminDb } from '../../../../lib/firebase-admin';
import { corsHeaders, errorResponse, HttpError, preflight, requireAuth } from '../../../../lib/api/guards';
import { getProvider, parseJsonObject, AIConfigurationError } from '../../../../lib/ai';

const MAX_LISTED = 100;

export async function OPTIONS(req: Request) {
  return preflight(req);
}

/** Classify a correction. Falls back to `phrasing-level`, the safer assumption. */
async function classify(input: {
  originalQuestion: string;
  originalAnswer?: string | null;
  userCorrection: string;
  sourceDetail?: string;
}): Promise<'fact-level' | 'phrasing-level'> {
  let provider;
  try {
    provider = getProvider();
  } catch (error) {
    if (error instanceof AIConfigurationError) return 'phrasing-level';
    throw error;
  }

  const prompt = `
Analyze this user correction to an AI-generated form answer.
Question: "${input.originalQuestion}"
Original AI Answer: "${input.originalAnswer ?? ''}"
User's Correction: "${input.userCorrection}"
Source Field Used: "${input.sourceDetail ?? ''}"

Classify this correction as either 'fact-level' or 'phrasing-level'.
- fact-level: the user is correcting a durable fact (e.g. a graduation year, a new skill).
- phrasing-level: the user is changing tone or wording; the underlying fact is unchanged.

Return ONLY a JSON object: {"type": "fact-level" | "phrasing-level"}
`;

  try {
    const result = await provider.generate({ system: 'You classify user corrections.', user: prompt, temperature: 0 });
    const parsed = parseJsonObject<{ type?: string }>(result.text);
    return parsed.type === 'fact-level' ? 'fact-level' : 'phrasing-level';
  } catch {
    return 'phrasing-level';
  }
}

export async function POST(req: Request) {
  const headers = corsHeaders(req);
  try {
    const { uid } = await requireAuth(req);
    const body = (await req.json()) as {
      originalQuestion?: string;
      originalAnswer?: string | null;
      userCorrection?: string;
      sourceDetail?: string;
      conceptId?: string;
    };

    if (!body.originalQuestion || !body.userCorrection) {
      throw new HttpError(400, 'Missing originalQuestion or userCorrection');
    }

    const type = await classify({
      originalQuestion: body.originalQuestion,
      originalAnswer: body.originalAnswer,
      userCorrection: body.userCorrection,
      sourceDetail: body.sourceDetail,
    });

    const record: Omit<CorrectionRecord, 'id'> = {
      originalQuestion: body.originalQuestion,
      originalAnswer: body.originalAnswer ?? null,
      userCorrection: body.userCorrection,
      sourceDetail: body.sourceDetail,
      conceptId: body.conceptId,
      type,
      timestamp: Date.now(),
    };
    // Firestore rejects explicit `undefined`; drop the optional keys that are unset.
    const payload = Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

    await adminDb.collection(`users/${uid}/corrections`).doc().set(payload);
    return NextResponse.json({ success: true, type }, { headers });
  } catch (error) {
    return errorResponse(error, headers);
  }
}

/** Privacy: let the user (and the extension's local matcher) read their corrections. */
export async function GET(req: Request) {
  const headers = corsHeaders(req);
  try {
    const { uid } = await requireAuth(req);
    const snapshot = await adminDb
      .collection(`users/${uid}/corrections`)
      .orderBy('timestamp', 'desc')
      .limit(MAX_LISTED)
      .get();

    const corrections: CorrectionRecord[] = snapshot.docs.map((doc) => {
      const data = doc.data() as Omit<CorrectionRecord, 'id'>;
      return { id: doc.id, ...data };
    });
    return NextResponse.json({ corrections }, { headers });
  } catch (error) {
    return errorResponse(error, headers);
  }
}

/** Privacy: delete one correction (`?id=`) or every correction for this user. */
export async function DELETE(req: Request) {
  const headers = corsHeaders(req);
  try {
    const { uid } = await requireAuth(req);
    const id = new URL(req.url).searchParams.get('id');

    if (id) {
      await adminDb.collection(`users/${uid}/corrections`).doc(id).delete();
      return NextResponse.json({ deleted: 1 }, { headers });
    }

    // Batched delete, paged so a large history cannot exceed the batch limit.
    let deleted = 0;
    for (;;) {
      const snapshot = await adminDb.collection(`users/${uid}/corrections`).limit(300).get();
      if (snapshot.empty) break;
      const batch = adminDb.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += snapshot.size;
      if (snapshot.size < 300) break;
    }
    return NextResponse.json({ deleted }, { headers });
  } catch (error) {
    return errorResponse(error, headers);
  }
}
