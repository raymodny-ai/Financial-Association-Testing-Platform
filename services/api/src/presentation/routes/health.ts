import { Router } from 'express';

/**
 * 健康检查（Render 部署验证与探针用）。
 * GET /api/health → { status: 'ok', service, timestamp }
 */
export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: '@platform/api',
    timestamp: new Date().toISOString(),
  });
});
