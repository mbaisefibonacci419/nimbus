# Skill: income-retirement
## Domain: Retirement & Social Security Income (1099-R / SSA-1099 / 1099-G)

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `income` AND this skill is not yet completed or skipped
- Position: fourth skill in the income phase (order: 4)
- Prerequisites: `income-wages` completed or skipped

### User Intent (on-demand)
- "I have a pension" / "I took a distribution"
- "I withdrew from my IRA" / "Roth conversion"
- "Social Security" / "SSA-1099"
- "1099-R" / "retirement income"
- "I rolled over my 401(k)"
- "I got unemployment" / "1099-G"
- "Qualified Charitable Distribution"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.income1099R` | `Income1099R[]` | See what's already entered |
| `taxReturn.incomeSSA1099` | `IncomeSSA1099?` | See if SS already entered |
| `taxReturn.income1099G` | `Income1099G[]` | Unemployment income |
| `taxReturn.incomeDiscovery` | `Record<string, string>` | Check discovery state |
| `taxReturn.filingStatus` | `FilingStatus?` | SS taxability thresholds differ by status |
| `taxReturn.livedApartFromSpouse` | `boolean?` | MFS SS threshold change |
| `taxReturn.dateOfBirth` | `string?` | Age 59½ for early distribution penalty |
| `taxReturn.spouseDateOfBirth` | `string?` | Spouse age for spouse 1099-R |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.income1099R[]` | `Income1099R` | `add_income` (incomeType: `1099r`) |
| `taxReturn.incomeSSA1099` | `IncomeSSA1099` | `add_income` (incomeType: `ssa1099`) |
| `taxReturn.income1099G[]` | `Income1099G` | `add_income` (incomeType: `1099g`) |
| `taxReturn.incomeDiscovery[*]` | `'yes' \| 'no'` | `set_income_discovery` |

### Discovery Keys
| Key | Sets to | When |
|-----|---------|------|
| `1099r` | `yes` / `no` | Pension/IRA/401k distributions |
| `ssa1099` | `yes` / `no` | Social Security benefits |
| `1099g` | `yes` / `no` | Unemployment compensation |

### Allowed Actions
- `add_income` (incomeType: `1099r`, `ssa1099`, `1099g`) — add retirement income
- `set_income_discovery` — set discovery flags
- `remove_item` — remove an incorrect entry
- `navigate` — navigate to retirement income steps
- `no_action` — informational response

### Forbidden
- Must not calculate SS taxable amount (the engine does that)
- Must not calculate early distribution penalty (the engine does that)
- Must not provide guidance on whether to do a Roth conversion
- Must not modify SE income, deductions, or credits

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] User asked about 1099-R distributions
- [ ] User asked about Social Security
- [ ] User asked about unemployment (1099-G)
- [ ] All relevant forms entered or user declined each category
- [ ] All discovery keys set
- [ ] OR: user said "no retirement income"
- [ ] OR: user explicitly says "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check existing state:
   - If retirement income already entered: "I see you have {count} retirement
     income form(s). Do you have more to add?"
   - Otherwise: "Did you receive any retirement income this year? This includes
     pension payments, 401(k) or IRA withdrawals, Social Security benefits,
     or unemployment compensation."

2. If user says no to everything → set all discovery keys to `no`, mark complete.

### 1099-R Flow (Pensions, IRAs, 401k)

3. "Did you receive any distributions from a retirement account — 401(k), IRA,
   pension, or annuity? You'd have a 1099-R."
   - If yes → continue; if no → set `1099r` to `no`, skip to SS

4. "What's the payer name on your 1099-R?"
5. "What's the gross distribution amount (Box 1)?"
6. "What's the taxable amount (Box 2a)? If it says 'unknown' or is blank,
   let me know."
   - If unknown → ask about simplified method or Roth basis
7. "What's the distribution code in Box 7?" Interpret for user:
   - Code 1: Early distribution (under 59½) — possible 10% penalty
   - Code 2: Early, exception applies
   - Code 7: Normal distribution (59½+)
   - Code G: Rollover — generally not taxable
   - Code Q/T: Roth distribution
8. "Is this an IRA distribution? Check Box 7 — there's an IRA/SEP/SIMPLE checkbox."
9. "Was any federal tax withheld (Box 4)?"
10. If early distribution (code 1): "You may owe a 10% early withdrawal penalty
    unless an exception applies. Do you qualify for any exception? Common ones
    include: medical expenses exceeding 7.5% of AGI, disability, first-time
    home purchase (IRA only, up to $10,000), or SECURE 2.0 emergency distributions."
11. If Roth: "What was your total Roth contribution basis? This is the amount
    you originally contributed (not earnings) and is tax-free when withdrawn."
12. Confirm → emit `add_income(1099r)`

### SSA-1099 Flow

13. "Did you receive Social Security benefits?"
    - If yes: "What's the total benefits amount from Box 5 of your SSA-1099?"
    - "Was any federal tax withheld (Box 6)?"
    - Note: "The taxable portion depends on your total income — the engine
      will calculate how much of your Social Security is taxable (0%, 50%,
      or up to 85%)."
    - Confirm → emit `add_income(ssa1099)`

14. If user mentions QCD: "How much was distributed directly to charity as a
    Qualified Charitable Distribution? This reduces the taxable amount if
    you're 70½ or older."

### 1099-G Flow (Unemployment)

15. "Did you receive unemployment compensation?"
    - If yes: "What's the amount from Box 1 of your 1099-G?"
    - "Was any federal tax withheld?"
    - Confirm → emit `add_income(1099g)`

### Spouse Retirement (MFJ)

16. If MFJ: "Does your spouse have any 1099-R, Social Security, or
    unemployment income?"
    - If yes → loop through relevant flows with `isSpouse: true`

### Exit

17. "Here's your retirement income summary:
    {list by type}
    **Note:** Taxable amounts for Social Security and penalty calculations
    will be computed automatically.

    Ready to move on?"
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `income1099R[].taxableAmount` → Form 1040 Line 4b (IRA) or 5b (pension)
- `income1099R[].grossDistribution` → Form 1040 Line 4a or 5a
- Distribution code determines penalty: code 1 → Form 5329 → 10% penalty
- Roth IRA: contributions come out tax-free (FIFO ordering of basis)
- Rollover (code G): not taxable, but reported on the return
- `incomeSSA1099.totalBenefits` → Form 1040 Line 6a; taxable portion → Line 6b
- SS taxability: 0%, 50%, or 85% based on provisional income
- `income1099G[].unemploymentCompensation` → Schedule 1 Line 7
- QCD: reduces taxable IRA distributions for age 70½+, up to $105,000 (2025)
- 1099-R withholding → Form 1040 Line 25b

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| Rollover (code G) reported on 1099-R | Still enter it — report gross on Line 4a/5a, $0 taxable on 4b/5b. "A rollover isn't taxable but must be reported." | Unreported distribution |
| User under 59½ with 1099-R code 1 | Flag 10% penalty risk. Ask about exceptions (Form 5329). "Were any of these exceptions applicable?" | Missed penalty or missed exception |
| Roth 5-year rule | If Roth distribution before 5-year holding period: earnings may be taxable. "When did you first contribute to this Roth IRA?" | Undertaxed Roth distribution |
| Box 2a blank or "unknown" | Need simplified method inputs or Roth basis to determine taxable amount. "Box 2a isn't filled in — we'll need to calculate the taxable portion." | Incorrect taxable amount |
| Multiple 1099-Rs from same payer | Enter each separately — different distribution codes may apply | Combined entries lose code-specific treatment |
| State tax refund (1099-G Box 2) | This is NOT unemployment. If user mentions state refund, redirect to `income-other` | Wrong income category |
| User says "I cashed out my 401k" | Clarify: "Did you roll it to another account, or take the cash? If you took the cash, it's taxable and may have a penalty." | Missing penalty flag |
| Net Unrealized Appreciation (NUA) | Complex: employer stock in 401(k) with NUA treatment. Flag: "NUA has special tax rules — the appreciation is taxed at capital gains rates, not ordinary." | Wrong tax rate applied |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Amounts, distribution codes, and payer names must match user input. IRA vs pension flag must be correct. Roth basis must be captured when relevant.
- **Completeness**: Must ask about all three categories (1099-R, SSA-1099, 1099-G). Must capture distribution code and IRA flag for 1099-R. Must flag early distribution penalty when applicable.
- **No Tax Harm**: Primary risks are (1) not reporting rollovers, (2) missing the 10% early distribution penalty, (3) not capturing Roth basis (overtaxing), (4) ignoring the simplified method when Box 2a is blank, (5) confusing state tax refund (1099-G Box 2) with unemployment.
