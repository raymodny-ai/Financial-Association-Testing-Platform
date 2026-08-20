/**
 * Pearson / Spearman 相关检验（T11，PRD 模块 F）。
 *
 * p 值同 scipy.stats.pearsonr/spearmanr 的 t 近似：
 * t = r·√((n−2)/(1−r²))，双侧 p = 2·sf(|t|, n−2)（studentTSf）。
 * Spearman = 平均秩变换（并列值取平均秩）后的 Pearson。
 */
import { studentTSf } from './student-t.js';

export interface CorrelationTestResult {
  r: number;
  /** t 统计量 */
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
  n: number;
}

/** 平均秩（1 起），并列值取秩均值 */
export function ranksWithTies(values: readonly number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let start = 0;
  while (start < indexed.length) {
    let end = start;
    while (end + 1 < indexed.length && indexed[end + 1]!.v === indexed[start]!.v) end += 1;
    const average = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) ranks[indexed[k]!.i] = average;
    start = end + 1;
  }
  return ranks;
}

function assertPair(x: readonly number[], y: readonly number[]): void {
  if (x.length !== y.length) {
    throw new RangeError(`两序列须等长（收到 ${x.length} 与 ${y.length}）`);
  }
  if (x.length < 3) {
    throw new RangeError(`相关检验样本量须 ≥ 3（收到 ${x.length}）`);
  }
}

/** Pearson 积矩相关 + t 近似双侧 p 值 */
export function pearsonTest(x: readonly number[], y: readonly number[]): CorrelationTestResult {
  assertPair(x, y);
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i]! - meanX;
    const dy = y[i]! - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) {
    throw new RangeError('序列零方差，相关系数无定义');
  }

  const r = sxy / Math.sqrt(sxx * syy);
  const degreesOfFreedom = n - 2;
  // |r|=1 时 t 发散，p 视为 0（完全线性关系）
  const statistic = Math.abs(r) >= 1 ? Infinity : r * Math.sqrt(degreesOfFreedom / (1 - r * r));
  const pValue = Number.isFinite(statistic) ? 2 * studentTSf(Math.abs(statistic), degreesOfFreedom) : 0;

  return { r, statistic, degreesOfFreedom, pValue, n };
}

/** Spearman 秩相关（并列值平均秩）+ t 近似双侧 p 值 */
export function spearmanTest(x: readonly number[], y: readonly number[]): CorrelationTestResult {
  assertPair(x, y);
  return pearsonTest(ranksWithTies(x), ranksWithTies(y));
}
