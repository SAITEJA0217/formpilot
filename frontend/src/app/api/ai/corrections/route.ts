import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '../../../../lib/firebase-admin';
import { callOpenRouter, FREE_OPENROUTER_MODEL, OpenRouterError, extractJsonFromResponse } from '@/lib/openrouter';

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin');
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
  const isAllowed = origin && (
    allowedOrigins.includes(origin) ||
    origin.startsWith('chrome-extension://') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1')
  );
  return {
    'Access-Control-Allow-Origin': isAllowed && origin ? origin : (allowedOrigins[0] || '*'),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 200, headers: getCorsHeaders(req) });
}

export async function POST(req: Request) {
  const corsHeaders = getCorsHeaders(req);
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const { originalQuestion, originalAnswer, userCorrection, sourceDetail } = await req.json();

    if (!originalQuestion || !userCorrection) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: corsHeaders });
    }

    // Classify the correction
    const prompt = `
      Analyze this user correction to an AI-generated form answer.
      Question: "${originalQuestion}"
      Original AI Answer: "${originalAnswer}"
      User's Correction: "${userCorrection}"
      Source Field Used: "${sourceDetail}"

      Classify this correction as either 'fact-level' or 'phrasing-level'.
      - fact-level: The user is correcting a durable fact (e.g. changing graduation year from 2023 to 2024, or adding a new skill).
      - phrasing-level: The user is just changing the tone or wording for this specific context, but the underlying fact hasn't changed.

      Return ONLY a JSON object: {"type": "fact-level" | "phrasing-level"}
    `;

    let type = 'phrasing-level'; // default
    try {
      const responseText = await callOpenRouter({
        model: process.env.OPENROUTER_MODEL || FREE_OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        responseFormat: { type: 'json_object' },
        temperature: 0.1,
        maxTokens: 500
      });
      const parsed = extractJsonFromResponse(responseText);
      if (parsed.type === 'fact-level') type = 'fact-level';
    } catch (e) {
      console.error("Failed to parse classification", e);
    }

    // Save correction
    const correctionRef = adminDb.collection(`users/${uid}/corrections`).doc();
    await correctionRef.set({
      originalQuestion,
      originalAnswer,
      userCorrection,
      sourceDetail,
      type,
      timestamp: Date.now()
    });

    return NextResponse.json({ success: true, type }, { headers: corsHeaders });

  } catch (error: any) {
    console.error("Corrections Route Error:", error);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: error.status || 502, headers: corsHeaders });
    }
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
