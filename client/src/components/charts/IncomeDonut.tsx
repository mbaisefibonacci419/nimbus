import { useCallback } from 'react';
import {
  AccumulationChartComponent,
  AccumulationSeriesCollectionDirective,
  AccumulationSeriesDirective,
  Inject,
  PieSeries,
  AccumulationTooltip,
  AccumulationDataLabel,
  type IAccPointRenderEventArgs,
  type IAccTooltipRenderEventArgs,
  type IAccTextRenderEventArgs,
  type IMouseEventArgs,
} from '@syncfusion/ej2-react-charts';
import { useChartTheme, chartPalette, tooltipStyle, dataLabelFont } from '../../hooks/useChartTheme';

interface IncomeDonutProps {
  items: Array<{ label: string; value: number; stepId: string }>;
  onSliceClick?: (stepId: string) => void;
  height?: string;
}

const DONUT_PALETTE = [
  chartPalette.blue,
  chartPalette.emerald,
  chartPalette.amber,
  chartPalette.violet,
  chartPalette.teal,
  chartPalette.red,
  chartPalette.orange,
  chartPalette.pink,
  chartPalette.cyan,
  chartPalette.lime,
];

const fmtCompact = (v: number): string => {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toLocaleString()}`;
};

const fmtDollars = (v: number): string => `$${v.toLocaleString()}`;

export default function IncomeDonut({ items: rawItems, onSliceClick, height = '640px' }: IncomeDonutProps) {
  const t = useChartTheme();

  if (rawItems.length === 0) return null;

  // Sort descending so large slices spread around the ring,
  // preventing all small-slice labels from stacking on one side
  const items = [...rawItems].sort((a, b) => b.value - a.value);
  const total = items.reduce((s, i) => s + i.value, 0);

  const pointRender = useCallback((args: IAccPointRenderEventArgs): void => {
    args.fill = DONUT_PALETTE[args.point.index % DONUT_PALETTE.length];
  }, []);

  const tooltipRender = useCallback((args: IAccTooltipRenderEventArgs): void => {
    const idx = args.point?.index;
    if (idx == null || !items[idx]) return;
    const item = items[idx];
    const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
    args.text = `<b>${item.label}</b><br/>${fmtDollars(item.value)}<br/>${pct}%`;
  }, [items, total]);

  const textRender = useCallback((args: IAccTextRenderEventArgs): void => {
    const idx = (args.point as any)?.index;
    if (idx == null || !items[idx]) { args.text = ''; return; }
    args.text = fmtCompact(items[idx].value);
  }, [items]);

  const chartMouseClick = useCallback((args: IMouseEventArgs): void => {
    const idx = (args.target ?? '').match(/_Series_0_Point_(\d+)/)?.[1];
    if (idx == null) return;
    const item = items[Number(idx)];
    if (item && onSliceClick) onSliceClick(item.stepId);
  }, [items, onSliceClick]);

  return (
    <div className="income-donut-clickable">
      <AccumulationChartComponent
        height={height}
          background="transparent"
          legendSettings={{ visible: false }}
          tooltip={{ enable: true, ...tooltipStyle(t) }}
          pointRender={pointRender}
          tooltipRender={tooltipRender}
          textRender={textRender}
          chartMouseClick={chartMouseClick}
          enableSmartLabels={true}
        >
          <Inject services={[PieSeries, AccumulationTooltip, AccumulationDataLabel]} />
          <AccumulationSeriesCollectionDirective>
            <AccumulationSeriesDirective
              dataSource={items}
              xName="label"
              yName="value"
              innerRadius="50%"
              radius="65%"
              dataLabel={{
                visible: true,
                position: 'Outside',
                connectorStyle: { length: '40px', color: t.connector, width: 1 },
                font: dataLabelFont(t),
              }}
            />
          </AccumulationSeriesCollectionDirective>
        </AccumulationChartComponent>
    </div>
  );
}
