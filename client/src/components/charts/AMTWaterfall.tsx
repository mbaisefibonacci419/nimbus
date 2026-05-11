import { useCallback, useMemo } from 'react';
import {
  ChartComponent, SeriesCollectionDirective, SeriesDirective,
  Inject, WaterfallSeries, Category, Tooltip, DataLabel,
  type IPointRenderEventArgs, type ITooltipRenderEventArgs, type ITextRenderEventArgs,
} from '@syncfusion/ej2-react-charts';
import { useChartTheme, tooltipStyle, axisLabelStyle, dataLabelFont, chartPalette } from '../../hooks/useChartTheme';

interface AMTWaterfallProps {
  taxableIncome: number;
  adjustmentsTotal: number;
  exemption: number;
  tentativeMinTax: number;
  regularTax: number;
  amtAmount: number;
  applies: boolean;
}

const fmtDollars = (v: number): string => `$${Math.abs(v).toLocaleString()}`;

export default function AMTWaterfall({
  taxableIncome, adjustmentsTotal, exemption, tentativeMinTax, regularTax, amtAmount, applies,
}: AMTWaterfallProps) {
  const t = useChartTheme();

  // ── Section 1: AMTI buildup (linear, sums correctly) ──
  const amtiSection = useMemo(() => {
    const s: Array<{ x: string; y: number }> = [];
    const colors: string[] = [];

    s.push({ x: 'Taxable Income', y: taxableIncome });
    colors.push('income');

    if (Math.abs(adjustmentsTotal) >= 1) {
      s.push({ x: 'AMT Adjustments', y: adjustmentsTotal });
      colors.push('adjustments');
    }

    if (Math.abs(exemption) >= 1) {
      s.push({ x: 'Exemption', y: -exemption });
      colors.push('exemption');
    }

    s.push({ x: 'AMT Base', y: 0, isSum: true } as any);
    colors.push('amtBase');

    return { steps: s, sumIndexes: [s.length - 1], colors };
  }, [taxableIncome, adjustmentsTotal, exemption]);

  // ── Section 2: Tax comparison (linear, sums correctly) ──
  const taxSection = useMemo(() => {
    const s: Array<{ x: string; y: number }> = [];
    const colors: string[] = [];

    s.push({ x: 'Tentative Min Tax', y: tentativeMinTax });
    colors.push('tmt');

    if (Math.abs(regularTax) >= 1) {
      s.push({ x: 'Regular Tax', y: -regularTax });
      colors.push('regularTax');
    }

    s.push({ x: 'AMT Amount', y: amtAmount, isSum: true } as any);
    colors.push('amt');

    return { steps: s, sumIndexes: [s.length - 1], colors };
  }, [tentativeMinTax, regularTax, amtAmount]);

  const AMTI_COLORS: Record<string, string> = {
    income: chartPalette.blue,
    adjustments: chartPalette.amber,
    exemption: chartPalette.emerald,
    amtBase: chartPalette.violet,
  };

  const TAX_COLORS: Record<string, string> = {
    tmt: chartPalette.amber,
    regularTax: chartPalette.blue,
    amt: applies ? chartPalette.red : chartPalette.emerald,
  };

  // ── Chart 1: AMTI ──
  const amtiPointRender = useCallback((args: IPointRenderEventArgs): void => {
    const key = amtiSection.colors[args.point.index];
    if (key) args.fill = AMTI_COLORS[key] || t.axisLabel;
  }, [amtiSection.colors, t.axisLabel]);

  const amtiTextRender = useCallback((args: ITextRenderEventArgs): void => {
    const step = amtiSection.steps[(args.point as any)?.index];
    if (!step) { args.text = ''; return; }
    args.text = fmtDollars(step.y);
  }, [amtiSection.steps]);

  const amtiTooltipRender = useCallback((args: ITooltipRenderEventArgs): void => {
    const idx = (args.point as any)?.index;
    if (idx == null || !amtiSection.steps[idx]) { args.text = ''; return; }
    const step = amtiSection.steps[idx];
    args.text = `<b>${step.x}</b><br/>${fmtDollars(step.y)}`;
  }, [amtiSection.steps]);

  // ── Chart 2: Tax comparison ──
  const taxPointRender = useCallback((args: IPointRenderEventArgs): void => {
    const key = taxSection.colors[args.point.index];
    if (key) args.fill = TAX_COLORS[key] || t.axisLabel;
  }, [taxSection.colors, applies, t.axisLabel]);

  const taxTextRender = useCallback((args: ITextRenderEventArgs): void => {
    const step = taxSection.steps[(args.point as any)?.index];
    if (!step) { args.text = ''; return; }
    args.text = fmtDollars(step.y);
  }, [taxSection.steps]);

  const taxTooltipRender = useCallback((args: ITooltipRenderEventArgs): void => {
    const idx = (args.point as any)?.index;
    if (idx == null || !taxSection.steps[idx]) { args.text = ''; return; }
    const step = taxSection.steps[idx];
    args.text = `<b>${step.x}</b><br/>${fmtDollars(step.y)}`;
  }, [taxSection.steps]);

  const tooltipSettings = {
    enable: true,
    ...tooltipStyle(t),
  };

  const xAxisSettings = {
    valueType: 'Category' as const,
    isInversed: true,
    labelStyle: axisLabelStyle(t),
    majorGridLines: { width: 0 },
    majorTickLines: { width: 0 },
    lineStyle: { width: 0 },
  };

  const yAxisSettings = { visible: false, majorGridLines: { width: 0 } };

  const seriesSettings = {
    columnWidth: 0.55,
    cornerRadius: { topLeft: 3, topRight: 3, bottomLeft: 3, bottomRight: 3 },
    connector: { color: t.connector, width: 1, dashArray: '4,3' },
    marker: {
      dataLabel: {
        visible: true,
        position: 'Outer' as const,
        font: dataLabelFont(t),
      },
    },
  };

  const amtiHeight = `${Math.max(140, amtiSection.steps.length * 48 + 20)}px`;
  const taxHeight = `${Math.max(140, taxSection.steps.length * 48 + 20)}px`;

  if (taxableIncome === 0) return null;

  return (
    <div className="rounded-lg bg-slate-800/30 p-3 mb-3 space-y-4">
      {/* Part 1: AMTI computation */}
      <div>
        <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Part I — AMT Base
        </h4>
        <ChartComponent
          height={amtiHeight}
          background="transparent"
          isTransposed={true}
          chartArea={{ border: { width: 0 } }}
          tooltip={tooltipSettings}
          pointRender={amtiPointRender}
          textRender={amtiTextRender}
          tooltipRender={amtiTooltipRender}
          primaryXAxis={xAxisSettings}
          primaryYAxis={yAxisSettings}
          legendSettings={{ visible: false }}
        >
          <Inject services={[WaterfallSeries, Category, Tooltip, DataLabel]} />
          <SeriesCollectionDirective>
            <SeriesDirective
              dataSource={amtiSection.steps}
              xName="x"
              yName="y"
              type="Waterfall"
              sumIndexes={amtiSection.sumIndexes}
              {...seriesSettings}
            />
          </SeriesCollectionDirective>
        </ChartComponent>
      </div>

      {/* Rate annotation */}
      <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500 border-t border-slate-700/50 pt-3">
        <span>AMT Base</span>
        <span className="text-slate-600">×</span>
        <span>26%/28% rate</span>
        <span className="text-slate-600">=</span>
        <span className="text-slate-300 font-medium">${tentativeMinTax.toLocaleString()} tentative min tax</span>
      </div>

      {/* Part 2: Tax comparison */}
      <div>
        <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Part II — AMT Determination
        </h4>
        <ChartComponent
          height={taxHeight}
          background="transparent"
          isTransposed={true}
          chartArea={{ border: { width: 0 } }}
          tooltip={tooltipSettings}
          pointRender={taxPointRender}
          textRender={taxTextRender}
          tooltipRender={taxTooltipRender}
          primaryXAxis={xAxisSettings}
          primaryYAxis={yAxisSettings}
          legendSettings={{ visible: false }}
        >
          <Inject services={[WaterfallSeries, Category, Tooltip, DataLabel]} />
          <SeriesCollectionDirective>
            <SeriesDirective
              dataSource={taxSection.steps}
              xName="x"
              yName="y"
              type="Waterfall"
              sumIndexes={taxSection.sumIndexes}
              {...seriesSettings}
            />
          </SeriesCollectionDirective>
        </ChartComponent>
      </div>
    </div>
  );
}
