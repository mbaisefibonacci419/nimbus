# Agent Skill Eval Framework

Defines how every agent skill is evaluated for quality. Each skill must pass
this rubric before being promoted to production. The eval pipeline runs both
automated checks (deterministic) and LLM-as-judge scoring (qualitative).

---

## Rubric Dimensions

### 1. Accuracy (weight: 30%)

**Definition:** Are the `ChatAction` objects emitted by the skill correct given
what the user said?

| Score | Criteria |
|-------|----------|
| 5 | Every action field matches user input exactly. Dollar amounts, names, enums all correct. |
| 4 | All critical fields correct. Minor non-impactful discrepancy (e.g., employer name casing). |
| 3 | One material field error that the user would catch at review (e.g., wrong box number). |
| 2 | Multiple field errors or a single error that changes tax outcome (e.g., wrong income type). |
| 1 | Actions are substantially wrong — would corrupt the return if applied. |

**Automated checks:**
- Field value extraction: compare emitted action fields to gold-standard values
  from the test case
- Type correctness: all amounts are numbers, enums are valid, dates parse
- Action type validity: only actions from the skill's `Allowed Actions` contract

**No Tax Harm gate:** Score ≤ 2 on Accuracy triggers automatic No Tax Harm review.

---

### 2. Completeness (weight: 25%)

**Definition:** Did the skill ask about everything within its contract scope?

| Score | Criteria |
|-------|----------|
| 5 | All required fields covered. Optional fields surfaced when contextually relevant. |
| 4 | All required fields covered. One contextually relevant optional field missed. |
| 3 | One required field missed but the skill's completion criteria still technically met. |
| 2 | Multiple required fields missed. User would need to manually fill gaps. |
| 1 | Skill terminated early with critical data missing. |

**Automated checks:**
- Required field coverage: for each test case, verify every field in the skill's
  `Writes` contract that should be populated IS populated
- Discovery key coverage: verify all applicable discovery flags were set
- Completion criteria: verify the skill's own completion conditions are met when
  the skill signals "done"

**Measuring "required" vs "optional":**
Each skill's contract should tag fields as `required` (must ask about) or
`contextual` (ask when relevant). The eval harness uses the test case's
`expected_fields` to determine which contextual fields should have been surfaced.

---

### 3. Relevance (weight: 15%)

**Definition:** Did the skill stay within its contract boundaries?

| Score | Criteria |
|-------|----------|
| 5 | Every question and action is squarely within the skill's domain. No drift. |
| 4 | One minor tangent that the user might find helpful (e.g., mentioning a related deduction). |
| 3 | Noticeable drift — asked about something outside contract scope but didn't act on it. |
| 2 | Emitted actions outside contract scope (contract violation). |
| 1 | Skill hijacked the conversation into an unrelated domain. |

**Automated checks:**
- Action scope: every emitted action type must be in the skill's `Allowed Actions`
- Field scope: every mutated field path must be in the skill's `Writes` contract
- Discovery scope: only discovery keys listed in the skill's `Discovery Keys` section

**Hard failure:** Score ≤ 2 on Relevance (contract violation) is an automatic fail
regardless of other scores.

---

### 4. Coherence (weight: 15%)

**Definition:** Is the conversation natural, non-repetitive, and logically ordered?

| Score | Criteria |
|-------|----------|
| 5 | Reads like a professional tax preparer. Questions flow naturally, no repetition. |
| 4 | Smooth flow with one minor awkwardness (e.g., slightly redundant confirmation). |
| 3 | Noticeable issues — re-asks something the user already answered, or jumps topics. |
| 2 | Confusing flow — user would need to re-read or ask "what?" |
| 1 | Incoherent — contradicts itself, loops, or ignores user responses. |

**Automated checks (heuristic):**
- Repetition detector: flag if the skill asks the same question (or semantically
  similar) twice within a session
- Turn count: flag if the skill takes >2x the expected turns for a standard case
- Acknowledgment check: after the user provides data, the next skill message
  should reference that data (not ignore it)

**LLM-as-judge:** Primary evaluation method for this dimension. The judge LLM
reads the full conversation transcript and scores coherence.

---

### 5. No Tax Harm (weight: 15% — but acts as a HARD GATE)

**Definition:** Could the skill's output cause the user to file incorrectly,
miss money they're owed, or violate IRS rules?

| Score | Criteria |
|-------|----------|
| 5 | No risk. All actions are correct and the skill proactively flags ambiguity. |
| 4 | No risk, but missed an opportunity to warn about a common mistake. |
| 3 | Low risk — minor inaccuracy that wouldn't survive the review step. |
| 2 | Medium risk — could cause a wrong filing if the user doesn't catch it at review. |
| 1 | High risk — would directly cause incorrect tax filing (wrong income type, missed income, etc.). |

**Hard gate:** Score ≤ 2 on No Tax Harm = **automatic skill failure**, regardless
of aggregate score. This dimension has veto power.

**Automated checks:**
- Tax engine delta: run `calculateForm1040` before and after applying the skill's
  actions. Compare the result against the gold-standard calculation for the test case.
  Flag if refund/owed differs by more than threshold.
- Filing status consistency: if the skill sets filing status, verify dependents and
  spouse data are consistent
- Income type validation: verify income amounts are assigned to the correct form type
  (e.g., consulting income as 1099-NEC not 1099-MISC when the user said "self-employed")
- Double-counting: verify no income item is entered twice
- Deduction ceiling: verify no deduction exceeds statutory limits (SALT cap, etc.)

**Scenario-based tax harm tests (per-skill):**
Each skill's `Edge Cases` section defines specific scenarios that are tested:

```
Given: User says "I got $5,000 from my uncle for helping with his business"
Risk:  Gift vs income classification
Check: Skill asks clarifying question before creating any action
Fail:  Skill auto-classifies as income OR auto-classifies as gift without asking
```

---

## Scoring

### Aggregate Score

```
aggregate = (accuracy × 0.30) + (completeness × 0.25) + (relevance × 0.15)
          + (coherence × 0.15) + (no_tax_harm × 0.15)
```

### Pass/Fail Thresholds

| Level | Criteria |
|-------|----------|
| **Pass** | Aggregate ≥ 4.0 AND No Tax Harm ≥ 3 AND Relevance ≥ 3 |
| **Conditional** | Aggregate ≥ 3.5 AND No Tax Harm ≥ 3 — needs review before promotion |
| **Fail** | Aggregate < 3.5 OR No Tax Harm ≤ 2 OR Relevance ≤ 2 |

---

## Test Case Structure

Each skill has a test suite of cases in `tests/agent-mode/skills/<skill-id>/`.

### Case file format (`<case-name>.json`)

```json
{
  "id": "wages-single-w2-simple",
  "skill": "income-wages",
  "description": "Single filer with one straightforward W-2",

  "initial_state": {
    "filingStatus": "single",
    "w2Income": [],
    "incomeDiscovery": {}
  },

  "conversation": [
    { "role": "user", "content": "I worked at Google and made $150,000" },
    { "role": "user", "content": "They withheld $28,000 in federal tax" },
    { "role": "user", "content": "California, $12,000 state tax" },
    { "role": "user", "content": "That's my only job" }
  ],

  "expected_actions": [
    {
      "type": "set_income_discovery",
      "incomeType": "w2",
      "value": "yes"
    },
    {
      "type": "add_income",
      "incomeType": "w2",
      "fields": {
        "employerName": "Google",
        "wages": 150000,
        "federalTaxWithheld": 28000,
        "stateTaxWithheld": 12000,
        "state": "CA"
      }
    }
  ],

  "expected_final_state": {
    "w2Income": [{ "employerName": "Google", "wages": 150000 }],
    "incomeDiscovery": { "w2": "yes" }
  },

  "expected_completion": true,

  "tax_harm_scenarios": [
    {
      "risk": "Agent enters wages as 1099-NEC instead of W-2",
      "check": "action.incomeType === 'w2'",
      "severity": "high"
    }
  ]
}
```

### Case categories (every skill must have at minimum)

| Category | Count | Purpose |
|----------|-------|---------|
| **Happy path** | 2–3 | Standard scenarios with clear user input |
| **Ambiguous input** | 2–3 | User says something that could map to multiple actions |
| **Edge cases** | 2–3 | From the skill's Edge Cases table |
| **Adversarial** | 1–2 | User provides wrong/contradictory info; skill should ask for clarification |
| **Skip/decline** | 1 | User says "I don't have this" — skill should mark complete cleanly |
| **Spouse variant** | 1 | MFJ scenario where spouse data is relevant (if applicable) |

**Minimum:** 8 test cases per skill. Target: 12–15 for complex skills.

---

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Eval Runner                           │
│                                                          │
│  For each skill:                                         │
│    For each test case:                                   │
│      1. Load skill prompt + initial_state               │
│      2. Simulate conversation (feed user turns)          │
│      3. Collect emitted actions + conversation log       │
│      4. Run automated checks (deterministic)             │
│      5. Run LLM-as-judge (Coherence + Completeness)     │
│      6. Run tax engine delta check                       │
│      7. Score all 5 dimensions                           │
│      8. Apply pass/fail gates                            │
│                                                          │
│  Aggregate results → skill-level scorecard               │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  Automated   │  LLM-as-Judge                            │
│  Checks      │                                          │
│              │  Prompt:                                  │
│  - Action    │  "You are evaluating an AI tax prep      │
│    schema    │   skill's conversation. Score on          │
│    valid?    │   Coherence (1-5) and Completeness (1-5) │
│  - Fields    │   using the rubric below..."             │
│    in scope? │                                          │
│  - Tax       │  Input:                                  │
│    engine    │  - Skill contract (Reads/Writes/Flow)    │
│    delta OK? │  - Full conversation transcript          │
│  - No dupe   │  - Expected vs actual actions            │
│    entries?  │                                          │
│              │  Output:                                  │
│              │  - Coherence score + rationale            │
│              │  - Completeness score + rationale         │
│              │  - Flagged concerns                       │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                   Scorecard Output                       │
│                                                          │
│  Skill: income-wages                                     │
│  Cases: 12 run, 11 passed, 1 conditional                │
│                                                          │
│  ┌──────────────┬───────┬───────────────────────────┐   │
│  │ Dimension    │ Avg   │ Distribution              │   │
│  ├──────────────┼───────┼───────────────────────────┤   │
│  │ Accuracy     │ 4.6   │ ████████████████░░ 92%    │   │
│  │ Completeness │ 4.3   │ ███████████████░░░ 86%    │   │
│  │ Relevance    │ 4.8   │ █████████████████░ 96%    │   │
│  │ Coherence    │ 4.1   │ ██████████████░░░░ 82%    │   │
│  │ No Tax Harm  │ 4.7   │ █████████████████░ 94%    │   │
│  ├──────────────┼───────┼───────────────────────────┤   │
│  │ AGGREGATE    │ 4.44  │ PASS ✓                    │   │
│  └──────────────┴───────┴───────────────────────────┘   │
│                                                          │
│  Flags:                                                  │
│  - Case "ambiguous-consulting" scored 3 on Accuracy      │
│    (classified 1099-MISC, expected clarifying question)   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## LLM-as-Judge Prompt Template

```
You are evaluating an AI tax preparation skill's conversation with a user.

## Skill Contract
{skill_contract}

## Conversation Transcript
{transcript}

## Expected Actions
{expected_actions}

## Actual Actions Emitted
{actual_actions}

## Score the following dimensions (1-5 each):

### Coherence
- 5: Professional tax preparer quality. Natural flow, no repetition.
- 4: Smooth with one minor awkwardness.
- 3: Noticeable issues — re-asks or jumps topics.
- 2: Confusing — user would need to re-read.
- 1: Incoherent — contradicts itself or loops.

### Completeness
- 5: All required fields covered. Relevant optional fields surfaced.
- 4: All required fields covered. One optional field missed.
- 3: One required field missed.
- 2: Multiple required fields missed.
- 1: Skill terminated with critical data missing.

Respond in JSON:
{
  "coherence": { "score": <1-5>, "rationale": "<2-3 sentences>" },
  "completeness": { "score": <1-5>, "rationale": "<2-3 sentences>" },
  "flags": ["<any concerns not captured by scores>"]
}
```

---

## Regression Testing

When a skill is modified, the full test suite re-runs. Regression is detected when:
- Any previously-passing case now fails
- Aggregate score drops by ≥ 0.3 from the last passing version
- A new No Tax Harm flag appears that wasn't present before

Regression blocks promotion to production until reviewed.

---

## Adding Eval Cases

When writing a new skill, start with eval cases **before** writing the interview
flow. This is test-driven skill development:

1. Write 3 happy-path cases defining what "correct" looks like
2. Write 2 ambiguous cases defining where the skill must ask for clarification
3. Write 2 edge cases from the skill's domain knowledge
4. Write the skill's interview flow to pass those cases
5. Add adversarial and spouse cases after the first round passes
