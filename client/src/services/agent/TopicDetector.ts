/**
 * Topic Detector
 *
 * Lightweight keyword-based intent classifier that detects when a user's
 * message is about a different skill than the currently active one.
 * Used by the orchestrator to initiate detours.
 */

interface IntentPattern {
  skillId: string;
  patterns: RegExp[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    skillId: 'personal-info',
    patterns: [
      /\b(change|update)\s+(my\s+)?(name|address|personal\s+info)/i,
    ],
  },
  {
    skillId: 'filing-status',
    patterns: [
      /\b(filing\s+status|married|single|head\s+of\s+household|hoh)\b/i,
      /\bfile\s+(jointly|separately)\b/i,
    ],
  },
  {
    skillId: 'dependents',
    patterns: [
      /\b(add|claim)\s+(a\s+)?dependent/i,
      /\bmy\s+(kid|child|children|daughter|son)\b/i,
    ],
  },
  {
    skillId: 'income-wages',
    patterns: [
      /\bw-?2\b/i,
      /\b(salary|wages|paycheck|employer)\b/i,
    ],
  },
  {
    skillId: 'income-freelance',
    patterns: [
      /\b1099-?(nec|k|misc)\b/i,
      /\b(freelance|gig|uber|etsy|side\s+hustle|independent\s+contractor)\b/i,
    ],
  },
  {
    skillId: 'income-investments',
    patterns: [
      /\b1099-?(b|div|int|da)\b/i,
      /\b(stocks?|dividends?|interest\s+income|capital\s+gains?|crypto|k-?1)\b/i,
    ],
  },
  {
    skillId: 'income-retirement',
    patterns: [
      /\b1099-?r\b/i,
      /\b(pension|retirement|ira|401k|social\s+security|ssa|unemployment|1099-?g)\b/i,
    ],
  },
  {
    skillId: 'income-property',
    patterns: [
      /\b(rental|landlord|schedule\s+e|sold\s+(my\s+)?house|home\s+sale|royalt)/i,
    ],
  },
  {
    skillId: 'income-other',
    patterns: [
      /\b(gambling|prize|1099-?(sa|q|c)|hsa\s+distribution|529|canceled?\s+debt|alimony\s+received?)\b/i,
    ],
  },
  {
    skillId: 'self-employment',
    patterns: [
      /\b(self-?employ|schedule\s+c|business\s+expense|write-?off|home\s+office|mileage|business\s+mile)/i,
      /\b(sole\s+proprietor|solo\s+401k|sep\s+ira)\b/i,
    ],
  },
  {
    skillId: 'deductions-discovery',
    patterns: [
      /\b(deduction|itemiz|standard\s+deduction|should\s+i\s+itemize|tax\s+break)/i,
    ],
  },
  {
    skillId: 'deductions-itemized',
    patterns: [
      /\b(mortgage\s+interest|property\s+tax|charitable|medical\s+expense|salt\b|schedule\s+a)\b/i,
    ],
  },
  {
    skillId: 'deductions-above-line',
    patterns: [
      /\b(hsa\s+contribut|student\s+loan\s+interest|ira\s+deduct|educator\s+expense|estimated\s+tax\s+payment)\b/i,
    ],
  },
  {
    skillId: 'credits',
    patterns: [
      /\b(tax\s+credit|child\s+tax\s+credit|ctc|eitc|earned\s+income|education\s+credit|aotc|daycare|dependent\s+care|solar\s+panel|ev\s+credit|electric\s+vehicle|saver.*credit)\b/i,
    ],
  },
  {
    skillId: 'state-taxes',
    patterns: [
      /\b(state\s+(tax|return)|state\s+filing|part-?year|nonresident)\b/i,
    ],
  },
  {
    skillId: 'review',
    patterns: [
      /\b(review|check|error|miss\w*\s+anything|is\s+(it|my\s+return)\s+(complete|done|ready))\b/i,
      /\bwhat.*refund\b/i,
    ],
  },
  {
    skillId: 'finish',
    patterns: [
      /\b(i'?m\s+done|finish|file|export|download|print|direct\s+deposit|payment\s+option)\b/i,
    ],
  },
];

/**
 * Check if a user message suggests a different skill than the active one.
 * Returns the target skill ID, or null if no switch detected.
 */
export function detectTopicSwitch(
  message: string,
  activeSkillId: string | null,
): string | null {
  for (const { skillId, patterns } of INTENT_PATTERNS) {
    if (skillId === activeSkillId) continue;
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return skillId;
      }
    }
  }
  return null;
}
