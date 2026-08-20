/**
 * CSV 上传端点（呈现层，MVP 并列第一入口）。
 * POST /api/files        —— 上传 CSV 原文（Content-Type: text/csv，文件名走 x-filename 头，URI 编码兼容中文）
 * GET  /api/files        —— 列出当前工作区文件元数据
 * GET  /api/files/:id    —— 单文件元数据 + 原文（任务执行期按 columnMapping 解析）
 *
 * 说明：前端以 File.text() 读取原文后原样 POST，避免引入 multipart 依赖。
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request } from 'express';
import { uploadedFileSchema, type UploadedFile } from '@platform/schemas';
import { AppError, NotFoundError, ValidationError } from '@platform/shared';
import { assertUuidParam } from '../middleware/security.js';
import { extractHeaders, parseCsv } from '../../infrastructure/adapters/csv-parse.js';
import { fileRepository, type FileRow } from '../../infrastructure/repositories/file-repository.js';

export const filesRouter = Router();

function requireWorkspace(req: Request): string {
  if (!req.workspaceId) throw new AppError(500, '工作区中间件未装配');
  return req.workspaceId;
}

/** 存储行 → uploadedFileSchema 契约（元数据视图，不含原文） */
function toRecord(row: FileRow): UploadedFile {
  return uploadedFileSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    filename: row.filename,
    columns: row.columns,
    rowCount: row.row_count,
    createdAt: row.created_at.toISOString(),
  });
}

filesRouter.post('/', async (req, res) => {
  const workspaceId = requireWorkspace(req);

  const content = typeof req.body === 'string' ? req.body : '';
  if (content.trim() === '') throw new ValidationError('请求体须为 CSV 原文');

  const rawFilename = String(req.headers['x-filename'] ?? '').trim();
  // 前端对文件名做 encodeURIComponent（HTTP 头仅允许 ASCII）；解码失败时保留原值
  let filename = 'upload.csv';
  if (rawFilename !== '') {
    try {
      filename = decodeURIComponent(rawFilename);
    } catch {
      filename = rawFilename;
    }
  }

  const headers = extractHeaders(content);
  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw new ValidationError('CSV 缺少表头行');
  }
  if (new Set(headers).size !== headers.length) {
    throw new ValidationError('CSV 表头列名重复');
  }

  const rowCount = parseCsv(content).length - 1;
  if (rowCount < 1) throw new ValidationError('CSV 至少需要一行数据');

  const row = await fileRepository.insert({
    id: randomUUID(),
    workspaceId,
    filename,
    columns: headers,
    rowCount,
    content,
  });
  res.status(201).json(toRecord(row));
});

filesRouter.get('/', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  const rows = await fileRepository.listByWorkspace(workspaceId);
  res.json({ items: rows.map(toRecord) });
});

filesRouter.get('/:id', async (req, res) => {
  const workspaceId = requireWorkspace(req);
  assertUuidParam(req.params.id);
  const row = await fileRepository.findByIdScoped(req.params.id, workspaceId);
  if (!row) throw new NotFoundError('文件不存在');
  res.json({ ...toRecord(row), content: row.content });
});
