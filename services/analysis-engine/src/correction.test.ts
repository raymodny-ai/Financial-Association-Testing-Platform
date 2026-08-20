/**
 * T12 · 多重检验校正（RED 先行）。
 * 黄金基准对拍：tests/fixtures/stat-reference.json multiple_correction 节
 * （statsmodels multipletests 语义，容差 1e-9）。
 * PRD 模块 I：bonferroni / bh（FDR）/ by；'none' 原样保留。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adjustPValues } from './correction.js';

interface CorrectionFixture {
  p_values: number[];
  bonferroni: number[];
  bh: number[];
  by: number[];
  permuted: { perm: number[]; p_values: number[]; bh: number[] };
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../tests/fixtures/stat-reference.json', import.meta.url)),
    'utf-8',
  ),
) as { multiple_correction: CorrectionFixture };

const fx = fixture.multiple_correction;

const expectClose = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    expect(Math.abs(actual[i]! - e)).toBeLessThan(1e-9);
  });
};

describe('adjustPValues · 黄金基准对拍（容差 1e-9）', () => {
  it('bonferroni = min(p·m, 1)', () => {
    expectClose(adjustPValues(fx.p_values, 'bonferroni'), fx.bonferroni);
  });

  it('bh（Benjamini-Hochberg FDR，step-up 累积最小）', () => {
    expectClose(adjustPValues(fx.p_values, 'bh'), fx.bh);
  });

  it('by（Benjamini-Yekutieli，乘调和数 c(m)）', () => {
    expectClose(adjustPValues(fx.p_values, 'by'), fx.by);
  });

  it('none 原样保留（副本，不与入参同一引用）', () => {
    const out = adjustPValues(fx.p_values, 'none');
    expect(out).toEqual(fx.p_values);
    expect(out).not.toBe(fx.p_values);
  });

  it('乱序输入按值校正：置换用例与升序用例按原值对应一致', () => {
    expectClose(adjustPValues(fx.permuted.p_values, 'bh'), fx.permuted.bh);
  });
});

describe('adjustPValues · 性质与接缝校验', () => {
  it('校正后 p 值不小于原始值且 ≤ 1（各方法）', () => {
    for (const method of ['bonferroni', 'bh', 'by'] as const) {
      const out = adjustPValues(fx.p_values, method);
      fx.p_values.forEach((p, i) => {
        expect(out[i]!).toBeGreaterThanOrEqual(p - 1e-12);
        expect(out[i]!).toBeLessThanOrEqual(1);
      });
    }
  });

  it('单调性：原始 p 更小则校正后不更大（bh）', () => {
    const out = adjustPValues(fx.permuted.p_values, 'bh');
    for (let i = 0; i < fx.permuted.p_values.length; i += 1) {
      for (let j = i + 1; j < fx.permuted.p_values.length; j += 1) {
        if (fx.permuted.p_values[i]! < fx.permuted.p_values[j]!) {
          expect(out[i]!).toBeLessThanOrEqual(out[j]! + 1e-12);
        }
      }
    }
  });

  it('单检验：bonferroni/bh/by 均等于原值', () => {
    for (const method of ['bonferroni', 'bh', 'by'] as const) {
      expect(adjustPValues([0.03], method)).toEqual([0.03]);
    }
  });

  it('空数组返回空数组', () => {
    expect(adjustPValues([], 'bh')).toEqual([]);
  });

  it('拒绝越界或非法 p 值', () => {
    expect(() => adjustPValues([0.5, -0.1], 'bh')).toThrow(/p 值/);
    expect(() => adjustPValues([0.5, 1.2], 'bh')).toThrow(/p 值/);
    expect(() => adjustPValues([Number.NaN], 'bh')).toThrow(/p 值/);
  });

  it('拒绝未知校正方法', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => adjustPValues([0.5], 'holm' as any)).toThrow(/校正方法/);
  });
});
