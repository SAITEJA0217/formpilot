/**
 * Google Gemini provider.
 *
 * This is the provider v1 shipped with, and its default model is unchanged
 * (`gemini-2.5-flash`), so behaviour for existing users is identical.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIConfigurationError, AIProviderError, type AIProvider, type AIRequest, type AIResult } from './types';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export function createGeminiProvider(): AIProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AIConfigurationError('Server misconfiguration: GEMINI_API_KEY is not set.');
  }
  const modelName = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const client = new GoogleGenerativeAI(apiKey);

  return {
    id: 'gemini',
    model: modelName,
    async generate(request: AIRequest): Promise<AIResult> {
      const model = client.getGenerativeModel({ model: modelName });
      try {
        // v1 concatenated system and user text into one prompt; keep that shape so
        // prompt behaviour does not shift underneath existing users.
        const result = await model.generateContent(`${request.system}\n\n${request.user}`);
        return { text: result.response.text(), model: modelName };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Gemini request failed.';
        if (/API key not valid|API_KEY_INVALID/i.test(message)) {
          throw new AIProviderError('AI provider error: the configured API key was rejected.');
        }
        throw new AIProviderError(message);
      }
    },
  };
}
