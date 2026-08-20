/**
 * 分析模板端点（呈现层，G6 · PRD「配置设计」）。
 * POST   /api/templates      —— 保存模板（name + TaskConfig，workspaceId 服务端注入）
 * GET    /api/templates      —— 列出当前工作区模板
 * DELETE /api/templates/:id  —— 删除模板（跨工作区视同不存在）
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request } from 'express';
import {
  analysisTemplateSchema,
  createTemplateRequestSchema,
  type AnalysisTemplate,
} from '@platform/schemas';
import { AppError, NotFoundError } from '@platform/shared';
import { assertUuidParam } from '../middleware/security.js';
import { templateRepository, type TemplateRow } from '../../infrastructure/repositories/template-repository.js';

export const templatesRouter = Router();

function requireWorkspace(req: Request): string {
  if (!req.workspaceId) throw new AppError(500, '工作区中间件未装配');
  return req.workspaceId;
}

/** 存储行 → analysisTemplateSchema 契约（出参过校验，保证前后端一致） */
function toRecord(row: TemplateRow): AnalysisTemplate {
  return analysisTemplateSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    config: row.config,
    createdAt: row.created_at.toISOString(),
  });
}

templatesRouter.post('/', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  // 与 tasks 路由同口径：工作区 id 服务端注入后再过契约校验，忽略客户端自报值
  const raw = req.body as { name?: unknown; config?: Record<string, unknown> };
  const body = createTemplateRequestSchema.parse({
    name: raw.name,
    config: { ...(raw.config ?? {}), workspaceId },
  });
  const row = await templateRepository.insert({
    id: randomUUID(),
    workspaceId,
    name: body.name,
    config: body.config,
  });
  res.status(201).json(toRecord(row));
});

templatesRouter.get('/', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  const rows = await templateRepository.listByWorkspace(workspaceId);
  res.json({ items: rows.map(toRecord) });
});

templatesRouter.delete('/:id', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  const deleted = await templateRepository.deleteScoped(req.params.id, workspaceId);
  if (!deleted) throw new NotFoundError('模板不存在');
  res.status(204).end();
});
