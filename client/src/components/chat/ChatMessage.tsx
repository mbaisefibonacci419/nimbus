/**
 * Chat Message Bubble — renders a single user or assistant message.
 *
 * User messages: right-aligned, blue-tinted background, plain text.
 * Assistant messages: left-aligned, surface-700 background, markdown rendered.
 *
 * Assistant messages also show an action bar with:
 * - Thumbs up / down feedback (always visible)
 * - Copy to clipboard (hover-reveal)
 * - Regenerate (only on last assistant message, hidden if actions were applied)
 */

import { useState, useRef, useEffect } from 'react';
import { Copy, Check, RotateCcw, RefreshCw, Pencil, ThumbsUp, ThumbsDown, Volume2, VolumeX, FileText, Loader2, CheckCircle2, Send } from 'lucide-react';
import type { ChatMessageUI } from '../../store/chatStore';
import type { ChatOption } from '@nimbus/engine';
import ActionPreview from './ActionPreview';
import MarkdownMessage from './MarkdownMessage';
import { injectStepLinks } from '../../services/stepLinkInjector';

interface Props {
  message: ChatMessageUI;
  isLastAssistant?: boolean;
  onActionsApplied: (messageId: string, summary: string) => void;
  onActionsDismissed: (messageId: string) => void;
  onUndoActions: (messageId: string) => void;
  onFeedback: (messageId: string, feedback: 'up' | 'down') => void;
  onRegenerate: () => void;
  onFollowUp: (text: string) => void;
  onEditAndResend: (messageId: string, newText: string) => void;
  onRetry: (messageId: string) => void;
}

function OptionPills({
  options,
  multiSelect,
  onFollowUp,
}: {
  options: ChatOption[];
  multiSelect?: boolean;
  onFollowUp: (text: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!multiSelect) {
    return (
      <div className="mt-3 pt-2.5 border-t border-slate-600/30 flex flex-wrap gap-2">
        {options.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => onFollowUp(opt.value ?? opt.label)}
            className="group/pill flex flex-col items-start px-3.5 py-2 rounded-xl
                       bg-telos-blue-600/10 border border-telos-blue-500/30
                       hover:bg-telos-blue-600/20 hover:border-telos-blue-400/50
                       active:scale-[0.97] transition-all cursor-pointer text-left"
          >
            <span className="text-sm font-medium text-telos-blue-200 group-hover/pill:text-telos-blue-100">
              {opt.label}
            </span>
            {opt.description && (
              <span className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                {opt.description}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  const toggle = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleSubmit = () => {
    if (selected.size === 0) return;
    const labels = options
      .filter((o) => selected.has(o.value ?? o.label))
      .map((o) => o.label);
    onFollowUp(labels.join(', '));
  };

  const noneOption = options.find(
    (o) => (o.value ?? o.label).toLowerCase() === 'none' ||
           o.label.toLowerCase().startsWith('none of'),
  );
  const regularOptions = options.filter((o) => o !== noneOption);

  const handleNone = () => {
    if (noneOption) {
      onFollowUp(noneOption.value ?? noneOption.label);
    }
  };

  return (
    <div className="mt-3 pt-2.5 border-t border-slate-600/30">
      <div className="flex items-center gap-1.5 mb-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-telos-blue-400" />
        <span className="text-[11px] font-medium text-slate-400">
          Select all that apply
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {regularOptions.map((opt, idx) => {
          const val = opt.value ?? opt.label;
          const isSelected = selected.has(val);
          return (
            <button
              key={idx}
              onClick={() => toggle(val)}
              className={`group/pill flex items-start gap-2 px-3.5 py-2 rounded-xl
                         border transition-all cursor-pointer text-left active:scale-[0.97]
                         ${isSelected
                           ? 'bg-telos-blue-600/25 border-telos-blue-400/60 ring-1 ring-telos-blue-500/30'
                           : 'bg-telos-blue-600/10 border-telos-blue-500/30 hover:bg-telos-blue-600/20 hover:border-telos-blue-400/50'
                         }`}
            >
              <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors
                              ${isSelected
                                ? 'bg-telos-blue-500 border-telos-blue-400'
                                : 'border-slate-500 bg-transparent'
                              }`}>
                {isSelected && <Check className="w-3 h-3 text-white" />}
              </div>
              <div className="flex flex-col">
                <span className={`text-sm font-medium ${isSelected ? 'text-telos-blue-100' : 'text-telos-blue-200'}`}>
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                    {opt.description}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={selected.size === 0}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
                     bg-telos-blue-600 hover:bg-telos-blue-500 text-white
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors active:scale-[0.97]"
        >
          <Send className="w-3.5 h-3.5" />
          Done ({selected.size})
        </button>
        {noneOption && (
          <button
            onClick={handleNone}
            className="text-[11px] px-3 py-1.5 rounded-lg
                       text-slate-400 hover:text-slate-300 hover:bg-slate-700/50
                       transition-colors cursor-pointer"
          >
            {noneOption.label}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ChatMessage({
  message,
  isLastAssistant,
  onActionsApplied,
  onActionsDismissed,
  onUndoActions,
  onFeedback,
  onRegenerate,
  onFollowUp,
  onEditAndResend,
  onRetry,
}: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      // Fallback for older browsers / non-HTTPS
      const textarea = document.createElement('textarea');
      textarea.value = message.content;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSpeak = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    if (isSpeaking) {
      synth.cancel();
      setIsSpeaking(false);
      return;
    }

    // Strip markdown syntax for cleaner speech
    const plain = message.content
      .replace(/#{1,6}\s/g, '')           // headings
      .replace(/\*\*(.+?)\*\*/g, '$1')    // bold
      .replace(/\*(.+?)\*/g, '$1')        // italic
      .replace(/`(.+?)`/g, '$1')          // inline code
      .replace(/```[\s\S]*?```/g, '')      // code blocks
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
      .replace(/^[-*]\s/gm, '')           // list bullets
      .replace(/^\d+\.\s/gm, '')          // numbered lists
      .trim();

    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    synth.speak(utterance);
    setIsSpeaking(true);
  };

  const startEditing = () => {
    setEditText(message.content);
    setIsEditing(true);
  };

  const cancelEditing = () => setIsEditing(false);

  const saveEdit = () => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    setIsEditing(false);
    onEditAndResend(message.id, trimmed);
  };

  // Auto-resize edit textarea and focus on open
  useEffect(() => {
    if (isEditing && editRef.current) {
      const el = editRef.current;
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [isEditing]);

  // Auto-resize as user types
  useEffect(() => {
    if (editRef.current) {
      editRef.current.style.height = 'auto';
      editRef.current.style.height = `${editRef.current.scrollHeight}px`;
    }
  }, [editText]);

  // Show regenerate only on last assistant message, and only if actions weren't applied
  const showRegenerate = isLastAssistant && !message.actionsApplied;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`group relative max-w-[85%] rounded-xl px-3.5 py-2.5 ${
          isUser
            ? 'bg-telos-blue-600/30 border border-telos-blue-600/20 text-slate-100'
            : 'bg-surface-700 border border-slate-600/50 text-slate-200'
        }`}
      >
        {/* Attachment card (user messages with documents) */}
        {isUser && message.attachment && (
          <div className="mb-2 flex items-center gap-2 text-xs">
            <FileText className="w-4 h-4 text-telos-blue-400 flex-shrink-0" />
            <span className="text-slate-300 truncate max-w-[160px]">{message.attachment.fileName}</span>
            {message.attachment.status === 'extracting' && (
              <Loader2 className="w-3.5 h-3.5 text-telos-blue-400 animate-spin flex-shrink-0" />
            )}
            {message.attachment.status === 'ocr-processing' && (
              <span className="text-[10px] text-amber-400 flex-shrink-0">
                OCR {message.attachment.ocrProgress ?? 0}%
              </span>
            )}
            {message.attachment.status === 'done' && message.attachment.formType && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex-shrink-0">
                {message.attachment.formType}
              </span>
            )}
            {message.attachment.status === 'error' && (
              <span className="text-[10px] text-red-400 flex-shrink-0">Failed</span>
            )}
          </div>
        )}

        {/* Message content */}
        {isUser && isEditing ? (
          <div>
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                if (e.key === 'Escape') cancelEditing();
              }}
              className="w-full bg-transparent text-sm text-slate-100 leading-relaxed resize-none
                         focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={cancelEditing}
                className="text-xs font-medium px-3.5 py-1.5 rounded-full text-slate-300 hover:text-slate-100
                           bg-surface-600 hover:bg-surface-500 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!editText.trim()}
                className="text-xs font-medium px-3.5 py-1.5 rounded-full text-white
                           bg-slate-200 text-surface-900 hover:bg-surface-800 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
        ) : (
          <MarkdownMessage content={injectStepLinks(message.content)} />
        )}

        {message.verification?.footnote && (
          <div className="mt-1.5 text-[10px] text-amber-400/70 italic border-t border-amber-400/20 pt-1">
            {message.verification.footnote}
          </div>
        )}

        {/* Action preview (assistant messages only) */}
        {message.actions && message.actions.length > 0 && (
          <ActionPreview
            actions={message.actions}
            messageId={message.id}
            applied={message.actionsApplied || false}
            dismissed={message.actionsDismissed || false}
            summary={message.actionsSummary}
            onApplied={onActionsApplied}
            onDismissed={onActionsDismissed}
            onUndo={onUndoActions}
          />
        )}

        {/* Option pills (structured choices — last assistant message only) */}
        {isLastAssistant && message.options && message.options.length > 0 && (
          <OptionPills
            options={message.options}
            multiSelect={message.multiSelect}
            onFollowUp={onFollowUp}
          />
        )}

        {/* Follow-up chips (last assistant message only) */}
        {isLastAssistant && message.followUpChips && message.followUpChips.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-slate-600/30 flex flex-wrap gap-1.5">
            {message.followUpChips.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => onFollowUp(chip)}
                className="text-[11px] px-2.5 py-1 rounded-full
                           bg-telos-blue-500/10 border border-telos-blue-500/25
                           text-telos-blue-300 hover:bg-telos-blue-500/20 hover:border-telos-blue-500/40
                           transition-colors cursor-pointer"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* ─── Action bar (assistant messages only) ─── */}
        {!isUser ? (
          <div className="flex items-center justify-between mt-1.5">
            {/* Left: feedback buttons */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onFeedback(message.id, 'up')}
                className={`p-1 rounded transition-colors ${
                  message.feedback === 'up'
                    ? 'text-emerald-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                aria-label="Good response"
                title="Good response"
              >
                <ThumbsUp className="w-3 h-3" />
              </button>
              <button
                onClick={() => onFeedback(message.id, 'down')}
                className={`p-1 rounded transition-colors ${
                  message.feedback === 'down'
                    ? 'text-red-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                aria-label="Poor response"
                title="Poor response"
              >
                <ThumbsDown className="w-3 h-3" />
              </button>
            </div>

            {/* Right: copy, regenerate, timestamp */}
            <div className="flex items-center gap-0.5">
              {window.speechSynthesis && (
                <button
                  onClick={handleSpeak}
                  className={`p-1 rounded transition-all ${
                    isSpeaking
                      ? 'text-telos-blue-400 opacity-100'
                      : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-300'
                  }`}
                  aria-label={isSpeaking ? 'Stop speaking' : 'Read aloud'}
                  title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
                >
                  {isSpeaking
                    ? <VolumeX className="w-3 h-3" />
                    : <Volume2 className="w-3 h-3" />
                  }
                </button>
              )}
              <button
                onClick={handleCopy}
                className="p-1 rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-300 transition-all"
                aria-label="Copy message"
                title="Copy to clipboard"
              >
                {copied
                  ? <Check className="w-3 h-3 text-emerald-400" />
                  : <Copy className="w-3 h-3" />
                }
              </button>
              {showRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="p-1 rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-300 transition-all"
                  aria-label="Regenerate response"
                  title="Regenerate response"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
              <span className="text-[10px] text-slate-500 ml-1">
                {formatTime(message.timestamp)}
              </span>
            </div>
          </div>
        ) : (
          /* User message: timestamp, retry, edit, copy */
          !isEditing && (
          <div className="flex items-center justify-end gap-0.5 mt-1.5">
            <span className="text-[10px] text-telos-blue-400/60 mr-0.5">
              {formatTime(message.timestamp)}
            </span>
            <button
              onClick={() => onRetry(message.id)}
              className="p-0.5 rounded text-telos-blue-400/40 opacity-0 group-hover:opacity-100 hover:text-telos-blue-300 transition-all"
              aria-label="Retry this message"
              title="Retry"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            <button
              onClick={startEditing}
              className="p-0.5 rounded text-telos-blue-400/40 opacity-0 group-hover:opacity-100 hover:text-telos-blue-300 transition-all"
              aria-label="Edit message"
              title="Edit"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={handleCopy}
              className="p-0.5 rounded text-telos-blue-400/40 opacity-0 group-hover:opacity-100 hover:text-telos-blue-300 transition-all"
              aria-label="Copy message"
              title="Copy to clipboard"
            >
              {copied
                ? <Check className="w-3 h-3 text-emerald-400" />
                : <Copy className="w-3 h-3" />
              }
            </button>
          </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Formatting Helpers ──────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}
