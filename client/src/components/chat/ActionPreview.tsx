/**
 * Action Preview — shows proposed LLM actions as selectable cards.
 *
 * Each action gets a checkbox so the user can cherry-pick which changes
 * to apply. Defaults to all selected. "Apply Selected" executes only
 * the checked actions; "Dismiss" skips all.
 */

import { Check, X, Loader2, Square, CheckSquare, Undo2 } from 'lucide-react';
import { useState, useCallback } from 'react';
import type { ChatAction } from '@nimbus/engine';
import { calculateForm1040, FilingStatus } from '@nimbus/engine';
import { executeActions, summarizeExecution } from '../../services/intentExecutor';
import { computeActionDelta } from '../../services/actionDeltaService';
import { useTaxReturnStore } from '../../store/taxReturnStore';
import { useChatStore } from '../../store/chatStore';
import { useUndoStore } from '../../store/undoStore';
import { getReturn } from '../../api/client';

// ─── Action Description ──────────────────────────

function describeAction(action: ChatAction): string {
  switch (action.type) {
    case 'add_income': {
      const label = INCOME_LABELS[action.incomeType] || action.incomeType;
      const name =
        (action.fields.employerName as string) ||
        (action.fields.payerName as string) ||
        (action.fields.platformName as string) ||
        (action.fields.brokerName as string) ||
        '';
      const amount =
        (action.fields.wages as number) ||
        (action.fields.amount as number) ||
        (action.fields.grossAmount as number) ||
        (action.fields.proceeds as number) ||
        0;
      const parts = [`Add ${label}`];
      if (name) parts.push(`from ${name}`);
      if (amount) parts.push(`\u2014 $${amount.toLocaleString()}`);
      return parts.join(' ');
    }
    case 'set_filing_status':
      return `Set filing status: ${action.status.replace(/_/g, ' ')}`;
    case 'add_dependent': {
      const dName = (action.fields.firstName as string) || 'dependent';
      return `Add dependent: ${dName}`;
    }
    case 'set_deduction_method':
      return `Use ${action.method === 'standard' ? 'standard deduction' : 'itemized deductions'}`;
    case 'update_itemized': {
      const fields = Object.keys(action.fields);
      const total = Object.values(action.fields).reduce((s, v) => s + v, 0);
      return `Update ${fields.length} itemized deduction${fields.length === 1 ? '' : 's'} ($${total.toLocaleString()})`;
    }
    case 'set_income_discovery': {
      const typeLabel = INCOME_LABELS[action.incomeType] || action.incomeType;
      return action.value === 'yes'
        ? `Enable ${typeLabel} income section`
        : `Disable ${typeLabel} income section`;
    }
    case 'update_field':
      return `Update ${action.field}: ${String(action.value)}`;
    case 'navigate':
      return `Navigate to: ${action.stepId.replace(/_/g, ' ')}`;
    case 'add_business_expense':
      return `Add business expense: ${action.category} ($${action.amount.toLocaleString()})`;
    case 'remove_item': {
      const rlabel = INCOME_LABELS[action.itemType] || action.itemType;
      const matchDesc = Object.entries(action.match)
        .map(([_k, v]) => typeof v === 'number' ? `$${v.toLocaleString()}` : String(v))
        .join(', ');
      return `Remove ${rlabel} (${matchDesc})`;
    }
    case 'update_home_office':
      return `Update home office: ${Object.keys(action.fields).length} field${Object.keys(action.fields).length === 1 ? '' : 's'}`;
    case 'update_vehicle':
      return `Update vehicle: ${Object.keys(action.fields).length} field${Object.keys(action.fields).length === 1 ? '' : 's'}`;
    case 'update_business':
      return `Update business: ${Object.keys(action.fields).length} field${Object.keys(action.fields).length === 1 ? '' : 's'}`;
    case 'update_se_retirement':
      return `Update SE retirement: ${Object.keys(action.fields).length} field${Object.keys(action.fields).length === 1 ? '' : 's'}`;
    case 'no_action':
      return 'No action';
    default:
      return 'Unknown action';
  }
}

const INCOME_LABELS: Record<string, string> = {
  w2: 'W-2',
  '1099nec': '1099-NEC',
  '1099k': '1099-K',
  '1099int': '1099-INT',
  '1099div': '1099-DIV',
  '1099r': '1099-R',
  '1099g': '1099-G',
  '1099misc': '1099-MISC',
  '1099b': '1099-B',
  '1099da': '1099-DA',
  '1099sa': '1099-SA',
  '1099oid': '1099-OID',
  '1099q': '1099-Q',
  '1099c': '1099-C',
  w2g: 'W-2G',
  k1: 'K-1',
  'rental-properties': 'Rental property',
  dependents: 'dependent',
  expenses: 'business expense',
  businesses: 'business',
  'education-credits': 'education credit',
  'depreciation-assets': 'depreciation asset',
};

// ─── Component ───────────────────────────────────

interface Props {
  actions: ChatAction[];
  messageId: string;
  applied: boolean;
  dismissed: boolean;
  summary?: string;
  onApplied: (messageId: string, summary: string) => void;
  onDismissed: (messageId: string) => void;
  onUndo: (messageId: string) => void;
}

export default function ActionPreview({
  actions,
  messageId,
  applied,
  dismissed,
  summary,
  onApplied,
  onDismissed,
  onUndo,
}: Props) {
  const [isApplying, setIsApplying] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(actions.map((_, i) => i)));
  const returnId = useTaxReturnStore((s) => s.returnId);
  const canUndo = useUndoStore((s) => s.hasSnapshot(messageId));

  const toggleAction = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === actions.length) return new Set();
      return new Set(actions.map((_, i) => i));
    });
  }, [actions.length]);

  const handleApply = async () => {
    if (!returnId || isApplying || selected.size === 0) return;
    setIsApplying(true);

    try {
      const beforeCalc = useTaxReturnStore.getState().calculation;

      // Snapshot the current return before mutating
      const currentReturn = getReturn(returnId);
      useUndoStore.getState().saveSnapshot(messageId, currentReturn);

      const selectedActions = actions.filter((_, i) => selected.has(i));
      const result = executeActions(selectedActions, returnId);
      const skippedCount = actions.length - selected.size;
      let summaryText = summarizeExecution(result);
      if (skippedCount > 0) {
        summaryText += `\n(${skippedCount} action${skippedCount === 1 ? '' : 's'} skipped)`;
      }

      const updatedReturn = getReturn(returnId);
      const returnWithDefaults = {
        ...updatedReturn,
        filingStatus: updatedReturn.filingStatus || FilingStatus.Single,
      };
      let afterCalc: ReturnType<typeof calculateForm1040> | null = null;
      try {
        afterCalc = calculateForm1040(returnWithDefaults, { enabled: true });
      } catch {
        afterCalc = null;
      }
      const delta = computeActionDelta(beforeCalc, afterCalc);
      useTaxReturnStore.getState().setCalculation(afterCalc);

      if (delta.significant) {
        useChatStore.getState().injectProactiveMessage(
          `📊 **Impact:** ${delta.summaryText}`,
          ['How was this calculated?', 'What else can I do to lower my tax?'],
        );
      }

      onApplied(messageId, summaryText);
    } catch {
      onApplied(messageId, 'Error applying actions');
    } finally {
      setIsApplying(false);
    }
  };

  // Already applied — show confirmation with optional undo
  if (applied) {
    return (
      <div className="mt-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 text-green-400 text-xs font-medium">
            <Check className="w-3.5 h-3.5" />
            Applied
          </div>
          {canUndo && (
            <button
              onClick={() => onUndo(messageId)}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400
                         hover:text-amber-400 transition-colors"
              title="Undo these changes"
            >
              <Undo2 className="w-3 h-3" />
              Undo
            </button>
          )}
        </div>
        {summary && (
          <pre className="text-xs text-slate-400 whitespace-pre-wrap font-sans">{summary}</pre>
        )}
      </div>
    );
  }

  // Dismissed — show skipped indicator
  if (dismissed) {
    return (
      <div className="mt-2 rounded-lg border border-slate-600/50 bg-surface-700/50 px-3 py-2">
        <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
          <X className="w-3.5 h-3.5" />
          Skipped
        </div>
      </div>
    );
  }

  const allSelected = selected.size === actions.length;
  const noneSelected = selected.size === 0;
  const buttonLabel = allSelected
    ? 'Apply All'
    : noneSelected
      ? 'Select actions'
      : `Apply ${selected.size} of ${actions.length}`;

  // Active — show proposed actions with per-action checkboxes
  return (
    <div className="mt-2 rounded-lg border border-telos-orange-500/30 bg-telos-orange-500/5 px-3 py-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-telos-orange-300">
          Proposed changes:
        </p>
        {actions.length > 1 && (
          <button
            onClick={toggleAll}
            className="text-[10px] text-slate-400 hover:text-slate-300 transition-colors"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        )}
      </div>

      <ul className="space-y-1 mb-3">
        {actions.map((action, i) => (
          <li key={i} className="flex items-start gap-2">
            <button
              onClick={() => toggleAction(i)}
              className="mt-0.5 shrink-0 text-telos-orange-400 hover:text-telos-orange-300 transition-colors"
              aria-label={selected.has(i) ? 'Deselect action' : 'Select action'}
            >
              {selected.has(i) ? (
                <CheckSquare className="w-3.5 h-3.5" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
            <span
              className={`text-xs cursor-pointer transition-colors ${
                selected.has(i) ? 'text-slate-300' : 'text-slate-500 line-through'
              }`}
              onClick={() => toggleAction(i)}
            >
              {describeAction(action)}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <button
          onClick={handleApply}
          disabled={isApplying || noneSelected}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                     bg-telos-orange-600 hover:bg-telos-orange-500 text-white
                     transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isApplying ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Check className="w-3 h-3" />
          )}
          {buttonLabel}
        </button>
        <button
          onClick={() => onDismissed(messageId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                     bg-surface-700 hover:bg-surface-600 text-slate-400
                     border border-slate-600 transition-colors"
        >
          <X className="w-3 h-3" />
          Dismiss
        </button>
      </div>
    </div>
  );
}
