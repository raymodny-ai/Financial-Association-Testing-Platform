/**
 * @platform/schemas · 研究批注契约（X4，PRD L140/L356）
 *
 * PRD 结果页右栏「研究注释、收藏、导出与分享」的批注持久化单元。
 * 收藏为任务本体旗标（taskRecordSchema.favorited）；分享链接为前端能力。
 */
import { z } from 'zod';
import { idSchema } from './common';

/** 批注记录（存储层返回结构） */
export const taskAnnotationSchema = z.object({
  id: idSchema,
  /** 宿主任务（批注随任务级联删除） */
  taskId: idSchema,
  content: z.string().min(1).max(2000),
  createdAt: z.string().datetime({ offset: true }),
});
export type TaskAnnotation = z.infer<typeof taskAnnotationSchema>;

/** 创建批注请求（POST /api/tasks/:id/annotations 入参） */
export const createAnnotationRequestSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});
export type CreateAnnotationRequest = z.infer<typeof createAnnotationRequestSchema>;

/** 收藏切换请求（PUT /api/tasks/:id/favorite 入参） */
export const setFavoriteRequestSchema = z.object({
  favorited: z.boolean(),
});
export type SetFavoriteRequest = z.infer<typeof setFavoriteRequestSchema>;
