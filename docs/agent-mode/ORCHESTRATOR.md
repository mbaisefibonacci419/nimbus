# Agent Mode Orchestrator

The orchestrator is the control layer that sits above individual skills. It
decides which skill to load, tracks what's been completed, handles mid-conversation
topic switches, and manages transitions between skills.

The orchestrator is **not** a skill itself — it doesn't talk to the user directly.
It's the routing layer that selects a skill and frames the LLM call.

---

## State Model

The orchestrator maintains a lightweight state object persisted alongside the
`TaxReturn`. This is the agent's "memory" of what's been covered.

```typescript
interface AgentState {
  /** Current phase of the interview. */
  phase: 'onboarding' | 'income' | 'self_employment' | 'deductions' | 'credits' | 'state' | 'review' | 'finish';

  /** Currently active skill ID (null = orchestrator is deciding). */
  activeSkill: string | null;

  /** Skills that have been completed (with completion timestamps). */
  completed: Record<string, { completedAt: string; turnCount: number }>;

  /** Skills that the user explicitly skipped. */
  skipped: string[];

  /** Skills that are blocked (missing prerequisite data). */
  blocked: string[];

  /** Conversation turn count for the current skill. */
  currentTurnCount: number;

  /** Total conversation turns across all skills. */
  totalTurnCount: number;

  /** User-initiated topic override (set when user asks about something
      outside the current skill's domain). Cleared after the detour. */
  detourSkill: string | null;
  returnToSkill: string | null;
}
```

### Persistence

`AgentState` is stored as `taxReturn.agentState` (optional field on
`TaxReturn`). This means:
- State survives page refreshes and session restarts
- State is available to the server for prompt construction
- State can be inspected in the existing return JSON for debugging

### Concurrency Control

Two code paths write `agentState`:

| Writer | When | What it does |
|--------|------|-------------|
| `_doSendMessage` | After every LLM round-trip | Calls `orchestrator.recordTurn()` then persists |
| `_maybeAdvanceAgentSkill` | After actions are applied (800ms debounce) | Syncs completion, selects next skill, persists |

A **monotonic version counter** (`_agentStateVersion`) prevents stale writes:
1. `_doSendMessage` bumps the counter on entry, invalidating any pending
   `_maybeAdvanceAgentSkill` timeout.
2. `_maybeAdvanceAgentSkill` captures the counter at call time and checks it
   twice — before running its logic and before writing — aborting if the
   counter has moved.

This guarantees that `_doSendMessage` (the authoritative path) always wins.

---

## Skill Registry

The orchestrator knows about all available skills via `SKILL_REGISTRY`
(`SkillRegistry.ts`). Each entry maps a skill ID to its metadata.

```typescript
interface SkillRegistryEntry {
  id: string;
  domain: string;
  phase: AgentState['phase'];
  order: number;
  prerequisites: string[];
  expectedTurns: number;
  interactionMode: 'fast-capture' | 'exploratory' | 'confirmation' | 'half-sheet';
  allowedActionTypes: string[];
  /** Exact TaxReturn field names this skill may write via update_field. */
  writableFields: string[];
  isRelevant: (taxReturn: TaxReturn) => boolean;
  isComplete: (taxReturn: TaxReturn) => boolean;
}
```

### `writableFields` and `WRITABLE_BY_AI`

Each skill declares the exact `TaxReturn` field names it may modify via
`update_field` in its `writableFields` array. The orchestrator injects these
into the LLM prompt so the model only uses canonical field names.

On the execution side, `intentExecutor.ts` maintains a `WRITABLE_BY_AI` set
(the union of all skills' `writableFields`). Any `update_field` action
targeting a field outside this set is rejected — no aliasing, no normalization.

### Default Skill Sequence

```
Phase: onboarding
  1. personal-info        (always)
  2. filing-status        (always)
  3. dependents           (always — may result in "none")

Phase: income
  4. income-wages         (always ask; may result in "no W-2s")
  5. income-freelance     (always ask; discovery for 1099-NEC/K/MISC)
  6. income-investments   (always ask; discovery for 1099-B/DA/DIV/INT/K1)
  7. income-retirement    (always ask; discovery for 1099-R/SSA/1099-G)
  8. income-property      (ask if contextually relevant — homeowner, rental mentions)
  9. income-other         (ask about remaining: HSA distributions, 529, gambling, COD)

Phase: self_employment
  10. self-employment     (only if income-freelance discovered SE income)

Phase: deductions
  11. deductions-discovery (always — walks through what might apply)
  12. deductions-itemized  (only if deductionMethod === 'itemized')
  13. deductions-above-line (always — HSA, student loan, IRA, educator, etc.)

Phase: credits
  14. credits             (always — walks through applicable credits)

Phase: state
  15. state-taxes         (only if stateReturns is non-empty)

Phase: review
  16. review              (always — walks through the finished return)

Phase: finish
  17. finish              (always — refund method, export)
```

### Relevance Rules (examples)

| Skill | `isRelevant` logic |
|-------|-------------------|
| `self-employment` | `incomeDiscovery['1099nec'] === 'yes' OR incomeDiscovery['1099k'] === 'yes' OR businesses.length > 0` |
| `deductions-itemized` | `deductionMethod === 'itemized'` |
| `income-property` | `incomeDiscovery.rental === 'yes' OR incomeDiscovery.home_sale === 'yes' OR rentalProperties.length > 0` |
| `state-taxes` | `stateReturns?.length > 0` |

Skills that are not relevant are auto-skipped (never presented to the user).

---

## Interaction Principles

Two core principles govern how the agent interacts with the user:

> **Speed through known data. Explore through unknown value.**

Income topics → document-first, confirmation-pill UX, minimal turns.
D&C topics → conversational discovery, benefit previews, "show your work" explanations.
Review → summarized confidence check, not field-by-field replay.

> **Half-sheets are an escape hatch, not the default.**

The agent handles most interactions inline in chat (pills, confirmations, quick captures).
A half-sheet only appears when structured multi-field entry genuinely beats conversation.
Even then, the agent pre-fills what it can and presents "verify this" rather than "fill this out."

**Litmus test**: if the user encounters more than 3 half-sheets in a session, the experience
has regressed to "interview with extra steps."

### Interaction Modes

Each skill declares an `interactionMode` that controls UX patterns and turn budgets:

| Mode | Turn Budget | UX Pattern | When to Use |
|------|-------------|------------|-------------|
| `fast-capture` | 1–3 turns | Document scan → pill confirmation. "I see X — right?" | User has the data. W-2s, 1099s, known numbers. |
| `exploratory` | 3–8 turns | Discovery questions → benefit previews → "show your work" | User may not know what applies. Deductions, credits, eligibility. |
| `confirmation` | 1–2 turns | Summarize collected data → "anything else?" | Review, transitions, wrap-up. |
| `half-sheet` | 1 turn | Pre-filled structured form in a half-sheet modal | 8+ fields that beat conversation. W-2 with 12 boxes, rental P&L. |

### Topic Interaction Matrix

| Skill | Mode | Rationale |
|-------|------|-----------|
| `personal-info` | `fast-capture` | Name, address, DOB — user knows this cold. |
| `filing-status` | `fast-capture` | 2-5 pill options. One question. |
| `dependents` | `fast-capture` | Quick loop per child/dependent. |
| `income-wages` | `fast-capture` | Document scan or pill-confirm W-2 data. |
| `income-freelance` | `fast-capture` | 1099-NEC/K — user has the forms. |
| `income-investments` | `fast-capture` | Summary entry or document scan. |
| `income-retirement` | `fast-capture` | 1099-R codes, SSA-1099 — known data. |
| `income-property` | `half-sheet` | Rental P&L has 10+ fields. Pre-fill from document. |
| `income-other` | `exploratory` | HSA, 529, gambling — user may not know what's reportable. |
| `self-employment` | `half-sheet` | Business expenses, home office — structured multi-field. |
| `deductions-discovery` | `exploratory` | Key discovery skill. "Did you know about...?" |
| `deductions-itemized` | `exploratory` | SALT cap, mortgage, charitable — show the math. |
| `deductions-above-line` | `exploratory` | HSA, student loan, IRA — explain value of each. |
| `credits` | `exploratory` | Auto-detect eligibility, show benefit amounts. |
| `state-taxes` | `fast-capture` | Mostly data re-use from federal. Quick confirmation. |
| `review` | `confirmation` | Section-by-section summary. Not field-by-field replay. |
| `finish` | `confirmation` | Refund method, payment, export. One or two choices. |

---

## Skill Selection Algorithm

Each time the orchestrator needs to pick a skill, it runs:

```
function selectNextSkill(state: AgentState, taxReturn: TaxReturn): string | null {
  // 1. If there's an active detour, continue it
  if (state.detourSkill) return state.detourSkill;

  // 2. If there's an active skill that isn't complete, continue it
  if (state.activeSkill && !isComplete(state.activeSkill, taxReturn)) {
    return state.activeSkill;
  }

  // 3. Find the next uncompleted, relevant, unblocked skill in sequence
  for (const entry of SKILL_SEQUENCE) {
    if (state.completed[entry.id]) continue;
    if (state.skipped.includes(entry.id)) continue;
    if (!entry.isRelevant(taxReturn)) continue;
    if (entry.prerequisites.some(p => !state.completed[p])) continue;
    return entry.id;
  }

  // 4. All skills complete — move to review if not already there
  if (!state.completed['review']) return 'review';

  // 5. Everything done
  return null;
}
```

### Completion Sync (`syncCompletionFromReturn`)

On every orchestrator initialization and before skill selection, the
orchestrator scans the `TaxReturn` and auto-marks skills whose `isComplete`
criteria are already met (e.g., if the user filled data via Interview mode).

When `syncCompletionFromReturn` detects that the currently active skill is
complete, it clears `activeSkill` and resets the turn counter. This prevents
the re-prompting bug where a completed skill stays active and loops.

---

## Topic Switching (Detours)

A critical feature: the user should be able to say "actually, let me tell you
about my mortgage" while the agent is asking about W-2s. The orchestrator
handles this via **detours**.

### Detection

Before each LLM call, the orchestrator runs a lightweight intent classifier
on the user's message:

```
function detectTopicSwitch(message: string, activeSkill: string): string | null {
  // Check each skill's "User Intent" triggers against the message
  for (const skill of SKILL_REGISTRY) {
    if (skill.id === activeSkill) continue;
    if (matchesUserIntent(message, skill.userIntentPatterns)) {
      return skill.id;
    }
  }
  return null; // no switch — stay in current skill
}
```

### Detour Flow

```
User: "Oh wait, I also want to mention I paid $9,000 in mortgage interest"
                    │
                    ▼
    ┌───────────────────────────────┐
    │ Orchestrator detects:         │
    │ "mortgage" → deductions-      │
    │ itemized skill                │
    │                               │
    │ Save: returnToSkill =         │
    │   "income-wages"              │
    │ Set: detourSkill =            │
    │   "deductions-itemized"       │
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │ Load deductions-itemized      │
    │ Handle the mortgage question  │
    │ When done (or user says       │
    │ "let's go back"):             │
    │                               │
    │ Clear detourSkill             │
    │ Restore: activeSkill =        │
    │   returnToSkill               │
    └───────────────────────────────┘
```

### Detour Rules

- Only one detour at a time (no nested detours)
- The detour skill runs in a **mini-session**: it can ask its questions,
  emit actions, but the orchestrator offers to return to the original skill
  when the detour completes
- If the detour skill is in a later phase, the orchestrator notes it as
  "partially complete" and revisits it during its normal phase to check if
  anything else is needed

---

## LLM Prompt Construction

When a skill is active, the orchestrator builds the LLM prompt as:

```
[Orchestrator Frame]          ~50-80 lines — role, response format, action schemas
[Active Skill Prompt]         ~80-120 lines — the skill's interview flow
[Context Slice]               ~variable — only the TaxReturn fields the skill reads
[Conversation History]        last 10 messages (scoped to this skill's session)
[Return Summary]              ~20 lines — what's been completed across all skills
```

### Orchestrator Frame

The frame is dynamically constructed per-skill by `buildOrchestratorFrame`.
It includes:

1. **Role and context**: what skill is active, current return summary
2. **Interaction mode instructions**: behavior guidance per mode type
3. **Response format**: JSON schema for `{ message, actions, options, followUpChips }`
4. **Action schemas**: per-action-type JSON format, valid values, and constraints

```
You are a tax preparation agent for Nimbus. You are currently helping the user
with: {skill.domain}.

INTERACTION MODE: {mode-specific instructions}

You must respond with JSON: { "message": "...", "actions": [...], "suggestedStep": null, "options": [...], "followUpChips": [...] }

You may ONLY emit the following action types: {entry.allowedActionTypes}

## Action Schemas
{dynamically built per skill — see buildActionSchemas()}

Current return summary:
- Filing status: {filingStatus or "not yet set"}
- Dependents: {count}
- Income entered: {summary of completed income skills}
- Deductions: {status}
- Credits: {status}
- Current refund estimate: ${refundOrOwed}

The user may ask about topics outside your current domain. If they do, respond
with: { "message": "...", "actions": [{"type": "no_action"}], "topicSwitch": "{detected_skill_id}" }
The orchestrator will handle the transition.
```

### Action Schemas (`buildActionSchemas`)

Each allowed action type gets a detailed schema injected into the prompt.
Schemas include:

- **Exact JSON format** with field names and types
- **Valid values** for enum fields (e.g., filing status options, income types)
- **Explicit constraints**: e.g., "Do NOT use update_field for filing status —
  always use set_filing_status"
- **For `update_field`**: the exact `writableFields` list from the skill registry,
  with instructions that any unlisted field name will be rejected

Key schemas:

| Action | Schema includes |
|--------|----------------|
| `update_field` | Per-skill `writableFields` list; "no abbreviations, no aliases" |
| `set_filing_status` | 5 canonical values + aliases (mfj, mfs, hoh, qss) |
| `add_dependent` | Field list; explicit "Do NOT include SSN" |
| `add_income` | 13 income types with per-type field lists |
| `set_income_discovery` | Income, deduction, and credit discovery keys |
| `update_itemized` | 11 deduction fields |
| `update_business` | Schedule C fields |
| `add_business_expense` | 20 expense categories |
| `update_home_office` | Simplified vs actual method fields |
| `update_vehicle` | Mileage vs actual method fields |
| `update_se_retirement` | Solo 401(k), SEP-IRA, SE health insurance fields |

### Context Slice

Instead of sending the entire `TaxReturn` (which contains hundreds of fields),
the orchestrator sends only the fields listed in the active skill's `Reads`
contract:

```typescript
function buildContextSlice(taxReturn: TaxReturn, skill: SkillContract): object {
  const slice = {};
  for (const field of skill.reads) {
    slice[field.path] = getNestedValue(taxReturn, field.path);
  }
  return slice;
}
```

This keeps the LLM context tight and prevents the model from hallucinating
about fields it shouldn't know about.

---

## Mode Transitions

### Entering Agent Mode

When the user switches `viewMode` to `'agent'`:

1. If `taxReturn.agentState` exists → resume from where they left off
2. If no `agentState` → initialize fresh state, start with `personal-info`
   (or skip to the first incomplete skill if the return already has data)

### Agent → Interview (partial)

The user clicks a section in the Return Summary sidebar, or says "let me do
deductions myself":

1. Orchestrator marks the relevant skill(s) as `skipped`
2. `viewMode` switches to `'wizard'`, navigating to the appropriate step
3. When the user switches back to agent mode, the orchestrator resumes from
   the next non-skipped, non-completed skill

### Agent → Forms

The user says "show me the 1040" or clicks the Forms toggle:

1. `viewMode` switches to `'forms'`
2. Agent state is preserved
3. When the user switches back, the orchestrator resumes seamlessly

### Interview/Forms → Agent

The user switches to agent mode from Interview or Forms:

1. Orchestrator calls `syncCompletionFromReturn` to scan `TaxReturn`
2. Auto-marks skills as completed if their `isComplete` criteria are met
3. Clears `activeSkill` if it was auto-completed (prevents re-prompting)
4. Resumes from the first incomplete skill

---

## Return Summary Sidebar

In agent mode, the left sidebar shows a live summary instead of the step list
or form list. Structure:

```
┌──────────────────────────────┐
│  Your Return                 │
│                              │
│  ◉ Personal Info        ✓   │  ← completed
│  ◉ Filing Status        ✓   │
│  ◉ Dependents          ✓   │
│  ─────────────────────────   │
│  ◉ W-2 Income          ✓   │
│    Google — $150,000         │
│  ◉ Freelance Income    ●   │  ← in progress
│  ○ Investments          ·   │  ← not yet reached
│  ○ Retirement           ·   │
│  ─────────────────────────   │
│  ○ Deductions           ·   │
│  ○ Credits              ·   │
│  ─────────────────────────   │
│                              │
│  ┌────────────────────────┐  │
│  │  Refund: $4,230       │  │
│  │  ▲ +$1,200 from W-2   │  │
│  └────────────────────────┘  │
│                              │
│  [Switch to Interview]       │
│  [Switch to Forms]           │
└──────────────────────────────┘
```

Each completed section is clickable → opens a detail panel showing what was
entered, with an "Edit" button that jumps to the corresponding Interview step.

---

## Error Recovery

### Skill produces invalid actions

The executor guard validates actions against two layers:
1. **Orchestrator contract** (`validateActions`): rejects action types not in
   the active skill's `allowedActionTypes`
2. **`WRITABLE_BY_AI` allowlist** (`intentExecutor.ts`): rejects `update_field`
   targeting any field not in the canonical set

The orchestrator:
1. Logs the violation
2. Retries the LLM call with an appended system message: "Your previous
   response included actions outside the allowed set. You may only use: ..."
3. If retry also fails, falls back to `no_action` and continues the conversation

### Skill gets stuck in a loop

If `currentTurnCount` exceeds 2x the skill's expected turn count (from
`SkillRegistryEntry.expectedTurns`), `isSkillStuck()` returns `true`.
The orchestrator:
1. Injects a summary of what's been collected so far
2. Asks the user: "I think I have everything I need for {domain}. Ready to
   move on, or is there something I missed?"
3. If user says move on → mark complete

### User wants to start over

"Start over" / "reset" → orchestrator clears `agentState` and reinitializes.
The `TaxReturn` data is NOT cleared (user must explicitly delete entries).

---

## Testing

The orchestrator has a comprehensive unit test suite at
`client/src/__tests__/agentOrchestrator.test.ts` (43 tests) covering:

| Area | Tests |
|------|-------|
| `createInitialAgentState` | Clean initial state |
| `selectNextSkill` | First skill selection, active skill continuation, prerequisite enforcement, relevance filtering, completion advancement, detour priority, terminal state |
| `syncCompletionFromReturn` | Auto-completion detection, partial data handling, `activeSkill` clearing, turn count preservation, idempotency, skipped skill immunity |
| `activateSkill` | Skill/phase activation, turn count reset on switch, same-skill re-activation |
| `completeActiveSkill` | Completion recording, detour return, no-op when inactive |
| `skipActiveSkill` | Skip tracking, selection exclusion |
| `recordTurn` | Current/total count tracking across skill boundaries |
| `handleTopicSwitch` | Detour initiation, nested detour prevention, null detection |
| `isSkillStuck` | Under-budget, over-budget, boundary behavior |
| `validateActions` | Allowlist acceptance, rejection, no-skill rejection |
| `buildTransitionMessage` | Mode-specific messages, progress counts, completion message |
| State persistence | Serialization round-trip fidelity |
| `writableFields` parity | Array existence, no-leak validation, deduplication |
| Full flow integration | `personal-info → filing-status → dependents` progression |

---

## Integration Points

### Existing systems the orchestrator plugs into

| System | How agent mode uses it |
|--------|----------------------|
| `intentExecutor.ts` | Executes `ChatAction` objects — guarded by `WRITABLE_BY_AI` allowlist |
| `ActionPreview` component | Shows proposed actions for user confirmation — reused in agent layout |
| `useLiveCalculation()` | Refund ticker in sidebar — unchanged |
| `ChatContext` | Extended with `agentState` summary for the LLM |
| `systemPrompt.ts` | Replaced by orchestrator frame + skill prompt (not used in agent mode) |
| `incomeDiscovery` | Read and written by skills via `set_income_discovery` — unchanged |
| `WIZARD_STEPS` conditions | Used by orchestrator to auto-detect completed skills when entering agent mode |

### Agent mode components

| Component | Purpose |
|-----------|---------|
| `AgentLayout.tsx` | Chat-primary layout with Return Summary sidebar |
| `ReturnSummarySidebar.tsx` | Live return overview with section status |
| `AgentOrchestrator.ts` | State machine: skill selection, detours, transitions, prompt construction |
| `SkillRegistry.ts` | Skill metadata, completion criteria, writable fields |
| `ContextSlicer.ts` | Extracts minimal TaxReturn fields per skill |
| `TopicDetector.ts` | Lightweight intent classifier for detour detection |
