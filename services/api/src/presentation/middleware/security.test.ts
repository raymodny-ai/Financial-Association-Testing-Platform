/**
 * T18 API 安全基线 RED 测试：
 * 安全头（helmet）/ 固定窗口限流 / CORS 白名单 / 请求体错误映射 /
 * 请求 ID 透传 / 非法 UUID 防注入 404。
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';

describe('T18 安全头（helmet）', () => {
  const app = createApp();

  it('响应携带关键安全头', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['referrer-policy']).toBeDefined();
  });
});

describe('T18 固定窗口限流', () => {
  it('窗口内超过限额返回 429 与 Retry-After', async () => {
    const app = createApp({ rateLimit: { windowMs: 60_000, max: 3 } });
    for (let i = 0; i < 3; i += 1) {
      const ok = await request(app).get('/api/health');
      expect(ok.status).toBe(200);
    }
    const limited = await request(app).get('/api/health');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('AppError');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('默认限额不影响常规集成测试量级（连续 20 次仍通过）', async () => {
    const app = createApp();
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    }
  });
});

describe('T18 CORS 白名单', () => {
  const allowed = ['http://web.example.com'];

  it('白名单 Origin 获得允许头且携带凭据标记', async () => {
    const app = createApp({ cors: { allowedOrigins: allowed } });
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://web.example.com');
    expect(res.headers['access-control-allow-origin']).toBe('http://web.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['vary']).toContain('Origin');
  });

  it('预检请求返回 204 与方法/头清单', async () => {
    const app = createApp({ cors: { allowedOrigins: allowed } });
    const res = await request(app)
      .options('/api/tasks')
      .set('Origin', 'http://web.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('x-filename');
  });

  it('非白名单 Origin 不返回允许头', async () => {
    const app = createApp({ cors: { allowedOrigins: allowed } });
    const res = await request(app).get('/api/health').set('Origin', 'http://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('未配置 CORS 时一律不返回允许头（默认同源）', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health').set('Origin', 'http://web.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('T18 请求体错误映射', () => {
  it('非法 JSON 返回 400 而非 500', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{broken');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBeDefined();
  });

  it('超过请求体大小限制返回 413', async () => {
    const app = createApp({ bodyLimit: '1kb' });
    const res = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(4096) }));
    expect(res.status).toBe(413);
    expect(res.body.error).toBeDefined();
  });
});

describe('T18 请求 ID 透传', () => {
  it('响应回写生成的请求 ID', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('入站 x-request-id 被复用（链路追踪）', async () => {
    const app = createApp();
    const inbound = '11111111-2222-3333-4444-555555555555';
    const res = await request(app).get('/api/health').set('x-request-id', inbound);
    expect(res.headers['x-request-id']).toBe(inbound);
  });
});

describe('T18 非法 UUID 防护', () => {
  const app = createApp();

  it('GET /api/tasks/:id 非法 UUID 返回 404 而非 500', async () => {
    const res = await request(app).get('/api/tasks/not-a-uuid');
    expect(res.status).toBe(404);
  });

  it('GET /api/files/:id 非法 UUID 返回 404 而非 500', async () => {
    const res = await request(app).get('/api/files/; DROP TABLE tasks;');
    expect(res.status).toBe(404);
  });
});
