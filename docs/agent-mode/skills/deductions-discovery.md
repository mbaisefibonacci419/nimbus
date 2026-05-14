# Skill: deductions-discovery
## Domain: Deduction & Adjustment Discovery

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `deductions` AND this skill is not yet completed or skipped
- Position: first skill in the deductions phase (order: 1)
- Prerequisites: all income-phase skills completed or skipped

### User Intent (on-demand)
- "What deductions can I take?"
- "Help me find deductions"
- "Can I write off [something]?"
- "What about my mortgage / student loans / medical bills?"
- "Should I itemize?"
- "I want to lower my taxes"
- "Tax breaks" / "tax deductions" / "save on taxes"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.filingStatus` | `FilingStatus` | Standard deduction amount depends on filing status |
| `taxReturn.incomeDiscovery` | `Record<string, string>` | See what's already been discovered (SE income, rental, etc.) |
| `taxReturn.deductionMethod` | `'standard' \| 'itemized'` | Check if already chosen |
| `taxReturn.itemizedDeductions` | `ItemizedDeductions?` | See what's already entered |
| `taxReturn.w2Income` | `W2Income[]` | Check for retirement plan (box 13) → IRA deductibility |
| `taxReturn.businesses` | `BusinessInfo[]` | SE context → HSA, retirement, health insurance eligibility |
| `taxReturn.dependents` | `Dependent[]` | Child-related deduction hints |
| `taxReturn.hsaDeduction` | `number?` | Already entered? |
| `taxReturn.studentLoanInterest` | `number?` | Already entered? |
| `taxReturn.iraContribution` | `number?` | Already entered? |
| `taxReturn.educatorExpenses` | `number?` | Already entered? |
| `taxReturn.estimatedPaymentsMade` | `number?` | Already entered? |
| `calculation.form1040.adjustedGrossIncome` | `number` | AGI affects deduction phase-outs |
| `calculation.scheduleA` | `ScheduleAResult?` | Compare itemized total to standard |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.incomeDiscovery[ded_*]` | `'yes' \| 'no'` | `set_income_discovery` |
| `taxReturn.incomeDiscovery[form*]` | `'yes' \| 'no'` | `set_income_discovery` |
| `taxReturn.deductionMethod` | `'standard' \| 'itemized'` | `set_deduction_method` |

### Discovery Keys
| Key | Sets to | When |
|-----|---------|------|
| `ded_mortgage` | `yes` / `no` | User confirms/denies mortgage interest |
| `ded_property_tax` | `yes` / `no` | User confirms/denies property tax |
| `ded_medical` | `yes` / `no` | User confirms/denies significant medical expenses |
| `ded_charitable` | `yes` / `no` | User confirms/denies charitable donations |
| `ded_gambling` | `yes` / `no` | User confirms/denies gambling losses |
| `ded_hsa` | `yes` / `no` | User confirms/denies HSA contributions |
| `ded_archer_msa` | `yes` / `no` | User confirms/denies Archer MSA |
| `ded_student_loan` | `yes` / `no` | User confirms/denies student loan interest |
| `ded_educator` | `yes` / `no` | User confirms/denies K-12 educator expenses |
| `ded_ira` | `yes` / `no` | User confirms/denies IRA contributions |
| `ded_alimony` | `yes` / `no` | User confirms/denies alimony paid (pre-2019) |
| `ded_nol` | `yes` / `no` | User confirms/denies NOL carryforward |
| `ded_estimated_payments` | `yes` / `no` | User confirms/denies estimated tax payments |
| `schedule1a` | `yes` / `no` | User confirms/denies Schedule 1-A items |
| `investment_interest` | `yes` / `no` | User confirms/denies investment interest expense |
| `form8606` | `yes` / `no` | User confirms/denies nondeductible IRA / Roth conversion |
| `schedule_h` | `yes` / `no` | User confirms/denies household employees |
| `form5329` | `yes` / `no` | User confirms/denies excess contributions / early distributions |
| `qbi_detail` | `yes` / `no` | User has QBI needing W-2 wages / UBIA detail |
| `amt_data` | `yes` / `no` | User confirms/denies AMT-specific items |
| `bad_debt` | `yes` / `no` | User confirms/denies nonbusiness bad debts |
| `casualty_loss` | `yes` / `no` | User confirms/denies casualty/theft losses |

### Allowed Actions
- `set_income_discovery` — set any `ded_*` or form-level discovery key
- `set_deduction_method` — set standard vs itemized
- `navigate` — navigate to a deduction step
- `no_action` — informational response

### Forbidden
- Must not enter actual dollar amounts for deductions (that's `deductions-itemized` and `deductions-above-line`)
- Must not modify income, credits, or personal info
- Must not set `deductionMethod` to `'itemized'` without explaining the comparison to standard
- Must not recommend a deduction method — present the comparison and let the user decide

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] User has been asked about all contextually relevant deduction categories
- [ ] `deductionMethod` is set (either `'standard'` or `'itemized'`)
- [ ] All relevant `ded_*` discovery keys have been set to `'yes'` or `'no'`
- [ ] OR: user says "just take the standard deduction" (set method + mark all ded_* as 'no')
- [ ] OR: user says "skip" / "I'll figure this out later"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check what's already known from the return context and tailor the opening:
   - "Now let's figure out which deductions apply to you. Based on what
     you've entered so far, I can already see some possibilities. Let me
     walk through the main categories."

### Contextual Discovery (not every category — only relevant ones)

The skill uses a **branching decision tree** based on return context. Not every
user gets asked about every deduction. The tree:

```
                    ┌─────────────────┐
                    │  Start          │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │  Homeowner path             │  Non-homeowner path
              │  (rental/home_sale in       │  (skip mortgage,
              │   discovery, or address      │   property tax)
              │   suggests ownership)        │
              ▼                              ▼
    ┌──────────────┐               ┌──────────────┐
    │ Mortgage?    │               │ Medical?     │
    │ Property tax?│               │ (if AGI < X) │
    │ Medical?     │               └──────────────┘
    └──────────────┘                       │
              │                            │
              ▼                            ▼
    ┌──────────────┐               ┌──────────────┐
    │ Charitable?  │               │ Charitable?  │
    └──────────────┘               └──────────────┘
              │                            │
              └──────────┬─────────────────┘
                         ▼
              ┌──────────────────┐
              │ Above-the-line   │
              │ (HSA, student    │
              │  loan, IRA,      │
              │  educator, est.  │
              │  payments)       │
              └──────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │ Niche checks     │
              │ (gambling, NOL,  │
              │  alimony, AMT,   │
              │  Schedule H)     │
              └──────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │ Recommend        │
              │ standard vs      │
              │ itemized         │
              └──────────────────┘
```

### Category Questions (asked one at a time)

2. **Homeowner block** (if contextually relevant):
   "Do you own a home? If so, did you pay mortgage interest or property
   taxes this year?"
   - If yes to mortgage → `set_income_discovery(ded_mortgage, yes)`
   - If yes to property tax → `set_income_discovery(ded_property_tax, yes)`
   - If no → set both to `no`

3. **Medical expenses**:
   "Did you have significant medical or dental expenses this year that
   weren't covered by insurance? These are only deductible if they exceed
   7.5% of your income."
   - If yes → `set_income_discovery(ded_medical, yes)`
   - If no → `set_income_discovery(ded_medical, no)`

4. **Charitable donations**:
   "Did you make any charitable donations — cash or goods — to qualified
   organizations this year?"
   - If yes → `set_income_discovery(ded_charitable, yes)`
   - If no → `set_income_discovery(ded_charitable, no)`

5. **Above-the-line adjustments** (ask about each only if contextually relevant):

   a. **HSA** (if self-employed OR no employer HSA detected in W-2 box 12):
      "Did you contribute to a Health Savings Account (HSA)?"

   b. **Student loans** (ask broadly — many people have these):
      "Did you pay any student loan interest this year?"

   c. **IRA** (if no employer retirement plan in W-2 box 13, or if SE):
      "Did you contribute to a traditional IRA?"

   d. **Educator** (ask only if occupation suggests teaching):
      "Are you a K-12 teacher or educator? You may be able to deduct up
      to $300 in classroom supplies."

   e. **Estimated payments**:
      "Did you make any estimated tax payments to the IRS during the year?"

6. **Niche categories** (ask briefly, as a batch):
   "A few more quick ones:
   - Did you have any gambling losses? (Only relevant if you reported gambling winnings.)
   - Did you pay alimony under a pre-2019 divorce agreement?
   - Did you have any household employees (nanny, housekeeper) you paid $2,700+?"
   - Set discovery keys based on answers.

### Deduction Method Decision

7. If any itemized deductions were flagged (`ded_mortgage`, `ded_property_tax`,
   `ded_medical`, `ded_charitable` = yes):

   "Based on what you've told me, let's compare:
   - **Standard deduction** for {filingStatus}: ${standardAmount}
   - **Potential itemized deductions**: you mentioned {list}

   I can't tell you the exact itemized total until we enter the amounts in
   the next step, but {guidance based on what they mentioned}. Which would
   you like to start with?"

   - If user chooses → `set_deduction_method`
   - If user is unsure → "Let's enter the itemized amounts and compare.
     You can always switch back to standard if itemizing doesn't win."
     → set method to `itemized` (can be changed later)

8. If NO itemized deductions were flagged:
   "It looks like the standard deduction (${standardAmount}) is your best
   option. I'll set that for you."
   → `set_deduction_method('standard')`

### Exit

9. Summarize what was discovered:
   "Here's what I found:
   - **Deduction method:** {standard/itemized}
   - **Deductions to enter:** {list of yes flags}
   - **Adjustments to enter:** {list of above-the-line yes flags}

   I'll walk you through entering the amounts next."
   → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `deductionMethod` → determines whether Form 1040 Line 12 uses Schedule A
  (itemized) or the standard deduction amount
- Standard deduction amounts (2025): Single $15,350, MFJ $30,700, HoH $22,800,
  MFS $15,350 (see `shared/src/engine/taxConstants.ts` for exact values)
- Itemized deductions flow through Schedule A → Form 1040 Line 12
- Above-the-line adjustments (HSA, student loan, IRA, educator) flow through
  Schedule 1 → Form 1040 Line 10 (adjustments to income) → reduce AGI
- AGI reduction can cascade into credit eligibility (EITC, education credits,
  saver's credit) and phase-out calculations
- SALT cap: $40,000 ($20,000 MFS) per OBBBA — affects property tax + state
  income tax combination

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| User says "I own a home" but has no mortgage | Ask about property tax only, skip mortgage | Setting ded_mortgage=yes leads to empty step |
| User says "I donated to my friend's GoFundMe" | Explain: GoFundMe donations are generally NOT tax-deductible unless going to a 501(c)(3) | False charitable deduction |
| User's potential itemized total is very close to standard | Recommend entering itemized amounts to compare: "It's close — let's enter the numbers and see which is higher" | Premature standard deduction locks out higher itemized |
| MFS filer — one spouse itemizes, both must itemize | Warn: "Since you're filing separately, if your spouse itemizes, you must also itemize even if the standard deduction is higher" | IRS filing status/deduction method mismatch |
| User mentions SALT and lives in high-tax state | Proactively mention the $40,000 SALT cap | User enters $60k expecting full deduction, gets $40k |
| User asks "should I itemize?" | Present the comparison factually. Do NOT recommend — say "Here's how they compare; which would you like to go with?" | Providing tax advice |
| User has both pre-tax and Roth IRA contributions | Flag Form 8606 discovery for nondeductible tracking | Missed Form 8606 → incorrect basis tracking |
| Self-employed user asks about HSA | Confirm they have a qualifying HDHP. HSA for SE is above-the-line (not SE deduction) | Wrong deduction location |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Discovery keys must match what the user described. If user says "I pay a mortgage" → `ded_mortgage` must be `yes`, not missed.
- **Completeness**: Must ask about all contextually relevant categories. A homeowner must be asked about mortgage AND property tax. An SE filer must be asked about HSA and retirement. Must always set `deductionMethod`.
- **No Tax Harm**: Primary risks are (1) auto-selecting standard deduction when itemized is clearly better, (2) missing the MFS both-must-itemize rule, (3) not mentioning the SALT cap to high-tax-state users, (4) accepting non-deductible items as charitable.
