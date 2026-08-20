/**
 * T07 验收：任务创建/查询链路 + 匿名工作区归属（集成测试，依赖本地 PostgreSQL）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { pool } from '../../infrastructure/db.js';
import { runMigrations } from '../../infrastructure/migrate.js';
import { WORKSPACE_COOKIE } from '../middleware/workspace.js';

/** 满足 taskConfigSchema 三条 refine 的最小合法配置 */
const validConfig = {
  projectName: 'T07 冒烟任务',
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

/** 从响应中提取 fap_workspace Cookie 串（`name=value` 形式，可直接回传） */
function extractWorkspaceCookie(res: request.Response): string {
  const headers = res.headers['set-cookie'];
  const list = Array.isArray(headers) ? headers : headers ? [headers] : [];
  const cookie = list.find((c) => c.startsWith(`${WORKSPACE_COOKIE}=`));
  expect(cookie, '响应应签发 fap_workspace Cookie').toBeDefined();
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  return cookie!.split(';')[0]!;
}

beforeAll(async () => {
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/tasks', () => {
  it('创建任务：201 + 服务端工作区归属 + queued 状态', async () => {
    const app = createApp();
    const res = await request(app).post('/api/tasks').send(validConfig);
    expect(res.status).toBe(201);

    const cookie = extractWorkspaceCookie(res);
    const workspaceId = cookie.split('=')[1];
    // G5：归属以服务端签发 Cookie 为准，客户端未自报 workspaceId
    expect(res.body.workspaceId).toBe(workspaceId);
    expect(res.body.status).toBe('queued');
    expect(res.body.config.projectName).toBe('T07 冒烟任务');
    expect(res.body.config.tests.alpha).toBe(0.05); // 契约默认值填充
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('非法配置返回 400（dataSources 少于 2 个）', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/tasks')
      .send({ ...validConfig, dataSources: [validConfig.dataSources[0]] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/tasks（工作区归属）', () => {
  it('同工作区可见、跨工作区不可见（防枚举返回 404）', async () => {
    const app = createApp();

    // 工作区 A 创建任务
    const created = await request(app).post('/api/tasks').send(validConfig);
    expect(created.status).toBe(201);
    const cookieA = extractWorkspaceCookie(created);
    const taskId = created.body.id as string;

    // 同 Cookie 列表可见
    const list = await request(app).get('/api/tasks').set('Cookie', cookieA);
    expect(list.status).toBe(200);
    expect(list.body.items.some((t: { id: string }) => t.id === taskId)).toBe(true);

    // 同 Cookie 单查可见
    const single = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Cookie', cookieA);
    expect(single.status).toBe(200);

    // 工作区 B（新会话）单查该任务 → 404，列表不含
    const stranger = await request(app).get('/api/tasks');
    const cookieB = extractWorkspaceCookie(stranger);
    expect(cookieB).not.toBe(cookieA);

    const crossSingle = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Cookie', cookieB);
    expect(crossSingle.status).toBe(404);

    const crossList = await request(app).get('/api/tasks').set('Cookie', cookieB);
    expect(crossList.body.items.some((t: { id: string }) => t.id === taskId)).toBe(false);
  });
});
