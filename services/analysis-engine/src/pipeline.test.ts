/**
 * T09 · 标准化+离散化管道编排（RED 先行）。
 * 行为契约：派生序列计算 → 全序列日期对齐 → 参考期/检验期定位 →
 * 参考期拟合分箱阈值 → 全日期轴分箱（检验期复用阈值）。
 */
import { describe, expect, it } from 'vitest';
import { prepareDataset } from './pipeline.js';
import type { NumericSeries } from './types.js';

const series: NumericSeries[] = [
  {
    alias: 'A',
    points: [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 105 },
      { date: '2024-01-03', value: 110 },
      { date: '2024-01-08', value: 130 },
      { date: '2024-01-09', value: 120 },
      { date: '2024-01-10', value: 125 },
      { date: '2024-01-11', value: 140 },
    ],
  },
  {
    alias: 'B',
    points: [
      { date: '2024-01-02', value: 200 },
      { date: '2024-01-03', value: 210 },
      { date: '2024-01-08', value: 220 },
      { date: '2024-01-09', value: 230 },
      { date: '2024-01-10', value: 240 },
      { date: '2024-01-11', value: 250 },
    ],
  },
];

const periods = {
  referenceStart: '2024-01-01',
  referenceEnd: '2024-01-05',
  testStart: '2024-01-08',
  testEnd: '2024-01-12',
};

const binning = { method: 'quantile' as const, bins: 2 };

describe('prepareDataset', () => {
  it('派生序列：对齐后 C = A 的百分比收益率（首点丢弃参与对齐）', () => {
    const result = prepareDataset({
      series,
      derivedSeries: [{ alias: 'C', sourceAlias: 'A', transform: 'pct_return' }],
      periods,
      binning,
    });

    expect(result.aliases).toEqual(['A', 'B', 'C']);
    // C 在 2024-01-01 无前值 → 对齐后日期轴从 01-02 起
    expect(result.dates).toEqual([
      '2024-01-02',
      '2024-01-03',
      '2024-01-08',
      '2024-01-09',
      '2024-01-10',
      '2024-01-11',
    ]);
    const cIndex = result.aliases.indexOf('C');
    expect(result.values[cIndex]![0]).toBeCloseTo(0.05, 10); // 105/100-1
  });

  it('参考期/检验期索引按对齐日期轴闭区间定位', () => {
    const result = prepareDataset({ series, derivedSeries: [], periods, binning });
    // 参考期：01-02、01-03 → 索引 [0,1]；检验期：01-08~01-11 → [2,5]
    expect(result.referenceIndex).toEqual([0, 1]);
    expect(result.testIndex).toEqual([2, 5]);
  });

  it('分箱阈值仅用参考期拟合，检验期越界值归入末箱', () => {
    const result = prepareDataset({ series, derivedSeries: [], periods, binning });
    const aBins = result.binning['A']!;
    // A 参考期值 [105, 110] → 中位数阈值 107.5
    expect(aBins.thresholds).toEqual([107.5]);
    // 全轴 A 值 [105,110,130,120,125,140]：105≤107.5 归首箱，其余 > 阈值归末箱
    expect(result.categories['A']).toEqual([0, 1, 1, 1, 1, 1]);
  });

  it('两箱场景：阈值=参考期中位数，检验期复用且越界归末箱', () => {
    const result = prepareDataset({
      series,
      derivedSeries: [],
      periods: {
        referenceStart: '2024-01-01',
        referenceEnd: '2024-01-08', // 参考期 A: [105,110,130]
        testStart: '2024-01-09',
        testEnd: '2024-01-12', // 检验期 A: [120,125,140]
      },
      binning: { method: 'quantile', bins: 2 },
    });
    const aBins = result.binning['A']!;
    expect(aBins.thresholds).toEqual([110]); // 参考期 [105,110,130] 中位数
    expect(aBins.labels).toEqual(['bin_1', 'bin_2']);
    // 全轴 A 值 [105,110,130,120,125,140] → [0,0,1,1,1,1]
    expect(result.categories['A']).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it('派生序列引用不存在的别名抛错', () => {
    expect(() =>
      prepareDataset({
        series,
        derivedSeries: [{ alias: 'C', sourceAlias: 'GHOST', transform: 'diff' }],
        periods,
        binning,
      }),
    ).toThrow(/GHOST/);
  });

  it('别名冲突（派生与原始同名）抛错', () => {
    expect(() =>
      prepareDataset({
        series,
        derivedSeries: [{ alias: 'A', sourceAlias: 'B', transform: 'diff' }],
        periods,
        binning,
      }),
    ).toThrow(/别名/);
  });

  it('参考期在对齐轴上无观测抛错', () => {
    expect(() =>
      prepareDataset({
        series,
        derivedSeries: [],
        periods: {
          referenceStart: '2023-01-01',
          referenceEnd: '2023-12-31',
          testStart: '2024-01-08',
          testEnd: '2024-01-12',
        },
        binning,
      }),
    ).toThrow(/参考期/);
  });
});
