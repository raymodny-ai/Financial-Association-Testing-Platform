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

  it('比值序列（S3）：R = A/B 按公共日期逐点相除，不丢首点', () => {
    const result = prepareDataset({
      series,
      derivedSeries: [{ alias: 'R', sourceAlias: 'A', denominatorAlias: 'B', transform: 'ratio' }],
      periods,
      binning,
    });
    // 对齐轴 = A∩B（B 缺 01-01）；R 恰好覆盖全部对齐日期（无首点丢弃）
    expect(result.dates).toEqual([
      '2024-01-02',
      '2024-01-03',
      '2024-01-08',
      '2024-01-09',
      '2024-01-10',
      '2024-01-11',
    ]);
    const rIndex = result.aliases.indexOf('R');
    expect(rIndex).toBeGreaterThan(-1);
    expect(result.values[rIndex]).toHaveLength(6);
    expect(result.values[rIndex]![0]).toBeCloseTo(105 / 200, 12);
    expect(result.values[rIndex]![5]).toBeCloseTo(140 / 250, 12);
  });

  it('比值序列（S3）：分母序列不存在或与分子同名校验报错', () => {
    expect(() =>
      prepareDataset({
        series,
        derivedSeries: [{ alias: 'R', sourceAlias: 'A', denominatorAlias: 'GHOST', transform: 'ratio' }],
        periods,
        binning,
      }),
    ).toThrow(/GHOST/);
    expect(() =>
      prepareDataset({
        series,
        derivedSeries: [{ alias: 'R', sourceAlias: 'A', denominatorAlias: 'A', transform: 'ratio' }],
        periods,
        binning,
      }),
    ).toThrow(/同一/);
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

  // S5 · 周频/月频重采样：对原始序列先重采样（期末值口径）再派生与对齐
  describe('S5 · frequency 重采样', () => {
    it('weekly：原始序列按 ISO 周聚合取期末值，参考/检验期在周轴上定位', () => {
      // 三周双序列（参考期需 ≥2 个周观测才能拟合 2 桶分箱，fitBinning 既有守卫）
      const threeWeeks: NumericSeries[] = [
        {
          alias: 'A',
          points: [
            { date: '2024-01-01', value: 99 },
            { date: '2024-01-02', value: 98 },
            { date: '2024-01-05', value: 100 }, // 周 1 期末（周五）
            { date: '2024-01-08', value: 105 },
            { date: '2024-01-12', value: 110 }, // 周 2 期末（与周五隔周末分属不同桶）
            { date: '2024-01-19', value: 90 }, // 周 3 期末（回落）
          ],
        },
        {
          alias: 'B',
          points: [
            { date: '2024-01-05', value: 200 },
            { date: '2024-01-12', value: 220 },
            { date: '2024-01-19', value: 250 },
          ],
        },
      ];
      const result = prepareDataset({
        series: threeWeeks,
        derivedSeries: [],
        periods: {
          referenceStart: '2024-01-01',
          referenceEnd: '2024-01-12',
          testStart: '2024-01-13',
          testEnd: '2024-01-19',
        },
        binning,
        frequency: 'weekly',
      });
      // 日期轴 = 各周期末的真实观测日；周五与下周一不得合并（跨周边界）
      expect(result.dates).toEqual(['2024-01-05', '2024-01-12', '2024-01-19']);
      const aIndex = result.aliases.indexOf('A');
      const bIndex = result.aliases.indexOf('B');
      expect(result.values[aIndex]).toEqual([100, 110, 90]); // 期末值（周内前值被覆盖）
      expect(result.values[bIndex]).toEqual([200, 220, 250]);
      // 参考期覆盖周 1+周 2；检验期覆盖周 3（日频日期区间直接命中周轴）
      expect(result.referenceIndex).toEqual([0, 1]);
      expect(result.testIndex).toEqual([2, 2]);
    });

    it('weekly：参考期含 2 周时阈值=参考期周值中位数，检验期复用', () => {
      const threeWeeks: NumericSeries[] = [
        {
          alias: 'A',
          points: [
            { date: '2024-01-05', value: 100 },
            { date: '2024-01-12', value: 110 },
            { date: '2024-01-19', value: 90 },
          ],
        },
      ];
      const result = prepareDataset({
        series: threeWeeks,
        derivedSeries: [],
        periods: {
          referenceStart: '2024-01-01',
          referenceEnd: '2024-01-12',
          testStart: '2024-01-13',
          testEnd: '2024-01-19',
        },
        binning,
        frequency: 'weekly',
      });
      expect(result.dates).toEqual(['2024-01-05', '2024-01-12', '2024-01-19']);
      expect(result.referenceIndex).toEqual([0, 1]);
      expect(result.testIndex).toEqual([2, 2]);
      // 参考期周值 [100,110] → 中位数阈值 105；全轴 [100,110,90] → [0,1,0]
      expect(result.binning['A']!.thresholds).toEqual([105]);
      expect(result.categories['A']).toEqual([0, 1, 0]);
    });

    it('weekly：派生收益率按周期末价计算（周收益 = 期末/上期末 − 1 口径）', () => {
      const weekly: NumericSeries[] = [
        {
          alias: 'A',
          points: [
            { date: '2024-01-01', value: 98 },
            { date: '2024-01-05', value: 100 }, // 周 1 期末 100（对齐后丢弃）
            { date: '2024-01-08', value: 105 },
            { date: '2024-01-12', value: 110 }, // 周 2 期末 110（+10%）
            { date: '2024-01-15', value: 112 },
            { date: '2024-01-19', value: 115.5 }, // 周 3 期末 115.5（+5%）
            { date: '2024-01-22', value: 128 },
            { date: '2024-01-26', value: 138.6 }, // 周 4 期末（+20%，参考期周收益 [0.1, 0.05] 非零跨度）
          ],
        },
      ];
      const result = prepareDataset({
        series: weekly,
        derivedSeries: [{ alias: 'C', sourceAlias: 'A', transform: 'pct_return' }],
        periods: {
          referenceStart: '2024-01-01',
          referenceEnd: '2024-01-19',
          testStart: '2024-01-20',
          testEnd: '2024-01-26',
        },
        binning,
        frequency: 'weekly',
      });
      // 周轴 [01-05,01-12,01-19,01-26]；C 丢首周 → 对齐轴 [01-12,01-19,01-26]
      expect(result.dates).toEqual(['2024-01-12', '2024-01-19', '2024-01-26']);
      const cIndex = result.aliases.indexOf('C');
      expect(result.values[cIndex]![0]).toBeCloseTo(0.1, 12);
      expect(result.values[cIndex]![1]).toBeCloseTo(0.05, 12);
      expect(result.values[cIndex]![2]).toBeCloseTo(0.2, 12);
      expect(result.referenceIndex).toEqual([0, 1]);
      expect(result.testIndex).toEqual([2, 2]);
    });

    it('monthly：原始序列按日历月聚合取期末值', () => {
      const monthly: NumericSeries[] = [
        {
          alias: 'A',
          points: [
            { date: '2024-01-15', value: 10 },
            { date: '2024-01-31', value: 12 },
            { date: '2024-02-01', value: 13 },
            { date: '2024-02-15', value: 14 },
            { date: '2024-03-10', value: 16 },
          ],
        },
      ];
      const result = prepareDataset({
        series: monthly,
        derivedSeries: [],
        periods: {
          referenceStart: '2024-01-01',
          referenceEnd: '2024-02-15',
          testStart: '2024-02-16',
          testEnd: '2024-03-31',
        },
        binning,
        frequency: 'monthly',
      });
      expect(result.dates).toEqual(['2024-01-31', '2024-02-15', '2024-03-10']);
      expect(result.values[0]).toEqual([12, 14, 16]);
      expect(result.referenceIndex).toEqual([0, 1]);
      expect(result.testIndex).toEqual([2, 2]);
    });

    it('daily（显式）与缺省一致：不做重采样', () => {
      const explicit = prepareDataset({ series, derivedSeries: [], periods, binning, frequency: 'daily' });
      const omitted = prepareDataset({ series, derivedSeries: [], periods, binning });
      expect(explicit.dates).toEqual(omitted.dates);
      expect(explicit.values).toEqual(omitted.values);
      expect(explicit.dates).toHaveLength(6);
    });
  });
});
