import { useCallback, useMemo } from 'react';
import {
  ChartComponent, SeriesCollectionDirective, SeriesDirective,
  Inject, BarSeries, Category, Tooltip, DataLabel,
  type IPointRenderEventArgs, type ITooltipRenderEventArgs, type ITextRenderEventArgs,
  type IMouseEventArgs,
} from '@syncfusion/ej2-react-charts';
import { useChartTheme, tooltipStyle, axisLabelStyle, dataLabelFont, chartPalette } from '../../hooks/useChartTheme';

interface CategoryBarChartProps {
  items: Array<{ label: string; value: number; stepId: string }>;
  onBarClick?: (stepId: string) => void;
  colors?: string[];
}

const PALETTE = [
  chartPalette.blue, chartPalette.emerald, chartPalette.amber, chartPalette.violet, chartPalette.teal,
  chartPalette.red, chartPalette.orange, chartPalette.pink, chartPalette.cyan, chartPalette.lime,
];

const fmtDollars = (v: number): string => `$${v.toLocaleString()}`;

export default function CategoryBarChart({ items: rawItems, onBarClick, colors }: CategoryBarChartProps) {
  const t = useChartTheme();

  const items = useMemo(
    () => [...rawItems].sort((a, b) => b.value - a.value),
    [rawItems],
  );
  const data = useMemo(
    () => items.map((item) => ({ x: item.label, y: item.value, stepId: item.stepId })),
    [items],
  );
  const total = useMemo(() => items.reduce((s, i) => s + i.value, 0), [items]);

  const pointRender = useCallback((args: IPointRenderEventArgs): void => {
    args.fill = colors?.[args.point.index] || PALETTE[args.point.index % PALETTE.length];
  }, [colors]);

  const textRender = useCallback((args: ITextRenderEventArgs): void => {
    const item = data[(args.point as any)?.index];
    args.text = item ? fmtDollars(item.y) : '';
  }, [data]);

  const tooltipRender = useCallback((args: ITooltipRenderEventArgs): void => {
    const idx = (args.point as any)?.index;
    if (idx == null || !data[idx]) { args.text = ''; return; }
    const item = data[idx];
    const pct = total > 0 ? ((item.y / total) * 100).toFixed(1) : '0';
    args.text = `<b>${item.x}</b><br/>${fmtDollars(item.y)} (${pct}%)`;
  }, [data, total]);

  const chartMouseClick = useCallback((args: IMouseEventArgs): void => {
    if (!onBarClick) return;
    const idx = (args.target ?? '').match(/_Series_0_Point_(\d+)/)?.[1];
    if (idx == null) return;
    const item = data[Number(idx)];
    if (item?.stepId) onBarClick(item.stepId);
  }, [data, onBarClick]);

  const chartHeight = `${Math.max(120, data.length * 40 + 20)}px`;

  if (rawItems.length === 0) return null;

  return (
    <ChartComponent
      height={chartHeight}
      background="transparent"
      chartArea={{ border: { width: 0 } }}
      tooltip={{
        enable: true,
        ...tooltipStyle(t),
      }}
      pointRender={pointRender}
      textRender={textRender}
      tooltipRender={tooltipRender}
      chartMouseClick={chartMouseClick}
      primaryXAxis={{
        valueType: 'Category',
        isInversed: true,
        labelStyle: axisLabelStyle(t),
        majorGridLines: { width: 0 },
        majorTickLines: { width: 0 },
        lineStyle: { width: 0 },
      }}
      primaryYAxis={{
        visible: false,
        majorGridLines: { width: 0 },
      }}
      legendSettings={{ visible: false }}
      style={{ cursor: onBarClick ? 'pointer' : 'default' }}
    >
      <Inject services={[BarSeries, Category, Tooltip, DataLabel]} />
      <SeriesCollectionDirective>
        <SeriesDirective
          dataSource={data}
          xName="x"
          yName="y"
          type="Bar"
          columnWidth={0.5}
          cornerRadius={{ topLeft: 3, topRight: 3, bottomLeft: 3, bottomRight: 3 }}
          marker={{
            dataLabel: {
              visible: true,
              position: 'Outer',
              font: dataLabelFont(t),
            },
          }}
        />
      </SeriesCollectionDirective>
    </ChartComponent>
  );
}
