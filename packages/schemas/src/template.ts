/**
 * @platform/schemas · 分析模板契约（G6，PRD「配置设计」）
 *
 * PRD：用户侧表现为「保存模板」「复制分析」「重新运行同配置」。
 * TaskConfig 即模板持久化单元；workspaceId 一律服务端注入（G5）。
 */
import { z } from 'zod';
import { idSchema } from './common';
import { taskConfigSchema } from './task';

/** 创建模板请求（POST /api/templates 入参；workspaceId 服务端注入） */
export const createTemplateRequestSchema = z.object({
  name: z.string().min(1).max(64),
  config: taskConfigSchema,
});
export type CreateTemplateRequest = z.infer<typeof createTemplateRequestSchema>;

/** 分析模板记录（存储层返回结构） */
export const analysisTemplateSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  name: z.string().min(1).max(64),
  config: taskConfigSchema,
  createdAt: z.string().datetime({ offset: true }),
});
export type AnalysisTemplate = z.infer<typeof analysisTemplateSchema>;
