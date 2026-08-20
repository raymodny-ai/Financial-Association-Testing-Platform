/**
 * T20 · 同源静态托管（RED 先行）。
 * 生产部署 web 产物由 API 服务同源托管（G5 匿名工作区 Cookie 为 SameSite=Lax，
 * 跨域静态站会丢失 Cookie，故不走独立静态站 + CORS 方案）。
 * WEB_DIST_DIR 未设置 → 纯 API 模式不受影响；设置 → 静态资源 + SPA 回退。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../infrastructure/db.js';
import { runMigrations } from '../infrastructure/migrate.js';

let distDir: string;

beforeAll(async () => {
  vi.stubEnv('DASHSCOPE_API_KEY', '');
  distDir = mkdtempSync(join(tmpdir(), 'fap-web-dist-'));
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>fap</title>');
  writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log(1);');
  await runMigrations(pool);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.end();
});

describe('同源静态托管', () => {
  it('WEB_DIST_DIR 未设置 → 纯 API 模式：GET / 返回 404', async () => {
    vi.stubEnv('WEB_DIST_DIR', '');
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(404);
  });

  it('设置 WEB_DIST_DIR → 根路径返回 index.html，静态资源可访问', async () => {
    vi.stubEnv('WEB_DIST_DIR', distDir);
    const app = createApp();
    const index = await request(app).get('/');
    expect(index.status).toBe(200);
    expect(index.text).toContain('<title>fap</title>');
    const asset = await request(app).get('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.text).toContain('console.log(1)');
  });

  it('SPA 深链回退：/results/:taskId 与 /history 返回 index.html；/api 不受影响', async () => {
    vi.stubEnv('WEB_DIST_DIR', distDir);
    const app = createApp();
    const deep = await request(app).get('/results/00000000-0000-0000-0000-000000000000');
    expect(deep.status).toBe(200);
    expect(deep.text).toContain('<title>fap</title>');
    const history = await request(app).get('/history');
    expect(history.status).toBe(200);
    expect(history.text).toContain('<title>fap</title>');
    // /api 路由保持原语义（health 200；未知任务 404 而非回退 HTML）
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    const unknown = await request(app).get('/api/tasks/00000000-0000-0000-0000-000000000000/results');
    expect(unknown.status).toBe(404);
  });
});
