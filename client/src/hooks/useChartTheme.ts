import { useThemeStore } from '../store/themeStore';

const FONT = 'Inter Variable, sans-serif';

const dark = {
  tooltipBg: '#1C1C1F',
  tooltipBorder: '#3E3E44',
  tooltipText: '#E2E8F0',
  axisLabel: '#94A3B8',
  gridLine: '#2C2C31',
  gridLineMajor: '#3E3E44',
  connector: '#3E3E44',
  svgTextPrimary: '#E2E8F0',
  svgTextSecondary: '#94A3B8',
  svgTextMuted: '#CBD5E1',
  cardBg: '#1C1C1F',
  pointerCap: '#E2E8F0',
};

const light = {
  tooltipBg: '#FAFBFC',
  tooltipBorder: '#D4D4D8',
  tooltipText: '#18181B',
  axisLabel: '#52525B',
  gridLine: '#E9EAEE',
  gridLineMajor: '#D8D9DE',
  connector: '#D8D9DE',
  svgTextPrimary: '#18181B',
  svgTextSecondary: '#52525B',
  svgTextMuted: '#3F3F46',
  cardBg: '#FAFBFC',
  pointerCap: '#18181B',
};

export type ChartTheme = typeof dark;

export const chartPalette = {
  blue: '#3B82F6',
  emerald: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  violet: '#8B5CF6',
  teal: '#14B8A6',
  orange: '#F97316',
  pink: '#EC4899',
  cyan: '#06B6D4',
  lime: '#84CC16',
  indigo: '#6366F1',
  purple: '#A855F7',
  lightViolet: '#A78BFA',
  purpleLight: '#C084FC',
  orangeLight: '#FB923C',
  greenLight: '#34D399',
  amberLight: '#FBBF24',
  amberDark: '#D97706',
  red600: '#DC2626',
  blue400: '#60A5FA',
  font: FONT,
};

export function tooltipStyle(t: ChartTheme) {
  return {
    fill: t.tooltipBg,
    border: { color: t.tooltipBorder, width: 1 },
    textStyle: { color: t.tooltipText, fontFamily: FONT, size: '12px' },
  };
}

export function tooltipStyle13(t: ChartTheme) {
  return {
    fill: t.tooltipBg,
    border: { color: t.tooltipBorder, width: 1 },
    textStyle: { color: t.tooltipText, fontFamily: FONT, size: '13px' },
  };
}

export function axisLabelStyle(t: ChartTheme) {
  return { color: t.axisLabel, fontFamily: FONT, size: '11px' };
}

export function dataLabelFont(t: ChartTheme) {
  return { color: t.svgTextPrimary, fontFamily: FONT, size: '11px', fontWeight: '600' };
}

export function dataLabelFontDark(t: ChartTheme) {
  return { color: t.tooltipBg, fontFamily: FONT, size: '12px', fontWeight: '700' };
}

export function useChartTheme(): ChartTheme {
  const mode = useThemeStore((s) => s.mode);
  return mode === 'dark' ? dark : light;
}
