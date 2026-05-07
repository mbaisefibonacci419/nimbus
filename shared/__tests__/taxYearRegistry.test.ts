import { describe, it, expect } from 'vitest';
import {
  getConstants,
  isSupportedYear,
  getSupportedYears,
  DEFAULT_TAX_YEAR,
} from '../src/constants/taxYearRegistry.js';
import * as tax2025 from '../src/constants/tax2025.js';
import { AMT_2025 } from '../src/constants/amt2025.js';
import { EITC_BRACKETS, INVESTMENT_INCOME_LIMIT } from '../src/engine/eitc.js';

/** Every camelCase key on TaxYearConstants except `taxYear`, `provisions`, and `eitc` (eitc is a bundle). */
const EXPECTED_TAX2025_GROUPS = [
  'brackets',
  'standardDeduction',
  'additionalStandardDeduction',
  'dependentStandardDeduction',
  'seTax',
  'qbi',
  'homeOffice',
  'homeOfficeDepreciation',
  'vehicle',
  'vehicleDepreciation',
  'section179',
  'macrsGdsRates',
  'macrsGdsRatesMidQuarter',
  'bonusDepreciationRate2025',
  'depreciationTaxYear',
  'scheduleA',
  'childTaxCredit',
  'educationCredits',
  'estimatedTax',
  'hsa',
  'archerMsa',
  'studentLoanInterest',
  'ira',
  'capitalGainsRates',
  'niit',
  'qcd',
  'earlyDistribution',
  'actc',
  'dependentCare',
  'saversCredit',
  'cleanEnergy',
  'hsaDistributions',
  'scheduleD',
  'socialSecurity',
  'educatorExpenses',
  'scheduleE',
  'form8582',
  'evCredit',
  'energyEfficiency',
  'foreignTaxCredit',
  'sanctionedCountries',
  'excessSsTax',
  'alimony',
  'estimatedTaxPenalty',
  'kiddieTax',
  'feie',
  'scheduleH',
  'nol',
  'adoptionCredit',
  'dependentCareFsa',
  'premiumTaxCredit',
  'schedule1A',
  'homeSaleExclusion',
  'charitableAgiLimits',
  'form8283',
  'cancellationOfDebt',
  'excessContribution',
  'esaContributionLimit',
  'scholarshipCredit',
  'emergencyDistribution',
  'distribution529',
  'qoz',
  'form4137',
  'dependentCareEmployer',
  'scheduleR',
  'solo401k',
  'sepIra',
  'simpleIra',
  'ltcPremiumLimits',
  'evRefueling',
  'plausibility',
  'amt',
] as const;

describe('taxYearRegistry', () => {
  it('getConstants(2025) returns a valid object with taxYear 2025', () => {
    const c = getConstants(2025);
    expect(c.taxYear).toBe(2025);
    expect(c.provisions).toBeDefined();
    expect(c.eitc).toBeDefined();
  });

  it('getConstants(2025).brackets matches TAX_BRACKETS_2025 (same reference)', () => {
    const c = getConstants(2025);
    expect(c.brackets).toBe(tax2025.TAX_BRACKETS_2025);
  });

  it('getConstants(2025).amt matches AMT_2025 (same reference)', () => {
    const c = getConstants(2025);
    expect(c.amt).toBe(AMT_2025);
  });

  it('getConstants(2025) provisions: Schedule 1-A on, tips/overtime exclusion off', () => {
    const c = getConstants(2025);
    expect(c.provisions.hasSchedule1A).toBe(true);
    expect(c.provisions.hasTipsOvertimeExclusion).toBe(false);
  });

  it('getConstants(2024) throws with not registered message', () => {
    expect(() => getConstants(2024)).toThrow(/not registered/);
  });

  it('isSupportedYear', () => {
    expect(isSupportedYear(2025)).toBe(true);
    expect(isSupportedYear(2024)).toBe(false);
  });

  it('getSupportedYears returns [2025]', () => {
    expect(getSupportedYears()).toEqual([2025]);
  });

  it('DEFAULT_TAX_YEAR', () => {
    expect(DEFAULT_TAX_YEAR).toBe(2025);
  });

  it('all major constant groups from tax2025 + amt + eitc are present', () => {
    const c = getConstants(2025);
    for (const k of EXPECTED_TAX2025_GROUPS) {
      expect(c).toHaveProperty(k);
      expect((c as Record<string, unknown>)[k]).toBeDefined();
    }
    expect(c.eitc.brackets).toBe(EITC_BRACKETS);
    expect(c.eitc.investmentIncomeLimit).toBe(INVESTMENT_INCOME_LIMIT);
  });

  it('nested constant objects are the same references as tax2025 exports', () => {
    const c = getConstants(2025);
    expect(c.standardDeduction).toBe(tax2025.STANDARD_DEDUCTION_2025);
    expect(c.seTax).toBe(tax2025.SE_TAX);
    expect(c.qbi).toBe(tax2025.QBI);
    expect(c.scheduleA).toBe(tax2025.SCHEDULE_A);
  });

  it('registry entry is frozen at top level', () => {
    const c = getConstants(2025);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.provisions)).toBe(false);
  });
});
