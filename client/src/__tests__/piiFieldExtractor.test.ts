/**
 * PII Field Extractor Tests
 *
 * Validates that structured tax return fields (address, ZIP, DOB) are
 * correctly extracted from PII-bearing messages before sanitization,
 * allowing the data to be saved locally while keeping PII out of the LLM.
 */

import { describe, it, expect } from 'vitest';
import { extractPIIFields } from '@nimbus/engine';

describe('extractPIIFields', () => {
  // ── Address extraction ────────────────────────────

  describe('street address', () => {
    it('extracts a basic street address', () => {
      const result = extractPIIFields(
        'I live at 123 Main Street, Springfield, CA 90210',
        ['address', 'zip_code'],
      );
      const street = result.fields.find((f) => f.field === 'addressStreet');
      expect(street).toBeDefined();
      expect(street!.value).toBe('123 Main Street');
    });

    it('extracts address with apartment info', () => {
      const result = extractPIIFields(
        'My address is 456 Oak Ave Apt 12B, Portland, OR 97201',
        ['address', 'zip_code'],
      );
      const street = result.fields.find((f) => f.field === 'addressStreet');
      expect(street).toBeDefined();
      expect((street!.value as string).startsWith('456 Oak Ave')).toBe(true);
    });

    it('handles abbreviated suffixes (St, Ave, Dr)', () => {
      const result = extractPIIFields(
        'I live at 789 Elm Dr, Austin, TX',
        ['address'],
      );
      const street = result.fields.find((f) => f.field === 'addressStreet');
      expect(street).toBeDefined();
      expect(street!.value).toBe('789 Elm Dr');
    });

    it('extracts less common suffixes (Cir, Pkwy, Ter)', () => {
      const result = extractPIIFields(
        'My home is 42 Sunset Cir, Denver, CO 80201',
        ['address', 'zip_code'],
      );
      const street = result.fields.find((f) => f.field === 'addressStreet');
      expect(street).toBeDefined();
      expect(street!.value).toBe('42 Sunset Cir');
    });
  });

  // ── City + State extraction ───────────────────────

  describe('city and state', () => {
    it('extracts city and state abbreviation', () => {
      const result = extractPIIFields(
        'I live at 123 Main Street, Springfield, CA 90210',
        ['address', 'zip_code'],
      );
      const city = result.fields.find((f) => f.field === 'addressCity');
      const state = result.fields.find((f) => f.field === 'addressState');
      expect(city?.value).toBe('Springfield');
      expect(state?.value).toBe('CA');
    });

    it('extracts full state name and converts to abbreviation', () => {
      const result = extractPIIFields(
        'I live at 123 Main Street, Springfield, California 90210',
        ['address', 'zip_code'],
      );
      const state = result.fields.find((f) => f.field === 'addressState');
      expect(state?.value).toBe('CA');
    });

    it('handles two-word state names', () => {
      const result = extractPIIFields(
        'I live at 50 Park Ave, Charlotte, North Carolina 28202',
        ['address', 'zip_code'],
      );
      const state = result.fields.find((f) => f.field === 'addressState');
      expect(state?.value).toBe('NC');
    });
  });

  // ── ZIP code extraction ───────────────────────────

  describe('ZIP code', () => {
    it('extracts 5-digit ZIP', () => {
      const result = extractPIIFields(
        'My ZIP code is 90210',
        ['zip_code'],
      );
      const zip = result.fields.find((f) => f.field === 'addressZip');
      expect(zip?.value).toBe('90210');
    });

    it('extracts ZIP+4 format', () => {
      const result = extractPIIFields(
        'My ZIP is 90210-1234',
        ['zip_code'],
      );
      const zip = result.fields.find((f) => f.field === 'addressZip');
      expect(zip?.value).toBe('90210-1234');
    });
  });

  // ── Date of birth extraction ──────────────────────

  describe('date of birth', () => {
    it('extracts DOB in MM/DD/YYYY format', () => {
      const result = extractPIIFields(
        'My date of birth is 03/15/1990',
        ['dob'],
      );
      const dob = result.fields.find((f) => f.field === 'dateOfBirth');
      expect(dob?.value).toBe('1990-03-15');
    });

    it('extracts DOB in YYYY-MM-DD format', () => {
      const result = extractPIIFields(
        'My DOB is 1990-03-15',
        ['dob'],
      );
      const dob = result.fields.find((f) => f.field === 'dateOfBirth');
      expect(dob?.value).toBe('1990-03-15');
    });

    it('extracts DOB with named month', () => {
      const result = extractPIIFields(
        'I was born on March 15, 1990',
        ['dob'],
      );
      const dob = result.fields.find((f) => f.field === 'dateOfBirth');
      expect(dob?.value).toBe('1990-03-15');
    });

    it('handles "born" keyword', () => {
      const result = extractPIIFields(
        'I was born 06/01/1985',
        ['dob'],
      );
      const dob = result.fields.find((f) => f.field === 'dateOfBirth');
      expect(dob?.value).toBe('1985-06-01');
    });

    it('handles two-digit year (pre-2000)', () => {
      const result = extractPIIFields(
        'Birthday is 12/25/75',
        ['dob'],
      );
      const dob = result.fields.find((f) => f.field === 'dateOfBirth');
      expect(dob?.value).toBe('1975-12-25');
    });
  });

  // ── Combined extraction ───────────────────────────

  describe('combined PII types', () => {
    it('extracts address, city, state, ZIP, and DOB from one message', () => {
      const result = extractPIIFields(
        'My name is Jane, I live at 123 Main Street, Springfield, CA 90210. My date of birth is 03/15/1990.',
        ['address', 'zip_code', 'dob'],
      );
      expect(result.fields.length).toBeGreaterThanOrEqual(4);
      expect(result.fields.find((f) => f.field === 'addressStreet')).toBeDefined();
      expect(result.fields.find((f) => f.field === 'addressZip')?.value).toBe('90210');
      expect(result.fields.find((f) => f.field === 'dateOfBirth')?.value).toBe('1990-03-15');
    });

    it('produces a meaningful LLM hint when fields are extracted', () => {
      const result = extractPIIFields(
        'I live at 123 Main Street, Springfield, CA 90210',
        ['address', 'zip_code'],
      );
      expect(result.llmHint).toContain('securely saved');
      expect(result.llmHint).toContain('Do NOT ask');
    });

    it('produces empty hint when no fields are extracted', () => {
      const result = extractPIIFields(
        'Hello, how are you?',
        [],
      );
      expect(result.fields).toHaveLength(0);
      expect(result.llmHint).toBe('');
    });
  });

  // ── Unextractable PII types ───────────────────────

  describe('non-address PII types', () => {
    it('does not extract SSN (too dangerous to auto-apply)', () => {
      const result = extractPIIFields(
        'My SSN is 123-45-6789',
        ['ssn'],
      );
      expect(result.fields.find((f) => f.field === 'ssn')).toBeUndefined();
    });

    it('does not extract email', () => {
      const result = extractPIIFields(
        'My email is john@example.com',
        ['email'],
      );
      expect(result.fields).toHaveLength(0);
    });

    it('does not extract phone number', () => {
      const result = extractPIIFields(
        'My phone is 555-123-4567',
        ['phone'],
      );
      expect(result.fields).toHaveLength(0);
    });
  });

  // ── Edge cases ────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty message', () => {
      const result = extractPIIFields('', ['address']);
      expect(result.fields).toHaveLength(0);
      expect(result.llmHint).toBe('');
    });

    it('handles empty detected types', () => {
      const result = extractPIIFields('123 Main St, City, CA 90210', []);
      expect(result.fields).toHaveLength(0);
    });

    it('handles address type without a matching pattern', () => {
      const result = extractPIIFields(
        'I live somewhere in California',
        ['address'],
      );
      expect(result.fields.find((f) => f.field === 'addressStreet')).toBeUndefined();
    });
  });
});
