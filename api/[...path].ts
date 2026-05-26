/**
 * Vercel Serverless Function — catch-all for /api/* routes.
 *
 * Mounts the same Express route handlers from server/src/routes/*
 * but replaces the SQLite rate limiter with a simple in-memory Map
 * (acceptable for serverless where each invocation is short-lived).
 */

import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { scanForPII, parseResponse, buildIrsReferenceData } from '@nimbus/engine';
import type { ChatResponse } from '@nimbus/engine';

const app = express();

// ─── Config ──────────────────────────────────────────
const CONFIG = {
  maxConversationHistory: 10,
  maxMessageLength: 4000,
  byokRateLimitMax: 30,
  batchRateLimitMax: 10,
  extractRateLimitMax: 20,
  rateLimitWindowMs: 60_000,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
};

// ─── In-memory rate limiter (serverless-safe) ────────
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(ip: string, endpoint: string, max: number, windowMs: number): boolean {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  const timestamps = (rateLimitMap.get(key) || []).filter(t => t > now - windowMs);
  if (timestamps.length >= max) {
    rateLimitMap.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return true;
}

function getClientIp(req: express.Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip || req.socket?.remoteAddress;
  if (!ip) return null;
  if (ip.length > 45 || !/^[\d.:a-fA-F]+$/.test(ip)) return null;
  return ip;
}

function sendRateLimitResponse(res: express.Response, message: string, retryAfter: number = 60) {
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({ error: { message, code: 'RATE_LIMITED' } });
}

// ─── PII Stripping ───────────────────────────────────
interface StrippingResult { sanitized: string; strippedCount: number; strippedTypes: string[] }

function stripPII(text: string): StrippingResult {
  const result = scanForPII(text);
  return { sanitized: result.sanitized, strippedCount: result.detectedCount, strippedTypes: result.detectedTypes };
}

const CONTEXT_ALLOWLIST = new Set([
  'currentSection', 'currentStepId', 'taxYear', 'filingStatus',
  'dependentCount', 'incomeDiscovery', 'deductionMethod', 'activeToolId',
  'agentMode', 'agentSystemPrompt',
]);

function stripContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const key of Object.keys(ctx)) {
    if (CONTEXT_ALLOWLIST.has(key)) {
      cleaned[key] = ctx[key];
    }
  }
  return cleaned;
}

function stripConversationHistory(history: Array<{ role: string; content: string }>) {
  return history.map(m => ({ role: m.role, content: stripPII(m.content).sanitized }));
}

// ─── BYOK Key Resolution ────────────────────────────
function resolveBYOKAnthropicKey(clientKey: string) {
  const trimmedClientKey = clientKey.trim();
  const apiKey = trimmedClientKey || CONFIG.anthropicApiKey;
  return { apiKey, trimmedClientKey };
}

function validateBYOKAnthropicKey(trimmed: string, resolved: string) {
  if (!resolved) return { ok: false as const, code: 'NO_API_KEY', message: 'No API key configured.' };
  if (trimmed && !trimmed.startsWith('sk-ant-')) return { ok: false as const, code: 'INVALID_API_KEY', message: 'Invalid Anthropic API key format. Keys start with "sk-ant-".' };
  return { ok: true as const };
}

// ─── Error Sanitizer ─────────────────────────────────
const ERROR_CLASSIFIERS = [
  { pattern: /usage limits|spending limit|budget|exceeded.*limit/i, message: 'Your API key has reached its spending limit.', code: 'LLM_SPENDING_LIMIT', status: 400 },
  { pattern: /context.*(length|window|too long|too large)|maximum.*token|token.*limit/i, message: 'Message too long for the selected model.', code: 'LLM_CONTEXT_LENGTH', status: 400 },
  { pattern: /content.*policy|content.*filter|safety|blocked|moderation/i, message: 'Request blocked by content policy.', code: 'LLM_CONTENT_POLICY', status: 400 },
  { pattern: /model.*not.*found|model.*does not exist|unknown.*model|decommissioned/i, message: 'Model not found.', code: 'LLM_MODEL_NOT_FOUND', status: 400 },
  { pattern: /invalid.*api.?key|authentication|unauthorized|forbidden|incorrect.*key/i, message: 'Invalid API key.', code: 'LLM_AUTH_ERROR', status: 401 },
  { pattern: /rate.?limit|too many requests|throttl/i, message: 'AI service is busy. Try again shortly.', code: 'LLM_RATE_LIMITED', status: 429 },
  { pattern: /timeout|timed?\s*out|deadline/i, message: 'AI provider timed out.', code: 'LLM_TIMEOUT', status: 504 },
  { pattern: /overloaded|capacity|unavailable|service.*error|internal.*error/i, message: 'AI provider temporarily unavailable.', code: 'LLM_UNAVAILABLE', status: 503 },
];

function classifyError(err: any) {
  const rawMsg = err?.message || '';
  const httpStatus = err?.status || err?.statusCode;
  if (httpStatus === 429) return { message: 'AI service is busy.', code: 'LLM_RATE_LIMITED', status: 429 };
  if (httpStatus === 401 || httpStatus === 403) return { message: 'Invalid API key.', code: 'LLM_AUTH_ERROR', status: 401 };
  for (const c of ERROR_CLASSIFIERS) { if (c.pattern.test(rawMsg)) return c; }
  return { message: 'An unexpected error occurred.', code: 'LLM_UNKNOWN_ERROR', status: 502 };
}

function handleLLMError(err: any, res: express.Response) {
  const classified = classifyError(err);
  res.status(classified.status).json({ error: { message: classified.message, code: classified.code } });
  return true;
}

function sanitizeLLMErrorMessage(err: unknown): string {
  return classifyError(err instanceof Error ? err : new Error(String(err))).message;
}

// ─── Anthropic Client ────────────────────────────────
function supportsAssistantPrefill(model: string): boolean {
  return model.includes('claude-3');
}

async function anthropicCompletionWithKey(
  apiKey: string, model: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: Record<string, unknown>, systemPrompt: string,
): Promise<ChatResponse> {
  const client = new Anthropic({ apiKey, timeout: 120_000 });
  const referenceData = buildIrsReferenceData({
    filingStatus: context.filingStatus as string | undefined,
    currentSection: context.currentSection as string | undefined,
    incomeDiscovery: context.incomeDiscovery as Record<string, string> | undefined,
    deductionMethod: context.deductionMethod as string | undefined,
    dependentCount: context.dependentCount as number | undefined,
  });
  const contextSuffix = `\n\n${referenceData}\n\nCURRENT CONTEXT:\n${JSON.stringify(context, null, 2)}`;
  const usePrefill = supportsAssistantPrefill(model);
  const mappedMessages: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: m.content }));
  if (usePrefill) mappedMessages.push({ role: 'assistant', content: '{' });

  const response = await client.messages.create({
    model, max_tokens: 2048, temperature: 0.3,
    system: [
      { type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } },
      { type: 'text' as const, text: contextSuffix },
    ],
    messages: mappedMessages,
  });
  const raw = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  return parseResponse(usePrefill ? '{' + raw : raw);
}

async function anthropicStreamWithKey(
  apiKey: string, model: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: Record<string, unknown>, systemPrompt: string,
  onTextDelta: (delta: string) => void, signal?: AbortSignal,
): Promise<ChatResponse> {
  const client = new Anthropic({ apiKey, timeout: 120_000 });
  const referenceData = buildIrsReferenceData({
    filingStatus: context.filingStatus as string | undefined,
    currentSection: context.currentSection as string | undefined,
    incomeDiscovery: context.incomeDiscovery as Record<string, string> | undefined,
    deductionMethod: context.deductionMethod as string | undefined,
    dependentCount: context.dependentCount as number | undefined,
  });
  const contextSuffix = `\n\n${referenceData}\n\nCURRENT CONTEXT:\n${JSON.stringify(context, null, 2)}`;
  const usePrefill = supportsAssistantPrefill(model);
  const mappedMessages: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: m.content }));
  if (usePrefill) mappedMessages.push({ role: 'assistant', content: '{' });

  const stream = client.messages.stream({
    model, max_tokens: 2048, temperature: 0.3,
    system: [
      { type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } },
      { type: 'text' as const, text: contextSuffix },
    ],
    messages: mappedMessages,
  }, { signal });

  let accumulated = '';
  stream.on('text', (delta) => { onTextDelta(delta); accumulated += delta; });

  try { await stream.done(); } catch (streamErr: any) {
    if (signal?.aborted) throw streamErr;
    if (accumulated.length === 0) throw streamErr;
  }
  return parseResponse(usePrefill ? '{' + accumulated : accumulated);
}

async function rawAnthropicCompletionWithKey(
  apiKey: string, model: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
): Promise<string> {
  const client = new Anthropic({ apiKey, timeout: 120_000 });
  const usePrefill = supportsAssistantPrefill(model);
  const mappedMessages: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: m.content }));
  if (usePrefill) mappedMessages.push({ role: 'assistant', content: '{' });
  const response = await client.messages.create({ model, max_tokens: 8192, temperature: 0.3, system: systemPrompt, messages: mappedMessages });
  const raw = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  return usePrefill ? '{' + raw : raw;
}

// ─── System Prompt (imported inline from server) ─────
// We import the system prompt builder from the server module
import { buildSystemPrompt } from '../server/src/services/systemPrompt.js';

// ─── Merchant Classification Prompt ──────────────────
import { MERCHANT_CLASSIFY_PROMPT, buildClassifyUserMessage, parseClassificationResponse } from '../server/src/services/merchantClassifyPrompt.js';

// ─── OCR Extraction Prompt ───────────────────────────
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserMessage, parseExtractionResponse } from '../server/src/services/ocrExtractPrompt.js';

// ─── Zod Schemas ─────────────────────────────────────
const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(20_000),
});

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(CONFIG.maxMessageLength),
  conversationHistory: z.array(MessageSchema).max(CONFIG.maxConversationHistory).default([]),
  context: z.record(z.unknown()).default({}),
});

const BYOKRequestSchema = ChatRequestSchema.extend({
  provider: z.literal('anthropic'),
  apiKey: z.string().max(200).optional().default(''),
  model: z.string().min(1).max(100),
});

const MerchantClassifySchema = z.object({
  merchants: z.array(z.string().max(200)).min(1).max(500),
  context: z.object({
    hasScheduleC: z.boolean().default(false),
    hasHomeOffice: z.boolean().default(false),
    hasRentalIncome: z.boolean().default(false),
    deductionMethod: z.enum(['standard', 'itemized']).default('standard'),
  }),
  provider: z.literal('anthropic'),
  apiKey: z.string().max(200).optional().default(''),
  model: z.string().min(1).max(100),
});

const CategorizeSchema = z.object({
  prompt: z.string().min(1).max(50000),
  provider: z.literal('anthropic'),
  apiKey: z.string().max(200).optional().default(''),
  model: z.string().min(1).max(100),
});

const FieldExtractionSchema = z.object({
  ocrText: z.string().min(10).max(20_000),
  formTypeHint: z.string().max(20).nullable(),
  provider: z.literal('anthropic'),
  apiKey: z.string().max(200).optional().default(''),
  model: z.string().min(1).max(100),
});

// ─── Shared helpers ──────────────────────────────────
function prepareMessages(message: string, history: Array<{ role: string; content: string }>, context: Record<string, unknown>) {
  const { sanitized } = stripPII(message);
  const sanitizedHistory = stripConversationHistory(history);
  const sanitizedContext = stripContext(context);
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...sanitizedHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: sanitized },
  ];
  return { messages, sanitizedContext };
}

function sanitizeMerchant(desc: string): string {
  let c = desc;
  c = c.replace(/\b\d{4,}\b/g, '');
  c = c.replace(/\b(ACCT|ACCOUNT|REF|CARD|ENDING)\s*#?\s*\d*/gi, '');
  c = c.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, '');
  return c.trim().replace(/\s{2,}/g, ' ');
}

// ─── CORS ────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));

// ─── Health ──────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Tip Links ───────────────────────────────────────
app.get('/api/tip-links', (_req, res) => {
  res.json({ data: { small: null, medium: null, large: null } });
});

// ─── Chat Status ─────────────────────────────────────
app.get('/api/chat/status', (_req, res) => {
  res.json({
    status: 'ok',
    data: { enabled: false, model: null, byokEnabled: true, hasServerKey: Boolean(CONFIG.anthropicApiKey) },
  });
});

// ─── Chat BYOK ───────────────────────────────────────
app.post('/api/chat/byok', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    if (!clientIp) { res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } }); return; }
    if (!checkRateLimit(clientIp, 'chat', CONFIG.byokRateLimitMax, CONFIG.rateLimitWindowMs)) { sendRateLimitResponse(res, 'Too many requests.', 60); return; }

    const parseResult = BYOKRequestSchema.safeParse(req.body);
    if (!parseResult.success) { res.status(400).json({ error: { message: 'Invalid request body.', code: 'VALIDATION_ERROR' } }); return; }

    const { message, conversationHistory, context, apiKey: clientKeyField, model } = parseResult.data;
    const { apiKey, trimmedClientKey } = resolveBYOKAnthropicKey(clientKeyField);
    const keyValidation = validateBYOKAnthropicKey(trimmedClientKey, apiKey);
    if (!keyValidation.ok) { res.status(400).json({ error: { message: keyValidation.message, code: keyValidation.code } }); return; }

    const { messages, sanitizedContext } = prepareMessages(message, conversationHistory as any, context as any);
    const agentCtx = sanitizedContext as { agentMode?: boolean; agentSystemPrompt?: string };
    const systemPrompt = agentCtx.agentMode && agentCtx.agentSystemPrompt
      ? agentCtx.agentSystemPrompt
      : buildSystemPrompt({ currentSection: sanitizedContext.currentSection as string | undefined, incomeDiscovery: sanitizedContext.incomeDiscovery as Record<string, string> | undefined, activeToolId: (sanitizedContext as any).activeToolId ?? undefined, taxYear: sanitizedContext.taxYear as number | undefined });

    let response: ChatResponse;
    try { response = await anthropicCompletionWithKey(apiKey, model, messages, sanitizedContext, systemPrompt); }
    catch (err: any) { handleLLMError(err, res); return; }

    res.json({ data: response });
  } catch (err) {
    console.error('[byok-chat] Error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: { message: 'An error occurred.', code: 'BYOK_CHAT_ERROR' } });
  }
});

// ─── Chat BYOK Stream ────────────────────────────────
app.post('/api/chat/byok/stream', async (req, res) => {
  const clientIp = getClientIp(req);
  if (!clientIp) { res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } }); return; }
  if (!checkRateLimit(clientIp, 'chat', CONFIG.byokRateLimitMax, CONFIG.rateLimitWindowMs)) { sendRateLimitResponse(res, 'Too many requests.', 60); return; }

  const parseResult = BYOKRequestSchema.safeParse(req.body);
  if (!parseResult.success) { res.status(400).json({ error: { message: 'Invalid request body.', code: 'VALIDATION_ERROR' } }); return; }

  const { message, conversationHistory, context, apiKey: clientKeyField, model } = parseResult.data;
  const { apiKey, trimmedClientKey } = resolveBYOKAnthropicKey(clientKeyField);
  const keyValidation = validateBYOKAnthropicKey(trimmedClientKey, apiKey);
  if (!keyValidation.ok) { res.status(400).json({ error: { message: keyValidation.message, code: keyValidation.code } }); return; }

  const { messages, sanitizedContext } = prepareMessages(message, conversationHistory as any, context as any);

  const abortController = new AbortController();
  res.once('close', () => abortController.abort());

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const writeSse = (payload: Record<string, unknown>) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`); };

  const agentCtx = sanitizedContext as { agentMode?: boolean; agentSystemPrompt?: string };
  const systemPrompt = agentCtx.agentMode && agentCtx.agentSystemPrompt
    ? agentCtx.agentSystemPrompt
    : buildSystemPrompt({ currentSection: sanitizedContext.currentSection as string | undefined, incomeDiscovery: sanitizedContext.incomeDiscovery as Record<string, string> | undefined, activeToolId: (sanitizedContext as any).activeToolId ?? undefined, taxYear: sanitizedContext.taxYear as number | undefined });

  try {
    const response = await anthropicStreamWithKey(apiKey, model, messages, sanitizedContext, systemPrompt,
      (delta) => { if (!res.writableEnded) writeSse({ type: 'text_delta', delta }); },
      abortController.signal,
    );
    if (!res.writableEnded) { writeSse({ type: 'response_complete', data: response }); res.write('data: [DONE]\n\n'); res.end(); }
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isAbort = rawMsg.includes('aborted') || rawMsg.includes('AbortError') || abortController.signal.aborted;
    if (!res.writableEnded) {
      writeSse({ type: 'error', error: { message: isAbort ? 'Request cancelled.' : sanitizeLLMErrorMessage(err) } });
      res.write('data: [DONE]\n\n'); res.end();
    }
  }
});

// ─── Batch: Classify Merchants ───────────────────────
app.post('/api/batch/classify-merchants', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    if (!clientIp) { res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } }); return; }
    if (!checkRateLimit(clientIp, 'batch', CONFIG.batchRateLimitMax, CONFIG.rateLimitWindowMs)) { sendRateLimitResponse(res, 'Too many requests.', 60); return; }

    const parseResult = MerchantClassifySchema.safeParse(req.body);
    if (!parseResult.success) { res.status(400).json({ error: { message: 'Invalid request body.', code: 'VALIDATION_ERROR' } }); return; }

    const { merchants, context, apiKey: clientKeyField, model } = parseResult.data;
    const { apiKey, trimmedClientKey } = resolveBYOKAnthropicKey(clientKeyField);
    const keyValidation = validateBYOKAnthropicKey(trimmedClientKey, apiKey);
    if (!keyValidation.ok) { res.status(400).json({ error: { message: keyValidation.message, code: keyValidation.code } }); return; }

    const sanitizedMerchants = merchants.map(sanitizeMerchant).filter(m => m.length > 0);
    if (sanitizedMerchants.length === 0) { res.status(400).json({ error: { message: 'No valid merchant names.', code: 'EMPTY_MERCHANTS' } }); return; }

    const userMessage = buildClassifyUserMessage(sanitizedMerchants, context);
    let raw: string;
    try { raw = await rawAnthropicCompletionWithKey(apiKey, model, [{ role: 'user', content: userMessage }], MERCHANT_CLASSIFY_PROMPT); }
    catch (err: any) { handleLLMError(err, res); return; }

    const classifications = parseClassificationResponse(raw);
    res.json({ data: { classifications } });
  } catch (err) {
    console.error('[batch-classify] Error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: { message: 'An error occurred.', code: 'BATCH_CLASSIFY_ERROR' } });
  }
});

// ─── Batch: Categorize Transactions ──────────────────
app.post('/api/batch/categorize-transactions', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    if (!clientIp) { res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } }); return; }
    if (!checkRateLimit(clientIp, 'batch', CONFIG.batchRateLimitMax, CONFIG.rateLimitWindowMs)) { sendRateLimitResponse(res, 'Too many requests.', 60); return; }

    const parseResult = CategorizeSchema.safeParse(req.body);
    if (!parseResult.success) { res.status(400).json({ error: { message: 'Invalid request.', code: 'VALIDATION_ERROR' } }); return; }

    const { prompt: rawPrompt, apiKey: clientKeyField, model } = parseResult.data;
    const piiResult = stripPII(rawPrompt);

    const { apiKey, trimmedClientKey } = resolveBYOKAnthropicKey(clientKeyField);
    const keyValidation = validateBYOKAnthropicKey(trimmedClientKey, apiKey);
    if (!keyValidation.ok) { res.status(400).json({ error: { message: keyValidation.message, code: keyValidation.code } }); return; }

    const systemPrompt = 'You are a tax transaction categorization assistant. Return ONLY a valid JSON array. No code fences, no explanation — just the JSON array.';
    let raw: string;
    try { raw = await rawAnthropicCompletionWithKey(apiKey, model, [{ role: 'user', content: piiResult.sanitized }], systemPrompt); }
    catch (err: any) { handleLLMError(err, res); return; }

    let categories: any[] = [];
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      categories = JSON.parse(cleaned);
      if (!Array.isArray(categories)) categories = [];
    } catch { categories = []; }

    res.json({ data: { categories } });
  } catch (err) {
    console.error('[batch-categorize] Error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: { message: 'An error occurred.', code: 'BATCH_CATEGORIZE_ERROR' } });
  }
});

// ─── Extract: Fields ─────────────────────────────────
app.post('/api/extract/fields', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    if (!clientIp) { res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } }); return; }
    if (!checkRateLimit(clientIp, 'extract', CONFIG.extractRateLimitMax, CONFIG.rateLimitWindowMs)) { sendRateLimitResponse(res, 'Too many requests.', 60); return; }

    const parseResult = FieldExtractionSchema.safeParse(req.body);
    if (!parseResult.success) { res.status(400).json({ error: { message: 'Invalid request body.', code: 'VALIDATION_ERROR' } }); return; }

    const { ocrText, formTypeHint, apiKey: clientKeyField, model } = parseResult.data;
    const { apiKey, trimmedClientKey } = resolveBYOKAnthropicKey(clientKeyField);
    const keyValidation = validateBYOKAnthropicKey(trimmedClientKey, apiKey);
    if (!keyValidation.ok) { res.status(400).json({ error: { message: keyValidation.message, code: keyValidation.code } }); return; }

    const piiResult = stripPII(ocrText);
    const userMessage = buildExtractionUserMessage(piiResult.sanitized, formTypeHint);
    let raw: string;
    try { raw = await rawAnthropicCompletionWithKey(apiKey, model, [{ role: 'user', content: userMessage }], EXTRACTION_SYSTEM_PROMPT); }
    catch (err: any) { handleLLMError(err, res); return; }

    const result = parseExtractionResponse(raw);
    res.json({ data: result });
  } catch (err) {
    console.error('[extract] Error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: { message: 'An error occurred.', code: 'EXTRACT_ERROR' } });
  }
});

// ─── Extract: Capabilities ───────────────────────────
app.get('/api/extract/capabilities', (_req, res) => {
  res.json({ data: { docling: false, vision: Boolean(CONFIG.anthropicApiKey), textExtraction: true } });
});

export default app;
