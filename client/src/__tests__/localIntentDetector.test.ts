/**
 * Local Intent Detector — deterministic chat intents (navigation, refund, completeness,
 * field reads, deletion) without LLM round-trips.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetState = vi.fn();

vi.mock('../store/taxReturnStore', () => ({
  useTaxReturnStore: {
    getState: () => mockGetState(),
  },
  WIZARD_STEPS: [
    { id: 'w2_income', label: 'Employment (W-2)', section: 'income' },
    { id: 'deduction_method', label: 'Deduction Method', section: 'deductions' },
    { id: 'tax_summary', label: 'Tax Summary', section: 'review' },
    { id: 'child_tax_credit', label: 'Child Tax Credit', section: 'credits' },
  ],
}));

const mockBuildDocumentInventory = vi.fn();

vi.mock('../services/documentInventoryService', () => ({
  buildDocumentInventory: (...args: unknown[]) => mockBuildDocumentInventory(...args),
}));

import { detectLocalIntent } from '../services/localIntentDetector';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetState.mockReturnValue({
    taxReturn: null,
    calculation: null,
  });
  mockBuildDocumentInventory.mockReturnValue({
    overallCompleteness: 80,
    totalFormsPending: 1,
    nonIncomeSections: [{ label: 'Filing status', status: 'complete' }],
    incomeGroups: [],
    pendingGroups: [],
    totalFormsEntered: 0,
  });
});

describe('detectLocalIntent — navigation', () => {
  it('go to W-2 → navigate to w2_income', () => {
    const r = detectLocalIntent('go to W-2');
    expect(r).not.toBeNull();
    expect(r!.actions).toEqual([{ type: 'navigate', stepId: 'w2_income' }]);
    expect(r!.message).toContain('Navigating');
  });

  it('show deductions → navigate to deduction_method', () => {
    const r = detectLocalIntent('show deductions');
    expect(r!.actions).toEqual([{ type: 'navigate', stepId: 'deduction_method' }]);
  });

  it('take me to review → navigate to tax_summary', () => {
    const r = detectLocalIntent('take me to review');
    expect(r!.actions).toEqual([{ type: 'navigate', stepId: 'tax_summary' }]);
  });

  it('GO TO W-2 matches like go to w-2', () => {
    const a = detectLocalIntent('GO TO W-2');
    const b = detectLocalIntent('go to w-2');
    expect(a?.actions).toEqual(b?.actions);
  });
});

describe('detectLocalIntent — refund / owe', () => {
  it("what's my refund → includes refund amount when calculation present", () => {
    mockGetState.mockReturnValue({
      taxReturn: { id: 'r1', incomeDiscovery: {} },
      calculation: {
        form1040: {
          refundAmount: 1250.5,
          amountOwed: 0,
          totalTax: 8000,
        },
      },
    });
    const r = detectLocalIntent("what's my refund?");
    expect(r).not.toBeNull();
    expect(r!.message).toMatch(/\$1,250\.5/);
    expect(r!.message.toLowerCase()).toContain('refund');
    expect(r!.followUpChips).toContain('How was this calculated?');
  });

  it('no calculation → helpful message', () => {
    mockGetState.mockReturnValue({ taxReturn: { id: 'r1' }, calculation: null });
    const r = detectLocalIntent('what is my refund');
    expect(r!.message).toContain("don't have your tax calculation");
  });
});

describe('detectLocalIntent — completeness', () => {
  it('am I done → summarizes inventory', () => {
    mockGetState.mockReturnValue({
      taxReturn: { id: 'r1', incomeDiscovery: {} },
      calculation: null,
    });
    mockBuildDocumentInventory.mockReturnValue({
      overallCompleteness: 72,
      totalFormsPending: 2,
      nonIncomeSections: [
        { label: 'Personal info', status: 'partial' },
        { label: 'Credits', status: 'complete' },
      ],
      incomeGroups: [],
      pendingGroups: [],
      totalFormsEntered: 0,
    });

    const r = detectLocalIntent('am I done');
    expect(mockBuildDocumentInventory).toHaveBeenCalled();
    expect(r!.message).toContain('72%');
    expect(r!.message).toContain('2 income form groups');
    expect(r!.message).toContain('Personal info');
    expect(r!.followUpChips).toContain('Go to review');
  });
});

describe('detectLocalIntent — field reads', () => {
  it("what's my AGI → dollar amount", () => {
    mockGetState.mockReturnValue({
      taxReturn: { id: 'r1' },
      calculation: { form1040: { agi: 98765.25 } },
    });
    const r = detectLocalIntent("what's my AGI");
    expect(r!.message).toMatch(/98,765\.25/);
    expect(r!.message).toContain('AGI');
  });
});

describe('detectLocalIntent — deletion (existing)', () => {
  it('delete the W-2 → remove_item', () => {
    mockGetState.mockReturnValue({
      taxReturn: {
        id: 'r1',
        w2Income: [{ employerName: 'Acme', wages: 50000 }],
        incomeDiscovery: {},
      },
      calculation: null,
    });
    const r = detectLocalIntent('delete the W-2');
    expect(r!.actions[0]).toMatchObject({ type: 'remove_item', itemType: 'w2' });
  });
});

describe('detectLocalIntent — fall through', () => {
  it('unknown phrase → null', () => {
    expect(detectLocalIntent('tell me about depreciation')).toBeNull();
  });

  it('plain message without delete verb → null', () => {
    expect(detectLocalIntent('hello there')).toBeNull();
  });
});
