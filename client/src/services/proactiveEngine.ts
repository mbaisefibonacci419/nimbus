/**
 * Proactive Message Engine — evaluates whether to surface a contextual
 * Nimbus AI assistant message after wizard step transitions.
 */

import type { TaxReturn, CalculationResult } from '@nimbus/engine';
import { getSuggestions } from './suggestionService';
import { getActiveWarnings, type ValidationWarning } from './warningService';
import { assessAuditRisk } from './auditRiskService';
import { calculateTaxCalendar, type TaxDeadline } from './taxCalendarService';
import { WIZARD_STEPS } from '../store/taxReturnStore';

export type ProactiveTrigger =
  | { type: 'high_value_suggestion'; title: string; benefit: number; chatPrompt: string }
  | { type: 'new_warning'; title: string; message: string; stepId: string }
  | { type: 'audit_risk_crossing'; level: string; message: string }
  | { type: 'approaching_deadline'; name: string; daysLeft: number; message: string };

export interface ProactiveEvalResult {
  trigger: ProactiveTrigger;
  message: string;
  category: string;
}

function buildSuggestionChatPrompt(title: string, benefit: number): string {
  return `Tell me about the **${title}**. You mentioned I might save ~$${benefit.toLocaleString()}. How does it work, do I qualify, and what do I need to do?`;
}

function stepLabel(stepId: string): string {
  return WIZARD_STEPS.find((s) => s.id === stepId)?.label ?? stepId;
}

function flattenWarningsInOrder(byStep: ReturnType<typeof getActiveWarnings>): ValidationWarning[] {
  return byStep.flatMap((g) => g.warnings);
}

function daysUntilDeadline(deadlineIso: string, now: Date): number {
  const [y, m, d] = deadlineIso.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function pickApproachingDeadline(
  taxReturn: TaxReturn,
  calculation: CalculationResult | null | undefined,
  now: Date,
): { deadline: TaxDeadline; daysLeft: number } | null {
  const { deadlines } = calculateTaxCalendar(taxReturn, calculation ?? undefined, now);
  const eligible = deadlines
    .filter((d) => {
      if (d.status === 'completed') return false;
      const days = daysUntilDeadline(d.date, now);
      return days >= 0 && days <= 7;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = eligible[0];
  if (!first) return null;
  return { deadline: first, daysLeft: daysUntilDeadline(first.date, now) };
}

/**
 * Evaluate proactive AI surfacing rules. At most one trigger per call (priority order).
 */
export function evaluateProactive(
  taxReturn: TaxReturn,
  calculation: CalculationResult | null | undefined,
  _currentStepId: string,
  _currentSection: string,
  previousWarningCount: number,
  dismissedCategories: Set<string>,
  now: Date = new Date(),
): ProactiveEvalResult | null {
  void _currentStepId;
  void _currentSection;

  // 1) High-value suggestions (benefit > $500), unclaimed, not dismissed
  const suggestions = getSuggestions(taxReturn, calculation);
  for (const s of suggestions) {
    const benefit = s.estimatedBenefit;
    if (benefit === undefined || benefit <= 500) continue;
    const category = `suggestion:${s.id}`;
    if (dismissedCategories.has(category)) continue;
    const chatPrompt = buildSuggestionChatPrompt(s.title, benefit);
    const trigger: ProactiveTrigger = {
      type: 'high_value_suggestion',
      title: s.title,
      benefit,
      chatPrompt,
    };
    const message = `I noticed you may qualify for the ${s.title} — that could save you ~$${benefit.toLocaleString()}. Want me to walk you through it?`;
    return { trigger, message, category };
  }

  // 2) New validation warnings
  const warningsByStep = getActiveWarnings(taxReturn, calculation ?? undefined);
  const flatWarnings = flattenWarningsInOrder(warningsByStep);
  const totalWarnings = flatWarnings.length;
  if (totalWarnings > previousWarningCount) {
    for (let i = previousWarningCount; i < totalWarnings; i++) {
      const w = flatWarnings[i];
      const category = `warning:${w.stepId}`;
      if (dismissedCategories.has(category)) continue;
      const trigger: ProactiveTrigger = {
        type: 'new_warning',
        title: stepLabel(w.stepId),
        message: w.message,
        stepId: w.stepId,
      };
      const message = `Something on ${stepLabel(w.stepId)} may need a quick look: ${w.message} Want help fixing it?`;
      return { trigger, message, category };
    }
  }

  // 3) Audit risk (requires calculation)
  if (calculation) {
    const assessment = assessAuditRisk(taxReturn, calculation);
    if (assessment.level === 'high' || assessment.level === 'elevated') {
      const category = 'audit_risk';
      if (!dismissedCategories.has(category)) {
        const trigger: ProactiveTrigger = {
          type: 'audit_risk_crossing',
          level: assessment.level,
          message: assessment.summary,
        };
        const levelLabel = assessment.level === 'high' ? 'higher' : 'elevated';
        const message = `I flagged ${levelLabel} audit-related factors on your return from what you entered. Want a quick rundown of what to document and how to reduce risk?`;
        return { trigger, message, category };
      }
    }
  }

  // 4) Tax deadlines within 7 days
  const approaching = pickApproachingDeadline(taxReturn, calculation, now);
  if (approaching) {
    const { deadline, daysLeft } = approaching;
    const category = `deadline:${deadline.id}`;
    if (!dismissedCategories.has(category)) {
      const trigger: ProactiveTrigger = {
        type: 'approaching_deadline',
        name: deadline.label,
        daysLeft,
        message: deadline.notes,
      };
      const message =
        daysLeft === 0
          ? `${deadline.label} is today — want a short checklist so nothing slips?`
          : `Heads up: ${deadline.label} is in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Want me to summarize what to do?`;
      return { trigger, message, category };
    }
  }

  return null;
}
