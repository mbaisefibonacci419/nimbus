# Skill: income-freelance
## Domain: Freelance & Gig Income (1099-NEC / 1099-K / 1099-MISC)

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `income` AND this skill is not yet completed or skipped
- Position: second skill in the income phase (order: 2)
- Prerequisites: `income-wages` completed or skipped

### User Intent (on-demand)
- "I freelance" / "I have a side gig"
- "I got a 1099" / "1099-NEC" / "1099-K" / "1099-MISC"
- "I'm an independent contractor"
- "I drive for Uber" / "I sell on Etsy"
- "Someone paid me for work" / "I did consulting"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.income1099NEC` | `Income1099NEC[]` | See what's already entered |
| `taxReturn.income1099K` | `Income1099K[]` | See what's already entered |
| `taxReturn.income1099MISC` | `Income1099MISC[]` | See what's already entered |
| `taxReturn.incomeDiscovery` | `Record<string, string>` | Check discovery state |
| `taxReturn.filingStatus` | `FilingStatus?` | MFJ — spouse freelance income |
| `taxReturn.spouseFirstName` | `string?` | Personalize spouse questions |
| `taxReturn.businesses` | `BusinessInfo[]` | Link 1099s to existing businesses |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.income1099NEC[]` | `Income1099NEC` | `add_income` (incomeType: `1099nec`) |
| `taxReturn.income1099K[]` | `Income1099K` | `add_income` (incomeType: `1099k`) |
| `taxReturn.income1099MISC[]` | `Income1099MISC` | `add_income` (incomeType: `1099misc`) |
| `taxReturn.incomeDiscovery['1099nec']` | `'yes' \| 'no'` | `set_income_discovery` |
| `taxReturn.incomeDiscovery['1099k']` | `'yes' \| 'no'` | `set_income_discovery` |
| `taxReturn.incomeDiscovery['1099misc']` | `'yes' \| 'no'` | `set_income_discovery` |

### Discovery Keys
| Key | Sets to | When |
|-----|---------|------|
| `1099nec` | `yes` | User has 1099-NEC income |
| `1099nec` | `no` | User explicitly has no freelance/contract income |
| `1099k` | `yes` | User has 1099-K platform income |
| `1099k` | `no` | User has no platform/payment card income |
| `1099misc` | `yes` | User has 1099-MISC income |
| `1099misc` | `no` | User has no 1099-MISC income |

### Allowed Actions
- `add_income` (incomeType: `1099nec`, `1099k`, `1099misc`) — add income entries
- `set_income_discovery` — set discovery flags
- `remove_item` — remove an incorrect entry
- `navigate` — navigate to freelance income step
- `no_action` — informational response

### Forbidden
- Must not create business entries (that's the `self-employment` skill)
- Must not add expenses (that's the `self-employment` skill)
- Must not classify W-2 income as 1099 or vice versa
- Must not modify deductions or credits

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] User has been asked about freelance/contract work
- [ ] If yes: at least one 1099-NEC, 1099-K, or 1099-MISC entered
- [ ] User confirmed "no more freelance income"
- [ ] All relevant discovery keys set
- [ ] If MFJ: asked about spouse freelance income
- [ ] OR: user said "no freelance income"
- [ ] OR: user explicitly says "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check existing state:
   - If 1099s already entered: "I see you have {count} freelance income form(s)
     entered. Do you have more to add?"
   - Otherwise: "Did you do any freelance work, contracting, gig work, or
     receive payments through apps like Venmo, PayPal, Uber, Etsy, etc.?
     These typically come with a 1099-NEC or 1099-K."

2. If user says no → set all discovery keys to `no`, mark complete.

### Form Type Routing

3. "What kind of form did you receive?"
   - **1099-NEC** (nonemployee compensation): freelance, consulting, contract work
   - **1099-K** (payment card / third-party network): Etsy, Uber, PayPal, etc.
   - **1099-MISC** (miscellaneous): rents, royalties, prizes, other income
   - If user isn't sure: "Who paid you and what was the work? I'll figure
     out the right form type."

### 1099-NEC Flow

4. "What's the payer name on your 1099-NEC?"
5. "What's the amount in Box 1 (Nonemployee Compensation)?"
6. "Was any federal tax withheld? Check Box 4." (usually $0 for 1099-NEC)
7. "Any state tax withheld? Which state?"
8. Confirm and emit `add_income(1099nec)` + `set_income_discovery(1099nec, yes)`

### 1099-K Flow

9. "What platform or payment processor issued the 1099-K?"
10. "What's the gross amount in Box 1a?"
11. "Now — the gross amount on a 1099-K often includes refunds, returns,
    platform fees, and personal transactions. How much should we subtract
    for those?"
    - Guide user through adjustments (returns/allowances field)
12. "Was any federal tax withheld?"
13. Confirm and emit `add_income(1099k)` + `set_income_discovery(1099k, yes)`

### 1099-MISC Flow

14. "What's the payer name?"
15. Route by box:
    - Box 1 (Rents) → note this may need Schedule E later
    - Box 2 (Royalties) → note this may need Schedule E later
    - Box 3 (Other income) → prizes, awards, jury duty pay
16. "What's the amount?"
17. Confirm and emit `add_income(1099misc)` + `set_income_discovery(1099misc, yes)`

### Additional Forms

18. "Do you have any more 1099-NEC, 1099-K, or 1099-MISC forms?"
    - If yes → route to appropriate flow
    - If no → proceed

### Spouse Check (MFJ)

19. If MFJ: "Does {spouseFirstName || 'your spouse'} have any freelance or
    1099 income?"
    - If yes → loop with appropriate `isSpouse` or `businessId`

### Exit

20. Summarize: "Here's your freelance/gig income:
    {list by form type with amounts}
    **Total:** ${sum}

    Next, we'll set up your business expenses to reduce the tax on this
    income."
    → Signal completion. This triggers `self-employment` skill relevance.

<!-- ────────────────────────────────────── -->
## Engine Context

- `income1099NEC[].amount` → Schedule C Line 1 (Gross receipts)
- `income1099K[].grossAmount` minus `returnsAndAllowances` → Schedule C Line 1
- `income1099MISC.otherIncome` → Schedule 1 Line 8z (if not SE)
- `income1099MISC.rents` → Schedule E Part I
- `income1099MISC.royalties` → Schedule E Part I
- NEC/K income triggers Schedule SE → 15.3% self-employment tax
- Setting `1099nec` or `1099k` discovery to `yes` makes `self-employment`
  skill relevant in the next phase
- Federal withholding from any 1099 → Form 1040 Line 25b

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| User says "I got paid $5,000 for consulting" with no form | Ask: "Did you receive a 1099-NEC for this? If the payer didn't send one, you still need to report it." Enter as 1099-NEC | Unreported income |
| 1099-K includes personal transactions (Venmo) | Ask: "Does this include personal payments like splitting rent or Venmo from friends? Only business transactions should be reported." Subtract personal portion | Overstated income |
| User has both 1099-NEC and 1099-K from same business | Both go on the same Schedule C. Flag: "These likely relate to the same business — we'll combine them in the business setup." | Double-counting |
| 1099-MISC Box 1 (Rents) | This is rental income, not SE income. Route to `income-property` skill awareness | Wrong schedule |
| User under 1099-K threshold but has income | "Even if you didn't receive a 1099-K, income from platforms is still taxable. Let's report it." | Unreported income |
| Hobby income vs business income | "Do you do this regularly with the intent to make a profit? The IRS treats hobbies differently from businesses." Hobby → Schedule 1 Line 8z, not Schedule C | Wrong tax treatment |
| User says "I made money on Etsy" without a form | Enter as 1099-K if they can estimate the amount. "Even without a 1099, this income is taxable." | Unreported income |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Payer names, amounts, and form types must match user input. 1099-K adjustments (returns/allowances) must be correctly captured.
- **Completeness**: Must route to the correct form type (NEC vs K vs MISC). Must ask about all three forms. Must handle spouse freelance income for MFJ.
- **No Tax Harm**: Primary risks are (1) misclassifying W-2 income as 1099, (2) not reporting income without a form, (3) not adjusting 1099-K for personal transactions, (4) treating hobby income as SE, (5) routing rental income to Schedule C instead of Schedule E.
