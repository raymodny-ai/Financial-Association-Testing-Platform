/**
 * P1 · 滚动窗口 worker 入口（由 worker_threads 加载，tsup 第三入口独立打包）。
 *
 * 协议（与 rolling-pool.runJobsParallel 一致）：
 * 收 { jobIndex, job: { dataset, options, job } } → 回 { ok, result: RollingJobOutcome | error }。
 * dataset/options/job 均为可结构化克隆的纯数据；单任务执行纯函数、确定性。
 */
import { parentPort } from 'node:worker_threads';
import {
  executeRollingJob,
  type PreparedDataset,
  type RollingJob,
  type RollingWindowOptions,
} from '@platform/analysis-engine';

if (!parentPort) throw new Error('rolling-worker 必须由 worker_threads 加载');
const port = parentPort;

interface RollingWorkerMessage {
  jobIndex: number;
  job: { dataset: PreparedDataset; options: RollingWindowOptions; job: RollingJob };
}

port.on('message', (message: RollingWorkerMessage) => {
  try {
    const { dataset, options, job } = message.job;
    port.postMessage({ ok: true, result: executeRollingJob(dataset, options, job) });
  } catch (error) {
    port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
