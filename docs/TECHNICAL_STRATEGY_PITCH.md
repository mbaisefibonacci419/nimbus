# Nimbus: Feature Ideas for TurboTax

**Author:** Ugo Ibecheozor
**Date:** May 2026
**Audience:** Director of Product Management
**Format:** Prioritized feature backlog with experiment sketches

---

## What This Document Is

I built a working tax prep prototype (Nimbus) that covers ~85-90% of individual DIY filers — income, deductions, credits, all 50 states, AI guidance, and document import. This document isn't about the prototype itself. It's a **prioritized backlog of feature ideas**, each validated by a working implementation, that TurboTax could test and adopt.

Every feature maps to a TurboTax business metric — S2C, ARPC, C2C, PRS — and includes a testable hypothesis and experiment sketch. The goal is to give you a set of ideas you can evaluate, sequence, and hand to teams for experimentation.

---

## Feature Backlog

### Conversion / S2C Drivers

These features target the funnel between Start and Complete. The playbook identifies S2C as the main goal for product tests, with overall S2C at ~76% by end of season. Each feature below addresses a specific friction point between starting and completing a return.

---

#### 1. Dual-Mode Search: Navigate First, Chat Second

**What it does in Nimbus:**
A command palette (Cmd+K) that searches across wizard steps, tax data, IRS forms, tools, and help articles simultaneously. Results appear inline with highlighted matches. Selecting a result navigates directly — it doesn't open a chat. The search is instant and deterministic (no LLM round-trip).

**TurboTax today:**
The search bar exists across DIY and DIWM SKUs, but typing a query opens results in the AI chat panel. Every search becomes a conversation.

**The gap:**
Not every search intent is a question. "Go to W-2" is navigational. "HSA contribution limit" is informational. "Add a dependent" is an action. Routing all of these through chat introduces friction: the customer types, waits for an AI response, reads the response, and then manually navigates. For navigational and informational queries — which likely represent a large share of searches — a direct result is faster.

Nimbus separates these two patterns: the command palette handles fast navigational/informational lookups instantly, while the AI chat handles complex, conversational questions. The customer gets the right tool for the right intent.

**Primary metric:** S2C (secondary: PRS)
**Hypothesis:** If we add a fast, deterministic search layer that resolves navigational and informational queries without opening a chat, then S2C will improve because customers spend less time getting to the right screen and more time completing their return.

**Experiment sketch:**
- IXP: 50/50 split on DIY users who interact with search
- Recipe A (control): Current search → chat behavior
- Recipe B (treatment): Dual-mode — navigational/informational results resolve inline; complex queries fall through to chat
- Primary: S2C | Secondary: ARPC, search-to-navigation time, chat open rate from search
- Audience: All DIY, New + Returning

**Effort:** Medium | **Risk:** Low

---

#### 2. AI That Suggests Actions, Not Just Answers

**What it does in Nimbus:**
When the AI assistant responds, it doesn't just give text advice — it returns structured action cards. "I'll add your W-2 from Acme Corp with $75,000 in wages" appears as a previewable card the customer can confirm, edit, or dismiss. Every action is undoable. There are 15 action types covering income, filing status, dependents, deductions, navigation, and more.

**TurboTax today:**
The digital assistant provides text-based guidance. After reading the answer, the customer has to figure out what to do next — where to navigate, what to enter, which field to update. The AI advises; the customer executes.

**The gap:**
There's a "now what?" moment between getting advice and acting on it. The customer reads "You may be eligible for the Earned Income Credit" and then has to find the right screen, understand what to enter, and do it themselves. Nimbus eliminates that gap: the AI suggests the specific action, the customer confirms, and the system executes. This turns the AI from an advisor into an assistant that does things for you (with your permission).

**Primary metric:** S2C (secondary: PRS, WIP clearance)
**Hypothesis:** If AI responses include executable action cards that customers can preview and confirm, then S2C will improve because the path from "AI helped me understand" to "my return is updated" becomes one click instead of multiple manual steps.

**Experiment sketch:**
- IXP: 50/50 on users who engage with the digital assistant
- Recipe A (control): Current text-based responses
- Recipe B (treatment): Responses include structured action cards (preview → confirm → execute → undo)
- Primary: S2C | Secondary: ARPC, actions-per-session, PRS, contact rate
- Segment cuts: New vs Returning, Free vs Paid, simple vs complex filers

**Effort:** Medium-High | **Risk:** Low (actions are additive; text response is still there)

---

#### 3. One-Click Document Import

**What it does in Nimbus:**
Upload a W-2, 1099, or other tax document as a PDF or photo. AI extracts all fields automatically and presents a preview card: "W-2 from Acme Corp — Wages: $75,000, Federal Tax Withheld: $12,500." The customer reviews, edits if needed, and clicks "Add to Return." One upload, one review, one click. Supports 20+ form types including W-2, 1099-INT/DIV/R/NEC/MISC/G/B/K, SSA-1099, 1098, K-1, and more.

**TurboTax today:**
Document import capabilities exist but the experience varies by form type and entry point. Some flows require manual data entry even after a document is recognized.

**The gap:**
Data entry is one of the highest-friction steps in the funnel. Every field the customer has to manually type from a document they're holding is an opportunity to abandon. Nimbus validates that a PDF-to-return pipeline can work end-to-end with high accuracy across 20+ form types. The key UX insight: show the customer exactly what was extracted, let them correct anything, and commit with a single action.

**Primary metric:** S2C (secondary: time-to-complete, abandonment at income entry steps)
**Hypothesis:** If document upload auto-fills all fields with a single-confirmation UX, then S2C will improve because manual data entry — the highest-friction stage — is reduced to a review step.

**Experiment sketch:**
- IXP: 50/50 on users who reach income entry steps with a supported document type
- Recipe A (control): Current document import flow
- Recipe B (treatment): Upload → AI extraction → preview card → one-click add
- Primary: S2C | Secondary: time-to-start-complete, income step abandonment, ARPC
- Key cut: New customers (who benefit most from reduced data entry friction)

**Effort:** Medium | **Risk:** Low

---

#### 4. Real-Time What-If Scenarios

**What it does in Nimbus:**
A Scenario Lab where customers create side-by-side scenarios: "What if I contribute $6,500 to my IRA?" or "What if I itemize instead of taking the standard deduction?" The tax engine runs instantly in the browser — no server round-trip — and shows the dollar impact in milliseconds. Includes sensitivity analysis (sliders for income adjustments) and a comparison dashboard.

**TurboTax today:**
Limited what-if capability. Customers who want to explore options typically have to change values, wait for recalculation, note the result, change back, and compare mentally.

**The gap:**
Decision paralysis is a completion blocker. Customers who are unsure whether to contribute to an IRA, claim a deduction, or file jointly vs separately may abandon rather than commit to a choice they don't fully understand. Real-time what-if feedback — "Contributing $6,500 to your IRA would reduce your tax by $1,430" — gives customers the confidence to complete.

**Primary metric:** S2C (secondary: ARPC, PRS)
**Hypothesis:** If customers can instantly compare tax scenarios side-by-side, then S2C will improve because decision-paralysis abandonment decreases, and secondary ARPC may increase as customers discover higher-value filing strategies.

**Experiment sketch:**
- IXP: 50/50 on users who reach deductions or credits steps
- Recipe A (control): Current experience
- Recipe B (treatment): "What If?" tool accessible from deduction/credit steps with real-time calculation
- Primary: S2C | Secondary: ARPC (do customers select higher-value options?), PRS, WIP duration
- Segment: Paid SKU (customers with meaningful decisions), Returning (have baseline expectations)

**Effort:** High | **Risk:** Low (read-only tool, doesn't change the return)

---

#### 5. Proactive Missed-Money Nudges

**What it does in Nimbus:**
A suggestion engine with 14 deterministic detection rules that scan the return in progress and surface contextual nudges: "You reported self-employment income but haven't added a home office deduction — this could save you $X." Nudges appear as banners at the relevant step. The customer can act on them ("Take me there"), dismiss, or ask the AI for more detail. Eligibility is determined by the engine (deterministic), not the AI.

**TurboTax today:**
Some in-product guidance exists, but the digital assistant's recommendations are largely reactive (respond to questions) rather than proactive (surface opportunities the customer didn't think to ask about).

**The gap:**
Customers don't know what they don't know. A W-2 filer with $3,000 in student loan interest may not think to look for that deduction. A self-employed filer may not realize they're eligible for the QBI deduction. Proactive nudges turn the product into a deduction-finding partner rather than a passive form. The key design insight from Nimbus: eligibility must be deterministic (engine-checked), even if the explanation is AI-enhanced. This prevents false positives that erode trust.

**Primary metric:** S2C (secondary: ARPC — nudges that surface paid-SKU features drive upsell)
**Hypothesis:** If we proactively surface missed deductions and credits at contextually relevant steps, then S2C will improve because customers who discover additional savings are more motivated to complete, and ARPC may increase when nudges surface features that require a paid SKU.

**Experiment sketch:**
- IXP: 50/50 on all DIY users past the income section
- Recipe A (control): No proactive nudges
- Recipe B (treatment): Deterministic nudge banners at relevant steps
- Primary: S2C | Secondary: ARPC, nudge interaction rate, nudge-to-completion rate, PRS
- Key cuts: New vs Returning, Free vs Paid, SE vs W-2

**Effort:** Medium | **Risk:** Low (deterministic rules prevent incorrect nudges)

---

### Revenue / ARPC Drivers

These features target revenue per customer. The playbook notes that for product lineup tests, driving incremental ARPC is often the primary metric. These features increase the value delivered to the customer — justifying SKU upgrade, attach, or higher perceived value.

---

#### 6. Expense Scanner and Deduction Discovery

**What it does in Nimbus:**
Upload bank or credit card statements (CSV from Chase, BofA, Amex, Wells Fargo, and 6 other formats auto-detected). The system scans transactions with pattern matching, then optionally uses AI to categorize into 17 tax categories. A review dashboard shows each deduction category with totals. The customer batch-approves and pushes directly into Schedule C or itemized deductions.

**TurboTax today:**
Self-employed users enter expenses manually or connect accounts. The product doesn't offer a "scan my bank statements for deductions I missed" flow.

**The gap:**
Self-employed and itemizing customers frequently miss deductions because they don't know which purchases qualify. The expense scanner turns a pile of bank statements into a categorized deduction summary. The key insight: this isn't just a time-saver — it's a money-finder. Customers who discover $2,000 in deductions they would have missed attribute that savings to the product. This directly justifies paid SKU value.

**Primary metric:** ARPC (secondary: S2C, PRS, Plus/Max attach)
**Hypothesis:** If SE and itemizing customers can upload bank statements and see AI-categorized deductions, then ARPC will increase because discovered deductions justify paid SKU value, and attach rates for Plus/Max improve as customers perceive higher product value.

**Experiment sketch:**
- IXP: 50/50 on SE and itemizing customers
- Recipe A (control): Current manual expense entry
- Recipe B (treatment): "Scan Your Statements" tool with AI categorization and batch apply
- Primary: ARPC | Secondary: S2C, Plus/Max attach rate, PRS, average deduction total
- Key cut: SE vs non-SE, New vs Returning

**Effort:** Medium-High | **Risk:** Low-Medium (accuracy of categorization matters for trust)

---

#### 7. "Explain My Taxes" Visual Breakdowns

**What it does in Nimbus:**
A suite of interactive visualizations: where your money goes (tax flow diagram), how brackets work (marginal vs effective rate chart), a waterfall showing income → adjustments → deductions → credits → tax owed, and a trace tree linking every line on your return to the IRC section that computes it. Available as both a sidebar tool and a full-page step.

**TurboTax today:**
Post-completion summary exists, but mid-flow "explain what's happening with my taxes" visualization is limited.

**The gap:**
Tax anxiety is a PRS and completion problem. Customers who feel confused by what's happening to their money are less likely to complete and less likely to recommend. Visual breakdowns address this directly: "Your effective rate is 14.2% — here's why" is more reassuring than a number on a screen. The bracket chart specifically combats the common misconception about marginal tax rates.

**Primary metric:** PRS (secondary: S2C, C2C)
**Hypothesis:** If customers can visualize how their taxes are calculated at any point during filing, then PRS will improve because tax anxiety decreases, and S2C may improve because confident customers are more likely to complete.

**Experiment sketch:**
- IXP: 50/50 on all DIY users past income entry
- Recipe A (control): Current experience
- Recipe B (treatment): "Explain My Taxes" panel accessible from the header throughout filing
- Primary: PRS | Secondary: S2C, C2C (do customers who use the tool return next year?), time-on-task
- Segment: New customers (highest tax anxiety), complex filers

**Effort:** Medium | **Risk:** Very low (read-only, informational)

---

#### 8. Competitive Return Import for Winbacks

**What it does in Nimbus:**
Upload a prior-year 1040 from TurboTax, H&R Block, TaxAct, or FreeTaxUSA as a PDF. The system extracts personal info and financial line items, shows a review screen with confidence badges, and lets the customer import as current-year prefill or as a prior-year summary for YoY comparison. Automatically detects which competitor product generated the PDF.

**TurboTax today:**
Prior-year import is available for returning TurboTax customers. Competitive import (from other products) is limited.

**The gap:**
Switching cost is a retention moat for competitors. If a customer used H&R Block last year and has to re-enter everything manually to try TurboTax, many won't bother. Competitive PDF import reduces this to: upload last year's PDF, review prefilled data, continue. The playbook identifies acquisition (new accounts, prospects, winbacks) as a key metric. This feature directly targets winbacks.

**Primary metric:** New customer acquisition / winbacks (secondary: S2C for new customers)
**Hypothesis:** If competitive switchers can import their prior-year return from a PDF, then new customer acquisition will increase because switching cost is reduced from "re-enter everything" to "upload and review."

**Experiment sketch:**
- IXP: 50/50 on new customer signups who indicate "I filed with another product last year"
- Recipe A (control): Manual entry
- Recipe B (treatment): "Upload your prior-year return" with competitive PDF parsing
- Primary: New customer S2C | Secondary: time-to-complete, NPS, C2C in year 2
- Segment: New accounts, prospects, winbacks specifically

**Effort:** Medium | **Risk:** Low

---

### Trust / PRS / Retention Drivers

These features target the customer's confidence and likelihood to return. The playbook identifies C2C as the main retention metric and notes three reasons customers leave: price sensitivity, FUD (fear, uncertainty, doubt), and poor experiences. These features address FUD and experience quality.

---

#### 9. "Your SSN Never Touches AI" — Visible PII Protection

**What it does in Nimbus:**
A multi-layer pipeline: client-side PII scan (SSNs, EINs, bank accounts stripped before leaving the browser), server-side re-strip with a context allowlist (only explicitly approved fields reach the AI), and a customer-visible privacy audit log showing exactly what was sent, what was blocked, and what came back.

**TurboTax today:**
AI features send context to LLM backends. The customer has limited visibility into what data the AI processes.

**The gap:**
Trust in AI is the emerging battleground. Customer concerns about "what does the AI see?" will intensify as AI features expand. Nimbus validates that a PII stripping layer can work without degrading AI quality — the assistant still has full context on filing status, income types, deduction eligibility, and tax situation, just without the sensitive identifiers. Making this visible ("Your SSN was never shared with AI") turns a backend safeguard into a marketing message.

**Primary metric:** PRS (secondary: C2C, AI feature adoption rate)
**Hypothesis:** If customers can see that their SSN and sensitive identifiers never reach the AI, then PRS will improve and AI feature adoption will increase because the primary trust barrier is removed.

**Experiment sketch:**
- IXP: 50/50 on users who interact with AI features
- Recipe A (control): Current AI experience, no visibility indicator
- Recipe B (treatment): PII stripping layer + visible "SSN protected" badge + audit log
- Primary: PRS | Secondary: C2C, AI chat engagement rate, contact rate (trust-related escalations)

**Effort:** Medium | **Risk:** Low

---

#### 10. AI Quality Gates (Eval Baselines)

**What it does in Nimbus:**
61 test fixtures across 6 categories (income entry, deduction discovery, credits, informational, ambiguous, multi-action). Each AI response is scored on 8 dimensions including a tax harm rate (AI advice that could cause underreporting — target: 0%) and a hallucination rate (dollar amounts not in context — target: ≤5%). Baselines are committed as JSON. Development policy: no prompt change ships without passing the eval suite. Current baseline: 96.7% accuracy, 0% tax harm.

**TurboTax today:**
AI quality is monitored through PRS, contact center escalations, and manual review — all lagging indicators. By the time a degradation appears in these metrics, thousands of customers have been affected.

**The gap:**
This is an internal capability, not a customer-facing feature, but it directly protects every customer-facing AI experience. Prompt changes, model swaps, and context adjustments are regressions until proven otherwise. A committed eval baseline turns "the AI feels right" into "the AI scores 96.7% on accuracy and 0% on tax harm — and this is tracked on every change."

**Primary metric:** PRS (secondary: contact rate, DSAT, S2C)
**Hypothesis:** If every AI prompt and model change must pass a quantitative eval suite before shipping, then PRS-impacting AI incidents will decrease because regressions are caught in CI, not in production.

**Experiment sketch:**
This is not an A/B test — it's an internal quality process. Implementation is: build the harness, create TurboTax-specific fixtures (map to real customer journeys), commit a baseline, enforce on every change. Monitor PRS, contact rates, and AI DSAT as the trailing indicators.

**Effort:** Low | **Risk:** Very low

---

#### 11. Privacy Audit Log (Customer-Facing Transparency)

**What it does in Nimbus:**
A panel the customer can open at any time showing every AI interaction: what context was sent, which PII fields were blocked, what the AI returned, and timestamps. Think of it as a receipt for every AI conversation.

**TurboTax today:**
No customer-facing visibility into AI data handling.

**The gap:**
Privacy policies are read by almost nobody. A visual audit log is read by everyone who's curious. This transforms "we take your privacy seriously" (a claim) into "here's exactly what happened" (proof). In a market where competitors are increasingly positioning on privacy and trust, this is a concrete differentiator. The playbook notes that FUD is one of three reasons customers leave.

**Primary metric:** PRS (secondary: C2C)
**Hypothesis:** If customers can review a log of every AI interaction and what data was shared, then PRS will improve because transparency reduces FUD and builds trust.

**Experiment sketch:**
- IXP: 50/50 on users who engage with AI
- Recipe A (control): No audit log
- Recipe B (treatment): "Privacy Log" accessible from AI settings
- Primary: PRS | Secondary: C2C, AI adoption rate, trust-related contact volume

**Effort:** Low-Medium | **Risk:** Very low

---

### Retention / C2C Drivers

The playbook defines C2C as the main retention metric: returning completes divided by prior-year total completes. These features give returning customers reasons to come back and make the returning experience better than starting fresh elsewhere.

---

#### 12. Year-over-Year Comparison Tool

**What it does in Nimbus:**
A side-by-side comparison of the current return against a stored prior-year summary: income up/down, deductions changed, credits gained/lost, refund delta. Includes a "clone prior-year payers" feature — import your prior employers and payers as empty templates so you start with structure rather than a blank form.

**TurboTax today:**
Returning customers benefit from some data carryover, but a structured YoY comparison ("Here's what changed since last year") is not a prominent feature.

**The gap:**
Returning customers are TurboTax's most valuable segment (4+ year tenure has the highest C2C). Giving them a "what changed this year" dashboard on return validates their decision to come back, surfaces new opportunities (new credits, changed limits), and makes the returning experience feel personalized rather than repetitive.

**Primary metric:** C2C (secondary: S2C for returning customers, PRS)
**Hypothesis:** If returning customers see a structured comparison of this year vs last year at the start of their return, then C2C will improve because the returning experience feels more valuable than starting fresh with a competitor.

**Experiment sketch:**
- IXP: 50/50 on returning customers at first session
- Recipe A (control): Current returning experience
- Recipe B (treatment): YoY comparison dashboard + prior-year template import
- Primary: C2C (measured next season) | Secondary: returning S2C, returning PRS, session 1 engagement
- Segment: 1st-year returning (highest churn risk), 2nd-3rd year, 4+ year

**Effort:** Medium | **Risk:** Low

---

#### 13. Audit Risk Assessment

**What it does in Nimbus:**
A tool that scores the return against known IRS audit triggers (sourced from IRS data books, GAO reports, TIGTA reports). Surfaces specific risk factors with explanations: "Your charitable deduction is 28% of AGI — the IRS threshold for closer review is typically 25%." Feeds into AI chat context and proactive nudges.

**TurboTax today:**
Audit risk guidance is limited. Audit Defense is a Plus/Max feature, but proactive "here's your audit risk profile" is not surfaced during filing.

**The gap:**
Audit anxiety is one of the biggest sources of FUD for DIY filers. Proactive risk assessment addresses this directly: "Your return has a low audit risk — here's why" is reassuring. And for customers who do have elevated risk factors, the tool explains why and what they can do (attach documentation, reduce a deduction, etc.). This also creates a natural upsell moment for Audit Defense (Plus/Max).

**Primary metric:** PRS (secondary: Plus/Max attach, S2C)
**Hypothesis:** If customers can see their audit risk profile during filing, then PRS will improve because audit anxiety decreases, and Plus/Max attach may increase as customers with elevated risk see the value of Audit Defense.

**Experiment sketch:**
- IXP: 50/50 on users past the deductions section
- Recipe A (control): No audit risk tool
- Recipe B (treatment): Audit risk panel accessible from sidebar
- Primary: PRS | Secondary: Plus/Max attach rate, S2C, contact rate
- Key cut: complex filers (SE, investors, high-deduction)

**Effort:** Medium | **Risk:** Low

---

### Speed-to-Market / Operational Capabilities

These aren't customer-facing features to A/B test — they're internal capabilities that improve how fast and safely TurboTax can ship every season. Including them because they compound the impact of everything above.

---

#### 14. Tax Year as Configuration, Not Code

**What Nimbus validated:**
All year-specific IRS values (brackets, deduction limits, credit thresholds, phase-outs) live in a single typed file per year. Legislative provisions (OBBBA, expanded SALT, scholarship credit) are boolean flags. Adding TY2026 means creating one constants file and updating flags — the calculation engine doesn't change.

**Why it matters:**
Tax law changes every year. If the year-over-year process involves substantial code branching, each season inherits the bugs and complexity of the last. A registry pattern means year-over-year changes are data, not code. This directly impacts how early the product is ready for Early Season (the playbook notes Early Season as Dec 1 – Jan 15, when W-2 availability drives volume). Earlier readiness means capturing early filers — a high-value segment.

**Effort:** Medium | **Risk:** Low (additive, can coexist with existing patterns)

---

#### 15. Portable Calculation Engine

**What Nimbus validated:**
81 pure functions, zero side effects. Same code runs in the browser (instant UI feedback), in the test harness (6,340+ tests), in the AI eval pipeline (verify AI suggestions produce correct tax outcomes), and in PDF generation. No mocking, no database setup, no server dependencies.

**Why it matters:**
A portable engine unlocks product capabilities that are hard to build otherwise: instant what-if scenarios (Feature 4), AI-grounded calculations ("This deduction would save you $1,200" is a computed fact, not a guess), and dramatically faster test cycles. It's the foundation that makes Features 4, 5, 7, and 10 possible.

**Effort:** High | **Risk:** Medium (significant refactoring, but highest-leverage long-term investment)

---

### Lighter-Touch Ideas

These are smaller features that could be quick wins or components of larger experiments.

---

#### 16. Voice Input for Chat

**What it does:** Web Speech API dictation in the AI assistant — speak instead of type. Particularly valuable for mobile users and accessibility. Reduces input friction for users who find it easier to describe their tax situation verbally.

**Primary metric:** S2C (mobile) | **Effort:** Low | **Risk:** Very low

---

#### 17. Local Intent Detection (Fast Path)

**What it does:** Simple queries like "go to dependents" or "delete my second W-2" are resolved by a deterministic parser instantly — no LLM round-trip. The AI chat only activates for genuinely complex questions. This makes the assistant feel faster for routine tasks.

**Primary metric:** PRS (assistant responsiveness) | **Effort:** Low | **Risk:** Very low

---

## Priority Matrix

| # | Feature | Primary Metric | Customer Impact | Effort | Risk |
|---|---------|---------------|----------------|--------|------|
| 10 | AI Quality Gates | PRS | High | Low | Very Low |
| 17 | Local Intent Detection | PRS | Medium | Low | Very Low |
| 16 | Voice Input | S2C (mobile) | Low-Medium | Low | Very Low |
| 11 | Privacy Audit Log | PRS | Medium | Low-Medium | Very Low |
| 7 | Explain My Taxes | PRS, S2C | Medium-High | Medium | Very Low |
| 5 | Proactive Nudges | S2C, ARPC | High | Medium | Low |
| 1 | Dual-Mode Search | S2C | Medium-High | Medium | Low |
| 3 | Document Import | S2C | High | Medium | Low |
| 8 | Competitor Import | Acquisition | Medium | Medium | Low |
| 12 | YoY Comparison | C2C | Medium | Medium | Low |
| 13 | Audit Risk Tool | PRS, Attach | Medium | Medium | Low |
| 9 | PII-Visible AI | PRS, C2C | High | Medium | Low |
| 14 | Tax Year Registry | Operational | High (internal) | Medium | Low |
| 6 | Expense Scanner | ARPC | High | Medium-High | Low-Medium |
| 2 | AI Action Cards | S2C | Very High | Medium-High | Low |
| 4 | What-If Scenarios | S2C, ARPC | High | High | Low |
| 15 | Portable Engine | Operational | Very High (internal) | High | Medium |

### Recommended Sequencing

**Start here (this quarter, low effort, low risk):**
- **AI Quality Gates (#10)** — Build the eval harness, commit a baseline, enforce on changes. Immediate quality signal, zero customer risk.
- **Local Intent Detection (#17)** — Makes the assistant feel faster. Small code change, big UX improvement.
- **Privacy Audit Log (#11)** — Customer-visible transparency. Differentiated positioning.

**Next season (medium effort, testable via IXP):**
- **Dual-Mode Search (#1)** — A/B test navigational search vs chat-only search.
- **Proactive Nudges (#5)** — Deterministic missed-money detection with contextual banners.
- **Document Import (#3)** — One-click PDF-to-return for W-2s and 1099s.
- **Explain My Taxes (#7)** — Visual breakdowns reduce anxiety and improve PRS.
- **YoY Comparison (#12)** — Returning customer experience improvement targeting C2C.

**Strategic (multi-season, higher effort, compounding returns):**
- **AI Action Cards (#2)** — Transform the digital assistant from advisor to actor.
- **Expense Scanner (#6)** — Deduction discovery for SE and itemizers.
- **What-If Scenarios (#4)** — Real-time scenario modeling for decision-heavy steps.
- **Portable Engine (#15)** — Foundation for features 2, 4, 5, 7, and 10.

---

## How to Validate Each Feature

Every feature above fits TurboTax's existing experimentation framework:

**For product features (1-9, 11-13, 16-17):**
- Assign via **IXP**, 50/50 or 80/20 split
- Primary metric: **S2C** (the playbook default for product tests)
- Secondary: **ARPC** (ensure revenue is not harmed)
- Monitor via **alphabeta** testing app
- Use **Bayesian AB** to assess risk rather than waiting for classical significance
- Cut results by **New/Returning** and **Free/Paid** to check for Simpson's Paradox (the playbook explicitly warns about this)
- Control for **product depth** — don't compare users at different funnel stages

**For monetization features (6, 13):**
- Primary metric may shift to **ARPC** or **attach rate** (Plus/Max)
- These align with the playbook's note that "for Product Lineup tests, driving incremental ARPC is in many instances the primary metric"

**For internal capabilities (10, 14, 15):**
- Not A/B testable — measure via trailing indicators: PRS trend, regression rate, season standup velocity, contact rate

**For retention features (12):**
- C2C is measured cross-season — design the experiment this year, read the retention impact next year
- Use C2A and C2S as early-season proxies (as the playbook recommends)

---

## Demo

If you'd like to see these features working together, the walkthrough takes 10 minutes:

1. **Search** — Press Cmd+K. Type "W-2." Watch the command palette show step navigation, help articles, and data shortcuts — without opening a chat.
2. **Document import** — Upload a W-2 PDF. See AI extraction → preview card → "Add to Return" in one click.
3. **AI action cards** — Ask "What deductions am I eligible for?" See the AI suggest specific actions with preview cards, not just text.
4. **Proactive nudge** — Navigate to deductions with SE income present. See a "You may be eligible for the home office deduction" nudge banner.
5. **What-if** — Open the Scenario Lab. Change IRA contribution from $0 to $6,500. See the tax impact in milliseconds.
6. **Explain My Taxes** — Open the panel. See bracket chart, tax flow diagram, and line-by-line traces.
7. **Privacy** — Open the audit log. See every AI interaction logged with what was sent and what was blocked.
8. **Eval harness** — Run the suite: 61 fixtures, 96.7% accuracy, 0% tax harm.

---

## Appendix: How to Reproduce Each Feature in Nimbus

Prerequisites for all features: run `npm run dev` from the project root. The app opens at `http://localhost:5173`. On first launch you'll set an encryption passphrase, then land on the dashboard. Create or open a return to reach the wizard at `/return/:id`.

> **Tip:** Press `?` at any time (when not focused on an input) to see the full keyboard shortcuts modal.

---

### Feature 1 — Dual-Mode Search (Command Palette)

**Steps:**
1. Open any return (you should be on the wizard view at `/return/:id`).
2. Press **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux). The command palette overlay appears.
3. Type a navigational query: `W-2`, `dependents`, `filing status`, or `HSA`.
4. Observe inline results with highlighted matches — wizard steps, tools, help articles, and data shortcuts appear instantly.
5. Select a result. The palette closes and you navigate directly to that step or tool — no chat opens.
6. Open the palette again (Cmd+K) and type a tool name: `Scenario Lab` or `Explain`. Select it to jump to that tool.

**What to screenshot/record:** The palette overlay with multiple result categories, the highlighted match text, and the direct navigation (no chat intermediate).

---

### Feature 2 — AI Action Cards (Structured Suggestions)

**Prerequisites:** Ensure the Anthropic API key is set in `server/.env` as `ANTHROPIC_API_KEY=sk-ant-...`. The app uses BYOK mode by default.

**Steps:**
1. Open a return and enter some basic income data (e.g., add a W-2 with wages of $75,000 from any employer).
2. Open the AI chat panel: click the floating **Nimbus AI** sparkle button (bottom-right) or press **Cmd+J**.
3. Accept the privacy disclaimer on first use.
4. Type: `Add a 1099-INT from Chase Bank for $1,200 in interest income`
5. Watch the streaming response. The AI returns both a text explanation and a **structured action card** — a previewable card showing the proposed income addition with specific field values.
6. Click **Apply** on the action card to add it to the return, or **Dismiss** to reject it.
7. After applying, notice the **Undo** option — click it to revert the action.
8. Try a navigation intent: type `Go to dependents`. The local intent detector resolves this instantly (no LLM call) and navigates you.

**What to screenshot/record:** The action preview card (showing proposed values), the Apply/Dismiss buttons, the Undo capability, and the instant local intent resolution for "Go to dependents."

---

### Feature 3 — One-Click Document Import

**Prerequisites:** Anthropic API key configured (for AI extraction). Have a sample W-2 or 1099 PDF ready.

**Steps:**
1. Open a return. Navigate to **Import Data** (in the My Info section of the sidebar, or press Cmd+K and type `Import`).
2. Click the **"PDF and Image Import"** card.
3. Upload a W-2 PDF (drag and drop or click to browse).
4. Watch the extraction progress — the system runs Docling (local OCR) with Claude Vision as fallback.
5. A preview card appears showing all extracted fields: employer name, wages, federal tax withheld, state info, etc.
6. Review and edit any field if needed.
7. Click **"Add to Return"** — the data is added to your income in one action.
8. Navigate to the W-2 income step to verify the data was populated.

**What to screenshot/record:** The upload action, the extraction progress indicator, the preview card with all fields, and the single "Add to Return" confirmation.

---

### Feature 4 — Real-Time What-If Scenarios (Scenario Lab)

**Prerequisites:** Enter enough income data for the tax engine to produce a calculation (at minimum, a W-2 with wages). The Scenario Lab tool requires minimum income data to be enabled.

**Steps:**
1. With income data entered, open the sidebar **Tools** section.
2. Click **"Tax Scenario Lab"** (or press Cmd+K and type `Scenario`).
3. The lab opens showing your current tax calculation as the baseline.
4. Click **"New Scenario"** to create a comparison scenario.
5. Adjust a variable — e.g., add a $6,500 Traditional IRA contribution, or change filing status from Single to Married Filing Jointly.
6. Watch the tax impact recalculate instantly (no loading spinner, no server call).
7. The comparison dashboard shows the delta: "This scenario saves you $1,430."
8. Try the **Sensitivity** view — use sliders to sweep a variable across a range and see the impact curve.

**What to screenshot/record:** The side-by-side comparison, the instant recalculation, and the sensitivity slider view.

---

### Feature 5 — Proactive Missed-Money Nudges

**Prerequisites:** Enter data that triggers a nudge. The easiest triggers:
- Add **self-employment income** (1099-NEC) but do NOT add any business expenses or home office deduction.
- Or enter income that makes you eligible for credits you haven't claimed.

**Steps:**
1. Enter self-employment income: navigate to 1099-NEC, add a payer with $50,000 in nonemployee compensation.
2. Navigate to the **Deductions** section (use the sidebar step list).
3. Observe the **nudge banner** at the top of the step: "You reported self-employment income but haven't added a home office deduction" or similar.
4. The nudge offers three actions: **"Take me there"** (navigates to the relevant step), **"Dismiss"** (hides it), or **"Ask AI"** (opens chat with a contextual prompt).
5. Click "Take me there" to navigate to the home office deduction step.
6. Dismiss a nudge and confirm it doesn't reappear on that step.

**What to screenshot/record:** The contextual nudge banner, the three action buttons, and the navigation flow.

---

### Feature 6 — Expense Scanner / Deduction Discovery

**Prerequisites:** Have a CSV bank or credit card statement ready (Chase, Bank of America, Amex, Wells Fargo, or generic CSV). AI categorization requires the Anthropic API key.

**Steps:**
1. Open sidebar **Tools** and click **"Expense Scanner"** (or Cmd+K → `Expense Scanner`).
2. Upload a CSV bank statement (drag and drop or browse).
3. The system auto-detects the bank format and parses transactions.
4. Pattern matching runs first (deterministic) — transactions matching common deduction patterns are flagged.
5. Click **"AI Categorize"** to run AI categorization across all transactions into 17 tax categories.
6. Review the categorization dashboard: each category shows transaction count and total amount.
7. Select categories to approve, reclassify any mismatched transactions.
8. Click **"Apply to Return"** — approved deductions are pushed into Schedule C or itemized deductions.

**What to screenshot/record:** The CSV upload, auto-detection, the categorization dashboard with totals, and the "Apply to Return" flow.

---

### Feature 7 — "Explain My Taxes" Visualizations

**Prerequisites:** Enter enough income data for the engine to produce a calculation (at minimum a W-2).

**Steps:**
1. With a live calculation running (you'll see the refund/owed estimate in the header), click the **"Explain My Taxes"** button in the wizard header.
2. The panel slides open with interactive visualizations:
   - **Tax Flow Diagram** — where your money goes (income → adjustments → deductions → credits → tax)
   - **Bracket Chart** — your marginal vs effective rate, with your income plotted on the bracket scale
   - **Waterfall** — income breakdown showing additions and subtractions
   - **Trace Tree** — every line on your return linked to its IRC section
3. Click any element to see more detail. Try hovering over a bracket in the bracket chart.
4. Alternatively, open the full-page version: sidebar **Tools → Explain My Taxes** (or Cmd+K → `Explain`).

**What to screenshot/record:** Each visualization type (tax flow, bracket chart, waterfall, trace tree), the interactivity, and the IRC authority links.

---

### Feature 8 — Competitive Return Import

**Prerequisites:** Have a prior-year 1040 PDF from TurboTax, H&R Block, TaxAct, or FreeTaxUSA.

**Steps:**
1. Navigate to **Import Data** (sidebar or Cmd+K).
2. Click **"Switch from Another Provider"** card.
3. Upload the competitor's 1040 PDF.
4. The system auto-detects which product generated the PDF and extracts personal info + financial line items.
5. A review screen appears with **confidence badges** (high/medium/low) per field.
6. Choose import mode: **"Current-year prefill"** (uses the data to pre-fill this year's return) or **"Prior-year summary"** (stores as a comparison baseline for the YoY tool).
7. Review and confirm.

**What to screenshot/record:** The auto-detection of the competitor product, the review screen with confidence badges, and the two import mode options.

---

### Feature 9 — PII-Stripped AI Pipeline

**Prerequisites:** Anthropic API key configured. Have the AI chat open.

**Steps:**
1. Open the AI chat (Cmd+J or sparkle button).
2. Type a message that includes sensitive-looking data: `My SSN is 123-45-6789 and I earned $75,000`
3. Observe the **PII warning** that appears before the message is sent — the system detects the SSN pattern.
4. The message is sent with the SSN stripped (you can verify by checking the server logs which show `[PII stripped]` markers).
5. The AI responds with full tax context (income amount, filing situation) but without the SSN.

**Note:** The Privacy Audit Log panel (`PrivacyAuditPanel`) exists in the codebase but is not currently wired to a UI entry point. To demonstrate the audit log concept, you can reference the component at `client/src/components/chat/PrivacyAuditPanel.tsx` — it shows a log of all outbound requests with blocked fields.

**What to screenshot/record:** The PII warning on the input, the stripped message in transit, and the AI responding with context but without sensitive identifiers.

---

### Feature 10 — AI Quality Gates (Eval Baselines)

**This is a developer-facing feature, not a UI feature.**

**Steps:**
1. From the project root, run the eval suite:
   ```
   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/eval-prompt.ts
   ```
2. The harness runs 61 fixtures across 6 categories against the live model.
3. Results are scored on 8 dimensions and written to `evals/baseline.json`.
4. Show the baseline file: `evals/baseline.json` — it contains accuracy, hallucination rate, tax harm rate, and per-fixture results.
5. Show the committed baseline and the "no eval, no merge" policy.

**What to screenshot/record:** The eval runner output (fixture categories, pass/fail counts), the baseline JSON, and the 96.7% accuracy / 0% tax harm scores.

---

### Feature 11 — Privacy Audit Log

**Note:** The Privacy Audit Log component exists at `client/src/components/chat/PrivacyAuditPanel.tsx` but is not currently wired to a clickable entry point in the UI (the settings panel that would link to it was removed in an earlier cleanup). The underlying logging service (`client/src/services/privacyAuditLog.ts`) is active and recording entries whenever AI chat is used.

**To demonstrate the concept:** Reference the component code and the log entries that accumulate in the chat store after any AI interaction.

---

### Feature 12 — Year-over-Year Comparison

**Prerequisites:** Import a prior-year summary (via the Competitor Import flow with "Prior-year summary" mode, or manually).

**Steps:**
1. Open sidebar **Tools** and click **"Year-over-Year"** (or Cmd+K → `Year-over-Year`).
2. The tool shows a comparison: current return figures vs prior-year stored summary.
3. Each category shows the delta: income up/down, deductions changed, credits gained/lost, refund change.
4. Click **"Import Prior-Year Templates"** — this clones your prior employers and payers as empty stubs for this year, so you start with structure rather than a blank form.

**What to screenshot/record:** The side-by-side comparison, the delta indicators, and the template import flow.

---

### Feature 13 — Audit Risk Assessment

**Prerequisites:** Enter enough income and deduction data for the engine to score risk factors (at minimum income + some itemized deductions).

**Steps:**
1. Open sidebar **Tools** and click **"Audit Risk"** (or Cmd+K → `Audit Risk`).
2. The tool displays your return's risk profile with scored factors.
3. Each factor shows the source (IRS data book, GAO report) and an explanation: e.g., "Charitable deductions at 28% of AGI — IRS threshold for closer review is ~25%."
4. The overall risk assessment (low / moderate / elevated) is shown with a summary.

**What to screenshot/record:** The risk factor list with sources, the individual factor explanations, and the overall risk level.

---

### Feature 16 — Voice Input

**Prerequisites:** Use Chrome or another browser that supports the Web Speech API. Chat must be open.

**Steps:**
1. Open the AI chat (Cmd+J).
2. In the chat input area, click the **microphone icon**.
3. Speak: "Add a W-2 from Google with wages of $150,000."
4. Watch the speech-to-text transcription appear in the input field.
5. Press Enter to send (or edit before sending).

**What to screenshot/record:** The microphone button, the real-time transcription, and the resulting AI response.

---

### Feature 17 — Local Intent Detection (Fast Path)

**Steps:**
1. Open the AI chat (Cmd+J).
2. Type: `Go to dependents`
3. Observe: the response is **instant** — no loading spinner, no streaming. The local intent detector matches the navigational pattern and executes immediately.
4. Type: `Go to W-2`
5. Again, instant navigation with no LLM round-trip.
6. Now type a complex question: `What deductions am I eligible for?` — this goes through the LLM (you'll see the streaming indicator).

**What to screenshot/record:** The contrast between instant local-intent responses and LLM-streamed responses for complex questions.

---

### Bonus: Forms Mode

**Prerequisites:** Income data entered so a calculation exists.

**Steps:**
1. Look at the sidebar — when a calculation exists, you'll see an **Interview | Forms** toggle near the top.
2. Click **Forms** (or press **Cmd+\\**).
3. The view switches to a PDF form workspace: Form 1040 rendered with your data populated.
4. Use the sidebar to switch between forms (Schedule A, Schedule C, etc.).
5. Use the search bar in the forms sidebar to find forms by name or description.
6. Toggle back to Interview mode (**Cmd+\\**) to return to the guided wizard.

**What to screenshot/record:** The interview-to-forms toggle, the populated PDF form, and the form search.

---

### Quick Reference: All Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Cmd+K** | Open/close command palette (search) |
| **Cmd+J** | Open/close AI chat |
| **Cmd+Enter** | Next wizard step |
| **Cmd+Shift+Enter** | Previous wizard step |
| **Cmd+\\** | Toggle Interview / Forms mode |
| **Cmd+S** | Flash save indicator |
| **?** | Open keyboard shortcuts help |
| **Esc** | Close modal / stop AI generation |

---

## What Nimbus Is Not

- **Not a production product.** A prototype that validates feature ideas.
- **Not a TurboTax replacement.** The features are the deliverable, not the app.
- **Not using proprietary Intuit data or code.** Built from public IRS publications and Treasury Regulations.
