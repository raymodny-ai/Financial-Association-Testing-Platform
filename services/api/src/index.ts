/**
 * 服务入口。
 * Render 要求监听 0.0.0.0:$PORT；本地默认 8787（apps/web 开发代理目标）。
 * T18：安全基线环境变量装配（限流 / CORS 白名单）+ 结构化日志。
 */
import { createApp } from './app.js';
import { createLogger } from './infrastructure/logger.js';
import { taskRepository } from './infrastructure/repositories/task-repository.js';

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

app.listen(port, '0.0.0.0', async () => {
  logger.info('listening', { host: '0.0.0.0', port });
  // P2 启动清扫：上次运行被重启中断的任务置 failed（可重试），避免永久卡在 running；
  // 清扫失败仅记日志不阻塞服务启动（数据库不可用时请求链路自然报错）
  try {
    const recovered = await taskRepository.recoverInterrupted();
    if (recovered > 0) logger.info('recovered-interrupted-tasks', { count: recovered });
  } catch (error) {
    logger.error('recover-interrupted-tasks-failed', { error: error as Error });
  }
});
