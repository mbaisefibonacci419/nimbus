/**
 * Proactive Message Engine — unit tests for evaluateProactive.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TaxReturn, CalculationResult, Form1040Result, CreditsResult } from '@nimbus/engine';
import { FilingStatus } from '@nimbus/engine';
import { evaluateProactive } from '../services/proactiveEngine';
import * as auditRiskService from '../services/auditRiskService';
import {
  getActiveWarnings,
  getTotalWarningCount,
} from '../services/warningService';

// ─── Helpers ─────────────────────────────────────

const REF_FAR = new Date('2026-01-15T12:00:00Z');

function makeForm1040(overrides: Partial<Form1040Result> = {}): Form1040Result {
  return {
    totalWages: 75000,
    totalInterest: 0,
    taxExemptInterest: 0,
    totalDividends: 0,
    qualifiedDividends: 0,
    totalCapitalGainDistributions: 0,
    scheduleDNetGain: 0,
    capitalLossDeduction: 0,
    capitalGainOrLoss: 0,
    taxableSocialSecurity: 0,
    socialSecurityBenefits: 0,
    scheduleEIncome: 0,
    royaltyIncome: 0,
    totalRetirementIncome: 0,
    iraDistributionsGross: 0,
    iraDistributionsTaxable: 0,
    pensionDistributionsGross: 0,
    pensionDistributionsTaxable: 0,
    totalUnemployment: 0,
    total1099MISCIncome: 0,
    scheduleCNetProfit: 0,
    rothConversionTaxable: 0,
    totalIncome: 75000,
    seDeduction: 0,
    selfEmployedHealthInsurance: 0,
    retirementContributions: 0,
    hsaDeduction: 0,
    hsaDeductionComputed: 0,
    studentLoanInterest: 0,
    iraDeduction: 0,
    educatorExpenses: 0,
    earlyWithdrawalPenalty: 0,
    feieExclusion: 0,
    nolDeduction: 0,
    totalAdjustments: 0,
    agi: 75000,
    standardDeduction: 15750,
    itemizedDeduction: 0,
    deductionUsed: 'standard',
    deductionAmount: 15750,
    qbiDeduction: 0,
    schedule1ADeduction: 0,
    homeSaleExclusion: 0,
    taxableIncome: 59250,
    k1OrdinaryIncome: 0,
    k1SEIncome: 0,
    hsaDistributionTaxable: 0,
    hsaDistributionPenalty: 0,
    incomeTax: 8700,
    preferentialTax: 0,
    section1250Tax: 0,
    amtAmount: 0,
    seTax: 0,
    niitTax: 0,
    additionalMedicareTaxW2: 0,
    earlyDistributionPenalty: 0,
    kiddieTaxAmount: 0,
    householdEmploymentTax: 0,
    estimatedTaxPenalty: 0,
    totalTax: 8700,
    totalCredits: 0,
    taxAfterCredits: 8700,
    totalWithholding: 12000,
    estimatedPayments: 0,
    totalPayments: 12000,
    refundAmount: 3300,
    amountOwed: 0,
    effectiveTaxRate: 0.116,
    marginalTaxRate: 0.22,
    estimatedQuarterlyPayment: 0,
    ...overrides,
  } as Form1040Result;
}

function makeCalculation(overrides: { form1040?: Partial<Form1040Result> } = {}): CalculationResult {
  return {
    form1040: makeForm1040(overrides.form1040),
    credits: {
      childTaxCredit: 0,
      otherDependentCredit: 0,
      actcCredit: 0,
      educationCredit: 0,
      aotcRefundableCredit: 0,
      dependentCareCredit: 0,
      saversCredit: 0,
      cleanEnergyCredit: 0,
      evCredit: 0,
      energyEfficiencyCredit: 0,
      foreignTaxCredit: 0,
      adoptionCredit: 0,
      evRefuelingCredit: 0,
      elderlyDisabledCredit: 0,
      k1OtherCredits: 0,
      premiumTaxCredit: 0,
      excessSSTaxCredit: 0,
      eitcCredit: 0,
      totalNonRefundable: 0,
      totalRefundable: 0,
    } as CreditsResult,
  } as CalculationResult;
}

function makeTaxReturn(overrides: Partial<TaxReturn> = {}): TaxReturn {
  return {
    id: 'test-return',
    taxYear: 2025,
    status: 'in_progress',
    currentStep: 0,
    currentSection: 'review',
    filingStatus: FilingStatus.Single,
    dependents: [],
    w2Income: [{ id: 'w2-1', employerName: 'Acme Corp', wages: 75000, federalTaxWithheld: 12000 }],
    income1099NEC: [],
    income1099K: [],
    income1099INT: [],
    income1099DIV: [],
    income1099R: [],
    income1099G: [],
    income1099MISC: [],
    income1099B: [],
    income1099DA: [],
    income1099C: [],
    income1099Q: [],
    rentalProperties: [],
    incomeK1: [],
    income1099SA: [],
    incomeW2G: [],
    businesses: [],
    otherIncome: 0,
    expenses: [],
    deductionMethod: 'standard',
    educationCredits: [],
    incomeDiscovery: {},
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  } as TaxReturn;
}

describe('evaluateProactive', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no suggestions, warnings, risks, or near deadlines apply', () => {
    const tr = makeTaxReturn();
    const warnCount = getTotalWarningCount(getActiveWarnings(tr, null));
    const result = evaluateProactive(tr, null, 'welcome', 'my_info', warnCount, new Set(), REF_FAR);
    expect(result).toBeNull();
  });

  it('returns a high-value suggestion when estimated benefit > $500', () => {
    const tr = makeTaxReturn({
      dependents: [
        {
          firstName: 'Child',
          lastName: 'Test',
          dateOfBirth: '2015-06-15',
          relationship: 'child',
          monthsLivedWithYou: 12,
        },
      ],
      incomeDiscovery: {},
    } as any);
    const warnCount = getTotalWarningCount(getActiveWarnings(tr, null));
    const result = evaluateProactive(tr, null, 'welcome', 'my_info', warnCount, new Set(), REF_FAR);
    expect(result).not.toBeNull();
    expect(result!.category).toBe('suggestion:ctc');
    expect(result!.trigger.type).toBe('high_value_suggestion');
    expect(result!.trigger.type === 'high_value_suggestion' && result!.trigger.benefit).toBeGreaterThan(500);
    expect(result!.message).toContain('Child Tax Credit');
  });

  it('returns a new warning when total warning count increases', () => {
    const clean = makeTaxReturn();
    const prevCount = getTotalWarningCount(getActiveWarnings(clean, null));
    const withIssue = makeTaxReturn({ dateOfBirth: '2030-01-01' });
    const result = evaluateProactive(withIssue, null, 'welcome', 'my_info', prevCount, new Set(), REF_FAR);
    expect(result).not.toBeNull();
    expect(result!.trigger.type).toBe('new_warning');
    expect(result!.category).toBe('warning:personal_info');
    if (result!.trigger.type === 'new_warning') {
      expect(result!.trigger.stepId).toBe('personal_info');
    }
  });

  it("returns audit risk when level is 'high'", () => {
    const tr = makeTaxReturn();
    const calc = makeCalculation();
    const warnCount = getTotalWarningCount(getActiveWarnings(tr, calc));
    vi.spyOn(auditRiskService, 'assessAuditRisk').mockReturnValue({
      level: 'high',
      score: 40,
      maxPossibleScore: 140,
      triggeredFactors: [],
      summary: 'Several factors increase relative audit visibility.',
    });
    const result = evaluateProactive(tr, calc, 'welcome', 'my_info', warnCount, new Set(), REF_FAR);
    expect(result).not.toBeNull();
    expect(result!.category).toBe('audit_risk');
    expect(result!.trigger.type).toBe('audit_risk_crossing');
  });

  it('respects dismissed categories for suggestions', () => {
    const tr = makeTaxReturn({
      dependents: [
        {
          firstName: 'Child',
          lastName: 'Test',
          dateOfBirth: '2015-06-15',
          relationship: 'child',
          monthsLivedWithYou: 12,
        },
      ],
      incomeDiscovery: {},
    } as any);
    const warnCount = getTotalWarningCount(getActiveWarnings(tr, null));
    const result = evaluateProactive(tr, null, 'welcome', 'my_info', warnCount, new Set(['suggestion:ctc']), REF_FAR);
    expect(result).toBeNull();
  });

  it('returns null when suggestion and audit triggers are both dismissed', () => {
    const tr = makeTaxReturn({
      dependents: [
        {
          firstName: 'Child',
          lastName: 'Test',
          dateOfBirth: '2015-06-15',
          relationship: 'child',
          monthsLivedWithYou: 12,
        },
      ],
      incomeDiscovery: {},
    } as any);
    const calc = makeCalculation();
    const warnCount = getTotalWarningCount(getActiveWarnings(tr, calc));
    vi.spyOn(auditRiskService, 'assessAuditRisk').mockReturnValue({
      level: 'high',
      score: 40,
      maxPossibleScore: 140,
      triggeredFactors: [],
      summary: 'Elevated scrutiny factors present.',
    });
    const result = evaluateProactive(
      tr,
      calc,
      'welcome',
      'my_info',
      warnCount,
      new Set(['suggestion:ctc', 'audit_risk']),
      REF_FAR,
    );
    expect(result).toBeNull();
  });

  it('returns at most one trigger per evaluation (priority: suggestion beats warning)', () => {
    const tr = makeTaxReturn({
      dateOfBirth: '2030-01-01',
      dependents: [
        {
          firstName: 'Child',
          lastName: 'Test',
          dateOfBirth: '2015-06-15',
          relationship: 'child',
          monthsLivedWithYou: 12,
        },
      ],
      incomeDiscovery: {},
    } as any);
    const prevCount = getTotalWarningCount(getActiveWarnings(makeTaxReturn(), null));
    const result = evaluateProactive(tr, null, 'welcome', 'my_info', prevCount, new Set(), REF_FAR);
    expect(result!.category).toBe('suggestion:ctc');
  });

  it('surfaces approaching filing deadline within 7 days', () => {
    const tr = makeTaxReturn();
    const nearFiling = new Date('2026-04-12T12:00:00Z');
    const warnCount = getTotalWarningCount(getActiveWarnings(tr, null));
    const result = evaluateProactive(tr, null, 'welcome', 'my_info', warnCount, new Set(), nearFiling);
    expect(result).not.toBeNull();
    expect(result!.category).toBe('deadline:filing_deadline');
    expect(result!.trigger.type).toBe('approaching_deadline');
  });
});
