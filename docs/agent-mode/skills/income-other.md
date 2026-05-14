# Skill: income-other
## Domain: Other Income (HSA Distributions, 529, Gambling, Cancellation of Debt, Alimony, Other)

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `income` AND this skill is not yet completed or skipped
- Position: sixth skill in the income phase (order: 6)
- Prerequisites: `income-wages` completed or skipped

### User Intent (on-demand)
- "I won a prize" / "I won the lottery" / "gambling winnings"
- "I got a 1099-SA" / "HSA distribution"
- "529 distribution" / "1099-Q"
- "Canceled debt" / "1099-C" / "forgiven loan"
- "I receive alimony" / "alimony received"
- "Jury duty pay" / "hobby income"
- "I sold something" / "Other income"
- "W-2G" / "casino winnings"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.income1099SA` | `Income1099SA[]` | Existing HSA distributions |
| `taxReturn.income1099Q` | `Income1099Q[]` | Existing 529 distributions |
| `taxReturn.incomeW2G` | `IncomeW2G[]` | Existing gambling income |
| `taxReturn.income1099C` | `Income1099C[]` | Existing COD income |
| `taxReturn.alimonyReceived` | `AlimonyReceivedInfo?` | Existing alimony received |
| `taxReturn.otherIncome` | `number` | Catch-all other income |
| `taxReturn.incomeDiscovery` | `Record<string, string>` | Check discovery state |
| `taxReturn.filingStatus` | `FilingStatus?` | Alimony context |
| `taxReturn.hsaContribution` | `HSAContributionInfo?` | HSA context for 1099-SA |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.income1099SA[]` | `Income1099SA` | `add_income` (incomeType: `1099sa`) |
| `taxReturn.income1099Q[]` | `Income1099Q` | `add_income` (incomeType: `1099q`) |
| `taxReturn.incomeW2G[]` | `IncomeW2G` | `add_income` (incomeType: `w2g`) |
| `taxReturn.income1099C[]` | `Income1099C` | `add_income` (incomeType: `1099c`) |
| `taxReturn.alimonyReceived` | `AlimonyReceivedInfo` | `update_field` |
| `taxReturn.otherIncome` | `number` | `update_field` |
| `taxReturn.incomeDiscovery[*]` | `'yes' \| 'no'` | `set_income_discovery` |

### Discovery Keys
| Key | Sets to | When |
|-----|---------|------|
| `1099sa` | `yes` / `no` | HSA distributions |
| `1099q` | `yes` / `no` | 529 plan distributions |
| `w2g` | `yes` / `no` | Gambling winnings |
| `1099c` | `yes` / `no` | Cancellation of debt |
| `alimony_received` | `yes` / `no` | Alimony received (pre-2019 agreements) |

### Allowed Actions
- `add_income` (incomeType: `1099sa`, `1099q`, `w2g`, `1099c`)
- `set_income_discovery` — set discovery flags
- `update_field` — alimony received, other income
- `remove_item` — remove an incorrect entry
- `navigate` — navigate to other income steps
- `no_action` — informational response

### Forbidden
- Must not enter W-2, 1099-NEC/K, investment, or retirement income (other skills)
- Must not modify deductions or credits
- Must not determine COD exclusion eligibility (complex — the engine handles Form 982)
- Must not provide gambling strategy or COD legal advice

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] User asked about remaining income categories (HSA, 529, gambling, COD, alimony, other)
- [ ] All relevant forms entered or user declined each
- [ ] All discovery keys set
- [ ] OR: user says "no other income"
- [ ] OR: user explicitly says "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. "Let's make sure we've captured all your income. I'll go through a few
   remaining categories."

### HSA Distributions (1099-SA)

2. "Did you take any distributions from a Health Savings Account (HSA)?"
   - If yes: "Was the distribution used for qualified medical expenses?"
     - If qualified → generally not taxable, still needs reporting
     - If not qualified → taxable + 20% penalty if under 65
   - Capture: payer, gross distribution, earnings, distribution code
   - Confirm → emit `add_income(1099sa)`

### 529 Distributions (1099-Q)

3. "Did you receive distributions from a 529 education savings plan?"
   - If yes: "Were the funds used for qualified education expenses (tuition,
     room and board, books, required equipment)?"
     - If all qualified → generally not taxable
     - If partially qualified → need to determine taxable portion
   - Capture: payer, gross distribution, earnings, basis
   - Confirm → emit `add_income(1099q)`

### Gambling Income (W-2G)

4. "Did you have any gambling winnings this year? This includes casinos,
   lottery, horse racing, sports betting, etc."
   - If yes: "What's the payer name and amount?"
   - "Was any federal tax withheld?"
   - Note: "You can deduct gambling losses up to the amount of winnings
     if you itemize — we'll cover that in the deductions section."
   - Confirm → emit `add_income(w2g)`

### Cancellation of Debt (1099-C)

5. "Did you have any debt forgiven or canceled? You'd have a 1099-C."
   - If yes: "What's the lender name and the amount canceled?"
   - "Were you insolvent at the time (your debts exceeded your assets)?
     If so, some or all of the canceled debt may be excludable."
   - "Was this related to qualified principal residence indebtedness?"
   - Note: "The exclusion rules are complex — we'll flag this for review."
   - Confirm → emit `add_income(1099c)`

### Alimony Received

6. "Do you receive alimony under a divorce or separation agreement
   executed before 2019?"
   - If yes: "How much did you receive? Alimony from pre-2019 agreements
     is taxable income."
   - If agreement is 2019 or later: "Alimony from agreements executed
     in 2019 or later is NOT taxable to the recipient."
   - Confirm → emit `update_field`

### Catch-All Other Income

7. "Any other income we haven't covered? Common examples include:
   - Jury duty pay
   - Prizes or awards
   - Hobby income (not run as a business)
   - Bartering income
   - Found property or treasure trove
   - Income from personal property rentals (like renting your car)"
   - If yes → capture amount and description → `update_field(otherIncome)`

### Exit

8. "Here's your other income:
   {list by category with taxability notes}

   That wraps up the income section. {If SE discovered: 'Next, we'll
   set up your business expenses.'} {Otherwise: 'Next, let's look at
   deductions.'}"
   → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `income1099SA` → Form 8889 Part II; if non-qualified: taxable + 20% penalty (Form 5329)
- `income1099Q` → Form 5329 / Schedule 1 if earnings are taxable
- `incomeW2G[]` → Schedule 1 Line 8b → Form 1040 Line 8
- Gambling losses (itemized, up to winnings) → Schedule A Line 16
- `income1099C` → Schedule 1 Line 8z (unless excludable via Form 982)
- COD exclusions: insolvency, qualified principal residence, bankruptcy, farm debt
- `alimonyReceived` → Schedule 1 Line 2a (pre-2019 agreements only)
- `otherIncome` → Schedule 1 Line 8z → Form 1040 Line 8

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| HSA distribution for cosmetic surgery | Not a qualified medical expense. "Cosmetic procedures generally don't qualify. This distribution would be taxable plus the 20% penalty." | Undertaxed non-qualified distribution |
| 529 used for K-12 tuition | Up to $10,000/year qualifies for K-12. "529 funds can be used for K-12 tuition up to $10,000 per year per beneficiary." | Missing valid exclusion |
| Gambling winnings without W-2G | Still taxable. "Even without a W-2G, all gambling winnings must be reported." | Unreported income |
| Student loan forgiven under PSLF | May be excludable depending on timing and program. "Student loan forgiveness under certain programs may be tax-free." | Taxing excludable income |
| COD from mortgage modification | May qualify for qualified principal residence exclusion. Ask about it. | Missing exclusion |
| Alimony under modified agreement | "Was the original agreement before 2019? Modifications don't change the effective date unless the modification specifically says so." | Wrong taxability |
| Cryptocurrency airdrop or staking rewards | This is income (fair market value at receipt). Route to investments skill if not captured. | Unreported income |
| Bartering | Fair market value of goods/services received is income. "If you traded services or goods, the FMV of what you received is taxable." | Unreported income |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Amounts and form types must match user input. HSA distribution qualification must be correctly flagged. 529 qualification must be correctly assessed.
- **Completeness**: Must ask about all categories: HSA, 529, gambling, COD, alimony, and catch-all. Must capture distribution codes and qualification details.
- **No Tax Harm**: Primary risks are (1) not flagging non-qualified HSA distributions (20% penalty), (2) not reporting gambling winnings without W-2G, (3) taxing excludable COD income, (4) wrong alimony taxability (pre vs post-2019), (5) missing the 529 K-12 tuition limit.
