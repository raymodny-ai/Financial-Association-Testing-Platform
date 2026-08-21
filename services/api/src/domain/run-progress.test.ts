/**
 * P2 · 运行进度注册表（RED 先行）。
 *
 * 行为契约：
 * - RUN_STEPS 为固定 11 步标签（编排 10 步 + 持久化 1 步），顺序即执行顺序；
 * - reportProgress 记录最新步骤（覆盖式），getRunProgress 返回含标签的快照；
 * - clearRunProgress 清除（任务终态后不再残留）；
 * - 未知任务一律 null（防枚举，不抛错）。
 */
import { describe, expect, it } from 'vitest';
import {
  RUN_STEPS,
  clearRunProgress,
  getRunProgress,
  reportProgress,
} from './run-progress.js';

describe('run-progress · 运行进度注册表', () => {
  it('RUN_STEPS 固定 11 步且标签非空（数据加载…结果持久化）', () => {
    expect(RUN_STEPS).toHaveLength(11);
    for (const label of RUN_STEPS) expect(label.length).toBeGreaterThan(0);
    expect(RUN_STEPS[0]).toBe('加载数据');
    expect(RUN_STEPS[10]).toBe('结果持久化');
  });

  it('reportProgress 覆盖式记录，getRunProgress 返回含标签快照', () => {
    const taskId = '00000000-0000-0000-0000-0000000000aa';
    reportProgress(taskId, 0);
    reportProgress(taskId, 3);
    const progress = getRunProgress(taskId);
    expect(progress).not.toBeNull();
    expect(progress!.stepIndex).toBe(3);
    expect(progress!.totalSteps).toBe(11);
    expect(progress!.stepLabel).toBe('连续变量检验');
    expect(progress!.updatedAt).toBeGreaterThan(0);
    clearRunProgress(taskId);
  });

  it('clearRunProgress 与未知任务均返回 null', () => {
    const taskId = '00000000-0000-0000-0000-0000000000bb';
    reportProgress(taskId, 5);
    clearRunProgress(taskId);
    expect(getRunProgress(taskId)).toBeNull();
    expect(getRunProgress('00000000-0000-0000-0000-0000000000cc')).toBeNull();
  });

  it('越界步骤索引拒绝（编程错误须显式暴露）', () => {
    expect(() => reportProgress('00000000-0000-0000-0000-0000000000dd', 11)).toThrow(RangeError);
    expect(() => reportProgress('00000000-0000-0000-0000-0000000000dd', -1)).toThrow(RangeError);
  });
});
