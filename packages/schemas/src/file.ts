/**
 * @platform/schemas · 上传文件契约
 *
 * CSV 上传（MVP 并列第一入口，ADR 001）的元数据契约。
 * 前端据此渲染列映射 UI（dataSource.columnMapping 引用 columns 中的列名）。
 * 文件原文不进入该契约，由 api 存储层按 id 作用域管理。
 */
import { z } from 'zod';
import { dateTimeSchema, idSchema } from './common';

export const uploadedFileSchema = z.object({
  id: idSchema,
  /** 归属工作区（G5：匿名工作区 id） */
  workspaceId: idSchema,
  /** 原始文件名（仅展示用） */
  filename: z.string().min(1).max(255),
  /** 表头列名（有序，供列映射下拉选择） */
  columns: z.array(z.string().min(1)).min(1),
  /** 数据行数（不含表头） */
  rowCount: z.number().int().min(1),
  createdAt: dateTimeSchema,
});
export type UploadedFile = z.infer<typeof uploadedFileSchema>;
