/**
 * T10 · 卡方分布生存函数（RED 先行）。
 * 定案：jstat 仅承担分布函数（ADR 001）。本测试用偶数自由度闭式解
 * sf(x; 2k) = exp(-x/2)·Σ_{j=0}^{k-1}(x/2)^j/j!（解析精确）校验 jstat 包装，
 * 容差 1e-9 达标后方可作为后续检验 p 值的计算通道。
 */
import { describe, expect, it } from 'vitest';
import { chi2sf } from './chi2.js';

/** 偶数自由度闭式生存函数（解析精确，作为本地真值） */
function closedFormSf(x: number, dfEven: number): number {
  const half = x / 2;
  let sum = 0;
  let term = 1;
  for (let j = 0; j < dfEven / 2; j += 1) {
    sum += term;
    term *= half / (j + 1);
  }
  return Math.exp(-half) * sum;
}

describe('chi2sf · 卡方分布生存函数（对拍偶数 df 闭式解，容差 1e-9）', () => {
  const cases: Array<[number, number]> = [
    [1.5, 2],
    [1.89, 2],
    [9.4877, 2],
    [2.2, 2],
    [2.75, 4],
    [9.4877, 4],
    [15.0, 6],
    [0.5, 8],
  ];

  for (const [x, df] of cases) {
    it(`sf(${x}, df=${df}) 与闭式解一致`, () => {
      expect(chi2sf(x, df)).toBeCloseTo(closedFormSf(x, df), 9);
    });
  }

  it('x=0 时生存函数为 1', () => {
    expect(chi2sf(0, 2)).toBeCloseTo(1, 9);
  });

  it('非法入参（df 非正整数 / x 为负）抛错', () => {
    expect(() => chi2sf(1, 0)).toThrow(/自由度/);
    expect(() => chi2sf(-0.1, 2)).toThrow(/统计量/);
  });
});
