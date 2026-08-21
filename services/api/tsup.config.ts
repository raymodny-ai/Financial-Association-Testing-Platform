/**
 * T20 生产打包（解决 N2：生产不再依赖 tsx）。
 * - 三入口：index.ts（服务）+ infrastructure/migrate.ts（启动前迁移 CLI）
 *   + infrastructure/rolling-worker.ts（P1 滚动窗口 worker 线程入口）
 * - @platform/* 工作区包以 TS 源码导出，必须内联打包（noExternal）
 * - express/pg/helmet/zod 等 npm 依赖保持 external（Render 侧 pnpm 安装）
 * - prompts/ 与 infra/db/migrations 为运行时资产，路径经向上寻路解析（见
 *   prompt-assets.ts / migrate.ts），无需打包进 bundle
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/infrastructure/migrate.ts', 'src/infrastructure/rolling-worker.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  clean: true,
  noExternal: [/^@platform\//],
});
