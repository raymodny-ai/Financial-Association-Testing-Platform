/**
 * T09 · 多序列日期对齐（RED 先行）。
 * 行为契约：按日期交集对齐、升序输出、乱序输入自动排序、序列内重复日期拒绝。
 */
import { describe, expect, it } from 'vitest';
import { alignSeries } from './align.js';

describe('alignSeries', () => {
  it('按日期交集对齐并保持各序列对应关系', () => {
    const aligned = alignSeries([
      {
        alias: 'A',
        points: [
          { date: '2024-01-02', value: 1 },
          { date: '2024-01-03', value: 2 },
          { date: '2024-01-04', value: 3 },
        ],
      },
      {
        alias: 'B',
        points: [
          { date: '2024-01-03', value: 30 },
          { date: '2024-01-04', value: 40 },
          { date: '2024-01-05', value: 50 },
        ],
      },
    ]);

    expect(aligned.dates).toEqual(['2024-01-03', '2024-01-04']);
    expect(aligned.aliases).toEqual(['A', 'B']);
    expect(aligned.values).toEqual([
      [2, 3],
      [30, 40],
    ]);
  });

  it('乱序输入自动按日期升序', () => {
    const aligned = alignSeries([
      {
        alias: 'A',
        points: [
          { date: '2024-01-04', value: 3 },
          { date: '2024-01-02', value: 1 },
          { date: '2024-01-03', value: 2 },
        ],
      },
    ]);
    expect(aligned.dates).toEqual(['2024-01-02', '2024-01-03', '2024-01-04']);
    expect(aligned.values[0]).toEqual([1, 2, 3]);
  });

  it('序列内重复日期抛错', () => {
    expect(() =>
      alignSeries([
        {
          alias: 'A',
          points: [
            { date: '2024-01-02', value: 1 },
            { date: '2024-01-02', value: 2 },
          ],
        },
      ]),
    ).toThrow(/重复日期/);
  });

  it('交集为空抛错', () => {
    expect(() =>
      alignSeries([
        { alias: 'A', points: [{ date: '2024-01-02', value: 1 }] },
        { alias: 'B', points: [{ date: '2024-02-01', value: 2 }] },
      ]),
    ).toThrow(/无公共日期/);
  });

  it('空序列列表抛错', () => {
    expect(() => alignSeries([])).toThrow(/至少 1 条序列/);
  });
});
