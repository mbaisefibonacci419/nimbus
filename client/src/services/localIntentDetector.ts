/**
 * Local Intent Detector
 *
 * Catches simple, high-confidence user intents (navigation, refund summaries,
 * completeness checks, field reads, deletion) and builds ChatResponse actions
 * directly — no LLM round-trip needed.
 *
 * Deletion is handled locally because LLMs reliably refuse to generate
 * remove_item actions due to safety priors around deletion, even when the
 * system prompt explicitly permits it.
 */

import type { ChatResponse } from '@nimbus/engine';
import type { Form1040Result } from '@nimbus/engine';
import { useTaxReturnStore, WIZARD_STEPS } from '../store/taxReturnStore';
import { buildDocumentInventory } from './documentInventoryService';

// ─── Item Type Detection ─────────────────────────

interface ItemTypePattern {
  /** The itemType key used by the intent executor */
  itemType: string;
  /** Human-readable label */
  label: string;
  /** Regex patterns to match in user message (case-insensitive) */
  patterns: RegExp[];
  /** The TaxReturn field name for this item type */
  fieldName: string;
  /** The field on each item that holds the identifying name */
  nameField: string;
  /** The suggested step to navigate to */
  suggestedStep: string;
}

const ITEM_TYPES: ItemTypePattern[] = [
  { itemType: 'w2', label: 'W-2', patterns: [/w-?2/i], fieldName: 'w2Income', nameField: 'employerName', suggestedStep: 'w2_income' },
  { itemType: '1099nec', label: '1099-NEC', patterns: [/1099-?nec/i], fieldName: 'income1099NEC', nameField: 'payerName', suggestedStep: '1099nec_income' },
  { itemType: '1099k', label: '1099-K', patterns: [/1099-?k(?!\w)/i], fieldName: 'income1099K', nameField: 'platformName', suggestedStep: '1099k_income' },
  { itemType: '1099int', label: '1099-INT', patterns: [/1099-?int/i], fieldName: 'income1099INT', nameField: 'payerName', suggestedStep: '1099int_income' },
  { itemType: '1099div', label: '1099-DIV', patterns: [/1099-?div/i], fieldName: 'income1099DIV', nameField: 'payerName', suggestedStep: '1099div_income' },
  { itemType: '1099r', label: '1099-R', patterns: [/1099-?r(?!\w)/i], fieldName: 'income1099R', nameField: 'payerName', suggestedStep: '1099r_income' },
  { itemType: '1099g', label: '1099-G', patterns: [/1099-?g(?!\w)/i], fieldName: 'income1099G', nameField: 'payerName', suggestedStep: '1099g_income' },
  { itemType: '1099misc', label: '1099-MISC', patterns: [/1099-?misc/i], fieldName: 'income1099MISC', nameField: 'payerName', suggestedStep: '1099misc_income' },
  { itemType: '1099b', label: '1099-B', patterns: [/1099-?b(?!\w)/i], fieldName: 'income1099B', nameField: 'description', suggestedStep: '1099b_income' },
  { itemType: '1099da', label: '1099-DA', patterns: [/1099-?da/i], fieldName: 'income1099DA', nameField: 'description', suggestedStep: '1099da_income' },
  { itemType: '1099sa', label: '1099-SA', patterns: [/1099-?sa/i], fieldName: 'income1099SA', nameField: 'payerName', suggestedStep: '1099sa_income' },
  { itemType: '1099oid', label: '1099-OID', patterns: [/1099-?oid/i], fieldName: 'income1099OID', nameField: 'payerName', suggestedStep: '1099oid_income' },
  { itemType: '1099q', label: '1099-Q', patterns: [/1099-?q(?!\w)/i], fieldName: 'income1099Q', nameField: 'payerName', suggestedStep: '1099q_income' },
  { itemType: '1099c', label: '1099-C', patterns: [/1099-?c(?!\w)/i], fieldName: 'income1099C', nameField: 'payerName', suggestedStep: '1099c_income' },
  { itemType: 'w2g', label: 'W-2G', patterns: [/w-?2g/i], fieldName: 'incomeW2G', nameField: 'payerName', suggestedStep: 'w2g_income' },
  { itemType: 'k1', label: 'K-1', patterns: [/k-?1(?!\w)/i], fieldName: 'incomeK1', nameField: 'entityName', suggestedStep: 'k1_income' },
  { itemType: 'dependents', label: 'dependent', patterns: [/dependent/i], fieldName: 'dependents', nameField: 'firstName', suggestedStep: 'dependents' },
  { itemType: 'rental-properties', label: 'rental property', patterns: [/rental/i], fieldName: 'rentalProperties', nameField: 'propertyAddress', suggestedStep: 'rental_income' },
  { itemType: 'royalty-properties', label: 'royalty property', patterns: [/royalt/i], fieldName: 'royaltyProperties', nameField: 'description', suggestedStep: 'royalty_income' },
  { itemType: 'education-credits', label: 'education credit', patterns: [/education\s*credit/i], fieldName: 'educationCredits', nameField: 'institution', suggestedStep: 'education_credits' },
];

// ─── Navigation ───────────────────────────────────

const NAV_PREFIX =
  /^(?:go\s*to|show|take\s*me\s*to|open|navigate\s*to|jump\s*to|switch\s*to)\s+/i;

function normalizeAliasKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Maps common phrases to wizard step ids (ids must exist in WIZARD_STEPS where possible). */
function buildStepAliasMap(): Map<string, string> {
  const m = new Map<string, string>();
  const add = (aliases: string[], stepId: string) => {
    for (const a of aliases) m.set(normalizeAliasKey(a), stepId);
  };

  add(['w-2', 'w2'], 'w2_income');
  add(['deductions', 'deduction'], 'deduction_method');
  add(['credits', 'credit'], 'child_tax_credit');
  add(['review', 'summary'], 'tax_summary');
  add(['dependents', 'dependent'], 'dependents');
  add(['filing status', 'status'], 'filing_status');
  add(['personal info', 'my info'], 'personal_info');
  add(['state', 'state taxes'], 'state_overview');
  add(['self employment', 'self-employment', 'schedule c', 'self employment income'], 'business_info');
  add(['1099-nec', '1099nec'], '1099nec_income');
  add(['itemized', 'itemized deductions'], 'itemized_deductions');
  add(['standard deduction'], 'deduction_method');
  add(['ira', 'ira contributions', 'retirement', 'retirement contributions'], 'ira_contribution_ded');
  add(['hsa', 'hsa contributions'], 'hsa_contributions');
  add(['education', 'education credits'], 'education_credits');

  for (const it of ITEM_TYPES) {
    m.set(normalizeAliasKey(it.itemType.replace(/-/g, ' ')), it.suggestedStep);
    m.set(normalizeAliasKey(it.label), it.suggestedStep);
  }

  return m;
}

const STEP_ALIASES = buildStepAliasMap();

function stepLabel(stepId: string): string {
  return WIZARD_STEPS.find((s) => s.id === stepId)?.label ?? 'that section';
}

function formatUsd(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return `$${rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function tryNavigationIntent(trimmed: string): ChatResponse | null {
  if (!NAV_PREFIX.test(trimmed)) return null;

  let target = trimmed.replace(NAV_PREFIX, '').replace(/^(?:the|my|a)\s+/i, '').trim();
  target = target.replace(/[?.!]+$/g, '').trim();
  if (!target) return null;

  const key = normalizeAliasKey(target);
  const stepId = STEP_ALIASES.get(key);
  if (!stepId) return null;

  const label = stepLabel(stepId);
  return {
    message: `Navigating to ${label}.`,
    actions: [{ type: 'navigate', stepId }],
    suggestedStep: stepId,
    followUpChips: ['What do I enter here?', 'Explain this section', 'Go to review'],
  };
}

// ─── Refund / amount owed ────────────────────────

function normalizeQuestion(s: string): string {
  return s.toLowerCase().trim().replace(/[?.!]+$/g, '').replace(/\s+/g, ' ');
}

function tryRefundOrOwedIntent(trimmed: string): ChatResponse | null {
  const t = normalizeQuestion(trimmed);
  const matches =
    /\bwhat'?s my refund\b/.test(t) ||
    /\bwhat is my refund\b/.test(t) ||
    /\bhow much do i owe\b/.test(t) ||
    /\bwhat do i owe\b/.test(t) ||
    t === 'my refund' ||
    t === 'refund amount' ||
    t === 'amount owed' ||
    t === 'total tax' ||
    t === 'my tax';

  if (!matches) return null;

  const { calculation } = useTaxReturnStore.getState();
  if (!calculation?.form1040) {
    return {
      message:
        "I don't have your tax calculation yet. Complete more sections and I can tell you.",
      actions: [],
      suggestedStep: 'tax_summary',
      followUpChips: ['Go to income', 'Go to deductions', 'What is missing?'],
    };
  }

  const f = calculation.form1040;
  const refund = f.refundAmount ?? 0;
  const owed = f.amountOwed ?? 0;
  const totalTax = f.totalTax ?? 0;

  let message: string;
  if (refund > 0 && owed <= 0) {
    message = `Based on your return so far, your federal refund is about ${formatUsd(refund)}.`;
  } else if (owed > 0 && refund <= 0) {
    message = `Based on your return so far, you owe about ${formatUsd(owed)} in federal tax.`;
  } else if (totalTax > 0) {
    message = `Your current federal income tax is about ${formatUsd(totalTax)}. Withholding and payments may still change your refund or balance due.`;
  } else {
    message =
      'Your return looks balanced so far — no federal refund or amount owed based on the current calculation.';
  }

  return {
    message,
    actions: [],
    suggestedStep: 'refund_payment',
    followUpChips: ['How was this calculated?', 'What can I do to lower my tax?', 'Review my return'],
  };
}

// ─── Completeness ────────────────────────────────

function tryCompletenessIntent(trimmed: string): ChatResponse | null {
  const t = normalizeQuestion(trimmed);
  const matches =
    /\bam i done\b/.test(t) ||
    /\bwhat'?s missing\b/.test(t) ||
    /\bwhat is missing\b/.test(t) ||
    /\bwhat do i still need\b/.test(t) ||
    /\bis my return complete\b/.test(t) ||
    /\bwhat'?s left\b/.test(t) ||
    /\bwhat is left\b/.test(t);

  if (!matches) return null;

  const { taxReturn } = useTaxReturnStore.getState();
  if (!taxReturn) return null;

  const inv = buildDocumentInventory(taxReturn);
  const pct = inv.overallCompleteness;
  const pendingForms = inv.totalFormsPending;
  const weakSections = inv.nonIncomeSections.filter((s) => s.status !== 'complete');

  let message = `Your return is about ${pct}% complete based on forms and sections tracked here.`;
  if (pendingForms > 0) {
    message += ` ${pendingForms} income form group${pendingForms === 1 ? ' is' : 's are'} still waiting for entries.`;
  }
  if (weakSections.length > 0) {
    const names = weakSections.map((s) => s.label).join(', ');
    message += ` These areas may still need attention: ${names}.`;
  }
  if (pendingForms === 0 && weakSections.length === 0) {
    message +=
      " Everything that we can check looks complete — you're ready to review the totals and filing steps.";
  }

  return {
    message,
    actions: [],
    suggestedStep: 'tax_summary',
    followUpChips: ["Guide me through what's left", 'Go to review', 'What is my refund?'],
  };
}

// ─── Form 1040 field reads ───────────────────────

type Form1040NumericKey = keyof Pick<
  Form1040Result,
  | 'totalWages'
  | 'totalIncome'
  | 'agi'
  | 'taxableIncome'
  | 'totalCredits'
  | 'deductionAmount'
  | 'totalTax'
>;

function tryFieldReadIntent(trimmed: string): ChatResponse | null {
  const t = trimmed.toLowerCase().replace(/[?.!]+$/g, '').trim();

  let field: Form1040NumericKey | null = null;
  let descriptor = '';

  if (
    /\b(wages|w-2\s*wages|box\s*1|what did i enter for wages|my wages)\b/.test(t) ||
    (/\bhow much\b/.test(t) && /\bwages\b/.test(t))
  ) {
    field = 'totalWages';
    descriptor = 'Total wages (Form W-2, Box 1)';
  } else if (/\b(total income|how much income)\b/.test(t) || t === 'total income') {
    field = 'totalIncome';
    descriptor = 'Total income';
  } else if (/\bagi\b/.test(t) || /adjusted gross income/.test(t) || /\bwhat'?s my agi\b/.test(t)) {
    field = 'agi';
    descriptor = 'Adjusted gross income (AGI)';
  } else if (/\btaxable\s+income\b/.test(t)) {
    field = 'taxableIncome';
    descriptor = 'Taxable income';
  } else if (/\btotal\s+credits\b/.test(t)) {
    field = 'totalCredits';
    descriptor = 'Total credits';
  } else if (/\btotal\s+deductions\b/.test(t)) {
    field = 'deductionAmount';
    descriptor = 'Deduction taken (standard or itemized)';
  } else {
    return null;
  }

  const { calculation } = useTaxReturnStore.getState();
  const raw = calculation?.form1040?.[field];
  if (typeof raw !== 'number') return null;

  return {
    message: `Your ${descriptor} is ${formatUsd(raw)} with the current return data.`,
    actions: [],
    suggestedStep: 'review_form_1040',
    followUpChips: ['How was this calculated?', 'Explain my taxes', 'Go to review'],
  };
}

// ─── Deletion Intent Detection ───────────────────

const DELETE_VERBS = /^(?:delete|remove|drop|get rid of|take out|clear|erase)\b/i;

/**
 * Try to detect a local intent from the user's message.
 * Returns a synthetic ChatResponse if detected, or null to fall through to the LLM.
 */
export function detectLocalIntent(message: string): ChatResponse | null {
  const trimmed = message.trim();

  const navigation = tryNavigationIntent(trimmed);
  if (navigation) return navigation;

  const refund = tryRefundOrOwedIntent(trimmed);
  if (refund) return refund;

  const completeness = tryCompletenessIntent(trimmed);
  if (completeness) return completeness;

  const fieldRead = tryFieldReadIntent(trimmed);
  if (fieldRead) return fieldRead;

  // Must start with a delete verb
  if (!DELETE_VERBS.test(trimmed)) return null;

  // Strip the verb prefix to get the target description
  const afterVerb = trimmed.replace(DELETE_VERBS, '').trim();
  // Strip leading "the", "my", "a"
  const target = afterVerb.replace(/^(?:the|my|a)\s+/i, '').trim();

  if (!target) return null;

  // Find which item type the user is referring to
  const matched = ITEM_TYPES.find((it) =>
    it.patterns.some((p) => p.test(target)),
  );
  if (!matched) return null;

  // Extract the name portion (everything that isn't the form type keyword)
  // e.g., "GD New York W-2" → "GD New York", "1099-NEC from Acme" → "Acme"
  let name = target;
  // Remove the form type pattern
  for (const p of matched.patterns) {
    name = name.replace(p, '');
  }
  // Remove common prepositions
  name = name.replace(/\b(?:from|for|at|entry|item|income|form)\b/gi, '');
  name = name.trim().replace(/\s+/g, ' ');

  // Check if we have items of this type
  const taxReturn = useTaxReturnStore.getState().taxReturn;
  if (!taxReturn) return null;

  const arr = (taxReturn as any)[matched.fieldName] as any[] | undefined;
  if (!arr || arr.length === 0) {
    return {
      message: `You don't have any ${matched.label} entries to remove.`,
      actions: [{ type: 'no_action' }],
      suggestedStep: matched.suggestedStep,
      followUpChips: [`Add a ${matched.label}`, 'What income do I have?'],
    };
  }

  // Build the match object
  const match: Record<string, unknown> = {};
  if (name) {
    match[matched.nameField] = name;
  }

  return {
    message: `I'll remove the ${matched.label}${name ? ` from ${name}` : ''}. Click Apply to confirm — you'll have a few seconds to undo if needed.`,
    actions: [{ type: 'remove_item', itemType: matched.itemType, match } as any],
    suggestedStep: matched.suggestedStep,
    followUpChips: ['Undo this deletion', `Add a new ${matched.label}`, 'Review my income'],
  };
}
