/**
 * 任务端点（呈现层）。
 * POST /api/tasks   —— 创建任务（入参经 createTaskRequestSchema 校验）
 * GET  /api/tasks   —— 列出当前工作区任务
 * GET  /api/tasks/:id —— 查询单任务（归属校验，跨工作区视同不存在）
 * POST /api/tasks/:id/run —— 同步执行全链路分析（T17：MVP 同步编排）
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
    interpret: (context, model, runId) => interpretContext(context, model, runId),
    rollingExecutor: createParallelRollingExecutor(),
  };
}

tasksRouter.post('/:id/run', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  const row = await taskRepository.findByIdScoped(req.params.id, workspaceId);
  if (!row) throw new NotFoundError('任务不存在');
  if (row.status === 'running') throw new AppError(409, '任务正在运行，请等待完成');

  await taskRepository.updateStatus(row.id, 'running', null);
  try {
    const outcome = await runAnalysis(row.config, makeRunnerDeps(workspaceId));
    await resultRepository.replaceForTask(row.id, outcome.results);
    await auditRepository.replaceForTask(row.id, outcome.runId, outcome.audit);
    await panelRepository.save(row.id, outcome.panel);
    await llmArtifactRepository.save({
      taskId: row.id,
      runId: outcome.runId,
      context: outcome.llm.context,
      output: outcome.llm.output,
      trace: outcome.llm.trace,
    });
    await taskRepository.updateStatus(row.id, 'completed', null);
    res.json({
      status: 'completed',
      runId: outcome.runId,
      resultCount: outcome.results.length,
      auditCount: outcome.audit.length,
      llmStatus: outcome.llm.trace.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await taskRepository.updateStatus(row.id, 'failed', message);
    throw error instanceof AppError ? error : new AppError(500, `分析执行失败：${message}`);
  }
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
