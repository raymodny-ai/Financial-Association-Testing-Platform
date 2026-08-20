/**
 * 互信息估计 + 置换检验（T11，PRD 模块 F）。
 *
 * 连续变量先经等频分箱离散化（分位数阈值，value ≤ 阈值归下箱，
 * 与 binning 模块同语义），再按定义式计算 MI（自然对数）：
 * MI = Σ p(x,y)·ln(p(x,y) / (p(x)p(y)))，零计数格跳过。
 *
 * 置换检验：固定 x 的分箱，置换 y 后复用 y 的分位数分箱
 * （分位数对置换不变，阈值口径一致），p = (≥观测次数+1)/(B+1)，
 * 加一平滑保证 p 永不为零。PRNG 为播种 mulberry32，同种子可复现。
 */
import { assignBins, quantileLinear, type FittedBinning } from './binning.js';

export interface PermutationMiResult {
  miNats: number;
  pValue: number;
  permutations: number;
}

/** 定义式互信息（自然对数）：输入计数列联表（≥2×2） */
export function mutualInformationFromCounts(table: readonly (readonly number[])[]): number {
  const rows = table.length;
  const cols = rows > 0 ? table[0]!.length : 0;
  if (rows < 2 || cols < 2) {
    throw new RangeError(`列联表须至少 2 行 2 列（收到 ${rows}×${cols}）`);
  }
  for (const row of table) {
    if (row.length !== cols) {
      throw new RangeError('列联表须为矩形（各行列数不一致）');
    }
    for (const value of row) {
      if (value < 0 || !Number.isInteger(value)) {
        throw new RangeError(`列联表频数须为非负整数（收到 ${value}）`);
      }
    }
  }

  const total = table.flat().reduce((a, b) => a + b, 0);
  const rowSums = table.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums = Array.from({ length: cols }, (_, j) =>
    table.reduce((acc, row) => acc + row[j]!, 0),
  );

  let mi = 0;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const observed = table[i]![j]!;
      if (observed === 0) continue;
      const pxy = observed / total;
      mi += pxy * Math.log(pxy / ((rowSums[i]! / total) * (colSums[j]! / total)));
    }
  }
  return mi;
}

/** 等频分箱拟合（分位数阈值）；零跨度序列拒绝 */
function fitEqualFrequencyBins(values: readonly number[], bins: number): FittedBinning {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted[0] === sorted[sorted.length - 1]) {
    throw new RangeError('序列零跨度（全部相同），无法离散化估计互信息');
  }
  const thresholds: number[] = [];
  for (let k = 1; k < bins; k += 1) {
    thresholds.push(quantileLinear(sorted, k / bins));
  }
  return { thresholds, labels: Array.from({ length: bins }, (_, i) => `bin_${i + 1}`) };
}

function assertPairInput(x: readonly number[], y: readonly number[], bins: number): void {
  if (x.length !== y.length) {
    throw new RangeError(`两序列须等长（收到 ${x.length} 与 ${y.length}）`);
  }
  if (x.length < 2) {
    throw new RangeError(`互信息估计样本量须 ≥ 2（收到 ${x.length}）`);
  }
  if (!Number.isInteger(bins) || bins < 2) {
    throw new RangeError(`分箱箱数须为 ≥ 2 的整数（收到 ${bins}）`);
  }
}

/** 等频分箱后按定义式估计互信息（nats） */
export function estimateMutualInformation(
  x: readonly number[],
  y: readonly number[],
  options: { bins: number },
): number {
  assertPairInput(x, y, options.bins);
  const binsX = assignBins(x, fitEqualFrequencyBins(x, options.bins));
  const binsY = assignBins(y, fitEqualFrequencyBins(y, options.bins));
  return mutualInformationFromCounts(jointCounts(binsX, binsY, options.bins));
}

function jointCounts(
  binsX: readonly number[],
  binsY: readonly number[],
  bins: number,
): number[][] {
  const table = Array.from({ length: bins }, () => new Array<number>(bins).fill(0));
  for (let i = 0; i < binsX.length; i += 1) {
    table[binsX[i]!]![binsY[i]!]! += 1;
  }
  return table;
}

/** 播种 mulberry32 PRNG（确定性置换检验） */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 置换检验：置换 y 重估 MI，p = (≥观测次数+1)/(B+1) */
export function permutationMiTest(
  x: readonly number[],
  y: readonly number[],
  options: { bins: number; permutations: number; seed: number },
): PermutationMiResult {
  assertPairInput(x, y, options.bins);
  if (!Number.isInteger(options.permutations) || options.permutations < 1) {
    throw new RangeError(`置换次数须为正整数（收到 ${options.permutations}）`);
  }

  const fittedX = fitEqualFrequencyBins(x, options.bins);
  const fittedY = fitEqualFrequencyBins(y, options.bins);
  const binsX = assignBins(x, fittedX);
  const binsY = assignBins(y, fittedY);
  const observed = mutualInformationFromCounts(jointCounts(binsX, binsY, options.bins));

  const rng = mulberry32(options.seed);
  const shuffled = [...binsY];
  let countAtLeastObserved = 0;
  for (let b = 0; b < options.permutations; b += 1) {
    // Fisher-Yates 洗牌（置换 y 的箱标签，分位数阈值对置换不变）
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const permuted = mutualInformationFromCounts(jointCounts(binsX, shuffled, options.bins));
    if (permuted >= observed) countAtLeastObserved += 1;
  }

  return {
    miNats: observed,
    pValue: (countAtLeastObserved + 1) / (options.permutations + 1),
    permutations: options.permutations,
  };
}
