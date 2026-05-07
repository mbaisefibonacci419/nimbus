/**
 * Anthropic Tool Schemas — generated from ChatAction types.
 *
 * These can be passed to Anthropic's `tools` parameter to get
 * structured tool_use responses instead of free-form JSON.
 * Currently used for validation only; production still uses
 * JSON mode via system prompt instructions.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/** Known income types for add_income (aligned with system prompt + wizard). */
export const ADD_INCOME_TYPES = [
  'w2',
  '1099nec',
  '1099k',
  '1099int',
  '1099oid',
  '1099div',
  '1099r',
  '1099g',
  '1099misc',
  '1099b',
  '1099da',
  '1099sa',
  '1099q',
  '1099c',
  'w2g',
  'k1',
  'ssa1099',
  'rental-properties',
] as const;

export const FILING_STATUS_VALUES = [
  'single',
  'married_filing_jointly',
  'mfj',
  'married_filing_separately',
  'mfs',
  'head_of_household',
  'hoh',
  'qualifying_surviving_spouse',
  'qss',
] as const;

export const BUSINESS_EXPENSE_CATEGORIES = [
  'advertising',
  'car_truck',
  'commissions_fees',
  'contract_labor',
  'depreciation',
  'insurance',
  'interest_other',
  'legal_professional',
  'office_expense',
  'pension',
  'rent_property',
  'rent_equipment',
  'repairs_maintenance',
  'supplies',
  'taxes_licenses',
  'travel',
  'meals',
  'utilities',
  'wages',
  'other_expenses',
] as const;

const objectProperty = {
  type: 'object',
  additionalProperties: true,
} as const;

const numberMapProperty = {
  type: 'object',
  additionalProperties: { type: 'number' },
  description:
    'Partial map of itemized deduction field names to dollar amounts. Omitted keys are left unchanged.',
} as const;

export const ACTION_TOOL_SCHEMAS: ToolDefinition[] = [
  {
    name: 'add_income',
    description:
      'Add an income item to the return (W-2, 1099, K-1, rental property, etc.). Include the form-specific fields as key/value pairs; dollar amounts must be numbers without currency symbols. Prefer pairing with set_income_discovery when enabling a new section.',
    input_schema: {
      type: 'object',
      properties: {
        incomeType: {
          type: 'string',
          enum: [...ADD_INCOME_TYPES],
          description: 'Wizard income type key matching add_income in the Nimbus system prompt.',
        },
        fields: {
          ...objectProperty,
          description:
            'Form-specific fields (e.g. employerName, wages, federalTaxWithheld for W-2).',
        },
      },
      required: ['incomeType', 'fields'],
    },
  },
  {
    name: 'set_filing_status',
    description:
      'Set federal filing status for Form 1040. Use canonical or abbreviated values as in the system prompt (e.g. married_filing_jointly or mfj).',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [...FILING_STATUS_VALUES],
          description:
            'Filing status: single, married_filing_jointly (mfj), married_filing_separately (mfs), head_of_household (hoh), qualifying_surviving_spouse (qss).',
        },
      },
      required: ['status'],
    },
  },
  {
    name: 'add_dependent',
    description:
      'Add a dependent with demographic and qualifying-child fields. Collect relationship, DOB, months lived with you, student/disabled flags as applicable.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          ...objectProperty,
          description:
            'Dependent fields: firstName, relationship, dateOfBirth (YYYY-MM-DD), monthsLivedWithYou, isStudent, isDisabled, etc.',
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'set_deduction_method',
    description:
      'Choose standard deduction versus itemizing. Users may elect itemized even when standard is higher (e.g. for state tax benefit).',
    input_schema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          enum: ['standard', 'itemized'],
          description: 'standard or itemized',
        },
      },
      required: ['method'],
    },
  },
  {
    name: 'update_itemized',
    description:
      'Set or adjust Schedule A–style itemized amounts (medical, SALT, mortgage interest, charity, etc.). Only include fields the user provided; omitted fields are not cleared.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          ...numberMapProperty,
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'set_income_discovery',
    description:
      'Enable or disable a wizard section via discovery keys (income types, deduction/credit keys such as ded_hsa, child_credit). Controls which steps are visible.',
    input_schema: {
      type: 'object',
      properties: {
        incomeType: {
          type: 'string',
          description:
            'Discovery key from the system prompt (income, deduction, or credit key).',
        },
        value: {
          type: 'string',
          enum: ['yes', 'no'],
          description: 'yes to show the section, no to hide it',
        },
      },
      required: ['incomeType', 'value'],
    },
  },
  {
    name: 'update_field',
    description:
      'Update a single allowed top-level return field (HSA deduction, student loan interest, IRA, educator expenses, etc.). Do not use for Solo 401(k), SEP, or SE health insurance — use update_se_retirement instead.',
    input_schema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          description: 'Top-level field name allowed by the system prompt allowlist.',
        },
        value: {
          description: 'New scalar or structured value for the field.',
        },
      },
      required: ['field', 'value'],
    },
  },
  {
    name: 'navigate',
    description:
      'Jump the user to a specific wizard step by stable step ID (e.g. w2_income, mortgage_interest_ded). Use markdown links in the message for the same IDs when listing topics.',
    input_schema: {
      type: 'object',
      properties: {
        stepId: {
          type: 'string',
          description: 'Wizard step id (snake_case) from the system prompt step list.',
        },
      },
      required: ['stepId'],
    },
  },
  {
    name: 'add_business_expense',
    description:
      'Append a Schedule C expense line with IRS Part II category, amount, and optional short description (e.g. software → other_expenses).',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: [...BUSINESS_EXPENSE_CATEGORIES],
          description: 'Schedule C expense category key',
        },
        amount: {
          type: 'number',
          description: 'Dollar amount, no $ or commas',
        },
        description: {
          type: 'string',
          description: 'Optional note (e.g. "Software subscriptions")',
        },
      },
      required: ['category', 'amount'],
    },
  },
  {
    name: 'remove_item',
    description:
      'Remove an existing list item (e.g. a W-2 or 1099) by income type and match fields that identify the row (amounts, employer tokens, or indices as supported by the app).',
    input_schema: {
      type: 'object',
      properties: {
        itemType: {
          type: 'string',
          description: 'Income or item type key (e.g. w2, 1099nec)',
        },
        match: {
          ...objectProperty,
          description: 'Fields that uniquely identify the item to delete',
        },
      },
      required: ['itemType', 'match'],
    },
  },
  {
    name: 'update_home_office',
    description:
      'Create or update the home office deduction: simplified ($5/sq ft up to 300) or actual method with square footage and expense allocation.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          ...objectProperty,
          description:
            'method (simplified|actual|null), squareFeet, totalHomeSquareFeet, and actual-expense splits as needed',
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'update_vehicle',
    description:
      'Create or update vehicle expenses: standard mileage or actual expenses; set method null to disable.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          ...objectProperty,
          description:
            'method (mileage|actual|null), businessMiles, totalMiles, commuteMiles, or actual expense breakdown',
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'update_business',
    description:
      'Create or update the Schedule C business profile: name, NAICS principal business code, accounting method, start-year and spouse flags.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          ...objectProperty,
          description:
            'businessName, principalBusinessCode (6-digit NAICS), businessDescription, accountingMethod, didStartThisYear, isSpouse',
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'update_se_retirement',
    description:
      'Set self-employment retirement and SE health insurance: Solo 401(k) deferrals/contributions, SEP/SIMPLE, premiums. Engine caps employer contributions from net SE income.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          ...objectProperty,
          description:
            'solo401kEmployeeDeferral, solo401kEmployerContribution, solo401kRothDeferral, sepIraContributions, simpleIraContributions, healthInsurancePremiums, otherRetirementContributions',
        },
      },
      required: ['fields'],
    },
  },
];
