/**
 * T19 验收：审计注入集成测试。
 * 通过受污染的 mock 面板与受污染 CSV 验证：
 * 1. 缺失率 ≥10% 的序列 → audit_status=fail（PRD 数据真实性审计）
 * 2. 单日跳点 ≥20% 的序列 → audit_status=warn + jump_count ≥1
 * 3. 审计结论传导至 LLM 上下文：audit_key_findings 高风险文案 +
 *    global_confidence_flags 置信降级/警告旗标（PRD 安全约束）
 * 4. CSV 上传链路同样接受审计（上传源与 ticker 源同等待遇）
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { pool } from '../../infrastructure/db.js';
import { runMigrations } from '../../infrastructure/migrate.js';
import { registerProvider } from '../../domain/provider-registry.js';
import type { DataProvider, HistoryPanel, PanelPoint } from '../../domain/data-provider.js';
import { WORKSPACE_COOKIE } from '../middleware/workspace.js';

/** 确定性价格序列（工作日）；missingEvery：每 N 点注入一个 null；jumpAt：在该索引注入 +30% 跳点 */
function makeContaminatedPanel(
  ticker: string,
  opts: { missingEvery?: number; jumpAt?: number },
): HistoryPanel {
  const points: PanelPoint[] = [];
  const start = new Date('2024-01-01T00:00:00Z');
  let price = 100;
  let idx = 0;
  for (let i = 0; i < 366; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    const r = Math.sin(idx * 0.9) * 1.2 + Math.sin(idx * 0.21) * 0.8;
    price = Math.max(1, price * (1 + r / 100));
    if (opts.jumpAt === idx) price *= 1.3; // +30% 单日跳点（阈值 20%）
    const missing = opts.missingEvery !== undefined && idx % opts.missingEvery === 0;
    points.push({
      date: d.toISOString().slice(0, 10),
      open: null,
      high: null,
      low: null,
      close: missing ? null : price,
      volume: null,
    });
    idx += 1;
  }
  return {
    ticker,
    frequency: 'daily',
    points,
    source: 'mock-dirty',
    source_version: '1',
    fetched_at: '2026-01-01T00:00:00Z',
  };
}

const contaminatedProvider: DataProvider = {
  name: 'contaminated',
  async fetchHistory(ticker) {
    if (ticker === 'MISSY') return makeContaminatedPanel(ticker, { missingEvery: 5 }); // 20% 缺失 → fail
    return makeContaminatedPanel(ticker, { jumpAt: 40 }); // 单点 +30% → warn
  },
};

const baseConfig = {
  projectName: 'T19 审计注入',
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  periods: {
    referenceStart: '2024-01-01',
    referenceEnd: '2024-06-30',
    testStart: '2024-07-01',
    testEnd: '2024-12-31',
  },
  rolling: { enabled: false },
};

function cookieOf(res: request.Response): string {
  const headers = res.headers['set-cookie'];
  const list = Array.isArray(headers) ? headers : headers ? [headers] : [];
  return list.find((c) => c.startsWith(`${WORKSPACE_COOKIE}=`))!.split(';')[0]!;
}

beforeAll(async () => {
  vi.stubEnv('DASHSCOPE_API_KEY', '');
  vi.stubEnv('DEEPSEEK_API_KEY', '');
  registerProvider(contaminatedProvider);
  await runMigrations(pool);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.end();
});

describe('审计注入：ticker 源', () => {
  it('20% 缺失 → fail；+30% 跳点 → warn；LLM 上下文承接安全约束', async () => {
    const app = createApp();
    const created = await request(app)
      .post('/api/tasks')
      .send({
        ...baseConfig,
        dataSources: [
          { kind: 'ticker', alias: 'MISSY', ticker: 'MISSY', provider: 'contaminated' },
          { kind: 'ticker', alias: 'JUMPY', ticker: 'JUMPY', provider: 'contaminated' },
        ],
      });
    expect(created.status).toBe(201);
    const cookie = cookieOf(created);
    const taskId = created.body.id as string;

    const run = await request(app)
      .post(`/api/tasks/${taskId}/run`)
      .set('Cookie', cookie);
    expect(run.status).toBe(200);
    expect(run.body.status).toBe('completed');

    const results = await request(app)
      .get(`/api/tasks/${taskId}/results`)
      .set('Cookie', cookie);
    expect(results.status).toBe(200);

    const audit = results.body.audit as Array<Record<string, unknown>>;
    const missy = audit.find((a) => a.series_alias === 'MISSY')!;
    const jumpy = audit.find((a) => a.series_alias === 'JUMPY')!;

    // 缺失率 20% ≥ fail 阈值 10%
    expect(missy.audit_status).toBe('fail');
    expect(missy.missing_value_count as number).toBeGreaterThan(40);
    // 单点 +30% ≥ 跳点阈值 20%
    expect(jumpy.audit_status).toBe('warn');
    expect(jumpy.jump_count as number).toBeGreaterThanOrEqual(1);
    expect(jumpy.max_abs_return_pct as number).toBeGreaterThanOrEqual(20);

    // 审计结论传导至 LLM 上下文（PRD 安全约束注入）
    const context = results.body.llm.context as Record<string, unknown>;
    expect(context.audit_key_findings as string).toContain('审计高风险（fail）序列：MISSY');
    expect(context.audit_key_findings as string).toContain('MISSY：fail');
    expect(context.audit_key_findings as string).toContain('JUMPY：warn');
    const flags = context.global_confidence_flags as string[];
    expect(flags.some((f) => f.includes('MISSY') && f.includes('置信度必须下调'))).toBe(true);
    expect(flags.some((f) => f.includes('JUMPY') && f.includes('审计警告'))).toBe(true);
  }, 30_000);
});

describe('审计注入：CSV 上传链路', () => {
  it('上传源与 ticker 源同等待遇：缺失单元格计入审计', async () => {
    const app = createApp();
    // 构造 ~260 行工作日 CSV，每 5 行 close 为 NA（NaN → null → 缺失 20% → fail）
    const lines = ['date,close'];
    const start = new Date('2024-01-01T00:00:00Z');
    let price = 100;
    let idx = 0;
    for (let i = 0; i < 366; i += 1) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const day = d.getUTCDay();
      if (day === 0 || day === 6) continue;
      price = Math.max(1, price * (1 + Math.sin(idx * 0.7) / 100));
      const close = idx % 5 === 0 ? 'NA' : price.toFixed(4);
      lines.push(`${d.toISOString().slice(0, 10)},${close}`);
      idx += 1;
    }
    const uploaded = await request(app)
      .post('/api/files')
      .set('Content-Type', 'text/csv')
      .set('x-filename', 'contaminated.csv')
      .send(lines.join('\n'));
    expect(uploaded.status).toBe(201);
    // G5：全程复用同一匿名工作区 Cookie，否则文件与任务分属不同工作区 → 404
    const cookie = cookieOf(uploaded);
    const fileId = uploaded.body.id as string;

    const created = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({
        ...baseConfig,
        projectName: 'T19 上传审计注入',
        dataSources: [
          {
            kind: 'upload',
            alias: 'UP',
            fileId,
            columnMapping: { date_col: 'date', close_col: 'close' },
          },
          { kind: 'ticker', alias: 'JUMPY', ticker: 'JUMPY', provider: 'contaminated' },
        ],
      });
    expect(created.status).toBe(201);
    const taskId = created.body.id as string;

    const run = await request(app)
      .post(`/api/tasks/${taskId}/run`)
      .set('Cookie', cookie);
    expect(run.status).toBe(200);
    expect(run.body.status).toBe('completed');

    const results = await request(app)
      .get(`/api/tasks/${taskId}/results`)
      .set('Cookie', cookie);
    const audit = results.body.audit as Array<Record<string, unknown>>;
    const up = audit.find((a) => a.series_alias === 'UP')!;
    expect(up.audit_status).toBe('fail');
    expect(up.missing_value_count as number).toBeGreaterThan(40);
  }, 30_000);
});
