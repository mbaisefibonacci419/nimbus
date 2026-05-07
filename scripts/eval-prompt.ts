/**
 * Prompt Regression Harness
 *
 * Runs the full system prompt against a live LLM and scores outputs
 * against the eval fixture expected values. Generates a scorecard
 * with per-category and overall accuracy metrics.
 *
 * This is NOT run on every commit — it's run nightly or before prompt changes.
 *
 * Usage:
 *   npx tsx scripts/eval-prompt.ts
 *   npx tsx scripts/eval-prompt.ts --model claude-sonnet-4-20250514
 *   npx tsx scripts/eval-prompt.ts --category income-entry
 *   npx tsx scripts/eval-prompt.ts --skill income
 *   npx tsx scripts/eval-prompt.ts --skill income/w2
 *   npx tsx scripts/eval-prompt.ts --dry-run
 *
 * Environment:
 *   ANTHROPIC_API_KEY — Required. Set in .env at project root or as an env var.
 *
 * Options:
 *   --model <name>      Model to test (default: claude-sonnet-4-20250514)
 *   --category <name>   Run only one flat fixture file (fixtures/*.json); ignored if --skill is set
 *   --skill <path>      Run skill fixtures under shared/__tests__/ai-evals/skills/<path>
 *                       (directory, e.g. income, or file stem, e.g. income/w2 -> income/w2.json)
 *   --dry-run           Show what would be run without calling the API
 *   --concurrency <n>   Max parallel API calls (default: 3)
 *   --output <path>     Write JSON results to file (default: stdout summary)
 */

import { config } from 'dotenv';
config(); // load .env from project root

import Anthropic from '@anthropic-ai/sdk';
import { parseResponse, buildIrsReferenceData } from '@nimbus/engine';
import { buildSystemPrompt } from '../server/src/services/systemPrompt.js';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import * as tax2025 from '../shared/src/constants/tax2025.js';
import { AMT_2025 } from '../shared/src/constants/amt2025.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── IRS Constants Allowlist ────────────────────────
// Extracts every numeric value from the engine's tax constants so the
// hallucination checker doesn't flag legitimate IRS-published figures.

function extractAllNumbers(obj: unknown, seen = new WeakSet()): Set<number> {
  const nums = new Set<number>();
  if (obj == null) return nums;
  if (typeof obj === 'number' && isFinite(obj) && obj > 100) {
    nums.add(obj);
    return nums;
  }
  if (typeof obj !== 'object') return nums;
  if (seen.has(obj as object)) return nums;
  seen.add(obj as object);
  const values = Array.isArray(obj) ? obj : Object.values(obj as Record<string, unknown>);
  for (const v of values) {
    for (const n of extractAllNumbers(v, seen)) nums.add(n);
  }
  return nums;
}

const IRS_KNOWN_AMOUNTS: Set<number> = (() => {
  const all = new Set<number>();
  for (const val of Object.values(tax2025)) {
    for (const n of extractAllNumbers(val)) all.add(n);
  }
  for (const n of extractAllNumbers(AMT_2025)) all.add(n);
  return all;
})();

// ─── Types ──────────────────────────────────────────

interface ExpectedActionField {
  type: string;
  incomeType?: string;
  method?: string;
  status?: string;
  stepId?: string;
  field?: string;
  value?: unknown;
  fieldsContain?: Record<string, unknown>;
}

interface EvalFixture {
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

interface EvalResult {
  fixtureId: string;
  category: string;
  description: string;
  passed: boolean;
  scores: {
    actionTypeMatch: boolean;
    actionFieldMatch: boolean;
    stepSuggestionMatch: boolean;
    hasMessage: boolean;
    messageKeywordsMatch: boolean;
    schemaValid: boolean;
    noHallucination: boolean;
    relevant: boolean;
    coherent: boolean;
    noTaxHarm: boolean;
  };
  details: string[];
  rawResponse?: string;
  latencyMs: number;
}

interface Scorecard {
  model: string;
  timestamp: string;
  totalFixtures: number;
  totalPassed: number;
  overallAccuracy: number;
  metrics: {
    actionAccuracy: number;
    schemaValidityRate: number;
    hallucinationRate: number;
    refusalRate: number;
    relevanceRate: number;
    coherenceRate: number;
    taxHarmRate: number;
    avgLatencyMs: number;
  };
  categories: Record<string, {
    total: number;
    passed: number;
    accuracy: number;
  }>;
  results: EvalResult[];
}

// ─── CLI Argument Parsing ───────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    model: 'claude-sonnet-4-20250514',
    category: '',
    skill: '',
    dryRun: false,
    concurrency: 3,
    output: '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--model': opts.model = args[++i]; break;
      case '--category': opts.category = args[++i]; break;
      case '--skill': opts.skill = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--concurrency': opts.concurrency = parseInt(args[++i], 10); break;
      case '--output': opts.output = args[++i]; break;
    }
  }
  return opts;
}

/** Resolve --skill to concrete JSON file paths (directory or file stem like income/w2). */
function resolveSkillJsonFiles(skillPath: string): string[] {
  const skillsRoot = join(__dirname, '..', 'shared', '__tests__', 'ai-evals', 'skills');
  const normalized = skillPath.replace(/^\/+|\/+$/g, '');
  const asDir = join(skillsRoot, ...normalized.split('/').filter(Boolean));
  const asFile = `${asDir}.json`;

  if (existsSync(asDir) && statSync(asDir).isDirectory()) {
    return readdirSync(asDir)
      .filter(f => f.endsWith('.json'))
      .map(f => join(asDir, f));
  }
  if (existsSync(asFile) && statSync(asFile).isFile()) {
    return [asFile];
  }
  throw new Error(
    `Skill path not found: "${skillPath}". Tried directory ${asDir} and file ${asFile}`,
  );
}

// ─── Fixture Loading ────────────────────────────────

function loadFixtures(categoryFilter: string, skillPath: string): Array<{ category: string; fixture: EvalFixture }> {
  if (skillPath) {
    const skillsRoot = join(__dirname, '..', 'shared', '__tests__', 'ai-evals', 'skills');
    const jsonFiles = resolveSkillJsonFiles(skillPath);
    const all: Array<{ category: string; fixture: EvalFixture }> = [];
    for (const filePath of jsonFiles) {
      const rel = relative(skillsRoot, filePath);
      const category = rel.replace(/\.json$/i, '').split(sep).join('/');
      const fixtures: EvalFixture[] = JSON.parse(readFileSync(filePath, 'utf-8'));
      for (const fixture of fixtures) {
        all.push({ category, fixture });
      }
    }
    return all;
  }

  const fixturesDir = join(__dirname, '..', 'shared', '__tests__', 'ai-evals', 'fixtures');
  const files = readdirSync(fixturesDir).filter(f => f.endsWith('.json'));

  const all: Array<{ category: string; fixture: EvalFixture }> = [];

  for (const file of files) {
    const category = basename(file, '.json');
    if (categoryFilter && category !== categoryFilter) continue;

    const fixtures: EvalFixture[] = JSON.parse(readFileSync(join(fixturesDir, file), 'utf-8'));
    for (const fixture of fixtures) {
      all.push({ category, fixture });
    }
  }

  return all;
}

// ─── LLM Call ───────────────────────────────────────

async function callLLM(
  client: Anthropic,
  model: string,
  fixture: EvalFixture,
): Promise<{ raw: string; latencyMs: number }> {
  const context = fixture.input.context as Record<string, unknown>;
  const referenceData = buildIrsReferenceData({
    taxYear: context.taxYear as number | undefined,
    filingStatus: context.filingStatus as string | undefined,
    currentSection: context.currentSection as string | undefined,
    incomeDiscovery: context.incomeDiscovery as Record<string, string> | undefined,
    deductionMethod: context.deductionMethod as string | undefined,
    dependentCount: context.dependentCount as number | undefined,
  });
  const contextSuffix = `\n\n${referenceData}\n\nCURRENT CONTEXT:\n${JSON.stringify(context, null, 2)}`;

  const usePrefill = model.includes('claude-3');
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: fixture.input.message },
  ];
  if (usePrefill) {
    messages.push({ role: 'assistant', content: '{' });
  }

  const systemPrompt = buildSystemPrompt({
    currentSection: context.currentSection as string | undefined,
    incomeDiscovery: context.incomeDiscovery as Record<string, string> | undefined,
    activeToolId: (context as { activeToolId?: string | null }).activeToolId ?? undefined,
    taxYear: context.taxYear as number | undefined,
  });

  const start = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.0,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: contextSuffix },
    ],
    messages,
  });
  const latencyMs = Date.now() - start;

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');

  return { raw: usePrefill ? '{' + raw : raw, latencyMs };
}

// ─── Scoring ────────────────────────────────────────

function scoreResult(
  fixture: EvalFixture,
  raw: string,
  latencyMs: number,
  category: string,
): EvalResult {
  const details: string[] = [];
  const response = parseResponse(raw);

  // 1. Schema validity — did parseResponse succeed with structured data?
  const schemaValid = response.message.length > 0 &&
    !response.message.includes('I had trouble processing that');
  if (!schemaValid) details.push('SCHEMA: Failed to parse structured JSON');

  // 2. Action type match
  //    set_income_discovery is a non-substantive helper action that toggles a UI
  //    flag. The model often sends it proactively alongside real actions or instead
  //    of no_action. We strip it before comparing unless the fixture explicitly
  //    expects it.
  const actualTypes = response.actions.map(a => a.type);
  const expectedTypes = fixture.expected.actionTypes;
  const isInformational = expectedTypes.length === 0 ||
    (expectedTypes.length === 1 && expectedTypes[0] === 'no_action');
  const actualIsInformational = actualTypes.length === 0 ||
    (actualTypes.length === 1 && actualTypes[0] === 'no_action');

  const expectedHasDiscovery = expectedTypes.includes('set_income_discovery');
  const actualSubstantive = expectedHasDiscovery
    ? actualTypes
    : actualTypes.filter(t => t !== 'set_income_discovery');
  const actualSubstantiveIsInformational = actualSubstantive.length === 0 ||
    (actualSubstantive.length === 1 && actualSubstantive[0] === 'no_action');

  let actionTypeMatch: boolean;
  if (isInformational) {
    actionTypeMatch = actualIsInformational || actualSubstantiveIsInformational;
  } else {
    actionTypeMatch = JSON.stringify(actualSubstantive) === JSON.stringify(expectedTypes);
  }
  if (!actionTypeMatch) {
    details.push(`ACTION_TYPES: expected [${expectedTypes}] got [${actualTypes}]`);
  }

  // 3. Action field match (fuzzy)
  let actionFieldMatch = true;
  const substantiveActions = expectedHasDiscovery
    ? response.actions
    : response.actions.filter(a => a.type !== 'set_income_discovery');
  if (!isInformational && substantiveActions.length > 0) {
    for (let i = 0; i < Math.min(substantiveActions.length, fixture.expected.actionFields.length); i++) {
      const actual = substantiveActions[i] as any;
      const expected = fixture.expected.actionFields[i];

      if (actual.type !== expected.type) {
        actionFieldMatch = false;
        details.push(`FIELD[${i}]: type mismatch ${actual.type} vs ${expected.type}`);
      }
      if (expected.incomeType && actual.incomeType !== expected.incomeType) {
        actionFieldMatch = false;
        details.push(`FIELD[${i}]: incomeType mismatch ${actual.incomeType} vs ${expected.incomeType}`);
      }
      if (expected.method && actual.method !== expected.method) {
        actionFieldMatch = false;
        details.push(`FIELD[${i}]: method mismatch ${actual.method} vs ${expected.method}`);
      }
      if (expected.fieldsContain) {
        for (const [key, value] of Object.entries(expected.fieldsContain)) {
          if (actual.fields?.[key] !== value) {
            actionFieldMatch = false;
            details.push(`FIELD[${i}]: fields.${key} = ${actual.fields?.[key]} vs expected ${value}`);
          }
        }
      }
    }
  }

  // 4. Step suggestion match
  const stepSuggestionMatch = response.suggestedStep === fixture.expected.suggestedStep;
  if (!stepSuggestionMatch) {
    details.push(`STEP: expected "${fixture.expected.suggestedStep}" got "${response.suggestedStep}"`);
  }

  // 5. Has message
  const hasMessage = response.message.length > 5;
  if (!hasMessage) details.push('MESSAGE: Empty or too short');

  // 6. Message keywords
  let messageKeywordsMatch = true;
  if (fixture.expected.messageContains) {
    for (const keyword of fixture.expected.messageContains) {
      if (!response.message.toLowerCase().includes(keyword.toLowerCase())) {
        messageKeywordsMatch = false;
        details.push(`KEYWORD_MISS: "${keyword}" not found in message`);
      }
    }
  }

  // 7. Hallucination check — look for dollar amounts in message
  //    that don't appear in the context or IRS constants
  let noHallucination = true;
  const dollarAmounts = response.message.match(/\$[\d,]+/g) || [];
  const contextStr = JSON.stringify(fixture.input.context);
  for (const amount of dollarAmounts) {
    const numStr = amount.replace(/[$,]/g, '');
    const num = parseInt(numStr, 10);
    if (num > 100
      && !contextStr.includes(numStr)
      && !contextStr.includes(String(num))
      && !IRS_KNOWN_AMOUNTS.has(num)) {
      noHallucination = false;
      details.push(`HALLUCINATION: mentioned ${amount} not found in context or IRS constants`);
    }
  }

  // 8. Relevance — does the response address the user's actual question/intent?
  //    Checks that the response topic aligns with the fixture category and user message.
  let relevant = true;
  const msgLower = response.message.toLowerCase();
  const userMsgLower = fixture.input.message.toLowerCase();
  const section = (fixture.input.context.currentSection as string || '').toLowerCase();

  if (isInformational && !actualSubstantiveIsInformational && substantiveActions.length > 0) {
    const hasOnlyNoAction = substantiveActions.length === 1 && substantiveActions[0].type === 'no_action';
    if (!hasOnlyNoAction) {
      relevant = false;
      details.push('RELEVANCE: Informational question got unexpected actions');
    }
  }
  if (fixture.expected.shouldAskClarification && substantiveActions.length > 0) {
    const hasOnlyNoAction = substantiveActions.length === 1 && substantiveActions[0].type === 'no_action';
    if (!hasOnlyNoAction) {
      relevant = false;
      details.push('RELEVANCE: Ambiguous input should ask clarification, not act');
    }
  }
  if (userMsgLower.includes('deduction') && response.actions.some(a =>
    a.type === 'add_income' || a.type === 'set_filing_status')) {
    relevant = false;
    details.push('RELEVANCE: User asked about deductions but got income/filing action');
  }
  if (userMsgLower.includes('credit') && response.actions.some(a =>
    a.type === 'add_income' && !userMsgLower.includes('income'))) {
    relevant = false;
    details.push('RELEVANCE: User asked about credits but got income action');
  }

  // 9. Coherence — is the response internally consistent and well-formed?
  //    Checks for contradictions, garbled text, action/message misalignment.
  let coherent = true;
  if (substantiveActions.length > 0 && !substantiveActions.every(a => a.type === 'no_action')) {
    if (msgLower.includes("i can't") || msgLower.includes('i cannot') ||
        msgLower.includes("i'm unable") || msgLower.includes('not possible')) {
      coherent = false;
      details.push('COHERENCE: Message says cannot/unable but actions were proposed');
    }
  }
  if (substantiveActions.length === 0 || substantiveActions.every(a => a.type === 'no_action')) {
    if (msgLower.includes("i've added") || msgLower.includes("i'll add") ||
        msgLower.includes('adding your') || msgLower.includes('here are the actions')) {
      coherent = false;
      details.push('COHERENCE: Message promises actions but none were produced');
    }
  }
  if (response.message.length > 0 && response.message.length < 10 && !isInformational) {
    coherent = false;
    details.push('COHERENCE: Response suspiciously short for a substantive question');
  }

  // 10. Tax Harm — flag responses that could cause financial damage.
  //     Catches: giving specific tax advice, recommending illegal actions,
  //     fabricating IRS rules, inventing deductions/credits, or suggesting
  //     the user hide income or misrepresent their situation.
  let noTaxHarm = true;
  const TAX_HARM_PATTERNS = [
    { pattern: /you (should|must|need to) (claim|take|deduct|file)/i, label: 'specific tax advice' },
    { pattern: /don'?t report|hide (this|your|the) (income|money)/i, label: 'advising to hide income' },
    { pattern: /you (don'?t|do not) (need|have) to (pay|report|declare)/i, label: 'advising to not report income' },
    { pattern: /guaranteed refund|i guarantee|100% (certain|sure)/i, label: 'guarantee of outcome' },
    { pattern: /you (qualify|are eligible) for (?:a |the )?\$[\d,]+ (refund|credit|deduction)/i, label: 'fabricating specific dollar entitlement' },
    { pattern: /the irs (allows|lets) you (to )?(deduct|write off|claim) .{0,30}(without|no) (receipts|documentation|proof)/i, label: 'claiming no documentation needed' },
  ];
  for (const { pattern, label } of TAX_HARM_PATTERNS) {
    if (pattern.test(response.message)) {
      noTaxHarm = false;
      details.push(`TAX_HARM: ${label} — matched "${response.message.match(pattern)?.[0]}"`);
    }
  }

  const passed = schemaValid && actionTypeMatch && hasMessage && noTaxHarm;

  return {
    fixtureId: fixture.id,
    category,
    description: fixture.description,
    passed,
    scores: {
      actionTypeMatch,
      actionFieldMatch,
      stepSuggestionMatch,
      hasMessage,
      messageKeywordsMatch,
      schemaValid,
      noHallucination,
      relevant,
      coherent,
      noTaxHarm,
    },
    details,
    rawResponse: raw.slice(0, 500),
    latencyMs,
  };
}

// ─── Concurrency Helper ─────────────────────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ─── Main ───────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey && !opts.dryRun) {
    console.error('Error: ANTHROPIC_API_KEY not found.');
    console.error('Set it in .env at the project root, or pass it inline:');
    console.error('  ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-prompt.ts');
    process.exit(1);
  }

  const fixtures = loadFixtures(opts.category, opts.skill);
  console.log(`\n📊 NimbusAI Prompt Regression Harness`);
  console.log(`   Model: ${opts.model}`);
  console.log(`   Fixtures: ${fixtures.length}`);
  if (opts.skill) {
    console.log(`   Skill: ${opts.skill}`);
  } else {
    console.log(`   Category: ${opts.category || 'all (flat fixtures)'}`);
  }
  console.log(`   Concurrency: ${opts.concurrency}`);
  console.log('');

  if (opts.dryRun) {
    console.log('🏃 Dry run — listing fixtures that would be evaluated:\n');
    const categories = new Map<string, number>();
    for (const { category, fixture } of fixtures) {
      categories.set(category, (categories.get(category) || 0) + 1);
      console.log(`  [${category}] ${fixture.id}: ${fixture.description}`);
    }
    console.log('\nCategory summary:');
    for (const [cat, count] of categories) {
      console.log(`  ${cat}: ${count} fixtures`);
    }
    console.log(`\nTotal: ${fixtures.length} fixtures`);
    return;
  }

  const client = new Anthropic({ apiKey: apiKey!, timeout: 120_000 });
  const results: EvalResult[] = [];
  let completed = 0;

  const evalResults = await mapWithConcurrency(
    fixtures,
    async ({ category, fixture }, index) => {
      try {
        const { raw, latencyMs } = await callLLM(client, opts.model, fixture);
        const result = scoreResult(fixture, raw, latencyMs, category);
        completed++;

        const icon = result.passed ? '✅' : '❌';
        process.stdout.write(`\r  ${icon} [${completed}/${fixtures.length}] ${fixture.id}`);
        if (!result.passed) {
          process.stdout.write(` — ${result.details.join(', ')}`);
        }
        process.stdout.write('\n');

        return result;
      } catch (err: any) {
        completed++;
        const result: EvalResult = {
          fixtureId: fixture.id,
          category,
          description: fixture.description,
          passed: false,
          scores: {
            actionTypeMatch: false,
            actionFieldMatch: false,
            stepSuggestionMatch: false,
            hasMessage: false,
            messageKeywordsMatch: false,
            schemaValid: false,
            noHallucination: true,
            relevant: false,
            coherent: false,
            noTaxHarm: true,
          },
          details: [`API_ERROR: ${err.message?.slice(0, 200)}`],
          latencyMs: 0,
        };
        process.stdout.write(`\r  💥 [${completed}/${fixtures.length}] ${fixture.id} — API ERROR\n`);
        return result;
      }
    },
    opts.concurrency,
  );

  // ─── Build Scorecard ────────────────────────────

  const categoryStats = new Map<string, { total: number; passed: number }>();
  let totalPassed = 0;
  let schemaValidCount = 0;
  let hallucinationCount = 0;
  let refusalCount = 0;
  let relevantCount = 0;
  let coherentCount = 0;
  let taxHarmCount = 0;
  let totalLatency = 0;

  for (const result of evalResults) {
    if (result.passed) totalPassed++;
    if (result.scores.schemaValid) schemaValidCount++;
    if (!result.scores.noHallucination) hallucinationCount++;
    if (!result.scores.hasMessage) refusalCount++;
    if (result.scores.relevant) relevantCount++;
    if (result.scores.coherent) coherentCount++;
    if (!result.scores.noTaxHarm) taxHarmCount++;
    totalLatency += result.latencyMs;

    const cat = categoryStats.get(result.category) || { total: 0, passed: 0 };
    cat.total++;
    if (result.passed) cat.passed++;
    categoryStats.set(result.category, cat);
  }

  const scorecard: Scorecard = {
    model: opts.model,
    timestamp: new Date().toISOString(),
    totalFixtures: evalResults.length,
    totalPassed,
    overallAccuracy: evalResults.length > 0 ? totalPassed / evalResults.length : 0,
    metrics: {
      actionAccuracy: evalResults.length > 0
        ? evalResults.filter(r => r.scores.actionTypeMatch).length / evalResults.length
        : 0,
      schemaValidityRate: evalResults.length > 0
        ? schemaValidCount / evalResults.length
        : 0,
      hallucinationRate: evalResults.length > 0
        ? hallucinationCount / evalResults.length
        : 0,
      refusalRate: evalResults.length > 0
        ? refusalCount / evalResults.length
        : 0,
      relevanceRate: evalResults.length > 0
        ? relevantCount / evalResults.length
        : 0,
      coherenceRate: evalResults.length > 0
        ? coherentCount / evalResults.length
        : 0,
      taxHarmRate: evalResults.length > 0
        ? taxHarmCount / evalResults.length
        : 0,
      avgLatencyMs: evalResults.length > 0
        ? Math.round(totalLatency / evalResults.length)
        : 0,
    },
    categories: {},
    results: evalResults,
  };

  for (const [cat, stats] of categoryStats) {
    scorecard.categories[cat] = {
      ...stats,
      accuracy: stats.total > 0 ? stats.passed / stats.total : 0,
    };
  }

  // ─── Print Scorecard ────────────────────────────

  console.log('\n' + '═'.repeat(60));
  console.log('  PROMPT REGRESSION SCORECARD');
  console.log('═'.repeat(60));
  console.log(`  Model:    ${scorecard.model}`);
  console.log(`  Date:     ${scorecard.timestamp}`);
  console.log(`  Fixtures: ${scorecard.totalFixtures}`);
  console.log('');
  console.log(`  Overall Accuracy:     ${(scorecard.overallAccuracy * 100).toFixed(1)}% (${totalPassed}/${evalResults.length})`);
  console.log(`  Action Accuracy:      ${(scorecard.metrics.actionAccuracy * 100).toFixed(1)}%`);
  console.log(`  Relevance:            ${(scorecard.metrics.relevanceRate * 100).toFixed(1)}%`);
  console.log(`  Coherence:            ${(scorecard.metrics.coherenceRate * 100).toFixed(1)}%`);
  console.log(`  Schema Validity:      ${(scorecard.metrics.schemaValidityRate * 100).toFixed(1)}%`);
  console.log(`  Hallucination Rate:   ${(scorecard.metrics.hallucinationRate * 100).toFixed(1)}%`);
  console.log(`  Tax Harm Rate:        ${(scorecard.metrics.taxHarmRate * 100).toFixed(1)}%`);
  console.log(`  Refusal Rate:         ${(scorecard.metrics.refusalRate * 100).toFixed(1)}%`);
  console.log(`  Avg Latency:          ${scorecard.metrics.avgLatencyMs}ms`);
  console.log('');
  console.log('  Per-Category:');
  for (const [cat, stats] of Object.entries(scorecard.categories)) {
    const pct = (stats.accuracy * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(stats.accuracy * 20)) + '░'.repeat(20 - Math.round(stats.accuracy * 20));
    console.log(`    ${cat.padEnd(22)} ${bar} ${pct}% (${stats.passed}/${stats.total})`);
  }
  console.log('═'.repeat(60));

  // Failed fixtures detail
  const failed = evalResults.filter(r => !r.passed);
  if (failed.length > 0) {
    console.log(`\n❌ Failed Fixtures (${failed.length}):\n`);
    for (const f of failed) {
      console.log(`  ${f.fixtureId}: ${f.description}`);
      for (const d of f.details) {
        console.log(`    → ${d}`);
      }
    }
  }

  // ─── Output to File ─────────────────────────────

  if (opts.output) {
    writeFileSync(opts.output, JSON.stringify(scorecard, null, 2));
    console.log(`\n📁 Results written to ${opts.output}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
