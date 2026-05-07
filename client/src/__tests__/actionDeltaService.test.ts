/**
 * Unit tests for post-action calculation deltas (multi-turn impact messages).
 */

import { describe, it, expect } from 'vitest';
import type { CalculationResult } from '@nimbus/engine';
import { computeActionDelta } from '../services/actionDeltaService';

function makeCalc(
  form1040: Partial<{
    refundAmount: number;
    amountOwed: number;
    agi: number;
    taxableIncome: number;
    totalCredits: number;
    totalTax: number;
  }>,
): CalculationResult {
  return {
    form1040: {
      refundAmount: 0,
      amountOwed: 0,
      agi: 0,
      taxableIncome: 0,
      totalCredits: 0,
      totalTax: 0,
      ...form1040,
    },
  } as CalculationResult;
}

describe('computeActionDelta', () => {
  it('returns not significant when both calculations are null', () => {
    const r = computeActionDelta(null, null);
    expect(r.significant).toBe(false);
    expect(r.deltas).toEqual([]);
    expect(r.summaryText).toBe('');
  });

  it('handles one null calculation gracefully', () => {
    expect(computeActionDelta(makeCalc({}), null)).toEqual({
      significant: false,
      deltas: [],
      summaryText: '',
    });
    expect(computeActionDelta(null, makeCalc({}))).toEqual({
      significant: false,
      deltas: [],
      summaryText: '',
    });
  });

  it('returns not significant when metrics do not change', () => {
    const c = makeCalc({
      refundAmount: 1200,
      amountOwed: 0,
      agi: 80000,
      taxableIncome: 60000,
      totalCredits: 2000,
      totalTax: 9000,
    });
    const r = computeActionDelta(c, makeCalc({
      refundAmount: 1200,
      amountOwed: 0,
      agi: 80000,
      taxableIncome: 60000,
      totalCredits: 2000,
      totalTax: 9000,
    }));
    expect(r.significant).toBe(false);
    expect(r.summaryText).toBe('');
    expect(r.deltas.every((d) => d.direction === 'unchanged')).toBe(true);
  });

  it('returns significant when refund changes by more than $100', () => {
    const before = makeCalc({ refundAmount: 1200 });
    const after = makeCalc({ refundAmount: 1350 });
    const r = computeActionDelta(before, after);
    expect(r.significant).toBe(true);
    const refund = r.deltas.find((d) => d.label === 'Federal Refund');
    expect(refund?.delta).toBe(150);
    expect(refund?.direction).toBe('up');
  });

  it('computes direction up, down, and unchanged', () => {
    const base = makeCalc({
      agi: 100000,
      taxableIncome: 80000,
      totalTax: 10000,
    });
    const up = computeActionDelta(
      base,
      makeCalc({ agi: 100000, taxableIncome: 80000, totalTax: 10100 }),
    );
    expect(up.deltas.find((d) => d.label === 'Total Tax')?.direction).toBe('up');

    const down = computeActionDelta(
      base,
      makeCalc({ agi: 99000, taxableIncome: 80000, totalTax: 10000 }),
    );
    expect(down.deltas.find((d) => d.label === 'Adjusted Gross Income')?.direction).toBe(
      'down',
    );

    const flat = computeActionDelta(base, base);
    expect(flat.deltas.every((d) => d.direction === 'unchanged')).toBe(true);
  });

  it('includes only metrics with absolute change > $50 in summary text', () => {
    const before = makeCalc({
      refundAmount: 0,
      taxableIncome: 100000,
    });
    const after = makeCalc({
      refundAmount: 60,
      taxableIncome: 100040,
    });
    const r = computeActionDelta(before, after);
    expect(r.summaryText).toContain('federal refund');
    expect(r.summaryText).not.toContain('taxable income');
    expect(r.significant).toBe(false);
  });

  it('formats summary amounts with dollar signs and grouping commas', () => {
    const before = makeCalc({ refundAmount: 1200, agi: 90000 });
    const after = makeCalc({ refundAmount: 1550, agi: 89500 });
    const r = computeActionDelta(before, after);
    expect(r.summaryText).toContain('~$350');
    expect(r.summaryText).toContain('~$1,200');
    expect(r.summaryText).toContain('~$1,550');
    expect(r.summaryText).toContain('~$500');
    expect(r.summaryText).toContain('~$90,000');
    expect(r.summaryText).toContain('~$89,500');
    expect(r.significant).toBe(true);
  });

  it('returns not significant when form1040 is missing', () => {
    const r = computeActionDelta({} as CalculationResult, {} as CalculationResult);
    expect(r).toEqual({ significant: false, deltas: [], summaryText: '' });
  });
});
