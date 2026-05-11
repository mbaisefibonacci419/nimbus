/**
 * TaxFlowDiagram — visual flow from income through deductions to final result.
 *
 * Single horizontal Syncfusion waterfall chart showing the full flow:
 *   Total Income → Adjustments → AGI → Deductions → Taxable Income →
 *   Tax → Surtaxes → Credits → Payments → Refund/Owed
 *
 * Data is in natural display order (Total Income first). The X axis uses
 * isInversed to render categories top-to-bottom while keeping intermediate
 * sum calculations correct (Syncfusion accumulates from index 0 forward).
 */

import {
  ChartComponent, SeriesCollectionDirective, SeriesDirective,
  Inject, WaterfallSeries, Category, Tooltip, DataLabel,
  type IPointRenderEventArgs, type ITextRenderEventArgs,
  type ITooltipRenderEventArgs, type IPointEventArgs,
} from '@syncfusion/ej2-react-charts';
import type { Form1040Result } from '@nimbus/engine';
import { useTaxReturnStore } from '../../store/taxReturnStore';
import { useChartTheme, chartPalette, tooltipStyle13, dataLabelFont } from '../../hooks/useChartTheme';

interface TaxFlowDiagramProps {
  form1040: Form1040Result;
}

// Map each bar's colorKey to the most relevant wizard step
const STEP_MAP: Record<string, string> = {
  totalIncome:   'income_overview',
  adjustments:   'deductions_summary',
  agi:           'income_overview',
  deduction:     'deduction_method',
  qbi:           'qbi_detail',
  taxableIncome: 'deduction_method',
  incomeTax:     'tax_summary',
  seTax:         'se_summary',
  niit:          'tax_summary',
  amt:           'amt_data',
  totalTax:      'tax_summary',
  credits:       'credits_overview',
  withholding:   'w2_income',
  estPayments:   'estimated_payments',
  refund:        'tax_summary',
  owed:          'tax_summary',
};

interface WaterfallStep {
  x: string;
  y: number;
  intermediateSum?: boolean;
  sum?: boolean;
  colorKey: string;
}

function fmtDollars(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`;
}

export default function TaxFlowDiagram({ form1040: f }: TaxFlowDiagramProps) {
  const t = useChartTheme();
  const goToStep = useTaxReturnStore((s) => s.goToStep);
  const isRefund = f.refundAmount > 0;

  const COLORS: Record<string, string> = {
    totalIncome: chartPalette.blue,
    adjustments: chartPalette.amber,
    agi: t.axisLabel,
    deduction: chartPalette.teal,
    qbi: chartPalette.cyan,
    taxableIncome: t.axisLabel,
    incomeTax: chartPalette.red,
    seTax: chartPalette.orange,
    niit: chartPalette.orangeLight,
    amt: chartPalette.red600,
    totalTax: t.axisLabel,
    credits: chartPalette.violet,
    withholding: chartPalette.lightViolet,
    estPayments: chartPalette.purpleLight,
    refund: chartPalette.emerald,
    owed: chartPalette.amber,
  };

  // Build steps in display order (Total Income → Refund/Owed).
  // isInversed on X axis flips the visual so Total Income is at the top.
  const steps: WaterfallStep[] = [];

  // --- Income to Taxable Income ---
  steps.push({ x: 'Total Income', y: f.totalIncome, colorKey: 'totalIncome' });

  if (f.totalAdjustments > 0) {
    steps.push({ x: 'Adjustments', y: -f.totalAdjustments, colorKey: 'adjustments' });
    steps.push({ x: 'AGI', y: 0, intermediateSum: true, colorKey: 'agi' });
  }

  const dedLabel = f.deductionUsed === 'standard' ? 'Standard Deduction' : 'Itemized Deductions';
  steps.push({ x: dedLabel, y: -f.deductionAmount, colorKey: 'deduction' });

  if (f.qbiDeduction > 0) {
    steps.push({ x: 'QBI Deduction', y: -f.qbiDeduction, colorKey: 'qbi' });
  }

  steps.push({ x: 'Taxable Income', y: 0, sum: true, colorKey: 'taxableIncome' });

  // --- Taxes (reset accumulator, then build up) ---
  // Insert invisible bar to reset running total to zero
  steps.push({ x: '\u200B', y: -f.taxableIncome, colorKey: 'reset' });

  steps.push({ x: 'Income Tax', y: f.incomeTax, colorKey: 'incomeTax' });
  if (f.seTax > 0) steps.push({ x: 'Self-Employment Tax', y: f.seTax, colorKey: 'seTax' });
  if (f.niitTax > 0) steps.push({ x: 'Net Investment Income Tax', y: f.niitTax, colorKey: 'niit' });
  if (f.amtAmount > 0) steps.push({ x: 'Alternative Minimum Tax', y: f.amtAmount, colorKey: 'amt' });

  const hasMultipleTaxes = f.seTax > 0 || f.niitTax > 0 || f.amtAmount > 0;
  if (f.incomeTax > 0 && hasMultipleTaxes) {
    steps.push({ x: 'Total Tax', y: 0, sum: true, colorKey: 'totalTax' });
  }

  if (f.totalCredits > 0) {
    steps.push({ x: 'Tax Credits', y: -f.totalCredits, colorKey: 'credits' });
  }
  if (f.totalWithholding > 0) {
    steps.push({ x: 'Withholding', y: -f.totalWithholding, colorKey: 'withholding' });
  }
  if (f.estimatedPayments > 0) {
    steps.push({ x: 'Estimated Payments', y: -f.estimatedPayments, colorKey: 'estPayments' });
  }

  steps.push({
    x: isRefund ? 'Your Refund' : 'Amount You Owe',
    y: 0,
    sum: true,
    colorKey: isRefund ? 'refund' : 'owed',
  });

  // Compute intermediate/sum indexes
  const intermediateSumIndexes = steps.reduce<number[]>((acc, s, i) => s.intermediateSum ? [...acc, i] : acc, []);
  const sumIndexes = steps.reduce<number[]>((acc, s, i) => s.sum ? [...acc, i] : acc, []);

  // Per-point coloring
  const pointRender = (args: IPointRenderEventArgs): void => {
    const step = steps[args.point.index];
    if (!step) return;
    if (step.colorKey === 'reset') {
      args.fill = 'transparent';
      args.border = { width: 0, color: 'transparent' };
    } else {
      args.fill = COLORS[step.colorKey] || t.axisLabel;
    }
  };

  // Navigate to the relevant wizard step on click
  const pointClick = (args: IPointEventArgs): void => {
    const step = steps[args.pointIndex];
    if (!step || step.colorKey === 'reset') return;
    const stepId = STEP_MAP[step.colorKey];
    if (stepId) goToStep(stepId);
  };

  // Data labels as whole-dollar currency
  const textRender = (args: ITextRenderEventArgs): void => {
    const step = steps[(args.point as any)?.index];
    if (!step || step.colorKey === 'reset') { args.text = ''; return; }
    const val = parseFloat(args.text?.replace(/[$,]/g, '') || '0');
    if (val === 0 && !step.intermediateSum && !step.sum) { args.text = ''; return; }
    args.text = fmtDollars(val);
  };

  // Tooltips with dollar signs and whole numbers
  const tooltipRender = (args: ITooltipRenderEventArgs): void => {
    const idx = (args.point as any)?.index;
    if (idx === undefined || !steps[idx] || steps[idx].colorKey === 'reset') {
      args.text = '';
      return;
    }
    const step = steps[idx];
    const pointY = (args.point as any)?.y;
    const absVal = Math.round(Math.abs(step.intermediateSum || step.sum ? (pointY || 0) : step.y));
    const prefix = step.y < 0 && !step.intermediateSum && !step.sum ? '−' : '';
    args.text = `<b>${step.x}</b><br/>${prefix}$${absVal.toLocaleString()}`;
  };

  const chartHeight = `${Math.max(350, steps.length * 48)}px`;

  return (
    <div className="tax-flow-diagram">
    <ChartComponent
      height={chartHeight}
      background="transparent"
      isTransposed={true}
      chartArea={{ border: { width: 0 } }}
      tooltip={{ enable: true, ...tooltipStyle13(t) }}
      pointRender={pointRender}
      pointClick={pointClick}
      textRender={textRender}
      tooltipRender={tooltipRender}
      primaryXAxis={{
        valueType: 'Category',
        isInversed: true,
        labelStyle: {
          color: t.svgTextMuted,
          fontFamily: chartPalette.font,
          size: '13px',
          fontWeight: '500',
        },
        majorGridLines: { width: 0 },
        majorTickLines: { width: 0 },
        lineStyle: { width: 0 },
      }}
      primaryYAxis={{
        visible: false,
        majorGridLines: { width: 0 },
      }}
      legendSettings={{ visible: false }}
      style={{ cursor: 'pointer' }}
    >
      <Inject services={[WaterfallSeries, Category, Tooltip, DataLabel]} />
      <SeriesCollectionDirective>
        <SeriesDirective
          dataSource={steps}
          xName="x"
          yName="y"
          type="Waterfall"
          intermediateSumIndexes={intermediateSumIndexes}
          sumIndexes={sumIndexes}
          columnWidth={0.6}
          cornerRadius={{ topLeft: 4, topRight: 4, bottomLeft: 4, bottomRight: 4 }}
          connector={{ color: t.connector, width: 1.5, dashArray: '4,3' }}
          marker={{
            dataLabel: {
              visible: true,
              position: 'Outer',
              font: { ...dataLabelFont(t), size: '13px' },
            },
          }}
        />
      </SeriesCollectionDirective>
    </ChartComponent>
    <p className="text-[11px] text-slate-500 text-center mt-1">Click any bar to jump to that section</p>
    </div>
  );
}
