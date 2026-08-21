/**
 * T10 · PreparedDataset → 卡方独立性检验编排（RED 先行，在接缝处测试）。
 * 行为契约：检验期类别序列 → 固定箱空间列联表 → chiSquareIndependence；
 * 零边际箱（检验期未出现）自动剪枝并记录 notes。
 */
import { describe, expect, it } from 'vitest';
import { eventAssociationScan, goodnessOfFitScan, pairwiseChiSquare } from './chi-square-dataset.js';
import type { PreparedDataset } from './pipeline.js';

/** 两序列 3 箱，检验期 6 观测；A 的 bin 2 在检验期未出现（触发剪枝） */
const dataset: PreparedDataset = {
  aliases: ['A', 'B'],
  dates: ['d1', 'd2', 'd3', 't1', 't2', 't3', 't4', 't5', 't6'],
  values: [[], []],
  referenceIndex: [0, 2],
  testIndex: [3, 8],
  binning: {
    A: { thresholds: [1, 2], labels: ['bin_1', 'bin_2', 'bin_3'] },
    B: { thresholds: [1, 2], labels: ['bin_1', 'bin_2', 'bin_3'] },
  },
  categories: {
    A: [0, 1, 2, 0, 0, 0, 1, 1, 1],
    B: [2, 1, 0, 0, 0, 1, 1, 2, 2],
  },
};

describe('pairwiseChiSquare · PreparedDataset 接缝', () => {
  it('按检验期类别构造固定箱空间列联表并给出卡方结果', () => {
    const rows = pairwiseChiSquare(dataset);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.leftAlias).toBe('A');
    expect(row.rightAlias).toBe('B');
    // 检验期 A 类别 [0,0,0,1,1,1] × B 类别 [0,0,1,1,2,2]
    // 全箱空间 3×3 中 A 的 bin_3 行全零 → 剪枝后 2×3 表：
    // [[2,1,0],[0,1,2]] → 统计量 4、df=2
    expect(row.observedTable).toEqual([
      [2, 1, 0],
      [0, 1, 2],
    ]);
    expect(row.result.statistic).toBeCloseTo(4, 9);
    expect(row.result.degreesOfFreedom).toBe(2);
    expect(row.notes).toContain('剪枝');
  });

  it('全配对按别名字典序两两组合（无自配对、无重复对）', () => {
    const three: PreparedDataset = {
      ...dataset,
      aliases: ['A', 'B', 'C'],
      categories: { ...dataset.categories, C: [0, 1, 2, 1, 0, 1, 0, 1, 0] },
      binning: {
        ...dataset.binning,
        C: { thresholds: [1, 2], labels: ['bin_1', 'bin_2', 'bin_3'] },
      },
    };
    const rows = pairwiseChiSquare(three);
    expect(rows.map((r) => `${r.leftAlias}-${r.rightAlias}`)).toEqual(['A-B', 'A-C', 'B-C']);
  });

  it('检验期类别退化为单行/单列（剪枝后不足 2×2）时抛错', () => {
    const constant: PreparedDataset = {
      ...dataset,
      categories: {
        A: [0, 1, 2, 0, 0, 0, 0, 0, 0],
        B: [2, 1, 0, 1, 1, 1, 1, 1, 1],
      },
    };
    expect(() => pairwiseChiSquare(constant)).toThrow(/列联表/);
  });
});

/** S1 · PRD 模块 E：检验期状态分布 vs 参考期期望概率（每别名一行） */
describe('goodnessOfFitScan · PreparedDataset 接缝', () => {
  it('每别名一行：参考期频数概率 vs 检验期观测，统计量与 chiSquareGoodnessOfFit 同口径', () => {
    const report = goodnessOfFitScan(dataset);
    expect(report.rows.map((r) => r.alias)).toEqual(['A', 'B']);
    const rowA = report.rows[0]!;
    // 参考期 A 类别 [0,1,2] → 概率 [1/3,1/3,1/3]；检验期观测 [3,3,0]，n=6，df=2
    expect(rowA.observed).toEqual([3, 3, 0]);
    expect(rowA.probabilities.map((p) => Number(p.toFixed(9)))).toEqual([
      Number((1 / 3).toFixed(9)),
      Number((1 / 3).toFixed(9)),
      Number((1 / 3).toFixed(9)),
    ]);
    // Σ (o-e)²/e = 2×(3-2)²/2 + (0-2)²/2 = 3
    expect(rowA.result.statistic).toBeCloseTo(3, 9);
    expect(rowA.result.degreesOfFreedom).toBe(2);
    expect(rowA.result.cramersV).toBeNull();
    // notes 说明期望概率口径来源
    expect(rowA.notes).toContain('参考期');
    // B：参考期类别 [2,1,0] → 概率 [1/3,1/3,1/3]；检验期观测 [2,2,2] → 统计量 0
    const rowB = report.rows[1]!;
    expect(rowB.observed).toEqual([2, 2, 2]);
    expect(rowB.result.statistic).toBeCloseTo(0, 9);
  });

  it('参考期某箱从未出现（期望概率为 0）时跳过该别名并记入 skipped', () => {
    const degenerate: PreparedDataset = {
      ...dataset,
      categories: {
        ...dataset.categories,
        A: [0, 0, 0, 0, 0, 0, 1, 1, 1], // 参考期无 bin_3（索引 2）
      },
    };
    const report = goodnessOfFitScan(degenerate);
    expect(report.rows.map((r) => r.alias)).toEqual(['B']);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toContain('A');
    expect(report.skipped[0]).toContain('bin_3');
  });

  it('检验期未出现的箱观测为 0 仍参与检验（不剪枝）', () => {
    const report = goodnessOfFitScan(dataset);
    // A 的 bin_3 检验期未出现但参考期有 → 保留 0 观测
    expect(report.rows[0]!.observed).toHaveLength(3);
    expect(report.rows[0]!.observed[2]).toBe(0);
  });
});

/** S4 · 事件标签：事件日 vs 非事件日状态分布卡方独立性（检验期） */
describe('eventAssociationScan · PreparedDataset 接缝（S4）', () => {
  it('事件日在检验期：每别名一行 2×K 列联表，统计量手算对拍', () => {
    // 事件 t3（idx=5）：A 事件日类别 0 → [[1,0,0],[2,3,0]]，bin_3 列全零剪枝后 [[1,0],[2,3]]
    // χ²=1.2（df=1）；B 事件日类别 1 → [[0,1,0],[2,1,2]] 无剪枝，χ²=2.4（df=2）
    const report = eventAssociationScan(dataset, [{ name: 'E1', date: 't3' }]);
    expect(report.skipped).toHaveLength(0);
    expect(report.rows.map((r) => r.alias)).toEqual(['A', 'B']);
    const rowA = report.rows[0]!;
    expect(rowA.eventName).toBe('E1');
    expect(rowA.observedTable).toEqual([
      [1, 0],
      [2, 3],
    ]);
    expect(rowA.result.statistic).toBeCloseTo(1.2, 9);
    expect(rowA.result.degreesOfFreedom).toBe(1);
    expect(rowA.notes).toContain('剪枝');
    const rowB = report.rows[1]!;
    expect(rowB.result.statistic).toBeCloseTo(2.4, 9);
    expect(rowB.result.degreesOfFreedom).toBe(2);
    expect(rowB.notes).toBeNull();
  });

  it('多事件×多别名：行数 = 事件数 × 别名数', () => {
    const report = eventAssociationScan(dataset, [
      { name: 'E1', date: 't3' },
      { name: 'E2', date: 't5' },
    ]);
    expect(report.rows).toHaveLength(4);
    expect(report.rows.map((r) => `${r.eventName}:${r.alias}`)).toEqual([
      'E1:A',
      'E1:B',
      'E2:A',
      'E2:B',
    ]);
  });

  it('事件日期在参考期：跳过并记入 skipped（事件关联仅在检验期检验）', () => {
    const report = eventAssociationScan(dataset, [{ name: 'E1', date: 'd2' }]);
    expect(report.rows).toHaveLength(0);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toContain('检验期');
  });

  it('事件日期不在样本日期轴：跳过并记入 skipped', () => {
    const report = eventAssociationScan(dataset, [{ name: 'E1', date: 'x9' }]);
    expect(report.rows).toHaveLength(0);
    expect(report.skipped[0]).toContain('日期轴');
  });

  it('事件日与非事件日状态完全相同（剪枝后不足 2×2）：该别名退化记 skipped 不阻塞其余别名', () => {
    const degenerate: PreparedDataset = {
      ...dataset,
      categories: {
        ...dataset.categories,
        A: [0, 1, 2, 0, 0, 0, 0, 0, 0], // 检验期全为状态 0 → 列联表仅一列
      },
    };
    const report = eventAssociationScan(degenerate, [{ name: 'E1', date: 't3' }]);
    expect(report.rows.map((r) => r.alias)).toEqual(['B']);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toContain('A');
  });
});
