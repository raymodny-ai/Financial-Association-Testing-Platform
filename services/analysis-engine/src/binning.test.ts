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
