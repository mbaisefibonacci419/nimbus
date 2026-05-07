import { describe, it, expect } from 'vitest';
import { ACTION_TOOL_SCHEMAS } from '../src/services/actionToolSchemas.js';

/** ChatAction `type` values that map to tools (excludes no_action). */
const EXPECTED_TOOL_NAMES = [
  'add_income',
  'set_filing_status',
  'add_dependent',
  'set_deduction_method',
  'update_itemized',
  'set_income_discovery',
  'update_field',
  'navigate',
  'add_business_expense',
  'remove_item',
  'update_home_office',
  'update_vehicle',
  'update_business',
  'update_se_retirement',
] as const;

describe('ACTION_TOOL_SCHEMAS', () => {
  it('exports one schema per actionable ChatAction type (14, excluding no_action)', () => {
    expect(ACTION_TOOL_SCHEMAS).toHaveLength(14);
    const names = ACTION_TOOL_SCHEMAS.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it('each schema has name, description, and input_schema', () => {
    for (const def of ACTION_TOOL_SCHEMAS) {
      expect(def.name).toBeTruthy();
      expect(typeof def.description).toBe('string');
      expect(def.description.length).toBeGreaterThan(10);
      expect(def.input_schema.type).toBe('object');
      expect(Array.isArray(def.input_schema.required)).toBe(true);
      expect(def.input_schema.required.length).toBeGreaterThan(0);
      expect(def.input_schema.properties).toBeDefined();
      expect(typeof def.input_schema.properties).toBe('object');
    }
  });

  it('add_income lists incomeType and fields', () => {
    const s = ACTION_TOOL_SCHEMAS.find((t) => t.name === 'add_income')!;
    expect(s.input_schema.properties).toMatchObject({
      incomeType: expect.objectContaining({ type: 'string' }),
      fields: expect.objectContaining({ type: 'object' }),
    });
    expect(s.input_schema.required).toEqual(expect.arrayContaining(['incomeType', 'fields']));
  });

  it('set_filing_status status uses filing status enum values', () => {
    const s = ACTION_TOOL_SCHEMAS.find((t) => t.name === 'set_filing_status')!;
    const statusProp = s.input_schema.properties.status as { enum?: string[] };
    expect(statusProp.enum).toEqual(
      expect.arrayContaining(['single', 'married_filing_jointly', 'head_of_household']),
    );
  });

  it('navigate lists stepId', () => {
    const s = ACTION_TOOL_SCHEMAS.find((t) => t.name === 'navigate')!;
    expect(s.input_schema.properties).toMatchObject({
      stepId: expect.objectContaining({ type: 'string' }),
    });
    expect(s.input_schema.required).toContain('stepId');
  });

  it('schema names match ChatAction type / tool identifiers', () => {
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(ACTION_TOOL_SCHEMAS.some((d) => d.name === name)).toBe(true);
    }
  });
});
