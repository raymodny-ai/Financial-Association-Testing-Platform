/**
 * 卡方族检验（T10，PRD 模块 E）。
 *
 * 语义对齐 scipy.stats.chi2_contingency(correction=False)：Pearson 卡方，
 * 不做 Yates 连续性校正；期望频数 = 行合计×列合计/n。
 * p 值通道为 chi2sf（jstat 分布函数，已对闭式解验证达 1e-9）。
 *
 * 三检验：
 * - chiSquareIndependence：两分类变量独立性（r×c 列联表）
 * - chiSquareGoodnessOfFit：检验期状态分布 vs 参考期期望概率
 * - chiSquareHomogeneity：双数据源状态分布一致性（2×k 列联表）
 *
 * 期望频数适用性（PRD）：输出最小期望频数、低于 5 的单元格占比，
 * adequate = minExpected ≥ 5（经典近似条件）。
 */
import { chi2sf } from './chi2.js';

/** 期望频数适用性报告（PRD 模块 E） */
export interface ChiSquareApplicability {
  minExpected: number;
  fractionExpectedBelow5: number;
  /** 是否满足卡方近似条件（全部期望频数 ≥ 5） */
  adequate: boolean;
}

export interface ChiSquareResult {
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
  /** Cramer's V；一维拟合优度无定义，为 null */
  cramersV: number | null;
  /** 期望频数矩阵（一维拟合优度为按状态展开的行向量） */
  expectedFrequencies: number[][];
  applicability: ChiSquareApplicability;
}

function assertCounts(values: readonly number[], subject: string): void {
  for (const value of values) {
    if (value < 0) {
      throw new RangeError(`${subject}频数不可为负（收到 ${value}）`);
    }
    if (!Number.isInteger(value)) {
      throw new RangeError(`${subject}频数须为整数（收到 ${value}）`);
    }
  }
}

function applicabilityOf(expected: readonly number[]): ChiSquareApplicability {
  const minExpected = Math.min(...expected);
  const belowCount = expected.filter((e) => e < 5).length;
  return {
    minExpected,
    fractionExpectedBelow5: belowCount / expected.length,
    adequate: minExpected >= 5,
  };
}

/** Pearson 卡方核心：观测 vs 期望，逐格 (o-e)²/e */
function pearsonChiSquare(observedFlat: readonly number[], expectedFlat: readonly number[]): number {
  let statistic = 0;
  for (let i = 0; i < observedFlat.length; i += 1) {
    const expected = expectedFlat[i]!;
    statistic += (observedFlat[i]! - expected) ** 2 / expected;
  }
  return statistic;
}

/** 卡方独立性检验（r×c 列联表，r,c ≥ 2） */
export function chiSquareIndependence(observed: readonly (readonly number[])[]): ChiSquareResult {
  const rows = observed.length;
  const cols = rows > 0 ? observed[0]!.length : 0;
  if (rows < 2 || cols < 2) {
    throw new RangeError(`列联表须至少 2 行 2 列（收到 ${rows}×${cols}）`);
  }
  for (const row of observed) {
    if (row.length !== cols) {
      throw new RangeError('列联表须为矩形（各行列数不一致）');
    }
    assertCounts(row, '列联表');
  }

  const total = observed.flat().reduce((a, b) => a + b, 0);
  const rowSums = observed.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums = Array.from({ length: cols }, (_, j) =>
    observed.reduce((acc, row) => acc + row[j]!, 0),
  );
  if (rowSums.some((s) => s === 0) || colSums.some((s) => s === 0)) {
    throw new RangeError('列联表存在全零行或全零列（边缘合计为零，检验退化）');
  }

  const expected = rowSums.map((rs) => colSums.map((cs) => (rs * cs) / total));
  const expectedFlat = expected.flat();
  const statistic = pearsonChiSquare(observed.flat(), expectedFlat);
  const degreesOfFreedom = (rows - 1) * (cols - 1);

  return {
    statistic,
    degreesOfFreedom,
    pValue: chi2sf(statistic, degreesOfFreedom),
    cramersV: Math.sqrt(statistic / (total * (Math.min(rows, cols) - 1))),
    expectedFrequencies: expected,
    applicability: applicabilityOf(expectedFlat),
  };
}

/** 卡方拟合优度检验：检验期状态频数 vs 参考期期望概率 */
export function chiSquareGoodnessOfFit(
  observed: readonly number[],
  probabilities: readonly number[],
): ChiSquareResult {
  if (observed.length < 2 || observed.length !== probabilities.length) {
    throw new RangeError('拟合优度须至少 2 个状态且观测与概率等长');
  }
  assertCounts(observed, '观测');
  for (const p of probabilities) {
    if (!(p > 0)) {
      throw new RangeError(`期望概率须为正数（收到 ${p}）`);
    }
  }
  const probSum = probabilities.reduce((a, b) => a + b, 0);
  if (Math.abs(probSum - 1) > 1e-9) {
    throw new RangeError(`期望概率之和须为 1（收到 ${probSum}）`);
  }

  const total = observed.reduce((a, b) => a + b, 0);
  const expected = probabilities.map((p) => p * total);
  const statistic = pearsonChiSquare(observed, expected);
  const degreesOfFreedom = observed.length - 1;

  return {
    statistic,
    degreesOfFreedom,
    pValue: chi2sf(statistic, degreesOfFreedom),
    cramersV: null,
    expectedFrequencies: [expected],
    applicability: applicabilityOf(expected),
  };
}

/** 双数据源同质性检验：两组同状态空间的频数计数（2×k 列联表） */
export function chiSquareHomogeneity(
  countsA: readonly number[],
  countsB: readonly number[],
): ChiSquareResult {
  if (countsA.length !== countsB.length) {
    throw new RangeError(
      `两组状态数须一致（收到 ${countsA.length} 与 ${countsB.length}）`,
    );
  }
  return chiSquareIndependence([countsA, countsB]);
}
