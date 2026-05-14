# Skill: income-property
## Domain: Property Income (Rental / Home Sale / Royalties)

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `income` AND this skill is not yet completed or skipped
- Position: fifth skill in the income phase (order: 5)
- Prerequisites: `income-wages` completed or skipped
- Relevance: `incomeDiscovery.rental === 'yes' OR incomeDiscovery.home_sale === 'yes' OR rentalProperties.length > 0 OR homeSale !== undefined`

### User Intent (on-demand)
- "I have a rental property" / "I'm a landlord"
- "I sold my house" / "home sale"
- "Rental income" / "rental expenses"
- "Schedule E" / "royalty income"
- "I rented a room in my house"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.rentalProperties` | `RentalProperty[]` | Existing rentals |
| `taxReturn.royaltyProperties` | `RoyaltyProperty[]?` | Existing royalties |
| `taxReturn.homeSale` | `HomeSaleInfo?` | Existing home sale data |
| `taxReturn.incomeDiscovery` | `Record<string, string>` | Check discovery state |
| `taxReturn.filingStatus` | `FilingStatus?` | Exclusion limits differ |
| `taxReturn.addressState` | `string?` | State context for rental |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.rentalProperties[]` | `RentalProperty` | `update_field` (via rentalProperties path) |
| `taxReturn.homeSale` | `HomeSaleInfo` | `update_field` (via homeSale path) |
| `taxReturn.royaltyProperties[]` | `RoyaltyProperty` | `update_field` (via royaltyProperties path) |
| `taxReturn.incomeDiscovery[*]` | `'yes' \| 'no'` | `set_income_discovery` |

### Discovery Keys
| Key | Sets to | When |
|-----|---------|------|
| `rental` | `yes` / `no` | User has rental property income |
| `home_sale` | `yes` / `no` | User sold their primary residence or other real estate |
| `royalty` | `yes` / `no` | User receives royalties |

### Allowed Actions
- `update_field` — set rental, home sale, or royalty data
- `set_income_discovery` — set property discovery flags
- `remove_item` — remove an incorrect entry
- `navigate` — navigate to property income steps
- `no_action` — informational response

### Forbidden
- Must not enter 1099-MISC rents here (those come from `income-freelance` routing)
- Must not enter business property sales (Form 4797 is separate)
- Must not calculate depreciation (engine handles it)
- Must not provide real estate investment advice

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] User asked about rental properties
- [ ] User asked about home sales
- [ ] User asked about royalties (if contextually relevant)
- [ ] All relevant entries created or user declined each
- [ ] All discovery keys set
- [ ] OR: user says "no property income"
- [ ] OR: user explicitly says "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check existing state:
   - If properties already entered: "I see you have {count} property
     income item(s). Do you need to add more or make changes?"
   - Otherwise: "Did you have any income from property this year? This
     includes rental income, selling a home, or receiving royalties."

2. If user says no → set all discovery keys to `no`, mark complete.

### Rental Property Flow

3. "Let's set up your rental property. What's the property address?"
4. "What type of property is it?" (Single family, multi-unit, condo, etc.)
5. "How many days was it rented during the year?"
6. "How many days did you use it personally?" (affects deduction limits)
7. "What was the total rent collected?"
8. "Now let's capture expenses. For each, give me the annual total:
   - Mortgage interest
   - Property taxes
   - Insurance
   - Repairs and maintenance
   - Property management fees
   - Utilities (if you pay them)
   - Any other expenses?"
9. "What was the property's cost basis and the date you placed it in service?
   (For depreciation — the engine will calculate the annual amount.)"
10. Confirm → emit `update_field` for rental property

11. "Do you have another rental property?"
    - If yes → loop

### Home Sale Flow

12. "Did you sell your primary residence or any other real estate this year?"
    - If no → skip
    - If yes: "Was this your primary home that you lived in for at least
      2 of the last 5 years?"

13. "What was the selling price?"
14. "What was your cost basis? (Usually purchase price plus improvements.)"
15. "How long did you own it and how long did you live in it?"

16. If primary home with 2+ years ownership/residency:
    "You may qualify for the Section 121 exclusion — up to $250,000 of
    gain excluded ($500,000 if married filing jointly). Based on what
    you've told me, your gain is approximately ${gain}."

17. Confirm → emit `update_field` for homeSale

### Royalty Flow

18. "Do you receive any royalties — from oil/gas, patents, books, music, etc.?"
    - If yes: "What's the source and how much did you receive?"
    - "Any related expenses (depletion, production costs)?"
    - Confirm → emit `update_field` for royaltyProperties

### Exit

19. "Here's your property income summary:
    {rental properties with net income}
    {home sale gain/exclusion}
    {royalty income}

    Ready to move on?"
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `rentalProperties[]` → Schedule E Part I → Form 1040 Line 5 (via Schedule 1)
- Rental losses limited to $25,000 for AGI ≤ $100,000 (phases out to $150,000)
- `rentalProperties[].personalUseDays` > 14 days or >10% of rental days →
  vacation home rules (limits deductions)
- Depreciation: straight-line over 27.5 years (residential)
- `homeSale` → Schedule D / Form 8949 (if gain exceeds exclusion)
- Section 121 exclusion: $250,000 (single) / $500,000 (MFJ) if owned+lived 2 of 5 years
- `royaltyProperties[]` → Schedule E Part I
- Passive activity loss rules (Form 8582) may limit rental losses

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| Rental used personally >14 days | Vacation home rules apply — deductions limited to rental income portion. Flag: "Since you used this property personally for more than 14 days, special rules limit your deductions." | Overstated rental losses |
| Home sold at a loss | Primary residence loss is NOT deductible. "Unfortunately, losses on the sale of your personal residence aren't tax-deductible." | Claiming non-deductible loss |
| Lived in home <2 years | Partial exclusion may apply if due to health, job, or unforeseen circumstances. Ask: "Why did you sell before the 2-year mark?" | Missing partial exclusion |
| Rental property converted from personal home | Cost basis for depreciation is the LESSER of FMV at conversion or adjusted basis. "When did you convert it, and what was the value then?" | Wrong depreciation basis |
| Short-term rental (Airbnb <7-day average) | May not be passive — treated as active business income. Different loss rules apply. | Wrong passive/active classification |
| Real estate professional | If qualifying: not subject to passive loss limitations. "Do you spend more than 750 hours and more than half your working time in real estate?" | Missed loss deduction |
| Net Investment Income Tax on rental | Rental income generally subject to 3.8% NIIT unless RE professional. Don't calculate — note for context. | Missing tax context |
| Co-owned property | "What's your ownership percentage? You only report your share of income and expenses." | Overstated income/expenses |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Rental income, expenses, and property details must match user input. Home sale basis and proceeds must be correct. Personal use days must be captured accurately.
- **Completeness**: Must ask about rental, home sale, and royalties. Must capture personal use days for rental. Must ask about ownership/residency duration for home sale.
- **No Tax Harm**: Primary risks are (1) not flagging vacation home rules, (2) allowing deduction of personal residence loss, (3) not asking about Section 121 eligibility, (4) ignoring passive activity loss limits, (5) wrong depreciation basis for converted property.
