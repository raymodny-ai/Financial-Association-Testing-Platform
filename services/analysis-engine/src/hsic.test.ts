/**
 * HSIC 核独立性检验（H2，PRD 模块 F V1 扩展，RED 先行）。
 *
 * 统计量（Gretton et al. 2005 有偏估计）：
 * HSIC = tr(KHLH)/(n−1)²，K/L 为高斯 RBF 核矩阵（中位数带宽启发式），
 * H = I − 11'/n 中心化矩阵。本地真值用显式构造 H 的朴素实现对拍
 *（实现侧用 O(n²) 迹展开式，二者代数等价但代码路径独立）。
 *
 * p 值：播种 mulberry32 置换检验（与互信息同风格），p = (≥观测次数+1)/(B+1)。
 */
import { describe, expect, it } from 'vitest';
import { hsicStatistic, hsicTest } from './hsic.js';

/** 中位数带宽（成对绝对差的中位数；偶数个取两中值均值） */
function medianBandwidth(values: readonly number[]): number {
  const diffs: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      diffs.push(Math.abs(values[i]! - values[j]!));
    }
  }
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 === 1 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
}

/** 高斯 RBF 核矩阵 */
function rbfKernel(values: readonly number[], sigma: number): number[][] {
  return values.map((vi) =>
    values.map((vj) => Math.exp(-((vi - vj) ** 2) / (2 * sigma * sigma))),
  );
}

/** 中心化矩阵 H = I − 11'/n */
function centeringMatrix(n: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 - 1 / n : -1 / n)),
  );
}

function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const out = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < n; k += 1) {
      const aik = a[i]![k]!;
      if (aik === 0) continue;
      for (let j = 0; j < n; j += 1) out[i]![j]! += aik * b[k]![j]!;
    }
  }
  return out;
}

function trace(m: number[][]): number {
  let sum = 0;
  for (let i = 0; i < m.length; i += 1) sum += m[i]![i]!;
  return sum;
}

/** 朴素 HSIC：显式 H 矩阵连乘（本地真值，与实现的迹展开式代数等价） */
function naiveHsic(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const K = rbfKernel(x, medianBandwidth(x));
  const L = rbfKernel(y, medianBandwidth(y));
  const H = centeringMatrix(n);
  return trace(matMul(matMul(matMul(K, H), L), H)) / (n - 1) ** 2;
}

describe('hsicStatistic · 统计量黄金基准（对拍朴素 H 矩阵实现）', () => {
  const cases: Array<{ x: number[]; y: number[] }> = [
    { x: [1, 2, 3, 4], y: [4, 1, 3, 2] },
    { x: [1, 2, 3, 4, 5, 6], y: [2, 1, 4, 3, 6, 5] },
    { x: [3.1, -2.5, 0, 7.7, 1.2, -4.9, 8.8, 0.5], y: [0.1, 9.9, -3.3, 2.2, 5.5, -1.1, 4.4, 7.7] },
  ];

  for (const { x, y } of cases) {
    it(`n=${x.length} 与朴素实现一致（容差 1e-12）`, () => {
      expect(hsicStatistic(x, y)).toBeCloseTo(naiveHsic(x, y), 12);
    });
  }

  it('对称性：hsic(x,y) === hsic(y,x)', () => {
    const x = [1, 3, 2, 5, 4];
    const y = [5, 4, 3, 2, 1];
    expect(hsicStatistic(x, y)).toBeCloseTo(hsicStatistic(y, x), 14);
  });
});

describe('hsicTest · 播种置换检验', () => {
  const n = 30;
  const strongX = Array.from({ length: n }, (_, i) => i + 1);
  const strongY = strongX.map((v, i) => v + (i % 3) * 0.01);
  const indepY = [
    7, 21, 3, 28, 12, 17, 1, 25, 9, 30, 14, 5, 23, 11, 19, 2, 27, 8, 16, 29, 4, 22, 10, 26,
    13, 6, 18, 24, 15, 20,
  ];

  it('同种子可复现（p 值与统计量逐位一致）', () => {
    const a = hsicTest(strongX, strongY, { permutations: 99, seed: 42 });
    const b = hsicTest(strongX, strongY, { permutations: 99, seed: 42 });
    expect(a.pValue).toBe(b.pValue);
    expect(a.hsic).toBe(b.hsic);
    expect(a.normalizedHsic).toBe(b.normalizedHsic);
  });

  it('强关联 → 小 p；独立排列 → p 显著更大', () => {
    const strong = hsicTest(strongX, strongY, { permutations: 99, seed: 42 });
    const indep = hsicTest(strongX, indepY, { permutations: 99, seed: 42 });
    expect(strong.pValue).toBeLessThanOrEqual(0.05);
    expect(indep.pValue).toBeGreaterThan(strong.pValue);
  });

  it('p 值下界为 1/(B+1)（加一平滑，永不为零）', () => {
    const strong = hsicTest(strongX, strongY, { permutations: 199, seed: 7 });
    expect(strong.pValue).toBeGreaterThanOrEqual(1 / 200);
  });

  it('完全依赖（y=x）归一化 HSIC ≈ 1', () => {
    const result = hsicTest(strongX, [...strongX], { permutations: 19, seed: 0 });
    expect(result.normalizedHsic).toBeCloseTo(1, 9);
  });

  it('归一化 HSIC 落在 (0, 1] 且 n 回传正确', () => {
    const result = hsicTest(strongX, indepY, { permutations: 19, seed: 1 });
    expect(result.normalizedHsic).toBeGreaterThan(0);
    expect(result.normalizedHsic).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.n).toBe(n);
  });
});

describe('hsicTest · 入参校验', () => {
  it('两序列不等长抛错', () => {
    expect(() => hsicTest([1, 2, 3], [1, 2], { permutations: 9, seed: 0 })).toThrow(/等长/);
  });

  it('样本量 < 3 抛错（中位数带宽需 ≥1 对且置换有意义）', () => {
    expect(() => hsicTest([1, 2], [3, 4], { permutations: 9, seed: 0 })).toThrow(/样本量/);
  });

  it('零跨度序列抛错（带宽为零，核退化）', () => {
    expect(() => hsicTest([1, 1, 1, 1], [1, 2, 3, 4], { permutations: 9, seed: 0 })).toThrow(
      /零跨度/,
    );
  });

  it('置换次数须为正整数', () => {
    expect(() => hsicTest([1, 2, 3], [3, 2, 1], { permutations: 0, seed: 0 })).toThrow(/置换次数/);
  });
});
