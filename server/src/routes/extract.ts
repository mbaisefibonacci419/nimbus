/**
 * Extract Routes — POST /api/extract/fields, POST /api/extract/vision
 *
 * AI-enhanced field extraction for scanned tax documents.
 * BYOK only — user's own Anthropic API key, used once and discarded.
 *
 * Privacy model:
 *   - Client runs scanForPII() before sending (primary gate)
 *   - Server runs stripPII() again (defense-in-depth)
 *   - Only sanitized OCR text is sent to the LLM
 *   - API key used once and discarded (same BYOK pattern as batch)
 *
 * Tax advice boundary:
 *   The AI extracts field values — it NEVER provides tax advice.
 *   "Engine calculates, AI narrates, user decides."
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { handleLLMError, handleRouteError } from '../services/errorSanitizer.js';
import { rawAnthropicCompletionWithKey, visionExtractionWithKey, pdfExtractionWithKey } from '../services/anthropicClient.js';
import { config } from '../config.js';
import { resolveBYOKAnthropicKey, validateBYOKAnthropicKey } from '../services/byokApiKey.js';
import { stripPII } from '../services/piiStripper.js';
import { checkRateLimit as sharedCheckRateLimit, getClientIp, sendRateLimitResponse } from '../services/rateLimiter.js';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserMessage,
  parseExtractionResponse,
} from '../services/ocrExtractPrompt.js';
import { extractWithDocling, isDoclingAvailable } from '../services/doclingExtractor.js';

const router = Router();

// ─── Request Validation ─────────────────────────────

const FieldExtractionSchema = z.object({
  ocrText: z.string().min(10).max(20_000),
  formTypeHint: z.string().max(20).nullable(),
  provider: z.literal('anthropic'),
  apiKey: z.string().max(200).optional().default(''),
  model: z.string().min(1).max(100),
});

const VisionExtractionSchema = z.object({
  imageBase64: z.string().min(100).max(10_000_000), // up to ~7.5MB decoded
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  formTypeHint: z.string().max(20).nullable(),
  provider: z.literal('anthropic'),
  apiKey: z.string().max(200).optional().default(''),
  model: z.string().min(1).max(100),
});

// ─── Route ──────────────────────────────────────────

/**
 * POST /api/extract/fields
 *
 * Accepts sanitized OCR text and returns AI-extracted field values
 * with per-field confidence scores.
 */
router.post('/fields', async (req: Request, res: Response) => {
  try {
    // 1. Rate limit
    const clientIp = getClientIp(req);
    if (!clientIp) {
      res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } });
      return;
    }
    if (!sharedCheckRateLimit(clientIp, 'extract', config.extractRateLimitMax, config.rateLimitWindowMs)) {
      sendRateLimitResponse(res, 'Too many extraction requests. Please wait a moment and try again.', Math.ceil(config.rateLimitWindowMs / 1000));
      return;
    }

    // 2. Validate request body
    const parseResult = FieldExtractionSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          message: 'Invalid request body.',
          code: 'VALIDATION_ERROR',
          detail: parseResult.error.issues.map((i) => i.message).join('; '),
        },
      });
      return;
    }

    const { ocrText, formTypeHint, apiKey: clientKeyField, model } = parseResult.data;

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

    // 4. Strip PII (defense-in-depth — client already ran scanForPII)
    const piiResult = stripPII(ocrText);
    const sanitizedText = piiResult.sanitized;

    if (piiResult.strippedCount > 0) {
      console.log(`[extract] Stripped ${piiResult.strippedCount} PII items (${piiResult.strippedTypes.join(', ')})`);
    }

    // 5. Build the extraction request
    const userMessage = buildExtractionUserMessage(sanitizedText, formTypeHint);
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: userMessage },
    ];

    // 6. Dispatch to Anthropic
    let raw: string;
    try {
      raw = await rawAnthropicCompletionWithKey(apiKey, model, messages, EXTRACTION_SYSTEM_PROMPT);
    } catch (err: any) {
      if (handleLLMError(err, res, 'extract')) return;
      throw err;
    }

    // 7. Parse the extraction response
    console.log(`[extract] Response length: ${raw.length}`);
    const result = parseExtractionResponse(raw);

    const fieldCount = Object.keys(result.fields).length;
    console.log(`[extract] Extracted ${fieldCount} fields, formType: ${result.formType} (${result.formTypeConfidence})`);

    // 8. Return results
    res.json({ data: result });
  } catch (err) {
    handleRouteError(err, res, 'extract');
  }
});

/**
 * POST /api/extract/vision
 *
 * Accepts a base64 document image and sends it directly to Claude Vision.
 *
 * Privacy trade-off: Unlike /fields, the image is NOT PII-stripped — stripping
 * is not practical server-side on raster data. The user opts in via BYOK and
 * chooses better extraction quality over local redaction of image pixels.
 */
router.post('/vision', async (req: Request, res: Response) => {
  try {
    const clientIp = getClientIp(req);
    if (!clientIp) {
      res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } });
      return;
    }
    if (!sharedCheckRateLimit(clientIp, 'extract', config.extractRateLimitMax, config.rateLimitWindowMs)) {
      sendRateLimitResponse(res, 'Too many extraction requests. Please wait a moment and try again.', Math.ceil(config.rateLimitWindowMs / 1000));
      return;
    }

    const parseResult = VisionExtractionSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          message: 'Invalid request body.',
          code: 'VALIDATION_ERROR',
          detail: parseResult.error.issues.map((i) => i.message).join('; '),
        },
      });
      return;
    }

    const { imageBase64, mediaType, formTypeHint, apiKey: clientKeyField, model } = parseResult.data;

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

    const hintSuffix = formTypeHint
      ? ` FORM TYPE HINT: ${formTypeHint}. If you detect a different form type, use the detected type.`
      : '';

    const userPrompt =
      `Extract all field values from this tax document image. If you can identify the form type (W-2, 1099-INT, etc.), include it in the JSON.${hintSuffix}`;

    let raw: string;
    try {
      raw = await visionExtractionWithKey(
        apiKey,
        model,
        imageBase64,
        mediaType,
        EXTRACTION_SYSTEM_PROMPT,
        userPrompt,
      );
    } catch (err: any) {
      if (handleLLMError(err, res, 'extract')) return;
      throw err;
    }

    console.log(`[extract/vision] Response length: ${raw.length}`);
    const result = parseExtractionResponse(raw);

    const fieldCount = Object.keys(result.fields).length;
    console.log(`[extract/vision] Extracted ${fieldCount} fields, formType: ${result.formType} (${result.formTypeConfidence})`);

    res.json({ data: result });
  } catch (err) {
    handleRouteError(err, res, 'extract');
  }
});

// ─── PDF Upload + Docling Extraction ─────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

/**
 * POST /api/extract/pdf
 *
 * Accepts a PDF file upload and extracts structured tax form data.
 * Pipeline: Docling (local Python CLI) → Claude Vision (API fallback).
 */
router.post('/pdf', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const clientIp = getClientIp(req);
    if (!clientIp) {
      res.status(400).json({ error: { message: 'Unable to determine client IP.', code: 'INVALID_IP' } });
      return;
    }
    if (!sharedCheckRateLimit(clientIp, 'extract', config.extractRateLimitMax, config.rateLimitWindowMs)) {
      sendRateLimitResponse(res, 'Too many extraction requests. Please wait a moment and try again.', Math.ceil(config.rateLimitWindowMs / 1000));
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: { message: 'No PDF file uploaded.', code: 'NO_FILE' } });
      return;
    }

    const formTypeHint = (req.body?.formTypeHint as string) || null;
    const model = (req.body?.model as string) || 'claude-sonnet-4-6';
    const clientApiKey = (req.body?.apiKey as string) || '';

    // Try Docling first (local Python CLI, no API key needed)
    const doclingResult = await extractWithDocling(req.file.buffer, req.file.originalname);

    if (doclingResult?.success && Object.keys(doclingResult.fields).length > 0) {
      console.log(`[extract/pdf] Docling: ${Object.keys(doclingResult.fields).length} fields, formType: ${doclingResult.formType}`);
      res.json({
        data: {
          formType: doclingResult.formType || '',
          formTypeConfidence: doclingResult.formTypeConfidence,
          fields: doclingResult.fields,
          method: 'docling',
        },
      });
      return;
    }

    // Docling unavailable or returned poor results — fall back to Claude Vision
    const { apiKey, trimmedClientKey } = resolveBYOKAnthropicKey(clientApiKey);
    if (!apiKey) {
      if (doclingResult?.success) {
        res.json({
          data: {
            formType: doclingResult.formType || '',
            formTypeConfidence: doclingResult.formTypeConfidence,
            fields: doclingResult.fields,
            rawMarkdown: doclingResult.rawMarkdown,
            method: 'docling',
          },
        });
        return;
      }
      res.status(503).json({
        error: {
          message: 'PDF extraction requires Python + docling (for local processing) or an Anthropic API key (for Vision fallback).',
          code: 'EXTRACTION_UNAVAILABLE',
        },
      });
      return;
    }

    const keyValidation = validateBYOKAnthropicKey(trimmedClientKey, apiKey);
    if (!keyValidation.ok) {
      res.status(400).json({ error: { message: keyValidation.message, code: keyValidation.code } });
      return;
    }

    const pdfBase64 = req.file.buffer.toString('base64');

    const hintSuffix = formTypeHint
      ? ` FORM TYPE HINT: ${formTypeHint}. If you detect a different form type, use the detected type.`
      : '';
    const userPrompt =
      `Extract all field values from this tax document. If you can identify the form type (W-2, 1099-INT, etc.), include it in the JSON.${hintSuffix}`;

    let raw: string;
    try {
      raw = await pdfExtractionWithKey(
        apiKey,
        model,
        pdfBase64,
        EXTRACTION_SYSTEM_PROMPT,
        userPrompt,
      );
    } catch (err: any) {
      if (handleLLMError(err, res, 'extract')) return;
      throw err;
    }

    console.log(`[extract/pdf] Vision fallback response length: ${raw.length}`);
    const visionResult = parseExtractionResponse(raw);

    res.json({
      data: {
        ...visionResult,
        method: 'vision',
      },
    });
  } catch (err) {
    handleRouteError(err, res, 'extract');
  }
});

/**
 * GET /api/extract/capabilities
 * Reports which extraction methods are available.
 */
router.get('/capabilities', async (_req: Request, res: Response) => {
  const doclingAvailable = await isDoclingAvailable();
  const hasServerKey = Boolean(config.anthropicApiKey);
  res.json({
    data: {
      docling: doclingAvailable,
      vision: hasServerKey,
      textExtraction: true,
    },
  });
});

export default router;
