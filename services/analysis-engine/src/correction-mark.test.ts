/**
 * T12 · 校正 + 显著性标记编排（RED 先行）。
 * 结果长表契约（result.ts）：p_value_adjusted 与 significant
 * （以校正后 p 值与 alpha 比较）成对产出，correctAndMark 一次返回。
 */
import { describe, expect, it } from 'vitest';
import { correctAndMark } from './correction.js';

describe('correctAndMark · 校正与显著性成对产出', () => {
  it('bh 校正后与 alpha 比较标记显著', () => {
    // m=3 step-up：adj = [min(0.01·3, 0.04·3/2), 0.04·3/2, 0.6·3/3] = [0.03, 0.06, 0.6]
    const out = correctAndMark([0.01, 0.04, 0.6], 'bh', 0.05);
    expect(out.adjusted[0]!).toBeCloseTo(0.03, 9);
    expect(out.adjusted[1]!).toBeCloseTo(0.06, 9);
    expect(out.adjusted[2]!).toBeCloseTo(0.6, 9);
    expect(out.significant).toEqual([true, false, false]);
  });

  it('none 时以原始 p 值比较', () => {
    const out = correctAndMark([0.049, 0.05], 'none', 0.05);
    expect(out.adjusted).toEqual([0.049, 0.05]);
    expect(out.significant).toEqual([true, false]); // p < alpha 才显著
  });

  it('拒绝非法 alpha', () => {
    expect(() => correctAndMark([0.5], 'bh', 0)).toThrow(/alpha/);
    expect(() => correctAndMark([0.5], 'bh', 1)).toThrow(/alpha/);
    expect(() => correctAndMark([0.5], 'bh', Number.NaN)).toThrow(/alpha/);
  });

  it('空输入返回空结果', () => {
    expect(correctAndMark([], 'bonferroni', 0.05)).toEqual({ adjusted: [], significant: [] });
  });
});
