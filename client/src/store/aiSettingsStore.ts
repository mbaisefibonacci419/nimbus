/**
 * AI Settings Store — persisted Zustand store for AI mode preferences.
 *
 * Manages the user's AI mode selection (Private/BYOK), Anthropic API key,
 * model choice, and consent state.
 *
 * Security:
 *   - BYOK API keys are encrypted at rest using the vault passphrase (AES-256-GCM).
 *   - The encrypted blob is stored in localStorage['nimbus:ai-key-enc'].
 *   - The decrypted key is held in memory only while the vault is unlocked.
 *   - On lock, the in-memory key is cleared.
 *   - Keys are not persisted on our servers. For requests that use your own key,
 *     it is sent in the HTTPS body only for that call. When using a server-managed key,
 *     the client omits apiKey and the server uses ANTHROPIC_API_KEY — the browser never sees it.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AIMode,
  AISettings,
} from '@nimbus/engine';
import { DEFAULT_AI_SETTINGS } from '@nimbus/engine';
import {
  encrypt as encryptStr,
  decrypt as decryptStr,
  getActiveKey,
} from '../services/crypto';

const ENC_KEY_STORAGE = 'nimbus:ai-key-enc';

interface AISettingsState extends AISettings {
  // ── In-memory / runtime (not persisted) ──
  _decryptedApiKey: string;
  /** Whether GET /api/chat/status reported a server-side API key (refreshed on unlock). */
  serverKeyAvailable: boolean;

  // ── Actions ──────────────────────────────
  setMode: (mode: AIMode) => void;

  // BYOK
  setBYOKApiKey: (key: string) => void;
  setBYOKModel: (model: string) => void;
  setUseServerKey: (value: boolean) => void;
  clearBYOKKey: () => void;

  // Encryption lifecycle
  saveApiKeyEncrypted: (key: string) => Promise<void>;
  loadApiKey: () => Promise<void>;
  clearDecryptedKey: () => void;

  /** Probe server for ANTHROPIC_API_KEY; updates serverKeyAvailable and BYOK readiness. */
  checkServerKey: () => Promise<void>;

  // Consent
  acceptCloudConsent: () => void;
  revokeCloudConsent: () => void;

  // Reset
  resetToDefaults: () => void;
}

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set, get) => ({
      // ── Initial state from defaults ──
      ...DEFAULT_AI_SETTINGS,
      _decryptedApiKey: '',
      serverKeyAvailable: false,

      // ── Mode ──
      setMode: (mode) => {
        if (mode === 'private') {
          set({ mode: 'private', useServerKey: false });
          return;
        }
        const s = get();
        if (!s._decryptedApiKey && s.serverKeyAvailable) {
          set({ mode: 'byok', useServerKey: true, hasConsentedToCloudAI: true });
        } else {
          set({ mode: 'byok' });
        }
      },

      // ── BYOK ──
      setBYOKApiKey: (key) => {
        set({
          byokApiKey: '', // Clear plaintext from persisted state
          byokApiKeys: { anthropic: '' },
          _decryptedApiKey: key,
          useServerKey: false,
        });
        // Encrypt and save asynchronously
        get().saveApiKeyEncrypted(key);
      },
      setBYOKModel: (byokModel) => set({ byokModel }),
      setUseServerKey: (useServerKey) => set({ useServerKey }),
      clearBYOKKey: () => {
        const serverKeyAvailable = get().serverKeyAvailable;
        set({
          byokApiKey: '',
          byokApiKeys: { anthropic: '' },
          _decryptedApiKey: '',
          useServerKey: serverKeyAvailable,
        });
        localStorage.removeItem(ENC_KEY_STORAGE);
      },

      // ── Encryption lifecycle ──
      saveApiKeyEncrypted: async (key: string) => {
        const cryptoKey = getActiveKey();
        if (!cryptoKey || !key) return;
        try {
          const encrypted = await encryptStr(key, cryptoKey);
          localStorage.setItem(ENC_KEY_STORAGE, encrypted);
        } catch {
          console.warn('Failed to encrypt API key');
        }
      },

      loadApiKey: async () => {
        const cryptoKey = getActiveKey();
        if (!cryptoKey) return;

        // 1. If encrypted blob already exists, decrypt and load
        const encBlob = localStorage.getItem(ENC_KEY_STORAGE);
        if (encBlob) {
          try {
            const decrypted = await decryptStr(encBlob, cryptoKey);
            set({ _decryptedApiKey: decrypted });
          } catch {
            console.warn('Failed to decrypt API key');
          }
          return;
        }

        // 2. Migration: find old plaintext key from any source
        let oldKey = '';

        // Check the migration stash (set by v4→v5 migration before partialize ran)
        const migrateKey = localStorage.getItem('nimbus:ai-key-migrate');
        if (migrateKey) {
          oldKey = migrateKey;
        }

        // Check in-memory state (may still have it before first persist cycle)
        if (!oldKey) {
          const state = get();
          oldKey = state.byokApiKey || state.byokApiKeys?.anthropic || '';
        }

        // Check raw localStorage JSON (fallback)
        if (!oldKey) {
          try {
            const raw = localStorage.getItem('nimbus:ai-settings');
            if (raw) {
              const parsed = JSON.parse(raw);
              const s = parsed?.state || parsed;
              oldKey = s?.byokApiKey || s?.byokApiKeys?.anthropic || '';
            }
          } catch { /* corrupted — skip */ }
        }

        if (oldKey) {
          try {
            const encrypted = await encryptStr(oldKey, cryptoKey);
            localStorage.setItem(ENC_KEY_STORAGE, encrypted);
            set({ byokApiKey: '', byokApiKeys: { anthropic: '' }, _decryptedApiKey: oldKey });
          } catch { /* encryption failed */ }
          // Clean up migration stash
          localStorage.removeItem('nimbus:ai-key-migrate');
        }
      },

      clearDecryptedKey: () => {
        set({ _decryptedApiKey: '' });
      },

      checkServerKey: async () => {
        try {
          const base = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001';
          const res = await fetch(`${base}/api/chat/status`);
          const json = res.ok ? await res.json().catch(() => null) : null;
          const hasServerKey = Boolean(json?.data?.hasServerKey);
          set({ serverKeyAvailable: hasServerKey });
          const s = get();
          if (hasServerKey && !s._decryptedApiKey && s.useServerKey && s.mode !== 'private') {
            set({ mode: 'byok', hasConsentedToCloudAI: true });
          }
        } catch {
          set({ serverKeyAvailable: false });
        }
      },

      // ── Consent ──
      acceptCloudConsent: () => set({ hasConsentedToCloudAI: true }),
      revokeCloudConsent: () => set({ hasConsentedToCloudAI: false }),

      // ── Reset ──
      resetToDefaults: () => {
        localStorage.removeItem(ENC_KEY_STORAGE);
        set({ ...DEFAULT_AI_SETTINGS, _decryptedApiKey: '', serverKeyAvailable: false });
      },
    }),
    {
      name: 'nimbus:ai-settings',
      version: 6,
      // Exclude _decryptedApiKey, serverKeyAvailable, and plaintext keys from persistence
      partialize: (state) => {
        const { _decryptedApiKey, serverKeyAvailable, byokApiKey, byokApiKeys, ...rest } = state;
        return { ...rest, byokApiKey: '', byokApiKeys: { anthropic: '' } };
      },
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          const provider = persisted.byokProvider || 'anthropic';
          const key = persisted.byokApiKey || '';
          persisted.byokApiKeys = { anthropic: '', [provider]: key };
        }
        if (version < 3) {
          delete persisted.localModel;
        }
        if (version < 4) {
          persisted.mode = persisted.mode === 'paid' ? 'private' : persisted.mode;
          persisted.byokProvider = 'anthropic';
          persisted.byokApiKey = persisted.byokApiKeys?.anthropic || '';
          persisted.byokApiKeys = { anthropic: persisted.byokApiKeys?.anthropic || '' };
          persisted.byokModel = persisted.byokModel?.startsWith('claude-') ? persisted.byokModel : 'claude-haiku-4-5-20251001';
          delete persisted.paidProvider;
          delete persisted.paidSessionToken;
          delete persisted.paidSessionExpiry;
        }
        if (version < 5) {
          // v4 → v5: Stash the plaintext key in a separate localStorage key
          // before partialize strips it on the immediate re-persist.
          // loadApiKey() will pick this up and encrypt it on first unlock.
          const keyToMigrate = persisted.byokApiKey || persisted.byokApiKeys?.anthropic || '';
          if (keyToMigrate) {
            localStorage.setItem('nimbus:ai-key-migrate', keyToMigrate);
          }
        }
        if (version < 6) {
          // Preserve prior behavior for existing profiles: own-key BYOK unless opted in later.
          if (persisted.useServerKey === undefined) {
            persisted.useServerKey = false;
          }
        }
        return persisted;
      },
    },
  ),
);
