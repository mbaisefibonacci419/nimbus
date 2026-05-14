/**
 * Chat Store — Zustand store for the AI chat assistant.
 *
 * Manages chat messages, panel visibility, disclaimer state,
 * and the orchestration of sending messages → PII scanning →
 * building context → calling the active transport → displaying results.
 *
 * Chat history is encrypted and persisted per-return in localStorage
 * using the same AES-256-GCM key as the tax return data. Full history
 * is preserved for future conversation export as PDF tax records.
 */

import { create } from 'zustand';
import type { ChatAction, ChatOption, ChatResponse } from '@nimbus/engine';
import {
  sendChatMessage,
  sendChatMessageStream,
  checkChatStatus,
  checkForPII,
} from '../services/chatService';
import { stashPiiTypes } from '../services/privacyAuditLog';
import { buildChatContext } from '../services/chatContextBuilder';
import { detectLocalIntent } from '../services/localIntentDetector';
import {
  buildActionsFromExtraction,
  buildExtractionContextText,
} from '../services/documentToActions';
import {
  saveChatHistory,
  loadChatHistory,
  deleteChatHistory,
  toPersisted,
} from '../services/chatPersistence';
import { useTaxReturnStore, WIZARD_STEPS } from './taxReturnStore';
import { useAISettingsStore } from './aiSettingsStore';
import { useUndoStore } from './undoStore';
import { writeReturn } from '../api/client';
import { isImageFile } from '../hooks/useDocumentImport';
import {
  validateResponseGrounding,
  type GroundingDiscrepancy,
} from '../services/responseValidator';
import { extractPIIFields } from '@nimbus/engine';

// ─── Types ────────────────────────────────────────

/** Metadata for a document attached to a chat message. */
export interface ChatAttachment {
  /** Original file name (e.g., "W2-Acme.pdf"). */
  fileName: string;
  /** Whether this is a PDF or an image file. */
  fileType: 'pdf' | 'image';
  /** Extraction processing status. */
  status: 'extracting' | 'ocr-processing' | 'done' | 'error';
  /** Detected form type (after extraction). */
  formType?: string;
  /** Error message if extraction failed. */
  errorMessage?: string;
  /** OCR progress percentage (0–100). */
  ocrProgress?: number;
  /** OCR stage label. */
  ocrStage?: string;
}

export interface ChatMessageUI {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Proposed actions from LLM (assistant messages only). */
  actions?: ChatAction[];
  /** Whether actions have been applied by the user. */
  actionsApplied?: boolean;
  /** Whether actions were dismissed by the user. */
  actionsDismissed?: boolean;
  /** Human-readable summary after applying actions. */
  actionsSummary?: string;
  /** User feedback on this response (null = not rated). Session-only. */
  feedback?: 'up' | 'down' | null;
  /** Suggested follow-up questions from the LLM. */
  followUpChips?: string[];
  /** Structured selectable options (rendered as tappable pills). */
  options?: ChatOption[];
  /** When true, options support multi-select with a confirm button. */
  multiSelect?: boolean;
  /** Attached document metadata (user messages only). */
  attachment?: ChatAttachment;
  /** Post-response grounding check: dollar amounts vs current calculation. */
  verification?: {
    verified: boolean;
    discrepancies?: GroundingDiscrepancy[];
    footnote?: string;
  };
}

/** PII warning state for display in the chat UI. */
export interface PIIWarningState {
  /** Whether a PII warning is currently showing. */
  active: boolean;
  /** The original message that triggered the warning. */
  originalMessage: string;
  /** The sanitized version of the message. */
  sanitizedMessage: string;
  /** Human-readable warnings. */
  warnings: string[];
  /** Types of PII detected. */
  detectedTypes: string[];
}

interface ChatState {
  // ── State ────────────────────────────────
  messages: ChatMessageUI[];
  isOpen: boolean;
  isLoading: boolean;
  /** Accumulated streaming text while the LLM response is being received. */
  streamingContent: string | null;
  hasAcceptedDisclaimer: boolean;
  isAvailable: boolean;
  modelName: string | null;
  error: string | null;
  chatReturnId: string | null;
  /** PII warning state (shown when PII is detected in a message). */
  piiWarning: PIIWarningState | null;

  // ── Actions ──────────────────────────────
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  acceptDisclaimer: () => void;
  sendMessage: (text: string) => Promise<void>;
  /** Send a message that was sanitized after a PII warning. */
  sendSanitizedMessage: () => Promise<void>;
  /** Dismiss the PII warning without sending. */
  dismissPIIWarning: () => void;
  markActionsApplied: (messageId: string, summary: string) => void;
  markActionsDismissed: (messageId: string) => void;
  /** Undo applied actions for a message — restores the snapshot and resets message state. */
  undoActions: (messageId: string) => void;
  /** Set thumbs up/down feedback on a message. Clicking the same thumb toggles it off. */
  setMessageFeedback: (messageId: string, feedback: 'up' | 'down') => void;
  /** Re-send the last user message with fresh context, replacing the last assistant response. */
  regenerateLastResponse: () => Promise<void>;
  /** Edit a user message: truncate conversation from that point and re-send with new text. */
  editAndResend: (messageId: string, newText: string) => Promise<void>;
  /** Retry a user message: truncate from the following assistant response and re-send. */
  retryMessage: (messageId: string) => Promise<void>;
  /** Abort the in-flight message request (stop button / Esc). */
  abortMessage: () => void;
  clearHistory: () => void;
  clearError: () => void;
  checkAvailability: () => Promise<void>;
  hydrateForReturn: (returnId: string) => void;
  /** Open the chat panel and send a pre-filled prompt (used by "Guide Me" buttons).
   *  Optional extraContext is injected into formsReviewContext for the LLM. */
  openWithPrompt: (prompt: string, extraContext?: string) => Promise<void>;
  /** Attach a document (PDF/image), run extraction, and propose import actions. */
  sendDocumentMessage: (file: File) => Promise<void>;
  /** Insert an assistant message locally (no LLM). Used for proactive step-transition nudges. */
  injectProactiveMessage: (message: string, followUpChips?: string[], options?: ChatOption[]) => void;
  /** Persist a proactive nudge category to the return so it is not shown again. */
  dismissProactiveCategory: (category: string) => void;
}

// ─── Helpers ──────────────────────────────────────

let idCounter = 0;
function generateMessageId(): string {
  return `msg_${Date.now()}_${++idCounter}`;
}

/** Extra context stashed by openWithPrompt, consumed by _doSendMessage. */
let _pendingExtraContext: string | null = null;

/** Active AbortController for the in-flight LLM request. */
let _activeAbortController: AbortController | null = null;

/** Persist current messages to encrypted localStorage (fire-and-forget). */
function _persistMessages(get: () => ChatState): void {
  const { chatReturnId, messages } = get();
  if (!chatReturnId || messages.length === 0) return;
  saveChatHistory(chatReturnId, messages.map(toPersisted));
}

// ─── Store ────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  isLoading: false,
  streamingContent: null,
  hasAcceptedDisclaimer: true,
  isAvailable: false,
  modelName: null,
  error: null,
  chatReturnId: null,
  piiWarning: null,

  togglePanel: () => set({ isOpen: !get().isOpen }),
  openPanel: () => set({ isOpen: true }),
  closePanel: () => set({ isOpen: false }),

  acceptDisclaimer: () => set({ hasAcceptedDisclaimer: true }),

  abortMessage: () => {
    if (_activeAbortController) {
      _activeAbortController.abort();
      _activeAbortController = null;
    }
    set({ isLoading: false, streamingContent: null });
  },

  hydrateForReturn: (returnId: string) => {
    _transitionShownForSkills.clear();
    set({ chatReturnId: returnId, messages: [], error: null, piiWarning: null });
    // Load persisted history async — messages appear once decrypted
    loadChatHistory(returnId).then((persisted) => {
      // Only apply if we're still on the same return
      if (get().chatReturnId !== returnId) return;
      if (persisted.length > 0) {
        set({ messages: persisted as ChatMessageUI[] });
      }
    });
  },

  clearHistory: () => {
    const returnId = get().chatReturnId;
    _transitionShownForSkills.clear();
    set({ messages: [], error: null, piiWarning: null });
    if (returnId) deleteChatHistory(returnId);
  },
  clearError: () => set({ error: null }),

  checkAvailability: async () => {
    try {
      const status = await checkChatStatus();
      set({ isAvailable: status.enabled, modelName: status.model });
    } catch {
      set({ isAvailable: false, modelName: null });
    }
  },

  dismissPIIWarning: () => set({ piiWarning: null }),

  sendMessage: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || get().isLoading) return;

    const aiMode = useAISettingsStore.getState().mode;

    // ── PII Scanning (primary gate) ──
    // In Private mode, PII scanning is informational only (data stays local).
    // In BYOK modes, block and show warning if PII detected.
    if (aiMode !== 'private') {
      const piiResult = checkForPII(trimmed);
      if (piiResult.hasPII) {
        set({
          piiWarning: {
            active: true,
            originalMessage: trimmed,
            sanitizedMessage: piiResult.sanitized,
            warnings: piiResult.warnings,
            detectedTypes: piiResult.detectedTypes,
          },
        });
        return; // Don't send — show warning and let user decide
      }
    }

    // No PII detected (or Private mode) — send directly
    await _doSendMessage(trimmed, set, get);
  },

  sendSanitizedMessage: async () => {
    const warning = get().piiWarning;
    if (!warning) return;

    // Stash PII types so the transport can include them in the audit log
    stashPiiTypes(warning.detectedTypes);

    // Extract structured field values from the ORIGINAL message (before
    // sanitization) and apply them directly to the local tax return.
    // This lets the section progress even though the LLM never sees the PII.
    const { fields, llmHint } = extractPIIFields(
      warning.originalMessage,
      warning.detectedTypes,
    );

    if (fields.length > 0) {
      const taxStore = useTaxReturnStore.getState();
      for (const f of fields) {
        taxStore.updateField(f.field, f.value);
      }
    }

    set({ piiWarning: null });

    // Send the sanitized message + hint so the LLM knows not to re-ask
    const messageForLLM = warning.sanitizedMessage + llmHint;
    await _doSendMessage(messageForLLM, set, get);
  },

  markActionsApplied: (messageId: string, summary: string) => {
    set({
      messages: get().messages.map((m) =>
        m.id === messageId
          ? { ...m, actionsApplied: true, actionsSummary: summary }
          : m,
      ),
    });
    _persistMessages(get);

    // Agent mode: check if the active skill is now complete and advance
    _maybeAdvanceAgentSkill(get);
  },

  markActionsDismissed: (messageId: string) => {
    set({
      messages: get().messages.map((m) =>
        m.id === messageId ? { ...m, actionsDismissed: true } : m,
      ),
    });
    _persistMessages(get);
  },

  undoActions: (messageId: string) => {
    const snapshot = useUndoStore.getState().getSnapshot(messageId);
    if (!snapshot) return;

    writeReturn(snapshot);
    useTaxReturnStore.getState().setReturn(snapshot);

    set({
      messages: get().messages.map((m) =>
        m.id === messageId
          ? { ...m, actionsApplied: false, actionsSummary: undefined }
          : m,
      ),
    });
    _persistMessages(get);
    useUndoStore.getState().removeSnapshot(messageId);
  },

  setMessageFeedback: (messageId: string, feedback: 'up' | 'down') => {
    set({
      messages: get().messages.map((m) =>
        m.id === messageId
          ? { ...m, feedback: m.feedback === feedback ? null : feedback }
          : m,
      ),
    });
    _persistMessages(get);
  },

  regenerateLastResponse: async () => {
    const state = get();
    if (state.isLoading) return;

    // Find the last assistant message
    const msgs = state.messages;
    let assistantIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') { assistantIdx = i; break; }
    }
    if (assistantIdx === -1) return;

    // Find the user message that prompted it
    let userIdx = -1;
    for (let i = assistantIdx - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { userIdx = i; break; }
    }
    if (userIdx === -1) return;

    const userText = msgs[userIdx].content;

    // Remove the assistant response (keep everything before it)
    set({ messages: msgs.slice(0, assistantIdx) });
    _persistMessages(get);

    // Re-send with fresh context (tax data may have changed)
    await _doSendMessage(userText, set, get);
  },

  editAndResend: async (messageId: string, newText: string) => {
    const state = get();
    if (state.isLoading) return;

    const msgs = state.messages;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1 || msgs[idx].role !== 'user') return;

    // Truncate everything from this message onward
    set({ messages: msgs.slice(0, idx) });
    _persistMessages(get);

    // Send the edited text as a new message
    await _doSendMessage(newText.trim(), set, get);
  },

  retryMessage: async (messageId: string) => {
    const state = get();
    if (state.isLoading) return;

    const msgs = state.messages;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1 || msgs[idx].role !== 'user') return;

    const userText = msgs[idx].content;

    // Keep the user message, remove everything after it
    set({ messages: msgs.slice(0, idx + 1) });
    _persistMessages(get);

    // Re-send with fresh context
    await _doSendMessage(userText, set, get);
  },

  openWithPrompt: async (prompt: string, extraContext?: string) => {
    // Open the panel and auto-accept disclaimer so the prompt sends immediately
    set({ isOpen: true, hasAcceptedDisclaimer: true });
    // Stash extra context for _doSendMessage to pick up
    if (extraContext) {
      _pendingExtraContext = extraContext;
    }
    // Small delay to let the panel render before sending
    await new Promise((r) => setTimeout(r, 50));
    await get().sendMessage(prompt);
  },

  sendDocumentMessage: async (file: File) => {
    if (get().isLoading) return;

    const isImage = isImageFile(file);
    const fileType: 'pdf' | 'image' = isImage ? 'image' : 'pdf';

    // Create user message with attachment in "extracting" state
    const userMsg: ChatMessageUI = {
      id: generateMessageId(),
      role: 'user',
      content: `Attached: ${file.name}`,
      timestamp: Date.now(),
      attachment: {
        fileName: file.name,
        fileType,
        status: 'extracting',
      },
    };

    set({ messages: [...get().messages, userMsg], isLoading: true, error: null });

    // Helper to update the attachment status on the user message
    const updateAttachment = (patch: Partial<ChatAttachment>) => {
      set({
        messages: get().messages.map((m) =>
          m.id === userMsg.id
            ? { ...m, attachment: { ...m.attachment!, ...patch } }
            : m,
        ),
      });
    };

    // OCR progress callback
    const onProgress = (stage: string, pct: number) => {
      updateAttachment({ status: 'ocr-processing', ocrStage: stage, ocrProgress: Math.round(pct) });
    };

    try {
      const { extractPDFServerSide } = await import('../services/aiExtractionService');
      const { extractFromPDF, extractFromPDFWithOCR, extractFromImage, FORM_TYPE_LABELS, INCOME_TYPE_STEP_MAP } =
        await import('../services/pdfImporter');

      let extractedFields: Record<string, { value: string | number | boolean; confidence: string }> = {};
      let formType = '';
      let formTypeConfidence: 'high' | 'medium' | 'low' = 'low';
      let extractionMethod = 'local';
      let localResult: import('../services/pdfImporter').PDFExtractResult | null = null;

      if (isImage) {
        localResult = await extractFromImage(file, onProgress);
      } else {
        // Try server-side Docling/Vision extraction first (best quality)
        const settings = useAISettingsStore.getState();
        const apiKeyForRequest = settings._decryptedApiKey || undefined;
        try {
          const serverResult = await extractPDFServerSide(
            file,
            null,
            settings.byokModel || 'claude-sonnet-4-6',
            apiKeyForRequest,
          );
          if (serverResult && Object.keys(serverResult.fields).length > 0) {
            extractedFields = serverResult.fields;
            formType = serverResult.formType || '';
            formTypeConfidence = serverResult.formTypeConfidence || 'low';
            extractionMethod = serverResult.method || 'docling';
          }
        } catch (serverErr) {
          console.warn('[chat] Server-side PDF extraction failed, falling back to local', serverErr);
        }

        // Fall back to local pdfjs-dist extraction if server extraction didn't work
        if (Object.keys(extractedFields).length === 0) {
          localResult = await extractFromPDF(file);
          if (localResult.ocrAvailable && (localResult.confidence === 'low' || !localResult.formType)) {
            updateAttachment({ status: 'ocr-processing', ocrStage: 'loading', ocrProgress: 0 });
            localResult = await extractFromPDFWithOCR(file, onProgress);
          }
        }
      }

      // Build unified extraction result for chat response generation
      let response: ChatResponse;
      const aiMode = useAISettingsStore.getState().mode;

      if (Object.keys(extractedFields).length > 0) {
        // Server-side extraction succeeded — build response from fields
        updateAttachment({ status: 'done', formType: formType || undefined });

        const dataForActions: Record<string, unknown> = {};
        for (const [key, field] of Object.entries(extractedFields)) {
          dataForActions[key] = field.value;
        }

        // Map form type to income type
        const FORM_TO_INCOME: Record<string, string> = {
          'W-2': 'w2', '1099-INT': '1099int', '1099-DIV': '1099div', '1099-R': '1099r',
          '1099-NEC': '1099nec', '1099-MISC': '1099misc', '1099-G': '1099g', '1099-B': '1099b',
          '1099-K': '1099k', 'SSA-1099': 'ssa1099', '1099-SA': '1099sa', '1099-Q': '1099q',
          '1098': '1098', '1098-T': '1098t', '1098-E': '1098e', '1095-A': '1095a',
          'K-1': 'k1', 'W-2G': 'w2g', '1099-C': '1099c', '1099-S': '1099s',
        };
        const incomeType = FORM_TO_INCOME[formType] || null;

        if (aiMode === 'private' || !incomeType) {
          // Build a synthetic response
          const actions: import('@nimbus/engine').ChatAction[] = [];
          if (incomeType) {
            actions.push({ type: 'add_income', incomeType, fields: dataForActions });
          }

          const formLabel = formType ? (FORM_TYPE_LABELS[formType as keyof typeof FORM_TYPE_LABELS] || formType) : 'document';
          const payerInfo = dataForActions.employerName || dataForActions.payerName || '';
          const confNote = formTypeConfidence !== 'high' ? ` (${formTypeConfidence} confidence — please verify)` : '';
          const msg = actions.length > 0
            ? `I extracted data from your **${formLabel}**${payerInfo ? ` from **${payerInfo}**` : ''}${confNote} using AI-powered document analysis. Review the proposed changes below.`
            : `I analyzed your document but couldn't determine the form type. Please try the Import Documents panel for better results.`;

          response = {
            message: msg,
            actions,
            suggestedStep: incomeType ? (INCOME_TYPE_STEP_MAP[incomeType] || null) : null,
            followUpChips: actions.length > 0
              ? ['What step should I go to next?', 'Import another document']
              : ['Try importing again', 'Enter this data manually'],
          };
        } else {
          // BYOK: send the extracted fields to the LLM for a richer response
          const fieldLines = Object.entries(extractedFields).map(([key, f]) => {
            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s: string) => s.toUpperCase());
            const val = typeof f.value === 'number' ? `$${f.value.toLocaleString()}` : String(f.value);
            return `  ${label}: ${val} (${f.confidence})`;
          }).join('\n');
          const summary = `Form type: ${formType} (${formTypeConfidence} confidence)\nExtracted fields:\n${fieldLines}`;
          const piiCheck = checkForPII(summary);
          const safeSummary = piiCheck.hasPII ? piiCheck.sanitized : summary;

          const llmMessage = `I've attached a tax document (${file.name}). Here's what was extracted via AI-powered analysis:\n\n${safeSummary}\n\nPlease review this and propose add_income actions to import this into my return. If any values look wrong or suspicious, flag them.`;

          const taxStore = useTaxReturnStore.getState();
          const currentStep = taxStore.getCurrentStep();
          const visibleSteps = taxStore.getVisibleSteps();
          const activeToolId = taxStore.activeToolId;
          const stepId = activeToolId || currentStep?.id || 'unknown';
          const section = activeToolId ? 'tools' : (currentStep?.section || 'unknown');
          const context = buildChatContext(taxStore.taxReturn, stepId, section, taxStore.calculation, visibleSteps, WIZARD_STEPS);
          context.documentExtractionContext = safeSummary;

          const history = get().messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content }))
            .filter((m) => m.content.length > 0 && m.content.length <= 20_000);

          _activeAbortController = new AbortController();
          set({ streamingContent: '' });
          response = await sendChatMessageStream(
            llmMessage,
            history,
            context,
            (delta) => {
              const current = get().streamingContent ?? '';
              set({ streamingContent: current + delta });
            },
            _activeAbortController.signal,
          );
          _activeAbortController = null;
        }
      } else if (localResult) {
        // Local extraction result — use existing logic
        updateAttachment({ status: 'done', formType: localResult.formType || undefined });

        if (aiMode === 'private') {
          response = buildActionsFromExtraction(localResult);
        } else {
          const rawSummary = buildExtractionContextText(localResult);
          const piiCheck = checkForPII(rawSummary);
          const extractionSummary = piiCheck.hasPII ? piiCheck.sanitized : rawSummary;
          const llmMessage = `I've attached a tax document (${file.name}). Here's what was extracted:\n\n${extractionSummary}\n\nPlease review this and propose add_income actions to import this into my return.`;

          const taxStore = useTaxReturnStore.getState();
          const currentStep = taxStore.getCurrentStep();
          const visibleSteps = taxStore.getVisibleSteps();
          const activeToolId = taxStore.activeToolId;
          const stepId = activeToolId || currentStep?.id || 'unknown';
          const section = activeToolId ? 'tools' : (currentStep?.section || 'unknown');
          const context = buildChatContext(taxStore.taxReturn, stepId, section, taxStore.calculation, visibleSteps, WIZARD_STEPS);
          context.documentExtractionContext = extractionSummary;

          const history = get().messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content }))
            .filter((m) => m.content.length > 0 && m.content.length <= 20_000);

          _activeAbortController = new AbortController();
          set({ streamingContent: '' });
          response = await sendChatMessageStream(
            llmMessage,
            history,
            context,
            (delta) => {
              const current = get().streamingContent ?? '';
              set({ streamingContent: current + delta });
            },
            _activeAbortController.signal,
          );
          _activeAbortController = null;
        }
      } else {
        throw new Error('Could not extract data from this document. Please try a different file.');
      }

      // Add assistant response with actions
      const assistantMsg: ChatMessageUI = {
        id: generateMessageId(),
        role: 'assistant',
        content: response.message,
        timestamp: Date.now(),
        actions:
          response.actions && response.actions.length > 0
            ? response.actions.filter((a) => a.type !== 'no_action')
            : undefined,
        followUpChips: response.followUpChips,
        options: response.options,
        multiSelect: response.multiSelect,
      };

      set({ messages: [...get().messages, assistantMsg], isLoading: false, streamingContent: null });
      _persistMessages(get);

      if (
        response.suggestedStep &&
        (!response.actions || response.actions.every((a) => a.type === 'no_action'))
      ) {
        useTaxReturnStore.getState().goToStep(response.suggestedStep);
      }
    } catch (err: any) {
      _activeAbortController = null;
      updateAttachment({ status: 'error', errorMessage: err.message });
      set({
        isLoading: false,
        streamingContent: null,
        error: `Document extraction failed: ${err.message || 'Unknown error'}`,
      });
    }
  },

  injectProactiveMessage: (message: string, followUpChips?: string[], options?: ChatOption[]) => {
    const assistantMsg: ChatMessageUI = {
      id: generateMessageId(),
      role: 'assistant',
      content: message,
      timestamp: Date.now(),
      ...(followUpChips && followUpChips.length > 0 ? { followUpChips } : {}),
      ...(options && options.length > 0 ? { options } : {}),
    };
    set({ messages: [...get().messages, assistantMsg] });
    _persistMessages(get);
  },

  dismissProactiveCategory: (category: string) => {
    const tr = useTaxReturnStore.getState().taxReturn;
    if (!tr) return;
    const key = `proactive:${category}`;
    const current = tr.dismissedNudges || [];
    if (current.includes(key)) return;
    useTaxReturnStore.getState().updateField('dismissedNudges', [...current, key]);
  },
}));

// ─── Internal Send Logic ─────────────────────────

async function _doSendMessage(
  text: string,
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  // Bump the version counter to invalidate any pending _maybeAdvanceAgentSkill timeout.
  _agentStateVersion++;

  // Add user message
  const userMsg: ChatMessageUI = {
    id: generateMessageId(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
  };

  const updatedWithUser = [...get().messages, userMsg];
  set({ messages: updatedWithUser, isLoading: true, error: null });

  try {
    // ── Local intent detection (bypasses LLM for simple deterministic actions) ──
    const localResponse = detectLocalIntent(text);
    if (localResponse) {
      const assistantMsg: ChatMessageUI = {
        id: generateMessageId(),
        role: 'assistant',
        content: localResponse.message,
        timestamp: Date.now(),
        actions:
          localResponse.actions && localResponse.actions.length > 0
            ? localResponse.actions.filter((a) => a.type !== 'no_action')
            : undefined,
        followUpChips: localResponse.followUpChips,
      };
      set({ messages: [...get().messages, assistantMsg], isLoading: false });
      _persistMessages(get);
      return;
    }

    // Build conversation history (last 10, excluding the just-added user message)
    // Guard: filter out any messages with missing/oversized content (server caps at 20k)
    const allMsgs = get().messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const history = allMsgs
      .slice(0, -1)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }))
      .filter((m) => typeof m.content === 'string' && m.content.length > 0 && m.content.length <= 20_000);

    // Build PII-safe context from current tax return state
    const taxStore = useTaxReturnStore.getState();
    const currentStep = taxStore.getCurrentStep();
    const visibleSteps = taxStore.getVisibleSteps();

    // Use activeToolId when a tool view is open — otherwise the AI
    // thinks the user is on whatever wizard step they were last on.
    const activeToolId = taxStore.activeToolId;
    const stepId = activeToolId || currentStep?.id || 'unknown';
    const section = activeToolId ? 'tools' : (currentStep?.section || 'unknown');

    const context = buildChatContext(
      taxStore.taxReturn,
      stepId,
      section,
      taxStore.calculation,
      visibleSteps,
      WIZARD_STEPS,
    );

    // Inject extra context from openWithPrompt (e.g., Forms Mode review data)
    if (_pendingExtraContext) {
      context.formsReviewContext = _pendingExtraContext;
      _pendingExtraContext = null;
    }

    // Agent mode: always use the orchestrator-built system prompt
    if (taxStore.viewMode === 'agent' && taxStore.taxReturn) {
      const { AgentOrchestrator, createInitialAgentState } = await import('../services/agent/AgentOrchestrator');
      const { SKILL_REGISTRY } = await import('../services/agent/SkillRegistry');
      const savedState = (taxStore.taxReturn as unknown as Record<string, unknown>)?.agentState;
      const agentState = (savedState as import('../services/agent/AgentOrchestrator').AgentState) ?? createInitialAgentState();
      const orchestrator = new AgentOrchestrator(agentState);

      // Sync completion from existing return data
      orchestrator.syncCompletionFromReturn(taxStore.taxReturn);

      // If no skill is active, select and activate the next one
      if (!orchestrator.getState().activeSkill) {
        const nextSkill = orchestrator.selectNextSkill(taxStore.taxReturn);
        if (nextSkill) {
          orchestrator.activateSkill(nextSkill);
        }
      }

      // Check for topic switch based on user message
      const detour = orchestrator.handleTopicSwitch(text, taxStore.taxReturn);
      if (detour) {
        orchestrator.activateSkill(detour);
      }

      const skillId = orchestrator.getState().activeSkill;
      const entry = skillId ? SKILL_REGISTRY.find(s => s.id === skillId) : null;
      const skillPromptText = entry
        ? `You are helping the user with: ${entry.domain}. Guide them through this topic conversationally. When you present choices (filing status, yes/no questions, income types), include an "options" array in your JSON response with structured choices as {label, value, description} objects so the UI renders tappable pills instead of expecting the user to type.`
        : 'No specific skill is active. Ask the user what they would like to work on and present options as tappable pills.';

      context.agentMode = true;
      context.agentSystemPrompt = orchestrator.buildPrompt(
        taxStore.taxReturn,
        taxStore.calculation ?? null,
        skillPromptText,
      );

      // Record the turn and persist agent state back to the tax return
      orchestrator.recordTurn();
      taxStore.updateField('agentState', orchestrator.getState());
    }

    // Create AbortController for this request (enables stop button)
    _activeAbortController = new AbortController();

    // Stream response — tokens arrive incrementally via onDelta callback
    set({ streamingContent: '' });
    const response: ChatResponse = await sendChatMessageStream(
      text,
      history,
      context,
      (delta) => {
        const current = get().streamingContent ?? '';
        set({ streamingContent: current + delta });
      },
      _activeAbortController.signal,
    );

    // Add assistant response (final, complete version from parsed JSON)
    const grounding = validateResponseGrounding(
      response.message,
      useTaxReturnStore.getState().calculation ?? null,
    );

    const assistantMsg: ChatMessageUI = {
      id: generateMessageId(),
      role: 'assistant',
      content: response.message,
      timestamp: Date.now(),
      actions:
        response.actions && response.actions.length > 0
          ? response.actions.filter((a) => a.type !== 'no_action')
          : undefined,
      followUpChips: response.followUpChips,
      options: response.options,
      multiSelect: response.multiSelect,
      ...(grounding.footnote
        ? {
            verification: {
              verified: grounding.verified,
              discrepancies: grounding.discrepancies,
              footnote: grounding.footnote,
            },
          }
        : {}),
    };

    const updatedWithAssistant = [...get().messages, assistantMsg];
    _activeAbortController = null;
    set({ messages: updatedWithAssistant, isLoading: false, streamingContent: null });
    _persistMessages(get);

    // Handle navigation suggestion
    if (
      response.suggestedStep &&
      (!response.actions || response.actions.every((a) => a.type === 'no_action'))
    ) {
      useTaxReturnStore.getState().goToStep(response.suggestedStep);
    }

    // Agent mode: check if the response (without explicit actions) completed the skill
    // e.g., user said "No W-2s" → discovery flag set → skill complete
    if (!response.actions || response.actions.length === 0 || response.actions.every((a) => a.type === 'no_action')) {
      _maybeAdvanceAgentSkill(get);
    }
  } catch (err: any) {
    _activeAbortController = null;
    if (err.name === 'AbortError') {
      set({ isLoading: false, streamingContent: null });
      return;
    }
    set({
      isLoading: false,
      streamingContent: null,
      error: err.message || 'Something went wrong. Please try again.',
    });
  }
}

// ─── Agent Mode Proactive Advancement ────────────

/** Track which skills have already had a transition message injected. */
const _transitionShownForSkills = new Set<string>();

/**
 * After actions are applied or a no-action response completes,
 * check if there's a next incomplete skill to advance to and
 * inject a proactive transition message with option pills.
 */
/** Monotonic version counter to prevent stale _maybeAdvanceAgentSkill writes. */
let _agentStateVersion = 0;

function _maybeAdvanceAgentSkill(get: () => ChatState): void {
  const taxStore = useTaxReturnStore.getState();
  if (taxStore.viewMode !== 'agent' || !taxStore.taxReturn) return;

  // Capture the version at call time; if _doSendMessage fires before the
  // timeout, it bumps the version and this invocation becomes a no-op.
  const capturedVersion = ++_agentStateVersion;

  // Delay to let the Zustand store settle after action application
  setTimeout(async () => {
    // Abort if a newer _doSendMessage or _maybeAdvanceAgentSkill has fired
    if (capturedVersion !== _agentStateVersion) return;

    try {
      const { AgentOrchestrator, createInitialAgentState } = await import('../services/agent/AgentOrchestrator');

      const tr = useTaxReturnStore.getState().taxReturn;
      if (!tr) return;

      // Resume from persisted agent state (or initialize fresh if first entry)
      const savedState = (tr as unknown as Record<string, unknown>)?.agentState as
        import('../services/agent/AgentOrchestrator').AgentState | undefined;
      const orchestrator = new AgentOrchestrator(savedState ?? createInitialAgentState());
      orchestrator.syncCompletionFromReturn(tr);

      // Find the next incomplete skill
      const nextSkill = orchestrator.selectNextSkill(tr);

      // Don't re-inject a transition for a skill the user already saw
      if (nextSkill && _transitionShownForSkills.has(nextSkill)) return;

      if (nextSkill) {
        orchestrator.activateSkill(nextSkill);
      }

      const transition = orchestrator.buildTransitionMessage(tr);
      if (!transition) return;

      if (nextSkill) {
        _transitionShownForSkills.add(nextSkill);
      }

      // Persist updated agent state — but only if no newer write has occurred
      if (capturedVersion === _agentStateVersion) {
        useTaxReturnStore.getState().updateField('agentState', orchestrator.getState());
      }

      const chatStore = useChatStore.getState();
      const options = transition.options as ChatOption[] | undefined;
      chatStore.injectProactiveMessage(transition.message, undefined, options);
    } catch (err) {
      console.warn('[agent] Proactive advancement failed:', err);
    }
  }, 800);
}
