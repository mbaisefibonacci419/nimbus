/**
 * ChatTransport Interface
 *
 * Provider-agnostic abstraction for sending messages to an LLM.
 * Implementation:
 *   - BYOKTransport → User's Anthropic API key, proxied through server
 */

import type { ChatContext, ChatMessage, ChatResponse } from '@nimbus/engine';

/**
 * Status of a ChatTransport — indicates readiness and loading progress.
 */
export interface ChatTransportStatus {
  /** Whether the transport is ready to send messages. */
  ready: boolean;
  /** The model identifier, if available. */
  model: string | null;
  /** Error message if the transport is not ready. */
  error?: string;
  /** Download/loading progress for LocalTransport. */
  progress?: { loaded: number; total: number; phase: string };
}

/** Callback receiving incremental text tokens during streaming. */
export type StreamDeltaCallback = (delta: string) => void;

/**
 * Unified interface for all AI transport modes.
 */
export interface ChatTransport {
  /** Human-readable name for display in the UI. */
  readonly displayName: string;

  /** The AI mode this transport implements. */
  readonly mode: 'private' | 'byok';

  /**
   * Send a message and get a structured response (batch mode).
   * The caller is responsible for PII scanning before calling this.
   */
  sendMessage(
    message: string,
    conversationHistory: ChatMessage[],
    context: ChatContext,
    signal?: AbortSignal,
  ): Promise<ChatResponse>;

  /**
   * Send a message via SSE streaming. Calls onDelta with each text token
   * as it arrives, then resolves with the final parsed ChatResponse.
   * Falls back to sendMessage if the transport doesn't support streaming.
   */
  sendMessageStream(
    message: string,
    conversationHistory: ChatMessage[],
    context: ChatContext,
    onDelta: StreamDeltaCallback,
    signal?: AbortSignal,
  ): Promise<ChatResponse>;

  /** Check if this transport is ready to use. */
  checkStatus(): Promise<ChatTransportStatus>;

  /** Release resources (e.g., WebLLM engine). */
  dispose?(): void;
}
