/**
 * T17 验收：任务运行编排端到端（集成测试，依赖本地 PostgreSQL）。
 * POST /api/tasks/:id/run → 全链路分析 → GET /api/tasks/:id/results。
 * 使用测试内注册的 mock provider（不触外部行情源）；LLM 密钥 stub 空 → skipped 降级。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { pool } from '../../infrastructure/db.js';
import { runMigrations } from '../../infrastructure/migrate.js';
import { registerProvider } from '../../domain/provider-registry.js';
import type { DataProvider, HistoryPanel, PanelPoint } from '../../domain/data-provider.js';
import { WORKSPACE_COOKIE } from '../middleware/workspace.js';

/** 确定性面板：工作日、温和波动（与 analysis-runner.test 同构造） */
function makePanel(ticker: string, seed: number): HistoryPanel {
  const points: PanelPoint[] = [];
  const start = new Date('2024-01-01T00:00:00Z');
  let price = 100;
  for (let i = 0; i < 366; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    const r = Math.sin(i * (seed + 2) * 0.7) * 1.5 + Math.sin(i * 0.13);
    price = Math.max(1, price * (1 + r / 100));
    points.push({
      date: d.toISOString().slice(0, 10),
      open: null,
      high: null,
      low: null,
      close: price,
      volume: null,
    });
  }
  return {
    ticker,
    frequency: 'daily',
    points,
    source: 'mock',
    source_version: '1',
    fetched_at: '2026-01-01T00:00:00Z',
  };
}

const mockProvider: DataProvider = {
  name: 'mock',
  async fetchHistory(ticker) {
    return makePanel(ticker, ticker.length);
  },
};

const runConfig = {
  projectName: 'T17 运行冒烟',
  dataSources: [
    { kind: 'ticker', alias: 'A', ticker: 'AAA', provider: 'mock' },
    { kind: 'ticker', alias: 'B', ticker: 'BBB', provider: 'mock' },
  ],
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  periods: {
    referenceStart: '2024-01-01',
    referenceEnd: '2024-06-30',
    testStart: '2024-07-01',
    testEnd: '2024-12-31',
  },
  // 集成测试提速：关闭滚动窗口；显式关闭滞后扫描（schema 默认 maxLag=10 会改变结果行数基线）
  rolling: { enabled: false },
  maxLag: 0,
};

function cookieOf(res: request.Response): string {
  const headers = res.headers['set-cookie'];
  const list = Array.isArray(headers) ? headers : headers ? [headers] : [];
  return list.find((c) => c.startsWith(`${WORKSPACE_COOKIE}=`))!.split(';')[0]!;
}

beforeAll(async () => {
  // 防止测试环境意外携带真实密钥触发网络调用
  vi.stubEnv('DASHSCOPE_API_KEY', '');
  vi.stubEnv('DEEPSEEK_API_KEY', '');
  registerProvider(mockProvider);
  await runMigrations(pool);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.end();
});

describe('POST /api/tasks/:id/run + GET results', () => {
  it('全链路：completed → 结果 4 行（1 分类 + 3 连续）+ 审计 2 行 + LLM skipped', async () => {
    const app = createApp();
    const created = await request(app).post('/api/tasks').send(runConfig);
    expect(created.status).toBe(201);
    const cookie = cookieOf(created);
    const taskId = created.body.id as string;

    const run = await request(app)
      .post(`/api/tasks/${taskId}/run`)
      .set('Cookie', cookie);
    expect(run.status).toBe(200);
    expect(run.body.status).toBe('completed');
    expect(run.body.resultCount).toBe(4);
    expect(run.body.auditCount).toBe(2);
    expect(run.body.llmStatus).toBe('skipped');

    const results = await request(app)
      .get(`/api/tasks/${taskId}/results`)
      .set('Cookie', cookie);
    expect(results.status).toBe(200);
    expect(results.body.task.status).toBe('completed');
    expect(results.body.results).toHaveLength(4);
    const families = results.body.results.map((r: { test_family: string }) => r.test_family).sort();
    expect(families).toEqual(['categorical', 'continuous', 'continuous', 'continuous']);
    for (const r of results.body.results) {
      expect(r.window_end).toBeNull();
      expect(r.p_value_adjusted).toBeGreaterThanOrEqual(r.p_value_raw - 1e-12);
    }
    expect(results.body.audit.map((a: { series_alias: string }) => a.series_alias)).toEqual(['A', 'B']);
    expect(results.body.llm.trace.status).toBe('skipped');
    expect(results.body.llm.context.research_question).toContain('T17 运行冒烟');
    expect(results.body.llm.output).toBeNull();
    // 导出面板快照（G4）：01/04/05 底座随结果返回且维度自洽
    const panel = results.body.panel;
    expect(panel.aliases.sort()).toEqual(['A', 'B']);
    expect(panel.dates.length).toBeGreaterThan(0);
    expect(panel.prices).toHaveLength(2);
    expect(panel.categories).toHaveLength(2);
    expect(panel.thresholds.A.thresholds.length).toBeGreaterThan(0);
  }, 30_000);

  it('重跑幂等：替换旧结果而非追加', async () => {
    const app = createApp();
    const created = await request(app).post('/api/tasks').send(runConfig);
    const cookie = cookieOf(created);
    const taskId = created.body.id as string;

    await request(app).post(`/api/tasks/${taskId}/run`).set('Cookie', cookie);
    await request(app).post(`/api/tasks/${taskId}/run`).set('Cookie', cookie);

    const results = await request(app)
      .get(`/api/tasks/${taskId}/results`)
      .set('Cookie', cookie);
    expect(results.body.results).toHaveLength(4);
    expect(results.body.audit).toHaveLength(2);
  }, 60_000);

  it('未知任务运行返回 404（G5 归属作用域）', async () => {
    const app = createApp();
    const created = await request(app).post('/api/tasks').send(runConfig);
    const cookie = cookieOf(created);
    const res = await request(app)
      .post('/api/tasks/00000000-0000-0000-0000-0000000000ff/run')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});
