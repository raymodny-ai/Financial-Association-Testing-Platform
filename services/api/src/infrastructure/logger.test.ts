/**
 * T18 结构化日志 RED 测试。
 * 定案：不引入 pino/winston（ADR 001 极简依赖；logging-generator 技能需外部密钥，弃用），
 * 自实现最小 JSON 行日志器 + 请求日志中间件；生产 JSON、开发可读。
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';
import { createApp } from '../app.js';

describe('createLogger', () => {
  it('输出 JSON 行：time/level/msg 与扩展字段', () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    logger.info('服务启动', { port: 8787 });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('服务启动');
    expect(entry.port).toBe(8787);
    expect(typeof entry.time).toBe('string');
    expect(Number.isNaN(Date.parse(entry.time as string))).toBe(false);
  });

  it('error 级别携带错误堆栈摘要', () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    logger.error('执行失败', { err: new Error('boom') });
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.level).toBe('error');
    const err = entry.err as { message: string };
    expect(err.message).toBe('boom');
  });
});

describe('请求日志中间件', () => {
  it('请求完成后记录 method/path/status/durationMs/requestId，且不记录 Cookie', async () => {
    const lines: string[] = [];
    const app = createApp({ logger: createLogger((line) => lines.push(line)) });
    await request(app).get('/api/health').set('Cookie', 'fap_workspace=secret-value');
    const logs = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const reqLog = logs.find((l) => l.msg === 'http');
    expect(reqLog).toBeDefined();
    expect(reqLog?.method).toBe('GET');
    expect(reqLog?.path).toBe('/api/health');
    expect(reqLog?.status).toBe(200);
    expect(typeof reqLog?.durationMs).toBe('number');
    expect(reqLog?.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(lines.join()).not.toContain('secret-value');
  });

  it('未注入 logger 时静默（不抛错）', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
