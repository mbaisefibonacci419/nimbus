/**
 * Agent Orchestrator Unit Tests
 *
 * Tests the state machine that manages the agent-led tax interview:
 * skill selection, completion tracking, state persistence, topic
 * detours, transition messages, and action validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaxReturn } from '@nimbus/engine';

// ─── Mocks ────────────────────────────────────────

vi.mock('../services/agent/ContextSlicer', () => ({
  buildContextSlice: vi.fn(() => ({})),
}));

vi.mock('../services/agent/TopicDetector', () => ({
  detectTopicSwitch: vi.fn(() => null),
}));

import {
  AgentOrchestrator,
  createInitialAgentState,
  type AgentState,
} from '../services/agent/AgentOrchestrator';
import { SKILL_REGISTRY } from '../services/agent/SkillRegistry';
import { detectTopicSwitch } from '../services/agent/TopicDetector';

// ─── Helpers ──────────────────────────────────────

function makeReturn(overrides: Partial<TaxReturn> = {}): TaxReturn {
  return {
    id: 'test-return-1',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    taxYear: 2025,
    status: 'in_progress',
    firstName: '',
    lastName: '',
    dependents: [],
    w2Income: [],
    income1099NEC: [],
    income1099K: [],
    income1099INT: [],
    income1099DIV: [],
    income1099R: [],
    income1099G: [],
    income1099B: [],
    income1099MISC: [],
    businesses: [],
    expenses: [],
    rentalProperties: [],
    educationCredits: [],
    incomeDiscovery: {},
    ...overrides,
  } as TaxReturn;
}

function makeCompletedReturn(): TaxReturn {
  return makeReturn({
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1990-01-15',
    addressStreet: '123 Main St',
    addressCity: 'Springfield',
    addressState: 'CA',
    addressZip: '90210',
    filingStatus: 1,
    incomeDiscovery: {
      dependents_asked: 'yes',
      w2: 'no',
      '1099nec': 'no',
      '1099k': 'no',
      '1099b': 'no',
      '1099div': 'no',
      '1099int': 'no',
      '1099r': 'no',
      ssa1099: 'no',
      '1099g': 'no',
      other_income_asked: 'yes',
      above_line_asked: 'yes',
      credits_asked: 'yes',
      state_asked: 'yes',
    },
    deductionMethod: 'standard' as any,
  });
}

// ─── Tests ────────────────────────────────────────

describe('createInitialAgentState', () => {
  it('returns a clean initial state', () => {
    const state = createInitialAgentState();
    expect(state.phase).toBe('onboarding');
    expect(state.activeSkill).toBeNull();
    expect(state.completed).toEqual({});
    expect(state.skipped).toEqual([]);
    expect(state.currentTurnCount).toBe(0);
    expect(state.totalTurnCount).toBe(0);
    expect(state.detourSkill).toBeNull();
    expect(state.returnToSkill).toBeNull();
  });
});

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    orchestrator = new AgentOrchestrator();
    vi.mocked(detectTopicSwitch).mockReturnValue(null);
  });

  // ── selectNextSkill ────────────────────────────

  describe('selectNextSkill', () => {
    it('selects personal-info first on an empty return', () => {
      const tr = makeReturn();
      const skill = orchestrator.selectNextSkill(tr);
      expect(skill).toBe('personal-info');
    });

    it('returns the active skill if it is not complete', () => {
      const tr = makeReturn();
      orchestrator.activateSkill('personal-info');
      const skill = orchestrator.selectNextSkill(tr);
      expect(skill).toBe('personal-info');
    });

    it('advances past completed skills', () => {
      const tr = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'NY',
      });
      orchestrator.syncCompletionFromReturn(tr);
      const skill = orchestrator.selectNextSkill(tr);
      expect(skill).toBe('filing-status');
    });

    it('skips skills blocked by prerequisites', () => {
      const tr = makeReturn();
      // filing-status requires personal-info; dependents requires filing-status
      const skill = orchestrator.selectNextSkill(tr);
      expect(skill).toBe('personal-info');
      expect(skill).not.toBe('filing-status');
      expect(skill).not.toBe('dependents');
    });

    it('skips irrelevant skills', () => {
      const tr = makeCompletedReturn();
      orchestrator.syncCompletionFromReturn(tr);
      // self-employment should be skipped (no SE income)
      const state = orchestrator.getState();
      expect(state.completed['self-employment']).toBeUndefined();
      // It shouldn't be selected because isRelevant returns false
      const nextSkill = orchestrator.selectNextSkill(tr);
      expect(nextSkill).not.toBe('self-employment');
    });

    it('returns null when all skills are complete', () => {
      const tr = makeCompletedReturn();
      tr.status = 'completed' as any;
      orchestrator.syncCompletionFromReturn(tr);
      // Manually complete review since status check needs 'review' or 'completed'
      const skill = orchestrator.selectNextSkill(tr);
      expect(skill).toBeNull();
    });

    it('returns detour skill when one is active', () => {
      const tr = makeReturn();
      orchestrator.activateSkill('personal-info');
      // Simulate a detour
      const state = orchestrator.getState();
      state.detourSkill = 'income-wages';
      state.returnToSkill = 'personal-info';
      const skill = orchestrator.selectNextSkill(tr);
      expect(skill).toBe('income-wages');
    });
  });

  // ── syncCompletionFromReturn ───────────────────

  describe('syncCompletionFromReturn', () => {
    it('marks personal-info as complete when all required fields are set', () => {
      const tr = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
      });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['personal-info']).toBeDefined();
    });

    it('does not mark personal-info complete when fields are missing', () => {
      const tr = makeReturn({ firstName: 'Jane' });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['personal-info']).toBeUndefined();
    });

    it('marks filing-status as complete when filingStatus is set', () => {
      const tr = makeReturn({ filingStatus: 1 });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['filing-status']).toBeDefined();
    });

    it('clears activeSkill when the active skill is auto-completed', () => {
      const tr = makeReturn();
      orchestrator.activateSkill('personal-info');
      expect(orchestrator.getState().activeSkill).toBe('personal-info');

      // Now fill in the data
      const tr2 = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
      });
      orchestrator.syncCompletionFromReturn(tr2);
      expect(orchestrator.getState().activeSkill).toBeNull();
      expect(orchestrator.getState().completed['personal-info']).toBeDefined();
    });

    it('preserves turn count when auto-completing the active skill', () => {
      orchestrator.activateSkill('personal-info');
      orchestrator.recordTurn();
      orchestrator.recordTurn();
      orchestrator.recordTurn();

      const tr = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
      });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['personal-info']!.turnCount).toBe(3);
    });

    it('does not re-complete already completed skills', () => {
      const tr = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
      });
      orchestrator.syncCompletionFromReturn(tr);
      const firstTimestamp = orchestrator.getState().completed['personal-info']!.completedAt;

      // Sync again — should not overwrite
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['personal-info']!.completedAt).toBe(firstTimestamp);
    });

    it('does not complete skipped skills', () => {
      orchestrator.activateSkill('personal-info');
      orchestrator.skipActiveSkill();

      const tr = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
      });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['personal-info']).toBeUndefined();
      expect(orchestrator.getState().skipped).toContain('personal-info');
    });
  });

  // ── activateSkill ──────────────────────────────

  describe('activateSkill', () => {
    it('sets the active skill and phase', () => {
      orchestrator.activateSkill('income-wages');
      const state = orchestrator.getState();
      expect(state.activeSkill).toBe('income-wages');
      expect(state.phase).toBe('income');
    });

    it('resets turn count when switching skills', () => {
      orchestrator.activateSkill('personal-info');
      orchestrator.recordTurn();
      orchestrator.recordTurn();
      expect(orchestrator.getState().currentTurnCount).toBe(2);

      orchestrator.activateSkill('filing-status');
      expect(orchestrator.getState().currentTurnCount).toBe(0);
    });

    it('does not reset turn count when re-activating the same skill', () => {
      orchestrator.activateSkill('personal-info');
      orchestrator.recordTurn();
      orchestrator.recordTurn();

      orchestrator.activateSkill('personal-info');
      expect(orchestrator.getState().currentTurnCount).toBe(2);
    });
  });

  // ── completeActiveSkill ────────────────────────

  describe('completeActiveSkill', () => {
    it('marks the active skill as completed and clears it', () => {
      orchestrator.activateSkill('personal-info');
      orchestrator.recordTurn();
      orchestrator.completeActiveSkill();

      const state = orchestrator.getState();
      expect(state.completed['personal-info']).toBeDefined();
      expect(state.completed['personal-info']!.turnCount).toBe(1);
      expect(state.activeSkill).toBeNull();
      expect(state.currentTurnCount).toBe(0);
    });

    it('does nothing when no skill is active', () => {
      orchestrator.completeActiveSkill();
      expect(Object.keys(orchestrator.getState().completed)).toHaveLength(0);
    });

    it('returns to the original skill after completing a detour', () => {
      orchestrator.activateSkill('personal-info');
      const state = orchestrator.getState();
      state.returnToSkill = 'personal-info';
      state.detourSkill = 'income-wages';
      state.activeSkill = 'income-wages';

      orchestrator.completeActiveSkill();
      expect(orchestrator.getState().activeSkill).toBe('personal-info');
      expect(orchestrator.getState().detourSkill).toBeNull();
      expect(orchestrator.getState().returnToSkill).toBeNull();
    });
  });

  // ── skipActiveSkill ────────────────────────────

  describe('skipActiveSkill', () => {
    it('adds the skill to skipped and clears active', () => {
      orchestrator.activateSkill('personal-info');
      orchestrator.skipActiveSkill();

      const state = orchestrator.getState();
      expect(state.skipped).toContain('personal-info');
      expect(state.activeSkill).toBeNull();
    });

    it('skipped skills are not selected by selectNextSkill', () => {
      const tr = makeReturn();
      orchestrator.activateSkill('personal-info');
      orchestrator.skipActiveSkill();

      const next = orchestrator.selectNextSkill(tr);
      // personal-info was skipped, but filing-status requires personal-info
      // as a prerequisite, so the next skill without unmet prerequisites is
      // deductions-discovery (which has no prerequisites)
      expect(next).not.toBe('personal-info');
      expect(orchestrator.getState().skipped).toContain('personal-info');
    });
  });

  // ── recordTurn ─────────────────────────────────

  describe('recordTurn', () => {
    it('increments both current and total turn counts', () => {
      orchestrator.recordTurn();
      orchestrator.recordTurn();

      const state = orchestrator.getState();
      expect(state.currentTurnCount).toBe(2);
      expect(state.totalTurnCount).toBe(2);
    });

    it('total count persists across skill changes', () => {
      orchestrator.activateSkill('personal-info');
      orchestrator.recordTurn();
      orchestrator.recordTurn();

      orchestrator.activateSkill('filing-status');
      orchestrator.recordTurn();

      const state = orchestrator.getState();
      expect(state.currentTurnCount).toBe(1);
      expect(state.totalTurnCount).toBe(3);
    });
  });

  // ── handleTopicSwitch ──────────────────────────

  describe('handleTopicSwitch', () => {
    it('sets detour state when a topic switch is detected', () => {
      vi.mocked(detectTopicSwitch).mockReturnValue('deductions-itemized');
      orchestrator.activateSkill('income-wages');

      const tr = makeReturn();
      const detour = orchestrator.handleTopicSwitch('I paid $9000 in mortgage interest', tr);

      expect(detour).toBe('deductions-itemized');
      const state = orchestrator.getState();
      expect(state.detourSkill).toBe('deductions-itemized');
      expect(state.returnToSkill).toBe('income-wages');
      expect(state.activeSkill).toBe('deductions-itemized');
    });

    it('prevents nested detours', () => {
      vi.mocked(detectTopicSwitch).mockReturnValue('credits');
      orchestrator.activateSkill('income-wages');

      const tr = makeReturn();
      // First detour succeeds
      const state = orchestrator.getState();
      state.detourSkill = 'deductions-itemized';
      state.returnToSkill = 'income-wages';

      const detour = orchestrator.handleTopicSwitch('what about child credit', tr);
      expect(detour).toBeNull();
    });

    it('returns null when no switch is detected', () => {
      vi.mocked(detectTopicSwitch).mockReturnValue(null);
      orchestrator.activateSkill('income-wages');

      const tr = makeReturn();
      const detour = orchestrator.handleTopicSwitch('I made $75000', tr);
      expect(detour).toBeNull();
    });
  });

  // ── isSkillStuck ───────────────────────────────

  describe('isSkillStuck', () => {
    it('returns false when under the expected turn budget', () => {
      orchestrator.activateSkill('personal-info'); // expectedTurns: 4
      orchestrator.recordTurn();
      orchestrator.recordTurn();
      expect(orchestrator.isSkillStuck()).toBe(false);
    });

    it('returns true when over 2x the expected turns', () => {
      orchestrator.activateSkill('personal-info'); // expectedTurns: 4
      for (let i = 0; i < 9; i++) orchestrator.recordTurn();
      expect(orchestrator.isSkillStuck()).toBe(true);
    });

    it('returns false at exactly 2x turns', () => {
      orchestrator.activateSkill('personal-info'); // expectedTurns: 4
      for (let i = 0; i < 8; i++) orchestrator.recordTurn();
      expect(orchestrator.isSkillStuck()).toBe(false);
    });
  });

  // ── validateActions ────────────────────────────

  describe('validateActions', () => {
    it('accepts actions matching the skill allowlist', () => {
      orchestrator.activateSkill('personal-info');
      const actions = [
        { type: 'update_field', field: 'firstName', value: 'Jane' },
        { type: 'no_action' },
      ] as any[];

      const result = orchestrator.validateActions(actions);
      expect(result.valid).toHaveLength(2);
      expect(result.rejected).toHaveLength(0);
    });

    it('rejects actions not in the skill allowlist', () => {
      orchestrator.activateSkill('personal-info');
      const actions = [
        { type: 'add_income', incomeType: 'w2', fields: {} },
      ] as any[];

      const result = orchestrator.validateActions(actions);
      expect(result.valid).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });

    it('rejects all actions when no skill is active', () => {
      const actions = [{ type: 'no_action' }] as any[];
      const result = orchestrator.validateActions(actions);
      expect(result.valid).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });
  });

  // ── buildTransitionMessage ─────────────────────

  describe('buildTransitionMessage', () => {
    it('produces a fast-capture message for personal-info', () => {
      const tr = makeReturn();
      const transition = orchestrator.buildTransitionMessage(tr);
      expect(transition).not.toBeNull();
      expect(transition!.message).toContain('Personal Information');
      expect(transition!.options).toBeDefined();
      expect(transition!.options!.length).toBeGreaterThanOrEqual(2);
    });

    it('shows correct progress count', () => {
      const tr = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
        filingStatus: 1,
      });
      orchestrator.syncCompletionFromReturn(tr);
      const transition = orchestrator.buildTransitionMessage(tr);
      expect(transition!.message).toMatch(/\d+\/\d+ sections done/);
    });

    it('returns a completion message when all skills are done', () => {
      const tr = makeCompletedReturn();
      tr.status = 'completed' as any;
      orchestrator.syncCompletionFromReturn(tr);
      const transition = orchestrator.buildTransitionMessage(tr);
      expect(transition).not.toBeNull();
      expect(transition!.message).toContain('complete');
    });
  });

  // ── State persistence round-trip ───────────────

  describe('state persistence', () => {
    it('restores correctly from a serialized state', () => {
      orchestrator.activateSkill('personal-info');
      orchestrator.recordTurn();
      orchestrator.recordTurn();

      const serialized = JSON.parse(JSON.stringify(orchestrator.getState()));
      const restored = new AgentOrchestrator(serialized);

      expect(restored.getState().activeSkill).toBe('personal-info');
      expect(restored.getState().currentTurnCount).toBe(2);
      expect(restored.getState().totalTurnCount).toBe(2);
    });

    it('completed skills survive serialization round-trip', () => {
      orchestrator.activateSkill('personal-info');
      orchestrator.completeActiveSkill();

      const serialized = JSON.parse(JSON.stringify(orchestrator.getState()));
      const restored = new AgentOrchestrator(serialized);

      expect(restored.getState().completed['personal-info']).toBeDefined();
      expect(restored.getState().activeSkill).toBeNull();
    });
  });

  // ── writableFields / WRITABLE_BY_AI parity ────

  describe('writableFields parity', () => {
    it('every skill has a writableFields array', () => {
      for (const entry of SKILL_REGISTRY) {
        expect(entry.writableFields).toBeDefined();
        expect(Array.isArray(entry.writableFields)).toBe(true);
      }
    });

    it('skills with update_field but empty writableFields do not leak writes', () => {
      const leaky = SKILL_REGISTRY.filter(
        (s) =>
          s.allowedActionTypes.includes('update_field') &&
          s.writableFields.length === 0 &&
          // These skills intentionally have update_field for the orchestrator
          // to use with no writable fields (navigate-only or confirmation skills)
          !['income-property', 'state-taxes', 'review', 'finish'].includes(s.id),
      );
      expect(leaky).toHaveLength(0);
    });

    it('no duplicate fields in any skill writableFields', () => {
      for (const entry of SKILL_REGISTRY) {
        const unique = new Set(entry.writableFields);
        expect(unique.size).toBe(entry.writableFields.length);
      }
    });
  });

  // ── Full flow integration ──────────────────────

  describe('full onboarding flow', () => {
    it('progresses through personal-info → filing-status → dependents', () => {
      const tr = makeReturn();

      // Start: personal-info
      let skill = orchestrator.selectNextSkill(tr);
      expect(skill).toBe('personal-info');
      orchestrator.activateSkill(skill!);

      // Complete personal info
      const tr2 = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
      });
      orchestrator.syncCompletionFromReturn(tr2);
      expect(orchestrator.getState().completed['personal-info']).toBeDefined();
      expect(orchestrator.getState().activeSkill).toBeNull();

      // Next: filing-status
      skill = orchestrator.selectNextSkill(tr2);
      expect(skill).toBe('filing-status');
      orchestrator.activateSkill(skill!);

      // Complete filing status
      const tr3 = makeReturn({
        ...tr2,
        filingStatus: 1,
      } as any);
      orchestrator.syncCompletionFromReturn(tr3);
      expect(orchestrator.getState().completed['filing-status']).toBeDefined();

      // Next: dependents
      skill = orchestrator.selectNextSkill(tr3);
      expect(skill).toBe('dependents');
    });
  });

  // ── Section completion: "no items" path (Bug Fix #3) ──

  describe('section completion via discovery flags', () => {
    it('dependents completes when dependents_asked is set', () => {
      const tr = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
        filingStatus: 1,
        incomeDiscovery: { dependents_asked: 'yes' },
      });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['dependents']).toBeDefined();
    });

    it('dependents does NOT complete without dependents_asked and no dependents', () => {
      const tr = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
        filingStatus: 1,
      });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['dependents']).toBeUndefined();
    });

    it('credits completes when credits_asked is set', () => {
      const tr = makeReturn({
        incomeDiscovery: { credits_asked: 'yes' },
      });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['credits']).toBeDefined();
    });

    it('state-taxes completes when state_asked is set', () => {
      const tr = makeReturn({
        addressState: 'CA',
        incomeDiscovery: { state_asked: 'yes' },
      });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['state-taxes']).toBeDefined();
    });

    it('deductions-above-line completes when above_line_asked is set', () => {
      const tr = makeReturn({
        deductionMethod: 'standard' as any,
        incomeDiscovery: { above_line_asked: 'yes' },
      });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['deductions-above-line']).toBeDefined();
    });

    it('income-other completes when other_income_asked is set', () => {
      const tr = makeReturn({
        incomeDiscovery: { other_income_asked: 'yes' },
      });
      orchestrator.syncCompletionFromReturn(tr);
      expect(orchestrator.getState().completed['income-other']).toBeDefined();
    });
  });

  // ── Allowed action types for completion flags (Bug Fix #3) ──

  describe('set_income_discovery is allowed for flag-dependent skills', () => {
    const FLAG_SKILLS = [
      'dependents',
      'deductions-above-line',
      'credits',
      'state-taxes',
    ];

    for (const skillId of FLAG_SKILLS) {
      it(`${skillId} allows set_income_discovery`, () => {
        const entry = SKILL_REGISTRY.find((s) => s.id === skillId);
        expect(entry).toBeDefined();
        expect(entry!.allowedActionTypes).toContain('set_income_discovery');
      });
    }

    it('dependents validates set_income_discovery as allowed', () => {
      orchestrator.activateSkill('dependents');
      const actions = [
        { type: 'set_income_discovery', incomeType: 'dependents_asked', value: 'yes' },
      ] as any[];
      const result = orchestrator.validateActions(actions);
      expect(result.valid).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
    });
  });

  // ── buildTransitionMessage dedup guard (Bug Fix #2) ──

  describe('buildTransitionMessage consistency', () => {
    it('returns options for fast-capture skills', () => {
      const tr = makeReturn();
      const transition = orchestrator.buildTransitionMessage(tr);
      expect(transition).not.toBeNull();
      expect(transition!.options).toBeDefined();
      expect(transition!.options!.some((o) => o.label.includes("let's go") || o.label.includes('Skip'))).toBe(true);
    });

    it('returns different option sets for exploratory skills', () => {
      const tr = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
        filingStatus: 1,
        incomeDiscovery: {
          dependents_asked: 'yes',
          w2: 'no',
          '1099nec': 'no',
          '1099k': 'no',
          '1099b': 'no',
          '1099div': 'no',
          '1099int': 'no',
          '1099r': 'no',
          ssa1099: 'no',
          '1099g': 'no',
        },
      });
      orchestrator.syncCompletionFromReturn(tr);
      const transition = orchestrator.buildTransitionMessage(tr);
      expect(transition).not.toBeNull();
      // The next skill should be an exploratory one (income-other or deductions-discovery)
      expect(transition!.options).toBeDefined();
    });
  });

  // ── Completion instructions (Bug Fix #3) ──

  describe('buildPrompt includes completion instructions', () => {
    it('includes completion instructions for dependents', () => {
      orchestrator.activateSkill('dependents');
      const tr = makeReturn({ filingStatus: 1 });
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('dependents_asked');
      expect(prompt).toContain('set_income_discovery');
      expect(prompt).toContain('CRITICAL');
    });

    it('includes completion instructions for credits', () => {
      orchestrator.activateSkill('credits');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('credits_asked');
      expect(prompt).toContain('set_income_discovery');
    });

    it('includes completion instructions for state-taxes', () => {
      orchestrator.activateSkill('state-taxes');
      const tr = makeReturn({ addressState: 'CA' });
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('state_asked');
      expect(prompt).toContain('set_income_discovery');
    });

    it('personal-info has generic completion instructions (no flag needed)', () => {
      orchestrator.activateSkill('personal-info');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('Section Completion');
      expect(prompt).toContain('automatically');
    });

    it('filing-status prompt includes all five filing status options', () => {
      orchestrator.activateSkill('filing-status');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('"Single"');
      expect(prompt).toContain('"Married Filing Jointly"');
      expect(prompt).toContain('"Married Filing Separately"');
      expect(prompt).toContain('"Head of Household"');
      expect(prompt).toContain('"Qualifying Surviving Spouse"');
      expect(prompt).toContain('set_filing_status');
    });

    it('income-other prompt includes category options', () => {
      orchestrator.activateSkill('income-other');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('Gambling winnings');
      expect(prompt).toContain('HSA distributions');
      expect(prompt).toContain('"None of these"');
    });

    it('credits prompt includes credit category options', () => {
      orchestrator.activateSkill('credits');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('Child Tax Credit');
      expect(prompt).toContain('Education credits');
      expect(prompt).toContain('Dependent care');
      expect(prompt).toContain('"None of these"');
    });

    it('deductions-above-line prompt includes adjustment options', () => {
      orchestrator.activateSkill('deductions-above-line');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('HSA contributions');
      expect(prompt).toContain('Student loan interest');
      expect(prompt).toContain('"None of these"');
    });

    it('exploratory mode instructions mandate structured options', () => {
      orchestrator.activateSkill('income-other'); // exploratory mode
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('MANDATORY');
      expect(prompt).toContain('MUST include');
      expect(prompt).toContain('NEVER list categories only in the message text');
    });

    it('system prompt explains multiSelect for category-based skills', () => {
      orchestrator.activateSkill('credits');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('multiSelect');
      expect(prompt).toContain('MULTI-SELECT');
    });

    it('income-other prompt instructs LLM to set multiSelect: true', () => {
      orchestrator.activateSkill('income-other');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('"multiSelect": true');
    });

    it('deductions-above-line prompt instructs LLM to set multiSelect: true', () => {
      orchestrator.activateSkill('deductions-above-line');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      expect(prompt).toContain('"multiSelect": true');
    });

    it('filing-status completion instructions do not instruct multiSelect', () => {
      orchestrator.activateSkill('filing-status');
      const tr = makeReturn();
      const prompt = orchestrator.buildPrompt(tr, null, 'test skill prompt');
      const completionSection = prompt.split('## Section Completion')[1]?.split('##')[0] ?? '';
      expect(completionSection).not.toContain('"multiSelect": true');
      expect(completionSection).toContain('set_filing_status');
    });
  });

  // ── End-to-end: "no dependents" flow ──

  describe('end-to-end: no-dependents completion', () => {
    it('dependents section completes and advances when user has none', () => {
      // Setup: personal-info + filing-status completed
      const tr1 = makeReturn({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        addressState: 'CA',
        filingStatus: 1,
      });
      orchestrator.syncCompletionFromReturn(tr1);
      expect(orchestrator.getState().completed['personal-info']).toBeDefined();
      expect(orchestrator.getState().completed['filing-status']).toBeDefined();

      // Activate dependents
      const next = orchestrator.selectNextSkill(tr1);
      expect(next).toBe('dependents');
      orchestrator.activateSkill(next!);

      // Simulate: AI sets dependents_asked = yes (user said "no dependents")
      const tr2 = makeReturn({
        ...tr1,
        incomeDiscovery: { dependents_asked: 'yes' },
      } as any);
      orchestrator.syncCompletionFromReturn(tr2);

      expect(orchestrator.getState().completed['dependents']).toBeDefined();
      expect(orchestrator.getState().activeSkill).toBeNull();

      // Next skill should advance past dependents
      const nextAfter = orchestrator.selectNextSkill(tr2);
      expect(nextAfter).not.toBe('dependents');
      expect(nextAfter).toBe('income-wages');
    });
  });
});
