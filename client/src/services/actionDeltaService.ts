import type { CalculationResult, Form1040Result } from '@nimbus/engine';

export interface MetricDelta {
  label: string;
  before: number;
  after: number;
  delta: number;
  direction: 'up' | 'down' | 'unchanged';
}

export interface ActionDeltaResult {
  significant: boolean;
  deltas: MetricDelta[];
  summaryText: string;
}

const METRICS: Array<{
  key: keyof Pick<
    Form1040Result,
    'refundAmount' | 'amountOwed' | 'agi' | 'taxableIncome' | 'totalCredits' | 'totalTax'
  >;
  label: string;
  /** Short phrase after "Your …" in summary sentences */
  summaryPhrase: string;
}> = [
  { key: 'refundAmount', label: 'Federal Refund', summaryPhrase: 'federal refund' },
  { key: 'amountOwed', label: 'Amount Owed', summaryPhrase: 'amount owed' },
  { key: 'agi', label: 'Adjusted Gross Income', summaryPhrase: 'AGI' },
  { key: 'taxableIncome', label: 'Taxable Income', summaryPhrase: 'taxable income' },
  { key: 'totalCredits', label: 'Total Credits', summaryPhrase: 'total credits' },
  { key: 'totalTax', label: 'Total Tax', summaryPhrase: 'total tax' },
];

function fmtUsd(n: number): string {
  return `~$${Math.round(n).toLocaleString('en-US')}`;
}

export function computeActionDelta(
  before: CalculationResult | null,
  after: CalculationResult | null,
): ActionDeltaResult {
  if (!before || !after || !before.form1040 || !after.form1040) {
    return { significant: false, deltas: [], summaryText: '' };
  }

  const b0 = before.form1040;
  const a0 = after.form1040;
  const deltas: MetricDelta[] = [];
  const summaryParts: string[] = [];

  for (const { key, label, summaryPhrase } of METRICS) {
    const beforeVal = Number(b0[key] ?? 0);
    const afterVal = Number(a0[key] ?? 0);
    const delta = afterVal - beforeVal;
    const direction: MetricDelta['direction'] =
      delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged';

    deltas.push({ label, before: beforeVal, after: afterVal, delta, direction });

    if (Math.abs(delta) > 50) {
      const verb = delta > 0 ? 'increased' : 'decreased';
      summaryParts.push(
        `Your ${summaryPhrase} ${verb} by ${fmtUsd(Math.abs(delta))} (from ${fmtUsd(beforeVal)} to ${fmtUsd(afterVal)}).`,
      );
    }
  }

  const significant = deltas.some((d) => Math.abs(d.delta) > 100);

  return {
    significant,
    deltas,
    summaryText: summaryParts.join(' '),
  };
}
