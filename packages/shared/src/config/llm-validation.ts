/**
 * LLM Connection Validation
 *
 * Anthropic SDK preflight checks were removed with the Claude runtime.
 * Pi connections validate on connect.
 */

import { isUnsupportedLlmConnection, UNSUPPORTED_LLM_CONNECTION_MESSAGE } from './llm-connections.ts';
import type { LlmConnection } from './llm-connections.ts';

export interface LlmValidationConfig {
  model: string;
  apiKey?: string;
  oauthToken?: string;
  baseUrl?: string;
}

export interface LlmValidationResult {
  success: boolean;
  error?: string;
}

export function parseValidationError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return 'Invalid API key';
  }
  if (lower.includes('403')) {
    return 'API key does not have permission to access this resource';
  }
  if (lower.includes('404')) {
    return 'API endpoint not found. Check the URL.';
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'Rate limit exceeded. Please try again.';
  }
  return msg.slice(0, 300);
}

export async function validateAnthropicConnection(
  _config: LlmValidationConfig,
): Promise<LlmValidationResult> {
  return { success: false, error: UNSUPPORTED_LLM_CONNECTION_MESSAGE };
}

export function validateConnectionShape(connection: LlmConnection): LlmValidationResult {
  if (isUnsupportedLlmConnection(connection)) {
    return { success: false, error: UNSUPPORTED_LLM_CONNECTION_MESSAGE };
  }
  return { success: true };
}
