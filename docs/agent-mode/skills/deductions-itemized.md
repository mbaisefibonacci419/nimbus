# Skill: deductions-itemized
## Domain: Itemized Deductions (Schedule A)

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `deductions` AND this skill is not yet completed or skipped
- Position: second skill in deductions phase (order: 2)
- Prerequisites: `deductions-discovery` completed
- Relevance: `deductionMethod === 'itemized'`

### User Intent (on-demand)
- "I want to enter my mortgage interest"
- "Property taxes" / "state and local taxes"
- "Medical expenses" / "out-of-pocket medical costs"
- "Charitable donations" / "I gave to charity"
- "Itemized deductions" / "Schedule A"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.deductionMethod` | `'standard' \| 'itemized'` | Confirm itemized selected |
| `taxReturn.itemizedDeductions` | `ItemizedDeductions?` | Existing values |
| `taxReturn.incomeDiscovery` | `Record<string, string>` | Which deductions were flagged |
| `taxReturn.filingStatus` | `FilingStatus?` | SALT cap amount, medical threshold |
| `taxReturn.gamblingLosses` | `number?` | Gambling loss deduction |
| `taxReturn.incomeW2G` | `IncomeW2G[]` | Gambling winnings (caps losses) |
| `calculation.form1040.adjustedGrossIncome` | `number` | Medical expense 7.5% floor |
| `calculation.scheduleA` | `ScheduleAResult?` | Running total context |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.itemizedDeductions` | `ItemizedDeductions` | `update_itemized` |
| `taxReturn.gamblingLosses` | `number` | `update_field` |

### Discovery Keys
None — uses keys set by `deductions-discovery`.

### Allowed Actions
- `update_itemized` — set itemized deduction field values
- `update_field` — gambling losses
- `navigate` — navigate to itemized deductions step
- `no_action` — informational response

### Forbidden
- Must not change `deductionMethod` (discovery skill does that)
- Must not enter above-the-line adjustments (HSA, student loan — that's `deductions-above-line`)
- Must not modify income or credits
- Must not exceed statutory caps without flagging (SALT $40K)

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] All `ded_*` discovery keys flagged as `yes` have been addressed with amounts
- [ ] SALT cap has been mentioned if state/local taxes exceed it
- [ ] Medical threshold (7.5% AGI) has been mentioned if medical deductions entered
- [ ] OR: user decides to switch to standard deduction
- [ ] OR: user explicitly says "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check which deduction categories were flagged in discovery:
   "Let's enter the amounts for your itemized deductions. Based on our
   earlier conversation, you mentioned: {list of flagged categories}."

### Medical and Dental (if `ded_medical === 'yes'`)

2. "What were your total out-of-pocket medical and dental expenses
   (after insurance reimbursements)?"
   - After user provides: "Medical expenses are only deductible above
     7.5% of your AGI. Your AGI is approximately ${AGI}, so the first
     ${floor} isn't deductible. Your potential deduction is ${amount - floor}."
   - If amount ≤ floor: "These expenses don't exceed 7.5% of your income,
     so they won't contribute to your itemized deductions. Still want to
     enter them in case your AGI changes?"

### State and Local Taxes (SALT)

3. "Let's capture your state and local taxes:
   - **State income tax paid** (or general sales tax if you prefer)
   - **Property taxes**"

4. "What did you pay in state income taxes?"
   - Note: if they had state withholding on W-2/1099, mention it's already captured
   - "Did you make any additional estimated state tax payments?"

5. "What did you pay in real estate property taxes?"

6. Calculate combined SALT:
   "Your combined state and local taxes are ${combined}. The SALT deduction
   is capped at $40,000 ($20,000 if married filing separately).
   {If over cap: 'You'll get the full $40,000 cap.'}"

### Mortgage Interest

7. If `ded_mortgage === 'yes'`:
   "How much mortgage interest did you pay? This should be on your Form
   1098 from your lender."
   - "Was the mortgage taken out before December 15, 2017?"
     (Pre-TCJA: up to $1M deductible; post-TCJA: up to $750K)
   - If home equity loan: "Was the home equity loan used to buy, build,
     or substantially improve your home? Only then is the interest deductible."

### Charitable Contributions

8. If `ded_charitable === 'yes'`:
   "How much did you donate in cash to qualified charities?"
   - Cash donations limited to 60% of AGI
   "Did you donate any goods (clothes, furniture, etc.)? If so, what's the
   estimated fair market value?"
   "Any donations over $250 for a single contribution? You'll need a
   written acknowledgment from the charity."

### Gambling Losses

9. If `ded_gambling === 'yes'`:
   "What were your total gambling losses for the year?"
   - "Gambling losses are deductible only up to the amount of your
     winnings (${totalWinnings}). So your deduction is capped at ${cap}."

### Other Itemized

10. "Any other itemized deductions?
    - Casualty or theft losses from a federally declared disaster?
    - Other deductions (e.g., unrecovered annuity investment)?"

### Running Comparison

11. "Here's your itemized deduction summary:

    | Category | Amount |
    |----------|--------|
    | Medical (above 7.5% AGI) | ${medicalDeduction} |
    | SALT (capped) | ${saltCapped} |
    | Mortgage interest | ${mortgage} |
    | Charitable | ${charitable} |
    | Gambling losses | ${gambling} |
    | **Total itemized** | **${total}** |

    **Standard deduction:** ${standardAmount}

    {If itemized > standard: 'Itemizing saves you ${difference}.'}
    {If standard > itemized: 'The standard deduction is actually higher.
    Would you like to switch to standard?'}"

### Exit

12. If user confirms: "Itemized deductions are set at ${total}."
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- Medical → Schedule A Line 1, minus 7.5% AGI floor → Line 4
- SALT (income + property) → Schedule A Line 5, capped at $40,000 ($20,000 MFS)
- Mortgage interest → Schedule A Line 8a/8b (acquisition vs home equity)
- Charitable cash → Schedule A Line 12; non-cash → Line 12 (combined); AGI limits apply
- Gambling losses → Schedule A Line 16 (limited to winnings)
- Total Schedule A → Form 1040 Line 12 (replaces standard deduction)
- AMT: SALT and certain miscellaneous deductions are added back for AMT calculation

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| SALT exceeds $40K cap | Cap at $40,000. "The SALT cap applies regardless of how much you paid." | Over-deduction → incorrect filing |
| Mortgage on $1.2M home (post-TCJA) | Interest deductible only on first $750K of debt. "Your deductible interest is prorated based on the $750,000 limit." | Over-deduction |
| User donated a car worth $5,000+ | "For vehicle donations over $5,000, the deduction is usually limited to the charity's sale price (on Form 1098-C)." | Overstated charitable |
| Medical insurance premiums | Pre-tax premiums (payroll deducted) are NOT deductible again. "Only out-of-pocket costs count — not premiums already deducted from your paycheck." | Double deduction |
| Itemized total is less than standard | Recommend switching: "Your standard deduction is higher — would you like to use that instead?" | Voluntarily taking a smaller deduction |
| MFS — spouse itemizes | Both must use same method. Already enforced by discovery skill. | Inconsistent filing |
| Donor-advised fund contribution | Deductible in the year of contribution to the DAF, not when distributed. | Timing error |
| Qualified charitable distribution (QCD) | QCD is NOT also an itemized deduction — it's excluded from income. "Since your QCD already reduced your taxable income, don't also claim it as a charitable deduction." | Double benefit |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Dollar amounts must match user input. SALT cap must be correctly applied. Medical floor must be calculated from AGI.
- **Completeness**: Must address every `ded_*` key flagged as `yes` in discovery. Must show itemized vs standard comparison at the end. Must mention SALT cap.
- **No Tax Harm**: Primary risks are (1) exceeding SALT cap, (2) not applying 7.5% AGI floor for medical, (3) deducting pre-tax insurance premiums, (4) gambling losses exceeding winnings, (5) mortgage interest on debt over the $750K limit, (6) double-counting QCD as both exclusion and deduction.
