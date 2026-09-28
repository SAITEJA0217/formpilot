/**
 * Provider selection.
 *
 * `AI_PROVIDER` chooses the implementation; omitting it keeps the v1 behaviour
 * (Gemini). The provider is constructed per request rather than at module scope so a
 * missing key produces a clean 500 from the route instead of a crash at import time.
 */
import { createGeminiProvider } from './gemini';
import { createOpenAICompatibleProvider } from './openaiCompatible';
import { AIConfigurationError, type AIProvider } from './types';

export type ProviderId = 'gemini' | 'openai-compatible';

export function configuredProviderId(): ProviderId {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (raw === 'openai' || raw === 'openai-compatible') return 'openai-compatible';
  return 'gemini';
}

export function getProvider(): AIProvider {
  switch (configuredProviderId()) {
    case 'openai-compatible':
      return createOpenAICompatibleProvider();
    case 'gemini':
    default:
      return createGeminiProvider();
  }
}

/** True when the selected provider has the configuration it needs. */
export function isProviderConfigured(): boolean {
  try {
    getProvider();
    return true;
  } catch (error) {
    if (error instanceof AIConfigurationError) return false;
    throw error;
  }
}

export * from './types';
export { DEFAULT_GEMINI_MODEL } from './gemini';
