/**
 * HSIC 核独立性检验（H2，PRD 模块 F V1 扩展，ADR 002 接入）。
 *
 * 统计量（Gretton et al. 2005 有偏估计）：HSIC = tr(KHLH)/(n−1)²，
 * K/L 为高斯 RBF 核矩阵，带宽取成对绝对差中位数（median heuristic）；
 * 实现用迹展开式 tr(KL) − 2·1'KL1/n + (1'K1)(1'L1)/n²（与显式 H 矩阵
 * 连乘代数等价，O(n²) 免构造 H）。
 *
 * p 值：播种 mulberry32 置换检验（与互信息同风格，确定性可复现），
 * 置换 y 侧索引复用同一 L 矩阵，p = (≥观测次数+1)/(B+1)。
 *
 * normalizedHsic = HSIC(K,L)/√(HSIC(K,K)·HSIC(L,L)) ∈ (0,1] 作效应量。
 */

export interface HsicTestResult {
  /** 有偏 HSIC 统计量 tr(KHLH)/(n−1)² */
  hsic: number;
  /** 归一化 HSIC（Gretton 2005），(0,1]，1 = 完全依赖 */
  normalizedHsic: number;
  pValue: number;
  permutations: number;
  n: number;
}

interface KernelPack {
  /** n×n 核矩阵（行主序扁平化） */
  matrix: Float64Array;
  /** 核行和 1'K1 的分量（K1） */
  rowSums: Float64Array;
  /** 全元素和 1'K1 */
  total: number;
}

function assertPair(x: readonly number[], y: readonly number[]): void {
  if (x.length !== y.length) {
    throw new RangeError(`两序列须等长（收到 ${x.length} 与 ${y.length}）`);
  }
  if (x.length < 3) {
    throw new RangeError(`HSIC 样本量须 ≥ 3（收到 ${x.length}）`);
  }
}

/** 成对绝对差中位数带宽；零带宽（序列零跨度）拒绝 */
function medianBandwidth(values: readonly number[]): number {
  const n = values.length;
  const diffs: number[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      diffs.push(Math.abs(values[i]! - values[j]!));
    }
  }
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  const sigma =
    diffs.length % 2 === 1 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
  if (!(sigma > 0)) {
    throw new RangeError('序列零跨度（全部相同），高斯核带宽退化，无法估计 HSIC');
  }
  return sigma;
}

/** 高斯 RBF 核矩阵及其行和/全和（扁平化存储） */
function buildKernel(values: readonly number[]): KernelPack {
  const n = values.length;
  const sigma = medianBandwidth(values);
  const scale = 1 / (2 * sigma * sigma);
  const matrix = new Float64Array(n * n);
  const rowSums = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    matrix[i * n + i] = 1;
    rowSums[i]! += 1;
    for (let j = i + 1; j < n; j += 1) {
      const d = values[i]! - values[j]!;
      const k = Math.exp(-d * d * scale);
      matrix[i * n + j] = k;
      matrix[j * n + i] = k;
      rowSums[i]! += k;
      rowSums[j]! += k;
    }
  }
  let total = 0;
  for (let i = 0; i < n; i += 1) total += rowSums[i]!;
  return { matrix, rowSums, total };
}

/** 迹展开式 HSIC：tr(KL) − 2·(K1)'(L1)/n + (1'K1)(1'L1)/n²，再除 (n−1)² */
function hsicFromPacks(k: KernelPack, l: KernelPack, n: number): number {
  let traceKL = 0;
  let k1l1 = 0;
  for (let i = 0; i < n; i += 1) {
    const li = l.matrix.subarray(i * n, (i + 1) * n);
    const kRow = k.matrix.subarray(i * n, (i + 1) * n);
    traceKL += kRow[i]! * li[i]!;
    // 仅 i≠j 项；i=j 项即对角，单独算避免重复（下面循环从 i+1 起对称累加）
    for (let j = i + 1; j < n; j += 1) {
      traceKL += 2 * kRow[j]! * li[j]!;
    }
    k1l1 += k.rowSums[i]! * l.rowSums[i]!;
  }
  const raw = traceKL - (2 * k1l1) / n + (k.total * l.total) / (n * n);
  return raw / (n - 1) ** 2;
}

/** HSIC 统计量（公开接口，黄金基准对拍入口） */
export function hsicStatistic(x: readonly number[], y: readonly number[]): number {
  assertPair(x, y);
  const n = x.length;
  return hsicFromPacks(buildKernel(x), buildKernel(y), n);
}

/** 播种 mulberry32 PRNG（与互信息置换检验同实现，确定性） */
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

/** 置换 y 侧索引后的 HSIC（复用同一 L 矩阵，免重建核） */
function hsicPermuted(k: KernelPack, l: KernelPack, perm: readonly number[], n: number): number {
  let traceKL = 0;
  let k1l1 = 0;
  for (let i = 0; i < n; i += 1) {
    const pi = perm[i]!;
    const li = l.matrix.subarray(pi * n, (pi + 1) * n);
    const kRow = k.matrix.subarray(i * n, (i + 1) * n);
    for (let j = 0; j < n; j += 1) {
      traceKL += kRow[j]! * li[perm[j]!]!;
    }
    k1l1 += k.rowSums[i]! * l.rowSums[pi]!;
  }
  const raw = traceKL - (2 * k1l1) / n + (k.total * l.total) / (n * n);
  return raw / (n - 1) ** 2;
}

/** HSIC 独立性检验：观测统计量 + 归一化效应量 + 播种置换 p 值 */
export function hsicTest(
  x: readonly number[],
  y: readonly number[],
  options: { permutations: number; seed: number },
): HsicTestResult {
  assertPair(x, y);
  if (!Number.isInteger(options.permutations) || options.permutations < 1) {
    throw new RangeError(`置换次数须为正整数（收到 ${options.permutations}）`);
  }

  const n = x.length;
  const kPack = buildKernel(x);
  const lPack = buildKernel(y);
  const observed = hsicFromPacks(kPack, lPack, n);
  const normalizedHsic =
    observed / Math.sqrt(hsicFromPacks(kPack, kPack, n) * hsicFromPacks(lPack, lPack, n));

  const rng = mulberry32(options.seed);
  const perm = Array.from({ length: n }, (_, i) => i);
  let countAtLeastObserved = 0;
  for (let b = 0; b < options.permutations; b += 1) {
    // Fisher-Yates 洗牌（置换 y 侧索引，K 不变）
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [perm[i], perm[j]] = [perm[j]!, perm[i]!];
    }
    if (hsicPermuted(kPack, lPack, perm, n) >= observed) countAtLeastObserved += 1;
  }

  return {
    hsic: observed,
    normalizedHsic,
    pValue: (countAtLeastObserved + 1) / (options.permutations + 1),
    permutations: options.permutations,
    n,
  };
}
