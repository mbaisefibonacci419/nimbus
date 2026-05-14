# Skill: credits
## Domain: Tax Credits

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `credits` AND this skill is not yet completed or skipped
- Position: first and only skill in credits phase (order: 1)
- Prerequisites: all deduction-phase skills completed or skipped

### User Intent (on-demand)
- "Tax credits" / "what credits do I qualify for?"
- "Child tax credit" / "CTC" / "earned income credit" / "EITC"
- "Education credit" / "American Opportunity" / "Lifetime Learning"
- "Child care" / "dependent care" / "daycare expenses"
- "Energy credits" / "solar panels" / "EV credit"
- "Saver's credit" / "retirement savings credit"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.dependents` | `Dependent[]` | CTC, EITC, dependent care eligibility |
| `taxReturn.filingStatus` | `FilingStatus?` | Credit phase-outs |
| `taxReturn.educationCredits` | `EducationCreditInfo[]` | Existing education credits |
| `taxReturn.dependentCare` | `DependentCareInfo?` | Existing dependent care |
| `taxReturn.saversCredit` | `SaversCreditInfo?` | Existing saver's credit |
| `taxReturn.cleanEnergy` | `CleanEnergyInfo?` | Existing clean energy |
| `taxReturn.evCredit` | `EVCreditInfo?` | Existing EV credit |
| `taxReturn.energyEfficiency` | `EnergyEfficiencyInfo?` | Existing energy efficiency |
| `taxReturn.childTaxCredit` | `ChildTaxCreditInfo?` | Existing CTC |
| `taxReturn.premiumTaxCredit` | `PremiumTaxCreditInfo?` | Existing PTC |
| `taxReturn.foreignTaxCreditCategories` | `ForeignTaxCreditCategory[]?` | Foreign tax paid |
| `taxReturn.income1099DIV` | `Income1099DIV[]` | Foreign tax from dividends |
| `taxReturn.iraContribution` | `number?` | Saver's credit basis |
| `taxReturn.w2Income` | `W2Income[]` | Earned income for EITC |
| `taxReturn.businesses` | `BusinessInfo[]` | SE earned income for EITC |
| `calculation.form1040.adjustedGrossIncome` | `number` | Phase-out checks |
| `calculation.credits` | `CreditsResult?` | Running credit totals |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.childTaxCredit` | `ChildTaxCreditInfo` | `update_field` |
| `taxReturn.educationCredits[]` | `EducationCreditInfo` | `update_field` |
| `taxReturn.dependentCare` | `DependentCareInfo` | `update_field` |
| `taxReturn.saversCredit` | `SaversCreditInfo` | `update_field` |
| `taxReturn.cleanEnergy` | `CleanEnergyInfo` | `update_field` |
| `taxReturn.evCredit` | `EVCreditInfo` | `update_field` |
| `taxReturn.energyEfficiency` | `EnergyEfficiencyInfo` | `update_field` |
| `taxReturn.premiumTaxCredit` | `PremiumTaxCreditInfo` | `update_field` |

### Discovery Keys
None — credits are determined from return data, not discovery flags.

### Allowed Actions
- `update_field` — set credit-related fields
- `navigate` — navigate to credit steps
- `no_action` — informational response

### Forbidden
- Must not modify income, deductions, or filing status
- Must not calculate credit amounts (the engine does that)
- Must not promise specific credit values before the engine runs
- Must not recommend tax planning strategies (just capture current-year data)

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] All contextually relevant credits have been evaluated
- [ ] CTC/EITC auto-determined from dependents and income (no user input needed unless override)
- [ ] Education credits captured if user has qualifying students
- [ ] Dependent care captured if user has eligible children/dependents
- [ ] Energy credits captured if user made qualifying purchases
- [ ] OR: user says "no credits" or "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. "Now let's check which tax credits apply to you. Credits directly
   reduce your tax bill — some can even result in a refund."

### Child Tax Credit (auto-detected)

2. If qualifying dependents under 17 exist:
   "Based on your dependents, you qualify for the Child Tax Credit.
   You have {count} qualifying child(ren) under 17 — that's up to
   ${count × 2000} in credits. The engine will calculate the exact
   amount based on your income."
   - No user input needed — CTC is auto-calculated from dependents
   - If income near phase-out ($200K single, $400K MFJ): mention it

### Earned Income Tax Credit (auto-detected)

3. If earned income exists and AGI is under threshold:
   "You may also qualify for the Earned Income Tax Credit (EITC).
   With {qualifyingChildren} qualifying child(ren) and your income,
   the engine will calculate if you're eligible."
   - EITC is fully auto-calculated; just note eligibility
   - MFS filers are NOT eligible

### Education Credits

4. "Did you or your dependents pay for college or post-secondary education
   this year?"
   - If yes: "Let's set up each student. There are two credits:
     - **American Opportunity Credit (AOTC)**: Up to $2,500/year for
       first 4 years of college. Partially refundable.
     - **Lifetime Learning Credit**: Up to $2,000/year, no limit on years."
   - For each student:
     a. "Student name and SSN (last 4 digits)?"
     b. "What school did they attend?"
     c. "How much was tuition and required fees?"
     d. "Any scholarships or grants?"
     e. "Is this within their first 4 years of post-secondary education?" (AOTC)
     f. "Was the student at least half-time?" (AOTC requirement)
   - Confirm → emit `update_field` for educationCredits

### Child and Dependent Care Credit

5. If dependents under 13 exist or disabled dependents:
   "Did you pay for childcare or dependent care so you (and your spouse)
   could work?"
   - If yes: "How much did you pay in total for care?"
   - "What was the care provider's name?"
   - Max qualifying expenses: $3,000 for one, $6,000 for two+ dependents
   - "Did your employer provide any dependent care benefits (FSA)?"
   - Confirm → emit `update_field` for dependentCare

### Saver's Credit

6. If user has IRA or retirement contributions and AGI is under threshold
   ($38,250 single, $76,500 MFJ for 2025):
   "Based on your retirement contributions, you may qualify for the
   Saver's Credit — an additional credit for low-to-moderate income
   retirement savers."
   - Usually auto-calculated from IRA/401k data already entered

### Energy Credits

7. "Did you make any energy-efficient improvements to your home this year?"
   - **Residential Clean Energy (Form 5695 Part I)**: Solar panels, wind,
     geothermal, battery storage — 30% of cost, no cap
   - **Energy Efficient Home Improvement (Part II)**: Insulation, windows,
     doors, heat pumps, water heaters — various caps, $3,200/year max
   - If yes → capture: type of improvement, cost, date installed
   - Confirm → emit `update_field`

8. "Did you buy a new or used electric vehicle?"
   - If new: up to $7,500 credit (manufacturer/assembly requirements apply)
   - If used: up to $4,000 credit (income limits apply)
   - Capture: vehicle make/model, VIN, purchase price, new/used
   - Confirm → emit `update_field` for evCredit

### Premium Tax Credit

9. If user has marketplace health insurance (no employer coverage):
   "Did you buy health insurance through the Healthcare Marketplace
   (healthcare.gov or a state exchange)?"
   - If yes: "Do you have a Form 1095-A?"
   - Capture: monthly premiums, SLCSP amounts, advance PTC received
   - Confirm → emit `update_field` for premiumTaxCredit

### Foreign Tax Credit

10. If user had foreign tax paid (from 1099-DIV or K-1):
    "I noticed you paid ${foreignTax} in foreign taxes. You can claim
    this as a credit. For amounts under $300 ($600 MFJ), you can
    claim it directly without Form 1116."
    - No additional input usually needed — auto-flows from income data

### Exit

11. "Here's your credits summary:

    | Credit | Status |
    |--------|--------|
    | Child Tax Credit | ${ctcStatus} |
    | EITC | ${eitcStatus} |
    | Education | ${educationStatus} |
    | Dependent Care | ${careStatus} |
    | Energy | ${energyStatus} |
    | Other | ${otherStatus} |

    The engine will calculate exact amounts. Ready to move on?"
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- CTC → Form 8812 / Schedule 8812 → Form 1040 Line 19
- EITC → Schedule EIC → Form 1040 Line 27 (refundable)
- AOTC → Form 8863 → Form 1040 Line 29 (partially refundable: 40%)
- LLC → Form 8863 → Schedule 3 Line 2 (non-refundable)
- Dependent Care → Form 2441 → Schedule 3 Line 2
- Saver's Credit → Form 8880 → Schedule 3 Line 4
- Clean Energy → Form 5695 Part I → Schedule 3 Line 5
- Energy Efficiency → Form 5695 Part II → Schedule 3 Line 5
- EV Credit → Form 8936 → Schedule 3 Line 6f
- PTC → Form 8962 → Form 1040 Line 29 (refundable)
- Foreign Tax Credit → Form 1116 → Schedule 3 Line 1

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| Student claimed as dependent by another filer | Parent claims education credit, not the student. "Since you're claimed as a dependent, your parent would claim the education credit." | Wrong person claiming |
| AOTC and LLC for same student in same year | Can't claim both. AOTC is usually better. "You can only use one education credit per student per year." | Double credit |
| Dependent care paid to a relative | Allowed if the relative isn't the filer's dependent or under 19. Ask relationship. | Disallowed provider |
| EV purchased in prior year, not yet claimed | "The EV credit is claimed in the year you take delivery, not the year you ordered." | Wrong tax year |
| EITC with investment income >$11,600 | Disqualifies from EITC. "Investment income above $11,600 disqualifies you from the EITC." | Invalid claim |
| PTC advance overpayment | If advance PTC exceeded actual PTC, user owes the difference. "You may need to repay some of the advance premium tax credit." | Unexpected tax bill |
| High-income filer asks about CTC | Phase-out: $200K single, $400K MFJ. "Your credit is reduced by $50 for every $1,000 of income above the threshold." | Expecting full credit when phased out |
| User mentions "earned income credit" but is MFS | MFS filers are NOT eligible for EITC. "Unfortunately, the EITC is not available when filing married filing separately." | Invalid claim |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Education credit details (student, institution, tuition, scholarships) must match user input. Care provider and amounts must be correct. Energy/EV details must be captured accurately.
- **Completeness**: Must evaluate all contextually relevant credits. Must auto-detect CTC and EITC from existing data. Must ask about education, dependent care, energy, and PTC when applicable.
- **No Tax Harm**: Primary risks are (1) claiming AOTC and LLC for same student, (2) claiming EITC when MFS, (3) wrong person claiming education credit, (4) not flagging EITC investment income limit, (5) missing PTC repayment obligation, (6) dependent care paid to disqualified relative.
