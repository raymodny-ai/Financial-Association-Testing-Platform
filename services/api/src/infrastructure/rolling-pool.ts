/**
 * P1 · 滚动窗口 worker 线程池（PRD 非功能：滚动窗口与置换检验后台并行化）。
 *
 * 设计要点：
 * - 任务按调度顺序分发、按任务索引收集 → 结果顺序与串行一致（确定性可复现）；
 * - 固定大小池（≤ 并发上限、≤ 任务数），每 worker 串行领任务；
 * - 单任务失败整体拒绝，池统一终止清理；
 * - worker 协议：主线程 postMessage(任务) → worker 回 { ok, result | error }。
 *
 * ADR 001 合规：仅 node:worker_threads / node:os 内建模块，零新增依赖。
 */
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  planRollingJobs,
  reassembleRollingResults,
  type PreparedDataset,
  type RollingJobOutcome,
  type RollingWindowOptions,
  type RollingWindowReport,
} from '@platform/analysis-engine';

interface WorkerReply<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

/** 并发上限：机器核数与 4 取小（Render 免费档小规格防抖） */
export function defaultRollingConcurrency(jobCount: number): number {
  if (jobCount <= 1) return 1;
  return Math.max(1, Math.min(availableParallelism(), 4, jobCount));
}

/**
 * 用固定大小 worker 池并行执行任务，按输入顺序返回结果。
 * 任一任务失败即整体拒绝并终止全部 worker。
 */
export async function runJobsParallel<T, J = unknown>(
  workerPath: string,
  jobs: readonly J[],
  concurrency: number,
): Promise<T[]> {
  if (jobs.length === 0) return [];
  const poolSize = Math.max(1, Math.min(concurrency, jobs.length));

  const results = new Array<T>(jobs.length);
  let nextIndex = 0;
  let failed = false;
  let failReason: Error | null = null;

  const workers: Worker[] = [];
  const settle = new Promise<void>((resolve, reject) => {
    let completedJobs = 0;

    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      failReason = error;
      for (const worker of workers) void worker.terminate();
      reject(error);
    };

    for (let w = 0; w < poolSize; w += 1) {
      const worker = new Worker(workerPath);
      workers.push(worker);
      // 单 worker 串行领任务，在飞任务索引一对一登记（无并发覆写）
      let currentJobIndex = -1;

      const dispatch = () => {
        if (failed || nextIndex >= jobs.length) return;
        currentJobIndex = nextIndex;
        nextIndex += 1;
        worker.postMessage({ jobIndex: currentJobIndex, job: jobs[currentJobIndex] });
      };

      worker.on('message', (reply: WorkerReply<T>) => {
        if (failed) return;
        const jobIndex = currentJobIndex;
        if (jobIndex < 0) {
          fail(new Error('worker 返回了未登记的任务结果'));
          return;
        }
        if (!reply.ok) {
          fail(new Error(reply.error ?? 'worker 任务失败'));
          return;
        }
        results[jobIndex] = reply.result as T;
        currentJobIndex = -1;
        completedJobs += 1;
        if (completedJobs === jobs.length) {
          for (const other of workers) void other.terminate();
          resolve();
          return;
        }
        dispatch();
      });
      worker.on('error', (error) => fail(error));
      worker.on('exit', (code) => {
        if (!failed && code !== 0 && code !== 1) {
          fail(new Error(`worker 异常退出（code=${code}）`));
        }
      });

      dispatch();
    }
  });

  try {
    await settle;
  } catch (error) {
    throw failReason ?? (error as Error);
  }
  return results;
}

/** 滚动 worker 入口路径解析：生产用打包后的 .js，开发（tsx）回退 .ts */
export function resolveRollingWorkerPath(): string {
  const compiled = new URL('./rolling-worker.js', import.meta.url);
  if (existsSync(fileURLToPath(compiled))) return fileURLToPath(compiled);
  return fileURLToPath(new URL('./rolling-worker.ts', import.meta.url));
}

/** 滚动任务 worker 载荷（与 rolling-worker.ts 协议一致） */
export interface RollingWorkerPayload {
  dataset: PreparedDataset;
  options: RollingWindowOptions;
  job: unknown;
}

/**
 * 生产装配：滚动窗口并行执行器（注入 RunnerDeps.rollingExecutor）。
 * 计划/重组在主线程序列化完成，仅单任务执行分发到 worker，
 * 输出与串行 rollingWindowTests 完全一致（确定性）。
 */
export function createParallelRollingExecutor(
  workerPath: string = resolveRollingWorkerPath(),
): (dataset: PreparedDataset, options: RollingWindowOptions) => Promise<RollingWindowReport> {
  return async (dataset, options) => {
    const jobs = planRollingJobs(dataset, options);
    if (jobs.length === 0) return { rows: [], skipped: [] };
    const payloads = jobs.map((job) => ({ dataset, options, job }));
    const outcomes = await runJobsParallel<RollingJobOutcome, RollingWorkerPayload>(
      workerPath,
      payloads,
      defaultRollingConcurrency(jobs.length),
    );
    return reassembleRollingResults(jobs, outcomes);
  };
}
