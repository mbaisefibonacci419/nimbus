# Agent Skill Template

Every agent-mode skill **must** follow this schema. The orchestrator uses these
sections programmatically — field names and heading levels are contracts, not
suggestions.

---

## Template

````markdown
# Skill: <skill-id>
## Domain: <human-readable domain name>

<!-- ────────────────────────────────────── -->
## Trigger

<!-- When the orchestrator should load this skill. Two trigger types: -->

### Orchestrator (automatic)
<!-- Conditions on TaxReturn / orchestrator state that cause this skill to be
     selected during sequential interview flow. -->
- <condition 1>
- <condition 2>

### User Intent (on-demand)
<!-- Natural-language patterns that should route to this skill even if the
     orchestrator hasn't reached it yet. -->
- "<example utterance 1>"
- "<example utterance 2>"

<!-- ────────────────────────────────────── -->
## Interaction Mode

<!-- How the agent should interact with the user for this topic.
     Determines UX patterns, depth of exploration, and turn budget.

     One of:
     - fast-capture:   Known data entry. User has the document/info. Goal is
                       speed — document scan or pill-based confirmation in 1-3 turns.
                       "I see a W-2 from Acme, $85K wages — look right?" → one tap.
     - exploratory:    User may not know what applies. Agent discovers, explains
                       value, shows its work. Conversational, 3-8 turns.
                       "Did you pay for childcare? That could save you $2,100..."
     - confirmation:   Summarize what's been collected, ask "anything else?".
                       1-2 turns max. Used for review/transition skills.
     - half-sheet:     Complex multi-field entry that genuinely beats conversation
                       (e.g., W-2 with 12 boxes). Agent pre-fills what it can and
                       presents a structured form. Escape hatch — not the default.

     PRINCIPLE: Speed through known data. Explore through unknown value.
     If the user would need >3 half-sheets in a session, the experience has regressed. -->

**Mode**: `<fast-capture | exploratory | confirmation | half-sheet>`

<!-- Optional: explain WHY this mode was chosen for this topic. -->

<!-- ────────────────────────────────────── -->
## Contract

### Reads
<!-- TaxReturn fields and CalculationResult fields this skill MAY inspect.
     The orchestrator uses this to build the minimal context slice sent to
     the LLM — nothing outside this list is included. -->
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.<path>` | `<type>` | <reason> |

### Writes
<!-- TaxReturn fields this skill is ALLOWED to mutate. Any action that
     touches a field outside this list is rejected by the executor guard. -->
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.<path>` | `<type>` | `<ChatAction type>` |

### Discovery Keys
<!-- incomeDiscovery keys this skill may set. -->
| Key | Sets to | When |
|-----|---------|------|
| `<key>` | `yes` / `no` | <condition> |

### Allowed Actions
<!-- Exhaustive list of ChatAction types this skill may emit. -->
- `<action_type>` — <brief description>

### Forbidden
<!-- Explicit things this skill must NOT do — guard rails. -->
- Must not <thing>

<!-- ────────────────────────────────────── -->
## Completion Criteria

<!-- How the orchestrator knows this skill is "done" and can move to the next.
     Express as boolean conditions on TaxReturn state. -->
- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] OR: user explicitly says "<skip phrase>"

<!-- ────────────────────────────────────── -->
## Interview Flow

<!-- The conversational script the LLM follows. Use numbered steps with
     branching (if/else). Keep each question atomic — one thing at a time. -->

### Entry
<!-- First message when the skill activates. -->
1. <opening question or statement>

### Main Loop
<!-- Iterative Q&A pattern (e.g., "for each W-2..."). -->
2. <question>
   - If <condition>: <follow-up>
   - If <other condition>: <different follow-up>

3. <confirmation step>
   - Present proposed actions for review
   - Wait for user approval before emitting

### Exit
<!-- How the skill wraps up and signals completion. -->
4. <closing question: "anything else in this area?">
   - If yes → loop back to Main Loop
   - If no → mark complete, hand back to orchestrator

<!-- ────────────────────────────────────── -->
## Engine Context

<!-- Brief explanation of how this skill's data flows through the tax engine.
     Helps the LLM explain impacts to the user. -->
- <field> → Form 1040 Line <X>
- <field> → Schedule <Y> Line <Z>
- Impact on refund: <description>

<!-- ────────────────────────────────────── -->
## Edge Cases

<!-- Known tricky situations this skill must handle correctly. -->
| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| <scenario> | <what to do> | <consequence> |

<!-- ────────────────────────────────────── -->
## Eval Criteria

<!-- Skill-specific evaluation notes beyond the global rubric.
     Reference EVAL_FRAMEWORK.md for the scoring system. -->
- **Accuracy**: <what "accurate" means for this skill specifically>
- **Completeness**: <minimum fields/questions that must be covered>
- **No Tax Harm**: <specific risks to test for>
````

---

## Field Conventions

- **Field paths** use dot notation matching `TaxReturn`: e.g., `taxReturn.w2Income[].wages`
- **Array fields** use `[]` to indicate "any element": e.g., `taxReturn.dependents[]`
- **Nested optionals** include the `?`: e.g., `taxReturn.homeOffice?.method`
- **Discovery keys** are flat strings matching `incomeDiscovery` keys: e.g., `w2`, `ded_mortgage`
- **Action types** match the `ChatAction` union in `shared/src/types/chat.ts`

## Naming Convention

Skill files live in `docs/agent-mode/skills/` and are named `<skill-id>.md`.
The `<skill-id>` is kebab-case, grouped by domain:

```
personal-info.md
filing-status.md
dependents.md
income-wages.md
income-freelance.md
income-investments.md
income-retirement.md
income-property.md
income-other.md
self-employment.md
deductions-discovery.md
deductions-itemized.md
deductions-above-line.md
credits.md
state-taxes.md
review.md
finish.md
```

## Skill Sizing Guidance

A well-scoped skill should:
- Cover **one cohesive tax domain** (not "all of income")
- Have **3–8 questions** in its interview flow (not 1, not 20)
- Touch **≤15 TaxReturn fields** in its Writes contract
- Be completable in **1–5 conversational turns** for a typical case
- Fit in **~80–120 lines** of prompt when loaded (keeps LLM context tight)
