/**
 * OpenAI-compatible chat-completions provider.
 *
 * Implemented with `fetch` and no SDK, so it works against any endpoint that speaks
 * the `/chat/completions` shape (OpenAI, Azure OpenAI, OpenRouter, vLLM, Ollama's
 * compatibility layer, LM Studio).
 *
 * Status: implemented and type-checked, but *not* verified against a live endpoint in
 * this repository — there is no key to test with. It is documented as experimental
 * for exactly that reason. `gemini` remains the default provider.
 */
import { AIConfigurationError, AIProviderError, type AIProvider, type AIRequest, type AIResult } from './types';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  model?: string;
  error?: { message?: string };
}

export function createOpenAICompatibleProvider(): AIProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const modelName = process.env.OPENAI_MODEL?.trim();

  if (!apiKey) {
    throw new AIConfigurationError('Server misconfiguration: OPENAI_API_KEY is not set.');
  }
  if (!modelName) {
    throw new AIConfigurationError('Server misconfiguration: OPENAI_MODEL is not set.');
  }

  return {
    id: 'openai-compatible',
    model: modelName,
    async generate(request: AIRequest): Promise<AIResult> {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxOutputTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
          }),
        });
      } catch (error) {
        throw new AIProviderError(
          error instanceof Error ? `AI provider unreachable: ${error.message}` : 'AI provider unreachable.',
        );
      }

      const body = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
      if (!response.ok) {
        throw new AIProviderError(body?.error?.message ?? `AI provider returned HTTP ${response.status}.`);
      }
      const text = body?.choices?.[0]?.message?.content;
      if (!text) {
        throw new AIProviderError('AI provider returned an empty response.');
      }
      return { text, model: body?.model ?? modelName };
    },
  };
}
