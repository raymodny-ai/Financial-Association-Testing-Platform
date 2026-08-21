/**
 * 批注与收藏端点（呈现层，X4 · PRD L140/L356）。
 * GET    /api/tasks/:id/annotations              —— 列出任务批注
 * POST   /api/tasks/:id/annotations              —— 新增批注（201）
 * DELETE /api/tasks/:id/annotations/:annotationId —— 删除批注（204）
 * PUT    /api/tasks/:id/favorite                 —— 切换收藏（回显 {favorited}）
 *
 * 与 tasks 路由同挂载 /api/tasks 前缀：子路径互不重叠，归属校验同口径
 *（宿主任务不存在或跨工作区一律 404，防枚举）。分享链接为前端能力，
 * 服务端不落库（单实例匿名工作区，链接即结果页 URL）。
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request } from 'express';
import {
  createAnnotationRequestSchema,
  setFavoriteRequestSchema,
  taskAnnotationSchema,
  type TaskAnnotation,
} from '@platform/schemas';
import { AppError, NotFoundError } from '@platform/shared';
import { assertUuidParam } from '../middleware/security.js';
import { taskRepository } from '../../infrastructure/repositories/task-repository.js';
import {
  annotationRepository,
  type AnnotationRow,
} from '../../infrastructure/repositories/annotation-repository.js';

export const annotationsRouter = Router();

function requireWorkspace(req: Request): string {
  if (!req.workspaceId) throw new AppError(500, '工作区中间件未装配');
  return req.workspaceId;
}

/** 宿主任务归属校验：不存在或跨工作区视同 404 */
async function requireTask(taskId: string, workspaceId: string): Promise<void> {
  const task = await taskRepository.findByIdScoped(taskId, workspaceId);
  if (!task) throw new NotFoundError('任务不存在');
}

/** 存储行 → taskAnnotationSchema 契约（出参过校验，保证前后端一致） */
function toRecord(row: AnnotationRow): TaskAnnotation {
  return taskAnnotationSchema.parse({
    id: row.id,
    taskId: row.task_id,
    content: row.content,
    createdAt: row.created_at.toISOString(),
  });
}

annotationsRouter.get('/:id/annotations', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  await requireTask(req.params.id, workspaceId);
  const rows = await annotationRepository.listByTask(req.params.id, workspaceId);
  res.json({ items: rows.map(toRecord) });
});

annotationsRouter.post('/:id/annotations', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  await requireTask(req.params.id, workspaceId);
  const body = createAnnotationRequestSchema.parse(req.body);
  const row = await annotationRepository.insert({
    id: randomUUID(),
    taskId: req.params.id,
    workspaceId,
    content: body.content,
  });
  res.status(201).json(toRecord(row));
});

annotationsRouter.delete('/:id/annotations/:annotationId', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  assertUuidParam(req.params.annotationId);
  await requireTask(req.params.id, workspaceId);
  const deleted = await annotationRepository.deleteScoped(req.params.annotationId, req.params.id, workspaceId);
  if (!deleted) throw new NotFoundError('批注不存在');
  res.status(204).end();
});

annotationsRouter.put('/:id/favorite', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  const body = setFavoriteRequestSchema.parse(req.body);
  const favorited = await taskRepository.setFavorite(req.params.id, workspaceId, body.favorited);
  if (favorited === null) throw new NotFoundError('任务不存在');
  res.json({ favorited });
});
