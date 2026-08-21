/**
 * 滚动窗口分析（T13，PRD 模块 G）。
 *
 * 检验期内滑动窗口重算四类检验：χ²独立性（固定箱空间 + 零边际剪枝）、
 * Pearson、Spearman、互信息置换检验。窗口长度/步长以对齐日期轴上的
 * 观测数计量（日频即交易日数）；起点按步长推进，末端窗口钳制到检验期尾，
 * 长度 ≥ minSamples 才保留（minSamples 默认 = windowSize，即仅完整窗口）。
 *
 * 退化窗口（零方差 / 剪枝后不足 2×2 / 零跨度）不产出结果行，
 * 原因记入 skipped（PRD：不满足前提必须明确警告而非静默执行）。
 * 行形态与结果长表对齐（window_end / stat / p / effect_size / notes），
 * p_value_adjusted 与 significant 由执行器经 correctAndMark 批量回填（T12 接缝）。
 */
import { chiSquareIndependence } from './chi-square.js';
import { countContingency, pruneZeroMargins } from './chi-square-dataset.js';
import { pearsonTest, spearmanTest } from './correlation.js';
import { hsicTest } from './hsic.js';
import { permutationMiTest } from './mutual-information.js';
import type { PreparedDataset } from './pipeline.js';

export const ROLLING_METHODS = [
  'chi_square_independence',
  'pearson',
  'spearman',
  'mutual_information',
] as const;
/** 可选扩展方法（H2）：核独立性检验，计算量较大，不入默认四法 */
export const ROLLING_EXTRA_METHODS = ['hsic'] as const;
const ALL_ROLLING_METHODS = [...ROLLING_METHODS, ...ROLLING_EXTRA_METHODS] as const;
export type RollingMethod = (typeof ALL_ROLLING_METHODS)[number];

export interface WindowPlanOptions {
  /** 窗口长度（观测数，≥2） */
  windowSize: number;
  /** 步长（观测数，≥1） */
  stepSize: number;
  /** 最小样本量（≥2 且 ≤ windowSize，默认 windowSize；窗口内方法级前提由各检验自行守卫） */
  minSamples?: number;
}

/** 相对 [0, n-1] 的窗口闭区间调度；观测数不足一个最小窗口时返回空 */
export function planWindows(observationCount: number, options: WindowPlanOptions): Array<[number, number]> {
  const { windowSize, stepSize } = options;
  const minSamples = options.minSamples ?? windowSize;
  if (!Number.isInteger(windowSize) || windowSize < 2) {
    throw new RangeError(`窗口长度须为 ≥2 的整数（收到 ${windowSize}）`);
  }
  if (!Number.isInteger(stepSize) || stepSize < 1) {
    throw new RangeError(`步长须为 ≥1 的整数（收到 ${stepSize}）`);
  }
  if (!Number.isInteger(minSamples) || minSamples < 2 || minSamples > windowSize) {
    throw new RangeError(
      `最小样本量须为 [2, windowSize] 内的整数（收到 ${minSamples}，windowSize=${windowSize}）`,
    );
  }
  if (observationCount < minSamples) return [];

  const windows: Array<[number, number]> = [];
  for (let start = 0; start <= observationCount - minSamples; start += stepSize) {
    const end = Math.min(start + windowSize - 1, observationCount - 1);
    if (end - start + 1 < minSamples) break;
    windows.push([start, end]);
  }
  return windows;
}

export interface RollingWindowOptions extends WindowPlanOptions {
  /** 参与滚动重算的方法（默认四法，按 ROLLING_METHODS 顺序输出；hsic 为可选扩展） */
  methods?: readonly RollingMethod[];
  /** 互信息置换检验参数（默认 bins=3 / permutations=199 / seed=0，确定性可复现） */
  mi?: { bins: number; permutations: number; seed: number };
  /** HSIC 置换检验参数（默认 permutations=99 / seed=0；窗口级 O(n²)×B，置换数从紧） */
  hsic?: { permutations: number; seed: number };
}

export interface RollingWindowRow {
  leftAlias: string;
  rightAlias: string;
  /** 窗口在对齐日期轴上的闭区间索引 */
  windowStart: number;
  windowEnd: number;
  /** 窗口结束日期（对应结果长表 window_end） */
  windowEndDate: string;
  testName: RollingMethod;
  statValue: number;
  pValue: number;
  effectSize: number | null;
  /** 剪枝 / 期望频数适用性等窗口内警告；无则 null */
  notes: string | null;
}

export interface RollingWindowReport {
  rows: RollingWindowRow[];
  /** 退化窗口说明：`窗口结束 <date> · <左>×<右> · <方法>：<原因>` */
  skipped: string[];
}

/** 单个滚动任务描述（P1：纯数据、可结构化克隆，可跨 worker 传输） */
export interface RollingJob {
  /** 变量对（左/右别名，无自配对） */
  pair: [string, string];
  /** 窗口相对检验期起点的闭区间索引 */
  relStart: number;
  relEnd: number;
  method: RollingMethod;
}

/** 单任务执行结果：成功行 或 退化说明（与串行口径一致） */
export type RollingJobOutcome =
  | { kind: 'row'; row: RollingWindowRow }
  | { kind: 'skipped'; message: string };

/** 校验方法列表并解析确定性参数（计划/执行两侧同口径） */
function resolveRollingOptions(options: RollingWindowOptions): {
  methods: readonly RollingMethod[];
  mi: { bins: number; permutations: number; seed: number };
  hsicOptions: { permutations: number; seed: number };
} {
  const methods = options.methods ?? ROLLING_METHODS;
  for (const method of methods) {
    if (!ALL_ROLLING_METHODS.includes(method)) {
      throw new RangeError(`未知滚动窗口检验方法：${method}`);
    }
  }
  return {
    methods,
    mi: options.mi ?? { bins: 3, permutations: 199, seed: 0 },
    hsicOptions: options.hsic ?? { permutations: 99, seed: 0 },
  };
}

/**
 * P1 接缝：按「配对 × 窗口 × 方法」调度顺序枚举全部滚动任务（与串行循环同序）。
 * 任务无状态、互不依赖，可按任意并发度执行；结果按任务索引重组保证确定性。
 */
export function planRollingJobs(dataset: PreparedDataset, options: RollingWindowOptions): RollingJob[] {
  const { methods } = resolveRollingOptions(options);
  const [testStart, testEnd] = dataset.testIndex;
  const testLength = testEnd - testStart + 1;
  const windows = planWindows(testLength, options);

  const jobs: RollingJob[] = [];
  for (let i = 0; i < dataset.aliases.length; i += 1) {
    for (let j = i + 1; j < dataset.aliases.length; j += 1) {
      const leftAlias = dataset.aliases[i]!;
      const rightAlias = dataset.aliases[j]!;
      for (const [relStart, relEnd] of windows) {
        for (const method of methods) {
          jobs.push({ pair: [leftAlias, rightAlias], relStart, relEnd, method });
        }
      }
    }
  }
  return jobs;
}

/** P1 接缝：单任务执行（纯函数，退化返回 skipped 而非抛错） */
export function executeRollingJob(
  dataset: PreparedDataset,
  options: RollingWindowOptions,
  job: RollingJob,
): RollingJobOutcome {
  const { mi, hsicOptions } = resolveRollingOptions(options);
  const [leftAlias, rightAlias] = job.pair;
  const [testStart] = dataset.testIndex;
  const start = testStart + job.relStart;
  const end = testStart + job.relEnd;
  const windowEndDate = dataset.dates[end]!;
  try {
    const computed = runWindowMethod(job.method, dataset, leftAlias, rightAlias, start, end, mi, hsicOptions);
    return {
      kind: 'row',
      row: {
        leftAlias,
        rightAlias,
        windowStart: start,
        windowEnd: end,
        windowEndDate,
        testName: job.method,
        ...computed,
      },
    };
  } catch (error) {
    if (error instanceof RangeError) {
      return { kind: 'skipped', message: `窗口结束 ${windowEndDate} · ${leftAlias}×${rightAlias} · ${job.method}：${error.message}` };
    }
    throw error;
  }
}

/** P1 接缝：按任务索引重组 → 无论并发度如何，输出与串行一致（确定性可复现） */
export function reassembleRollingResults(
  jobs: readonly RollingJob[],
  outcomes: readonly RollingJobOutcome[],
): RollingWindowReport {
  if (jobs.length !== outcomes.length) {
    throw new RangeError(`任务数（${jobs.length}）与结果数（${outcomes.length}）不一致，无法重组`);
  }
  const rows: RollingWindowRow[] = [];
  const skipped: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === 'row') rows.push(outcome.row);
    else skipped.push(outcome.message);
  }
  return { rows, skipped };
}

/** 单窗口单方法计算；退化抛 RangeError 由编排层捕获记入 skipped */
function runWindowMethod(
  method: RollingMethod,
  dataset: PreparedDataset,
  leftAlias: string,
  rightAlias: string,
  start: number,
  end: number,
  mi: { bins: number; permutations: number; seed: number },
  hsicOptions: { permutations: number; seed: number },
): { statValue: number; pValue: number; effectSize: number | null; notes: string | null } {
  const leftValues = dataset.values[dataset.aliases.indexOf(leftAlias)]!.slice(start, end + 1);
  const rightValues = dataset.values[dataset.aliases.indexOf(rightAlias)]!.slice(start, end + 1);

  if (method === 'pearson') {
    const result = pearsonTest(leftValues, rightValues);
    return { statValue: result.r, pValue: result.pValue, effectSize: result.r, notes: null };
  }
  if (method === 'spearman') {
    const result = spearmanTest(leftValues, rightValues);
    return { statValue: result.r, pValue: result.pValue, effectSize: result.r, notes: null };
  }
  if (method === 'mutual_information') {
    const result = permutationMiTest(leftValues, rightValues, mi);
    return {
      statValue: result.miNats,
      pValue: result.pValue,
      effectSize: null,
      notes: `等频 ${mi.bins} 箱离散化 + 置换检验 B=${result.permutations}（seed=${mi.seed}）`,
    };
  }
  if (method === 'hsic') {
    const result = hsicTest(leftValues, rightValues, hsicOptions);
    return {
      statValue: result.hsic,
      pValue: result.pValue,
      effectSize: result.normalizedHsic,
      notes: `高斯核（中位数带宽）+ 置换检验 B=${result.permutations}（seed=${hsicOptions.seed}）`,
    };
  }

  // chi_square_independence：固定箱空间计数 + 零边际剪枝（与 T10 全期同口径）
  const leftLabels = dataset.binning[leftAlias]!.labels;
  const rightLabels = dataset.binning[rightAlias]!.labels;
  const table = countContingency(
    dataset.categories[leftAlias]!.slice(start, end + 1),
    dataset.categories[rightAlias]!.slice(start, end + 1),
    leftLabels.length,
    rightLabels.length,
  );
  const pruned = pruneZeroMargins(table, leftLabels, rightLabels);
  if (pruned.table.length < 2 || pruned.table[0]!.length < 2) {
    throw new RangeError('窗口内类别退化（剪枝后不足 2×2），卡方独立性无定义');
  }
  const result = chiSquareIndependence(pruned.table);
  const warnings: string[] = [];
  if (pruned.removedRows.length > 0 || pruned.removedCols.length > 0) {
    warnings.push(
      `零边际剪枝：${leftAlias} 移除 [${pruned.removedRows.join(', ')}]，${rightAlias} 移除 [${pruned.removedCols.join(', ')}]`,
    );
  }
  if (!result.applicability.adequate) {
    warnings.push(
      `期望频数不足（min=${result.applicability.minExpected.toFixed(2)}<5），卡方近似需谨慎`,
    );
  }
  return {
    statValue: result.statistic,
    pValue: result.pValue,
    effectSize: result.cramersV,
    notes: warnings.length > 0 ? warnings.join('；') : null,
  };
}

/** 检验期内按配对 × 窗口 × 方法顺序滚动重算（无自配对、无重复对；内部经 P1 任务接缝实现） */
export function rollingWindowTests(
  dataset: PreparedDataset,
  options: RollingWindowOptions,
): RollingWindowReport {
  const jobs = planRollingJobs(dataset, options);
  return reassembleRollingResults(jobs, jobs.map((job) => executeRollingJob(dataset, options, job)));
}
