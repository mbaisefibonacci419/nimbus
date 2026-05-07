/**
 * BYOK Transport — sends messages via the server proxy using the user's Anthropic API key.
 *
 * The user's API key is sent in the request body (not a header) to avoid
 * appearing in access logs. The server uses it for a one-shot API call
 * and immediately discards it.
 *
 * Privacy: The server acts as a CORS proxy. It runs PII scanning as
 * defense-in-depth, but the client should scan first.
 */

import type { ChatContext, ChatMessage, ChatResponse, AIProvider } from '@nimbus/engine';
import { scanForPII } from '@nimbus/engine';
import type { ChatTransport, ChatTransportStatus, StreamDeltaCallback } from './types';
import { logOutboundRequest, consumePiiTypes, buildPiiBlockSummary } from '../privacyAuditLog';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001';
const TIMEOUT_MS = 120_000;

export class BYOKTransport implements ChatTransport {
  readonly displayName = 'BYOK (Your API Key)';
  readonly mode = 'byok' as const;

  constructor(
    private provider: AIProvider,
    private apiKey: string,
    private model: string,
  ) {}

  private buildRequestBody(
    message: string,
    conversationHistory: ChatMessage[],
    context: ChatContext,
  ) {
    return {
      message,
      conversationHistory,
      context,
      provider: this.provider,
      apiKey: this.apiKey,
      model: this.model,
    };
  }

  private createAbortController(signal?: AbortSignal): { controller: AbortController; timeoutId: ReturnType<typeof setTimeout> } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return { controller, timeoutId };
  }

  private logAuditTrail(message: string, context: ChatContext, responsePreview: string): void {
    logOutboundRequest({
      feature: 'chat',
      provider: this.provider,
      model: this.model,
      redactedMessage: message,
      piiBlocked: buildPiiBlockSummary(consumePiiTypes()),
      contextKeysSent: Object.keys(context).filter((k) => context[k as keyof ChatContext] != null),
      responseTruncated: scanForPII(responsePreview).sanitized,
    }).catch(() => {});
  }

  async sendMessage(
    message: string,
    conversationHistory: ChatMessage[],
    context: ChatContext,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const { controller, timeoutId } = this.createAbortController(signal);

    try {
      const res = await fetch(`${API_BASE}/api/chat/byok`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildRequestBody(message, conversationHistory, context)),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        const detail = errorBody?.error?.detail;
        const base = errorBody?.error?.message || `Server error (${res.status})`;
        throw new Error(detail ? `${base} ${detail}` : base);
      }

      const json = await res.json();
      const response = json.data as ChatResponse;

      this.logAuditTrail(message, context, response.message.slice(0, 200));
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async sendMessageStream(
    message: string,
    conversationHistory: ChatMessage[],
    context: ChatContext,
    onDelta: StreamDeltaCallback,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const { controller, timeoutId } = this.createAbortController(signal);

    try {
      const res = await fetch(`${API_BASE}/api/chat/byok/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildRequestBody(message, conversationHistory, context)),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        const detail = errorBody?.error?.detail;
        const base = errorBody?.error?.message || `Server error (${res.status})`;
        throw new Error(detail ? `${base} ${detail}` : base);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming not supported by this browser.');

      const decoder = new TextDecoder();
      let buffer = '';
      let finalResponse: ChatResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;

          try {
            const event = JSON.parse(payload);
            if (event.type === 'text_delta' && typeof event.delta === 'string') {
              onDelta(event.delta);
            } else if (event.type === 'response_complete' && event.data) {
              finalResponse = event.data as ChatResponse;
            } else if (event.type === 'error') {
              throw new Error(event.error?.message || 'Stream error from server');
            }
          } catch (parseErr: any) {
            if (parseErr.message?.includes('Stream error')) throw parseErr;
          }
        }
      }

      if (!finalResponse) {
        throw new Error('Stream ended without a complete response.');
      }

      this.logAuditTrail(message, context, finalResponse.message.slice(0, 200));
      return finalResponse;
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async checkStatus(): Promise<ChatTransportStatus> {
    if (!this.apiKey) {
      return {
        ready: false,
        model: null,
        error: 'No API key configured. Enter your Anthropic key in AI Settings.',
      };
    }

    if (!this.apiKey.startsWith('sk-ant-')) {
      return {
        ready: false,
        model: null,
        error: 'Invalid Anthropic API key format. Keys start with "sk-ant-".',
      };
    }

    return {
      ready: true,
      model: this.model,
    };
  }
}
