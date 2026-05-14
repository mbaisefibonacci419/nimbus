# Skill: income-wages
## Domain: W-2 Wage Income

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `income` AND this skill is not yet completed or skipped
- Position: first skill in the income phase (order: 1)
- Prerequisites: `filing-status` completed

### User Intent (on-demand)
- "I have a W-2"
- "I work for [employer]" / "I'm employed at [company]"
- "My salary is..." / "I make $X a year"
- "Wages" / "paycheck" / "federal withholding"
- "My employer withheld..."
- "I got a raise" / "I started a new job"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.filingStatus` | `FilingStatus` | Determine if spouse W-2s are relevant (MFJ) |
| `taxReturn.w2Income` | `W2Income[]` | See what's already entered |
| `taxReturn.incomeDiscovery.w2` | `'yes' \| 'no' \| 'later'` | Check if already answered |
| `taxReturn.spouseFirstName` | `string?` | Personalize spouse questions ("Does [name] have a W-2?") |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.w2Income[]` | `W2Income` | `add_income` (incomeType: `w2`) |
| `taxReturn.incomeDiscovery.w2` | `'yes' \| 'no'` | `set_income_discovery` |

### Discovery Keys
| Key | Sets to | When |
|-----|---------|------|
| `w2` | `yes` | User has at least one W-2 |
| `w2` | `no` | User explicitly says no W-2 / not employed |

### Allowed Actions
- `add_income` (incomeType: `w2`) — add a W-2 entry
- `set_income_discovery` (incomeType: `w2`) — set discovery flag
- `remove_item` (itemType: `w2Income`) — remove an incorrect W-2 entry
- `navigate` (stepId: `w2_income`) — navigate to the W-2 step (if user wants to see it)
- `no_action` — informational response

### Forbidden
- Must not ask about or set any income type other than W-2
- Must not modify deductions, credits, or filing status
- Must not calculate or state specific tax amounts (the engine does that)
- Must not ask for SSN (collected separately at the encryption step)

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] `incomeDiscovery.w2 === 'no'` (user has no W-2s), OR
- [ ] `w2Income.length >= 1` AND user confirmed "no more W-2s"
- [ ] If `filingStatus === 'married_filing_jointly'`: also confirmed re: spouse W-2s
- [ ] OR: user explicitly says "skip" / "I'll do this later"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check existing state:
   - If `w2Income.length > 0`: "I see you already have {count} W-2(s) entered
     ({employer names}). Do you have any more to add, or is that complete?"
   - If `incomeDiscovery.w2 === 'no'`: skill is already complete — signal
     done immediately.
   - Otherwise: "Did you work for an employer this year? If so, you'll have
     a W-2 form — it's usually available from your employer or their payroll
     provider by late January."

2. If user says no → set `incomeDiscovery.w2 = 'no'`, mark complete.

### Main Loop (per W-2)

3. "What's the employer name on your W-2?"
   - If user provides employer + wages in one message (e.g., "Google, $150k"),
     extract both and skip to step 5 for remaining fields.

4. "What were your total wages? That's Box 1 on your W-2."
   - Accept natural language: "$150,000", "150k", "about $75,000" (round to
     nearest dollar).

5. "How much federal income tax was withheld? That's Box 2."

6. "Any state income tax withheld? If so, which state and how much?"
   - If user gives state + amount → capture both.
   - If user says "no state tax" → skip state fields.
   - If user is unsure → "Check Boxes 15-17 on your W-2. Box 15 is the state,
     Box 16 is state wages, Box 17 is state tax withheld."

7. Propose the W-2 action for confirmation:
   "Here's what I have:
   - **Employer:** {name}
   - **Wages (Box 1):** ${wages}
   - **Federal tax withheld (Box 2):** ${fed}
   - **State:** {state}, withheld: ${stateAmt}

   Does this look right?"

   - If user confirms → emit `add_income` + `set_income_discovery(w2, yes)`
   - If user corrects → update the field and re-confirm

### Additional W-2s

8. "Do you have another W-2? Some people have multiple if they changed jobs
   during the year."
   - If yes → loop back to step 3
   - If no → proceed to spouse check

### Spouse Check (MFJ only)

9. If `filingStatus === 'married_filing_jointly'`:
   "Does {spouseFirstName || 'your spouse'} have any W-2s to add?"
   - If yes → loop back to step 3 with `isSpouse: true` on the action
   - If no → proceed to completion

### Exit

10. "Great, W-2 income is all set. {count} W-2(s) totaling ${totalWages} in
    wages with ${totalWithheld} withheld."
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `w2Income[].wages` → Form 1040 Line 1a (Wages, salaries, tips)
- `w2Income[].federalTaxWithheld` → Form 1040 Line 25a (Federal income tax withheld from W-2s)
- `w2Income[].socialSecurityWages` → used for FICA reconciliation and excess SS credit
- `w2Income[].stateTaxWithheld` → state return withholding credit
- W-2 box 12 codes (e.g., DD for health insurance, W for HSA) can trigger
  visibility of other skills (HSA, retirement)
- Impact: W-2 wages directly increase taxable income; withholding reduces
  amount owed (or increases refund)

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| User says "I made $150k" without specifying it's a W-2 | Ask: "Is that from a W-2 (employer) or self-employment income?" | Wrong income type → incorrect SE tax calculation |
| User provides Box 12 codes (e.g., "DD: $8,000") | Accept and include in `fields.box12` array | Missing box 12 data can affect HSA, retirement plan detection |
| User says "I had two jobs" | Process each W-2 separately, don't combine | Combined wages would lose per-employer withholding data |
| User provides gross pay vs Box 1 wages | Clarify: "Is that the amount in Box 1 of your W-2? Gross pay and Box 1 can differ due to pre-tax deductions." | Overstated wages → higher tax |
| MFS filer mentions spouse W-2 | Do NOT add spouse W-2 to this return. Explain: "Since you're filing separately, your spouse's W-2 goes on their own return." | Adding spouse W-2 to MFS return = incorrect filing |
| User provides fractional cents | Round to nearest dollar per IRS instructions | Minor — IRS accepts whole dollars only |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Employer name, wages, and withholding must exactly match user input. State code must be a valid 2-letter abbreviation.
- **Completeness**: At minimum, must collect employer name, wages (Box 1), and federal withholding (Box 2). State withholding must be asked about. MFJ filers must be asked about spouse W-2s.
- **No Tax Harm**: Primary risks are (1) classifying self-employment income as W-2, (2) entering wages on the wrong spouse, (3) combining multiple W-2s into one entry.
