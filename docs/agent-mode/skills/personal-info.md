# Skill: personal-info
## Domain: Personal Information

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `onboarding` AND this skill is not yet completed or skipped
- Position: first skill in the onboarding phase (order: 1)
- Prerequisites: none (this is the entry point)

### User Intent (on-demand)
- "My name is..." / "I'm [name]"
- "Change my name" / "Update my address"
- "Personal info" / "personal information"
- "My address is..."
- "I need to update my SSN"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.firstName` | `string?` | Check if already entered |
| `taxReturn.lastName` | `string?` | Check if already entered |
| `taxReturn.middleInitial` | `string?` | Check if already entered |
| `taxReturn.suffix` | `string?` | Jr., Sr., III, etc. |
| `taxReturn.dateOfBirth` | `string?` | Check if already entered |
| `taxReturn.occupation` | `string?` | Check if already entered |
| `taxReturn.addressStreet` | `string?` | Check if already entered |
| `taxReturn.addressCity` | `string?` | Check if already entered |
| `taxReturn.addressState` | `string?` | Check if already entered |
| `taxReturn.addressZip` | `string?` | Check if already entered |
| `taxReturn.isLegallyBlind` | `boolean?` | Affects standard deduction |
| `taxReturn.canBeClaimedAsDependent` | `boolean?` | Affects standard deduction and eligibility |
| `taxReturn.isActiveDutyMilitary` | `boolean?` | Unlocks Form 3903 |
| `taxReturn.digitalAssetActivity` | `boolean?` | IRS digital asset question |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.firstName` | `string` | `update_field` |
| `taxReturn.lastName` | `string` | `update_field` |
| `taxReturn.middleInitial` | `string` | `update_field` |
| `taxReturn.suffix` | `string` | `update_field` |
| `taxReturn.dateOfBirth` | `string` | `update_field` |
| `taxReturn.occupation` | `string` | `update_field` |
| `taxReturn.addressStreet` | `string` | `update_field` |
| `taxReturn.addressCity` | `string` | `update_field` |
| `taxReturn.addressState` | `string` | `update_field` |
| `taxReturn.addressZip` | `string` | `update_field` |
| `taxReturn.isLegallyBlind` | `boolean` | `update_field` |
| `taxReturn.canBeClaimedAsDependent` | `boolean` | `update_field` |
| `taxReturn.isActiveDutyMilitary` | `boolean` | `update_field` |
| `taxReturn.digitalAssetActivity` | `boolean` | `update_field` |

### Discovery Keys
None — personal info doesn't use income discovery flags.

### Allowed Actions
- `update_field` — set any personal info field listed in Writes
- `navigate` — navigate to personal info step
- `no_action` — informational response

### Forbidden
- Must not ask for or store full SSN (collected separately at the encryption step)
- Must not set filing status (that's the `filing-status` skill)
- Must not add dependents (that's the `dependents` skill)
- Must not modify income, deductions, or credits

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] `firstName` AND `lastName` are set
- [ ] `addressStreet`, `addressCity`, `addressState`, `addressZip` are set
- [ ] `dateOfBirth` is set
- [ ] OR: user explicitly says "skip" / "I'll do this later"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check existing state:
   - If `firstName` and `lastName` already set: "I see you're {firstName} {lastName}.
     Is your personal information up to date, or do you need to make changes?"
   - Otherwise: "Let's start with your basic information. What's your full
     legal name as it appears on your Social Security card?"

### Main Loop

2. Extract name from user response. If they provide first and last in one message,
   capture both. Ask about middle initial and suffix only if not volunteered:
   "Do you have a middle initial? And any suffix like Jr. or Sr.?"
   - If user says no → skip those fields

3. "What's your date of birth?"
   - Accept natural formats: "March 15, 1990", "3/15/1990", "1990-03-15"

4. "What's your current mailing address? This is where the IRS would send any
   correspondence."
   - Accept full address in one message or ask piece by piece
   - Validate state is a 2-letter abbreviation
   - Validate zip is 5 digits (or 5+4)

5. "What do you do for a living? Your occupation goes on the return."
   - Accept any free-text description

6. Quick required questions (ask as a batch):
   "A few required questions:
   - Can someone else claim you as a dependent on their tax return?
   - Are you legally blind?
   - Did you receive, sell, send, exchange, or otherwise acquire any digital
     assets (cryptocurrency, NFTs) during the year?"

7. If contextually relevant (military occupation, mentioned service):
   "Are you an active-duty member of the Armed Forces?"

### Confirmation

8. Propose the full set of actions for confirmation:
   "Here's what I have:
   - **Name:** {firstName} {middleInitial}. {lastName} {suffix}
   - **Date of birth:** {dob}
   - **Address:** {street}, {city}, {state} {zip}
   - **Occupation:** {occupation}

   Does this all look correct?"

   - If user confirms → emit all `update_field` actions
   - If user corrects → update the specific field and re-confirm

### Exit

9. "Personal info is all set. Let's move on to your filing status."
   → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `firstName`, `lastName`, `middleInitial`, `suffix` → Form 1040 header
- `addressStreet`, `addressCity`, `addressState`, `addressZip` → Form 1040 address block
- `dateOfBirth` → age-based calculations: additional standard deduction (65+),
  Saver's Credit age limit, EITC age requirements, Schedule R eligibility
- `occupation` → Form 1040 occupation line (informational)
- `isLegallyBlind` → additional standard deduction ($1,950 single/$1,550 MFJ per person)
- `canBeClaimedAsDependent` → reduces standard deduction to earned income + $450,
  blocks certain credits (Saver's Credit)
- `digitalAssetActivity` → Form 1040 digital asset question (yes/no checkbox)
- `isActiveDutyMilitary` → unlocks Form 3903 moving expenses, combat pay EITC election
- `addressState` → used to pre-populate state return if `stateReturns` is empty

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| User provides a nickname ("Call me Mike") | Accept for conversation but ask: "What's the legal name on your Social Security card? The IRS needs the exact legal name." | Name mismatch → IRS rejection |
| User has a hyphenated last name | Accept as-is: "Smith-Jones" is valid | Splitting it could cause mismatch |
| User's address is a PO Box | Accept — PO Boxes are valid for IRS correspondence | No risk |
| User is under 18 | Note for context (may be claimed as dependent, limited credits) but don't gate on age | Missing age context |
| User says "I'm 67" instead of giving DOB | Ask for actual date: "I need your full date of birth for age-based tax calculations. What's the month, day, and year?" | Approximate age isn't sufficient for 65+ thresholds |
| User is legally blind | Must ask — affects standard deduction by $1,550-$1,950 | Missed deduction |
| Non-US address | Flag: "Nimbus currently supports US returns with US addresses. If you're filing from abroad, you may need Form 2555 for foreign earned income." | Incorrect filing |
| User provides SSN proactively | Do NOT store it via this skill. Say: "I'll collect your SSN separately in a secure encrypted step. No need to share it here." | PII exposure in chat history |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Name, address, and DOB must exactly match user input. State must be valid 2-letter code. Zip must be valid format.
- **Completeness**: Must collect legal name (first + last), DOB, full address, and occupation. Must ask about dependent status, blindness, and digital assets.
- **No Tax Harm**: Primary risks are (1) accepting a nickname instead of legal name, (2) not asking about legally blind status (missed deduction), (3) not asking the digital asset question (IRS compliance), (4) storing SSN in chat.
