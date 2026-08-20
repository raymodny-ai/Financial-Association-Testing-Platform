/**
 * G6 验收：分析模板保存/列表/删除 + 匿名工作区归属（集成测试，依赖本地 PostgreSQL）。
 * PRD 配置设计：「保存模板」「复制分析」「重新运行同配置」的持久化底座。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { pool } from '../../infrastructure/db.js';
import { runMigrations } from '../../infrastructure/migrate.js';
import { WORKSPACE_COOKIE } from '../middleware/workspace.js';

/** 满足 taskConfigSchema 三条 refine 的最小合法配置（与 tasks.test.ts 同口径） */
const validConfig = {
  projectName: 'G6 模板冒烟',
  dataSources: [
    { kind: 'ticker', alias: 'SPX', ticker: '^spx', provider: 'stooq' },
    { kind: 'ticker', alias: 'GOLD', ticker: 'xauusd', provider: 'stooq' },
  ],
  startDate: '2024-01-01',
  endDate: '2025-12-31',
  periods: {
    referenceStart: '2024-01-01',
    referenceEnd: '2024-12-31',
    testStart: '2025-01-01',
    testEnd: '2025-12-31',
  },
};

function extractWorkspaceCookie(res: request.Response): string {
  const headers = res.headers['set-cookie'];
  const list = Array.isArray(headers) ? headers : headers ? [headers] : [];
  const cookie = list.find((c) => c.startsWith(`${WORKSPACE_COOKIE}=`));
  expect(cookie, '响应应签发 fap_workspace Cookie').toBeDefined();
  return cookie!.split(';')[0]!;
}

beforeAll(async () => {
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/templates', () => {
  it('保存模板：201 + 服务端工作区归属 + 契约默认值填充', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/templates')
      .send({ name: '股金对冲基线', config: validConfig });
    expect(res.status).toBe(201);

    const cookie = extractWorkspaceCookie(res);
    expect(res.body.workspaceId).toBe(cookie.split('=')[1]);
    expect(res.body.name).toBe('股金对冲基线');
    expect(res.body.config.tests.alpha).toBe(0.05);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('非法请求 400（name 为空 / config 不合法）', async () => {
    const app = createApp();
    expect((await request(app).post('/api/templates').send({ name: '', config: validConfig })).status).toBe(400);
    expect(
      (await request(app).post('/api/templates').send({ name: 'x', config: { ...validConfig, dataSources: [] } })).status,
    ).toBe(400);
  });
});

describe('GET/DELETE /api/templates（工作区归属）', () => {
  it('同工作区可见可删、跨工作区 404', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/api/templates')
      .send({ name: '归属验证', config: validConfig });
    expect(created.status).toBe(201);
    const cookieA = extractWorkspaceCookie(created);
    const templateId = created.body.id as string;

    const list = await request(app).get('/api/templates').set('Cookie', cookieA);
    expect(list.status).toBe(200);
    expect(list.body.items.some((t: { id: string }) => t.id === templateId)).toBe(true);

    // 工作区 B：列表不含、删除视同不存在
    const stranger = await request(app).get('/api/templates');
    const cookieB = extractWorkspaceCookie(stranger);
    const crossList = await request(app).get('/api/templates').set('Cookie', cookieB);
    expect(crossList.body.items.some((t: { id: string }) => t.id === templateId)).toBe(false);
    expect((await request(app).delete(`/api/templates/${templateId}`).set('Cookie', cookieB)).status).toBe(404);

    // 工作区 A 删除成功，列表不再包含
    expect((await request(app).delete(`/api/templates/${templateId}`).set('Cookie', cookieA)).status).toBe(204);
    const afterDelete = await request(app).get('/api/templates').set('Cookie', cookieA);
    expect(afterDelete.body.items.some((t: { id: string }) => t.id === templateId)).toBe(false);
  });
});
