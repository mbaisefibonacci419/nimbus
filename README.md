# Nimbus

Private, browser-based tax preparation powered by an open-source tax engine.

## What is Nimbus?

Nimbus is a free, open-source tax preparation app for the 2025 tax year, built entirely with AI. Your tax data never leaves your browser — all calculations happen client-side using the `@nimbus/engine` library, encrypted at rest with AES-256-GCM.

An AI assistant powered by Anthropic Claude provides conversational tax guidance, document extraction, and guided data entry. PII is stripped before anything is sent to the LLM.

**Key features:**
- 90+ tax features covering ~85-90% of individual filers
- All 50 states + DC tax coverage
- Full Form 1040 with Schedules A-H, SE, D, and 30+ supplemental forms
- 41 IRS PDF templates + 43 state PDF templates with auto-populated field mapping
- AI-powered document import (W-2, 1099s, K-1s) via Docling OCR + Claude Vision fallback
- Every computation traced to IRC, Treasury Regulations, or Revenue Procedures
- 6,340+ tests across 154 test files
- Light/dark mode with crimson rose accent palette
- Offline-capable — installable on desktop and mobile

## Architecture

```
nimbus/
├── shared/           → @nimbus/engine (pure tax calculation library)
├── client/           → React 19 + Vite 6 + Tailwind CSS + Zustand 5
├── server/           → Express proxy + Docling + Anthropic API
├── .docling-venv/    → Python 3.12 virtualenv for Docling PDF extraction
├── scripts/          → Eval harness, code generation, constants
├── evals/            → AI baseline scorecards
└── docs/             → Project documentation
```

### How the pieces fit together

```
┌──────────────────────────────────────────────────┐
│                     Browser                       │
│                                                   │
│  React App ←→ Zustand stores ←→ @nimbus/engine   │
│       │              │                            │
│       │        localStorage                       │
│       │       (AES-256-GCM)                       │
└───────┼───────────────────────────────────────────┘
        │ HTTPS (SSE streaming)
        ▼
┌──────────────────────────────────────────────────┐
│                  Express Server                   │
│                                                   │
│  /api/chat/byok/stream  → PII strip → Anthropic  │
│  /api/extract/pdf       → Docling CLI → fields    │
│  /api/extract/vision    → Claude Vision → fields  │
│                                                   │
│  Docling: shells out to .docling-venv/bin/docling │
│  (Python 3.12, runs per-request, no daemon)       │
└──────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Engine is pure:** No side effects, no network calls. Given a `TaxReturn`, it returns a deterministic `CalculationResult`. See [Design Principles](docs/DESIGN_PRINCIPLES.md).
- **Server is a thin proxy:** It exists solely to keep API keys off the client, strip PII, and run Docling. No user data is stored server-side.
- **Docling is a CLI tool, not a server:** When a PDF is uploaded, the Express server calls `.docling-venv/bin/docling` synchronously. No separate process to manage. Falls back to Claude Vision if Docling is unavailable.

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.12 (for Docling PDF extraction)
- An Anthropic API key (for AI chat and Vision fallback)

### Setup

```bash
# 1. Install Node dependencies
npm install

# 2. Set up Docling (one-time)
python3.12 -m venv .docling-venv
.docling-venv/bin/pip install docling

# 3. Configure your API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 4. Start everything (client + server)
npm run dev
```

This runs both the Vite dev server (port 5173) and the Express API server concurrently. The Docling Python venv is used on-demand when PDFs are uploaded — no separate process to start.

### Verify Docling is working

```bash
# Check capabilities endpoint
curl http://localhost:3001/api/extract/capabilities
# → { "data": { "docling": true, "vision": true, "textExtraction": true } }
```

### Run tests

```bash
# All unit tests (6,340+ across shared + client)
npx vitest run

# Engine tests only
npm test -w shared

# Specific test file
npx vitest run shared/__tests__/ai-evals/eval-runner.test.ts
```

## Document Extraction Pipeline

When a user uploads a tax document (PDF or image), the system tries multiple extraction methods in order:

1. **Docling CLI** (local, no API key needed) — IBM's open-source document converter extracts structured markdown from the PDF. Field-specific parsers then pull W-2 boxes, 1099 amounts, etc.
2. **Claude Vision** (requires API key) — If Docling fails or returns poor results, the PDF is sent to Claude's vision model for extraction.
3. **Client-side text extraction** — For digital PDFs with embedded text, `pdfjs-dist` extracts text locally as a last resort.

The extraction result is returned as structured fields that can be added directly to the tax return.

## Theming

Nimbus supports light and dark modes with a CSS custom property system:

- **Dark mode** (default): Charcoal neutral surfaces, crimson rose (#db334d) primary accent
- **Light mode**: Clean white/gray surfaces, same crimson rose accent
- Toggle via the sun/moon button in the sidebar or dashboard

The theme system uses CSS variables consumed by Tailwind, so all 200+ component files respond to mode changes automatically without individual `dark:` variants. Chart components use a `useChartTheme()` hook that returns mode-aware hex values. Syncfusion's base CSS is swapped dynamically between `tailwind.css` and `tailwind-dark.css`.

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
| [AI Feature Matrix](docs/AI_FEATURE_MATRIX.md) | AI assistant capabilities and action types |
| [Tax Constants 2025](docs/TAX_CONSTANTS_2025.md) | All IRS constants for tax year 2025 |
| [Contributing](docs/CONTRIBUTING.md) | How to contribute ("no authority, no merge") |
| [Security](docs/SECURITY.md) | Security policy and vulnerability reporting |
| [Disclaimer](docs/DISCLAIMER.md) | Legal disclaimer — not tax advice |

## License

MIT. See [LICENSE](LICENSE).
