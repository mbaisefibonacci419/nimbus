/**
 * LLM Response Parser — Action Schema Validation Tests
 *
 * Verifies that parseResponse() correctly handles:
 *   - Valid structured JSON (all 15 action types)
 *   - Missing / malformed fields
 *   - Unknown action types (graceful drop)
 *   - Malformed arrays and partial JSON
 *   - Extra fields (stripped by Zod)
 *   - Empty actions and no_action edge case
 *   - Markdown code fences around JSON
 *   - Truncated / cut-off LLM responses
 *   - followUpChips parsing
 */

import { describe, it, expect } from 'vitest';
import { parseResponse, extractJSON } from '../src/utils/llmResponseParser.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function validResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    message: 'Here is your response.',
    actions: [],
    suggestedStep: null,
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Valid JSON — Happy Paths
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — valid JSON', () => {
  it('parses a minimal valid response with no actions', () => {
    const result = parseResponse(validResponse());
    expect(result.message).toBe('Here is your response.');
    expect(result.actions).toEqual([]);
    expect(result.suggestedStep).toBeNull();
  });

  it('parses a response with suggestedStep', () => {
    const result = parseResponse(validResponse({ suggestedStep: 'w2_income' }));
    expect(result.suggestedStep).toBe('w2_income');
  });

  it('parses followUpChips', () => {
    const result = parseResponse(validResponse({
      followUpChips: ['What about deductions?', 'How much do I owe?', 'Am I done?'],
    }));
    expect(result.followUpChips).toEqual([
      'What about deductions?',
      'How much do I owe?',
      'Am I done?',
    ]);
  });

  it('limits followUpChips to 3', () => {
    const result = parseResponse(validResponse({
      followUpChips: ['a', 'b', 'c', 'd', 'e'],
    }));
    expect(result.followUpChips).toHaveLength(3);
  });

  it('filters empty strings from followUpChips', () => {
    const result = parseResponse(validResponse({
      followUpChips: ['valid', '', 'also valid'],
    }));
    expect(result.followUpChips).toEqual(['valid', 'also valid']);
  });

  // ── Options parsing ──

  it('parses options array with label/value/description objects', () => {
    const result = parseResponse(validResponse({
      options: [
        { label: 'Single', value: 'single', description: 'Unmarried' },
        { label: 'MFJ', value: 'married_filing_jointly', description: 'Married, joint return' },
      ],
    }));
    expect(result.options).toBeDefined();
    expect(result.options).toHaveLength(2);
    expect(result.options![0].label).toBe('Single');
    expect(result.options![0].value).toBe('single');
    expect(result.options![1].label).toBe('MFJ');
  });

  it('parses options with only label (minimal valid option)', () => {
    const result = parseResponse(validResponse({
      options: [{ label: 'Yes' }, { label: 'No' }],
    }));
    expect(result.options).toHaveLength(2);
    expect(result.options![0].label).toBe('Yes');
  });

  it('filters out malformed options missing label', () => {
    const result = parseResponse(validResponse({
      options: [
        { label: 'Valid', value: 'v' },
        { value: 'no_label' },
        42,
        null,
      ],
    }));
    expect(result.options).toHaveLength(1);
    expect(result.options![0].label).toBe('Valid');
  });

  it('omits options when array is empty', () => {
    const result = parseResponse(validResponse({ options: [] }));
    expect(result.options).toBeUndefined();
  });

  it('omits options when not present in JSON', () => {
    const result = parseResponse(validResponse());
    expect(result.options).toBeUndefined();
  });

  it('preserves options alongside actions and followUpChips', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'set_income_discovery', incomeType: 'credits_asked', value: 'yes' }],
      options: [
        { label: 'Yes, continue', value: 'continue' },
        { label: 'Wait', value: 'wait' },
      ],
      followUpChips: ['Tell me more'],
    }));
    expect(result.actions).toHaveLength(1);
    expect(result.options).toHaveLength(2);
    expect(result.followUpChips).toHaveLength(1);
  });

  it('parses the exact raw JSON from the user-reported bug', () => {
    const rawJson = `{ "message": "No problem! That's actually good news — none of those add to your tax bill. 🎉\\n\\nYour current refund estimate stays at $5,520.82 and we're all set on Other Income.\\n\\nReady to move on to the next section?", "actions": [ { "type": "set_income_discovery", "incomeType": "other_income_asked", "value": "yes" } ], "suggestedStep": null, "options": [ { "label": "Yes, let's continue", "value": "continue", "description": "Move to the next section" }, { "label": "Wait, I have a question", "value": "question", "description": "Ask about something first" } ], "followUpChips": [] }`;
    const result = parseResponse(rawJson);
    expect(result.message).toContain('good news');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('set_income_discovery');
    expect(result.options).toBeDefined();
    expect(result.options).toHaveLength(2);
    expect(result.options![0].label).toBe("Yes, let's continue");
    expect(result.options![1].label).toBe('Wait, I have a question');
  });

  // ── multiSelect parsing ──

  it('parses multiSelect: true from JSON response', () => {
    const result = parseResponse(validResponse({
      multiSelect: true,
      options: [
        { label: 'HSA contributions', value: 'hsa' },
        { label: 'Student loan interest', value: 'student_loan' },
        { label: 'None of these', value: 'none' },
      ],
    }));
    expect(result.multiSelect).toBe(true);
    expect(result.options).toHaveLength(3);
  });

  it('omits multiSelect when not present in JSON', () => {
    const result = parseResponse(validResponse({
      options: [{ label: 'Single', value: 'single' }],
    }));
    expect(result.multiSelect).toBeUndefined();
  });

  it('omits multiSelect when set to false', () => {
    const result = parseResponse(validResponse({ multiSelect: false }));
    expect(result.multiSelect).toBeUndefined();
  });

  it('ignores multiSelect when it is not a boolean', () => {
    const result = parseResponse(validResponse({ multiSelect: 'yes' }));
    expect(result.multiSelect).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. All 15 Action Types — Schema Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — action type validation', () => {
  it('parses add_income action', () => {
    const result = parseResponse(validResponse({
      actions: [{
        type: 'add_income',
        incomeType: 'w2',
        fields: { employer: 'Acme Corp', wages: 75000 },
      }],
    }));
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toEqual({
      type: 'add_income',
      incomeType: 'w2',
      fields: { employer: 'Acme Corp', wages: 75000 },
    });
  });

  it('parses set_filing_status action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'set_filing_status', status: 'married_filing_jointly' }],
    }));
    expect(result.actions[0]).toEqual({
      type: 'set_filing_status',
      status: 'married_filing_jointly',
    });
  });

  it('parses add_dependent action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'add_dependent', fields: { relationship: 'child', monthsLived: 12 } }],
    }));
    expect(result.actions[0].type).toBe('add_dependent');
  });

  it('parses set_deduction_method — standard', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'set_deduction_method', method: 'standard' }],
    }));
    expect(result.actions[0]).toEqual({ type: 'set_deduction_method', method: 'standard' });
  });

  it('parses set_deduction_method — itemized', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'set_deduction_method', method: 'itemized' }],
    }));
    expect(result.actions[0]).toEqual({ type: 'set_deduction_method', method: 'itemized' });
  });

  it('rejects set_deduction_method with invalid method', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'set_deduction_method', method: 'magic' }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('parses update_itemized action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'update_itemized', fields: { stateTaxes: 5000, mortgageInterest: 12000 } }],
    }));
    expect(result.actions[0].type).toBe('update_itemized');
  });

  it('parses set_income_discovery action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'set_income_discovery', incomeType: 'selfEmployment', value: 'yes' }],
    }));
    expect(result.actions[0]).toEqual({
      type: 'set_income_discovery',
      incomeType: 'selfEmployment',
      value: 'yes',
    });
  });

  it('rejects set_income_discovery with invalid value', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'set_income_discovery', incomeType: 'w2', value: 'maybe' }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('parses update_field action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'update_field', field: 'filingStatus', value: 'single' }],
    }));
    expect(result.actions[0]).toEqual({
      type: 'update_field',
      field: 'filingStatus',
      value: 'single',
    });
  });

  it('parses navigate action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'navigate', stepId: 'deductions_overview' }],
    }));
    expect(result.actions[0]).toEqual({ type: 'navigate', stepId: 'deductions_overview' });
  });

  it('parses add_business_expense action', () => {
    const result = parseResponse(validResponse({
      actions: [{
        type: 'add_business_expense',
        category: 'office_supplies',
        amount: 500,
        description: 'Printer and paper',
      }],
    }));
    expect(result.actions[0]).toEqual({
      type: 'add_business_expense',
      category: 'office_supplies',
      amount: 500,
      description: 'Printer and paper',
    });
  });

  it('parses add_business_expense without optional description', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'add_business_expense', category: 'rent', amount: 12000 }],
    }));
    expect(result.actions[0].type).toBe('add_business_expense');
  });

  it('parses remove_item action', () => {
    const result = parseResponse(validResponse({
      actions: [{
        type: 'remove_item',
        itemType: 'income',
        match: { incomeType: 'w2', employer: 'OldJob Inc' },
      }],
    }));
    expect(result.actions[0].type).toBe('remove_item');
  });

  it('parses update_home_office action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'update_home_office', fields: { squareFootage: 200 } }],
    }));
    expect(result.actions[0].type).toBe('update_home_office');
  });

  it('parses update_vehicle action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'update_vehicle', fields: { totalMiles: 15000, businessMiles: 8000 } }],
    }));
    expect(result.actions[0].type).toBe('update_vehicle');
  });

  it('parses update_business action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'update_business', fields: { businessName: 'My LLC' } }],
    }));
    expect(result.actions[0].type).toBe('update_business');
  });

  it('parses update_se_retirement action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'update_se_retirement', fields: { solo401kDeferral: 23500 } }],
    }));
    expect(result.actions[0].type).toBe('update_se_retirement');
  });

  it('parses no_action', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'no_action' }],
    }));
    expect(result.actions).toEqual([{ type: 'no_action' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Multi-Action Responses
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — multi-action responses', () => {
  it('parses multiple valid actions', () => {
    const result = parseResponse(validResponse({
      actions: [
        { type: 'set_filing_status', status: 'single' },
        { type: 'add_income', incomeType: 'w2', fields: { wages: 75000 } },
        { type: 'navigate', stepId: 'income_summary' },
      ],
    }));
    expect(result.actions).toHaveLength(3);
    expect(result.actions.map(a => a.type)).toEqual([
      'set_filing_status',
      'add_income',
      'navigate',
    ]);
  });

  it('drops invalid actions while keeping valid ones', () => {
    const result = parseResponse(validResponse({
      actions: [
        { type: 'set_filing_status', status: 'single' },
        { type: 'unknown_action', foo: 'bar' },
        { type: 'navigate', stepId: 'review' },
      ],
    }));
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].type).toBe('set_filing_status');
    expect(result.actions[1].type).toBe('navigate');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Missing / Malformed Fields
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — missing and malformed fields', () => {
  it('returns fallback when message field is missing', () => {
    const result = parseResponse(JSON.stringify({ actions: [], suggestedStep: null }));
    expect(result.message).toBeTruthy();
    expect(result.actions).toEqual([]);
  });

  it('returns fallback when message is not a string', () => {
    const result = parseResponse(JSON.stringify({ message: 42, actions: [] }));
    expect(typeof result.message).toBe('string');
    expect(result.actions).toEqual([]);
  });

  it('treats missing actions as empty array', () => {
    const result = parseResponse(JSON.stringify({ message: 'Hello' }));
    expect(result.actions).toEqual([]);
  });

  it('treats non-array actions as empty array', () => {
    const result = parseResponse(JSON.stringify({ message: 'Hello', actions: 'not an array' }));
    expect(result.actions).toEqual([]);
  });

  it('treats null actions as empty array', () => {
    const result = parseResponse(JSON.stringify({ message: 'Hello', actions: null }));
    expect(result.actions).toEqual([]);
  });

  it('treats null suggestedStep as null', () => {
    const result = parseResponse(validResponse({ suggestedStep: null }));
    expect(result.suggestedStep).toBeNull();
  });

  it('treats non-string suggestedStep as null', () => {
    const result = parseResponse(validResponse({ suggestedStep: 123 }));
    expect(result.suggestedStep).toBeNull();
  });

  it('treats undefined suggestedStep as null', () => {
    const result = parseResponse(JSON.stringify({ message: 'Hi', actions: [] }));
    expect(result.suggestedStep).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Unknown Action Types
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — unknown action types', () => {
  it('drops actions with completely unknown types', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'teleport_user', destination: 'moon' }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('drops actions with no type field', () => {
    const result = parseResponse(validResponse({
      actions: [{ field: 'wages', value: 50000 }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('drops actions with null type', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: null }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('drops actions with numeric type', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 42 }],
    }));
    expect(result.actions).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Extra Fields (Zod strips them)
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — extra fields', () => {
  it('accepts actions with extra fields (stripped by Zod)', () => {
    const result = parseResponse(validResponse({
      actions: [{
        type: 'set_filing_status',
        status: 'single',
        hallucinated_field: 'this should be ignored',
      }],
    }));
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('set_filing_status');
  });

  it('ignores extra top-level fields in response', () => {
    const result = parseResponse(JSON.stringify({
      message: 'Hello',
      actions: [],
      suggestedStep: null,
      internalThinking: 'I should not leak this',
      confidence: 0.95,
    }));
    expect(result.message).toBe('Hello');
    expect((result as any).internalThinking).toBeUndefined();
    expect((result as any).confidence).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Markdown Code Fences
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — markdown code fences', () => {
  it('extracts JSON from ```json fences', () => {
    const raw = '```json\n' + validResponse() + '\n```';
    const result = parseResponse(raw);
    expect(result.message).toBe('Here is your response.');
    expect(result.actions).toEqual([]);
  });

  it('extracts JSON from plain ``` fences', () => {
    const raw = '```\n' + validResponse() + '\n```';
    const result = parseResponse(raw);
    expect(result.message).toBe('Here is your response.');
  });

  it('extracts JSON from mixed text + code fence', () => {
    const raw = 'Here is what I found:\n\n```json\n' + validResponse() + '\n```\n\nLet me know if you need more.';
    const result = parseResponse(raw);
    expect(result.message).toBe('Here is your response.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Truncated / Cut-Off Responses
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — truncated responses', () => {
  it('salvages message from truncated JSON (no closing brace)', () => {
    const raw = '{"message": "Your wages total $75,000. Let me add this W-2.", "actions": [{"type": "add_inco';
    const result = parseResponse(raw);
    expect(result.message).toContain('Your wages total $75,000');
    expect(result.actions).toEqual([]);
  });

  it('salvages message from JSON with truncated message value', () => {
    const raw = '{"message": "Based on your filing status, you qualify for the standard deduction of $15,700. This means your taxable income would be approximately';
    const result = parseResponse(raw);
    expect(result.message).toContain('standard deduction');
    expect(result.actions).toEqual([]);
  });

  it('handles completely empty string', () => {
    const result = parseResponse('');
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.actions).toEqual([]);
  });

  it('handles whitespace-only string', () => {
    const result = parseResponse('   \n\t  ');
    expect(typeof result.message).toBe('string');
    expect(result.actions).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Plain Text Fallback
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — plain text fallback', () => {
  it('treats plain text as a message-only response', () => {
    const result = parseResponse('I can help you with your tax return!');
    expect(result.message).toBe('I can help you with your tax return!');
    expect(result.actions).toEqual([]);
    expect(result.suggestedStep).toBeNull();
  });

  it('handles multiline plain text', () => {
    const result = parseResponse('Line 1\nLine 2\nLine 3');
    expect(result.message).toContain('Line 1');
    expect(result.actions).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. extractJSON — Unit Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('extractJSON', () => {
  it('returns raw text that starts with {', () => {
    const json = '{"message": "hi"}';
    expect(extractJSON(json)).toBe(json);
  });

  it('returns null for plain text', () => {
    expect(extractJSON('Just a message')).toBeNull();
  });

  it('extracts from ```json fences', () => {
    const result = extractJSON('```json\n{"message":"hi"}\n```');
    expect(result).toBe('{"message":"hi"}');
  });

  it('extracts first { ... } block from surrounding text', () => {
    const result = extractJSON('Some preamble {"message":"hi"} some epilogue');
    expect(result).toBe('{"message":"hi"}');
  });

  it('handles leading whitespace', () => {
    const result = extractJSON('  \n  {"message":"hi"}');
    expect(result).toBe('{"message":"hi"}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Required Field Validation per Action Type
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — required field validation', () => {
  it('drops add_income missing incomeType', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'add_income', fields: { wages: 50000 } }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('drops add_income missing fields', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'add_income', incomeType: 'w2' }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('drops navigate missing stepId', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'navigate' }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('drops add_business_expense missing amount', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'add_business_expense', category: 'rent' }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('drops add_business_expense with string amount', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'add_business_expense', category: 'rent', amount: 'twelve thousand' }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('drops update_field missing field name', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'update_field', value: 'single' }],
    }));
    expect(result.actions).toHaveLength(0);
  });

  it('drops remove_item missing match', () => {
    const result = parseResponse(validResponse({
      actions: [{ type: 'remove_item', itemType: 'income' }],
    }));
    expect(result.actions).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseResponse — edge cases', () => {
  it('handles deeply nested fields in add_income', () => {
    const result = parseResponse(validResponse({
      actions: [{
        type: 'add_income',
        incomeType: 'k1',
        fields: {
          partnershipName: 'ABC LLC',
          box1: 50000,
          box14: { selfEmploymentEarnings: 45000 },
        },
      }],
    }));
    expect(result.actions).toHaveLength(1);
  });

  it('handles unicode in message', () => {
    const result = parseResponse(validResponse({
      message: 'Your tax liability is $5,914 💰. Let\u2019s review your deductions.',
    }));
    expect(result.message).toContain('$5,914');
    expect(result.message).toContain('\u2019');
  });

  it('handles escaped quotes in message', () => {
    const result = parseResponse(validResponse({
      message: 'The IRS says \\"reasonable compensation\\" must be reported.',
    }));
    expect(result.message).toContain('reasonable compensation');
  });

  it('handles very large action arrays', () => {
    const actions = Array.from({ length: 50 }, (_, i) => ({
      type: 'add_business_expense' as const,
      category: `category_${i}`,
      amount: i * 100,
    }));
    const result = parseResponse(validResponse({ actions }));
    expect(result.actions).toHaveLength(50);
  });

  it('handles the Anthropic JSON prefill pattern (starts with {)', () => {
    const raw = '{"message": "I can see you have a W-2 from Acme Corp.", "actions": [{"type": "no_action"}], "suggestedStep": null}';
    const result = parseResponse(raw);
    expect(result.message).toContain('W-2 from Acme Corp');
    expect(result.actions).toEqual([{ type: 'no_action' }]);
  });
});
