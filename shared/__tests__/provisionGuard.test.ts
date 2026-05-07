import { describe, it, expect } from 'vitest';
import {
  isProvisionActive,
  getProvisionFlags,
  type ProvisionKey,
} from '../src/engine/provisionGuard.js';

const ALL_PROVISION_KEYS: ProvisionKey[] = [
  'schedule1A',
  'scholarshipCredit',
  'expandedSALTCap',
  'tcja',
  'seniorDeductionBonus',
  'tipsOvertimeExclusion',
];

describe('provisionGuard', () => {
  it('isProvisionActive(2025, schedule1A) returns true', () => {
    expect(isProvisionActive(2025, 'schedule1A')).toBe(true);
  });

  it('isProvisionActive(2025, tipsOvertimeExclusion) returns false', () => {
    expect(isProvisionActive(2025, 'tipsOvertimeExclusion')).toBe(false);
  });

  it('isProvisionActive(2024, schedule1A) throws', () => {
    expect(() => isProvisionActive(2024, 'schedule1A')).toThrow(
      'No provision flags registered for tax year 2024',
    );
  });

  it('getProvisionFlags(2025) returns all 6 flags', () => {
    const flags = getProvisionFlags(2025);
    expect(Object.keys(flags).length).toBe(6);
    for (const k of ALL_PROVISION_KEYS) {
      expect(typeof flags[k]).toBe('boolean');
    }
  });

  it('getProvisionFlags(2025) returns a copy', () => {
    const a = getProvisionFlags(2025);
    a.schedule1A = false;
    const b = getProvisionFlags(2025);
    expect(b.schedule1A).toBe(true);
  });

  it('all ProvisionKeys are covered in 2025', () => {
    const flags = getProvisionFlags(2025);
    const fromMap = new Set(Object.keys(flags) as ProvisionKey[]);
    for (const k of ALL_PROVISION_KEYS) {
      expect(fromMap.has(k)).toBe(true);
    }
  });
});
