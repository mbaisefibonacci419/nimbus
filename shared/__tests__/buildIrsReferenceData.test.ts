import { describe, it, expect } from 'vitest';
import { buildIrsReferenceData } from '../src/services/buildIrsReferenceData.js';

const FILING_STATUSES = [
  'single',
  'married_filing_jointly',
  'married_filing_separately',
  'head_of_household',
  'qualifying_surviving_spouse',
] as const;

describe('buildIrsReferenceData', () => {
  it('default output contains TAX YEAR 2025', () => {
    const out = buildIrsReferenceData({});
    expect(out).toContain('TAX YEAR 2025 REFERENCE DATA');
  });

  it('{ taxYear: 2026 } output contains TAX YEAR 2026', () => {
    const out = buildIrsReferenceData({ taxYear: 2026 });
    expect(out).toContain('TAX YEAR 2026 REFERENCE DATA');
    expect(out).not.toContain('TAX YEAR 2025 REFERENCE DATA');
  });

  it('all filing status mappings produce output with expected filer label', () => {
    const expectedShort: Record<(typeof FILING_STATUSES)[number], string> = {
      single: 'Single',
      married_filing_jointly: 'MFJ',
      married_filing_separately: 'MFS',
      head_of_household: 'HOH',
      qualifying_surviving_spouse: 'QSS',
    };
    for (const fs of FILING_STATUSES) {
      const out = buildIrsReferenceData({ filingStatus: fs });
      expect(out).toContain(`(${expectedShort[fs]} filer):`);
      expect(out.length).toBeGreaterThan(100);
    }
  });
});
