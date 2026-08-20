/**
 * T10 · 卡方族检验（RED 先行，PRD 模块 E）。
 * 黄金基准对拍：tests/fixtures/stat-reference.json chi_square 节（容差 1e-9）。
 * 语义对齐 scipy.stats.chi2_contingency(correction=False)：不做 Yates 连续性校正。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  chiSquareGoodnessOfFit,
  chiSquareHomogeneity,
  chiSquareIndependence,
} from './chi-square.js';

interface ChiSquareFixture {
  independence: {
    observed: number[][];
    expected: number[][];
    statistic: number;
    df: number;
    p_value: number;
    cramers_v: number;
    min_expected: number;
    fraction_expected_below_5: number;
  };
  goodness_of_fit: {
    observed: number[];
    probabilities: number[];
    statistic: number;
    df: number;
    p_value: number;
  };
  homogeneity: {
    observed: number[][];
    statistic: number;
    df: number;
    p_value: number;
    cramers_v: number;
    min_expected: number;
    fraction_expected_below_5: number;
  };
}

const fixture = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../tests/fixtures/stat-reference.json', import.meta.url)),
      'utf-8',
    ),
  ) as { chi_square: ChiSquareFixture }
).chi_square;

describe('chiSquareIndependence · 黄金基准对拍（容差 1e-9）', () => {
  const ref = fixture.independence;

  it('统计量 / 自由度 / p 值 / 期望频数与基准一致', () => {
    const result = chiSquareIndependence(ref.observed);
    expect(result.statistic).toBeCloseTo(ref.statistic, 9);
    expect(result.degreesOfFreedom).toBe(ref.df);
    expect(result.pValue).toBeCloseTo(ref.p_value, 9);
    for (let i = 0; i < ref.expected.length; i += 1) {
      for (let j = 0; j < ref.expected[i]!.length; j += 1) {
        expect(result.expectedFrequencies[i]![j]).toBeCloseTo(ref.expected[i]![j]!, 9);
      }
    }
  });

  it("Cramer's V 与期望频数适用性指标与基准一致", () => {
    const result = chiSquareIndependence(ref.observed);
    expect(result.cramersV).toBeCloseTo(ref.cramers_v, 9);
    expect(result.applicability.minExpected).toBeCloseTo(ref.min_expected, 9);
    expect(result.applicability.fractionExpectedBelow5).toBeCloseTo(
      ref.fraction_expected_below_5,
      9,
    );
    expect(result.applicability.adequate).toBe(true);
  });

  it('非法列联表抛错：非矩阵 / 负频数 / 非整数 / 锯齿行 / 全零列', () => {
    expect(() => chiSquareIndependence([])).toThrow(/列联表/);
    expect(() => chiSquareIndependence([[1]])).toThrow(/列联表/);
    expect(() => chiSquareIndependence([[1, -2], [3, 4]])).toThrow(/频数/);
    expect(() => chiSquareIndependence([[1.5, 2], [3, 4]])).toThrow(/整数/);
    expect(() => chiSquareIndependence([[1, 2, 3], [4, 5]])).toThrow(/矩形/);
    expect(() => chiSquareIndependence([[0, 2], [0, 4]])).toThrow(/边缘合计/);
  });
});

describe('chiSquareGoodnessOfFit · 黄金基准对拍（容差 1e-9）', () => {
  const ref = fixture.goodness_of_fit;

  it('统计量 / 自由度 / p 值与基准一致，效应量为 null', () => {
    const result = chiSquareGoodnessOfFit(ref.observed, ref.probabilities);
    expect(result.statistic).toBeCloseTo(ref.statistic, 9);
    expect(result.degreesOfFreedom).toBe(ref.df);
    expect(result.pValue).toBeCloseTo(ref.p_value, 9);
    expect(result.cramersV).toBeNull();
  });

  it('概率向量须归一且为正，观测须为非负整数', () => {
    expect(() => chiSquareGoodnessOfFit([5, 5], [0.3, 0.3])).toThrow(/概率之和/);
    expect(() => chiSquareGoodnessOfFit([5, 5], [1, 0])).toThrow(/概率/);
    expect(() => chiSquareGoodnessOfFit([-1, 5], [0.5, 0.5])).toThrow(/频数/);
  });
});

describe('chiSquareHomogeneity · 黄金基准对拍（容差 1e-9）', () => {
  const ref = fixture.homogeneity;

  it('双数据源状态计数同质性：统计量 / p 值与基准一致', () => {
    const [countsA, countsB] = ref.observed;
    const result = chiSquareHomogeneity(countsA!, countsB!);
    expect(result.statistic).toBeCloseTo(ref.statistic, 9);
    expect(result.degreesOfFreedom).toBe(ref.df);
    expect(result.pValue).toBeCloseTo(ref.p_value, 9);
    expect(result.cramersV).toBeCloseTo(ref.cramers_v, 9);
  });

  it('低期望频数场景：适用性标记为不满足（minExpected < 5）', () => {
    const [countsA, countsB] = ref.observed;
    const result = chiSquareHomogeneity(countsA!, countsB!);
    expect(result.applicability.minExpected).toBeCloseTo(ref.min_expected, 9);
    expect(result.applicability.fractionExpectedBelow5).toBeCloseTo(
      ref.fraction_expected_below_5,
      9,
    );
    expect(result.applicability.adequate).toBe(false);
  });

  it('两组状态数不一致抛错', () => {
    expect(() => chiSquareHomogeneity([1, 2], [1, 2, 3])).toThrow(/状态数/);
  });
});
