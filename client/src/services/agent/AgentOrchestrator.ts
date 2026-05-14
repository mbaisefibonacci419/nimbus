/**
 * Agent Mode Orchestrator
 *
 * State machine that manages the agent-led tax interview.
 * Selects skills, tracks completion, handles topic detours,
 * and builds the minimal LLM context for each skill.
 */

import type { TaxReturn, CalculationResult } from '@nimbus/engine';
import type { ChatAction } from '@nimbus/engine';
import { SKILL_REGISTRY, type SkillRegistryEntry } from './SkillRegistry';
import { buildContextSlice } from './ContextSlicer';
import { detectTopicSwitch } from './TopicDetector';

// ─── Agent State ──────────────────────────────────

export type AgentPhase =
  | 'onboarding'
  | 'income'
  | 'self_employment'
  | 'deductions'
  | 'credits'
  | 'state'
  | 'review'
  | 'finish';

export interface AgentSkillCompletion {
  completedAt: string;
  turnCount: number;
}

export interface AgentState {
  phase: AgentPhase;
  activeSkill: string | null;
  completed: Record<string, AgentSkillCompletion>;
  skipped: string[];
  blocked: string[];
  currentTurnCount: number;
  totalTurnCount: number;
  detourSkill: string | null;
  returnToSkill: string | null;
}

export function createInitialAgentState(): AgentState {
  return {
    phase: 'onboarding',
    activeSkill: null,
    completed: {},
    skipped: [],
    blocked: [],
    currentTurnCount: 0,
    totalTurnCount: 0,
    detourSkill: null,
    returnToSkill: null,
  };
}

// ─── Orchestrator ─────────────────────────────────

export class AgentOrchestrator {
  private state: AgentState;

  constructor(state?: AgentState) {
    this.state = state ?? createInitialAgentState();
  }

  getState(): AgentState {
    return this.state;
  }

  /**
   * Scan the TaxReturn and auto-mark skills whose completion
   * criteria are already met (e.g., user filled data in Interview mode).
   */
  syncCompletionFromReturn(taxReturn: TaxReturn): void {
    for (const entry of SKILL_REGISTRY) {
      if (this.state.completed[entry.id]) continue;
      if (this.state.skipped.includes(entry.id)) continue;
      if (entry.isComplete(taxReturn)) {
        this.state.completed[entry.id] = {
          completedAt: new Date().toISOString(),
          turnCount: this.state.activeSkill === entry.id
            ? this.state.currentTurnCount
            : 0,
        };
      }
    }

    // Clear activeSkill if it was just marked complete
    if (this.state.activeSkill && this.state.completed[this.state.activeSkill]) {
      this.state.activeSkill = null;
      this.state.currentTurnCount = 0;
    }

    this.state.phase = this.determinePhase();
  }

  /**
   * Select the next skill to activate. Returns null when all done.
   */
  selectNextSkill(taxReturn: TaxReturn): string | null {
    if (this.state.detourSkill) return this.state.detourSkill;

    if (
      this.state.activeSkill &&
      !this.isSkillComplete(this.state.activeSkill, taxReturn)
    ) {
      return this.state.activeSkill;
    }

    for (const entry of SKILL_REGISTRY) {
      if (this.state.completed[entry.id]) continue;
      if (this.state.skipped.includes(entry.id)) continue;
      if (!entry.isRelevant(taxReturn)) continue;
      if (entry.prerequisites.some((p) => !this.state.completed[p])) continue;
      return entry.id;
    }

    if (!this.state.completed['review']) return 'review';
    return null;
  }

  /**
   * Activate a skill — called when the orchestrator picks one.
   */
  activateSkill(skillId: string): void {
    if (this.state.activeSkill !== skillId) {
      this.state.currentTurnCount = 0;
    }
    this.state.activeSkill = skillId;
    const entry = SKILL_REGISTRY.find((s) => s.id === skillId);
    if (entry) {
      this.state.phase = entry.phase;
    }
  }

  /**
   * Record a conversational turn within the active skill.
   */
  recordTurn(): void {
    this.state.currentTurnCount++;
    this.state.totalTurnCount++;
  }

  /**
   * Mark the active skill as complete.
   */
  completeActiveSkill(): void {
    const id = this.state.activeSkill;
    if (!id) return;

    this.state.completed[id] = {
      completedAt: new Date().toISOString(),
      turnCount: this.state.currentTurnCount,
    };

    if (this.state.detourSkill === id) {
      this.state.detourSkill = null;
      this.state.activeSkill = this.state.returnToSkill;
      this.state.returnToSkill = null;
      this.state.currentTurnCount = 0;
    } else {
      this.state.activeSkill = null;
      this.state.currentTurnCount = 0;
    }

    this.state.phase = this.determinePhase();
  }

  /**
   * Skip the active skill.
   */
  skipActiveSkill(): void {
    const id = this.state.activeSkill;
    if (!id) return;
    this.state.skipped.push(id);
    this.state.activeSkill = null;
    this.state.currentTurnCount = 0;
    this.state.phase = this.determinePhase();
  }

  /**
   * Handle a user message that might trigger a topic switch.
   * Returns the detour skill ID or null if no switch detected.
   */
  handleTopicSwitch(
    message: string,
    taxReturn: TaxReturn,
  ): string | null {
    if (this.state.detourSkill) return null; // no nested detours

    const detected = detectTopicSwitch(message, this.state.activeSkill);
    if (!detected) return null;

    this.state.returnToSkill = this.state.activeSkill;
    this.state.detourSkill = detected;
    this.state.activeSkill = detected;
    this.state.currentTurnCount = 0;

    return detected;
  }

  /**
   * Build the system prompt for the active skill's LLM call.
   */
  buildPrompt(
    taxReturn: TaxReturn,
    calculation: CalculationResult | null,
    skillPromptText: string,
  ): string {
    const activeId = this.state.activeSkill;
    const entry = SKILL_REGISTRY.find((s) => s.id === activeId);
    if (!entry) return skillPromptText;

    const contextSlice = buildContextSlice(taxReturn, calculation, entry);
    const returnSummary = this.buildReturnSummary(taxReturn, calculation);

    return [
      this.buildOrchestratorFrame(entry, taxReturn, calculation),
      '',
      '## Skill Instructions',
      skillPromptText,
      '',
      '## Current Return Data (for this skill)',
      '```json',
      JSON.stringify(contextSlice, null, 2),
      '```',
      '',
      '## Return Progress Summary',
      returnSummary,
    ].join('\n');
  }

  /**
   * Validate that a set of actions comply with the active skill's contract.
   */
  validateActions(
    actions: ChatAction[],
  ): { valid: ChatAction[]; rejected: ChatAction[] } {
    const activeId = this.state.activeSkill;
    const entry = SKILL_REGISTRY.find((s) => s.id === activeId);

    if (!entry) {
      return { valid: [], rejected: actions };
    }

    const valid: ChatAction[] = [];
    const rejected: ChatAction[] = [];

    for (const action of actions) {
      if (entry.allowedActionTypes.includes(action.type)) {
        valid.push(action);
      } else {
        rejected.push(action);
      }
    }

    return { valid, rejected };
  }

  /**
   * Build a proactive transition message for advancing to the next skill.
   * Returns null if all skills are complete.
   */
  buildTransitionMessage(
    taxReturn: TaxReturn,
  ): { message: string; options?: Array<{ label: string; value: string; description?: string }> } | null {
    const nextSkillId = this.selectNextSkill(taxReturn);
    if (!nextSkillId) {
      return {
        message: "Your return looks complete! Let's review everything to make sure nothing was missed.",
        options: [
          { label: 'Start Review', value: 'Yes, let\'s review my return' },
          { label: 'I have more to add', value: 'Wait, I have more information to add' },
        ],
      };
    }

    const entry = SKILL_REGISTRY.find((s) => s.id === nextSkillId);
    if (!entry) return null;

    const completedCount = Object.keys(this.state.completed).length;
    const totalRelevant = SKILL_REGISTRY.filter((s) => s.isRelevant(taxReturn)).length;
    const progressNote = completedCount > 0 ? ` (${completedCount}/${totalRelevant} sections done)` : '';

    switch (entry.interactionMode) {
      case 'fast-capture':
        return {
          message: `Got it! Moving on${progressNote} — **${entry.domain}**. Do you have this info ready?`,
          options: [
            { label: 'Yes, let\'s go', value: `Yes, I'm ready for ${entry.domain}` },
            { label: 'I have a document', value: `I have a document for ${entry.domain}` },
            { label: 'Skip this', value: `Skip ${entry.domain}` },
          ],
        };

      case 'exploratory':
        return {
          message: `Nice progress${progressNote}! Now let's look at **${entry.domain}** — this is where I can help you find money you might be leaving on the table.`,
          options: [
            { label: 'Let\'s explore', value: `Let's look at ${entry.domain}` },
            { label: 'I know what I have', value: `I already know my ${entry.domain.toLowerCase()}` },
            { label: 'Skip this', value: `Skip ${entry.domain}` },
          ],
        };

      case 'confirmation':
        return {
          message: `Almost there${progressNote}! Let's do a quick **${entry.domain}** to make sure everything looks right.`,
          options: [
            { label: 'Let\'s review', value: `Yes, let's review` },
            { label: 'I want to add more first', value: 'Wait, I want to go back and add something' },
          ],
        };

      case 'half-sheet':
        return {
          message: `Next up${progressNote}: **${entry.domain}**. This one has a few details — I'll pre-fill what I can.`,
          options: [
            { label: 'Let\'s do it', value: `Ready for ${entry.domain}` },
            { label: 'I have a document', value: `I have a document for ${entry.domain}` },
            { label: 'Skip this', value: `Skip ${entry.domain}` },
          ],
        };
    }
  }

  /**
   * Check if the current skill might be stuck (over 2x expected turns).
   */
  isSkillStuck(): boolean {
    const entry = SKILL_REGISTRY.find((s) => s.id === this.state.activeSkill);
    if (!entry) return false;
    return this.state.currentTurnCount > entry.expectedTurns * 2;
  }

  // ─── Private Helpers ──────────────────────────────

  private isSkillComplete(skillId: string, taxReturn: TaxReturn): boolean {
    const entry = SKILL_REGISTRY.find((s) => s.id === skillId);
    return entry ? entry.isComplete(taxReturn) : false;
  }

  private determinePhase(): AgentPhase {
    const phases: AgentPhase[] = [
      'onboarding', 'income', 'self_employment', 'deductions',
      'credits', 'state', 'review', 'finish',
    ];

    for (const phase of phases) {
      const phaseSkills = SKILL_REGISTRY.filter((s) => s.phase === phase);
      const allDone = phaseSkills.every(
        (s) => this.state.completed[s.id] || this.state.skipped.includes(s.id),
      );
      if (!allDone) return phase;
    }
    return 'finish';
  }

  private buildOrchestratorFrame(
    entry: SkillRegistryEntry,
    taxReturn: TaxReturn,
    calculation: CalculationResult | null,
  ): string {
    const f = calculation?.form1040;
    const refundOrOwed = f
      ? f.refundAmount > 0
        ? `Refund: $${f.refundAmount.toLocaleString()}`
        : `Owed: $${f.amountOwed.toLocaleString()}`
      : 'Not yet calculated';

    const depCount = taxReturn.dependents?.length ?? 0;
    const filingStatus = taxReturn.filingStatus
      ? ['', 'Single', 'Married Filing Jointly', 'Married Filing Separately', 'Head of Household', 'Qualifying Surviving Spouse'][taxReturn.filingStatus]
      : 'not yet set';

    const modeInstructions: Record<string, string> = {
      'fast-capture': `INTERACTION MODE: fast-capture
The user likely has this data ready (documents or memory). Be brief — confirm what you see in 1-3 turns.
When presenting choices, ALWAYS include an "options" array with structured {label, value, description} objects.
Example: filing status → options: [{label: "Single", value: "single"}, {label: "Married Filing Jointly", value: "mfj"}, ...]
Prefer document scan → pill confirmation over open-ended questions.`,
      'exploratory': `INTERACTION MODE: exploratory
The user may not know what applies here. Your job is to DISCOVER and EXPLAIN VALUE.
Ask discovery questions, preview dollar benefits ("That childcare expense could save you ~$2,100..."), and show your work.
Take 3-8 turns. Don't rush — this is where users feel the value of the agent.

MANDATORY: When you ask the user about categories (e.g., "Did any of these apply?"), you MUST include
every category as a structured option in the "options" array. NEVER list categories only in the message text.
Each option should have {label, value, description}. Example for credits:
  "options": [
    {"label": "Child Tax Credit", "value": "child_credit", "description": "Children under 17"},
    {"label": "Education Credits", "value": "education_credit", "description": "College tuition (AOTC/LLC)"},
    {"label": "None of these", "value": "none", "description": "Skip to the next section"}
  ]
The "None of these" option should always be last. For yes/no questions, use:
  "options": [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}]`,
      'confirmation': `INTERACTION MODE: confirmation
Summarize what has been collected. Ask "Does this look right? Anything to add?"
Keep it to 1-2 turns. Use a concise summary, not field-by-field replay.`,
      'half-sheet': `INTERACTION MODE: half-sheet
This topic has many fields. Pre-fill what you can from context and present structured data entry.
Use the "options" array for any choices. For multi-field data, describe what you've pre-filled and ask the user to confirm or correct.`,
    };

    return `You are a tax preparation agent for Nimbus. You are currently helping the user with: ${entry.domain}.

${modeInstructions[entry.interactionMode] || ''}

You must respond with ONLY valid JSON (no markdown fences, no text before or after):
{ "message": "...", "actions": [...], "suggestedStep": null, "options": [...], "followUpChips": [...] }

CRITICAL — "options" rendering:
The "options" array contains structured choices as {label, value, description} objects.
These are rendered as tappable pills in the UI — the user clicks them instead of typing.
When presenting ANY list of choices (yes/no, categories, filing statuses), you MUST use "options".
NEVER list choices only in the "message" text — the UI cannot render those as interactive elements.
If there are no choices to present, omit the "options" field entirely.

MULTI-SELECT: When the user can choose MORE THAN ONE option (e.g., "select all that apply",
multiple income types, multiple credits, multiple deduction categories), set "multiSelect": true
at the top level of your JSON response. This renders checkboxes so the user can toggle several
options before confirming. Always include a "None of these" escape option for these cases.
For single-choice questions (filing status, yes/no), do NOT set multiSelect.

You may ONLY emit the following action types: ${entry.allowedActionTypes.join(', ')}

## Action Schemas
${this.buildActionSchemas(entry)}

Current return summary:
- Filing status: ${filingStatus}
- Dependents: ${depCount}
- Income entered: ${this.summarizeCompletedSkills('income')}
- Deductions: ${this.summarizeCompletedSkills('deductions')}
- Credits: ${this.summarizeCompletedSkills('credits')}
- Current estimate: ${refundOrOwed}

## Section Completion
${this.buildCompletionInstructions(entry)}

The user may ask about topics outside your current domain. If they do, respond with:
{ "message": "...", "actions": [{"type": "no_action"}], "topicSwitch": "{detected_skill_id}" }
The orchestrator will handle the transition.`;
  }

  private buildReturnSummary(
    taxReturn: TaxReturn,
    calculation: CalculationResult | null,
  ): string {
    const lines: string[] = [];
    for (const entry of SKILL_REGISTRY) {
      const status = this.state.completed[entry.id]
        ? '✓ completed'
        : this.state.skipped.includes(entry.id)
          ? '○ skipped'
          : entry.id === this.state.activeSkill
            ? '● in progress'
            : '· pending';
      lines.push(`- ${entry.domain}: ${status}`);
    }
    return lines.join('\n');
  }

  private summarizeCompletedSkills(phase: AgentPhase): string {
    const completed = SKILL_REGISTRY
      .filter((s) => s.phase === phase && this.state.completed[s.id])
      .map((s) => s.domain);

    return completed.length > 0 ? completed.join(', ') : 'none yet';
  }

  /**
   * Build explicit instructions telling the LLM how to signal that a section
   * is complete, especially for the "user has nothing" path.
   */
  private buildCompletionInstructions(entry: SkillRegistryEntry): string {
    const COMPLETION_MAP: Record<string, string> = {
      'filing-status': `Present the filing status choices as an "options" array in your FIRST response. You MUST include:
  "options": [
    {"label": "Single", "value": "single", "description": "Unmarried, or legally separated"},
    {"label": "Married Filing Jointly", "value": "married_filing_jointly", "description": "Married and filing one combined return"},
    {"label": "Married Filing Separately", "value": "married_filing_separately", "description": "Married but filing individual returns"},
    {"label": "Head of Household", "value": "head_of_household", "description": "Unmarried, paid >50% of home costs for a dependent"},
    {"label": "Qualifying Surviving Spouse", "value": "qualifying_surviving_spouse", "description": "Spouse died in the last 2 years, with a dependent child"}
  ]
When the user selects one, emit: { "type": "set_filing_status", "status": "<selected_value>" }`,
      'dependents': `When the user confirms they have NO dependents, you MUST emit:
  { "type": "set_income_discovery", "incomeType": "dependents_asked", "value": "yes" }
This marks the section complete so the orchestrator advances. Do NOT just say "okay" — emit the action.`,
      'income-wages': `When the user says they have no W-2 income, emit:
  { "type": "set_income_discovery", "incomeType": "w2", "value": "no" }`,
      'income-freelance': `When the user has no freelance/gig income, emit both:
  { "type": "set_income_discovery", "incomeType": "1099nec", "value": "no" }
  { "type": "set_income_discovery", "incomeType": "1099k", "value": "no" }`,
      'income-investments': `When the user has no investment income, emit:
  { "type": "set_income_discovery", "incomeType": "1099b", "value": "no" }
  { "type": "set_income_discovery", "incomeType": "1099div", "value": "no" }
  { "type": "set_income_discovery", "incomeType": "1099int", "value": "no" }`,
      'income-retirement': `When the user has no retirement/SS income, emit:
  { "type": "set_income_discovery", "incomeType": "1099r", "value": "no" }
  { "type": "set_income_discovery", "incomeType": "ssa1099", "value": "no" }
  { "type": "set_income_discovery", "incomeType": "1099g", "value": "no" }`,
      'income-other': `When asking about other income categories, set "multiSelect": true and present them as options:
  "options": [
    {"label": "Gambling winnings (W-2G)", "value": "w2g", "description": "Casino, lottery, sports betting"},
    {"label": "HSA distributions (1099-SA)", "value": "1099sa", "description": "Health Savings Account withdrawals"},
    {"label": "Alimony received", "value": "alimony", "description": "From a divorce agreement before 2019"},
    {"label": "Other miscellaneous", "value": "other", "description": "Jury duty, prizes, hobby income"},
    {"label": "None of these", "value": "none", "description": "No other income to report"}
  ]
When the user confirms no other income (or selects "None of these"), emit:
  { "type": "set_income_discovery", "incomeType": "other_income_asked", "value": "yes" }`,
      'deductions-above-line': `When asking about above-the-line deductions, set "multiSelect": true and present them as options:
  "options": [
    {"label": "HSA contributions", "value": "hsa", "description": "Health Savings Account"},
    {"label": "Student loan interest", "value": "student_loan", "description": "Up to $2,500"},
    {"label": "IRA contributions", "value": "ira", "description": "Traditional IRA deduction"},
    {"label": "Educator expenses", "value": "educator", "description": "K-12 teacher supplies, up to $300"},
    {"label": "None of these", "value": "none", "description": "No above-the-line deductions"}
  ]
When the user has no above-the-line deductions (or selects "None of these"), emit:
  { "type": "set_income_discovery", "incomeType": "above_line_asked", "value": "yes" }`,
      'credits': `When asking about tax credits, set "multiSelect": true and present them as options:
  "options": [
    {"label": "Child Tax Credit", "value": "child_credit", "description": "Children under 17"},
    {"label": "Education credits", "value": "education_credit", "description": "AOTC or Lifetime Learning"},
    {"label": "Dependent care", "value": "dependent_care", "description": "Childcare/daycare expenses"},
    {"label": "Clean energy", "value": "clean_energy", "description": "Solar panels, insulation, windows"},
    {"label": "EV credit", "value": "ev_credit", "description": "Electric vehicle purchase"},
    {"label": "Saver's Credit", "value": "savers_credit", "description": "Retirement contributions"},
    {"label": "None of these", "value": "none", "description": "No credits apply"}
  ]
When the user has no applicable tax credits (or selects "None of these"), emit:
  { "type": "set_income_discovery", "incomeType": "credits_asked", "value": "yes" }`,
      'state-taxes': `When the user confirms their state situation is handled (or they have no state return needed), emit:
  { "type": "set_income_discovery", "incomeType": "state_asked", "value": "yes" }`,
    };

    const instructions = COMPLETION_MAP[entry.id];
    if (!instructions) {
      return 'This section completes automatically when the required data is entered.';
    }
    return `CRITICAL: ${instructions}\nWithout this action, the section will NOT advance and the user will be stuck.`;
  }

  private buildActionSchemas(entry: SkillRegistryEntry): string {
    const ACTION_SCHEMAS: Record<string, string> = {
      update_field: entry.writableFields.length > 0
        ? `update_field — Update a single field on the return.
  { "type": "update_field", "field": "<fieldName>", "value": <value> }
  You may ONLY use these EXACT field names (no abbreviations, no aliases):
${entry.writableFields.map(f => `    - "${f}"`).join('\n')}
  Any field name not in this list will be REJECTED. Do NOT invent confirmation or status fields.`
        : `update_field — NOT available for this skill. Do NOT emit update_field actions.`,

      set_filing_status: `set_filing_status — Set the user's filing status.
  { "type": "set_filing_status", "status": "<status>" }
  Valid status values: "single", "married_filing_jointly", "married_filing_separately", "head_of_household", "qualifying_surviving_spouse"
  Aliases also accepted: "mfj", "mfs", "hoh", "qss"
  Do NOT use update_field for filing status — always use set_filing_status.`,

      add_dependent: `add_dependent — Add a dependent.
  { "type": "add_dependent", "fields": { "firstName": "...", "relationship": "...", "dateOfBirth": "YYYY-MM-DD", "monthsLivedWithYou": 12, "isStudent": false, "isDisabled": false } }
  Do NOT include SSN — it is collected separately in a secure step.`,

      add_income: `add_income — Add an income item.
  { "type": "add_income", "incomeType": "<type>", "fields": { ... } }
  Income types and key fields:
    - "w2": employerName, employerEin, wages, federalTaxWithheld, socialSecurityWages, socialSecurityTax, medicareWages, medicareTax, stateTaxWithheld, stateWages, state, isSpouse
    - "1099nec": payerName, payerEin, amount, federalTaxWithheld, businessId, stateCode, stateTaxWithheld
    - "1099k": platformName, grossAmount, cardNotPresent, federalTaxWithheld, returnsAndAllowances, businessId
    - "1099int": payerName, amount, earlyWithdrawalPenalty, usBondInterest, federalTaxWithheld, taxExemptInterest
    - "1099div": payerName, ordinaryDividends, qualifiedDividends, capitalGainDistributions, federalTaxWithheld, foreignTaxPaid
    - "1099r": payerName, grossDistribution, taxableAmount, federalTaxWithheld, distributionCode, isIRA, isRothIRA, isSpouse
    - "1099g": payerName, unemploymentCompensation, federalTaxWithheld
    - "1099misc": payerName, otherIncome, rents, royalties, federalTaxWithheld
    - "1099b": brokerName, description, dateAcquired, dateSold, proceeds, costBasis, isLongTerm, federalTaxWithheld, washSaleLossDisallowed
    - "1099sa": payerName, grossDistribution, distributionCode, qualifiedMedicalExpenses, federalTaxWithheld
    - "w2g": payerName, grossWinnings, federalTaxWithheld, typeOfWager
    - "k1": entityName, entityEin, entityType ("partnership"|"s_corp"|"estate"|"trust"), ordinaryBusinessIncome, rentalIncome, guaranteedPayments, interestIncome, ordinaryDividends, qualifiedDividends`,

      set_income_discovery: `set_income_discovery — Enable or disable a section in the wizard.
  { "type": "set_income_discovery", "incomeType": "<key>", "value": "yes" | "no" }
  Income keys: w2, 1099nec, 1099k, 1099int, 1099div, 1099oid, 1099b, 1099da, 1099misc, k1, 1099r, ssa1099, 1099g, 1099sa, 1099q, w2g, 1099c, home_sale, rental, royalty, other
  Deduction keys: ded_medical, ded_property_tax, ded_mortgage, ded_charitable, ded_gambling, ded_hsa, ded_student_loan, ded_ira, ded_educator, ded_alimony, ded_nol, ded_estimated_payments
  Credit keys: child_credit, education_credit, dependent_care, savers_credit, clean_energy, ev_credit, adoption_credit, premium_tax_credit, elderly_disabled, foreign_tax_credit
  Also used for internal flags: dependents_asked, other_income_asked, above_line_asked, credits_asked, state_asked`,

      set_deduction_method: `set_deduction_method — Choose standard or itemized.
  { "type": "set_deduction_method", "method": "standard" | "itemized" }
  Users may elect to itemize even when standard deduction is higher (e.g., for state tax benefit).`,

      update_itemized: `update_itemized — Set itemized deduction fields.
  { "type": "update_itemized", "fields": { ... } }
  Fields: medicalExpenses, stateLocalIncomeTax, realEstateTax, personalPropertyTax, mortgageInterest, mortgageInsurancePremiums, mortgageBalance, charitableCash, charitableNonCash, casualtyLoss, otherDeductions
  Only include fields the user mentions — omitted fields are untouched.`,

      remove_item: `remove_item — Remove an income item, dependent, or expense.
  { "type": "remove_item", "itemType": "<type>", "match": { "<field>": "<value>" } }
  Item types: w2, 1099nec, 1099k, 1099int, 1099div, 1099r, 1099g, 1099misc, 1099b, 1099sa, w2g, k1, rental-properties, dependents, expenses, businesses`,

      navigate: `navigate — Navigate to a wizard step.
  { "type": "navigate", "stepId": "<stepId>" }`,

      no_action: `no_action — Informational response, no data changes.
  { "type": "no_action" }`,

      update_business: `update_business — Create or update a business (Schedule C).
  { "type": "update_business", "fields": { ... } }
  Fields: businessName, principalBusinessCode (6-digit NAICS), businessDescription, accountingMethod ("cash"|"accrual"), didStartThisYear (boolean), isSpouse (boolean)
  If no business exists, this creates one. If one exists, it updates the first business.`,

      add_business_expense: `add_business_expense — Add a business expense.
  { "type": "add_business_expense", "category": "<category>", "amount": <number>, "description": "<optional>" }
  Categories: advertising, car_truck, commissions_fees, contract_labor, depreciation, insurance, interest_other, legal_professional, office_expense, pension, rent_property, rent_equipment, repairs_maintenance, supplies, taxes_licenses, travel, meals, utilities, wages, other_expenses`,

      update_home_office: `update_home_office — Set home office deduction info.
  { "type": "update_home_office", "fields": { ... } }
  Fields: method ("simplified"|"actual"|null), squareFeet, totalHomeSquareFeet
  Simplified: $5/sqft up to 300 sqft max. Set method to "simplified" and provide squareFeet.
  Actual: requires totalHomeSquareFeet plus expense fields. Setting method to null disables it.`,

      update_vehicle: `update_vehicle — Set vehicle expense info.
  { "type": "update_vehicle", "fields": { ... } }
  Fields: method ("mileage"|"actual"|null), businessMiles, totalMiles, commuteMiles
  Standard mileage: $0.70/mile. Set method to "mileage" and provide businessMiles and totalMiles.
  Actual: requires individual expense fields (gas, insurance, repairs, etc.). Setting method to null disables it.`,

      update_se_retirement: `update_se_retirement — Set self-employment retirement contributions.
  { "type": "update_se_retirement", "fields": { ... } }
  Fields: solo401kEmployeeDeferral, solo401kEmployerContribution, solo401kRothDeferral, sepIraContributions, simpleIraContributions, healthInsurancePremiums, otherRetirementContributions
  Use this action (not update_field) for Solo 401(k), SEP-IRA, and SE health insurance.`,
    };

    return entry.allowedActionTypes
      .map((type) => ACTION_SCHEMAS[type] ?? `${type} — (no schema available)`)
      .join('\n\n');
  }
}
