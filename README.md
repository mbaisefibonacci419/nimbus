# Nimbus

Private, browser-based tax preparation powered by an open-source tax engine.

## What is Nimbus?

Nimbus is a free, open-source tax preparation app for the 2025 tax year, built entirely with AI. Your tax data never leaves your browser — all calculations happen client-side using the `@nimbus/engine` library, encrypted at rest with AES-256-GCM.

**Two modes:**
- **Private Mode** (default) — fully offline, zero data leaves your device
- **BYOK Mode** (optional) — add your own Anthropic API key for AI chat with SSE streaming, expense scanning, and document extraction. PII is stripped before anything is sent.

**Key features:**
- 90+ tax features covering ~85-90% of individual filers
- All 50 states + DC tax coverage
- Full Form 1040 with Schedules A-H, SE, D, and 30+ supplemental forms
- 41 IRS PDF templates + 43 state PDF templates with auto-populated field mapping
- Every computation traced to IRC, Treasury Regulations, or Revenue Procedures
- 6,340+ tests across 154 test files
- Offline-capable — installable on desktop and mobile

## Architecture

```
tax-project/
├── shared/   → @nimbus/engine (open-source tax calculation library)
├── client/   → React 19 + Vite 6 + Tailwind CSS + Zustand 5
├── server/   → Express + better-sqlite3 + pdf-lib
└── docs/     → Project documentation
```

**Tech stack:** TypeScript throughout. React 19 with Vite 6. Zustand 5 for state. Tailwind CSS with Nimbus brand colors. Vitest for testing. pdf-lib for IRS form generation.

**Engine design:** Pure functions only — no side effects, no database access, no network calls. Given a `TaxReturn` input, the engine produces a deterministic `CalculationResult`. See [Design Principles](docs/DESIGN_PRINCIPLES.md).

## Quick Start

```bash
# Install dependencies
npm install

# Run the client dev server
npm run dev --prefix client

# Run tests
npx vitest run --prefix shared
```

## Tax Coverage

| Category | Coverage |
|----------|----------|
| Income types | W-2, 1099-INT/DIV/OID/R/MISC/NEC/B/G/SA/DA/Q/C, SSA-1099, K-1 (partnership/S-Corp/estate), Schedule C/E/F, W-2G, Form 6252 (installment sales), Form 4835 (farm rental) |
| Deductions | Standard, itemized (Schedule A), QBI (199A), SEHI (Form 7206), Schedule 1-A (OBBBA), IRA, HSA, Archer MSA (Form 8853), student loan, educator, home office, vehicle, NOL, investment interest, sales tax SALT alternative, nonbusiness bad debt |
| Credits | CTC/ACTC/ODC, EITC, AOTC/LLC, dependent care, saver's, clean energy, EV, energy efficiency, FTC, PTC, adoption, elderly/disabled, excess SS, EV refueling, scholarship (§25F), prior year AMT (Form 8801) |
| Capital gains | Schedule D, preferential rates (0/15/20%), 25% unrecaptured S1250, NIIT, $3k loss limit, carryforward |
| AMT | Full Form 6251 (Parts I-III) with preferential rates in AMT universe |
| Penalties | Form 5329 (IRA/HSA/Coverdell ESA excess contributions, early distributions), Form 4684 (casualties & thefts) |
| State taxes | All 50 states + DC (9 no-tax, 13 flat, 20 progressive factory, 9 custom) |
| Depreciation | Form 4562 with Section 179, bonus, MACRS GDS, half-year/mid-quarter conventions |

See [Scope Matrix](docs/SCOPE_MATRIX.md) for the complete feature list.

## AI Eval Framework

The AI assistant has a dedicated eval suite to catch regressions before they reach users. There are two layers: **deterministic tests** (run on every commit) and a **live prompt regression harness** (run before prompt changes or on a nightly cadence).

### Deterministic Tests (No API Key Required)

```bash
# Schema validation — verifies parseResponse() handles all LLM output patterns
npx vitest run shared/__tests__/llmResponseParser.test.ts

# Intent-to-action eval suite — 60 fixtures across 6 categories
npx vitest run shared/__tests__/ai-evals/eval-runner.test.ts

# Server route tests — Zod validation, API key format, error sanitization
npx vitest run server/__tests__/chat.test.ts

# Run all three at once
npx vitest run shared/__tests__/llmResponseParser.test.ts shared/__tests__/ai-evals/eval-runner.test.ts server/__tests__/chat.test.ts
```

### Live Prompt Regression Harness (Requires API Key)

The harness sends all 60 eval fixtures through the real system prompt via the Anthropic API and scores the responses on action accuracy, schema validity, hallucination rate, and more. Use `--skill` to run per-skill fixture sets (see below).

**Establish a baseline:**

```bash
# 1. Preview what will run (no API call)
npx tsx scripts/eval-prompt.ts --dry-run

# 2. Run the full eval and save the baseline scorecard
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-prompt.ts --output evals/baseline.json

# 3. Run against a specific model
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-prompt.ts --model claude-sonnet-4-20250514 --output evals/sonnet.json

# 4. Run a single category to debug
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-prompt.ts --category income-entry
```

**Monitor over time:**

```bash
# After editing the system prompt or action schemas, re-run and compare
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-prompt.ts --output evals/after-change.json

# Compare two scorecards (manual diff for now)
diff <(jq '.metrics' evals/baseline.json) <(jq '.metrics' evals/after-change.json)
```

**Scorecard metrics:**

| Metric | What it measures | Target |
|--------|-----------------|--------|
| Overall Accuracy | Fixtures where action types matched, schema was valid, and no tax harm | ≥ 85% |
| Action Accuracy | Correct action type sequence for each fixture | ≥ 90% |
| Relevance | Response addresses the user's actual question (not off-topic actions) | ≥ 90% |
| Coherence | Response is internally consistent (message aligns with actions) | ≥ 95% |
| Schema Validity | Response parsed as valid structured JSON | ≥ 95% |
| Hallucination Rate | Dollar amounts in response not found in context | ≤ 5% |
| Tax Harm Rate | Responses containing specific tax advice, outcome guarantees, or suggestions to hide income | 0% |
| Refusal Rate | Empty or non-functional responses | ≤ 2% |

**When to run:**
- Before merging any change to `server/src/services/systemPrompt.ts`
- Before merging any change to `shared/src/utils/llmResponseParser.ts`
- Before merging any change to action type definitions in `shared/src/types/chat.ts`
- Nightly (if you set up CI) to catch model behavior drift

**Eval fixture categories** (in `shared/__tests__/ai-evals/fixtures/`):

| File | Cases | What it tests |
|------|-------|---------------|
| `income-entry.json` | 20 | W-2, 1099-NEC/INT/DIV/R/MISC/B, K-1, SSA, rental, HSA, gambling |
| `deduction-discovery.json` | 10 | HSA, mortgage, SALT, charitable, student loan, IRA, medical |
| `credit-questions.json` | 10 | CTC, EITC, AOTC, EV, dependent care, saver's, energy, adoption |
| `informational.json` | 10 | Refund, bracket, standard deduction, AGI, SE tax, QBI |
| `ambiguous-input.json` | 5 | Vague income, unclear filing status, "can I write this off?" |
| `multi-action.json` | 5 | W-2 + freelance, filing status + dependent, multiple expenses |

### Per-Skill Eval Fixtures

In addition to the flat fixture suite above, per-skill fixtures enable targeted testing of individual prompt skills. Run them with `--skill`:

```bash
# Test all income skill fixtures
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-prompt.ts --skill income

# Test only W-2 skill fixtures
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-prompt.ts --skill income/w2
```

| Skill | Files | Cases | What it tests |
|-------|-------|-------|---------------|
| `income/` | `w2.json`, `1099nec.json`, `investments.json` | 13 | W-2 entry, 1099-NEC freelance, 1099-INT/DIV/B investments |
| `deductions/` | `itemized.json`, `above-line.json` | 8 | Mortgage, SALT, charitable, HSA, IRA, student loan |
| `credits/` | `family.json` | 4 | CTC, dependent care, EITC, education credits |
| `meta/` | `interview.json` | 3 | Guided interview triggers, deduction discovery mode |

### Modular System Prompt (Skills Architecture)

The system prompt is decomposed into composable sections loaded conditionally based on the user's context:

| Section | Purpose | When loaded |
|---------|---------|-------------|
| `CORE_IDENTITY` | Role, response format, critical rules | Always |
| `ACTION_SCHEMAS` | All 14 action type definitions | Always |
| `CONTEXT_INSTRUCTIONS` | How to use trace, warning, calendar contexts | Always |
| `INTERVIEW_MODE` | Guided conversation patterns | Income, SE, Deductions |
| `FEATURE_GUIDE` | Form routing, feature-specific guidance | Income, SE |
| `FEW_SHOT_EXAMPLES` | Response format examples | Always |
| `APP_FEATURES` | What the app can do | Default, or when tool active |
| `PRIVACY_RULES` | PII handling instructions | Always |

Token savings: ~40-60% reduction for typical interactions vs the full prompt.

## Multi-Year Architecture

The engine is designed for rapid onboarding to new tax years without forking the codebase:

**Tax Year Registry** — `getConstants(year)` returns all IRS constants (brackets, deductions, credits, thresholds) for a given year. Currently only 2025 is registered; adding 2026 means creating a `tax2026.ts` that satisfies the `TaxYearConstants` interface and registering it.

**Provision Flags** — Year-specific legislative features (OBBBA Schedule 1-A, scholarship credit, expanded SALT cap) are controlled by boolean flags via `isProvisionActive(taxYear, 'schedule1A')`. Engine modules check flags instead of hardcoding year assumptions.

**Engine Decoupling** — Leaf engine modules (`brackets.ts`, `scheduleSE.ts`, `socialSecurity.ts`) accept optional constants overrides, defaulting to 2025. The pattern: add a last optional parameter, use it if provided, fall back to the import. Remaining ~40 modules follow the same pattern incrementally.

**Prompt Parameterization** — The AI system prompt and IRS reference data builder accept `taxYear`, so the entire AI chat layer adapts to whichever year the user's return targets.

## Documentation

| Document | Description |
|----------|-------------|
| [Scope Matrix](docs/SCOPE_MATRIX.md) | Supported vs. unsupported features |
| [Design Principles](docs/DESIGN_PRINCIPLES.md) | Architecture philosophy and engine design |
| [Authorities](docs/AUTHORITIES.md) | Module-by-module legal authority reference |
| [Contributing](docs/CONTRIBUTING.md) | How to contribute ("no authority, no merge") |
| [Security](docs/SECURITY.md) | Security policy and vulnerability reporting |
| [Disclaimer](docs/DISCLAIMER.md) | Legal disclaimer — not tax advice |

## License

MIT. See [LICENSE](LICENSE).
