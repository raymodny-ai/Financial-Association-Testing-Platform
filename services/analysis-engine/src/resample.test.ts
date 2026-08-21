/**
 * S5 · 周频/月频重采样（RED 先行，黄金基准手算对拍）。
 *
 * 行为契约：
 * - 周频：ISO 周分桶（周一为界），桶值取期末（桶内最后一个观测）的值，
 *   日期标签为该桶内最后一个观测的真实日期；
 * - 月频：按日历月（YYYY-MM）分桶，同口径取期末值；
 * - 日频：原样返回（不做变换）；
 * - 输入乱序自动按日期升序整理，空序列抛错。
 *
 * 金融语义：期末收盘价聚合 → 周/月收益率 = 期末价/期末价 − 1（跨期末口径）。
 */
import { describe, expect, it } from 'vitest';
import { resampleToFrequency } from './resample.js';
import type { NumericSeries } from './types.js';

/** 7 个交易日，跨两个 ISO 周：2024-01-01 为周一 */
const series: NumericSeries = {
  alias: 'A',
  points: [
    { date: '2024-01-02', value: 101 },
    { date: '2024-01-01', value: 100 }, // 乱序输入
    { date: '2024-01-03', value: 102 },
    { date: '2024-01-04', value: 103 },
    { date: '2024-01-05', value: 104 },
    { date: '2024-01-08', value: 105 }, // 下周一
    { date: '2024-01-09', value: 106 },
  ],
};

describe('resampleToFrequency · 黄金基准对拍', () => {
  it('weekly：按 ISO 周聚合，取期末值，日期标签为桶内最后观测的真实日期', () => {
    const [resampled] = resampleToFrequency([series], 'weekly');
    expect(resampled!.alias).toBe('A');
    expect(resampled!.points).toEqual([
      { date: '2024-01-05', value: 104 }, // 第一周（01-01~01-05）期末
      { date: '2024-01-09', value: 106 }, // 第二周（01-08~）期末
    ]);
  });

  it('monthly：按日历月聚合，取期末值', () => {
    const monthly: NumericSeries = {
      alias: 'B',
      points: [
        { date: '2024-01-15', value: 10 },
        { date: '2024-01-31', value: 12 },
        { date: '2024-02-01', value: 13 },
        { date: '2024-02-15', value: 14 },
        { date: '2024-03-10', value: 15 },
      ],
    };
    const [resampled] = resampleToFrequency([monthly], 'monthly');
    expect(resampled!.points).toEqual([
      { date: '2024-01-31', value: 12 },
      { date: '2024-02-15', value: 14 },
      { date: '2024-03-10', value: 15 },
    ]);
  });

  it('daily：原样返回（逐点不变）', () => {
    const [resampled] = resampleToFrequency([series], 'daily');
    expect(resampled!.points).toHaveLength(7);
    expect(resampled!.points[0]).toEqual({ date: '2024-01-01', value: 100 });
  });

  it('跨周边界恰好切分（周五与下周一分属不同桶）', () => {
    // 2024-01-05（周五）与 2024-01-08（周一）不得合并为同一周
    const [resampled] = resampleToFrequency([series], 'weekly');
    expect(resampled!.points).toHaveLength(2);
  });

  it('空序列抛错', () => {
    expect(() => resampleToFrequency([{ alias: 'X', points: [] }], 'weekly')).toThrow(/至少 1 个观测/);
  });
});
