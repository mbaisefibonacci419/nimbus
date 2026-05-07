import { describe, it, expect } from 'vitest';
import {
  parseToolUseResponse,
  type ContentBlock,
} from '../src/services/toolResponseParser.js';

function textBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

function toolBlock(name: string, input: Record<string, unknown>, id = 'tool_1'): ContentBlock {
  return { type: 'tool_use', id, name, input };
}

describe('parseToolUseResponse', () => {
  it('text-only response yields no_action', () => {
    const r = parseToolUseResponse([textBlock('Hello')]);
    expect(r.message).toBe('Hello');
    expect(r.actions).toEqual([{ type: 'no_action' }]);
    expect(r.suggestedStep).toBeNull();
  });

  it('single tool_use maps to the correct ChatAction', () => {
    const r = parseToolUseResponse([
      toolBlock('set_deduction_method', { method: 'itemized' }),
    ]);
    expect(r.actions).toEqual([{ type: 'set_deduction_method', method: 'itemized' }]);
  });

  it('multiple tool_use blocks become multiple actions', () => {
    const r = parseToolUseResponse([
      toolBlock('set_deduction_method', { method: 'standard' }, 't1'),
      toolBlock('navigate', { stepId: 'w2_income' }, 't2'),
    ]);
    expect(r.actions).toEqual([
      { type: 'set_deduction_method', method: 'standard' },
      { type: 'navigate', stepId: 'w2_income' },
    ]);
  });

  it('mixed text + tool_use returns message and actions', () => {
    const r = parseToolUseResponse([
      textBlock('Applied.'),
      toolBlock('update_field', { field: 'hsaDeduction', value: 4000 }),
    ]);
    expect(r.message).toBe('Applied.');
    expect(r.actions).toEqual([
      { type: 'update_field', field: 'hsaDeduction', value: 4000 },
    ]);
  });

  it('add_income tool_use produces expected shape', () => {
    const r = parseToolUseResponse([
      toolBlock('add_income', {
        incomeType: 'w2',
        fields: { employerName: 'Acme', wages: 90000 },
      }),
    ]);
    expect(r.actions[0]).toEqual({
      type: 'add_income',
      incomeType: 'w2',
      fields: { employerName: 'Acme', wages: 90000 },
    });
  });

  it('navigate sets suggestedStep to stepId (last wins if multiple)', () => {
    const r = parseToolUseResponse([
      toolBlock('navigate', { stepId: 'tax_summary' }, 'a'),
      toolBlock('navigate', { stepId: 'w2_income' }, 'b'),
    ]);
    expect(r.actions.filter((a) => a.type === 'navigate')).toHaveLength(2);
    expect(r.suggestedStep).toBe('w2_income');
  });

  it('unknown tool name is skipped; valid tools still parse', () => {
    const r = parseToolUseResponse([
      toolBlock('unknown_magic', { foo: 1 }),
      toolBlock('navigate', { stepId: 'filing_status' }),
    ]);
    expect(r.actions).toEqual([{ type: 'navigate', stepId: 'filing_status' }]);
    expect(r.suggestedStep).toBe('filing_status');
  });

  it('only unknown tools yield no_action', () => {
    const r = parseToolUseResponse([toolBlock('not_a_real_tool', {})]);
    expect(r.actions).toEqual([{ type: 'no_action' }]);
    expect((r.actions[0] as { type: string }).type).toBe('no_action');
  });

  it('joins multiple text blocks with blank lines', () => {
    const r = parseToolUseResponse([textBlock('Line one'), textBlock('Line two')]);
    expect(r.message).toBe('Line one\n\nLine two');
  });
});
