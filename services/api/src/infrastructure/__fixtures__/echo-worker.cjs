/**
 * P1 测试夹具：纯 JS 回显 worker（池机制验证用；真实滚动 worker 为 TS 模块）。
 * 协议（与 rolling-pool 一致）：收 { jobIndex, job: { index, sleepMs?, fail? } }
 * → 回 { ok, result | error }。
 */
const { parentPort } = require('node:worker_threads');

parentPort.on('message', async (message) => {
  const job = message.job;
  try {
    if (job.sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, job.sleepMs));
    }
    if (job.fail) throw new Error(job.fail);
    parentPort.postMessage({ ok: true, result: { index: job.index, peak: 0 } });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message });
  }
});
