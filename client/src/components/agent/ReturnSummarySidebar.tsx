/**
 * Return Summary Sidebar — Agent Mode
 *
 * Shows a live summary of the return organized by skill/phase,
 * with completion status, key data points, and a refund ticker.
 */

import { useMemo } from 'react';
import { useTaxReturnStore } from '../../store/taxReturnStore';
import { SKILL_REGISTRY, type SkillRegistryEntry } from '../../services/agent/SkillRegistry';
import type { AgentState } from '../../services/agent/AgentOrchestrator';
import { formatCurrency } from '../../utils/format';
import { Check, CircleDot, Circle, ChevronRight, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface ReturnSummarySidebarProps {
  agentState: AgentState;
  onSwitchToInterview: () => void;
  onSwitchToForms: () => void;
}

function SkillStatusIcon({ skillId, agentState }: { skillId: string; agentState: AgentState }) {
  if (agentState.completed[skillId]) {
    return <Check className="w-3.5 h-3.5 text-emerald-400" />;
  }
  if (skillId === agentState.activeSkill) {
    return <CircleDot className="w-3.5 h-3.5 text-telos-blue-400 animate-pulse" />;
  }
  if (agentState.skipped.includes(skillId)) {
    return <Circle className="w-3.5 h-3.5 text-slate-600" />;
  }
  return <Circle className="w-3.5 h-3.5 text-slate-500" />;
}

function SkillSummaryLine({ skill, agentState }: { skill: SkillRegistryEntry; agentState: AgentState }) {
  const isCompleted = !!agentState.completed[skill.id];
  const isActive = skill.id === agentState.activeSkill;
  const isSkipped = agentState.skipped.includes(skill.id);

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-colors ${
        isActive
          ? 'bg-telos-blue-600/10 text-telos-blue-300'
          : isCompleted
            ? 'text-slate-300'
            : isSkipped
              ? 'text-slate-600 line-through'
              : 'text-slate-500'
      }`}
    >
      <SkillStatusIcon skillId={skill.id} agentState={agentState} />
      <span className="truncate">{skill.domain}</span>
      {isActive && <ChevronRight className="w-3 h-3 ml-auto text-telos-blue-400" />}
    </div>
  );
}

function PhaseGroup({ phase, label, skills, agentState }: {
  phase: string;
  label: string;
  skills: SkillRegistryEntry[];
  agentState: AgentState;
}) {
  if (skills.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      {skills.map((skill) => (
        <SkillSummaryLine key={skill.id} skill={skill} agentState={agentState} />
      ))}
    </div>
  );
}

export default function ReturnSummarySidebar({
  agentState,
  onSwitchToInterview,
  onSwitchToForms,
}: ReturnSummarySidebarProps) {
  const { calculation } = useTaxReturnStore();

  const phases = useMemo(() => {
    const groups = [
      { phase: 'onboarding', label: 'Getting Started' },
      { phase: 'income', label: 'Income' },
      { phase: 'self_employment', label: 'Self-Employment' },
      { phase: 'deductions', label: 'Deductions' },
      { phase: 'credits', label: 'Credits' },
      { phase: 'state', label: 'State' },
      { phase: 'review', label: 'Review' },
      { phase: 'finish', label: 'Finish' },
    ];

    return groups.map((g) => ({
      ...g,
      skills: SKILL_REGISTRY.filter((s) => s.phase === g.phase),
    }));
  }, []);

  const completedCount = Object.keys(agentState.completed).length;
  const totalSkills = SKILL_REGISTRY.length;
  const progressPct = Math.round((completedCount / totalSkills) * 100);

  const f = calculation?.form1040;
  const isRefund = f && f.refundAmount > 0;
  const amount = f ? (isRefund ? f.refundAmount : f.amountOwed) : 0;

  return (
    <div className="h-full flex flex-col bg-surface-800 text-sm">
      {/* Progress bar */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-700/60">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-slate-400">Your Return</span>
          <span className="text-[10px] text-slate-500">{progressPct}%</span>
        </div>
        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-telos-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Skill list by phase */}
      <div className="flex-1 overflow-y-auto py-2">
        {phases.map((group) => (
          <PhaseGroup
            key={group.phase}
            phase={group.phase}
            label={group.label}
            skills={group.skills}
            agentState={agentState}
          />
        ))}
      </div>

      {/* Refund/Owed ticker */}
      {f && (
        <div className="px-3 py-3 border-t border-slate-700/60">
          <div className={`rounded-lg px-3 py-2.5 text-center ${
            isRefund ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-amber-500/10 border border-amber-500/20'
          }`}>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
              {isRefund ? 'Estimated Refund' : 'Estimated Owed'}
            </div>
            <div className={`text-lg font-bold flex items-center justify-center gap-1 ${
              isRefund ? 'text-emerald-400' : 'text-amber-400'
            }`}>
              {isRefund
                ? <ArrowUpRight className="w-4 h-4" />
                : <ArrowDownRight className="w-4 h-4" />
              }
              {formatCurrency(amount)}
            </div>
          </div>
        </div>
      )}

      {/* Mode switches */}
      <div className="px-3 pb-3 flex flex-col gap-1.5">
        <button
          onClick={onSwitchToInterview}
          className="w-full text-xs text-slate-400 hover:text-slate-200 py-1.5 px-2 rounded hover:bg-surface-700 transition-colors text-left"
        >
          Switch to Interview
        </button>
        <button
          onClick={onSwitchToForms}
          className="w-full text-xs text-slate-400 hover:text-slate-200 py-1.5 px-2 rounded hover:bg-surface-700 transition-colors text-left"
        >
          Switch to Forms
        </button>
      </div>
    </div>
  );
}
