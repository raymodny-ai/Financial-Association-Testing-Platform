import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@platform/shared';

/**
 * 统一错误中间件：
 * - AppError → 使用其 statusCode
 * - body-parser 错误（非法 JSON 400 / 超限 413，T18）→ 使用其 status，不泄露解析细节
 * - Zod 校验错误（T07 起路由入参校验）→ 400
 * - 其余 → 500，不向客户端泄露内部细节
 */

/** body-parser 抛出的错误携带 status 与 type（如 entity.parse.failed / entity.too.large） */
interface BodyParserError extends Error {
  status?: unknown;
  type?: unknown;
}

const BODY_ERROR_MESSAGES: Record<string, string> = {
  'entity.parse.failed': '请求体格式错误',
  'entity.too.large': '请求体超过大小限制',
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.name, message: err.message } });
    return;
  }
  const bodyError = err as BodyParserError;
  if (
    bodyError instanceof Error &&
    typeof bodyError.status === 'number' &&
    typeof bodyError.type === 'string' &&
    bodyError.type.startsWith('entity.')
  ) {
    const message = BODY_ERROR_MESSAGES[bodyError.type] ?? '请求体不合法';
    res.status(bodyError.status).json({ error: { code: 'ValidationError', message } });
    return;
  }
  if (err instanceof Error && err.name === 'ZodError') {
    res.status(400).json({ error: { code: 'ValidationError', message: err.message } });
    return;
  }
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: { code: 'InternalError', message: 'Internal server error' } });
}
