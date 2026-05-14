/**
 * Skill Registry
 *
 * Maps each skill to its metadata: phase, ordering, prerequisites,
 * relevance conditions, completion criteria, and allowed actions.
 *
 * This is the runtime representation of the skill markdown files.
 * The markdown files are the source of truth for prompt content;
 * this module encodes the structural contracts.
 */

import type { TaxReturn } from '@nimbus/engine';
import type { AgentPhase } from './AgentOrchestrator';

export type InteractionMode = 'fast-capture' | 'exploratory' | 'confirmation' | 'half-sheet';

export interface SkillRegistryEntry {
  id: string;
  domain: string;
  phase: AgentPhase;
  order: number;
  prerequisites: string[];
  expectedTurns: number;
  interactionMode: InteractionMode;
  allowedActionTypes: string[];
  /** Exact TaxReturn field names this skill may write via update_field. */
  writableFields: string[];
  isRelevant: (taxReturn: TaxReturn) => boolean;
  isComplete: (taxReturn: TaxReturn) => boolean;
}

const always = () => true;

export const SKILL_REGISTRY: SkillRegistryEntry[] = [
  // ── Onboarding ──────────────────────────────────
  {
    id: 'personal-info',
    domain: 'Personal Information',
    phase: 'onboarding',
    order: 1,
    prerequisites: [],
    expectedTurns: 4,
    interactionMode: 'fast-capture',
    allowedActionTypes: ['update_field', 'navigate', 'no_action'],
    writableFields: [
      'firstName', 'lastName', 'middleInitial', 'suffix',
      'dateOfBirth', 'occupation',
      'addressStreet', 'addressCity', 'addressState', 'addressZip',
      'isLegallyBlind', 'canBeClaimedAsDependent',
      'isActiveDutyMilitary', 'digitalAssetActivity',
    ],
    isRelevant: always,
    isComplete: (tr) =>
      !!tr.firstName && !!tr.lastName && !!tr.addressState && !!tr.dateOfBirth,
  },
  {
    id: 'filing-status',
    domain: 'Filing Status',
    phase: 'onboarding',
    order: 2,
    prerequisites: ['personal-info'],
    expectedTurns: 3,
    interactionMode: 'fast-capture',
    allowedActionTypes: ['set_filing_status', 'update_field', 'navigate', 'no_action'],
    writableFields: ['livedApartFromSpouse', 'isDeceasedSpouseReturn'],
    isRelevant: always,
    isComplete: (tr) => tr.filingStatus !== undefined,
  },
  {
    id: 'dependents',
    domain: 'Dependents',
    phase: 'onboarding',
    order: 3,
    prerequisites: ['filing-status'],
    expectedTurns: 4,
    interactionMode: 'fast-capture',
    allowedActionTypes: ['add_dependent', 'remove_item', 'set_income_discovery', 'navigate', 'no_action'],
    writableFields: [],
    isRelevant: always,
    isComplete: (tr) =>
      tr.dependents.length > 0 || tr.incomeDiscovery['dependents_asked'] === 'yes',
  },

  // ── Income ──────────────────────────────────────
  {
    id: 'income-wages',
    domain: 'W-2 Wage Income',
    phase: 'income',
    order: 4,
    prerequisites: ['filing-status'],
    expectedTurns: 5,
    interactionMode: 'fast-capture',
    allowedActionTypes: ['add_income', 'set_income_discovery', 'remove_item', 'navigate', 'no_action'],
    writableFields: [],
    isRelevant: always,
    isComplete: (tr) =>
      tr.incomeDiscovery['w2'] === 'no' ||
      (tr.incomeDiscovery['w2'] === 'yes' && tr.w2Income.length > 0),
  },
  {
    id: 'income-freelance',
    domain: 'Freelance & Gig Income',
    phase: 'income',
    order: 5,
    prerequisites: ['filing-status'],
    expectedTurns: 5,
    interactionMode: 'fast-capture',
    allowedActionTypes: ['add_income', 'set_income_discovery', 'remove_item', 'navigate', 'no_action'],
    writableFields: [],
    isRelevant: always,
    isComplete: (tr) =>
      tr.incomeDiscovery['1099nec'] === 'no' ||
      (tr.incomeDiscovery['1099nec'] === 'yes' && tr.income1099NEC.length > 0) ||
      tr.incomeDiscovery['1099k'] === 'no' ||
      (tr.incomeDiscovery['1099k'] === 'yes' && tr.income1099K.length > 0),
  },
  {
    id: 'income-investments',
    domain: 'Investment Income',
    phase: 'income',
    order: 6,
    prerequisites: ['filing-status'],
    expectedTurns: 6,
    interactionMode: 'fast-capture',
    allowedActionTypes: ['add_income', 'set_income_discovery', 'update_field', 'remove_item', 'navigate', 'no_action'],
    writableFields: ['capitalLossCarryforward', 'capitalLossCarryforwardST', 'capitalLossCarryforwardLT'],
    isRelevant: always,
    isComplete: (tr) =>
      (tr.incomeDiscovery['1099b'] === 'no' || tr.income1099B.length > 0) &&
      (tr.incomeDiscovery['1099div'] === 'no' || tr.income1099DIV.length > 0) &&
      (tr.incomeDiscovery['1099int'] === 'no' || tr.income1099INT.length > 0),
  },
  {
    id: 'income-retirement',
    domain: 'Retirement & Social Security Income',
    phase: 'income',
    order: 7,
    prerequisites: ['filing-status'],
    expectedTurns: 5,
    interactionMode: 'fast-capture',
    allowedActionTypes: ['add_income', 'set_income_discovery', 'remove_item', 'navigate', 'no_action'],
    writableFields: [],
    isRelevant: always,
    isComplete: (tr) =>
      (tr.incomeDiscovery['1099r'] === 'no' || tr.income1099R.length > 0) &&
      (tr.incomeDiscovery['ssa1099'] === 'no' || !!tr.incomeSSA1099) &&
      (tr.incomeDiscovery['1099g'] === 'no' || tr.income1099G.length > 0),
  },
  {
    id: 'income-property',
    domain: 'Property Income',
    phase: 'income',
    order: 8,
    prerequisites: ['filing-status'],
    expectedTurns: 5,
    interactionMode: 'half-sheet',
    allowedActionTypes: ['update_field', 'set_income_discovery', 'remove_item', 'navigate', 'no_action'],
    writableFields: [],
    isRelevant: (tr) =>
      tr.incomeDiscovery['rental'] === 'yes' ||
      tr.incomeDiscovery['home_sale'] === 'yes' ||
      tr.rentalProperties.length > 0 ||
      !!tr.homeSale,
    isComplete: (tr) =>
      (tr.incomeDiscovery['rental'] === 'no' || tr.rentalProperties.length > 0) &&
      (tr.incomeDiscovery['home_sale'] === 'no' || !!tr.homeSale),
  },
  {
    id: 'income-other',
    domain: 'Other Income',
    phase: 'income',
    order: 9,
    prerequisites: ['filing-status'],
    expectedTurns: 4,
    interactionMode: 'exploratory',
    allowedActionTypes: ['add_income', 'set_income_discovery', 'update_field', 'remove_item', 'navigate', 'no_action'],
    writableFields: ['otherIncome', 'alimonyReceived', 'gamblingLosses', 'nolCarryforward'],
    isRelevant: always,
    isComplete: (tr) =>
      tr.incomeDiscovery['other_income_asked'] === 'yes' ||
      (tr.incomeDiscovery['1099sa'] !== undefined &&
       tr.incomeDiscovery['w2g'] !== undefined),
  },

  // ── Self-Employment ─────────────────────────────
  {
    id: 'self-employment',
    domain: 'Self-Employment / Schedule C',
    phase: 'self_employment',
    order: 10,
    prerequisites: ['income-freelance'],
    expectedTurns: 10,
    interactionMode: 'half-sheet',
    allowedActionTypes: [
      'update_business', 'add_business_expense', 'update_home_office',
      'update_vehicle', 'update_se_retirement', 'remove_item',
      'navigate', 'no_action',
    ],
    writableFields: [],
    isRelevant: (tr) =>
      tr.incomeDiscovery['1099nec'] === 'yes' ||
      tr.incomeDiscovery['1099k'] === 'yes' ||
      tr.businesses.length > 0,
    isComplete: (tr) =>
      tr.businesses.length > 0 && tr.expenses.length > 0,
  },

  // ── Deductions ──────────────────────────────────
  {
    id: 'deductions-discovery',
    domain: 'Deduction Discovery',
    phase: 'deductions',
    order: 11,
    prerequisites: [],
    expectedTurns: 5,
    interactionMode: 'exploratory',
    allowedActionTypes: ['set_income_discovery', 'set_deduction_method', 'navigate', 'no_action'],
    writableFields: [],
    isRelevant: always,
    isComplete: (tr) => tr.deductionMethod !== undefined,
  },
  {
    id: 'deductions-itemized',
    domain: 'Itemized Deductions',
    phase: 'deductions',
    order: 12,
    prerequisites: ['deductions-discovery'],
    expectedTurns: 6,
    interactionMode: 'exploratory',
    allowedActionTypes: ['update_itemized', 'update_field', 'navigate', 'no_action'],
    writableFields: ['alimonyPaid'],
    isRelevant: (tr) => tr.deductionMethod === 'itemized',
    isComplete: (tr) =>
      tr.deductionMethod === 'standard' || !!tr.itemizedDeductions,
  },
  {
    id: 'deductions-above-line',
    domain: 'Above-the-Line Adjustments',
    phase: 'deductions',
    order: 13,
    prerequisites: ['deductions-discovery'],
    expectedTurns: 5,
    interactionMode: 'exploratory',
    allowedActionTypes: ['update_field', 'set_income_discovery', 'navigate', 'no_action'],
    writableFields: [
      'hsaDeduction', 'studentLoanInterest', 'iraContribution', 'iraContributionSpouse',
      'educatorExpenses', 'movingExpenses', 'nontaxableCombatPay',
    ],
    isRelevant: always,
    isComplete: (tr) =>
      tr.incomeDiscovery['above_line_asked'] === 'yes' ||
      tr.hsaDeduction !== undefined ||
      tr.studentLoanInterest !== undefined ||
      tr.iraContribution !== undefined,
  },

  // ── Credits ─────────────────────────────────────
  {
    id: 'credits',
    domain: 'Tax Credits',
    phase: 'credits',
    order: 14,
    prerequisites: [],
    expectedTurns: 6,
    interactionMode: 'exploratory',
    allowedActionTypes: ['update_field', 'set_income_discovery', 'navigate', 'no_action'],
    writableFields: ['estimatedPaymentsMade'],
    isRelevant: always,
    isComplete: (tr) =>
      tr.incomeDiscovery['credits_asked'] === 'yes' ||
      tr.educationCredits.length > 0 ||
      !!tr.dependentCare ||
      !!tr.cleanEnergy ||
      !!tr.evCredit,
  },

  // ── State ───────────────────────────────────────
  {
    id: 'state-taxes',
    domain: 'State Tax Returns',
    phase: 'state',
    order: 15,
    prerequisites: [],
    expectedTurns: 3,
    interactionMode: 'fast-capture',
    allowedActionTypes: ['update_field', 'set_income_discovery', 'navigate', 'no_action'],
    writableFields: [],
    isRelevant: (tr) =>
      (tr.stateReturns?.length ?? 0) > 0 || !!tr.addressState,
    isComplete: (tr) =>
      (tr.stateReturns?.length ?? 0) > 0 ||
      tr.incomeDiscovery['state_asked'] === 'yes',
  },

  // ── Review & Finish ─────────────────────────────
  {
    id: 'review',
    domain: 'Return Review',
    phase: 'review',
    order: 16,
    prerequisites: [],
    expectedTurns: 3,
    interactionMode: 'confirmation',
    allowedActionTypes: ['update_field', 'navigate', 'no_action'],
    writableFields: [],
    isRelevant: always,
    isComplete: (tr) =>
      tr.status === 'review' || tr.status === 'completed',
  },
  {
    id: 'finish',
    domain: 'Filing & Export',
    phase: 'finish',
    order: 17,
    prerequisites: ['review'],
    expectedTurns: 3,
    interactionMode: 'confirmation',
    allowedActionTypes: ['update_field', 'navigate', 'no_action'],
    writableFields: [],
    isRelevant: always,
    isComplete: (tr) => tr.status === 'completed',
  },
];
