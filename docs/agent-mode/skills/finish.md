# Skill: finish
## Domain: Filing, Export & Payment

<!-- ────────────────────────────────────── -->
## Trigger

### Orchestrator (automatic)
- Phase is `finish` AND this skill is not yet completed or skipped
- Position: only skill in finish phase (order: 1)
- Prerequisites: `review` completed

### User Intent (on-demand)
- "I'm done" / "finish" / "file my return"
- "Export" / "download" / "print"
- "How do I file?"
- "Direct deposit" / "bank account"
- "Payment options" / "how do I pay?"

<!-- ────────────────────────────────────── -->
## Contract

### Reads
| Field path | Type | Why |
|------------|------|-----|
| `taxReturn.status` | `string` | Must be 'review' to proceed |
| `taxReturn.directDeposit` | `DirectDeposit?` | Existing DD info |
| `taxReturn.refundAppliedToNextYear` | `number?` | Applied to next year |
| `calculation.form1040` | `Form1040Result` | Refund/owed amount |
| `calculation.stateResults` | `StateCalculationResult[]?` | State amounts |

### Writes
| Field path | Type | Via action |
|------------|------|-----------|
| `taxReturn.directDeposit` | `DirectDeposit` | `update_field` |
| `taxReturn.refundAppliedToNextYear` | `number` | `update_field` |
| `taxReturn.status` | `'completed'` | `update_field` |

### Discovery Keys
None.

### Allowed Actions
- `update_field` — set direct deposit, refund allocation, status
- `navigate` — navigate to filing/export steps
- `no_action` — informational response

### Forbidden
- Must not actually e-file (Nimbus generates print-ready PDFs for manual filing)
- Must not collect bank account or routing numbers (handled in secure UI field)
- Must not modify income, deductions, or credits at this stage
- Must not guarantee filing deadlines or IRS processing times

<!-- ────────────────────────────────────── -->
## Completion Criteria

- [ ] User understands their filing options
- [ ] If refund: refund delivery method discussed
- [ ] If owed: payment options discussed
- [ ] Return status set to `completed`
- [ ] OR: user goes back to make more changes (returns to review)

<!-- ────────────────────────────────────── -->
## Interview Flow

### Entry

1. "Congratulations — your return is ready! Here's what's next."

### Refund or Payment Summary

2. "**Federal:** {If refund: 'Refund of $' + refund} {If owed: 'You owe $' + owed}
   {For each state: '{stateName}: {refund/owed} $X'}
   **Net result:** {overall summary}"

### Refund Delivery (if refund)

3. "How would you like to receive your refund?"
   - **Direct deposit** (fastest — typically 21 days with e-file)
   - **Paper check** (mailed to your address — 6-8 weeks)
   - **Apply to next year** (use some or all as estimated payment for next year)

4. If direct deposit:
   "You can enter your bank routing and account number in the secure
   field on the next screen. I won't ask for it in chat."

5. If applying to next year:
   "How much would you like to apply to next year's estimated taxes?"
   → emit `update_field` for refundAppliedToNextYear

### Payment Options (if owed)

6. "Here are your payment options:
   - **IRS Direct Pay** (irs.gov/payments) — free, instant
   - **Electronic Federal Tax Payment System (EFTPS)** — for scheduled payments
   - **Credit/debit card** — processing fee applies
   - **Installment agreement** — if you can't pay in full, the IRS offers
     payment plans
   - **Check or money order** — mail with Form 1040-V

   The payment deadline is April 15, {taxYear + 1} (or the next business day).
   You can pay now or wait — just make sure it's before the deadline to
   avoid penalties and interest."

### Export Options

7. "Nimbus can generate your return as a print-ready PDF. You have a few
   options for filing:
   - **Print and mail** — print the PDF and mail to the IRS address for
     your state
   - **E-file through Free File** — if your AGI is under $84,000 (2025),
     you may qualify for IRS Free File partners
   - **Use the PDF with another e-file service** — some services accept
     completed returns

   Would you like me to generate the PDF now?"

### Final Steps

8. "A few reminders:
   - **Keep your records** for at least 3 years (7 years if you reported
     a loss)
   - **Estimated payments**: {If SE or significant non-withheld income:
     'Consider making quarterly estimated payments for next year to avoid
     underpayment penalties. Due dates: April 15, June 15, September 15,
     January 15.'}
   - **State returns**: {If states: 'Don't forget to file and pay your
     state return(s) by the deadline.'}"

### Confirmation

9. "Is there anything else you'd like to review or change before we
   finalize?"
   - If changes → navigate back to appropriate section
   - If done → set `status` to `completed`

### Exit

10. "Your return is complete! 🎉

    Here's a summary of what you'll need to do:
    {filing instructions based on their choices}

    Thank you for using Nimbus. If anything changes (amended return,
    new documents), you can come back anytime."
    → Signal completion to orchestrator.

<!-- ────────────────────────────────────── -->
## Engine Context

- Refund → Form 1040 Line 35a
- Amount owed → Form 1040 Line 37
- Direct deposit → Form 1040 Lines 35b-d (routing, account, type)
- Refund applied to next year → Form 1040 Line 36
- State amounts → each state's calculation result
- PDF generation uses the engine calculation + TaxReturn data to
  populate Form 1040 and all attached schedules

<!-- ────────────────────────────────────── -->
## Edge Cases

| Scenario | Correct behavior | Risk if wrong |
|----------|-----------------|---------------|
| User wants to e-file | "Nimbus currently generates print-ready PDFs. For e-filing, you can use IRS Free File or another service with the completed return data." | Implying Nimbus e-files |
| User can't pay balance due | Mention installment agreement: "The IRS offers payment plans — you can apply online at irs.gov." | User panics about amount owed |
| Extension needed | "If you need more time, file Form 4868 for a 6-month extension. This extends the filing deadline but NOT the payment deadline." | Confusion about extension scope |
| User has both federal refund and state balance due | Present separately: "You'll receive a federal refund of $X, but you owe $Y to {state}. These are separate." | Netting refund/owed across jurisdictions |
| User wants to split refund | "You can split your refund across up to 3 accounts using Form 8888. Would you like to set that up?" | Missing split option |
| Amended return needed later | "If you discover an error or receive a corrected form after filing, you can file Form 1040-X (amended return). Come back anytime to make changes." | No path for corrections |
| User asks about audit likelihood | "I can't predict audit odds, but keeping good records and filing accurately is the best protection. Nimbus flags common audit risk areas during review." | Providing false assurance |

<!-- ────────────────────────────────────── -->
## Eval Criteria

- **Accuracy**: Refund/owed amounts must match engine calculation. Payment deadlines must be correct. Export options must be accurate for current capabilities.
- **Completeness**: Must cover refund delivery OR payment options (depending on result). Must explain filing options. Must mention record-keeping and estimated payments if applicable.
- **No Tax Harm**: Primary risks are (1) implying Nimbus can e-file, (2) not mentioning payment deadline, (3) confusing extension (filing time) with payment extension (none), (4) not recommending estimated payments when appropriate.
