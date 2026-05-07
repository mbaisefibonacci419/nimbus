import type { CalculationResult, CalculationTrace } from '@nimbus/engine';

export interface GroundingDiscrepancy {
  mentionedAmount: number;
  closestKnownAmount: number;
  field: string;
  divergencePercent: number;
}

export interface GroundingResult {
  verified: boolean;
  discrepancies: GroundingDiscrepancy[];
  footnote: string | null;
}

const DOLLAR_REGEX = /\$[\d,]+(?:\.\d{2})?/g;

const GROUNDING_FOOTNOTE =
  'Note: Some amounts mentioned may not match your current calculation. Verify figures before relying on them.';

interface KnownAmount {
  field: string;
  value: number;
}

function parseDollarToken(raw: string): number {
  const n = parseFloat(raw.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function withinTenPercent(a: number, b: number): boolean {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denom <= 0.1;
}

function pctDivergence(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.round((Math.abs(a - b) / denom) * 1000) / 10;
}

function collectForm1040Amounts(form1040: CalculationResult['form1040']): KnownAmount[] {
  const out: KnownAmount[] = [];
  for (const [key, val] of Object.entries(form1040)) {
    if (typeof val === 'number' && val > 0 && Number.isFinite(val)) {
      out.push({ field: `form1040.${key}`, value: val });
    }
  }
  return out;
}

function collectTraceAmounts(traces: CalculationTrace[] | undefined): KnownAmount[] {
  const out: KnownAmount[] = [];

  const visit = (t: CalculationTrace) => {
    if (typeof t.value === 'number' && t.value > 0 && Number.isFinite(t.value)) {
      out.push({ field: t.lineId || t.label, value: t.value });
    }
    for (const inp of t.inputs ?? []) {
      if (typeof inp.value === 'number' && inp.value > 0 && Number.isFinite(inp.value)) {
        out.push({ field: inp.lineId || inp.label, value: inp.value });
      }
    }
    for (const c of t.children ?? []) visit(c);
  };

  if (traces) {
    for (const t of traces) visit(t);
  }
  return out;
}

export function validateResponseGrounding(
  responseText: string,
  calculation: CalculationResult | null,
): GroundingResult {
  if (calculation == null) {
    return { verified: true, discrepancies: [], footnote: null };
  }

  const form1040 = calculation.form1040;
  if (!form1040) {
    return { verified: true, discrepancies: [], footnote: null };
  }

  const known: KnownAmount[] = [
    ...collectForm1040Amounts(form1040),
    ...collectTraceAmounts(calculation.traces),
  ];

  if (known.length === 0) {
    return { verified: true, discrepancies: [], footnote: null };
  }

  const mentionedSet = new Set<number>();
  const matches = responseText.matchAll(DOLLAR_REGEX);
  for (const m of matches) {
    const n = parseDollarToken(m[0]);
    if (!Number.isFinite(n) || n < 100) continue;
    mentionedSet.add(n);
  }

  if (mentionedSet.size === 0) {
    return { verified: true, discrepancies: [], footnote: null };
  }

  const discrepancies: GroundingDiscrepancy[] = [];

  for (const amount of mentionedSet) {
    let matched = false;
    for (const k of known) {
      if (withinTenPercent(amount, k.value)) {
        matched = true;
        break;
      }
    }
    if (matched) continue;

    let best: KnownAmount | null = null;
    let bestAbs = Infinity;
    for (const k of known) {
      const d = Math.abs(amount - k.value);
      if (d < bestAbs) {
        bestAbs = d;
        best = k;
      }
    }
    if (!best) continue;

    discrepancies.push({
      mentionedAmount: amount,
      closestKnownAmount: best.value,
      field: best.field,
      divergencePercent: pctDivergence(amount, best.value),
    });
  }

  const verified = discrepancies.length === 0;
  const footnote = verified ? null : GROUNDING_FOOTNOTE;

  return { verified, discrepancies, footnote };
}
