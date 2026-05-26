/**
 * Docling PDF Extraction Service
 *
 * Uses docling-sdk (wrapping IBM's Docling document converter) to extract
 * structured data from tax forms. Runs locally via CLI mode — no data leaves
 * the server.
 *
 * Flow: PDF buffer → Docling CLI → Markdown/JSON output → field mapping
 *
 * Requires Python 3.10+ and `pip install docling` for CLI mode.
 * Falls back gracefully if Python/docling is unavailable.
 */

import { createCLIClient } from 'docling-sdk';
import type { DoclingCLIClient } from 'docling-sdk';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

export interface FormExtractionResult {
  formType: string | null;
  formTypeConfidence: 'high' | 'medium' | 'low';
  fields: Record<string, { value: string | number; confidence: 'high' | 'medium' | 'low' }>;
  rawMarkdown: string;
  success: boolean;
  error?: string;
}

let _doclingAvailable: boolean | null = null;
let _cliClient: DoclingCLIClient | null = null;

function getClient(): DoclingCLIClient {
  if (!_cliClient) {
    const venvPath = path.join(PROJECT_ROOT, '.docling-venv');
    _cliClient = createCLIClient({
      outputDir: path.join(os.tmpdir(), 'nimbus-docling-output'),
      pythonPath: path.join(venvPath, 'bin', 'python'),
      doclingPath: path.join(venvPath, 'bin', 'docling'),
    });
  }
  return _cliClient;
}

export async function isDoclingAvailable(): Promise<boolean> {
  if (_doclingAvailable !== null) return _doclingAvailable;
  try {
    const client = getClient();
    const available = (await client.checkAvailability()) ?? false;
    _doclingAvailable = available;
    return available;
  } catch {
    _doclingAvailable = false;
    return false;
  }
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function detectFormType(text: string): { type: string | null; confidence: 'high' | 'medium' | 'low' } {
  const upper = text.toUpperCase();
  if (upper.includes('WAGE AND TAX STATEMENT') || upper.includes('FORM W-2'))
    return { type: 'W-2', confidence: 'high' };
  if (upper.includes('1099-INT')) return { type: '1099-INT', confidence: 'high' };
  if (upper.includes('1099-DIV')) return { type: '1099-DIV', confidence: 'high' };
  if (upper.includes('1099-NEC')) return { type: '1099-NEC', confidence: 'high' };
  if (upper.includes('1099-MISC')) return { type: '1099-MISC', confidence: 'high' };
  if (upper.includes('1099-R')) return { type: '1099-R', confidence: 'high' };
  if (upper.includes('1099-G')) return { type: '1099-G', confidence: 'high' };
  if (upper.includes('1099-B')) return { type: '1099-B', confidence: 'high' };
  if (upper.includes('1099-K')) return { type: '1099-K', confidence: 'high' };
  if (upper.includes('SSA-1099')) return { type: 'SSA-1099', confidence: 'high' };
  if (upper.includes('1098-T')) return { type: '1098-T', confidence: 'high' };
  if (upper.includes('1098-E')) return { type: '1098-E', confidence: 'high' };
  if (upper.includes('1098') && !upper.includes('1098-')) return { type: '1098', confidence: 'medium' };
  if (upper.includes('1095-A')) return { type: '1095-A', confidence: 'high' };
  if (upper.includes('SCHEDULE K-1')) return { type: 'K-1', confidence: 'high' };
  return { type: null, confidence: 'low' };
}

function extractW2FromMarkdown(
  markdown: string,
): Record<string, { value: string | number; confidence: 'high' | 'medium' | 'low' }> {
  const fields: Record<string, { value: string | number; confidence: 'high' | 'medium' | 'low' }> = {};
  const lines = markdown.split('\n');

  for (const line of lines) {
    if (/\b(INC|LLC|CORP|CO\b|COMPANY|GROUP|SERVICES|ENTERPRISES)/i.test(line)) {
      const name = line.replace(/^[c\s|]+/i, '').trim();
      if (name.length > 2 && name.length < 100 && !fields.employerName) {
        fields.employerName = { value: name, confidence: 'medium' };
      }
    }
  }

  const amountPatterns: Array<{ key: string; pattern: RegExp }> = [
    { key: 'wages', pattern: /(?:GROSS\s*PAY|wages.*comp|box\s*(?:01|1)\b)[^\d]*?([\d,]+\.?\d*)/i },
    { key: 'federalTaxWithheld', pattern: /(?:FED\.?\s*INCOME\s*TAX|federal\s*income\s*tax\s*withheld|box\s*(?:02|2)\b)[^\d]*?([\d,]+\.?\d*)/i },
    { key: 'socialSecurityWages', pattern: /(?:SOCIAL\s*SECURITY\s*WAGES|box\s*(?:03|3)\b)[^\d]*?([\d,]+\.?\d*)/i },
    { key: 'socialSecurityTax', pattern: /(?:SOCIAL\s*SECURITY\s*TAX\s*WITHHELD|box\s*(?:04|4)\b)[^\d]*?([\d,]+\.?\d*)/i },
    { key: 'medicareWages', pattern: /(?:MEDICARE\s*WAGES|box\s*(?:05|5)\b)[^\d]*?([\d,]+\.?\d*)/i },
    { key: 'medicareTax', pattern: /(?:MEDICARE\s*TAX\s*WITHHELD|box\s*(?:06|6)\b)[^\d]*?([\d,]+\.?\d*)/i },
    { key: 'stateWages', pattern: /(?:STATE\s*WAGES|box\s*(?:16)\b)[^\d]*?([\d,]+\.?\d*)/i },
    { key: 'stateTaxWithheld', pattern: /(?:STATE\s*INCOME\s*TAX|box\s*(?:17)\b)[^\d]*?([\d,]+\.?\d*)/i },
  ];

  for (const { key, pattern } of amountPatterns) {
    const match = markdown.match(pattern);
    if (match?.[1]) {
      const amount = parseAmount(match[1]);
      if (amount !== null && amount > 0) {
        fields[key] = { value: amount, confidence: 'high' };
      }
    }
  }

  const stateMatch = markdown.match(
    /\b(CA|NY|TX|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|MT|RI|DE|SD|ND|AK|DC|VT|WY)\b.*(?:state\s*(?:id|employer)|employer.*state)/i,
  );
  if (stateMatch) {
    fields.state = { value: stateMatch[1].toUpperCase(), confidence: 'high' };
  } else {
    const stateMatch2 = markdown.match(
      /\b(CA|NY|TX|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|MT|RI|DE|SD|ND|AK|DC|VT|WY)\s+\d{2,3}-?\d{4,7}/,
    );
    if (stateMatch2) {
      fields.state = { value: stateMatch2[1].toUpperCase(), confidence: 'high' };
    }
  }

  return fields;
}

function extractGenericFromMarkdown(
  markdown: string,
): Record<string, { value: string | number; confidence: 'high' | 'medium' | 'low' }> {
  const fields: Record<string, { value: string | number; confidence: 'high' | 'medium' | 'low' }> = {};

  for (const line of markdown.split('\n')) {
    if (/\b(INC|LLC|CORP|BANK|CREDIT\s*UNION|FINANCIAL|BROKERAGE|FUND)/i.test(line)) {
      const name = line.trim();
      if (name.length > 2 && name.length < 100) {
        fields.payerName = { value: name, confidence: 'medium' };
        break;
      }
    }
  }

  const amountRegex = /\$?([\d,]+\.\d{2})\b/g;
  let match;
  const amounts: Array<{ value: number }> = [];
  while ((match = amountRegex.exec(markdown)) !== null) {
    const val = parseAmount(match[1]);
    if (val !== null && val > 0) {
      amounts.push({ value: val });
    }
  }
  if (amounts.length > 0) {
    fields.amount = { value: amounts[0].value, confidence: 'medium' };
  }

  return fields;
}

/**
 * Extract structured data from a PDF using Docling.
 * Returns null if docling CLI is unavailable (caller should fall back to Vision).
 */
export async function extractWithDocling(
  pdfBuffer: Buffer,
  originalFilename: string,
): Promise<FormExtractionResult | null> {
  if (!(await isDoclingAvailable())) {
    return null;
  }

  try {
    const client = getClient();
    const result = await client.convert(pdfBuffer, originalFilename, {
      to_formats: ['md'],
      do_ocr: true,
    });

    if (result.status === 'failure') {
      console.error('[docling] Conversion failed:', result.errors);
      return {
        formType: null,
        formTypeConfidence: 'low',
        fields: {},
        rawMarkdown: '',
        success: false,
        error: result.errors?.map((e: { message: string }) => e.message).join('; ') || 'Conversion failed',
      };
    }

    const rawMarkdown = result.document.md_content || result.document.text_content || '';

    if (!rawMarkdown) {
      return {
        formType: null,
        formTypeConfidence: 'low',
        fields: {},
        rawMarkdown: '',
        success: false,
        error: 'Docling produced no text output',
      };
    }

    const { type: formType, confidence: formTypeConfidence } = detectFormType(rawMarkdown);

    let fields: Record<string, { value: string | number; confidence: 'high' | 'medium' | 'low' }>;
    if (formType === 'W-2') {
      fields = extractW2FromMarkdown(rawMarkdown);
    } else if (formType) {
      fields = extractGenericFromMarkdown(rawMarkdown);
    } else {
      fields = {};
    }

    return {
      formType,
      formTypeConfidence,
      fields,
      rawMarkdown,
      success: true,
    };
  } catch (err: any) {
    console.error('[docling] Extraction failed:', err.message);
    return {
      formType: null,
      formTypeConfidence: 'low',
      fields: {},
      rawMarkdown: '',
      success: false,
      error: err.message,
    };
  }
}
