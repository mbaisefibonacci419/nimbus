/**
 * Anthropic Client — BYOK adapter for Claude models.
 *
 * Creates a one-shot Anthropic client using the user's API key.
 * The key is never stored, logged, or cached.
 *
 * Tuning:
 *   - Assistant prefill: for Claude 3.x models, appends { role: "assistant",
 *     content: "{" } to force JSON output. Claude 4+ models don't support
 *     prefill, so we rely on the system prompt instruction instead.
 *   - Prompt caching: the static system prompt is marked with cache_control
 *     to get a 90% input token discount on subsequent messages in a session.
 */

import Anthropic from '@anthropic-ai/sdk';
import { parseResponse, buildIrsReferenceData } from '@nimbus/engine';
import type { ChatResponse } from '@nimbus/engine';

/** Claude 3.x models support assistant prefill; 4+ do not. */
function supportsAssistantPrefill(model: string): boolean {
  return model.includes('claude-3');
}

/**
 * Send a chat completion request using a user-provided Anthropic API key (BYOK mode).
 * Creates a one-shot client — the key is never stored or cached.
 */
export async function anthropicCompletionWithKey(
  apiKey: string,
  model: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: Record<string, unknown>,
  systemPrompt: string,
): Promise<ChatResponse> {
  // Anthropic's API data usage policy: API data is not used for model training.
  // See https://docs.anthropic.com/en/docs/data-usage-policy
  const client = new Anthropic({
    apiKey,
    timeout: 120_000,
  });

  const referenceData = buildIrsReferenceData({
    filingStatus: context.filingStatus as string | undefined,
    currentSection: context.currentSection as string | undefined,
    incomeDiscovery: context.incomeDiscovery as Record<string, string> | undefined,
    deductionMethod: context.deductionMethod as string | undefined,
    dependentCount: context.dependentCount as number | undefined,
  });
  const contextSuffix = `\n\n${referenceData}\n\nCURRENT CONTEXT:\n${JSON.stringify(context, null, 2)}`;

  const usePrefill = supportsAssistantPrefill(model);

  const mappedMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (usePrefill) {
    mappedMessages.push({ role: 'assistant', content: '{' });
  }

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    temperature: 0.3,
    system: [
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: contextSuffix,
      },
    ],
    messages: mappedMessages,
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseResponse(usePrefill ? '{' + raw : raw);
}

/**
 * Stream a chat completion using BYOK. Invokes `onTextDelta` for each text delta from the model,
 * then parses the full reply with `parseResponse` (same JSON rules as non-streaming).
 *
 * @param signal - Optional abort signal (e.g. client disconnected) to cancel the upstream request.
 */
export async function anthropicStreamWithKey(
  apiKey: string,
  model: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  context: Record<string, unknown>,
  systemPrompt: string,
  onTextDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const client = new Anthropic({
    apiKey,
    timeout: 120_000,
  });

  const referenceData = buildIrsReferenceData({
    filingStatus: context.filingStatus as string | undefined,
    currentSection: context.currentSection as string | undefined,
    incomeDiscovery: context.incomeDiscovery as Record<string, string> | undefined,
    deductionMethod: context.deductionMethod as string | undefined,
    dependentCount: context.dependentCount as number | undefined,
  });
  const contextSuffix = `\n\n${referenceData}\n\nCURRENT CONTEXT:\n${JSON.stringify(context, null, 2)}`;

  const usePrefill = supportsAssistantPrefill(model);

  const mappedMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (usePrefill) {
    mappedMessages.push({ role: 'assistant', content: '{' });
  }

  const stream = client.messages.stream(
    {
      model,
      max_tokens: 2048,
      temperature: 0.3,
      system: [
        {
          type: 'text' as const,
          text: systemPrompt,
          cache_control: { type: 'ephemeral' as const },
        },
        {
          type: 'text' as const,
          text: contextSuffix,
        },
      ],
      messages: mappedMessages,
    },
    { signal },
  );

  let accumulated = '';

  stream.on('text', (delta) => {
    onTextDelta(delta);
    accumulated += delta;
  });

  try {
    await stream.done();
  } catch (streamErr: any) {
    if (signal?.aborted) throw streamErr;
    // Stream ended abnormally but we may have partial content
    console.warn('[anthropic-stream] stream.done() error, accumulated', accumulated.length, 'chars:', streamErr.message);
    if (accumulated.length === 0) throw streamErr;
  }

  const raw = usePrefill ? '{' + accumulated : accumulated;
  return parseResponse(raw);
}

/**
 * Send a completion request using a user-provided Anthropic key and return the raw text.
 * Used by batch endpoints where the response isn't in chat JSON format.
 */
export async function rawAnthropicCompletionWithKey(
  apiKey: string,
  model: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
): Promise<string> {
  const client = new Anthropic({
    apiKey,
    timeout: 120_000,
  });

  const usePrefill = supportsAssistantPrefill(model);

  const mappedMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (usePrefill) {
    mappedMessages.push({ role: 'assistant', content: '{' });
  }

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature: 0.3,
    system: systemPrompt,
    messages: mappedMessages,
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return usePrefill ? '{' + raw : raw;
}

/**
 * Send a vision extraction request using BYOK. Sends an image to Claude's vision
 * capabilities for direct document reading — much more accurate than OCR text.
 */
export async function visionExtractionWithKey(
  apiKey: string,
  model: string,
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const client = new Anthropic({
    apiKey,
    timeout: 120_000,
  });

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature: 0.0,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return raw;
}

/**
 * Send a PDF document to Claude for direct extraction using the document content block.
 * Claude can natively read PDF pages without converting to images first.
 */
export async function pdfExtractionWithKey(
  apiKey: string,
  model: string,
  pdfBase64: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const client = new Anthropic({
    apiKey,
    timeout: 180_000,
  });

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature: 0.0,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          } as any,
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return raw;
}
