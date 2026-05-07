import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  SYSTEM_PROMPT,
  ACTION_SCHEMAS,
} from '../src/services/systemPrompt.js';

const SECTION_MARKERS = [
  'ACTION TYPES:',
  'FORM ROUTING GUIDE:',
  'FEATURE-SPECIFIC GUIDANCE:',
  'VALIDATION WARNINGS (warningsContext):',
  'GUIDED INTERVIEW MODE:',
  'IRS REFERENCE DATA:',
  'FEW-SHOT EXAMPLES:',
  'NIMBUS APP FEATURES:',
  'PRIVACY:',
  'TAX YEAR: 2025',
] as const;

describe('buildSystemPrompt', () => {
  it('with no args returns full prompt containing all section markers', () => {
    const full = buildSystemPrompt();
    for (const m of SECTION_MARKERS) {
      expect(full).toContain(m);
    }
  });

  it('includes core identity and tax year footer', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('You are a tax preparation assistant');
    expect(p).toContain('TAX YEAR: 2025');
  });

  it('includes all 14 action types (through no_action)', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('1. add_income');
    expect(p).toContain('14. no_action');
    const numbered = ACTION_SCHEMAS.match(/^\d+\./gm) ?? [];
    expect(new Set(numbered).size).toBe(14);
  });

  it('includes interview content for income section', () => {
    const p = buildSystemPrompt({ currentSection: 'income' });
    expect(p).toContain('GUIDED INTERVIEW MODE:');
  });

  it('for credits still includes action schemas', () => {
    const p = buildSystemPrompt({ currentSection: 'credits' });
    expect(p).toContain('ACTION TYPES:');
    expect(p).toContain('14. no_action');
  });

  it('matches SYSTEM_PROMPT for default / backward compat', () => {
    expect(buildSystemPrompt()).toBe(SYSTEM_PROMPT);
    expect(buildSystemPrompt({})).toBe(SYSTEM_PROMPT);
  });

  it('parameterizes tax year in prompt when taxYear option is set', () => {
    expect(buildSystemPrompt({ taxYear: 2025 })).toContain('2025 US federal tax return');
    const y2026 = buildSystemPrompt({ taxYear: 2026 });
    expect(y2026).toContain('2026 US federal tax return');
    expect(y2026).toContain('TAX YEAR: 2026');
    expect(y2026).not.toContain('TAX YEAR: 2025');
  });

  it('uses shorter prompts for section-specific options (token savings)', () => {
    const full = buildSystemPrompt();
    const credits = buildSystemPrompt({ currentSection: 'credits' });
    const income = buildSystemPrompt({ currentSection: 'income' });
    expect(credits.length).toBeLessThan(full.length);
    expect(income.length).toBeLessThan(full.length);
    expect(credits.length).not.toBe(income.length);
  });

  it('includes app features when activeToolId is set', () => {
    const p = buildSystemPrompt({
      currentSection: 'credits',
      activeToolId: 'scenario_lab',
    });
    expect(p).toContain('NIMBUS APP FEATURES:');
    expect(p).toContain('Tax Scenario Lab');
  });

  it('omits app features for credits without activeToolId', () => {
    const p = buildSystemPrompt({ currentSection: 'credits' });
    expect(p).not.toContain('NIMBUS APP FEATURES:');
  });
});
