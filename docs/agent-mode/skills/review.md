# Skill: review
## Domain: Return Review & Completeness Check

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `review` AND this skill is not yet completed or skipped
- Position: only skill in review phase (order: 1)
- Prerequisites: all prior phase skills completed or skipped

### User Intent (on-demand)
- "Review my return" / "Is my return complete?"
- "Check for errors" / "Did I miss anything?"
- "What's my refund?" / "How much do I owe?"
- "Summary" / "show me the numbers"
- "Am I done?"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.*` | (entire return — read-only overview) | Completeness check |
| `calculation.form1040` | `Form1040Result` | Summary numbers |
| `calculation.credits` | `CreditsResult` | Credit totals |
| `calculation.scheduleA` | `ScheduleAResult?` | Itemized totals |
| `calculation.scheduleC` | `ScheduleCResult?` | SE summary |
| `calculation.scheduleSE` | `ScheduleSEResult?` | SE tax |
| `calculation.stateResults` | `StateCalculationResult[]?` | State summaries |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.status` | `'review'` | `update_field` |

### Discovery Keys
None.

### Allowed Actions
- `update_field` — set return status to `review`
- `navigate` — navigate to any step for corrections
- `no_action` — informational response (most actions in this skill)

### Forbidden
- Must not modify income, deductions, or credits directly
- Must not skip errors or warnings without informing the user
- Must not calculate tax (the engine does that)
- Must not file or submit the return (that's the `finish` skill)

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] All sections reviewed with user
- [ ] Any warnings or inconsistencies flagged
- [ ] User acknowledges the return summary
- [ ] Return status set to `review`
- [ ] OR: user says "looks good, let's finish"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. "Let's review your return before we finalize it. I'll walk through
   each section and flag anything that looks incomplete or unusual."

### Section-by-Section Review

2. **Personal Info & Filing Status:**
   "**Filing as:** {statusName}
   {if MFJ: 'With {spouseFirstName} {spouseLastName}'}
   **Dependents:** {count} ({names})
   ✓ Everything look correct here?"

3. **Income Summary:**
   "**Income:**

   | Source | Amount |
   |--------|--------|
   | W-2 wages | ${totalWages} |
   {if 1099nec: '| Freelance (1099-NEC) | ${total1099NEC} |'}
   {if 1099k: '| Platform income (1099-K) | ${total1099K} |'}
   {if interest: '| Interest | ${totalInterest} |'}
   {if dividends: '| Dividends | ${totalDividends} |'}
   {if capGains: '| Capital gains/losses | ${netCapGains} |'}
   {if retirement: '| Retirement distributions | ${totalRetirement} |'}
   {if ss: '| Social Security | ${ssTotal} (${ssTaxable} taxable) |'}
   {if other: '| Other income | ${otherIncome} |'}
   | **Total income** | **${totalIncome}** |"

4. **Adjustments & AGI:**
   "**Adjustments to income:** ${totalAdjustments}
   {list each adjustment}
   **Adjusted Gross Income (AGI):** ${AGI}"

5. **Deductions:**
   "**Deduction method:** {standard/itemized}
   **Amount:** ${deductionAmount}
   {if itemized: breakdown by category}
   **Taxable income:** ${taxableIncome}"

6. **Tax & Credits:**
   "**Federal income tax:** ${incomeTax}
   **Credits:**
   {list each credit with amount}
   **Total credits:** ${totalCredits}
   **Tax after credits:** ${taxAfterCredits}
   **Self-employment tax:** ${seTax}
   **Total tax:** ${totalTax}"

7. **Payments & Refund:**
   "**Payments:**
   - Federal withholding: ${totalWithholding}
   - Estimated payments: ${estimatedPayments}
   - Other payments: ${otherPayments}
   **Total payments:** ${totalPayments}

   **{If refund: 'REFUND: $' + refund}
   {If owed: 'AMOUNT OWED: $' + owed}**"

8. **State Returns (if any):**
   "**State returns:**
   {for each state: '{stateName}: {refund/owed} $X'}"

### Completeness Check

9. Run through potential issues:
   - Missing income forms (discovery keys set to 'yes' but no forms entered)
   - Unfiled state returns (withholding from a state not in stateReturns)
   - Common inconsistencies:
     - HoH without qualifying dependent
     - Education credits without student dependent
     - Dependent care without qualifying children
     - SE income but no Schedule C expenses
   - "I noticed {issue}. Would you like to address this?"

### Warnings

10. Flag any calculation warnings:
    - Unusually high deductions relative to income
    - Missing estimated tax payments for SE filers
    - AMT triggered
    - Underpayment penalty likely
    - "These are just flags — they may be perfectly fine for your situation."

### Confirmation

11. "Does everything look correct? If you need to change anything, I can
    take you to the right section. Otherwise, we can proceed to finalize."
    - If changes needed → `navigate` to appropriate step
    - If confirmed → set `status` to `review`, proceed to finish

### Exit

12. "Your return looks complete. Let's move to the final step — export
    and filing options."
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- This skill reads the entire calculation result but doesn't modify anything
- The engine must have run successfully for review to show accurate numbers
- Key Form 1040 lines: Line 9 (total income), Line 11 (AGI), Line 15
  (taxable income), Line 24 (total tax), Line 34 (total payments),
  Line 35a (refund) or Line 37 (amount owed)
- State calculations run independently per state

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| Calculation hasn't run yet | Trigger recalculation before showing review. "Let me recalculate your return with the latest data..." | Stale numbers |
| User made changes during review | Recalculate after each change before showing updated summary | Outdated display |
| Zero refund / zero owed | Explain: "You're almost exactly even — no refund and nothing owed. That's actually the ideal scenario." | User confusion |
| Very large refund ($10K+) | Don't second-guess, but note: "That's a significant refund — you might want to adjust your withholding so you have more money during the year." | Not flagging over-withholding |
| AMT triggered | Explain briefly: "The Alternative Minimum Tax applies to your return. This is an additional calculation that ensures a minimum tax rate." | User surprise |
| Balance due with SE income | Mention estimated payments: "Since you have self-employment income, you may want to make estimated payments next year to avoid underpayment penalties." | Penalty next year |
| Incomplete sections | Don't let user finalize with missing critical data (filing status, name). Flag and offer to complete. | Incomplete filing |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Summary numbers must match the engine calculation exactly. No manual calculations allowed.
- **Completeness**: Must review all major sections. Must flag inconsistencies. Must check for missing forms that were discovered but not entered.
- **No Tax Harm**: Primary risks are (1) showing stale calculation results, (2) not flagging missing income that was discovered, (3) allowing finalization with incomplete critical data, (4) not mentioning estimated payment needs for SE filers.
