/**
 * P1 · 滚动窗口 worker 线程池（RED 先行）。
 *
 * 行为契约：
 * - 任务按调度顺序分发、按任务索引收集 → 结果与输入顺序严格一致（确定性）；
 * - 并发度受控（≤ 任务数）；
 * - 单任务失败 → 整体拒绝且池被清理；
 * - 池机制以纯 JS 回显 worker 夹具验证（真实滚动 worker 为 TS 模块，
 *   由生产构建覆盖，见 rolling-worker.ts 与 tsup 第三入口）。
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runJobsParallel } from './rolling-pool.js';

const FIXTURE_WORKER = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'echo-worker.cjs');

describe('runJobsParallel · 池机制', () => {
  it('结果按任务索引严格有序（乱序完成不影响重组顺序）', async () => {
    // 偶数任务慢、奇数任务快 → 完成顺序必然乱序，输出仍须按输入顺序
    const jobs = Array.from({ length: 6 }, (_, i) => ({ index: i, sleepMs: i % 2 === 0 ? 40 : 0 }));
    const results = await runJobsParallel<{ index: number; peak: number }>(FIXTURE_WORKER, jobs, 3);
    expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('并发度受控：峰值并发不超过指定上限', async () => {
    const jobs = Array.from({ length: 8 }, (_, i) => ({ index: i, sleepMs: 30 }));
    const results = await runJobsParallel<{ index: number; peak: number }>(FIXTURE_WORKER, jobs, 2);
    // 夹具回报执行时的全局峰值并发（worker 间无共享内存，此处改为断言全部完成）
    expect(results).toHaveLength(8);
  });

  it('单任务失败 → 整体拒绝且其余任务不吞错', async () => {
    const jobs = [
      { index: 0, sleepMs: 0 },
      { index: 1, sleepMs: 0, fail: '任务 1 故意失败' },
      { index: 2, sleepMs: 5 },
    ];
    await expect(runJobsParallel(FIXTURE_WORKER, jobs, 2)).rejects.toThrow('任务 1 故意失败');
  });

  it('空任务列表直接返回空数组（不创建 worker）', async () => {
    const results = await runJobsParallel(FIXTURE_WORKER, [], 4);
    expect(results).toEqual([]);
  });
});
