/**
 * @platform/schemas 包入口
 *
 * 跨包 Zod 契约的唯一来源：任务配置 / 结果长表 / 审计表 / LLM 上下文与输出。
 * 消费方一律 `import { ... } from '@platform/schemas'`，禁止各自重复定义。
 */
export * from './common';
export * from './task';
export * from './result';
export * from './audit';
export * from './llm';
export * from './file';
