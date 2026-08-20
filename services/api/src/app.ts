import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { AppError } from '@platform/shared';
import type { Logger } from './infrastructure/logger.js';
import { healthRouter } from './presentation/routes/health.js';
import { tasksRouter } from './presentation/routes/tasks.js';
import { filesRouter } from './presentation/routes/files.js';
import { workspaceMiddleware } from './presentation/middleware/workspace.js';
import { errorHandler } from './presentation/middleware/error-handler.js';
import { mountWebStatic } from './presentation/static.js';
import {
  corsMiddleware,
  rateLimiter,
  requestLogger,
  requestIdMiddleware,
  type RateLimitOptions,
} from './presentation/middleware/security.js';
// 导入即触发数据适配器的插件式注册（ADR 001：yahoo 主力 / stooq 休眠）
import './infrastructure/adapters/yahoo-adapter.js';
import './infrastructure/adapters/stooq-adapter.js';

/** T18 安全基线装配选项（均可注入以便测试；缺省为生产安全默认值） */
export interface AppOptions {
  /** 固定窗口限流；缺省 300 次 / 60s（按 IP） */
  rateLimit?: RateLimitOptions;
  /** CORS Origin 白名单；未配置一律同源（开发经 Vite 代理，无需跨域） */
  cors?: { allowedOrigins: readonly string[] };
  /** 请求体大小上限；缺省 10mb */
  bodyLimit?: string;
  /** 结构化日志；未注入则静默 */
  logger?: Logger;
}

/**
 * api_gateway 应用工厂（Clean Architecture 呈现层装配）。
 * 与 index.ts 分离以便集成测试直接构造实例（无需监听端口）。
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  // 安全头基线（CSP 对纯 JSON API 无害，保留 helmet 默认集）
  app.use(helmet());
  app.use(requestIdMiddleware);
  if (options.cors) {
    app.use(corsMiddleware(options.cors.allowedOrigins));
  }

  const limit = options.bodyLimit ?? '10mb';
  app.use(express.json({ limit }));
  // CSV 上传：原文以纯文本提交（见 files 路由说明）
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit }));

  app.use(rateLimiter(options.rateLimit ?? { windowMs: 60_000, max: 300 }));
  app.use(requestLogger(options.logger));

  // G5：匿名工作区归属（httpOnly Cookie 签发 workspace_id）
  app.use('/api', workspaceMiddleware);

  app.use('/api/health', healthRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/files', filesRouter);

  // T20：同源托管 web 产物（WEB_DIST_DIR 未设置 → 纯 API 模式）
  mountWebStatic(app);

  // 统一错误出口：AppError 携带状态码，其余视为 500
  app.use(errorHandler);

  return app;
}

/** 供路由层复用的异步错误包装 */
export function failWith(statusCode: number, message: string): never {
  throw new AppError(statusCode, message);
}
