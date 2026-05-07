/**
 * Provision guards — check whether year-specific legislative features are active.
 *
 * Engine modules use these guards instead of hardcoded year checks.
 * Currently only 2025 is registered; future years will have different flags.
 */

/** Known provisions that vary by tax year */
export type ProvisionKey =
  | 'schedule1A' // OBBBA Schedule 1-A deductions
  | 'scholarshipCredit' // OBBBA §25F scholarship credit
  | 'expandedSALTCap' // OBBBA expanded SALT ($40k/$80k vs TCJA $10k)
  | 'tcja' // Tax Cuts and Jobs Act provisions
  | 'seniorDeductionBonus' // OBBBA §102 senior standard deduction
  | 'tipsOvertimeExclusion'; // Future: tips/overtime income exclusion

/**
 * Provision flags by tax year.
 * When adding a new year, add an entry here with the correct flags.
 */
const PROVISION_MAP: Record<number, Record<ProvisionKey, boolean>> = {
  2025: {
    schedule1A: true,
    scholarshipCredit: true,
    expandedSALTCap: true,
    tcja: true,
    seniorDeductionBonus: true,
    tipsOvertimeExclusion: false,
  },
};

/** Check if a provision is active for a given tax year */
export function isProvisionActive(taxYear: number, provision: ProvisionKey): boolean {
  const flags = PROVISION_MAP[taxYear];
  if (!flags) {
    throw new Error(`No provision flags registered for tax year ${taxYear}`);
  }
  return flags[provision];
}

/** Get all provision flags for a tax year */
export function getProvisionFlags(taxYear: number): Record<ProvisionKey, boolean> {
  const flags = PROVISION_MAP[taxYear];
  if (!flags) {
    throw new Error(`No provision flags registered for tax year ${taxYear}`);
  }
  return { ...flags };
}
