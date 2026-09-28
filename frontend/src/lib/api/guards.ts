/**
 * Shared route guards: CORS, authentication, rate limiting.
 *
 * Previously each route carried its own copy of this logic, which is how the three
 * copies drifted. One implementation means one place to tighten.
 */
import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '../firebase-admin';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Allowed callers: the extension (any id, since the id differs per install and per
 * unpacked build), plus explicit origins from `ALLOWED_ORIGINS`, plus localhost while
 * developing. Unlike v1 this never falls back to `*`: an unrecognized origin simply
 * receives no CORS headers, so the browser blocks it.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
  if (!origin) return base;

  const allowList = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const isExtension = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
  const isLocal =
    process.env.NODE_ENV !== 'production' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const isListed = allowList.includes(origin);

  if (isExtension || isLocal || isListed) {
    return { ...base, 'Access-Control-Allow-Origin': origin };
  }
  return base;
}

export function preflight(req: Request): NextResponse {
  return new NextResponse(null, { status: 200, headers: corsHeaders(req) });
}

export interface AuthResult {
  uid: string;
}

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Verify the Firebase ID token. Throws `HttpError` with a safe message. */
export async function requireAuth(req: Request): Promise<AuthResult> {
  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid Authorization header');
  }
  const token = header.slice('Bearer '.length);
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid };
  } catch {
    // Never echo the verification error: it can leak configuration details.
    throw new HttpError(401, 'Unauthorized: invalid or expired token');
  }
}

/**
 * Per-user daily request budget, held in a Firestore transaction so it survives
 * across serverless instances. Carried over from v1 with the same default limit.
 */
export async function enforceRateLimit(uid: string, maxPerDay = 1000): Promise<void> {
  const ref = adminDb.collection('rateLimits').doc(uid);
  const now = Date.now();
  try {
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        transaction.set(ref, { count: 1, timestamp: now });
        return;
      }
      const data = snapshot.data() as { count: number; timestamp: number };
      if (now - data.timestamp > ONE_DAY_MS) {
        transaction.set(ref, { count: 1, timestamp: now });
      } else if (data.count >= maxPerDay) {
        throw new HttpError(429, 'Daily request limit reached. Try again tomorrow.');
      } else {
        transaction.update(ref, { count: data.count + 1 });
      }
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // A rate-limit backend failure must not take the feature down; log and continue.
    console.error('[rateLimit] transaction failed', error instanceof Error ? error.message : error);
  }
}

/** Turn any thrown value into a JSON response with CORS headers attached. */
export function errorResponse(error: unknown, headers: Record<string, string>): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers });
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  return NextResponse.json({ error: message }, { status: 500, headers });
}
