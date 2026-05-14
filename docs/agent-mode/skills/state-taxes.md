# Skill: state-taxes
## Domain: State Tax Returns

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `state` AND this skill is not yet completed or skipped
- Position: only skill in state phase (order: 1)
- Prerequisites: `review` NOT required — can run before review
- Relevance: `stateReturns?.length > 0 OR addressState !== undefined`

### User Intent (on-demand)
- "State taxes" / "state return"
- "I live in California" / "I moved states"
- "Do I need to file a state return?"
- "Part-year resident" / "nonresident"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.stateReturns` | `StateReturnConfig[]?` | Existing state configs |
| `taxReturn.addressState` | `string?` | Primary state |
| `taxReturn.w2Income` | `W2Income[]` | State withholding amounts |
| `taxReturn.income1099NEC` | `Income1099NEC[]` | State withholding |
| `taxReturn.filingStatus` | `FilingStatus?` | State filing status |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.stateReturns[]` | `StateReturnConfig` | `update_field` (via stateReturns path) |

### Discovery Keys
None.

### Allowed Actions
- `update_field` — create or update state return configs
- `navigate` — navigate to state tax steps
- `no_action` — informational response

### Forbidden
- Must not calculate state tax (the engine does that)
- Must not modify federal income, deductions, or credits
- Must not provide state-specific tax advice beyond what the engine supports
- Must not guess state-specific deductions or credits

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] User confirmed which state(s) they need to file in
- [ ] Each state has residency type set (resident / part-year / nonresident)
- [ ] Part-year filers have days-in-state captured
- [ ] OR: user lives in a no-income-tax state and confirms no other state filing needed
- [ ] OR: user explicitly says "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check existing state:
   - If `stateReturns` already configured: "You have state return(s) set up
     for {stateList}. Need to make changes or add another state?"
   - If `addressState` set but no `stateReturns`:
     "Your address is in {state}. {If no income tax: 'Great news —
     {state} doesn't have a state income tax, so no state return is
     needed.'} {If income tax: 'You'll likely need to file a {state}
     state return. Let me set that up.'}"
   - Otherwise: "Which state(s) do you need to file a return for?"

### No-Income-Tax States

2. If state is AK, FL, NV, NH, SD, TN, TX, WA, WY:
   "Your state doesn't have an income tax. Did you earn income in any
   other state that does? For example, if you work remotely for a company
   in another state, or have rental property elsewhere."
   - If no → mark complete
   - If yes → continue with that state

### State Configuration

3. "What's your residency status for {state}?"
   - **Resident**: lived there all year
   - **Part-year**: moved in or out during the year
   - **Nonresident**: earned income in the state but didn't live there

4. If part-year: "How many days did you live in {state} during the year?"
   - "When did you move in or out?"

5. If multiple states: "Any other states to add?"
   - Loop for each additional state

### Withholding Review

6. "Based on your income forms, here's the state withholding I see:
   {list of W-2/1099 state withholding by state}
   Does this look complete? Did you make any additional state estimated
   tax payments?"

### Confirmation

7. "Here's your state filing setup:

   | State | Residency | Withholding |
   |-------|-----------|-------------|
   {for each state: '| {state} | {type} | ${withholding} |'}

   The engine will calculate your state tax, deductions, and credits.
   Look right?"
   - Confirm → emit `update_field` for stateReturns

### Exit

8. "State returns are configured. The engine will calculate your state
   tax and show results alongside your federal return."
   → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `stateReturns[]` → drives state calculation engine for each state
- Each state has its own brackets, standard deduction, exemptions, and credits
- State AGI typically starts from federal AGI with state-specific additions/subtractions
- Part-year and nonresident returns allocate income based on days or source
- State withholding from W-2/1099 forms → state refund/owed calculation
- Reciprocity agreements between some states (e.g., VA/DC/MD) may affect filing requirements
- State refund from prior year may be taxable on federal return (1099-G Box 2)

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| User moved mid-year between two states | Need part-year return for BOTH states. "Since you moved, you'll file as a part-year resident in each state." | Missing a state return |
| Remote worker in different state than employer | May owe tax in employer's state. "Some states tax income based on where the work is performed, not where you live. Check if {state} has a nexus for remote workers." | Missing nonresident filing |
| NH/TN (interest/dividends only) | NH taxes interest/dividends above $2,400 (being phased out). TN has no income tax. Note differences. | Incorrect state categorization |
| Military member stationed in another state | "Active-duty military members generally maintain their legal residence and file in their home state, not the state they're stationed in." | Wrong state return |
| Reciprocity agreements | Some states have agreements where you only file in your home state. "If {states} have a reciprocity agreement, you may only need to file in your home state." | Filing unnecessary return |
| User has income from 5+ states | Accept all — some taxpayers with multiple income sources need several state returns. | Limiting states |
| Community property state (MFS) | CA, AZ, ID, LA, NM, NV, TX, WA, WI: community property rules may split income differently for MFS filers. | Wrong income allocation |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: State codes must be valid 2-letter abbreviations. Residency types must match user situation. Part-year days must be captured.
- **Completeness**: Must identify all states requiring a return. Must ask about part-year and nonresident situations. Must review state withholding. Must flag no-income-tax states.
- **No Tax Harm**: Primary risks are (1) missing a required state return, (2) wrong residency classification, (3) not identifying multi-state filing needs for remote workers, (4) not flagging military residence rules.
