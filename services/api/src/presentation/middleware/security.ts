/**
 * T18 API 安全基线中间件：
 * - requestIdMiddleware：x-request-id 生成/透传（链路追踪）
 * - rateLimiter：固定窗口限流（按 req.ip，内存计数；MVP 单实例够用，多实例待 T20+ 换 Redis）
 * - corsMiddleware：Origin 白名单 + 凭据（Cookie）支持；未配置一律同源
 * - requestLogger：请求完成日志（method/path/status/durationMs/requestId；不落 Cookie）
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError, NotFoundError } from '@platform/shared';
import type { Logger } from '../../infrastructure/logger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 由 requestIdMiddleware 注入 */
      requestId?: string;
    }
  }
}

/** 入站 x-request-id 合法则复用，否则新生成；响应头回写 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = String(req.headers['x-request-id'] ?? '');
  const id = UUID_PATTERN.test(inbound) ? inbound : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

/** 路径参数非合法 UUID 时视同不存在（防注入/防畸形输入直达数据库层） */
export function assertUuidParam(id: string): void {
  if (!UUID_PATTERN.test(id)) throw new NotFoundError('资源不存在');
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/** 固定窗口限流：窗口内超过 max 次 → 429 + Retry-After */
export function rateLimiter({ windowMs, max }: RateLimitOptions) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      next(new AppError(429, '请求过于频繁，请稍后再试'));
      return;
    }
    next();
  };
}

/**
 * Origin 白名单 CORS：
 * - 命中：回显 Origin + credentials（httpOnly 工作区 Cookie 跨域必需）+ Vary
 * - 预检 OPTIONS：204 + 方法/头清单
 * - 未命中或未配置：不加任何允许头（浏览器同源策略兜底）
 */
export function corsMiddleware(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-filename,x-request-id');
        res.setHeader('Access-Control-Max-Age', '600');
        res.status(204).end();
        return;
      }
    }
    next();
  };
}

/** 请求完成日志；未注入 logger 时静默直通 */
export function requestLogger(logger?: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!logger) {
      next();
      return;
    }
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      logger.info('http', {
        method: req.method,
        // 顶层中间件内 req.path 会丢失挂载前缀，一律记 originalUrl（去掉查询串）
        path: (req.originalUrl ?? req.path).split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        requestId: req.requestId,
      });
    });
    next();
  };
}
