/**
 * Server configuration — reads from environment variables.
 * Loads `.env` from the repository root (see dotenv bootstrap below).
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../.env') });

export const config = {
  /** Maximum number of conversation history messages to forward to the LLM. */
  maxConversationHistory: 10,

  /** Maximum user message length (characters). */
  maxMessageLength: 4000,

  /** Rate limit: max requests per window per IP (BYOK mode — user pays). */
  byokRateLimitMax: 30,

  /** Rate limit: max batch classification requests per window per IP. */
  batchRateLimitMax: 10,

  /** Rate limit: max field extraction requests per window per IP. */
  extractRateLimitMax: 20,

  /** Rate limit window in milliseconds (1 minute). */
  rateLimitWindowMs: 60_000,

  /** Stripe Payment Links for tip jar (pre-configured in Stripe Dashboard). */
  tipLinkSmall: process.env.STRIPE_TIP_LINK_SMALL || '',
  tipLinkMedium: process.env.STRIPE_TIP_LINK_MEDIUM || '',
  tipLinkLarge: process.env.STRIPE_TIP_LINK_LARGE || '',

  /** Server-side Anthropic API key (used when the client omits apiKey). */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
};
