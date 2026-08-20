/**
 * 服务入口。
 * Render 要求监听 0.0.0.0:$PORT；本地默认 8787（apps/web 开发代理目标）。
 * T18：安全基线环境变量装配（限流 / CORS 白名单）+ 结构化日志。
 */
import { createApp } from './app.js';
import { createLogger } from './infrastructure/logger.js';

const logger = createLogger();

/** CORS_ALLOWED_ORIGINS：逗号分隔白名单（生产前端独立部署时配置；缺省同源） */
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');

const port = Number(process.env.PORT ?? 8787);
const app = createApp({
  logger,
  cors: allowedOrigins.length > 0 ? { allowedOrigins } : undefined,
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
  },
});

app.listen(port, '0.0.0.0', () => {
  logger.info('listening', { host: '0.0.0.0', port });
});
