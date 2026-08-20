/**
 * T17 · 分析编排器 runAnalysis（RED 先行，依赖注入单测）。
 * 链路：数据加载（ticker/CSV 上传）→ prepareDataset → 卡方族 + 连续检验 + 校正
 * → 滚动窗口 → 审计 → buildLlmContext → LLM 推理（注入）。
 */
import type { LlmContext, TaskConfig } from '@platform/schemas';
import { describe, expect, it } from 'vitest';
import type { HistoryPanel, PanelPoint } from './data-provider.js';
import { runAnalysis, type RunnerDeps } from './analysis-runner.js';

/** 确定性伪随机面板（工作日、无缺失） */
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

const baseConfig: TaskConfig = {
  projectName: '编排冒烟',
  workspaceId: '00000000-0000-0000-0000-0000000000aa',
  dataSources: [
    { kind: 'ticker', alias: 'A', ticker: 'AAA', provider: 'mock' },
    { kind: 'ticker', alias: 'B', ticker: 'BBB', provider: 'mock' },
  ],
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  frequency: 'daily',
  derivedSeries: [],
  periods: {
    referenceStart: '2024-01-01',
    referenceEnd: '2024-06-30',
    testStart: '2024-07-01',
    testEnd: '2024-12-31',
  },
  binning: { method: 'quantile', bins: 3 },
  tests: { alpha: 0.05, correction: 'bh', permutations: 199, permutationSeed: 1 },
  rolling: { enabled: true, windowDays: 60, stepDays: 21 },
  maxLag: 0,
  audit: {
    missingRatioWarn: 0.02,
    missingRatioFail: 0.1,
    jumpAbsReturnPct: 20,
    sourceMatchRatioWarn: 0.98,
  },
  llmModel: 'qwen-plus',
  promptVersion: 'v1',
};

function fakeDeps(overrides?: Partial<RunnerDeps>): {
  deps: RunnerDeps;
  interpretCalls: Array<{ context: LlmContext; model: string; runId: string }>;
} {
  const interpretCalls: Array<{ context: LlmContext; model: string; runId: string }> = [];
  const deps: RunnerDeps = {
    async fetchHistory(_provider, ticker) {
      return makePanel(ticker, ticker === 'AAA' ? 1 : 3);
    },
    async readFileContent() {
      return '';
    },
    async interpret(context, model, runId) {
      interpretCalls.push({ context, model, runId });
      return {
        output: null,
        trace: {
          run_id: runId,
          provider: 'qwen',
          model,
          prompt_version: 'v1',
          requested_at: '2026-01-01T00:00:00.000Z',
          completed_at: '2026-01-01T00:00:01.000Z',
          latency_ms: 0,
          status: 'skipped',
          error_message: '未配置密钥',
        },
      };
    },
    ...overrides,
  };
  return { deps, interpretCalls };
}

describe('runAnalysis · 全链路（注入 fake 依赖）', () => {
  it('产出分类 1 组 + 连续 3 法 + 滚动行，run_id 一致', async () => {
    const { deps } = fakeDeps();
    const outcome = await runAnalysis(baseConfig, deps);
    expect(outcome.runId).toMatch(/^[0-9a-f-]{36}$/);

    const fullSample = outcome.results.filter((r) => r.window_end === null);
    const categorical = fullSample.filter((r) => r.test_family === 'categorical');
    const continuous = fullSample.filter((r) => r.test_family === 'continuous');
    expect(categorical).toHaveLength(1); // 两别名 → 1 对
    expect(categorical[0]!.test_name).toBe('chi_square_independence');
    expect(continuous.map((r) => r.test_name).sort()).toEqual([
      'mutual_information',
      'pearson',
      'spearman',
    ]);

    const rolling = outcome.results.filter((r) => r.window_end !== null);
    expect(rolling.length).toBeGreaterThan(0);
    for (const row of outcome.results) {
      expect(row.run_id).toBe(outcome.runId);
      expect(row.p_value_adjusted).toBeGreaterThanOrEqual(0);
      expect(row.p_value_adjusted).toBeLessThanOrEqual(1);
      expect(row.significant).toBe(row.p_value_adjusted < baseConfig.tests.alpha);
    }
  });

  it('审计：每个原始数据源一行，状态三档之一', async () => {
    const { deps } = fakeDeps();
    const outcome = await runAnalysis(baseConfig, deps);
    expect(outcome.audit.map((a) => a.series_alias).sort()).toEqual(['A', 'B']);
    for (const row of outcome.audit) {
      expect(['pass', 'warn', 'fail']).toContain(row.audit_status);
    }
  });

  it('LLM 上下文注入 12 字段且透传 trace', async () => {
    const { deps, interpretCalls } = fakeDeps();
    const outcome = await runAnalysis(baseConfig, deps);
    expect(interpretCalls).toHaveLength(1);
    expect(interpretCalls[0]!.model).toBe('qwen-plus');
    expect(interpretCalls[0]!.runId).toBe(outcome.runId);
    expect(interpretCalls[0]!.context.research_question).toContain('编排冒烟');
    expect(interpretCalls[0]!.context.audit_key_findings).toContain('A：');
    expect(outcome.llm.trace.status).toBe('skipped');
    expect(outcome.llm.output).toBeNull();
    expect(outcome.llm.context).toEqual(interpretCalls[0]!.context);
  });

  it('滞后分析（PRD 模块 H）：maxLag>0 时产出 [-maxLag,+maxLag] 全扫描行并标注最优 lag', async () => {
    const config: TaskConfig = {
      ...baseConfig,
      maxLag: 3,
      rolling: { enabled: false, windowDays: 60, stepDays: 21 },
    };
    const { deps, interpretCalls } = fakeDeps();
    const outcome = await runAnalysis(config, deps);

    const lagRows = outcome.results.filter((r) => r.test_name === 'pearson_lag');
    // 1 对变量 × (2×3+1)=7 个 lag 切片
    expect(lagRows).toHaveLength(7);
    expect(lagRows.map((r) => r.lag).sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    for (const row of lagRows) {
      expect(row.test_family).toBe('continuous');
      expect(row.window_end).toBeNull();
    }
    // 最优 lag 标注恰好一行（notes 含 |r|）
    const best = lagRows.filter((r) => r.notes?.includes('最大绝对相关'));
    expect(best).toHaveLength(1);

    // LLM 上下文承接：lag 关键发现不再是占位文案
    expect(interpretCalls[0]!.context.lag_key_findings).not.toContain('未产出滞后分析结果');
  });

  it('CSV 上传源：字段映射 date_col/close_col/adj_close_col 生效', async () => {
    const csv = [
      'date,close,adj_close',
      ...Array.from({ length: 300 }, (_, i) => {
        const d = new Date('2024-01-01T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + Math.floor(i * 1.2));
        return `${d.toISOString().slice(0, 10)},${100 + (i % 17)},${100.5 + (i % 17)}`;
      }),
    ].join('\n');
    const config: TaskConfig = {
      ...baseConfig,
      dataSources: [
        { kind: 'ticker', alias: 'A', ticker: 'AAA', provider: 'mock' },
        {
          kind: 'upload',
          alias: 'C',
          fileId: '00000000-0000-0000-0000-0000000000bb',
          columnMapping: { date_col: 'date', close_col: 'close', adj_close_col: 'adj_close' },
        },
      ],
      rolling: { enabled: false, windowDays: 60, stepDays: 21 },
    };
    const { deps } = fakeDeps({ readFileContent: async () => csv });
    const outcome = await runAnalysis(config, deps);
    const auditC = outcome.audit.find((a) => a.series_alias === 'C');
    expect(auditC).toBeDefined();
    // 复权差异审计生效：close 与 adj_close 恒定差 0.5 → 全部计标记
    expect(auditC!.adjustment_flag_count).toBeGreaterThan(0);
    expect(outcome.results.some((r) => r.left_series === 'C' || r.right_series === 'C')).toBe(true);
  });

  it('上传映射缺 date_col/close_col 时拒绝', async () => {
    const config: TaskConfig = {
      ...baseConfig,
      dataSources: [
        { kind: 'ticker', alias: 'A', ticker: 'AAA', provider: 'mock' },
        {
          kind: 'upload',
          alias: 'C',
          fileId: '00000000-0000-0000-0000-0000000000bb',
          columnMapping: { date_col: 'date' },
        },
      ],
    };
    const { deps } = fakeDeps({ readFileContent: async () => 'date,close\n2024-01-01,100' });
    await expect(runAnalysis(config, deps)).rejects.toThrow(/close_col/);
  });

  it('数据拉取失败向上传播（供路由标记 failed）', async () => {
    const { deps } = fakeDeps({
      fetchHistory: async () => {
        throw new Error('上游不可达');
      },
    });
    await expect(runAnalysis(baseConfig, deps)).rejects.toThrow(/上游不可达/);
  });
});
