# Skill: deductions-above-line
## Domain: Above-the-Line Adjustments (Schedule 1 Part II)

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `deductions` AND this skill is not yet completed or skipped
- Position: third skill in deductions phase (order: 3)
- Prerequisites: `deductions-discovery` completed

### User Intent (on-demand)
- "HSA" / "Health Savings Account"
- "Student loan interest" / "student loans"
- "IRA contribution" / "IRA deduction"
- "Educator expenses" / "I'm a teacher"
- "Estimated tax payments" / "quarterly payments"
- "Alimony paid" / "I pay alimony"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.incomeDiscovery` | `Record<string, string>` | Which adjustments were flagged |
| `taxReturn.hsaDeduction` | `number?` | Existing HSA |
| `taxReturn.hsaContribution` | `HSAContributionInfo?` | HSA detail |
| `taxReturn.studentLoanInterest` | `number?` | Existing student loan |
| `taxReturn.iraContribution` | `number?` | Existing IRA |
| `taxReturn.coveredByEmployerPlan` | `boolean?` | IRA deductibility |
| `taxReturn.educatorExpenses` | `number?` | Existing educator |
| `taxReturn.estimatedPaymentsMade` | `number?` | Existing estimated payments |
| `taxReturn.estimatedQuarterlyPayments` | `[number,number,number,number]?` | Quarterly breakdown |
| `taxReturn.alimony` | `AlimonyInfo?` | Existing alimony paid |
| `taxReturn.nolCarryforward` | `number?` | Existing NOL |
| `taxReturn.filingStatus` | `FilingStatus?` | Phase-out thresholds |
| `taxReturn.w2Income` | `W2Income[]` | Employer plan coverage (box 13) |
| `taxReturn.businesses` | `BusinessInfo[]` | SE context for HSA/retirement |
| `calculation.form1040.adjustedGrossIncome` | `number` | Phase-out calculations |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.hsaDeduction` | `number` | `update_field` |
| `taxReturn.hsaContribution` | `HSAContributionInfo` | `update_field` |
| `taxReturn.studentLoanInterest` | `number` | `update_field` |
| `taxReturn.iraContribution` | `number` | `update_field` |
| `taxReturn.coveredByEmployerPlan` | `boolean` | `update_field` |
| `taxReturn.educatorExpenses` | `number` | `update_field` |
| `taxReturn.estimatedPaymentsMade` | `number` | `update_field` |
| `taxReturn.estimatedQuarterlyPayments` | `[number,number,number,number]` | `update_field` |
| `taxReturn.alimony` | `AlimonyInfo` | `update_field` |
| `taxReturn.nolCarryforward` | `number` | `update_field` |

### Discovery Keys
None — uses keys set by `deductions-discovery`.

### Allowed Actions
- `update_field` — set above-the-line adjustment values
- `navigate` — navigate to adjustment steps
- `no_action` — informational response

### Forbidden
- Must not enter itemized deductions (that's `deductions-itemized`)
- Must not enter SE retirement or health insurance (that's `self-employment`)
- Must not modify income or credits
- Must not recommend specific IRA contribution amounts

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] All flagged above-the-line adjustments addressed with amounts or declined
- [ ] HSA coverage type and amount captured if flagged
- [ ] IRA deductibility evaluated based on employer plan coverage
- [ ] OR: user says "none of these apply"
- [ ] OR: user explicitly says "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check flagged discovery keys:
   "Let's enter amounts for your adjustments to income. These reduce your
   AGI before we apply deductions — sometimes called 'above-the-line'
   deductions. You mentioned: {list of flagged items}."

### HSA Contributions (if `ded_hsa === 'yes'`)

2. "What type of HSA coverage do you have — self-only or family?"
3. "How much did you contribute to your HSA in {taxYear}?"
   - 2025 limits: $4,300 self-only, $8,550 family; +$1,000 catch-up if 55+
   - "Note: if your employer contributed (shown on W-2 Box 12, Code W),
     that counts toward the limit."
   - If employer contributions via W-2: "Your W-2 shows ${employerHSA} in
     employer contributions. You can contribute up to ${remaining} more."
4. Confirm → emit `update_field` for HSA fields

### Student Loan Interest (if `ded_student_loan === 'yes'`)

5. "How much student loan interest did you pay? The deduction is capped
   at $2,500 and phases out at higher incomes."
   - Phase-out: MAGI $80K-$95K (single), $165K-$195K (MFJ)
   - If above phase-out: "At your income level, this deduction may be
     reduced or eliminated. The engine will calculate the exact amount."
6. Confirm → emit `update_field`

### IRA Contribution (if `ded_ira === 'yes'`)

7. "How much did you contribute to a traditional IRA in {taxYear}?"
   - 2025 limit: $7,000, +$1,000 catch-up if 50+
8. "Are you or your spouse covered by a retirement plan at work? Check
   your W-2 Box 13 for the 'Retirement plan' checkbox."
   - If covered: deduction may be limited based on MAGI
   - Phase-outs: Single $79,000-$89,000; MFJ (covered) $126,000-$146,000;
     MFJ (spouse covered) $236,000-$246,000
   - "Your deduction may be partially or fully limited — the engine will
     calculate the allowed amount."
9. Confirm → emit `update_field` for IRA and coveredByEmployerPlan

### Educator Expenses (if `ded_educator === 'yes'`)

10. "How much did you spend on classroom supplies and materials?
    The deduction is up to $300 ($600 if both spouses are educators
    filing jointly)."
11. Confirm → emit `update_field`

### Estimated Tax Payments

12. If `ded_estimated_payments === 'yes'`:
    "How much did you pay in estimated taxes to the IRS this year?
    If you know the quarterly amounts, I can enter those too."
    - If quarterly: capture Q1-Q4 amounts
    - If lump sum: capture total
13. Confirm → emit `update_field`

### Alimony Paid (if `ded_alimony === 'yes'`)

14. "How much alimony did you pay? And when was the divorce or separation
    agreement executed?"
    - Pre-2019 agreements: deductible above-the-line
    - 2019 or later: NOT deductible
    - "Enter the recipient's SSN for reporting purposes."
15. Confirm → emit `update_field`

### NOL Carryforward (if `ded_nol === 'yes'`)

16. "Do you have a net operating loss carryforward from a prior year?
    If so, what's the amount?"
17. Confirm → emit `update_field`

### Exit

18. "Here's your above-the-line adjustments:

    | Adjustment | Amount |
    |-----------|--------|
    {for each entered adjustment: '| {name} | ${amount} |'}
    | **Total adjustments** | **${total}** |

    These reduce your AGI from ${grossIncome} to approximately
    ${grossIncome - total}, which can also improve your eligibility
    for credits and other deductions."
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `hsaDeduction` → Schedule 1 Line 13 → reduces AGI
- `studentLoanInterest` → Schedule 1 Line 21 (capped at $2,500, phases out)
- `iraContribution` → Schedule 1 Line 20 (may be limited by employer plan coverage)
- `educatorExpenses` → Schedule 1 Line 11 (capped at $300/$600)
- `estimatedPaymentsMade` → Form 1040 Line 26 (reduces amount owed, not AGI)
- `alimony` → Schedule 1 Line 19a (pre-2019 agreements only)
- `nolCarryforward` → Schedule 1 Line 8a (limited to 80% of taxable income)
- AGI reduction cascades: affects EITC, education credits, saver's credit,
  medical deduction floor, PTC, and other income-based thresholds

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| HSA contribution exceeds limit | Flag: "The limit is ${limit}. Excess contributions are subject to a 6% penalty." | Penalty-triggering over-contribution |
| User has both employer and personal HSA contributions | Combined total can't exceed limit. Subtract employer (W-2 Box 12 Code W) first. | Over-contribution |
| IRA deduction with employer plan and high income | Deduction phases out. "Your deduction is reduced because you're covered by an employer plan and your income exceeds the phase-out threshold." | Claiming full deduction when limited |
| User contributes to Roth IRA, not traditional | Roth IRA contributions are NOT deductible. "Roth contributions don't reduce your taxable income — the benefit comes when you withdraw tax-free in retirement." | Claiming non-existent deduction |
| Educator at private school | Qualifies — the $300 deduction applies to K-12 educators at any school. | Unnecessarily excluding |
| Alimony paid under modified agreement | Same rule as received: modification date doesn't change effective date unless explicitly stated. | Wrong deductibility |
| Estimated payments via withholding | "If you increased your W-2 withholding instead of making estimated payments, that's already captured on your W-2. Only enter separate estimated payments made directly to the IRS." | Double-counting withholding |
| Student loan paid by parent | If the student is no longer a dependent, the student can deduct even if parents paid. "Who is legally obligated on the loan?" | Wrong person deducting |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Amounts must match user input. HSA coverage type must be correct. IRA employer plan coverage flag must be set correctly.
- **Completeness**: Must address every flagged above-the-line item. Must capture HSA coverage type. Must check employer plan for IRA deductibility. Must distinguish estimated payments from withholding.
- **No Tax Harm**: Primary risks are (1) HSA over-contribution, (2) full IRA deduction when limited by employer plan, (3) deducting Roth IRA contributions, (4) deducting post-2018 alimony, (5) double-counting estimated payments with withholding.
