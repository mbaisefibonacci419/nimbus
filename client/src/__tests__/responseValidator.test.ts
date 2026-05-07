/**
 * Response grounding validation — dollar amounts vs calculation.
 */

import { describe, it, expect } from 'vitest';
import type { CalculationResult, CreditsResult, Form1040Result } from '@nimbus/engine';
import { validateResponseGrounding } from '../services/responseValidator';

const FOOTNOTE =
  'Note: Some amounts mentioned may not match your current calculation. Verify figures before relying on them.';

function emptyCredits(): CreditsResult {
  return {
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
    scholarshipCredit: 0,
    priorYearMinTaxCredit: 0,
    k1OtherCredits: 0,
    premiumTaxCredit: 0,
    excessSSTaxCredit: 0,
    eitcCredit: 0,
    totalNonRefundable: 0,
    totalRefundable: 0,
    totalCredits: 0,
  } as CreditsResult;
}

function makeCalc(form1040: Partial<Form1040Result> = {}): CalculationResult {
  return {
    credits: emptyCredits(),
    form1040: {
      totalWages: 0,
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
      totalQCD: 0,
      pensionDistributionsGross: 0,
      pensionDistributionsTaxable: 0,
      totalUnemployment: 0,
      total1099MISCIncome: 0,
      scheduleCNetProfit: 0,
      rothConversionTaxable: 0,
      additionalIncome: 0,
      k1OrdinaryIncome: 0,
      k1SEIncome: 0,
      hsaDistributionTaxable: 0,
      hsaDistributionPenalty: 0,
      totalIncome: 0,
      seDeduction: 0,
      selfEmployedHealthInsurance: 0,
      retirementContributions: 0,
      hsaDeduction: 0,
      hsaDeductionComputed: 0,
      archerMSADeduction: 0,
      studentLoanInterest: 0,
      iraDeduction: 0,
      educatorExpenses: 0,
      earlyWithdrawalPenalty: 0,
      movingExpenses: 0,
      feieExclusion: 0,
      nolDeduction: 0,
      alimonyDeduction: 0,
      totalAdjustments: 0,
      agi: 50000,
      standardDeduction: 0,
      itemizedDeduction: 0,
      deductionUsed: 'standard',
      deductionAmount: 0,
      qbiDeduction: 0,
      schedule1ADeduction: 0,
      homeSaleExclusion: 0,
      taxableIncome: 40000,
      incomeTax: 0,
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
      totalTax: 8000,
      totalCredits: 0,
      taxAfterCredits: 0,
      w2Withholding: 0,
      form1099Withholding: 0,
      form8959WithholdingCredit: 0,
      totalWithholding: 0,
      estimatedPayments: 0,
      totalPayments: 0,
      amountOwed: 0,
      refundAmount: 2000,
      refundAppliedToNextYear: 0,
      netRefund: 2000,
      totalGamblingIncome: 0,
      cancellationOfDebtIncome: 0,
      investmentInterestDeduction: 0,
      alimonyReceivedIncome: 0,
      excessContributionPenalty: 0,
      taxable529Income: 0,
      penalty529: 0,
      k1Section179Deduction: 0,
      premiumTaxCreditNet: 0,
      excessAPTCRepayment: 0,
      form4797OrdinaryIncome: 0,
      form4797Section1231GainOrLoss: 0,
      form4137Tax: 0,
      scheduleFNetProfit: 0,
      foreignTaxPaid: 0,
      extensionFiled: false,
      effectiveTaxRate: 0,
      marginalTaxRate: 0.22,
      estimatedQuarterlyPayment: 0,
      ...form1040,
    } as Form1040Result,
  } as CalculationResult;
}

describe('validateResponseGrounding', () => {
  it('returns verified when no dollar amounts in response', () => {
    const r = validateResponseGrounding('Your AGI looks fine.', makeCalc());
    expect(r.verified).toBe(true);
    expect(r.discrepancies).toEqual([]);
    expect(r.footnote).toBeNull();
  });

  it('returns verified when calculation is null', () => {
    const r = validateResponseGrounding('You owe $5,000.', null);
    expect(r.verified).toBe(true);
    expect(r.discrepancies).toEqual([]);
    expect(r.footnote).toBeNull();
  });

  it('returns verified when amounts match calculation within 10%', () => {
    const calc = makeCalc({ agi: 10000 });
    const r = validateResponseGrounding('Your AGI is about $10,500.', calc);
    expect(r.verified).toBe(true);
    expect(r.discrepancies).toEqual([]);
    expect(r.footnote).toBeNull();
  });

  it('returns discrepancy when amount diverges by more than 10%', () => {
    const calc = makeCalc({ agi: 10000 });
    const r = validateResponseGrounding('Your AGI is $15,000.', calc);
    expect(r.verified).toBe(false);
    expect(r.discrepancies.length).toBeGreaterThanOrEqual(1);
    expect(r.discrepancies.some((d) => d.mentionedAmount === 15000)).toBe(true);
    expect(r.footnote).toBe(FOOTNOTE);
  });

  it('ignores amounts under $100', () => {
    const calc = makeCalc({ agi: 500 });
    const r = validateResponseGrounding('A small fee of $50 and AGI $500.', calc);
    expect(r.verified).toBe(true);
    expect(r.discrepancies).toEqual([]);
  });

  it('handles multiple amounts — some verified, some not', () => {
    const calc = makeCalc({ agi: 20000, totalTax: 3000 });
    const r = validateResponseGrounding(
      'AGI is $20,000 and tax is $9,999.',
      calc,
    );
    expect(r.verified).toBe(false);
    expect(r.discrepancies.some((d) => d.mentionedAmount === 9999)).toBe(true);
    expect(r.discrepancies.some((d) => d.mentionedAmount === 20000)).toBe(false);
  });

  it('returns correct footnote text when discrepancies exist', () => {
    const r = validateResponseGrounding(
      'Refund: $50,000.',
      makeCalc({
        agi: 0,
        taxableIncome: 0,
        totalTax: 0,
        totalIncome: 0,
        refundAmount: 2000,
        netRefund: 2000,
        marginalTaxRate: 0,
      }),
    );
    expect(r.footnote).toBe(FOOTNOTE);
  });

  it('parses amounts with commas correctly', () => {
    const calc = makeCalc({ taxableIncome: 12500 });
    const r = validateResponseGrounding('Taxable income is $12,500.', calc);
    expect(r.verified).toBe(true);
    expect(r.discrepancies).toEqual([]);
  });

  it('uses trace values as known amounts when present', () => {
    const calc = makeCalc({ agi: 1 }) as CalculationResult;
    calc.traces = [
      {
        lineId: 'custom.line',
        label: 'Custom',
        value: 88888,
        inputs: [],
      },
    ];
    const r = validateResponseGrounding('See amount $88888.', calc);
    expect(r.verified).toBe(true);
  });
});
