/**
 * AI Settings Types — shared between server and client.
 *
 * Defines the two AI modes (Private, BYOK) and the settings shape
 * persisted in localStorage.
 *
 * Private Mode: full tax preparation with zero data leaving the device.
 * All deterministic features work (engine, warnings, suggestions, nudges,
 * deduction finder patterns, audit risk, document import). No LLM chat.
 *
 * BYOK Mode: Anthropic API key for AI chat — yours (encrypted locally) or server-managed
 * when useServerKey is true.
 */

// ─── AI Modes ─────────────────────────────────────

/** The two AI assistant operating modes. */
export type AIMode = 'private' | 'byok';

/** Cloud LLM provider supported for BYOK mode. */
export type AIProvider = 'anthropic';

// ─── Settings Shape ───────────────────────────────

/** AI settings persisted in localStorage. */
export interface AISettings {
  /** Active AI mode. */
  mode: AIMode;

  // ── BYOK settings ──
  /** Cloud provider for BYOK mode (always Anthropic). */
  byokProvider: AIProvider;
  /** User's Anthropic API key. */
  byokApiKey: string;
  /** Per-provider API keys (Anthropic only). */
  byokApiKeys: Record<AIProvider, string>;
  /** Model to use with the BYOK provider. */
  byokModel: string;

  // ── Consent ──
  /** Whether user has accepted the data consent for cloud AI modes. */
  hasConsentedToCloudAI: boolean;

  /**
   * When true (default), API requests omit the user's key and the server uses
   * ANTHROPIC_API_KEY. Set false when the user saves their own key.
   */
  useServerKey: boolean;
}

/** Default AI settings for new users. */
export const DEFAULT_AI_SETTINGS: AISettings = {
  mode: 'byok',
  byokProvider: 'anthropic',
  byokApiKey: '',
  byokApiKeys: { anthropic: '' },
  byokModel: 'claude-sonnet-4-6',
  hasConsentedToCloudAI: true,
  useServerKey: true,
};
