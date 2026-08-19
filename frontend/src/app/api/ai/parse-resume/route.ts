import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '../../../../lib/firebase-admin';
import https from 'https';

function getCorsHeaders(req: NextRequest) {
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 200, headers: getCorsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const corsHeaders = getCorsHeaders(req);
  try {
    // Require a valid Firebase ID token in all environments
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
      await adminAuth.verifyIdToken(token);
    } catch (e) {
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401, headers: corsHeaders });
    }

    const formData = await req.formData();
    const file = formData.get('resume') as File | null;

    if (!file || file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Invalid file type. Please upload a PDF file.' }, { status: 400, headers: corsHeaders });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds limit. Maximum allowed size is 5MB.' }, { status: 400, headers: corsHeaders });
    }

    // Convert PDF to base64 for direct Gemini inline upload (no pdf-parse needed)
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Pdf = buffer.toString('base64');

    const prompt = `You are an expert resume parser. Extract the following information from the provided resume PDF and format it EXACTLY according to the JSON schema below. 
Return ONLY valid JSON, without any markdown formatting or code blocks.

JSON Schema required:
{
  "basicProfile": {
    "fullName": "string (empty if not found)",
    "email": "string (empty if not found)",
    "phone": "string (empty if not found)",
    "dateOfBirth": "",
    "gender": "",
    "address": "string (empty if not found)"
  },
  "education": [
    {
      "id": "generate a random string",
      "college": "string",
      "university": "string",
      "degree": "string",
      "branch": "string",
      "graduationYear": "string",
      "cgpa": "string"
    }
  ],
  "skills": {
    "technical": ["array of strings"],
    "soft": ["array of strings"]
  },
  "projects": [
    {
      "id": "generate a random string",
      "name": "string",
      "description": "string",
      "technologies": ["array of strings"]
    }
  ],
  "experience": [
    {
      "id": "generate a random string",
      "company": "string",
      "position": "string",
      "duration": "string",
      "description": "string"
    }
  ],
  "socialLinks": {
    "linkedin": "string (empty if not found)",
    "github": "string (empty if not found)",
    "portfolio": "string (empty if not found)"
  }
}`;

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json({ error: 'Gemini API key not configured.' }, { status: 500, headers: corsHeaders });
    }

    let parsedData;
    try {
      const requestBody = JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: 'application/pdf',
                data: base64Pdf,
              }
            },
            { text: prompt }
          ]
        }],
        generationConfig: {
          response_mime_type: 'application/json',
        }
      });

      // Use Node.js native https to bypass Next.js/undici fetch issues
      const geminiResponse = await new Promise<string>((resolve, reject) => {
        const options = {
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
          },
          timeout: 60000,
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Gemini API timeout')); });
        req.write(requestBody);
        req.end();
      });

      const geminiJson = JSON.parse(geminiResponse);

      // Check for API-level errors first
      if (geminiJson.error) {
        throw new Error(`Gemini API error: ${geminiJson.error.message || JSON.stringify(geminiJson.error)}`);
      }

      const candidate = geminiJson?.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        throw new Error(`Gemini blocked response: ${finishReason}`);
      }

      const rawText = candidate?.content?.parts?.[0]?.text?.trim() ?? '';
      if (!rawText) throw new Error('Empty response from Gemini');

      const jsonText = rawText.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
      parsedData = JSON.parse(jsonText);

      // Sanitize: replace all null values with "" so React controlled inputs don't warn
      parsedData = JSON.parse(JSON.stringify(parsedData, (_key, val) => val === null ? '' : val));
    } catch (aiError: any) {
      console.error('AI extraction failed:', aiError?.message || aiError);
      return NextResponse.json({ error: 'AI extraction failed. Please try again.' }, { status: 502, headers: corsHeaders });
    }

    return NextResponse.json(parsedData, { headers: corsHeaders });
  } catch (error: any) {
    console.error('Unexpected error parsing resume:', error);
    return NextResponse.json({ error: 'An unexpected error occurred while processing your request.' }, { status: 500, headers: corsHeaders });
  }
}
