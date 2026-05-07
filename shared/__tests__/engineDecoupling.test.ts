import { describe, it, expect } from 'vitest';
import { calculateProgressiveTax } from '../src/engine/brackets.js';
import { calculateScheduleSE } from '../src/engine/scheduleSE.js';
import { calculateTaxableSocialSecurity } from '../src/engine/socialSecurity.js';
import { FilingStatus } from '../src/types/index.js';
import { TAX_BRACKETS_2025, SE_TAX, SOCIAL_SECURITY } from '../src/constants/tax2025.js';
import { getConstants } from '../src/constants/taxYearRegistry.js';

describe('Engine Decoupling — Registry Integration', () => {
  describe('brackets.ts', () => {
    it('produces same result with default and explicit 2025 brackets', () => {
      const defaultResult = calculateProgressiveTax(100_000, FilingStatus.Single);
      const explicitResult = calculateProgressiveTax(100_000, FilingStatus.Single, TAX_BRACKETS_2025);
      expect(defaultResult).toEqual(explicitResult);
    });

    it('accepts custom brackets for hypothetical year', () => {
      const customBrackets = {
        ...TAX_BRACKETS_2025,
        [FilingStatus.Single]: [{ min: 0, max: Infinity, rate: 0.1 }],
      };
      const defaultResult = calculateProgressiveTax(50_000, FilingStatus.Single);
      const customResult = calculateProgressiveTax(50_000, FilingStatus.Single, customBrackets);
      expect(defaultResult.tax).toBe(5914);
      expect(customResult.tax).toBe(5000);
    });
  });

  describe('scheduleSE.ts', () => {
    it('produces same result with default and explicit SE_TAX constants', () => {
      const defaultResult = calculateScheduleSE(100_000, FilingStatus.Single);
      const explicitResult = calculateScheduleSE(100_000, FilingStatus.Single, 0, 0, SE_TAX);
      expect(defaultResult).toEqual(explicitResult);
    });

    it('accepts custom SE tax constants', () => {
      const customSE = { ...SE_TAX, SS_RATE: 0.2 };
      const defaultResult = calculateScheduleSE(100_000, FilingStatus.Single);
      const customResult = calculateScheduleSE(100_000, FilingStatus.Single, 0, 0, customSE);
      expect(customResult.socialSecurityTax).not.toBe(defaultResult.socialSecurityTax);
      expect(customResult.socialSecurityTax).toBe(18_470);
    });
  });

  describe('socialSecurity.ts', () => {
    it('produces same result with default and explicit SOCIAL_SECURITY constants', () => {
      const defaultResult = calculateTaxableSocialSecurity(10_000, 20_000, FilingStatus.Single);
      const explicitResult = calculateTaxableSocialSecurity(
        10_000,
        20_000,
        FilingStatus.Single,
        0,
        false,
        SOCIAL_SECURITY,
      );
      expect(defaultResult).toEqual(explicitResult);
    });

    it('accepts custom Social Security constants', () => {
      const customSS = { ...SOCIAL_SECURITY, SINGLE_BASE_AMOUNT: 20_000 };
      const defaultResult = calculateTaxableSocialSecurity(10_000, 20_000, FilingStatus.Single);
      const customResult = calculateTaxableSocialSecurity(
        10_000,
        20_000,
        FilingStatus.Single,
        0,
        false,
        customSS,
      );
      expect(defaultResult.taxableBenefits).toBe(0);
      expect(customResult.taxableBenefits).toBeGreaterThan(0);
    });
  });

  describe('getConstants() integration', () => {
    it('can pass registry constants to decoupled modules', () => {
      const c = getConstants(2025);
      const result = calculateProgressiveTax(100_000, FilingStatus.Single, c.brackets);
      const defaultResult = calculateProgressiveTax(100_000, FilingStatus.Single);
      expect(result).toEqual(defaultResult);
    });
  });
});
