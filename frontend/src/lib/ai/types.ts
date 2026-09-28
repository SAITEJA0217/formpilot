/**
 * Provider-agnostic AI interface.
 *
 * The route code never imports a vendor SDK directly. Swapping or adding a provider
 * means adding one file here, not touching request handling, auth or rate limiting.
 */

export interface AIRequest {
  /** Instruction block. Sent as a system instruction where the provider supports one. */
  system: string;
  /** The task payload. */
  user: string;
  /** Upper bound on output tokens, where the provider honours one. */
  maxOutputTokens?: number;
  /** 0 = deterministic. Kept low for extraction-style tasks. */
  temperature?: number;
}

export interface AIResult {
  text: string;
  /** Concrete model identifier, recorded in provenance so results are reproducible. */
  model: string;
}

export interface AIProvider {
  id: string;
  model: string;
  generate(request: AIRequest): Promise<AIResult>;
}

export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIConfigurationError';
  }
}

export class AIProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/**
 * Extract the first JSON object from a model response.
 *
 * Models wrap JSON in prose or fences regardless of instructions, so this is the
 * single place that tolerates it — callers get either parsed JSON or a clear error.
 */
export function parseJsonObject<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new AIProviderError('The assistant did not return JSON.');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    throw new AIProviderError('The assistant returned malformed JSON.');
  }
}
