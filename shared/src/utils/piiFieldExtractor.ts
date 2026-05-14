/**
 * PII Field Extractor
 *
 * Extracts structured tax-return field values from messages that contain PII.
 * This runs BEFORE the message is sanitized, so it sees the real values.
 * The extracted fields are applied directly to the local tax return (never
 * sent to the LLM), allowing the section to progress while keeping PII
 * out of the AI provider's hands.
 *
 * Supported extractions:
 *   - Street address → addressStreet
 *   - City/State/ZIP → addressCity, addressState, addressZip
 *   - Date of birth → dateOfBirth (ISO format)
 */

export interface ExtractedPIIField {
  field: string;
  value: string | number;
  label: string;
}

export interface PIIExtractionResult {
  fields: ExtractedPIIField[];
  llmHint: string;
}

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};

const STATE_ABBREVS = new Set(Object.values(US_STATES));

const STREET_SUFFIXES = /(?:st(?:reet)?|ave(?:nue)?|blvd|boulevard|dr(?:ive)?|ln|lane|rd|road|ct|court|pl(?:ace)?|way|cir(?:cle)?|pkwy|parkway|ter(?:race)?|trl|trail|loop|hwy|highway|run|pass|xing|crossing|sq(?:uare)?|commons?|row|al(?:ley)?|mews|plaza|plz|esplanade|walk|path|pike|spur|crescent|cres|glen|knoll|ridge|view|meadow|grove|isle|landing|point|bay|bend|cove|heights?|manor|garden|pond|shore|spring|summit|valley)/i;

const ADDRESS_RE =
  /\b(\d{1,6}\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,3}\s+(?:st(?:reet)?|ave(?:nue)?|blvd|boulevard|dr(?:ive)?|ln|lane|rd|road|ct|court|pl(?:ace)?|way|cir(?:cle)?|pkwy|parkway|ter(?:race)?|trl|trail|loop|hwy|highway|run|pass|xing|crossing|sq(?:uare)?|commons?|row|al(?:ley)?|mews|plaza|plz|esplanade|walk|path|pike|spur|crescent|cres|glen|knoll|ridge|view|meadow|grove|isle|landing|point|bay|bend|cove|heights?|manor|garden|pond|shore|spring|summit|valley)\b\.?)(?:\s+(?:apt|suite|ste|unit|#|fl(?:oor)?|rm|room|bldg|building)\s*\.?\s*[A-Za-z0-9-]+)?/i;

const ZIP_RE = /\b(\d{5}(?:-\d{4})?)\b/;

const DOB_RE =
  /(?:born|birthday|date\s*of\s*birth|dob)\s*(?:on|is|:|-|=)?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|\w+\s+\d{1,2},?\s+\d{4})/i;

/**
 * Try to parse a city and state from the text surrounding an address.
 * Common patterns: "Springfield, CA", "Springfield CA", "Springfield, California"
 */
const CITY_STATE_RE =
  /(?:,\s*|\bin\s+)([A-Za-z][A-Za-z .'-]+?),?\s+([A-Z]{2})\b/;

const CITY_STATE_FULL_RE =
  /(?:,\s*|\bin\s+)([A-Za-z][A-Za-z .'-]+?),?\s+(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)\b/i;

function parseDate(raw: string): string | null {
  const cleaned = raw.trim();

  // Try MM/DD/YYYY or MM-DD-YYYY
  const mdyMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const year = y.length === 2 ? (parseInt(y) > 50 ? `19${y}` : `20${y}`) : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try "March 15, 1990" or "March 15 1990"
  const namedMatch = cleaned.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMatch) {
    const months: Record<string, string> = {
      january: '01', february: '02', march: '03', april: '04', may: '05',
      june: '06', july: '07', august: '08', september: '09', october: '10',
      november: '11', december: '12',
    };
    const monthNum = months[namedMatch[1].toLowerCase()];
    if (monthNum) {
      return `${namedMatch[3]}-${monthNum}-${namedMatch[2].padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Extract structured tax-return fields from a message that contains PII.
 *
 * @param originalMessage The raw user message BEFORE sanitization.
 * @param detectedTypes   PII types detected by scanForPII (e.g., ['address', 'zip_code']).
 * @returns Extracted fields and an LLM hint describing what was auto-saved.
 */
export function extractPIIFields(
  originalMessage: string,
  detectedTypes: string[],
): PIIExtractionResult {
  const fields: ExtractedPIIField[] = [];
  const typeSet = new Set(detectedTypes);
  const text = originalMessage.normalize('NFKC');

  // ── Street Address ──
  if (typeSet.has('address')) {
    const addrMatch = text.match(ADDRESS_RE);
    if (addrMatch) {
      fields.push({
        field: 'addressStreet',
        value: addrMatch[1].trim(),
        label: 'Street address',
      });
    }

    // City + State (abbreviation)
    const csMatch = text.match(CITY_STATE_RE);
    if (csMatch && STATE_ABBREVS.has(csMatch[2].toUpperCase())) {
      fields.push({
        field: 'addressCity',
        value: csMatch[1].trim(),
        label: 'City',
      });
      fields.push({
        field: 'addressState',
        value: csMatch[2].toUpperCase(),
        label: 'State',
      });
    } else {
      // Try full state name
      const csFullMatch = text.match(CITY_STATE_FULL_RE);
      if (csFullMatch) {
        fields.push({
          field: 'addressCity',
          value: csFullMatch[1].trim(),
          label: 'City',
        });
        const abbrev = US_STATES[csFullMatch[2].toLowerCase()];
        if (abbrev) {
          fields.push({
            field: 'addressState',
            value: abbrev,
            label: 'State',
          });
        }
      }
    }
  }

  // ── ZIP Code ──
  if (typeSet.has('zip_code')) {
    const zipMatch = text.match(ZIP_RE);
    if (zipMatch) {
      fields.push({
        field: 'addressZip',
        value: zipMatch[1],
        label: 'ZIP code',
      });
    }
  }

  // ── Date of Birth ──
  if (typeSet.has('dob')) {
    const dobMatch = text.match(DOB_RE);
    if (dobMatch) {
      const isoDate = parseDate(dobMatch[1]);
      if (isoDate) {
        fields.push({
          field: 'dateOfBirth',
          value: isoDate,
          label: 'Date of birth',
        });
      }
    }
  }

  // Build hint for LLM so it knows the data was captured
  let llmHint = '';
  if (fields.length > 0) {
    const saved = fields.map((f) => f.label).join(', ');
    llmHint = `\n\n[System: The user's ${saved} ${fields.length === 1 ? 'has' : 'have'} been securely saved to the return. Do NOT ask for ${fields.length === 1 ? 'it' : 'them'} again. Acknowledge receipt and continue.]`;
  }

  return { fields, llmHint };
}
