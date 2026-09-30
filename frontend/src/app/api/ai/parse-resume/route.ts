import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '../../../../lib/firebase-admin';
import { callOpenRouter, FREE_OPENROUTER_MODEL, OpenRouterError, extractJsonFromResponse } from '@/lib/openrouter';

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

    const buffer = Buffer.from(await file.arrayBuffer());
    let extractedText = '';
    try {
      // Try extracting text using pdf-parse if available
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(buffer);
      extractedText = pdfData?.text?.trim() || '';
    } catch (parseErr) {
      console.warn('[API /ai/parse-resume] Text extraction via pdf-parse skipped/failed:', parseErr);
    }

    const prompt = `You are an expert resume parser. Extract the following information from the provided resume and format it EXACTLY according to the JSON schema below. 
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

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenRouter API key not configured (OPENROUTER_API_KEY).' }, { status: 500, headers: corsHeaders });
    }

    const modelName = process.env.OPENROUTER_MODEL || FREE_OPENROUTER_MODEL;

    let parsedData;
    try {
      let rawResponseText = '';

      if (extractedText && extractedText.length > 50) {
        // We have clean text from the PDF, send text directly
        rawResponseText = await callOpenRouter({
          model: modelName,
          messages: [
            {
              role: 'user',
              content: `${prompt}\n\nRESUME CONTENT:\n${extractedText}`
            }
          ],
          responseFormat: { type: 'json_object' },
          temperature: 0.1,
          maxTokens: 2000
        });
      } else {
        // Multimodal PDF fallback
        const base64Pdf = buffer.toString('base64');
        rawResponseText = await callOpenRouter({
          model: modelName,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:application/pdf;base64,${base64Pdf}`
                  }
                },
                {
                  type: 'text',
                  text: prompt
                }
              ]
            }
          ],
          responseFormat: { type: 'json_object' },
          temperature: 0.1,
          maxTokens: 2000
        });
      }

      parsedData = extractJsonFromResponse(rawResponseText);

      // Sanitize: replace all null values with "" so React controlled inputs don't warn
      parsedData = JSON.parse(JSON.stringify(parsedData, (_key, val) => val === null ? '' : val));
    } catch (aiError: any) {
      console.error('AI extraction failed:', aiError?.message || aiError);
      if (aiError instanceof OpenRouterError) {
        return NextResponse.json({ error: aiError.message }, { status: aiError.status || 502, headers: corsHeaders });
      }
      return NextResponse.json({ error: aiError.message || 'AI extraction failed. Please try again.' }, { status: 502, headers: corsHeaders });
    }

    return NextResponse.json(parsedData, { headers: corsHeaders });
  } catch (error: any) {
    console.error('Unexpected error parsing resume:', error);
    return NextResponse.json({ error: error.message || 'An unexpected error occurred while processing your request.' }, { status: 500, headers: corsHeaders });
  }
}
