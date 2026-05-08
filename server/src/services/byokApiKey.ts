/**
 * Resolve and validate Anthropic API keys for BYOK routes.
 * Prefers a client-provided key; falls back to server ANTHROPIC_API_KEY.
 */

import { config } from '../config.js';

export function resolveBYOKAnthropicKey(clientKeyFromBody: string): {
  apiKey: string;
  trimmedClientKey: string;
} {
  const trimmedClientKey = clientKeyFromBody.trim();
  const apiKey = trimmedClientKey || config.anthropicApiKey;
  return { apiKey, trimmedClientKey };
}

export type ByokKeyValidation =
  | { ok: true }
  | { ok: false; code: 'NO_API_KEY' | 'INVALID_API_KEY'; message: string };

export function validateBYOKAnthropicKey(
  trimmedClientKey: string,
  resolvedApiKey: string,
): ByokKeyValidation {
  if (!resolvedApiKey) {
    return { ok: false, code: 'NO_API_KEY', message: 'No API key configured.' };
  }
  if (trimmedClientKey && !trimmedClientKey.startsWith('sk-ant-')) {
    return {
      ok: false,
      code: 'INVALID_API_KEY',
      message: 'Invalid Anthropic API key format. Keys start with "sk-ant-".',
    };
  }
  return { ok: true };
}
