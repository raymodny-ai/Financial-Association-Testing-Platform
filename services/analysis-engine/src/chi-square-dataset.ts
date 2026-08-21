/**
 * PreparedDataset → 卡方族检验编排（T10 独立性 / S1 拟合优度）。
 *
 * 接缝语义：检验期类别序列按「固定箱空间」构造列联表（行数/列数取自
 * 各自的分箱标签数，保证阈值口径可追溯）；检验期未出现的箱形成零边际，
 * 自动剪枝并在 notes 记录（PRD：不满足前提必须明确警告而非静默执行）。
 * 剪枝后不足 2×2 视为退化，由 chiSquareIndependence 抛错。
 */
import { chiSquareGoodnessOfFit, chiSquareIndependence, type ChiSquareResult } from './chi-square.js';
import type { PreparedDataset } from './pipeline.js';

export interface PairwiseChiSquareRow {
  leftAlias: string;
  rightAlias: string;
  /** 剪枝后的观测列联表 */
  observedTable: number[][];
  result: ChiSquareResult;
  /** 剪枝说明；无剪枝为 null */
  notes: string | null;
}

/**
 * 固定箱空间列联表计数（共享接缝，T10 全期与 T13 滚动窗口复用）：
 * 行数/列数取自各自分箱 labels 数，保证阈值口径可追溯。
 */
export function countContingency(
  leftCategories: readonly number[],
  rightCategories: readonly number[],
  leftBinCount: number,
  rightBinCount: number,
): number[][] {
  const table = Array.from({ length: leftBinCount }, () =>
    new Array<number>(rightBinCount).fill(0),
  );
  for (let k = 0; k < leftCategories.length; k += 1) {
    table[leftCategories[k]!]![rightCategories[k]!]! += 1;
  }
  return table;
}

/** 全零边际剪枝：返回剪枝后矩阵与被移除的行/列标签 */
export function pruneZeroMargins(
  table: number[][],
  rowLabels: readonly string[],
  colLabels: readonly string[],
): { table: number[][]; removedRows: string[]; removedCols: string[] } {
  const colSums = table[0]!.map((_, j) => table.reduce((acc, row) => acc + row[j]!, 0));
  const keepRows = table.map((row) => row.some((c) => c > 0));
  const keepCols = colSums.map((s) => s > 0);
  return {
    table: table
      .filter((_, i) => keepRows[i])
      .map((row) => row.filter((_, j) => keepCols[j])),
    removedRows: rowLabels.filter((_, i) => !keepRows[i]),
    removedCols: colLabels.filter((_, j) => !keepCols[j]),
  };
}

/** 对所有别名两两组合执行检验期卡方独立性检验（无自配对、无重复对） */
export function pairwiseChiSquare(dataset: PreparedDataset): PairwiseChiSquareRow[] {
  const [testStart, testEnd] = dataset.testIndex;
  const rows: PairwiseChiSquareRow[] = [];

  for (let i = 0; i < dataset.aliases.length; i += 1) {
    for (let j = i + 1; j < dataset.aliases.length; j += 1) {
      const leftAlias = dataset.aliases[i]!;
      const rightAlias = dataset.aliases[j]!;
      const leftCategories = dataset.categories[leftAlias]!.slice(testStart, testEnd + 1);
      const rightCategories = dataset.categories[rightAlias]!.slice(testStart, testEnd + 1);

      const leftLabels = dataset.binning[leftAlias]!.labels;
      const rightLabels = dataset.binning[rightAlias]!.labels;
      const table = countContingency(
        leftCategories,
        rightCategories,
        leftLabels.length,
        rightLabels.length,
      );

      const pruned = pruneZeroMargins(table, leftLabels, rightLabels);
      const notes =
        pruned.removedRows.length > 0 || pruned.removedCols.length > 0
          ? `检验期零边际剪枝：${leftAlias} 移除 [${pruned.removedRows.join(', ')}]，${rightAlias} 移除 [${pruned.removedCols.join(', ')}]`
          : null;

      rows.push({
        leftAlias,
        rightAlias,
        observedTable: pruned.table,
        result: chiSquareIndependence(pruned.table),
        notes,
      });
    }
  }

  return rows;
}

export interface GoodnessOfFitRow {
  alias: string;
  /** 检验期状态频数（固定箱空间；检验期未出现的箱保留 0 观测，不剪枝） */
  observed: number[];
  /** 参考期期望概率（参考期状态频数 / 参考期样本量） */
  probabilities: number[];
  result: ChiSquareResult;
  /** 期望概率口径说明 */
  notes: string | null;
}

export interface GoodnessOfFitReport {
  rows: GoodnessOfFitRow[];
  /** 退化跳过说明：`<别名>：箱 [...] 参考期从未出现...`（期望概率为 0，拟合无定义） */
  skipped: string[];
}

/**
 * 逐别名卡方拟合优度（PRD 模块 E）：检验期状态分布 vs 参考期期望概率。
 * 参考期某箱从未出现时期望概率为 0（chiSquareGoodnessOfFit 拒绝），
 * 该别名跳过并记入 skipped，不阻塞其余别名。
 */
export function goodnessOfFitScan(dataset: PreparedDataset): GoodnessOfFitReport {
  const [refStart, refEnd] = dataset.referenceIndex;
  const [testStart, testEnd] = dataset.testIndex;
  const rows: GoodnessOfFitRow[] = [];
  const skipped: string[] = [];

  for (const alias of dataset.aliases) {
    const labels = dataset.binning[alias]!.labels;
    const categories = dataset.categories[alias]!;
    const refCounts = new Array<number>(labels.length).fill(0);
    for (let k = refStart; k <= refEnd; k += 1) {
      refCounts[categories[k]!]! += 1;
    }
    const zeroBins = labels.filter((_, b) => refCounts[b] === 0);
    if (zeroBins.length > 0) {
      skipped.push(`${alias}：箱 [${zeroBins.join(', ')}] 参考期从未出现（期望概率为 0，拟合优度无定义）`);
      continue;
    }
    const refTotal = refEnd - refStart + 1;
    const probabilities = refCounts.map((c) => c / refTotal);
    const observed = new Array<number>(labels.length).fill(0);
    for (let k = testStart; k <= testEnd; k += 1) {
      observed[categories[k]!]! += 1;
    }
    rows.push({
      alias,
      observed,
      probabilities,
      result: chiSquareGoodnessOfFit(observed, probabilities),
      notes: `期望概率来自参考期状态频数（n_ref=${refTotal}）`,
    });
  }

  return { rows, skipped };
}
