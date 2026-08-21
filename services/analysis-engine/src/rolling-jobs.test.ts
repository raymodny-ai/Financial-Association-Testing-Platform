/**
 * P1 · 滚动窗口并行化接缝（RED 先行）：任务计划 / 单任务执行 / 结果重组。
 *
 * 行为契约：
 * - planRollingJobs 按「配对 × 窗口 × 方法」调度顺序枚举全部任务（与
 *   rollingWindowTests 串行循环同序），任务描述为可结构化克隆的纯数据；
 * - executeRollingJob 单任务执行，成功产出行，退化产出 skipped 文案，
 *   与 rollingWindowTests 内部口径完全一致；
 * - reassembleRollingResults 按任务索引重组 → 无论并发度如何，
 *   输出与串行 rollingWindowTests 逐字节一致（确定性可复现）。
 */
import { describe, expect, it } from 'vitest';
import type { PreparedDataset } from './pipeline.js';
import {
  executeRollingJob,
  planRollingJobs,
  reassembleRollingResults,
  rollingWindowTests,
} from './rolling.js';

/** 两序列 8 观测检验期（与 rolling.test 同构造，含退化窗口） */
function buildDataset(): PreparedDataset {
  const dates = Array.from({ length: 8 }, (_, i) => `2024-01-0${i + 1}`);
  return {
    aliases: ['A', 'B'],
    dates,
    values: [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [1, 3, 2, 5, 4, 4, 4, 4],
    ],
    referenceIndex: [0, 0],
    testIndex: [0, 7],
    binning: {
      A: { thresholds: [3.5], labels: ['low', 'high'] },
      B: { thresholds: [3.5], labels: ['low', 'high'] },
    },
    categories: {
      A: [0, 0, 0, 1, 1, 1, 1, 1],
      B: [0, 0, 0, 1, 1, 1, 1, 1],
    },
  };
}

const options = { windowSize: 4, stepSize: 4, methods: ['pearson', 'mutual_information'] as const };

describe('planRollingJobs · 调度枚举', () => {
  it('按配对 × 窗口 × 方法顺序枚举，个数为 配对数×窗口数×方法数', () => {
    const jobs = planRollingJobs(buildDataset(), options);
    // 1 配对 × 2 窗口 × 2 方法 = 4 任务
    expect(jobs).toHaveLength(4);
    expect(jobs.map((j) => [j.pair[0], j.pair[1], j.relStart, j.method])).toEqual([
      ['A', 'B', 0, 'pearson'],
      ['A', 'B', 0, 'mutual_information'],
      ['A', 'B', 4, 'pearson'],
      ['A', 'B', 4, 'mutual_information'],
    ]);
  });

  it('任务描述为可结构化克隆的纯数据（worker 传输前提）', () => {
    const jobs = planRollingJobs(buildDataset(), options);
    expect(() => structuredClone(jobs)).not.toThrow();
  });

  it('窗口不足时返回空计划', () => {
    expect(planRollingJobs(buildDataset(), { ...options, windowSize: 20 })).toEqual([]);
  });
});

describe('executeRollingJob + reassemble · 与串行基线逐字节一致', () => {
  it('逐任务执行后重组 = rollingWindowTests 串行输出（rows 与 skipped 全等）', () => {
    const dataset = buildDataset();
    const baseline = rollingWindowTests(dataset, options);
    const jobs = planRollingJobs(dataset, options);
    const outcomes = jobs.map((job) => executeRollingJob(dataset, options, job));
    const reassembled = reassembleRollingResults(jobs, outcomes);
    expect(reassembled).toEqual(baseline);
  });

  it('退化任务产出 skipped 文案而非抛错（窗口 2 的 B 恒定 → pearson 退化）', () => {
    const dataset = buildDataset();
    const jobs = planRollingJobs(dataset, { ...options, methods: ['pearson'] });
    const degenerate = jobs.find((j) => j.relStart === 4)!;
    const outcome = executeRollingJob(dataset, { ...options, methods: ['pearson'] }, degenerate);
    expect(outcome).toEqual({
      kind: 'skipped',
      message: expect.stringContaining('窗口结束 2024-01-08'),
    });
  });
});
