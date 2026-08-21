/**
 * 任务端点（呈现层）。
 * POST /api/tasks   —— 创建任务（入参经 createTaskRequestSchema 校验）
 * GET  /api/tasks   —— 列出当前工作区任务
 * GET  /api/tasks/:id —— 查询单任务（归属校验，跨工作区视同不存在）
 * POST /api/tasks/:id/run —— 202 受理后台异步执行（P2：长任务异步化，前端轮询）
 * GET  /api/tasks/:id/progress —— 运行进度（当前步骤/总步数，终态后清空）
 * GET  /api/tasks/:id/results —— 结果长表 + 审计表 + LLM 产物
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request } from 'express';
import {
  createTaskRequestSchema,
  taskRecordSchema,
  type TaskRecord,
} from '@platform/schemas';
import { AppError, DataAdapterError, NotFoundError } from '@platform/shared';
import { assertUuidParam } from '../middleware/security.js';
import { runAnalysis, type RunnerDeps } from '../../domain/analysis-runner.js';
import { getProvider } from '../../domain/provider-registry.js';
import {
  RUN_STEPS,
  clearRunProgress,
  getRunProgress,
  reportProgress,
} from '../../domain/run-progress.js';
import { interpretContext } from '../../infrastructure/llm-runner.js';
import { createParallelRollingExecutor } from '../../infrastructure/rolling-pool.js';
import { fileRepository } from '../../infrastructure/repositories/file-repository.js';
import {
  auditRepository,
  llmArtifactRepository,
  panelRepository,
  resultRepository,
} from '../../infrastructure/repositories/result-repository.js';
import { taskRepository, type TaskRow } from '../../infrastructure/repositories/task-repository.js';

export const tasksRouter = Router();

/** G5：工作区归属一律以服务端 Cookie 为准，缺失即装配错误 */
function requireWorkspace(req: Request): string {
  if (!req.workspaceId) throw new AppError(500, '工作区中间件未装配');
  return req.workspaceId;
}

/** 存储行 → taskRecordSchema 契约（出参同样过校验，保证前后端一致） */
function toRecord(row: TaskRow): TaskRecord {
  return taskRecordSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    status: row.status,
    config: row.config,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    errorMessage: row.error_message,
    favorited: row.favorited,
  });
}

tasksRouter.post('/', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  // 工作区 id 由服务端注入，忽略客户端自报值
  const config = createTaskRequestSchema.parse({
    ...req.body,
    workspaceId,
  });
  const row = await taskRepository.insert({
    id: randomUUID(),
    workspaceId,
    config,
  });
  res.status(201).json(toRecord(row));
});

tasksRouter.get('/', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  const rows = await taskRepository.listByWorkspace(workspaceId);
  res.json({ items: rows.map(toRecord) });
});

tasksRouter.get('/:id', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  const row = await taskRepository.findByIdScoped(req.params.id, workspaceId);
  if (!row) throw new NotFoundError('任务不存在');
  res.json(toRecord(row));
});

/** 装配真实依赖（G5：文件读取同样以工作区作用域约束；P1：滚动窗口经 worker 线程池后台并行） */
function makeRunnerDeps(workspaceId: string): RunnerDeps {
  return {
    async fetchHistory(providerName, ticker, query) {
      const provider = getProvider(providerName);
      if (!provider) throw new DataAdapterError(`数据提供方 ${providerName} 未注册`);
      return provider.fetchHistory(ticker, query);
    },
    async readFileContent(fileId) {
      const file = await fileRepository.findByIdScoped(fileId, workspaceId);
      if (!file) throw new NotFoundError('上传文件不存在或不属于当前工作区');
      return file.content;
    },
    interpret: (context, model, runId, promptVersion) =>
      interpretContext(context, model, runId, promptVersion),
    rollingExecutor: createParallelRollingExecutor(),
  };
}

/**
 * P2：后台执行全链路分析并持久化（不阻塞请求；失败回写 failed）。
 * 进度上报：编排 0..9 步经 onProgress，持久化步（10）在本函数内上报，终态后清空。
 */
async function executeInBackground(taskId: string, config: TaskRecord['config'], workspaceId: string): Promise<void> {
  try {
    const outcome = await runAnalysis(config, makeRunnerDeps(workspaceId), (stepIndex) =>
      reportProgress(taskId, stepIndex),
    );
    reportProgress(taskId, RUN_STEPS.length - 1); // 结果持久化（路由层职责）
    await resultRepository.replaceForTask(taskId, outcome.results);
    await auditRepository.replaceForTask(taskId, outcome.runId, outcome.audit);
    await panelRepository.save(taskId, outcome.panel);
    await llmArtifactRepository.save({
      taskId,
      runId: outcome.runId,
      context: outcome.llm.context,
      output: outcome.llm.output,
      trace: outcome.llm.trace,
    });
    await taskRepository.updateStatus(taskId, 'completed', null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await taskRepository.updateStatus(taskId, 'failed', message);
  } finally {
    clearRunProgress(taskId);
  }
}

tasksRouter.post('/:id/run', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  const row = await taskRepository.findByIdScoped(req.params.id, workspaceId);
  if (!row) throw new NotFoundError('任务不存在');
  if (row.status === 'running') throw new AppError(409, '任务正在运行，请等待完成');

  await taskRepository.updateStatus(row.id, 'running', null);
  // P2：202 受理即返回，后台异步执行（PRD：长任务异步轮询）；失败状态由轮询可见
  void executeInBackground(row.id, row.config, workspaceId);
  res.status(202).json({ status: 'running' });
});

tasksRouter.get('/:id/progress', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  const row = await taskRepository.findByIdScoped(req.params.id, workspaceId);
  if (!row) throw new NotFoundError('任务不存在');
  res.json({ status: row.status, progress: getRunProgress(row.id) });
});

tasksRouter.get('/:id/results', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  const row = await taskRepository.findByIdScoped(req.params.id, workspaceId);
  if (!row) throw new NotFoundError('任务不存在');
  const [results, audit, llm, panel] = await Promise.all([
    resultRepository.listByTask(row.id),
    auditRepository.listByTask(row.id),
    llmArtifactRepository.findByTask(row.id),
    panelRepository.findByTask(row.id),
  ]);
  res.json({
    task: toRecord(row),
    results,
    audit,
    panel,
    llm: llm === null ? null : { context: llm.context, output: llm.output, trace: llm.trace },
  });
});
