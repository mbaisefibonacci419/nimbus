/**
 * Intent-to-Action Eval Suite — Test Runner
 *
 * Validates pre-recorded model responses against expected action schemas.
 * Does NOT call any live LLM — uses recorded fixtures only.
 *
 * Each fixture defines:
 *   - input: { message, context } sent to the LLM
 *   - expected: { actionTypes, actionFields, suggestedStep, hasMessage, messageContains?, shouldAskClarification? }
 *
 * Scoring:
 *   - Exact match on action type sequence
 *   - Field-level checks on action objects (incomeType, method, etc.)
 *   - Step suggestion match
 *   - Message content validation (present, contains keywords)
 *
 * Usage:
 *   npx vitest run shared/__tests__/ai-evals/eval-runner.test.ts
 *
 * To run the live prompt regression harness (Chunk 1D), use scripts/eval-prompt.ts instead.
 */

import { describe, it, expect } from 'vitest';
import { parseResponse } from '../../src/utils/llmResponseParser.js';
import type { EvalFixture } from './evalHarness.js';
import { runSingleFixtureEval } from './evalHarness.js';

import incomeFixtures from './fixtures/income-entry.json';
import deductionFixtures from './fixtures/deduction-discovery.json';
import creditFixtures from './fixtures/credit-questions.json';
import informationalFixtures from './fixtures/informational.json';
import ambiguousFixtures from './fixtures/ambiguous-input.json';
import multiActionFixtures from './fixtures/multi-action.json';

function runFixtureSuite(name: string, fixtures: EvalFixture[]) {
  describe(`AI Eval: ${name}`, () => {
    for (const fixture of fixtures) {
      it(`${fixture.id}: ${fixture.description}`, () => {
        runSingleFixtureEval(fixture, parseResponse);
      });
    }
  });
}

runFixtureSuite('Income Entry (~20 cases)', incomeFixtures as EvalFixture[]);
runFixtureSuite('Deduction Discovery (~10 cases)', deductionFixtures as EvalFixture[]);
runFixtureSuite('Credit Questions (~10 cases)', creditFixtures as EvalFixture[]);
runFixtureSuite('Informational (no_action expected, ~10 cases)', informationalFixtures as EvalFixture[]);
runFixtureSuite('Ambiguous Input (should clarify, ~5 cases)', ambiguousFixtures as EvalFixture[]);
runFixtureSuite('Multi-Action Extraction (~5 cases)', multiActionFixtures as EvalFixture[]);

describe('AI Eval: Coverage Summary', () => {
  const allFixtures = [
    ...incomeFixtures,
    ...deductionFixtures,
    ...creditFixtures,
    ...informationalFixtures,
    ...ambiguousFixtures,
    ...multiActionFixtures,
  ] as EvalFixture[];

  it('has at least 50 eval fixtures', () => {
    expect(allFixtures.length).toBeGreaterThanOrEqual(50);
  });

  it('covers all major action types', () => {
    const coveredTypes = new Set(
      allFixtures.flatMap(f => f.expected.actionTypes),
    );
    expect(coveredTypes.has('add_income')).toBe(true);
    expect(coveredTypes.has('set_filing_status')).toBe(true);
    expect(coveredTypes.has('add_dependent')).toBe(true);
    expect(coveredTypes.has('set_deduction_method')).toBe(true);
    expect(coveredTypes.has('update_itemized')).toBe(true);
    expect(coveredTypes.has('update_field')).toBe(true);
    expect(coveredTypes.has('add_business_expense')).toBe(true);
    expect(coveredTypes.has('no_action')).toBe(true);
    expect(coveredTypes.has('navigate')).toBe(true);
    expect(coveredTypes.has('update_se_retirement')).toBe(true);
    expect(coveredTypes.has('set_income_discovery')).toBe(true);
  });

  it('has fixtures in every category', () => {
    expect(incomeFixtures.length).toBeGreaterThanOrEqual(15);
    expect(deductionFixtures.length).toBeGreaterThanOrEqual(8);
    expect(creditFixtures.length).toBeGreaterThanOrEqual(8);
    expect(informationalFixtures.length).toBeGreaterThanOrEqual(8);
    expect(ambiguousFixtures.length).toBeGreaterThanOrEqual(4);
    expect(multiActionFixtures.length).toBeGreaterThanOrEqual(4);
  });
});
