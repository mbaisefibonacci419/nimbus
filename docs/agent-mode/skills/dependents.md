# Skill: dependents
## Domain: Dependents

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `onboarding` AND this skill is not yet completed or skipped
- Position: third skill in the onboarding phase (order: 3)
- Prerequisites: `filing-status` completed

### User Intent (on-demand)
- "I have kids" / "I have children"
- "Add a dependent" / "I need to add my child"
- "Dependent" / "dependents"
- "My child is..." / "My daughter lives with me"
- "Can I claim my parent?"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.filingStatus` | `FilingStatus?` | MFJ affects whose dependents |
| `taxReturn.dependents` | `Dependent[]` | See what's already entered |
| `taxReturn.spouseFirstName` | `string?` | Personalize questions |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.dependents[]` | `Dependent` | `add_dependent` |

### Discovery Keys
None — dependents don't use income discovery flags.

### Allowed Actions
- `add_dependent` — add a dependent entry
- `remove_item` (itemType: `dependents`) — remove an incorrect dependent
- `navigate` — navigate to dependents step
- `no_action` — informational response

### Forbidden
- Must not ask for or store dependent SSN (collected at encryption step)
- Must not modify filing status (that's the `filing-status` skill)
- Must not set credits (that's the `credits` skill — CTC is auto-calculated)
- Must not provide definitive guidance on complex custody/dependency situations

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] User has been asked if they have dependents
- [ ] If yes: at least one dependent added with required fields
- [ ] User confirmed "no more dependents"
- [ ] OR: user said "no dependents"
- [ ] OR: user explicitly says "skip"

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. Check existing state:
   - If `dependents.length > 0`: "I see you have {count} dependent(s):
     {names}. Do you need to add more, or is this complete?"
   - Otherwise: "Do you have any dependents — children, relatives, or other
     qualifying individuals you support?"

2. If user says no → mark complete.

### Main Loop (per dependent)

3. "What's the dependent's first and last name?"

4. "What's their relationship to you? For example: son, daughter, stepchild,
   parent, sibling, niece, etc."

5. "What's their date of birth?"
   - Use DOB to determine if qualifying child (<19, or <24 if student) vs
     qualifying relative

6. "How many months did they live with you this year?"
   - Qualifying child must live with filer for more than half the year (>6 months)
   - Exception: temporary absences (school, medical) count as living with you

7. If dependent is 19+ and under 24:
   "Was {name} a full-time student for at least 5 months this year?"

8. If dependent appears to be qualifying relative (not child):
   "Did you provide more than half of {name}'s financial support this year?"

9. "Does {name} have any disability that prevents them from self-care?"

### Confirmation

10. Propose the dependent for confirmation:
    "Here's what I have:
    - **Name:** {firstName} {lastName}
    - **Relationship:** {relationship}
    - **Date of birth:** {dob}
    - **Months lived with you:** {months}
    {if student: '- **Full-time student:** Yes'}
    {if disabled: '- **Disabled:** Yes'}

    Does this look right?"
    - If confirmed → emit `add_dependent`
    - If corrected → update and re-confirm

### Additional Dependents

11. "Do you have another dependent to add?"
    - If yes → loop back to step 3
    - If no → proceed to exit

### Exit

12. "Got it — {count} dependent(s) added. This will be factored into your
    credits and deductions automatically."
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- `dependents[]` → Form 1040 Dependents section
- Each qualifying child under 17 → up to $2,000 Child Tax Credit (CTC)
- Each qualifying dependent not eligible for CTC → $500 Other Dependents Credit
- Dependents affect: EITC (qualifying children), Child and Dependent Care Credit,
  Education Credits (if student), HoH eligibility
- `monthsLivedWithYou` → qualifying child residency test (>6 months)
- `isStudent` → extends qualifying child age limit from 19 to 24
- `isDisabled` → no age limit for qualifying child
- `relationship` → determines qualifying child vs qualifying relative path
- Dependent count affects standard deduction for dependents who file own return

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| Divorced parents — who claims the child? | "Generally, the custodial parent claims the child. If there's a Form 8332 (Release of Claim), the noncustodial parent may claim. Which parent had custody for more nights?" | Both parents claim → IRS rejection |
| Child turned 17 during the tax year | Age on Dec 31 determines CTC eligibility. If 17 on Dec 31 → $500 ODC, not $2,000 CTC | Wrong credit amount |
| User wants to claim a parent | Ask about income (<$5,050 test), support (>50%), and whether parent files joint return | Invalid dependency claim |
| Newborn in December | Qualifies for full-year dependent status. Residency test met even if born Dec 31 | Missing a dependent |
| Child away at college | Temporary absence — counts as living with parent | Incorrect months reported |
| User and ex both want to claim same child | Tie-breaker rules: custodial parent wins; if both are parents, higher AGI wins. Don't adjudicate — inform and let user decide | Taking a position on custody |
| Foster child | Qualifies as qualifying child if placed by authorized agency and lived with filer >6 months | Missing qualifying dependent |
| User provides SSN | "I'll collect SSNs separately in the secure step. For now, I just need name, relationship, DOB, and residency." | PII in chat history |
| More than 6 dependents | Accept all — no IRS limit on number of dependents, though >3 qualifying children for EITC don't increase the credit further | No risk from accepting all |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Names, relationships, DOB, and months must match user input. Student and disability flags must be set correctly based on user answers.
- **Completeness**: Must collect name, relationship, DOB, and months lived with filer for each dependent. Must ask about student status for dependents 19-23. Must ask about disability when relevant.
- **No Tax Harm**: Primary risks are (1) missing the student status question for college-age dependents (blocks CTC/EIC), (2) not asking months lived with filer (residency test), (3) not flagging divorced-parent custody situations, (4) storing SSN in chat.
