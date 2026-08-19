import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { FORMPILOT_SYSTEM_PROMPT } from '../../../../../../shared/prompts';
import { UserProfile, FormQuestion, AIAnswer } from '../../../../../../shared/types';
import { adminAuth, adminDb } from '../../../../lib/firebase-admin';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const MAX_REQUESTS_PER_DAY = 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(req),
  });
}

export async function POST(req: Request) {
  const corsHeaders = getCorsHeaders(req);

  try {
    console.log(`[API /ai/generate] Endpoint reached. Method: ${req.method}`);
    
    // 1. Verify Authentication Token
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn(`[API /ai/generate] Auth failed: Missing or invalid Authorization header`);
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.split('Bearer ')[1];
    
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
      console.log(`[API /ai/generate] Authenticated: true (User ID: ${decodedToken.uid})`);
    } catch (err: any) {
      console.error(`[API /ai/generate] Auth verification failed: ${err.message}`);
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401, headers: corsHeaders });
    }
    
    const uid = decodedToken.uid;

    const body = await req.json();
    const { profile, questions }: { profile: UserProfile, questions: FormQuestion[] } = body;

    if (!profile || !questions) {
      console.warn(`[API /ai/generate] Invalid request: Missing profile or questions array`);
      return NextResponse.json({ error: 'Missing profile or questions' }, { status: 400, headers: corsHeaders });
    }
    
    console.log(`[API /ai/generate] Payload received: ${questions.length} questions, ${Object.keys(profile).length} profile fields`);

    // 2. Persistent Rate Limiting via Firestore
    const rateLimitRef = adminDb.collection('rateLimits').doc(uid);
    const now = Date.now();
    
    await adminDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);
      if (!doc.exists) {
        transaction.set(rateLimitRef, { count: 1, timestamp: now });
      } else {
        const data = doc.data()!;
        if (now - data.timestamp > ONE_DAY_MS) {
          transaction.set(rateLimitRef, { count: 1, timestamp: now });
        } else if (data.count >= MAX_REQUESTS_PER_DAY) {
          throw new Error('RateLimitExceeded');
        } else {
          transaction.update(rateLimitRef, { count: data.count + 1 });
        }
      }
    }).catch(err => {
      if (err.message === 'RateLimitExceeded') {
        throw err;
      }
      console.error("Rate limit transaction failed", err);
    });

    // 3. Fetch past corrections for few-shot learning
    let correctionsContext = "";
    try {
      const correctionsSnap = await adminDb.collection(`users/${uid}/corrections`)
        .orderBy('timestamp', 'desc')
        .limit(15)
        .get();
        
      if (!correctionsSnap.empty) {
        correctionsContext = "USER'S PAST CORRECTIONS (USE THESE PREFERENCES):\n";
        correctionsSnap.docs.forEach(doc => {
          const c = doc.data();
          correctionsContext += `- For question: "${c.originalQuestion}"\n  User corrected to: "${c.userCorrection}"\n`;
        });
      }
    } catch (e) {
      console.error("Failed to fetch corrections", e);
      // Continue anyway
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error(`[API /ai/generate] Server misconfiguration: GEMINI_API_KEY is missing`);
      return NextResponse.json({ error: 'Server misconfiguration: AI provider key missing' }, { status: 500, headers: corsHeaders });
    }

    console.log(`[API /ai/generate] AI Provider selected: Gemini (gemini-2.5-flash)`);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
      ${FORMPILOT_SYSTEM_PROMPT}
      
      ${correctionsContext}

      USER PROFILE:
      ${JSON.stringify(profile, null, 2)}

      FORM QUESTIONS:
      ${JSON.stringify(questions, null, 2)}
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    let cleanedText = responseText;
    const startIdx = cleanedText.indexOf('{');
    const endIdx = cleanedText.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      cleanedText = cleanedText.substring(startIdx, endIdx + 1);
    }
    
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(cleanedText);
      if (!parsedResponse || !Array.isArray(parsedResponse.answers)) {
        throw new Error('Response is missing answers array');
      }
      console.log(`[API /ai/generate] AI Generation successful. Parsed ${parsedResponse.answers.length} answers.`);
    } catch (e: any) {
      console.error(`[API /ai/generate] AI returned malformed JSON: ${e.message}. Raw text preview: ${responseText.substring(0, 100)}...`);
      return NextResponse.json({ error: 'AI returned invalid response format. Please try again.' }, { status: 502, headers: corsHeaders });
    }

    // 4. Honesty Check for Confidence & Provenance
    const enhancedAnswers = parsedResponse.answers.map((ans: any) => {
      let source: AIAnswer['source'] = 'generated';
      let confidence = ans.confidence || 0;
      
      if (!ans.answer) {
        source = 'missing';
        confidence = 0;
      } else if (ans.isGenerated || !ans.sourceDetail || ans.sourceDetail.trim() === '') {
        // If the AI generated it instead of directly retrieving, penalize confidence
        confidence = Math.min(confidence, 70); 
        source = 'generated';
      } else {
        source = 'profile';
      }
      
      return { ...ans, source, confidence };
    });

    return NextResponse.json({ answers: enhancedAnswers }, { headers: corsHeaders });

  } catch (error: any) {
    console.error(`[API /ai/generate] Unexpected AI Generation Route Error:`, error);
    
    // Check if it's a Gemini API error (quota, invalid key, etc)
    if (error.message?.includes('API key not valid') || error.message?.includes('API_KEY_INVALID')) {
      return NextResponse.json({ error: 'AI Provider Error: Invalid API Key' }, { status: 502, headers: corsHeaders });
    }
    
    if (error.message === 'RateLimitExceeded') {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again tomorrow.' }, { status: 429, headers: corsHeaders });
    }
    
    return NextResponse.json({ error: error.message || 'An unexpected error occurred during AI generation' }, { status: 500, headers: corsHeaders });
  }
}
