/**
 * 同源静态托管（T20 部署，呈现层）。
 *
 * 生产部署拓扑定案：web 产物（apps/web/dist）由本 API 服务同源托管，
 * 而非独立静态站——G5 匿名工作区 Cookie 为 SameSite=Lax，跨站部署会被
 * 浏览器按第三方 Cookie 拦截，同源是唯一稳妥方案（同时免除 CORS 配置）。
 *
 * WEB_DIST_DIR（相对 process.cwd() 或绝对路径）未设置 → 纯 API 模式，零影响。
 * 设置后：静态资源直出 + SPA 深链（/results/:id、/history）回退 index.html；
 * /api/* 永不回退，保持 API 语义（未知路径仍 404）。
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import express from 'express';
import type { Express } from 'express';

export function mountWebStatic(app: Express, distDir?: string): void {
  const dir = distDir ?? process.env.WEB_DIST_DIR;
  if (dir === undefined || dir === '') return;
  const root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);

  app.use(express.static(root));
  // SPA 回退：除 /api 外的 GET 一律返回 index.html（路由由前端接管）
  app.get(/^\/(?!api(?:\/|$)).*/, (req, res, next) => {
    const indexFile = join(root, 'index.html');
    if (!existsSync(indexFile)) {
      next();
      return;
    }
    res.sendFile(indexFile, (error) => {
      if (error) next(error);
    });
  });
}
