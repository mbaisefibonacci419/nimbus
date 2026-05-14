# Skill: self-employment
## Domain: Self-Employment / Schedule C

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `self_employment` AND this skill is not yet completed or skipped
- Prerequisites: `income-freelance` completed (which means 1099-NEC/K income
  has been entered or user confirmed SE income)
- Relevance: `incomeDiscovery['1099nec'] === 'yes' OR incomeDiscovery['1099k'] === 'yes' OR businesses.length > 0`

### User Intent (on-demand)
- "I'm self-employed" / "I freelance" / "I have a side hustle"
- "Business expenses" / "write-offs" / "Schedule C"
- "Home office" / "mileage" / "business miles"
- "I have a sole proprietorship" / "LLC" / "independent contractor"
- "Solo 401k" / "SEP IRA" / "self-employed retirement"
- "Cost of goods sold" / "inventory"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.businesses` | `BusinessInfo[]` | Existing business info |
| `taxReturn.business` | `BusinessInfo?` | Legacy single-business field |
| `taxReturn.expenses` | `ExpenseEntry[]` | Existing expenses |
| `taxReturn.homeOffice` | `HomeOfficeInfo?` | Existing home office data |
| `taxReturn.vehicle` | `VehicleInfo?` | Existing vehicle data |
| `taxReturn.selfEmploymentDeductions` | `SelfEmploymentDeductions?` | Retirement, health insurance |
| `taxReturn.costOfGoodsSold` | `CostOfGoodsSold?` | COGS data |
| `taxReturn.returnsAndAllowances` | `number?` | Returns/refunds |
| `taxReturn.depreciationAssets` | `DepreciationAsset[]?` | Business assets |
| `taxReturn.income1099NEC` | `Income1099NEC[]` | SE income amount for context |
| `taxReturn.income1099K` | `Income1099K[]` | Platform income for context |
| `taxReturn.filingStatus` | `FilingStatus` | Spouse business routing |
| `calculation.scheduleC` | `ScheduleCResult?` | Net profit/loss context |
| `calculation.scheduleSE` | `ScheduleSEResult?` | SE tax context |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.businesses[]` | `BusinessInfo` | `update_business` |
| `taxReturn.expenses[]` | `ExpenseEntry` | `add_business_expense` |
| `taxReturn.homeOffice` | `HomeOfficeInfo` | `update_home_office` |
| `taxReturn.vehicle` | `VehicleInfo` | `update_vehicle` |
| `taxReturn.selfEmploymentDeductions` | `SelfEmploymentDeductions` | `update_se_retirement` |
| `taxReturn.costOfGoodsSold` | `CostOfGoodsSold` | `update_field` (via `costOfGoodsSold` path) |

### Discovery Keys
None — this skill is triggered by income-phase discovery, not its own keys.

### Allowed Actions
- `update_business` — create or update business info (name, NAICS, accounting method)
- `add_business_expense` — add an expense entry by category
- `update_home_office` — set home office deduction (simplified or actual)
- `update_vehicle` — set vehicle/mileage deduction
- `update_se_retirement` — set Solo 401k, SEP IRA, health insurance
- `remove_item` (itemType: `expenses`) — remove an incorrect expense
- `navigate` — navigate to SE wizard steps
- `no_action` — informational response

### Forbidden
- Must not modify income amounts (1099-NEC/K already entered in income phase)
- Must not modify deductions outside the SE domain (no itemized, no HSA as
  above-the-line — the SE health insurance deduction is separate)
- Must not provide specific NAICS code recommendations — ask user to describe
  their business and suggest they look up codes if needed
- Must not calculate SE tax — the engine does that

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] `businesses.length >= 1` (business info created)
- [ ] User has been asked about expenses, home office, vehicle, and retirement
- [ ] Each sub-domain is either populated or user said "no" / "not applicable"
- [ ] OR: user says "skip" / "I'll fill in expenses later"

<!-- ────────────────────────────────────── -->
## Interview Flow

This is the most complex skill. It covers five sub-domains in sequence:
**Business Info → Expenses → Home Office → Vehicle → Retirement/Health Insurance**.
Each sub-domain is a mini-interview that can be completed or skipped independently.

### Entry

1. Check existing state:
   - If `businesses.length > 0` and `expenses.length > 0`:
     "I see you already have {businessName} set up with {count} expenses.
     Want to review what's there, add more expenses, or move on to home
     office and vehicle deductions?"
   - If `businesses.length > 0` but no expenses:
     "You have {businessName} set up. Let's add your business expenses —
     that's where the real tax savings come from."
   - Otherwise:
     "Let's set up your self-employment info. This covers your business
     details, expenses, and some valuable deductions."

### Sub-Domain 1: Business Info

2. "What's the name of your business? If you operate as a sole proprietor
   under your own name, just say 'sole proprietor' or your name."

3. "What does your business do? A brief description is fine — for example,
   'freelance software development' or 'photography services'."
   - Use the description to suggest a NAICS code area, but ask user to
     confirm: "That sounds like it might fall under NAICS 541511
     (Custom Computer Programming). Does that sound right, or would you
     like to look up the exact code?"

4. "Do you use cash or accrual accounting? Most freelancers and sole
   proprietors use **cash basis** (you report income when received and
   expenses when paid)."

5. "Did you start this business this year, or has it been running?"

   → Emit `update_business` with collected fields.

### Sub-Domain 2: Expenses

6. "Now let's capture your business expenses. I'll go through the main
   categories. For each one, tell me the approximate total you spent
   during the year, or say 'none' to skip."

7. Walk through expense categories contextually. Start with the most common,
   skip categories that are clearly irrelevant:

   **Always ask:**
   a. "Office expenses — supplies, software subscriptions, tools?"
   b. "Internet and phone — the business-use portion?"
   c. "Professional services — accounting, legal, tax prep?"

   **Ask if relevant:**
   d. "Advertising or marketing expenses?" (if B2C business)
   e. "Contract labor or subcontractors?" (if freelancer/agency)
   f. "Insurance — business liability, E&O?"
   g. "Travel — flights, hotels for business trips?"
   h. "Meals — business meals with clients? (50% deductible)"
   i. "Rent — office space or coworking?"

   **Ask at end as catch-all:**
   j. "Any other business expenses I haven't mentioned?"

8. For each category where user provides an amount:
   → Emit `add_business_expense` with category and amount

9. After expenses: "Here's what I have so far:
   {list of expenses by category with amounts}
   **Total expenses: ${sum}**
   Anything to add or correct?"

### Sub-Domain 3: Home Office

10. "Do you use part of your home regularly and exclusively for business?"
    - If no → skip, note in summary
    - If yes → continue

11. "There are two methods:
    - **Simplified**: $5 per square foot, up to 300 sq ft ($1,500 max).
      Easy, no recordkeeping.
    - **Actual**: Calculate actual costs (mortgage interest, insurance,
      utilities, etc.) based on the percentage of your home used for business.
      More work, but often a larger deduction.

    Which would you prefer?"

12. If **simplified**:
    "How many square feet is your office space?"
    → Emit `update_home_office({ method: 'simplified', squareFeet: X })`

13. If **actual**:
    "How many square feet is your office? And what's the total square
    footage of your home?"
    → Then walk through actual expense categories (mortgage interest,
    insurance, utilities, repairs, etc.)
    → Emit `update_home_office({ method: 'actual', squareFeet: X, totalHomeSquareFeet: Y, ...expenses })`

### Sub-Domain 4: Vehicle

14. "Did you use a vehicle for business purposes this year?"
    - If no → skip
    - If yes → continue

15. "Two methods here too:
    - **Standard mileage**: $0.70 per business mile for 2025. Just track
      your miles.
    - **Actual expenses**: Gas, insurance, repairs, depreciation. Better
      if you have an expensive vehicle or high costs.

    Which do you use, or would you like help deciding?"

16. If **mileage**:
    "How many business miles did you drive? And what were your total miles
    for the year (including personal)?"
    → Emit `update_vehicle({ method: 'mileage', businessMiles: X, totalMiles: Y })`

17. If **actual**:
    Walk through: gas, insurance, repairs, depreciation, other.
    → Emit `update_vehicle({ method: 'actual', ...expenses })`

### Sub-Domain 5: SE Retirement & Health Insurance

18. "Self-employed people have some great retirement options that also
    reduce your taxes. Did you contribute to any of these?
    - **Solo 401(k)** — employee + employer contributions
    - **SEP IRA** — employer-only contributions
    - **SIMPLE IRA**"

    - If yes → ask which type and amounts
    - If no → "Something to consider for next year — these can significantly
      reduce your taxable income."

19. "Did you pay for your own health insurance premiums? Self-employed
    individuals can deduct 100% of health, dental, and long-term care
    insurance premiums."

    - If yes → get annual premium amount
    - If no → skip

20. → Emit `update_se_retirement` with all collected fields.

### Exit

21. Provide a comprehensive summary:
    "Here's your complete self-employment picture:

    **{Business Name}** ({description})

    | | |
    |---|---|
    | Gross income | ${totalIncome} |
    | Expenses | -${totalExpenses} |
    | Home office | -${homeOfficeDeduction} |
    | Vehicle | -${vehicleDeduction} |
    | **Net profit** | **${netProfit}** |

    | SE deductions | |
    |---|---|
    | Retirement | -${retirement} |
    | Health insurance | -${healthInsurance} |

    The self-employment tax on your net profit will be calculated
    automatically. Ready to move on?"

    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `businesses[0]` → Schedule C header (name, EIN, NAICS, accounting method)
- `expenses[]` → Schedule C Part II (Lines 8-27) by category
- `costOfGoodsSold` → Schedule C Part III (Lines 35-42)
- `homeOffice` → Form 8829 or simplified method → Schedule C Line 30
- `vehicle` → Form 4562 Part V / standard mileage → Schedule C Line 9 (car/truck)
- Net Schedule C profit → Schedule SE → self-employment tax (15.3% up to SS wage base, 2.9% above)
- 50% of SE tax is deductible on Schedule 1 Line 15 (above-the-line)
- `selfEmploymentDeductions.healthInsurancePremiums` → Schedule 1 Line 17
- `selfEmploymentDeductions.solo401k*` / `sepIra*` → Schedule 1 Line 16
- SE net profit feeds into QBI (Section 199A) calculation if under threshold
- High net profit can trigger estimated tax penalty if withholding is insufficient

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| User has multiple businesses | Handle first business fully, then ask "Do you have another business?" Loop if yes. | Combining businesses = incorrect Schedule C |
| User mixes personal and business expenses | Clarify: "Was that $200 phone bill entirely for business, or is that the total? I need just the business portion." | Overstated deductions = audit risk |
| User claims 100% business use of vehicle | Flag: "The IRS may scrutinize 100% business use claims. Are you sure there's zero personal use? Even commuting counts as personal." | Audit red flag |
| User's home office fails exclusive-use test | If they say "I use it for business AND personal stuff," explain: "The home office deduction requires regular and exclusive business use of the space. A desk in your bedroom that you also use for personal activities generally doesn't qualify." | Invalid deduction |
| User asks about S-Corp or LLC taxation | Explain: "Nimbus handles sole proprietorships (Schedule C). If your LLC is taxed as an S-Corp, you'd need a different filing approach. For single-member LLCs taxed as disregarded entities, Schedule C is correct." | Wrong entity type filing |
| User has 1099-K from Etsy/eBay but it's hobby income | Ask: "Do you do this as a regular business with the intent to make a profit, or is this more of a hobby? The IRS treats them differently." | Hobby income goes on Schedule 1 Line 8z, not Schedule C |
| User mentions inventory / COGS | "Do you buy and resell products? If so, we should track your cost of goods sold — that's the cost of the items you sold, not overhead." | Missing COGS → overstated profit |
| Net loss exceeds $250K ($500K MFJ) | The excess business loss limitation (EBL) may apply. Mention: "Note that business losses above $250,000 may be limited this year and carried forward." | Excess loss taken = incorrect filing |
| User says "max out Solo 401(k)" without income context | The employer contribution is limited to 20% of net SE income. Employee deferral is $23,500 (2025). Say: "The employee deferral limit is $23,500 for 2025. The employer contribution is capped at 20% of your net SE income — the engine will calculate the exact limit." | Over-contribution |
| User has both W-2 job and SE income | SE health insurance deduction is only for months NOT covered by employer plan. Ask: "Were you covered by your employer's health plan for any part of the year?" | Excess deduction |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Business name, NAICS code, accounting method, and expense amounts must match user input. Home office and vehicle methods/amounts must be correct.
- **Completeness**: Must ask about all five sub-domains (business info, expenses, home office, vehicle, retirement/health). Each can be skipped but must be asked about. At minimum: business name, at least one expense category scan, and home office/vehicle yes-or-no.
- **Relevance**: This skill handles a LOT of ground. It should stay within Schedule C and SE deductions. It must NOT wander into itemized deductions, credits, or non-SE adjustments.
- **Coherence**: The five sub-domains create a long conversation (potentially 10-20 turns). The skill must maintain a logical flow, provide mini-summaries between sub-domains, and not re-ask questions.
- **No Tax Harm**: Primary risks are (1) hobby income treated as business, (2) personal expenses claimed as business, (3) invalid home office deduction, (4) over-contributing to retirement, (5) health insurance deduction when covered by employer plan, (6) not flagging the exclusive-use requirement.
