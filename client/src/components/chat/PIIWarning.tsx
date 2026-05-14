/**
 * PII Warning Banner — shown above the chat input when PII is detected.
 *
 * Displays what was detected and offers three options:
 *   1. Send the sanitized version (PII replaced with placeholders)
 *      — any extractable field values are saved directly to the local return
 *   2. Edit the message (dismiss warning, keep text in input)
 *   3. Cancel (dismiss warning, clear text)
 */

import { useMemo } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useChatStore, type PIIWarningState } from '../../store/chatStore';
import { extractPIIFields } from '@nimbus/engine';

interface Props {
  warning: PIIWarningState;
}

export default function PIIWarning({ warning }: Props) {
  const { sendSanitizedMessage, dismissPIIWarning } = useChatStore();

  const extractedFields = useMemo(
    () => extractPIIFields(warning.originalMessage, warning.detectedTypes).fields,
    [warning.originalMessage, warning.detectedTypes],
  );

  return (
    <div className="mx-3 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2 mb-2">
        <ShieldAlert className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-medium text-amber-300">
            Sensitive information detected
          </p>
          <p className="text-[11px] text-amber-400/80 mt-1">
            Your message contains personal information that will be
            removed before sending to the AI provider:
          </p>
        </div>
      </div>

      {/* What was detected */}
      <ul className="ml-6 mb-2 space-y-0.5">
        {warning.warnings.map((w, i) => (
          <li key={i} className="text-[11px] text-amber-400/70 flex items-start gap-1.5">
            <span className="text-amber-500 mt-px">&#x2022;</span>
            {w}
          </li>
        ))}
      </ul>

      {/* What will be saved locally */}
      {extractedFields.length > 0 && (
        <div className="ml-6 mb-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-medium text-emerald-300">
              Will be saved directly to your return:
            </span>
          </div>
          <ul className="space-y-0.5 ml-5">
            {extractedFields.map((f, i) => (
              <li key={i} className="text-[11px] text-emerald-400/80 flex items-start gap-1.5">
                <span className="text-emerald-500 mt-px">&#x2713;</span>
                {f.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 ml-6">
        <button
          onClick={sendSanitizedMessage}
          className="text-[11px] px-3 py-1.5 rounded-md bg-telos-orange-600 hover:bg-telos-orange-500
                     text-white font-medium transition-colors"
        >
          {extractedFields.length > 0 ? 'Save & send without PII' : 'Send without PII'}
        </button>
        <button
          onClick={dismissPIIWarning}
          className="text-[11px] px-3 py-1.5 rounded-md bg-surface-700 hover:bg-surface-600
                     text-slate-300 transition-colors"
        >
          Edit message
        </button>
      </div>
    </div>
  );
}
