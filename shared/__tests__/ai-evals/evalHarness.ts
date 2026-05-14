/**
 * Shared helpers for offline eval tests (simulated LLM JSON → parseResponse).
 */

import { expect } from 'vitest';
import type { ChatAction, ChatResponse } from '../../src/types/chat.js';

export interface ExpectedActionField {
  type: string;
  incomeType?: string;
  method?: string;
  status?: string;
  stepId?: string;
  /** For update_field actions */
  field?: string;
  value?: unknown;
  fieldsContain?: Record<string, unknown>;
}

export interface EvalFixture {
  id: string;
  description: string;
  input: {
    message: string;
    context: Record<string, unknown>;
  };
  expected: {
    actionTypes: string[];
    actionFields: ExpectedActionField[];
    suggestedStep: string | null;
    hasMessage: boolean;
    messageContains?: string[];
    shouldAskClarification?: boolean;
  };
}

export function assertActionTypeMatch(response: ChatResponse, expected: EvalFixture['expected']) {
  const actualTypes = response.actions.map(a => a.type);

  if (expected.actionTypes.length === 0) {
    const isEmptyOrNoAction = response.actions.length === 0 ||
      (response.actions.length === 1 && response.actions[0].type === 'no_action');
    expect(isEmptyOrNoAction).toBe(true);
  } else {
    expect(actualTypes).toEqual(expected.actionTypes);
  }
}

export function assertActionFieldMatch(action: ChatAction, expectedField: ExpectedActionField) {
  const a = action as Record<string, unknown>;
  expect(action.type).toBe(expectedField.type);

  if (expectedField.incomeType && 'incomeType' in a) {
    expect(a.incomeType).toBe(expectedField.incomeType);
  }

  if (expectedField.method && 'method' in a) {
    expect(a.method).toBe(expectedField.method);
  }

  if (expectedField.field !== undefined && 'field' in a) {
    expect(a.field).toBe(expectedField.field);
  }
  if (expectedField.value !== undefined && 'value' in a) {
    expect(a.value).toEqual(expectedField.value);
  }

  if (expectedField.fieldsContain && 'fields' in a) {
    const fields = a.fields as Record<string, unknown>;
    for (const [key, value] of Object.entries(expectedField.fieldsContain)) {
      expect(fields[key]).toEqual(value);
    }
  }
}

export function assertMessageQuality(response: ChatResponse, expected: EvalFixture['expected']) {
  if (expected.hasMessage) {
    expect(response.message).toBeTruthy();
    expect(response.message.length).toBeGreaterThan(5);
  }

  if (expected.messageContains) {
    for (const keyword of expected.messageContains) {
      expect(response.message.toLowerCase()).toContain(keyword.toLowerCase());
    }
  }
}

export function buildSimulatedResponse(fixture: EvalFixture): string {
  const { expected, input } = fixture;

  if (expected.shouldAskClarification) {
    return JSON.stringify({
      message: buildClarificationMessage(input.message),
      actions: [],
      suggestedStep: null,
    });
  }

  const isInformational = expected.actionTypes.length === 0 ||
    (expected.actionTypes.length === 1 && expected.actionTypes[0] === 'no_action');

  if (isInformational) {
    return JSON.stringify({
      message: buildInformationalMessage(fixture),
      actions: expected.actionTypes.includes('no_action') ? [{ type: 'no_action' }] : [],
      suggestedStep: expected.suggestedStep,
    });
  }

  const actions = expected.actionFields.map(buildActionFromField);
  return JSON.stringify({
    message: `I'll help you with that. ${fixture.description}.`,
    actions,
    suggestedStep: expected.suggestedStep,
  });
}

function buildClarificationMessage(userMessage: string): string {
  return `I'd like to help, but I need a bit more information. Could you tell me more about "${userMessage}"? Specifically, what type of income or expense is this, and do you have the dollar amount?`;
}

function buildInformationalMessage(fixture: EvalFixture): string {
  const keywords = fixture.expected.messageContains || [];
  const base = `Based on your tax return information, here's what I can tell you about ${keywords[0] || 'your question'}.`;

  if (keywords.some(k => k.toLowerCase().includes('refund'))) {
    return `${base} Your estimated federal refund is approximately $2,400. This is based on your total withholding exceeding your calculated tax liability.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('bracket'))) {
    return `${base} Based on your taxable income, you're in the 12% marginal tax bracket. Remember, this is the rate on your last dollar of income — most of your income is taxed at lower rates.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('standard deduction'))) {
    return `${base} The standard deduction for 2025 for single filers is $15,000. For married filing jointly, it's $30,000.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('adjusted gross income'))) {
    return `${base} Adjusted gross income (AGI) is your total income minus specific above-the-line deductions like student loan interest, HSA contributions, and IRA contributions.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('self-employment'))) {
    return `${base} Self-employment tax covers Social Security and Medicare taxes for people who work for themselves. The rate is 15.3% (12.4% for Social Security + 2.9% for Medicare) on 92.35% of your net self-employment income.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('marginal'))) {
    return `${base} Your marginal tax rate is the rate on your last dollar of income (22%). Your effective tax rate is your total tax divided by total income (~14%), which is lower because income in lower brackets is taxed at lower rates.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('head of household'))) {
    return `${base} To qualify as head of household, you must be unmarried (or considered unmarried) at the end of the year, have paid more than half the cost of keeping up a home, and have a qualifying dependent.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('qualified business income'))) {
    return `${base} The qualified business income (QBI) deduction under IRC §199A allows eligible self-employed taxpayers and small business owners to deduct up to 20% of their qualified business income.`;
  }

  if (keywords.some(k => k.toLowerCase().includes('child tax credit'))) {
    return `${base} The Child Tax Credit provides up to $2,000 per qualifying child under age 17. With your 2 dependents and AGI of ~$90,000, you likely qualify for the full credit.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('earned income'))) {
    return `${base} The Earned Income Credit (EIC) is a refundable credit for lower and moderate income workers. With 1 qualifying child and AGI of ~$35,000, you may be eligible.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('education'))) {
    return `${base} As a sophomore, you may qualify for the American Opportunity Tax Credit (AOTC) which provides up to $2,500 per year for the first 4 years of higher education.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('energy'))) {
    return `${base} The Energy Efficient Home Improvement Credit can provide up to 30% of the cost of qualifying energy improvements.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('adoption'))) {
    return `${base} The adoption credit can cover up to $17,280 in qualified adoption expenses per child for 2025.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('premium'))) {
    return `${base} The Premium Tax Credit helps pay for health insurance purchased through the Health Insurance Marketplace.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('foreign'))) {
    return `${base} The Foreign Tax Credit allows you to claim a credit for income taxes paid to a foreign government on foreign-source income.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('saver'))) {
    return `${base} The Retirement Savings Contributions Credit (Saver's Credit) provides a credit of up to $1,000 for contributions to retirement accounts.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('care'))) {
    return `${base} The Child and Dependent Care Credit provides a credit for expenses paid for the care of qualifying dependents to allow you to work.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('deduction'))) {
    return `${base} Deductions reduce taxable income. Common options include the standard deduction or itemized deductions like mortgage interest, SALT (capped), and charitable giving. I can walk you through the deduction interview next.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('income'))) {
    return `${base} We will go through each income type—W-2s, 1099s, investments, and more—so nothing is missed.`;
  }
  if (keywords.some(k => k.toLowerCase().includes('credit'))) {
    return `${base} There are various tax credits available that may apply to your situation.`;
  }

  return `${base} Let me explain this in more detail for your specific situation.`;
}

export function buildActionFromField(field: ExpectedActionField): Record<string, unknown> {
  switch (field.type) {
    case 'add_income':
      return {
        type: 'add_income',
        incomeType: field.incomeType || 'w2',
        fields: field.fieldsContain || { wages: 50000 },
      };
    case 'set_filing_status':
      return {
        type: 'set_filing_status',
        status: field.status || 'single',
      };
    case 'add_dependent':
      return {
        type: 'add_dependent',
        fields: { relationship: 'child', monthsLived: 12 },
      };
    case 'set_deduction_method':
      return {
        type: 'set_deduction_method',
        method: field.method || 'standard',
      };
    case 'update_itemized':
      return {
        type: 'update_itemized',
        fields: field.fieldsContain || { mortgageInterest: 10000 },
      };
 case 'update_field':
      return {
        type: 'update_field',
        field: field.field || 'amount',
        value: field.value ?? 5000,
      };
    case 'navigate':
      return {
        type: 'navigate',
        stepId: field.stepId || 'deductions_overview',
      };
    case 'add_business_expense':
      return {
        type: 'add_business_expense',
        category: 'office_supplies',
        amount: 500,
      };
    case 'set_income_discovery':
      return {
        type: 'set_income_discovery',
        incomeType: field.incomeType || 'educationCredits',
        value: field.value ?? 'yes',
      };
    case 'update_se_retirement':
      return {
        type: 'update_se_retirement',
        fields: field.fieldsContain || { seHealthInsurance: 6000 },
      };
    case 'no_action':
      return { type: 'no_action' };
    default:
      return { type: field.type, fields: {} };
  }
}

/** Run full offline validation for one fixture (throws on failure). */
export function runSingleFixtureEval(fixture: EvalFixture, parseResponse: (raw: string) => ChatResponse) {
  const simulatedRaw = buildSimulatedResponse(fixture);
  const response = parseResponse(simulatedRaw);

  assertActionTypeMatch(response, fixture.expected);

  if (fixture.expected.actionFields.length > 0 && response.actions.length > 0) {
    for (let i = 0; i < Math.min(response.actions.length, fixture.expected.actionFields.length); i++) {
      assertActionFieldMatch(response.actions[i], fixture.expected.actionFields[i]);
    }
  }

  expect(response.suggestedStep).toBe(fixture.expected.suggestedStep);
  assertMessageQuality(response, fixture.expected);
}
