/**
 * T08 验收（CSV 入口）：上传/查询链路 + 工作区归属（集成测试，依赖本地 PostgreSQL）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { pool } from '../../infrastructure/db.js';
import { runMigrations } from '../../infrastructure/migrate.js';
import { WORKSPACE_COOKIE } from '../middleware/workspace.js';

const SAMPLE_CSV = ['Date,Close,Volume', '2024-01-02,100.5,1000', '2024-01-03,101.2,1200'].join('\n');

function extractWorkspaceCookie(res: request.Response): string {
  const headers = res.headers['set-cookie'];
  const list = Array.isArray(headers) ? headers : headers ? [headers] : [];
  const cookie = list.find((c) => c.startsWith(`${WORKSPACE_COOKIE}=`));
  expect(cookie).toBeDefined();
  return cookie!.split(';')[0]!;
}

beforeAll(async () => {
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/files', () => {
  it('上传 CSV：201 + 元数据契约（列名/行数）', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/files')
      .set('Content-Type', 'text/csv')
      .set('x-filename', 'my-series.csv')
      .send(SAMPLE_CSV);

    expect(res.status).toBe(201);
    expect(res.body.filename).toBe('my-series.csv');
    expect(res.body.columns).toEqual(['Date', 'Close', 'Volume']);
    expect(res.body.rowCount).toBe(2);
    expect(res.body.content).toBeUndefined(); // 元数据视图不含原文
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('缺表头 / 仅表头 / 空体均返回 400', async () => {
    const app = createApp();

    const empty = await request(app).post('/api/files').set('Content-Type', 'text/csv').send('');
    expect(empty.status).toBe(400);

    const headerOnly = await request(app)
      .post('/api/files')
      .set('Content-Type', 'text/csv')
      .send('Date,Close');
    expect(headerOnly.status).toBe(400);

    const dupHeader = await request(app)
      .post('/api/files')
      .set('Content-Type', 'text/csv')
      .send('Date,Date\n2024-01-01,1');
    expect(dupHeader.status).toBe(400);
  });
});

describe('GET /api/files（工作区归属）', () => {
  it('单查返回原文；跨工作区 404', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/api/files')
      .set('Content-Type', 'text/csv')
      .send(SAMPLE_CSV);
    expect(created.status).toBe(201);
    const cookieA = extractWorkspaceCookie(created);
    const fileId = created.body.id as string;

    // 列表含该文件
    const list = await request(app).get('/api/files').set('Cookie', cookieA);
    expect(list.status).toBe(200);
    expect(list.body.items.some((f: { id: string }) => f.id === fileId)).toBe(true);

    // 单查含原文
    const single = await request(app).get(`/api/files/${fileId}`).set('Cookie', cookieA);
    expect(single.status).toBe(200);
    expect(single.body.content).toBe(SAMPLE_CSV);

    // 新会话（工作区 B）跨查 → 404
    const cross = await request(app).get(`/api/files/${fileId}`);
    expect(cross.status).toBe(404);
  });
});
