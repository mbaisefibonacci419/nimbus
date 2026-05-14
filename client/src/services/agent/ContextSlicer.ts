/**
 * Context Slicer
 *
 * Extracts only the TaxReturn fields that the active skill
 * needs to read, keeping the LLM context minimal and focused.
 */

import type { TaxReturn, CalculationResult } from '@nimbus/engine';
import type { SkillRegistryEntry } from './SkillRegistry';

/**
 * Field paths each skill reads, keyed by skill ID.
 * Derived from the Reads tables in each skill's markdown contract.
 */
const SKILL_READ_PATHS: Record<string, string[]> = {
  'personal-info': [
    'firstName', 'lastName', 'middleInitial', 'suffix', 'dateOfBirth',
    'occupation', 'addressStreet', 'addressCity', 'addressState', 'addressZip',
    'isLegallyBlind', 'canBeClaimedAsDependent', 'isActiveDutyMilitary',
    'digitalAssetActivity',
  ],
  'filing-status': [
    'filingStatus', 'firstName', 'dependents', 'dateOfBirth',
  ],
  'dependents': [
    'filingStatus', 'dependents', 'spouseFirstName',
  ],
  'income-wages': [
    'filingStatus', 'w2Income', 'incomeDiscovery', 'spouseFirstName',
  ],
  'income-freelance': [
    'income1099NEC', 'income1099K', 'income1099MISC', 'incomeDiscovery',
    'filingStatus', 'spouseFirstName', 'businesses',
  ],
  'income-investments': [
    'income1099B', 'income1099DIV', 'income1099INT', 'income1099DA',
    'incomeK1', 'income1099OID', 'capitalLossCarryforwardST',
    'capitalLossCarryforwardLT', 'incomeDiscovery', 'filingStatus',
  ],
  'income-retirement': [
    'income1099R', 'incomeSSA1099', 'income1099G', 'incomeDiscovery',
    'filingStatus', 'livedApartFromSpouse', 'dateOfBirth', 'spouseDateOfBirth',
  ],
  'income-property': [
    'rentalProperties', 'royaltyProperties', 'homeSale', 'incomeDiscovery',
    'filingStatus', 'addressState',
  ],
  'income-other': [
    'income1099SA', 'income1099Q', 'incomeW2G', 'income1099C',
    'alimonyReceived', 'otherIncome', 'incomeDiscovery', 'filingStatus',
    'hsaContribution',
  ],
  'self-employment': [
    'businesses', 'business', 'expenses', 'homeOffice', 'vehicle',
    'selfEmploymentDeductions', 'costOfGoodsSold', 'returnsAndAllowances',
    'depreciationAssets', 'income1099NEC', 'income1099K', 'filingStatus',
  ],
  'deductions-discovery': [
    'filingStatus', 'incomeDiscovery', 'deductionMethod', 'itemizedDeductions',
    'w2Income', 'businesses', 'dependents', 'hsaDeduction', 'studentLoanInterest',
    'iraContribution', 'educatorExpenses', 'estimatedPaymentsMade',
  ],
  'deductions-itemized': [
    'deductionMethod', 'itemizedDeductions', 'incomeDiscovery', 'filingStatus',
    'gamblingLosses', 'incomeW2G',
  ],
  'deductions-above-line': [
    'incomeDiscovery', 'hsaDeduction', 'hsaContribution', 'studentLoanInterest',
    'iraContribution', 'coveredByEmployerPlan', 'educatorExpenses',
    'estimatedPaymentsMade', 'estimatedQuarterlyPayments', 'alimony',
    'nolCarryforward', 'filingStatus', 'w2Income', 'businesses',
  ],
  'credits': [
    'dependents', 'filingStatus', 'educationCredits', 'dependentCare',
    'saversCredit', 'cleanEnergy', 'evCredit', 'energyEfficiency',
    'childTaxCredit', 'premiumTaxCredit', 'foreignTaxCreditCategories',
    'income1099DIV', 'iraContribution', 'w2Income', 'businesses',
  ],
  'state-taxes': [
    'stateReturns', 'addressState', 'w2Income', 'income1099NEC', 'filingStatus',
  ],
  'review': [],   // reads entire return summary (built separately)
  'finish': [
    'status', 'directDeposit', 'refundAppliedToNextYear',
  ],
};

/**
 * Calculation fields each skill may reference.
 */
const SKILL_CALC_PATHS: Record<string, string[]> = {
  'deductions-discovery': ['form1040.adjustedGrossIncome', 'scheduleA'],
  'deductions-itemized': ['form1040.adjustedGrossIncome', 'scheduleA'],
  'deductions-above-line': ['form1040.adjustedGrossIncome'],
  'credits': ['form1040.adjustedGrossIncome', 'credits'],
  'self-employment': ['scheduleC', 'scheduleSE'],
  'review': ['form1040', 'credits', 'scheduleA', 'scheduleC', 'scheduleSE', 'stateResults'],
  'finish': ['form1040', 'stateResults'],
};

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export function buildContextSlice(
  taxReturn: TaxReturn,
  calculation: CalculationResult | null,
  skill: SkillRegistryEntry,
): Record<string, unknown> {
  const slice: Record<string, unknown> = {};

  const readPaths = SKILL_READ_PATHS[skill.id] ?? [];
  for (const path of readPaths) {
    const value = getNestedValue(taxReturn as unknown as Record<string, unknown>, path);
    if (value !== undefined) {
      slice[path] = value;
    }
  }

  if (calculation) {
    const calcPaths = SKILL_CALC_PATHS[skill.id] ?? [];
    for (const path of calcPaths) {
      const value = getNestedValue(calculation as unknown as Record<string, unknown>, path);
      if (value !== undefined) {
        slice[`calculation.${path}`] = value;
      }
    }
  }

  return slice;
}
