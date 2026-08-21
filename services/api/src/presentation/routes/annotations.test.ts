/**
 * X4 验收：研究批注 / 收藏 / 分享底座（集成测试，依赖本地 PostgreSQL）。
 * PRD L140「结果保存、复制、下载与分享」、L356 结果页右栏「研究注释、收藏、导出与分享」。
 * 分享链接为前端能力（复制结果页 URL），此处覆盖批注与收藏的服务端契约。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { pool } from '../../infrastructure/db.js';
import { runMigrations } from '../../infrastructure/migrate.js';
import { WORKSPACE_COOKIE } from '../middleware/workspace.js';

/** 满足 taskConfigSchema 三条 refine 的最小合法配置（与 tasks.test.ts 同口径） */
const validConfig = {
  projectName: 'X4 批注冒烟',
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
  expect(cookie, '响应应签发工作区 Cookie').toBeDefined();
  return cookie!.split(';')[0]!;
}

/** 创建任务并返回归属 Cookie（批注/收藏均以任务为宿主） */
async function createTask(app: Express): Promise<{ taskId: string; cookie: string }> {
  const res = await request(app).post('/api/tasks').send(validConfig);
  expect(res.status).toBe(201);
  return { taskId: res.body.id as string, cookie: extractWorkspaceCookie(res) };
}

beforeAll(async () => {
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('研究批注 /api/tasks/:id/annotations（X4）', () => {
  it('POST 201 创建批注 + GET 列表可见（契约四字段）', async () => {
    const app = createApp();
    const { taskId, cookie } = await createTask(app);

    const created = await request(app)
      .post(`/api/tasks/${taskId}/annotations`)
      .set('Cookie', cookie)
      .send({ content: '黄金与标普在 2025Q1 出现背离，关注滞胀叙事' });
    expect(created.status).toBe(201);
    expect(created.body.taskId).toBe(taskId);
    expect(created.body.content).toBe('黄金与标普在 2025Q1 出现背离，关注滞胀叙事');
    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const list = await request(app)
      .get(`/api/tasks/${taskId}/annotations`)
      .set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((a: { id: string }) => a.id)).toContain(created.body.id);
  });

  it('DELETE 204 删除批注后列表为空；未知批注 404', async () => {
    const app = createApp();
    const { taskId, cookie } = await createTask(app);
    const created = await request(app)
      .post(`/api/tasks/${taskId}/annotations`)
      .set('Cookie', cookie)
      .send({ content: '待删除' });
    expect(created.status).toBe(201);

    const del = await request(app)
      .delete(`/api/tasks/${taskId}/annotations/${created.body.id}`)
      .set('Cookie', cookie);
    expect(del.status).toBe(204);

    const list = await request(app)
      .get(`/api/tasks/${taskId}/annotations`)
      .set('Cookie', cookie);
    expect(list.body.items).toEqual([]);

    const missing = await request(app)
      .delete(`/api/tasks/${taskId}/annotations/00000000-0000-4000-8000-0000000000ff`)
      .set('Cookie', cookie);
    expect(missing.status).toBe(404);
  });

  it('未知任务 404（POST 与 GET 同口径）', async () => {
    const app = createApp();
    const seed = await request(app).post('/api/tasks').send(validConfig);
    const cookie = extractWorkspaceCookie(seed);
    const ghost = '00000000-0000-4000-8000-0000000000ee';
    expect(
      (await request(app).post(`/api/tasks/${ghost}/annotations`).set('Cookie', cookie).send({ content: 'x' })).status,
    ).toBe(404);
    expect((await request(app).get(`/api/tasks/${ghost}/annotations`).set('Cookie', cookie)).status).toBe(404);
  });

  it('内容校验：空白或超长（>2000）拒绝 400', async () => {
    const app = createApp();
    const { taskId, cookie } = await createTask(app);
    expect(
      (await request(app).post(`/api/tasks/${taskId}/annotations`).set('Cookie', cookie).send({ content: '   ' })).status,
    ).toBe(400);
    expect(
      (await request(app)
        .post(`/api/tasks/${taskId}/annotations`)
        .set('Cookie', cookie)
        .send({ content: '批'.repeat(2001) })).status,
    ).toBe(400);
  });

  it('跨工作区隔离：他人任务上的批注操作视同 404', async () => {
    const app = createApp();
    const { taskId } = await createTask(app);
    // 另一浏览器会话 → 另一匿名工作区
    const other = await request(app).post('/api/tasks').send(validConfig);
    const otherCookie = extractWorkspaceCookie(other);
    expect(
      (await request(app).post(`/api/tasks/${taskId}/annotations`).set('Cookie', otherCookie).send({ content: '越权' })).status,
    ).toBe(404);
    expect((await request(app).get(`/api/tasks/${taskId}/annotations`).set('Cookie', otherCookie)).status).toBe(404);
  });
});

describe('收藏 /api/tasks/:id/favorite（X4）', () => {
  it('PUT 切换收藏 → 任务记录回显 favorited', async () => {
    const app = createApp();
    const { taskId, cookie } = await createTask(app);

    const before = await request(app).get(`/api/tasks/${taskId}`).set('Cookie', cookie);
    expect(before.body.favorited).toBe(false);

    const on = await request(app)
      .put(`/api/tasks/${taskId}/favorite`)
      .set('Cookie', cookie)
      .send({ favorited: true });
    expect(on.status).toBe(200);
    expect(on.body.favorited).toBe(true);

    const after = await request(app).get(`/api/tasks/${taskId}`).set('Cookie', cookie);
    expect(after.body.favorited).toBe(true);

    const off = await request(app)
      .put(`/api/tasks/${taskId}/favorite`)
      .set('Cookie', cookie)
      .send({ favorited: false });
    expect(off.body.favorited).toBe(false);
  });

  it('未知任务或跨工作区 → 404；非法入参 → 400', async () => {
    const app = createApp();
    const { taskId, cookie } = await createTask(app);
    const ghost = '00000000-0000-4000-8000-0000000000dd';
    expect(
      (await request(app).put(`/api/tasks/${ghost}/favorite`).set('Cookie', cookie).send({ favorited: true })).status,
    ).toBe(404);
    expect(
      (await request(app).put(`/api/tasks/${taskId}/favorite`).set('Cookie', cookie).send({ favorited: 'yes' })).status,
    ).toBe(400);
  });
});
