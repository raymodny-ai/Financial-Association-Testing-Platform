/**
 * T11 · Pearson / Spearman 相关检验（RED 先行）。
 * 黄金基准对拍：tests/fixtures/stat-reference.json continuous 节
 * （n=4 → df=2，p 值为 t 分布闭式解，容差 1e-9）。
 * Spearman = 平均秩变换后的 Pearson；p 值走 t 近似（同 scipy）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pearsonTest, ranksWithTies, spearmanTest } from './correlation.js';

interface CorrelationFixture {
  pearson: { x: number[]; y: number[]; r: number; t: number; df: number; p_value: number };
  spearman: {
    x: number[];
    y: number[];
    ranks_y: number[];
    r: number;
    t: number;
    df: number;
    p_value: number;
  };
}

const fixture = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../tests/fixtures/stat-reference.json', import.meta.url)),
      'utf-8',
    ),
  ) as { continuous: CorrelationFixture }
).continuous;

describe('pearsonTest · 黄金基准对拍（容差 1e-9）', () => {
  const ref = fixture.pearson;

  it('r / t / df / 双侧 p 与基准一致', () => {
    const result = pearsonTest(ref.x, ref.y);
    expect(result.r).toBeCloseTo(ref.r, 9);
    expect(result.statistic).toBeCloseTo(ref.t, 9);
    expect(result.degreesOfFreedom).toBe(ref.df);
    expect(result.pValue).toBeCloseTo(ref.p_value, 9);
  });

  it('入参校验：等长、n≥3、零方差拒绝', () => {
    expect(() => pearsonTest([1, 2, 3], [1, 2])).toThrow(/等长/);
    expect(() => pearsonTest([1, 2], [1, 2])).toThrow(/样本量/);
    expect(() => pearsonTest([1, 1, 1, 1], [1, 2, 3, 4])).toThrow(/方差/);
  });
});

describe('spearmanTest · 黄金基准对拍（容差 1e-9）', () => {
  const ref = fixture.spearman;

  it('并列值取平均秩', () => {
    expect(ranksWithTies(ref.y)).toEqual(ref.ranks_y);
  });

  it('秩相关 r / t / p 与基准一致', () => {
    const result = spearmanTest(ref.x, ref.y);
    expect(result.r).toBeCloseTo(ref.r, 9);
    expect(result.statistic).toBeCloseTo(ref.t, 9);
    expect(result.degreesOfFreedom).toBe(ref.df);
    expect(result.pValue).toBeCloseTo(ref.p_value, 9);
  });
});
