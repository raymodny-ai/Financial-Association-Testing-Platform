/**
 * T09 · 分箱离散化（RED 先行，统计代码严格 TDD）。
 * 黄金基准对拍：tests/fixtures/stat-reference.json（numpy 线性分位数，容差 1e-9）。
 * 语义：阈值在参考期拟合，检验期复用（fit / assign 分离）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assignBins, fitBinning, quantileLinear } from './binning.js';

interface ReferenceFixture {
  meta: { tolerance: number };
  quantile_linear: Array<{ name: string; data: number[]; q: number[]; expected: number[] }>;
  tertile_bins: { data: number[]; bins: number; thresholds: number[]; assignments: number[] };
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../tests/fixtures/stat-reference.json', import.meta.url)),
    'utf-8',
  ),
) as ReferenceFixture;

describe('quantileLinear · 黄金基准对拍（numpy linear，容差 1e-9）', () => {
  for (const entry of fixture.quantile_linear) {
    it(entry.name, () => {
      const actual = entry.q.map((q) => quantileLinear(entry.data, q));
      actual.forEach((value, i) => {
        expect(Math.abs(value - entry.expected[i]!)).toBeLessThan(fixture.meta.tolerance);
      });
    });
  }
});

describe('fitBinning', () => {
  it('quantile 三分箱阈值对拍黄金基准', () => {
    const ref = fixture.tertile_bins;
    const fitted = fitBinning(ref.data, { method: 'quantile', bins: ref.bins });
    expect(fitted.thresholds).toHaveLength(ref.thresholds.length);
    fitted.thresholds.forEach((t, i) => {
      expect(Math.abs(t - ref.thresholds[i]!)).toBeLessThan(fixture.meta.tolerance);
    });
    expect(fitted.labels).toEqual(['bin_1', 'bin_2', 'bin_3']);
  });

  it('equal_width 等宽分箱：参考期 min~max 均分', () => {
    const fitted = fitBinning([10, 20, 30, 40], { method: 'equal_width', bins: 3 });
    // 宽度 = (40-10)/3 = 10，阈值 20 与 30
    expect(fitted.thresholds).toEqual([20, 30]);
  });

  it('自定义 labels 与桶数一致时生效', () => {
    const fitted = fitBinning([1, 2, 3, 4, 5, 6], {
      method: 'quantile',
      bins: 2,
      labels: ['低', '高'],
    });
    expect(fitted.labels).toEqual(['低', '高']);
  });

  it('labels 数量与桶数不一致抛错', () => {
    expect(() =>
      fitBinning([1, 2, 3, 4], { method: 'quantile', bins: 2, labels: ['仅一个'] }),
    ).toThrow(/标签数量/);
  });

  it('参考期观测数少于桶数抛错', () => {
    expect(() => fitBinning([1, 2], { method: 'quantile', bins: 3 })).toThrow(/观测值不足/);
  });

  it('所有观测值相同（零跨度）抛错', () => {
    expect(() => fitBinning([5, 5, 5], { method: 'quantile', bins: 3 })).toThrow(/零跨度/);
  });
});

describe('fitBinning · fixed_threshold 用户阈值直用（S2，缺口 N7 转正）', () => {
  it('用户阈值原样采用，不从参考期拟合', () => {
    const fitted = fitBinning([1, 2, 3, 4, 5, 6, 7, 8, 9], {
      method: 'fixed_threshold',
      bins: 3,
      thresholds: [-1, 0.5],
    });
    expect(fitted.thresholds).toEqual([-1, 0.5]);
    expect(fitted.labels).toEqual(['bin_1', 'bin_2', 'bin_3']);
  });

  it('阈值个数与桶数不一致（须 bins-1 个）抛错', () => {
    expect(() =>
      fitBinning([1, 2, 3, 4], { method: 'fixed_threshold', bins: 3, thresholds: [1] }),
    ).toThrow(/阈值个数/);
  });

  it('阈值非严格递增抛错', () => {
    expect(() =>
      fitBinning([1, 2, 3, 4], { method: 'fixed_threshold', bins: 3, thresholds: [2, 1] }),
    ).toThrow(/严格递增/);
  });

  it('参考期零跨度仍拒绝（离散化无意义）', () => {
    expect(() =>
      fitBinning([5, 5, 5], { method: 'fixed_threshold', bins: 2, thresholds: [5] }),
    ).toThrow(/零跨度/);
  });
});

describe('fitBinning · stddev 标准差分箱（S2）', () => {
  it('均值 ± σ/2 对称阈值（bins=3，样本标准差 ddof=1）', () => {
    // [1..5]：mean=3，σ=√(10/4)=√2.5；阈值 = 3 ± 0.5σ ≈ [1.7420, 4.2580]
    const fitted = fitBinning([1, 2, 3, 4, 5], { method: 'stddev', bins: 3 });
    expect(fitted.thresholds).toHaveLength(2);
    const sd = Math.sqrt(2.5);
    expect(Math.abs(fitted.thresholds[0]! - (3 - 0.5 * sd))).toBeLessThan(1e-9);
    expect(Math.abs(fitted.thresholds[1]! - (3 + 0.5 * sd))).toBeLessThan(1e-9);
  });

  it('bins=2 阈值即均值', () => {
    const fitted = fitBinning([1, 2, 3, 4], { method: 'stddev', bins: 2 });
    expect(fitted.thresholds).toEqual([2.5]);
  });

  it('bins=4 以均值为中心 ±σ 对称（偶数桶阈值含均值）', () => {
    // [2,4,6,8,10,12]：mean=7，样本方差=70/5=14（ddof=1）；阈值 7−σ, 7, 7+σ
    const fitted = fitBinning([2, 4, 6, 8, 10, 12], { method: 'stddev', bins: 4 });
    const sd = Math.sqrt(14);
    expect(fitted.thresholds).toHaveLength(3);
    [7 - sd, 7, 7 + sd].forEach((expected, i) => {
      expect(Math.abs(fitted.thresholds[i]! - expected)).toBeLessThan(1e-9);
    });
  });

  it('观测不足两个无法估计标准差抛错', () => {
    expect(() => fitBinning([3], { method: 'stddev', bins: 2 })).toThrow(/观测值不足/);
  });
});

describe('assignBins · 检验期复用参考期阈值', () => {
  it('对拍黄金基准 assignments（value<=阈值归入下箱）', () => {
    const ref = fixture.tertile_bins;
    const fitted = fitBinning(ref.data, { method: 'quantile', bins: ref.bins });
    expect(assignBins(ref.data, fitted)).toEqual(ref.assignments);
  });

  it('检验期越界值归入首/末箱（阈值不外推）', () => {
    const fitted = fitBinning([1, 2, 3, 4, 5, 6, 7, 8, 9], { method: 'quantile', bins: 3 });
    expect(assignBins([-100, 100], fitted)).toEqual([0, 2]);
  });
});
