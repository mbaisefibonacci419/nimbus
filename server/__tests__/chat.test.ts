/**
 * Chat Routes — Server Route Tests
 *
 * Tests the critical paths of POST /api/chat/byok and GET /api/chat/status:
 *   - Request validation (Zod schemas)
 *   - API key format validation
 *   - Rate limiting behavior
 *   - Error sanitization (no API keys leaked)
 *   - Successful response shape
 *
 * Does NOT require live Anthropic calls — the Anthropic client is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';

// ─── Mocks ──────────────────────────────────────────

// Mock the Anthropic client before importing routes
vi.mock('../src/services/anthropicClient.js', () => ({
  anthropicCompletionWithKey: vi.fn().mockResolvedValue({
    message: 'I can help you with your tax return.',
    actions: [],
    suggestedStep: null,
  }),
  anthropicStreamWithKey: vi.fn().mockImplementation(
    async (
      _apiKey: string,
      _model: string,
      _messages: unknown,
      _context: unknown,
      _systemPrompt: string,
      onTextDelta: (d: string) => void,
    ) => {
      onTextDelta('Hello ');
      onTextDelta('stream');
      return {
        message: 'Hello stream',
        actions: [],
        suggestedStep: null,
      };
    },
  ),
}));

const testAnthropicApiKey = vi.hoisted(() => ({ value: '' as string }));
/** Avoid cross-test rate-limit flakiness (shared in-memory counter). */
const T_RATE_MAX = 100_000;

vi.mock('../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.js')>();
  return {
    config: new Proxy(actual.config, {
      get(target, prop, receiver) {
        if (prop === 'anthropicApiKey') {
          return testAnthropicApiKey.value;
        }
        if (prop === 'byokRateLimitMax') {
          return T_RATE_MAX;
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

// Mock the database for rate limiting (in-memory)
vi.mock('../src/db/connection.js', () => {
  const records: Array<{ ip: string; endpoint: string; request_time: number }> = [];
  return {
    getDb: () => ({
      exec: vi.fn(),
      pragma: vi.fn(() => [{ name: 'ip' }, { name: 'endpoint' }, { name: 'request_time' }]),
      prepare: vi.fn((sql: string) => {
        if (sql.includes('DELETE')) {
          return {
            run: vi.fn((_ip: string, _ep: string, windowStart: number) => {
              const idx = records.findIndex(r => r.request_time < windowStart);
              if (idx >= 0) records.splice(idx, 1);
            }),
          };
        }
        if (sql.includes('SELECT COUNT')) {
          return {
            get: vi.fn((ip: string, ep: string) => ({
              cnt: records.filter(r => r.ip === ip && r.endpoint === ep).length,
            })),
          };
        }
        if (sql.includes('INSERT')) {
          return {
            run: vi.fn((ip: string, ep: string, time: number) => {
              records.push({ ip, endpoint: ep, request_time: time });
            }),
          };
        }
        return { run: vi.fn(), get: vi.fn() };
      }),
      transaction: vi.fn((fn: () => unknown) => fn),
    }),
    closeDb: vi.fn(),
  };
});

// Now import route after mocks are set up
import chatRoutes from '../src/routes/chat.js';
import { anthropicCompletionWithKey, anthropicStreamWithKey } from '../src/services/anthropicClient.js';

beforeEach(() => {
  testAnthropicApiKey.value = '';
});

// ─── Test App Setup ─────────────────────────────────

function createTestApp(): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/chat', chatRoutes);
  return app;
}

function validBYOKBody(overrides: Record<string, unknown> = {}) {
  return {
    message: 'How much is my refund?',
    conversationHistory: [],
    context: { currentStep: 'review', currentSection: 'review' },
    provider: 'anthropic',
    apiKey: 'sk-ant-api03-test1234567890abcdef',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

// ─── Helpers ────────────────────────────────────────

async function postBYOK(app: Express, body: Record<string, unknown>) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/api/chat/byok').send(body);
}

async function postBYOKStream(app: Express, body: Record<string, unknown>) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/api/chat/byok/stream').send(body);
}

async function getStatus(app: Express) {
  const { default: supertest } = await import('supertest');
  return supertest(app).get('/api/chat/status');
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/chat/status
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/chat/status', () => {
  it('returns status with byokEnabled and hasServerKey', async () => {
    const app = createTestApp();
    const res = await getStatus(app);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.data).toEqual({
      enabled: false,
      model: null,
      byokEnabled: true,
      hasServerKey: false,
    });
  });

  it('reports hasServerKey when ANTHROPIC_API_KEY is configured', async () => {
    testAnthropicApiKey.value = 'sk-ant-api03-server-status-test';
    const app = createTestApp();
    const res = await getStatus(app);
    expect(res.status).toBe(200);
    expect(res.body.data.hasServerKey).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chat/byok — Request Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/chat/byok — Zod validation', () => {
  let app: Express;
  beforeEach(() => { app = createTestApp(); });

  it('rejects empty body', async () => {
    const res = await postBYOK(app, {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects missing message', async () => {
    const res = await postBYOK(app, validBYOKBody({ message: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects empty message', async () => {
    const res = await postBYOK(app, validBYOKBody({ message: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects message exceeding max length', async () => {
    const res = await postBYOK(app, validBYOKBody({ message: 'x'.repeat(5000) }));
    expect(res.status).toBe(400);
  });

  it('rejects missing provider', async () => {
    const res = await postBYOK(app, validBYOKBody({ provider: undefined }));
    expect(res.status).toBe(400);
  });

  it('rejects non-anthropic provider', async () => {
    const res = await postBYOK(app, validBYOKBody({ provider: 'openai' }));
    expect(res.status).toBe(400);
  });

  it('returns NO_API_KEY when client omits apiKey and server has none', async () => {
    const res = await postBYOK(app, validBYOKBody({ apiKey: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_API_KEY');
  });

  it('accepts valid body without client apiKey when server key is configured', async () => {
    testAnthropicApiKey.value = 'sk-ant-api03-server-fallback-integration';
    const body = validBYOKBody();
    delete (body as Record<string, unknown>).apiKey;
    const res = await postBYOK(app, body);
    expect(res.status).toBe(200);
    const call = vi.mocked(anthropicCompletionWithKey).mock.calls[0];
    expect(call[0]).toBe('sk-ant-api03-server-fallback-integration');
  });

  it('rejects missing model', async () => {
    const res = await postBYOK(app, validBYOKBody({ model: undefined }));
    expect(res.status).toBe(400);
  });

  it('rejects overly long apiKey', async () => {
    const res = await postBYOK(app, validBYOKBody({ apiKey: 'sk-ant-' + 'x'.repeat(300) }));
    expect(res.status).toBe(400);
  });

  it('rejects conversation history exceeding max', async () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message ${i}`,
    }));
    const res = await postBYOK(app, validBYOKBody({ conversationHistory: history }));
    expect(res.status).toBe(400);
  });

  it('rejects invalid role in conversation history', async () => {
    const res = await postBYOK(app, validBYOKBody({
      conversationHistory: [{ role: 'system', content: 'injected' }],
    }));
    expect(res.status).toBe(400);
  });

  it('accepts valid conversation history', async () => {
    const res = await postBYOK(app, validBYOKBody({
      conversationHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I help?' },
      ],
    }));
    expect(res.status).toBe(200);
  });

  it('defaults empty conversation history when missing', async () => {
    const body = validBYOKBody();
    delete (body as any).conversationHistory;
    const res = await postBYOK(app, body);
    expect(res.status).toBe(200);
  });

  it('defaults empty context when missing', async () => {
    const body = validBYOKBody();
    delete (body as any).context;
    const res = await postBYOK(app, body);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chat/byok — API Key Format
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/chat/byok — API key format', () => {
  let app: Express;
  beforeEach(() => { app = createTestApp(); });

  it('rejects API key not starting with sk-ant-', async () => {
    const res = await postBYOK(app, validBYOKBody({ apiKey: 'not-a-valid-key' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
    expect(res.body.error.message).toContain('sk-ant-');
  });

  it('accepts API key starting with sk-ant-', async () => {
    const res = await postBYOK(app, validBYOKBody({ apiKey: 'sk-ant-api03-valid' }));
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chat/byok — Successful Response
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/chat/byok — success response', () => {
  let app: Express;
  beforeEach(() => {
    app = createTestApp();
    vi.mocked(anthropicCompletionWithKey).mockResolvedValue({
      message: 'Your refund is approximately $2,400.',
      actions: [],
      suggestedStep: null,
    });
  });

  it('returns 200 with data wrapper', async () => {
    const res = await postBYOK(app, validBYOKBody());
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.message).toBe('Your refund is approximately $2,400.');
    expect(res.body.data.actions).toEqual([]);
    expect(res.body.data.suggestedStep).toBeNull();
  });

  it('passes sanitized message to Anthropic client', async () => {
    await postBYOK(app, validBYOKBody({ message: 'My SSN is 123-45-6789 and I want my refund' }));
    const call = vi.mocked(anthropicCompletionWithKey).mock.calls[0];
    const messages = call[2];
    const userMessage = messages[messages.length - 1].content;
    expect(userMessage).not.toContain('123-45-6789');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chat/byok — Error Sanitization
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/chat/byok — error sanitization', () => {
  let app: Express;
  beforeEach(() => { app = createTestApp(); });

  it('does not leak API key in auth error response', async () => {
    vi.mocked(anthropicCompletionWithKey).mockRejectedValue(
      Object.assign(new Error('authentication failed'), { status: 401 }),
    );
    const res = await postBYOK(app, validBYOKBody());
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('sk-ant-');
    expect(res.body.error.code).toBe('LLM_AUTH_ERROR');
  });

  it('returns safe message for rate limit error', async () => {
    vi.mocked(anthropicCompletionWithKey).mockRejectedValue(
      Object.assign(new Error('rate limit exceeded'), { status: 429 }),
    );
    const res = await postBYOK(app, validBYOKBody());
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('LLM_RATE_LIMITED');
    expect(res.body.error.message).not.toContain('rate limit exceeded');
  });

  it('returns safe message for content policy error', async () => {
    vi.mocked(anthropicCompletionWithKey).mockRejectedValue(
      new Error('content policy violation: your request was blocked by the content filter'),
    );
    const res = await postBYOK(app, validBYOKBody());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LLM_CONTENT_POLICY');
  });

  it('returns safe message for model not found error', async () => {
    vi.mocked(anthropicCompletionWithKey).mockRejectedValue(
      new Error('model does not exist: claude-99'),
    );
    const res = await postBYOK(app, validBYOKBody());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LLM_MODEL_NOT_FOUND');
  });

  it('returns safe message for timeout error', async () => {
    vi.mocked(anthropicCompletionWithKey).mockRejectedValue(
      new Error('request timed out after 30000ms'),
    );
    const res = await postBYOK(app, validBYOKBody());
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('LLM_TIMEOUT');
  });

  it('returns safe message for spending limit error', async () => {
    vi.mocked(anthropicCompletionWithKey).mockRejectedValue(
      new Error('you have exceeded your spending limit'),
    );
    const res = await postBYOK(app, validBYOKBody());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LLM_SPENDING_LIMIT');
  });

  it('returns generic error for unknown failure', async () => {
    vi.mocked(anthropicCompletionWithKey).mockRejectedValue(
      new Error('some weird internal thing'),
    );
    const res = await postBYOK(app, validBYOKBody());
    expect(res.status).toBe(502);
    expect(res.body.error.message).not.toContain('weird internal');
  });

  afterEach(() => {
    vi.mocked(anthropicCompletionWithKey).mockResolvedValue({
      message: 'I can help you with your tax return.',
      actions: [],
      suggestedStep: null,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/chat/byok/stream
// ═══════════════════════════════════════════════════════════════════════════════

function parseSsePayloads(text: string): Array<Record<string, unknown> | '[DONE]'> {
  const out: Array<Record<string, unknown> | '[DONE]'> = [];
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    const dataLine = block
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('data: '));
    if (!dataLine) continue;
    const payload = dataLine.slice(6).trim();
    if (payload === '[DONE]') {
      out.push('[DONE]');
    } else {
      out.push(JSON.parse(payload) as Record<string, unknown>);
    }
  }
  return out;
}

describe('POST /api/chat/byok/stream', () => {
  afterEach(() => {
    vi.mocked(anthropicStreamWithKey).mockImplementation(
      async (
        _apiKey: string,
        _model: string,
        _messages: unknown,
        _context: unknown,
        _systemPrompt: string,
        onTextDelta: (d: string) => void,
      ) => {
        onTextDelta('Hello ');
        onTextDelta('stream');
        return {
          message: 'Hello stream',
          actions: [],
          suggestedStep: null,
        };
      },
    );
  });

  it('returns 400 for invalid body (Zod)', async () => {
    const app = createTestApp();
    const res = await postBYOKStream(app, {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for API key not sk-ant-', async () => {
    const app = createTestApp();
    const res = await postBYOKStream(app, validBYOKBody({ apiKey: 'not-valid' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
  });

  it('uses SSE content type and streams deltas then completion and DONE', async () => {
    const app = createTestApp();
    const res = await postBYOKStream(app, validBYOKBody());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseSsePayloads(res.text);
    expect(events[0]).toEqual({ type: 'text_delta', delta: 'Hello ' });
    expect(events[1]).toEqual({ type: 'text_delta', delta: 'stream' });
    expect(events[2]).toMatchObject({
      type: 'response_complete',
      data: { message: 'Hello stream', actions: [], suggestedStep: null },
    });
    expect(events[3]).toBe('[DONE]');
  });

  it('sends sanitized error SSE and not HTTP 500 when provider fails', async () => {
    const app = createTestApp();
    vi.mocked(anthropicStreamWithKey).mockRejectedValue(new Error('some weird internal thing'));
    const res = await postBYOKStream(app, validBYOKBody());
    expect(res.status).toBe(200);
    const events = parseSsePayloads(res.text);
    const errEvt = events.find(
      (e) => e !== '[DONE]' && (e as Record<string, unknown>).type === 'error',
    ) as Record<string, unknown>;
    expect(errEvt).toBeDefined();
    expect((errEvt.error as { message: string }).message).not.toContain('weird internal');
    expect(events[events.length - 1]).toBe('[DONE]');
  });

  it('does not leak API key in SSE error payload', async () => {
    const app = createTestApp();
    const evilKey = 'sk-ant-api03-SUPERSECRETKEY1234567890abcdef';
    vi.mocked(anthropicStreamWithKey).mockRejectedValue(new Error(`invalid api key: ${evilKey}`));
    const res = await postBYOKStream(app, validBYOKBody({ apiKey: evilKey }));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('SUPERSECRET');
    expect(res.text).not.toContain(evilKey);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Error Sanitizer — Unit Tests (scrubSecrets, classifyError)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Error sanitizer — API key scrubbing', () => {
  it('never includes an Anthropic API key in any error response field', async () => {
    const app = createTestApp();
    const evilKey = 'sk-ant-api03-SUPERSECRETKEY1234567890abcdef';
    vi.mocked(anthropicCompletionWithKey).mockRejectedValue(
      new Error(`invalid api key: ${evilKey}`),
    );

    const res = await postBYOK(app, validBYOKBody({ apiKey: evilKey }));
    const responseStr = JSON.stringify(res.body);
    expect(responseStr).not.toContain('SUPERSECRETKEY');
    expect(responseStr).not.toContain(evilKey);

    vi.mocked(anthropicCompletionWithKey).mockResolvedValue({
      message: 'test',
      actions: [],
      suggestedStep: null,
    });
  });
});
