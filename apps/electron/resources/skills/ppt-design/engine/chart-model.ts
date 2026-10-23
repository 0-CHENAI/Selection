import type { ChartSpec } from './types';

export type WaterfallColumn = {
  base: number;
  up: number;
  down: number;
};

/** Hidden-base waterfall columns: first and last sit on zero; middle values stack. */
export function waterfallColumns(values: number[]): WaterfallColumn[] {
  const columns: WaterfallColumn[] = [];
  let cursor = 0;
  values.forEach((value, index) => {
    const last = index === values.length - 1;
    if (last || index === 0) {
      columns.push({
        base: 0,
        up: Math.max(0, value),
        down: value < 0 ? -value : 0,
      });
      if (index === 0) cursor = value;
      return;
    }
    if (value >= 0) {
      columns.push({ base: cursor, up: value, down: 0 });
      cursor += value;
      return;
    }
    cursor += value;
    columns.push({ base: cursor, up: 0, down: -value });
  });
  return columns;
}

export function waterfallSeries(spec: ChartSpec): { name: string; labels: string[]; values: number[] }[] {
  const columns = waterfallColumns(spec.series[0]?.values ?? []);
  return [
    { name: 'base', labels: spec.categories, values: columns.map(column => column.base) },
    { name: 'up', labels: spec.categories, values: columns.map(column => column.up) },
    { name: 'down', labels: spec.categories, values: columns.map(column => column.down) },
  ];
}

export function chartMax(spec: ChartSpec): number {
  if (spec.kind === 'waterfall') {
    const columns = waterfallColumns(spec.series[0]?.values ?? []);
    return Math.max(1, ...columns.map(column => column.base + column.up + column.down));
  }
  return Math.max(1, ...spec.series.flatMap(item => item.values.map(Math.abs)));
}
