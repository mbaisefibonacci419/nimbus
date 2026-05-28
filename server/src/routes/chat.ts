/**
 * Chat Routes — POST /api/chat/byok, POST /api/chat/byok/stream, GET /api/chat/status
 *
 * BYOK mode — client may provide an Anthropic API key, or omit it when the server
 * is configured with ANTHROPIC_API_KEY (server-managed key; never exposed to the client).
 *
 * The POST endpoint strips PII as defense-in-depth (client should scan first),
 * then forwards to Anthropic.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { stripPII, stripConversationHistory, stripContext } from '../services/piiStripper.js';
import { anthropicCompletionWithKey, anthropicStreamWithKey } from '../services/anthropicClient.js';
import { config } from '../config.js';
import { resolveBYOKAnthropicKey, validateBYOKAnthropicKey } from '../services/byokApiKey.js';
import { buildSystemPrompt } from '../services/systemPrompt.js';
import { handleLLMError, handleRouteError, sanitizeLLMErrorMessage, scrubSecrets } from '../services/errorSanitizer.js';
import { initRateLimitTable, checkRateLimit as sharedCheckRateLimit, getClientIp, sendRateLimitResponse } from '../services/rateLimiter.js';
import type { ChatResponse } from '@nimbus/engine';

const router = Router();

// Initialize rate limit table on module load
try {
  initRateLimitTable();
} catch (err) {
  console.error('[chat] Failed to initialize rate limit table:', err);
}

// ─── Request Validation ────────────────────────────

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  // User input is capped at maxMessageLength (4000), but assistant responses
  // in conversation history can be much longer — don't reject valid history.
  content: z.string().max(20_000),
});

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(config.maxMessageLength),
  conversationHistory: z.array(MessageSchema).max(config.maxConversationHistory).default([]),
  context: z.record(z.unknown()).default({}),
});

const BYOKRequestSchema = ChatRequestSchema.extend({
  provider: z.literal('anthropic'),
  apiKey: z.string().max(200).optional().default(''),
  model: z.string().min(1).max(100),
});

// ─── Shared PII + Message Preparation ─────────────

function prepareMessages(
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
  context: Record<string, unknown>,
) {
  const { sanitized: sanitizedMessage } = stripPII(message);
  const sanitizedHistory = stripConversationHistory(conversationHistory);
  const sanitizedContext = stripContext(context);

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...sanitizedHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: sanitizedMessage },
  ];

  return { messages, sanitizedContext };
}

// ─── Routes ────────────────────────────────────────

/**
 * GET /api/chat/status
 * Returns whether the chat feature is available.
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    data: {
      enabled: false, // No server-side product AI — BYOK / proxy only
      model: null,
      byokEnabled: true,
      hasServerKey: Boolean(config.anthropicApiKey),
    },
  });
});

/**
 * POST /api/chat/byok
 * BYOK mode — uses the user's Anthropic API key. Key is used once and discarded.
 *
 * The user's API key is in the request body (not a header) to avoid
 * appearing in access logs. It is NEVER stored, logged, or cached.
 */
router.post('/byok', async (req: Request, res: Response) => {
  try {
    // 1. Rate limit (slightly higher for BYOK — user pays for their own tokens)
    const clientIp = getClientIp(req);
    if (!clientIp) {
      res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } });
      return;
    }
    if (!sharedCheckRateLimit(clientIp, 'chat', config.byokRateLimitMax, config.rateLimitWindowMs)) {
      sendRateLimitResponse(res, 'Too many requests. Please wait a moment and try again.', Math.ceil(config.rateLimitWindowMs / 1000));
      return;
    }

    // 2. Validate request body
    const parseResult = BYOKRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      // Debug: log field sizes to diagnose validation failures (no sensitive data)
      const body = req.body || {};
      console.error('[BYOK validation failed]', {
        messageLength: typeof body.message === 'string' ? body.message.length : typeof body.message,
        historyLength: Array.isArray(body.conversationHistory) ? body.conversationHistory.length : 0,
        historyContentLengths: Array.isArray(body.conversationHistory)
          ? body.conversationHistory.map((m: any) => m?.content?.length ?? 0)
          : [],
        provider: body.provider,
        model: body.model,
        issues: parseResult.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
      res.status(400).json({
        error: {
          message: 'Invalid request body.',
          code: 'VALIDATION_ERROR',
          detail: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      });
      return;
    }

    const { message, conversationHistory, context, apiKey: clientKeyField, model } =
      parseResult.data;

    const { apiKey, trimmedClientKey } = resolveBYOKAnthropicKey(clientKeyField);
    const keyValidation = validateBYOKAnthropicKey(trimmedClientKey, apiKey);
    if (!keyValidation.ok) {
      res.status(400).json({
        error: {
          message: keyValidation.message,
          code: keyValidation.code,
        },
      });
      return;
    }

    // 4. Prepare messages (PII strip as defense-in-depth)
    const { messages, sanitizedContext } = prepareMessages(
      message,
      conversationHistory as Array<{ role: string; content: string }>,
      context as Record<string, unknown>,
    );

    // Agent mode: use the orchestrator-built prompt instead of the default
    const agentCtx = sanitizedContext as { agentMode?: boolean; agentSystemPrompt?: string };
    const systemPrompt = agentCtx.agentMode && agentCtx.agentSystemPrompt
      ? agentCtx.agentSystemPrompt
      : buildSystemPrompt({
          currentSection: sanitizedContext.currentSection as string | undefined,
          incomeDiscovery: sanitizedContext.incomeDiscovery as Record<string, string> | undefined,
          activeToolId: (sanitizedContext as { activeToolId?: string | null }).activeToolId ?? undefined,
          taxYear: sanitizedContext.taxYear as number | undefined,
        });

    // 5. Call Anthropic with the user's key (one-shot, key never stored)
    let response: ChatResponse;
    try {
      response = await anthropicCompletionWithKey(
        apiKey,
        model,
        messages,
        sanitizedContext,
        systemPrompt,
      );
    } catch (err: any) {
      if (handleLLMError(err, res, 'byok-chat')) return;
      throw err;
    }

    // 6. Return response
    res.json({ data: response });
  } catch (err) {
    // IMPORTANT: Never log the request body (contains the user's API key)
    handleRouteError(err, res, 'byok-chat');
  }
});

/**
 * POST /api/chat/byok/stream
 * BYOK streaming — same validation and PII handling as /byok; delivers SSE events.
 */
router.post('/byok/stream', async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  if (!clientIp) {
    res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } });
    return;
  }
  if (!sharedCheckRateLimit(clientIp, 'chat', config.byokRateLimitMax, config.rateLimitWindowMs)) {
    sendRateLimitResponse(res, 'Too many requests. Please wait a moment and try again.', Math.ceil(config.rateLimitWindowMs / 1000));
    return;
  }

  const parseResult = BYOKRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const body = req.body || {};
    console.error('[BYOK stream validation failed]', {
      messageLength: typeof body.message === 'string' ? body.message.length : typeof body.message,
      historyLength: Array.isArray(body.conversationHistory) ? body.conversationHistory.length : 0,
      historyContentLengths: Array.isArray(body.conversationHistory)
        ? body.conversationHistory.map((m: { content?: string }) => m?.content?.length ?? 0)
        : [],
      provider: body.provider,
      model: body.model,
      issues: parseResult.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
    res.status(400).json({
      error: {
        message: 'Invalid request body.',
        code: 'VALIDATION_ERROR',
        detail: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
    });
    return;
  }

  const { message, conversationHistory, context, apiKey: clientKeyField, model } = parseResult.data;

  const { apiKey, trimmedClientKey } = resolveBYOKAnthropicKey(clientKeyField);
  const keyValidation = validateBYOKAnthropicKey(trimmedClientKey, apiKey);
  if (!keyValidation.ok) {
    res.status(400).json({
      error: {
        message: keyValidation.message,
        code: keyValidation.code,
      },
    });
    return;
  }

  const { messages, sanitizedContext } = prepareMessages(
    message,
    conversationHistory as Array<{ role: string; content: string }>,
    context as Record<string, unknown>,
  );

  const abortController = new AbortController();
  const onClose = () => {
    abortController.abort();
  };
  // Listen on `res` (not `req`) — req's 'close' fires after body parsing completes,
  // but res's 'close' fires when the client actually disconnects the TCP connection.
  res.once('close', onClose);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const writeSse = (payload: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  // Agent mode: use the orchestrator-built prompt instead of the default
  const agentCtxStream = sanitizedContext as { agentMode?: boolean; agentSystemPrompt?: string };
  const systemPrompt = agentCtxStream.agentMode && agentCtxStream.agentSystemPrompt
    ? agentCtxStream.agentSystemPrompt
    : buildSystemPrompt({
        currentSection: sanitizedContext.currentSection as string | undefined,
        incomeDiscovery: sanitizedContext.incomeDiscovery as Record<string, string> | undefined,
        activeToolId: (sanitizedContext as { activeToolId?: string | null }).activeToolId ?? undefined,
        taxYear: sanitizedContext.taxYear as number | undefined,
      });

  try {
    const response = await anthropicStreamWithKey(
      apiKey,
      model,
      messages,
      sanitizedContext,
      systemPrompt,
      (delta) => {
        if (!res.writableEnded) {
          writeSse({ type: 'text_delta', delta });
        }
      },
      abortController.signal,
    );
    console.log('[byok-chat-stream] Stream complete, sending response_complete');
    if (!res.writableEnded) {
      writeSse({ type: 'response_complete', data: response });
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isAbort = rawMsg.includes('aborted') || rawMsg.includes('AbortError') || abortController.signal.aborted;
    if (isAbort) {
      console.log('[byok-chat-stream] Client disconnected (request aborted).');
    } else {
      console.error('[byok-chat-stream] Provider error:', scrubSecrets(rawMsg));
    }
    if (!res.writableEnded) {
      writeSse({ type: 'error', error: { message: isAbort ? 'Request cancelled.' : sanitizeLLMErrorMessage(err) } });
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } finally {
    res.off('close', onClose);
  }
});

export default router;
