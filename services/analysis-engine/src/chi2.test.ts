/**
 * T10 · 卡方分布生存函数（RED 先行）。
 * 定案：jstat 仅承担分布函数（ADR 001）。本测试用偶数自由度闭式解
 * sf(x; 2k) = exp(-x/2)·Σ_{j=0}^{k-1}(x/2)^j/j!（解析精确）校验 jstat 包装，
 * 容差 1e-9 达标后方可作为后续检验 p 值的计算通道。
 * G16（关 N8）：奇数自由度补黄金基准——用下正则不完全伽马函数 P(a,x)
 * 级数展开（Lanczos lnGamma，精度 ~1e-12，独立于 jstat）作本地真值，
 * sf(x, df) = 1 - P(df/2, x/2)，覆盖奇偶两类自由度。
 */
import { describe, expect, it } from 'vitest';
import { chi2sf } from './chi2.js';

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** lnΓ（Lanczos 近似，精度 ~1e-12） */
function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const zm = z - 1;
  let x = LANCZOS[0]!;
  for (let i = 1; i < LANCZOS.length; i += 1) x += LANCZOS[i]! / (zm + i);
  const t = zm + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm + 0.5) * Math.log(t) - t + Math.log(x);
}

/** 下正则不完全伽马函数 P(a,x) 级数展开（x 中小尺度收敛快，作本地真值） */
function gammaP(a: number, x: number): number {
  if (x === 0) return 0;
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n < 2000; n += 1) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * sum;
}

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

describe('chi2sf · 奇数自由度黄金基准（不完全伽马真值，容差 1e-9，G16 关 N8）', () => {
  const cases: Array<[number, number]> = [
    [0.5, 1],
    [1.5, 1],
    [3.8415, 1],
    [2.2, 3],
    [7.8147, 3],
    [9.5, 5],
    [15.0, 7],
    [0.25, 9],
  ];

  for (const [x, df] of cases) {
    it(`sf(${x}, df=${df}) 与不完全伽马真值一致`, () => {
      expect(chi2sf(x, df)).toBeCloseTo(1 - gammaP(df / 2, x / 2), 9);
    });
  }

  it('真值自检：不完全伽马与偶数 df 闭式解互证（容差 1e-11）', () => {
    for (const [x, df] of [
      [2.75, 4],
      [9.4877, 4],
      [15.0, 6],
    ] as Array<[number, number]>) {
      expect(1 - gammaP(df / 2, x / 2)).toBeCloseTo(closedFormSf(x, df), 11);
    }
  });
});
