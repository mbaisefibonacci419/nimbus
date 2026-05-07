import type { ChatAction, ChatResponse } from '../types/chat.js';

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = ToolUseBlock | TextBlock;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toolUseToAction(name: string, input: Record<string, unknown>): ChatAction | null {
  switch (name) {
    case 'add_income': {
      const incomeType = input.incomeType;
      const fields = input.fields;
      if (typeof incomeType !== 'string' || !isRecord(fields)) return null;
      return { type: 'add_income', incomeType, fields };
    }
    case 'set_filing_status': {
      const status = input.status;
      if (typeof status !== 'string') return null;
      return { type: 'set_filing_status', status };
    }
    case 'add_dependent': {
      const fields = input.fields;
      if (!isRecord(fields)) return null;
      return { type: 'add_dependent', fields };
    }
    case 'set_deduction_method': {
      const method = input.method;
      if (method !== 'standard' && method !== 'itemized') return null;
      return { type: 'set_deduction_method', method };
    }
    case 'update_itemized': {
      const fields = input.fields;
      if (!isRecord(fields)) return null;
      const numeric: Record<string, number> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'number' && !Number.isNaN(v)) numeric[k] = v;
      }
      return { type: 'update_itemized', fields: numeric };
    }
    case 'set_income_discovery': {
      const incomeType = input.incomeType;
      const value = input.value;
      if (typeof incomeType !== 'string') return null;
      if (value !== 'yes' && value !== 'no') return null;
      return { type: 'set_income_discovery', incomeType, value };
    }
    case 'update_field': {
      const field = input.field;
      if (typeof field !== 'string') return null;
      if (!('value' in input)) return null;
      return { type: 'update_field', field, value: input.value };
    }
    case 'navigate': {
      const stepId = input.stepId;
      if (typeof stepId !== 'string') return null;
      return { type: 'navigate', stepId };
    }
    case 'add_business_expense': {
      const category = input.category;
      const amount = input.amount;
      if (typeof category !== 'string') return null;
      if (typeof amount !== 'number' || Number.isNaN(amount)) return null;
      const description = input.description;
      if (description !== undefined && typeof description !== 'string') return null;
      return description === undefined
        ? { type: 'add_business_expense', category, amount }
        : { type: 'add_business_expense', category, amount, description };
    }
    case 'remove_item': {
      const itemType = input.itemType;
      const match = input.match;
      if (typeof itemType !== 'string' || !isRecord(match)) return null;
      return { type: 'remove_item', itemType, match };
    }
    case 'update_home_office':
    case 'update_vehicle':
    case 'update_business':
    case 'update_se_retirement': {
      const fields = input.fields;
      if (!isRecord(fields)) return null;
      return { type: name, fields } as ChatAction;
    }
    default:
      return null;
  }
}

/**
 * Parse Anthropic tool_use response content blocks into a ChatResponse.
 * Extracts the text message from text blocks and actions from tool_use blocks.
 */
export function parseToolUseResponse(content: ContentBlock[]): ChatResponse {
  const textParts: string[] = [];
  const actions: ChatAction[] = [];
  let sawToolUse = false;

  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      sawToolUse = true;
      const action = toolUseToAction(block.name, block.input);
      if (action) actions.push(action);
    }
  }

  const message = textParts.join('\n\n').trim();
  let finalActions: ChatAction[];
  if (!sawToolUse) {
    finalActions = [{ type: 'no_action' }];
  } else if (actions.length === 0) {
    finalActions = [{ type: 'no_action' }];
  } else {
    finalActions = actions;
  }

  let suggestedStep: string | null = null;
  for (const a of finalActions) {
    if (a.type === 'navigate') suggestedStep = a.stepId;
  }

  return { message, actions: finalActions, suggestedStep };
}
