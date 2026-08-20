/**
 * G5 决策落地：MVP 匿名工作区。
 * 无登录体系，由服务端签发 httpOnly Cookie（fap_workspace，UUID，SameSite=Lax）
 * 标识匿名工作区；任务全部挂 workspace_id，查询强制归属过滤以防枚举。
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const WORKSPACE_COOKIE = 'fap_workspace';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 由 workspaceMiddleware 注入的匿名工作区 id */
      workspaceId?: string;
    }
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

export function workspaceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = parseCookies(req.headers.cookie)[WORKSPACE_COOKIE];
  if (existing && UUID_PATTERN.test(existing)) {
    req.workspaceId = existing;
    next();
    return;
  }
  const id = randomUUID();
  res.cookie(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    // 生产（HTTPS）强制 Secure；本地开发 http 不设以免 Cookie 被浏览器丢弃
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_MS,
  });
  req.workspaceId = id;
  next();
}
