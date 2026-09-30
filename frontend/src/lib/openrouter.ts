export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface OpenRouterCallOptions {
  messages: OpenRouterMessage[];
  model?: string;
  responseFormat?: { type: string };
  temperature?: number;
  maxTokens?: number;
}

export class OpenRouterError extends Error {
  status: number;
  rawDetails?: any;

  constructor(message: string, status: number, rawDetails?: any) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.rawDetails = rawDetails;
  }
}

export const FREE_OPENROUTER_MODEL = 'nvidia/nemotron-3.5-lightning:free';

function cleanAndParse(str: string): any {
  let s = str.trim();
  // Strip markdown code fences if present
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(s);
}

function repairTruncatedJson(str: string): any {
  try {
    const answersIdx = str.indexOf('"answers"');
    if (answersIdx === -1) return null;
    const openBracket = str.indexOf('[', answersIdx);
    if (openBracket === -1) return null;
    
    // Find the last completely closed answer item '}'
    const lastItemEnd = str.lastIndexOf('}');
    if (lastItemEnd > openBracket) {
      const startBrace = str.lastIndexOf('{', answersIdx);
      if (startBrace !== -1 && startBrace < answersIdx) {
        const candidate = str.substring(startBrace, lastItemEnd + 1) + ']}';
        return cleanAndParse(candidate);
      }
    }
  } catch {}
  return null;
}

export function extractJsonFromResponse(rawText: string): any {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty or invalid response from AI model');
  }

  // 1. Remove <think>...</think> tags if present from reasoning models
  let text = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Try extracting from markdown code blocks (e.g. ```json ... ```)
  const codeBlockMatches = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)(?:```|$)/gi));
  for (const match of codeBlockMatches.reverse()) {
    const candidate = match[1].trim();
    if (candidate.includes('"answers"') || candidate.startsWith('{') || candidate.startsWith('[')) {
      try {
        return cleanAndParse(candidate);
      } catch {
        const repaired = repairTruncatedJson(candidate);
        if (repaired && Array.isArray(repaired.answers)) return repaired;
      }
    }
  }

  // 3. Locate the "answers" object explicitly
  const answersIdx = text.indexOf('"answers"');
  if (answersIdx !== -1) {
    const startIdx = text.lastIndexOf('{', answersIdx);
    const endIdx = text.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      const candidate = text.substring(startIdx, endIdx + 1);
      try {
        return cleanAndParse(candidate);
      } catch {
        const repaired = repairTruncatedJson(candidate);
        if (repaired && Array.isArray(repaired.answers)) return repaired;
      }
    }
  }

  // 4. Try repairing any truncated JSON from the entire text
  const repairedGlobal = repairTruncatedJson(text);
  if (repairedGlobal && Array.isArray(repairedGlobal.answers) && repairedGlobal.answers.length > 0) {
    return repairedGlobal;
  }

  // 5. Fallback regex item extraction: parse individual answer JSON items
  const answerBlockRegex = /\{[^{}]*?"question"\s*:\s*(?:"(?:\\.|[^"\\])*"|[^{}]+)[^{}]*?\}/gi;
  const blockMatches = Array.from(text.matchAll(answerBlockRegex));
  if (blockMatches.length > 0) {
    const recoveredAnswers: any[] = [];
    for (const b of blockMatches) {
      try {
        const item = cleanAndParse(b[0]);
        if (item && item.question !== undefined) recoveredAnswers.push(item);
      } catch {}
    }
    if (recoveredAnswers.length > 0) {
      console.log(`[extractJsonFromResponse] Recovered ${recoveredAnswers.length} answers via regex recovery parser.`);
      return { answers: recoveredAnswers };
    }
  }

  // 6. Outermost brace search
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.substring(firstBrace, lastBrace + 1);
    try {
      return cleanAndParse(candidate);
    } catch {}
  }

  // 7. Direct clean and parse attempt
  try {
    return cleanAndParse(text);
  } catch (err: any) {
    console.error('[extractJsonFromResponse] Parsing failed. Raw text preview:', rawText.substring(0, 300));
    throw new Error(`AI returned invalid JSON: ${err.message}`);
  }
}

export async function callOpenRouter({
  messages,
  model = process.env.OPENROUTER_MODEL || FREE_OPENROUTER_MODEL,
  responseFormat,
  temperature = 0.1,
  maxTokens = 4096,
}: OpenRouterCallOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError('OpenRouter API key is not configured (OPENROUTER_API_KEY). Please set it in your environment variables.', 500);
  }

  const payload: Record<string, any> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    // OpenRouter parameter to disable reasoning tokens
    reasoning: {
      max_tokens: 0,
    },
  };

  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  let response: Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'FormPilot',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr: any) {
    console.error('[OpenRouter Client] Network failure calling OpenRouter:', networkErr);
    throw new OpenRouterError(`Connection error: Failed to reach OpenRouter API (${networkErr?.message || 'Network failure'}). Please check your internet connection.`, 503, networkErr);
  }

  if (!response.ok) {
    let errorDetails = '';
    let parsedBody: any = null;

    try {
      parsedBody = await response.json();
      if (parsedBody?.error?.message) {
        errorDetails = parsedBody.error.message;
      } else if (parsedBody?.message) {
        errorDetails = parsedBody.message;
      } else {
        errorDetails = JSON.stringify(parsedBody);
      }
    } catch {
      try {
        errorDetails = await response.text();
      } catch {
        errorDetails = response.statusText;
      }
    }

    console.error(`[OpenRouter Client] API Error [Status ${response.status}]: ${errorDetails}`);

    if (response.status === 401) {
      throw new OpenRouterError(`Invalid OpenRouter API Key (401). Please verify your OPENROUTER_API_KEY. Details: ${errorDetails}`, 401, parsedBody);
    } else if (response.status === 402) {
      throw new OpenRouterError(
        `OpenRouter rejected this request because the selected model/account requires credits. Please verify that FormPilot is using the free model: ${model}. Details: ${errorDetails}`,
        402,
        parsedBody
      );
    } else if (response.status === 403) {
      throw new OpenRouterError(`Access Denied (403) by OpenRouter. Details: ${errorDetails}`, 403, parsedBody);
    } else if (response.status === 429) {
      throw new OpenRouterError(`Rate Limit Exceeded (429) on OpenRouter. Please wait a moment and try again. Details: ${errorDetails}`, 429, parsedBody);
    } else if (response.status >= 500) {
      throw new OpenRouterError(`OpenRouter Provider Error (${response.status}): ${errorDetails || 'Temporary server error'}`, response.status, parsedBody);
    }

    throw new OpenRouterError(`OpenRouter API error (${response.status}): ${errorDetails}`, response.status, parsedBody);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content;

  if (!content) {
    throw new OpenRouterError('Empty response received from OpenRouter API.', 502, data);
  }

  return content;
}
