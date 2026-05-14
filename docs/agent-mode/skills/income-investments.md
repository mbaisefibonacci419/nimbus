# Skill: income-investments
## Domain: Investment Income (1099-B / 1099-DIV / 1099-INT / 1099-DA / K-1)

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `income` AND this skill is not yet completed or skipped
- Position: third skill in the income phase (order: 3)
- Prerequisites: `income-wages` completed or skipped

### User Intent (on-demand)
- "I sold stocks" / "I have capital gains"
- "Dividends" / "interest income" / "1099-DIV" / "1099-INT" / "1099-B"
- "I have a brokerage account"
- "I traded crypto" / "1099-DA" / "digital assets"
- "K-1" / "partnership" / "S-Corp"
- "My bank paid me interest"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.income1099B` | `Income1099B[]` | See what's already entered |
| `taxReturn.income1099DIV` | `Income1099DIV[]` | See what's already entered |
| `taxReturn.income1099INT` | `Income1099INT[]` | See what's already entered |
| `taxReturn.income1099DA` | `Income1099DA[]` | See what's already entered |
| `taxReturn.incomeK1` | `IncomeK1[]` | See what's already entered |
| `taxReturn.income1099OID` | `Income1099OID[]?` | OID income |
| `taxReturn.capitalLossCarryforwardST` | `number?` | Prior year carryforward |
| `taxReturn.capitalLossCarryforwardLT` | `number?` | Prior year carryforward |
| `taxReturn.incomeDiscovery` | `Record<string, string>` | Check discovery state |
| `taxReturn.filingStatus` | `FilingStatus?` | Phase-out thresholds |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.income1099B[]` | `Income1099B` | `add_income` (incomeType: `1099b`) |
| `taxReturn.income1099DIV[]` | `Income1099DIV` | `add_income` (incomeType: `1099div`) |
| `taxReturn.income1099INT[]` | `Income1099INT` | `add_income` (incomeType: `1099int`) |
| `taxReturn.income1099DA[]` | `Income1099DA` | `add_income` (incomeType: `1099da`) |
| `taxReturn.incomeK1[]` | `IncomeK1` | `add_income` (incomeType: `k1`) |
| `taxReturn.income1099OID[]` | `Income1099OID` | `add_income` (incomeType: `1099oid`) |
| `taxReturn.capitalLossCarryforwardST` | `number` | `update_field` |
| `taxReturn.capitalLossCarryforwardLT` | `number` | `update_field` |
| `taxReturn.incomeDiscovery[*]` | `'yes' \| 'no'` | `set_income_discovery` |

### Discovery Keys
| Key | Sets to | When |
|-----|---------|------|
| `1099b` | `yes` / `no` | Capital gains/losses from stock sales |
| `1099div` | `yes` / `no` | Dividend income |
| `1099int` | `yes` / `no` | Interest income |
| `1099da` | `yes` / `no` | Digital asset transactions |
| `k1` | `yes` / `no` | Partnership/S-Corp/trust K-1 income |

### Allowed Actions
- `add_income` (incomeType: `1099b`, `1099div`, `1099int`, `1099da`, `k1`, `1099oid`)
- `set_income_discovery` — set investment discovery flags
- `update_field` — capital loss carryforward amounts
- `remove_item` — remove an incorrect entry
- `navigate` — navigate to investment income steps
- `no_action` — informational response

### Forbidden
- Must not compute capital gains tax rates (the engine does that)
- Must not enter rental/real estate income (that's `income-property`)
- Must not modify SE income, deductions, or credits
- Must not provide investment advice

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] User asked about each investment income category (stocks, dividends, interest, crypto, K-1)
- [ ] All relevant forms entered or user declined each category
- [ ] All relevant discovery keys set
- [ ] Capital loss carryforward asked about if user had prior year losses
- [ ] OR: user said "no investment income"
- [ ] OR: user explicitly says "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check existing state and tailor:
   - If investment income already entered: "I see you have {count} investment
     form(s). Do you have more to add?"
   - Otherwise: "Let's talk about investment income. Did you have any of the
     following this year? Bank interest, dividends, stock/crypto sales, or
     income from a partnership or S-Corp (K-1)?"

2. If user says no to everything → set all discovery keys to `no`, mark complete.

### Interest Income (1099-INT)

3. "Did you earn any interest — from bank accounts, CDs, bonds, or other
   sources?"
   - If yes: "What's the payer name (usually your bank)?"
   - "What's the interest amount in Box 1?"
   - "Was any federal tax withheld?"
   - "Any tax-exempt interest (like municipal bonds)? That's Box 8."
   - Confirm → emit `add_income(1099int)`
   - "Any more interest forms?" Loop if yes.

### Dividend Income (1099-DIV)

4. "Did you receive any dividends — from stocks, mutual funds, or ETFs?"
   - If yes: "What's the payer name?"
   - "What's the total ordinary dividends (Box 1a)?"
   - "How much of that is qualified dividends (Box 1b)?" (taxed at lower rate)
   - "Any capital gain distributions (Box 2a)?"
   - "Any foreign tax paid (Box 7)?" — for Foreign Tax Credit
   - Confirm → emit `add_income(1099div)`
   - "Any more dividend forms?" Loop if yes.

### Capital Gains/Losses (1099-B)

5. "Did you sell any stocks, bonds, mutual funds, or other securities?"
   - If yes: "How many transactions? If you have a lot, you can enter them
     as summary totals (short-term vs long-term) rather than individually."
   - For each entry or summary: broker name, description, date acquired,
     date sold, proceeds, cost basis, gain/loss type (ST/LT)
   - "Was cost basis reported to the IRS?" (Box 12 — determines if Schedule D
     goes to Part I or Part II)
   - Confirm → emit `add_income(1099b)`

6. "Do you have a capital loss carryforward from prior years? This would be
   on your prior year Schedule D or tax software summary."
   - If yes: capture ST and LT carryforward amounts → `update_field`

### Digital Assets (1099-DA)

7. "Did you sell, trade, or exchange any cryptocurrency or digital assets?"
   - If yes: similar to 1099-B flow — exchange name, asset, dates, proceeds, cost basis
   - Confirm → emit `add_income(1099da)`

### K-1 (Partnerships / S-Corps / Trusts)

8. "Did you receive a Schedule K-1 from a partnership, S-Corp, or trust?"
   - If yes: "What entity issued it?"
   - Walk through key boxes: ordinary business income, rental income,
     interest, dividends, capital gains, other income, Section 179, credits
   - K-1s are complex — capture main income lines and flag for review
   - Confirm → emit `add_income(k1)`

### Exit

9. "Here's your investment income summary:
   - Interest: ${totalInterest}
   - Dividends: ${totalDividends} ({qualifiedPct}% qualified)
   - Capital gains/losses: ${netCapGain}
   {if crypto: '- Digital assets: ${cryptoTotal}'}
   {if k1: '- K-1 income: ${k1Total}'}

   Ready to move on?"
   → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `income1099INT[].amount` → Schedule B Part I → Form 1040 Line 2b
- `income1099INT[].taxExemptInterest` → Form 1040 Line 2a
- `income1099DIV[].ordinaryDividends` → Schedule B Part II → Form 1040 Line 3b
- `income1099DIV[].qualifiedDividends` → Form 1040 Line 3a (lower tax rate)
- `income1099DIV[].foreignTaxPaid` → may generate Foreign Tax Credit
- `income1099B[]` → Schedule D → Form 1040 Line 7 (capital gain/loss)
- Net capital loss limited to $3,000 deduction ($1,500 MFS) per year
- Long-term capital gains taxed at 0%, 15%, or 20% based on income
- `income1099DA[]` → same treatment as 1099-B (Schedule D)
- `incomeK1[]` → various schedules depending on income type
- Capital loss carryforward → Schedule D Line 6 (ST) / Line 14 (LT)

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| User has hundreds of stock trades | Offer summary entry: "You can enter ST and LT totals from your broker's summary. You don't need to list every trade." | Impractical individual entry |
| Wash sale adjustments | If user mentions wash sales: "Your broker may have adjusted the cost basis on your 1099-B. Use the adjusted basis from the form." | Incorrect gain calculation |
| Crypto-to-crypto trades | Each trade is a taxable event. "Trading one crypto for another is a taxable sale — the gain or loss is based on your cost basis." | Unreported taxable event |
| K-1 with negative ordinary income | Passive loss rules may limit deductibility. Note: "Losses from passive activities may be limited. The engine will calculate any limitations." | Overstated deduction |
| User says "I got dividends" but means interest | Clarify: "Did you receive a 1099-DIV or 1099-INT? Dividends come from stocks/funds, interest from banks/bonds." | Wrong form type |
| Tax-exempt municipal bond interest | Still reported on the return (Line 2a) even though not taxed. Affects other calculations (SS taxability, ACA PTC) | Omission affects other calculations |
| NII surtax ($200K/$250K MFJ) | Don't calculate — just note: "Investment income above certain thresholds may be subject to the 3.8% Net Investment Income Tax." | Missing context for user |
| Inherited stock (stepped-up basis) | "For inherited assets, your cost basis is usually the fair market value on the date of death (stepped-up basis)." | Using original owner's basis = overtaxed |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Amounts, payer names, and form types must match user input. Must correctly distinguish ST vs LT capital gains. Qualified vs ordinary dividends must be captured separately.
- **Completeness**: Must ask about all five categories (interest, dividends, stocks, crypto, K-1). Must ask about capital loss carryforward. Must capture foreign tax paid for dividends.
- **No Tax Harm**: Primary risks are (1) mixing up interest and dividends, (2) not capturing cost basis for capital gains, (3) ignoring tax-exempt interest that affects other calculations, (4) not asking about capital loss carryforward, (5) classifying crypto trades as non-taxable.
