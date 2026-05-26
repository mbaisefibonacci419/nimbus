/**
 * Agent Layout — Chat-first UI for Agent Mode
 *
 * The agent layout places the chat conversation as the primary content
 * with a Return Summary sidebar showing progress through skills.
 * This replaces the step-based wizard layout when viewMode === 'agent'.
 */

import { useState, useRef, useEffect, lazy, Suspense, useMemo } from 'react';
import { useTaxReturnStore } from '../../store/taxReturnStore';
import { useChatStore } from '../../store/chatStore';
import { useLiveCalculation } from '../../hooks/useLiveCalculation';
import { useResizePanel } from '../../hooks/useResizePanel';
import ReturnSummarySidebar from './ReturnSummarySidebar';
import ResizeHandle from '../common/ResizeHandle';
import SaveIndicator from '../common/SaveIndicator';
import { AgentOrchestrator, createInitialAgentState } from '../../services/agent/AgentOrchestrator';
import type { AgentState } from '../../services/agent/AgentOrchestrator';
import { Menu, X, Calculator, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, formatPercent } from '../../utils/format';

const LazyChatPanel = lazy(() => import('../chat/ChatPanel'));
const LazyExplainTaxesPanel = lazy(() => import('../layout/ExplainTaxesPanel'));

export default function AgentLayout() {
  const { saveState, taxReturn, calculation, setViewMode } = useTaxReturnStore();
  const { isAvailable: chatAvailable, checkAvailability, openPanel } = useChatStore();
  const navigate = useNavigate();
  useLiveCalculation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  const {
    width: sidebarWidth,
    isDragging: sidebarDragging,
    startResize: startSidebarResize,
    resetWidth: resetSidebarWidth,
  } = useResizePanel({
    storageKey: 'agent-sidebar',
    defaultWidth: 256,
    minWidth: 200,
    maxWidth: 360,
    side: 'left',
  });

  // Derive agent state directly from the persisted taxReturn.agentState so
  // updates from chatStore._maybeAdvanceAgentSkill are reflected immediately.
  const agentState = useMemo<AgentState>(() => {
    const saved = (taxReturn as Record<string, unknown> | null)?.agentState as AgentState | undefined;
    return saved ?? createInitialAgentState();
  }, [taxReturn]);

  // On mount + whenever taxReturn changes, sync completion and pick the next
  // skill. Writes back to taxReturn.agentState, which re-derives agentState above.
  useEffect(() => {
    if (!taxReturn) return;
    const orchestrator = new AgentOrchestrator({ ...agentState });
    orchestrator.syncCompletionFromReturn(taxReturn);

    const nextSkill = orchestrator.selectNextSkill(taxReturn);
    if (nextSkill && nextSkill !== orchestrator.getState().activeSkill) {
      orchestrator.activateSkill(nextSkill);
    }

    const updated = orchestrator.getState();
    const current = (taxReturn as unknown as Record<string, unknown>)?.agentState as AgentState | undefined;
    const hasChanged =
      !current ||
      updated.activeSkill !== current.activeSkill ||
      Object.keys(updated.completed).length !== Object.keys(current.completed ?? {}).length;

    if (hasChanged) {
      useTaxReturnStore.getState().updateField('agentState', updated);
    }
  }, [taxReturn, agentState]);

  useEffect(() => {
    checkAvailability();
    openPanel();
  }, [checkAvailability, openPanel]);

  const handleSwitchToInterview = () => setViewMode('wizard');
  const handleSwitchToForms = () => setViewMode('forms');

  const f = calculation?.form1040;
  const isRefund = f && f.refundAmount > 0;

  return (
    <div
      className="h-screen flex flex-col"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* Skip link */}
      <a
        href="#agent-chat"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-telos-blue-600 focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to chat
      </a>

      {/* Top bar */}
      <header ref={headerRef} className="bg-surface-800 border-b border-slate-700 px-4 sm:px-6 py-3 flex items-center justify-between shrink-0 gap-6">
        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle return summary"
            className="lg:hidden p-1 text-slate-400 hover:text-slate-100 transition-colors shrink-0"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {/* Logo */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
          >
            <span className="font-bold text-xl hidden sm:inline"><span className="text-telos-orange-400">Ni</span><span className="text-telos-blue-400">mbus</span></span>
          </button>
          <span className="text-slate-400 hidden sm:inline shrink-0">2025 Tax Year</span>

          {calculation && <div className="hidden md:block w-px h-6 bg-slate-700 shrink-0" />}

          {/* Estimate */}
          {f && (
            <div className="hidden md:flex items-center gap-2 shrink-0" aria-live="polite">
              <span className="text-slate-400">{isRefund ? 'Refund:' : 'Owed:'}</span>
              <span className={`font-bold text-lg ${isRefund ? 'text-emerald-400' : 'text-amber-400'}`}>
                {formatCurrency(isRefund ? f.refundAmount : f.amountOwed)}
              </span>
              <span className="text-slate-400 hidden lg:inline">Effective Rate:</span>
              <span className="text-slate-300 font-medium hidden lg:inline">{formatPercent(f.effectiveTaxRate)}</span>
            </div>
          )}

          {/* Explain toggle */}
          {calculation && (
            <button
              onClick={() => setExplainOpen((prev) => !prev)}
              aria-expanded={explainOpen}
              className="hidden sm:flex items-center gap-1.5 text-telos-blue-400 hover:text-telos-blue-300 transition-colors shrink-0"
            >
              <Calculator className="w-4 h-4" />
              <span className="font-medium">Explain</span>
              {explainOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}

          {/* Agent mode badge */}
          <div className="flex items-center gap-1.5 bg-telos-blue-600/20 border border-telos-blue-600/30 rounded-full px-3 py-1 shrink-0">
            <MessageSquare className="w-3.5 h-3.5 text-telos-blue-400" />
            <span className="text-xs font-medium text-telos-blue-300">Agent Mode</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <SaveIndicator state={saveState} />
        </div>
      </header>

      {/* Explain taxes panel */}
      {explainOpen && calculation && (
        <Suspense fallback={null}>
          <LazyExplainTaxesPanel open={explainOpen} onClose={() => setExplainOpen(false)} />
        </Suspense>
      )}

      {/* Body: sidebar + chat */}
      <div className="flex flex-1 min-h-0">
        {/* Return Summary Sidebar */}
        <div
          ref={undefined}
          style={{ width: sidebarWidth }}
          className={`
            shrink-0 h-full border-r border-slate-700
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
            transition-transform duration-200 fixed lg:static z-30 lg:z-auto
          `}
        >
          <ReturnSummarySidebar
            agentState={agentState}
            onSwitchToInterview={handleSwitchToInterview}
            onSwitchToForms={handleSwitchToForms}
          />
        </div>

        {/* Sidebar resize handle */}
        <ResizeHandle
          isDragging={sidebarDragging}
          onMouseDown={startSidebarResize}
          onDoubleClick={resetSidebarWidth}
        />

        {/* Chat — primary content in agent mode */}
        <main
          id="agent-chat"
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
          tabIndex={-1}
        >
          {chatAvailable ? (
            <Suspense fallback={
              <div className="flex-1 flex items-center justify-center text-slate-500">
                Loading assistant...
              </div>
            }>
              <LazyChatPanel embedded />
            </Suspense>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 p-8 text-center">
              <div>
                <MessageSquare className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                <h2 className="text-lg font-medium text-slate-300 mb-2">AI Assistant Not Available</h2>
                <p className="text-sm max-w-md">
                  Agent mode requires the AI assistant. Please configure your API key
                  in the settings panel to get started.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
