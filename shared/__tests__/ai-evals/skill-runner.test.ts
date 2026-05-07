/**
 * Per-Skill Eval Suite — Nimbus AI
 *
 * Offline fixtures grouped by skill directory (income, deductions, credits, meta).
 * Uses the same simulated-response + parseResponse validation as eval-runner.test.ts.
 *
 * Usage:
 *   npx vitest run shared/__tests__/ai-evals/skill-runner.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseResponse } from '../../src/utils/llmResponseParser.js';
import type { EvalFixture } from './evalHarness.js';
import { runSingleFixtureEval } from './evalHarness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SKILLS_DIR = join(__dirname, 'skills');

function discoverSkillFixtures(): Map<string, EvalFixture[]> {
  const skills = new Map<string, EvalFixture[]>();
  const topEntries = readdirSync(SKILLS_DIR, { withFileTypes: true });

  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    const dir = join(SKILLS_DIR, skillName);
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const fixtures: EvalFixture[] = [];
    for (const file of files) {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const parsed = JSON.parse(raw) as EvalFixture[];
      fixtures.push(...parsed);
    }
    skills.set(skillName, fixtures);
  }

  return skills;
}

describe('Per-Skill Eval Suite', () => {
  const skillFixtures = discoverSkillFixtures();

  it('discovers all skill directories with fixtures', () => {
    expect(skillFixtures.size).toBeGreaterThanOrEqual(4);
    for (const [name, fixtures] of skillFixtures) {
      void name;
      expect(fixtures.length).toBeGreaterThan(0);
    }
  });

  for (const [skillName, fixtures] of skillFixtures) {
    describe(`Skill: ${skillName}`, () => {
      for (const fixture of fixtures) {
        it(`${fixture.id}: ${fixture.description}`, () => {
          runSingleFixtureEval(fixture, parseResponse);
        });
      }
    });
  }

  it('tracks per-skill pass rates (offline harness should be 100%)', () => {
    const summary: { skill: string; total: number; passed: number }[] = [];

    for (const [skillName, fixtures] of skillFixtures) {
      let passed = 0;
      for (const fixture of fixtures) {
        try {
          runSingleFixtureEval(fixture, parseResponse);
          passed++;
        } catch {
          // counted below
        }
      }
      summary.push({ skill: skillName, total: fixtures.length, passed });
      expect(passed).toBe(fixtures.length);
    }

    // Visible in vitest output for trend logging
    const lines = summary.map(
      s => `  ${s.skill}: ${s.passed}/${s.total} (${((s.passed / s.total) * 100).toFixed(0)}%)`,
    );
    console.log('[Per-Skill Eval Summary]\n' + lines.join('\n'));
  });
});
