# Skill: filing-status
## Domain: Filing Status Selection

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `onboarding` AND this skill is not yet completed or skipped
- Position: second skill in the onboarding phase (order: 2)
- Prerequisites: `personal-info` completed

### User Intent (on-demand)
- "I'm single" / "I'm married" / "I'm filing jointly"
- "Filing status" / "change my filing status"
- "Head of household" / "qualifying surviving spouse"
- "Should I file jointly or separately?"
- "I got married this year" / "I got divorced"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.filingStatus` | `FilingStatus?` | Check if already set |
| `taxReturn.firstName` | `string?` | Personalization |
| `taxReturn.dependents` | `Dependent[]` | HoH requires qualifying person |
| `taxReturn.dateOfBirth` | `string?` | Age context for QSS |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.filingStatus` | `FilingStatus` | `set_filing_status` |
| `taxReturn.spouseFirstName` | `string` | `update_field` |
| `taxReturn.spouseLastName` | `string` | `update_field` |
| `taxReturn.spouseDateOfBirth` | `string` | `update_field` |
| `taxReturn.spouseOccupation` | `string` | `update_field` |
| `taxReturn.livedApartFromSpouse` | `boolean` | `update_field` |
| `taxReturn.paidOverHalfHouseholdCost` | `boolean` | `update_field` |
| `taxReturn.spouseDateOfDeath` | `string` | `update_field` |
| `taxReturn.isDeceasedSpouseReturn` | `boolean` | `update_field` |

### Discovery Keys
None.

### Allowed Actions
- `set_filing_status` — set the filing status enum
- `update_field` — set spouse info and HoH/QSS qualifying fields
- `navigate` — navigate to filing status step
- `no_action` — informational response

### Forbidden
- Must not provide tax advice on which status to choose — present the options factually
- Must not modify income, deductions, or credits
- Must not collect spouse SSN (encrypted step)
- Must not add dependents (that's the `dependents` skill)

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] `filingStatus` is set to a valid value
- [ ] If MFJ: `spouseFirstName` and `spouseLastName` are set
- [ ] If HoH: user has confirmed they paid over half of household costs
- [ ] OR: user explicitly says "skip" / "I'll decide later"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check existing state:
   - If `filingStatus` already set: "Your filing status is currently
     {statusName}. Want to keep this or change it?"
   - Otherwise: "Let's figure out your filing status. This affects your tax
     rates, standard deduction, and which credits you qualify for."

### Status Determination

2. "What was your marital status on December 31, {taxYear}?"
   - "I'm single / never married" → likely Single or HoH
   - "I'm married" → likely MFJ or MFS
   - "I'm divorced / legally separated" → likely Single or HoH
   - "I'm widowed" → possibly QSS if within 2 years and has dependent child

3. **If single / divorced / separated:**
   "Do you have a dependent (child, parent, or other qualifying person) who
   lives with you? If so, you might qualify for Head of Household, which
   gives you a larger standard deduction and lower tax rates."
   - If yes → ask: "Did you pay more than half the cost of keeping up your
     home for the year?" If yes → set HoH
   - If no → set Single

4. **If married:**
   "Most married couples file jointly — it usually results in the lowest tax.
   But there are situations where filing separately makes sense.
   Would you like to file jointly or separately?"
   - If jointly → set MFJ, proceed to spouse info
   - If separately → set MFS, ask: "Did you and your spouse live apart for
     the entire last six months of the year?" (affects SS taxability)
   - If unsure → "You can try both. For now, let's start with jointly —
     you can always change it later to compare."

5. **If widowed (within 2 years):**
   "I'm sorry for your loss. If your spouse passed away in {taxYear} or
   {taxYear-1}, and you have a dependent child, you may qualify as a
   Qualifying Surviving Spouse. This gives you the same tax rates and
   standard deduction as Married Filing Jointly.
   - Did your spouse pass away in {taxYear} or {taxYear-1}?
   - Do you have a dependent child?"
   If both yes → set QSS; otherwise route to Single or HoH

### Spouse Info (MFJ or MFS)

6. If married filing status selected:
   "What's your spouse's legal name?"
   → capture `spouseFirstName`, `spouseLastName`

7. "What's their date of birth?"

8. "What's their occupation?"

### Confirmation

9. "Here's your filing status:
   - **Status:** {statusName}
   {if married: '- **Spouse:** {spouseFirstName} {spouseLastName}'}

   Does this look right?"
   - If confirmed → emit actions
   - If corrected → update and re-confirm

### Exit

10. "Filing status is set to {statusName}. Next, let's talk about dependents."
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `filingStatus` → controls tax bracket table, standard deduction amount,
  and credit phase-out thresholds throughout the entire return
- Standard deduction (2025): Single $15,350, MFJ $30,700, HoH $22,800,
  MFS $15,350, QSS $30,700
- MFS special rules: EITC disqualified, education credits limited, SS
  thresholds change if lived together, both must itemize or both standard
- HoH → lower bracket thresholds than Single, higher standard deduction
- QSS → same brackets/deduction as MFJ for 2 years after spouse death
- `livedApartFromSpouse` → IRC §86(c)(1)(C)(ii) affects SS taxability for MFS
- `paidOverHalfHouseholdCost` → required for HoH qualification
- `spouseDateOfDeath` → determines if joint return year-of-death or QSS

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| User says "it's complicated" (separated but not divorced) | Legally married = must file as married (MFJ or MFS). Exception: HoH if lived apart last 6 months + qualifying dependent + paid >50% costs | Wrong filing status = IRS rejection |
| User married late December | Filing status is based on Dec 31 status. Married on Dec 31 = must file as married | Filing as Single when married |
| User's spouse died during the tax year | Can file MFJ for the year of death. Following 2 years may use QSS if qualifying child | Missing more favorable status |
| User says "head of household" but has no qualifying person | Must have a qualifying dependent. Ask: "Who is the qualifying person for your Head of Household status?" | Invalid HoH = IRS audit/rejection |
| User wants to compare MFJ vs MFS | "You can run both scenarios using the Scenario Lab feature. For now, let's pick one to start building your return." | Over-promising tax advice |
| Same-sex married couple | Treated identically to any married couple for federal tax purposes | No special handling needed |
| Common-law marriage | "Are you considered married under the laws of your state? If your state recognizes common-law marriage and you meet the requirements, you'd file as married." | State law varies |
| Nonresident alien spouse | MFS is typical unless they elect to be treated as resident. Note: "If your spouse is a nonresident alien, special rules apply to filing jointly." | Complex rules beyond scope |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Filing status enum must correctly map to user's described situation. Spouse name and DOB must match input.
- **Completeness**: Must determine marital status, evaluate HoH eligibility for non-married filers with dependents, and collect spouse info for married filers. Must set `paidOverHalfHouseholdCost` for HoH.
- **No Tax Harm**: Primary risks are (1) setting Single when HoH qualifies (missed lower rates), (2) not asking about QSS for recent widows/widowers, (3) allowing HoH without verifying qualifying person and >50% household costs, (4) not mentioning MFS restrictions when user chooses MFS.
