import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('api_gateway 骨架', () => {
  const app = createApp();

  it('GET /api/health 返回 200 与服务状态', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('@platform/api');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('未知路由返回 404', async () => {
    const res = await request(app).get('/api/not-exists');
    expect(res.status).toBe(404);
  });
});
