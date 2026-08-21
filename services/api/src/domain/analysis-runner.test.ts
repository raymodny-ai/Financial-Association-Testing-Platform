/**
 * T17 · 分析编排器 runAnalysis（RED 先行，依赖注入单测）。
 * 链路：数据加载（ticker/CSV 上传）→ prepareDataset → 卡方族 + 连续检验 + 校正
 * → 滚动窗口 → 审计 → buildLlmContext → LLM 推理（注入）。
 */
import type { LlmContext, TaskConfig } from '@platform/schemas';
import { rollingWindowTests } from '@platform/analysis-engine';
import { describe, expect, it } from 'vitest';
import type { HistoryPanel, PanelPoint } from './data-provider.js';
import { runAnalysis, type RunnerDeps } from './analysis-runner.js';
import { RUN_STEPS } from './run-progress.js';

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
  events: [],
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
  interpretCalls: Array<{ context: LlmContext; model: string; runId: string; promptVersion: string }>;
} {
  const interpretCalls: Array<{ context: LlmContext; model: string; runId: string; promptVersion: string }> = [];
  const deps: RunnerDeps = {
    async fetchHistory(_provider, ticker) {
      return makePanel(ticker, ticker === 'AAA' ? 1 : 3);
    },
    async readFileContent() {
      return '';
    },
    async interpret(context, model, runId, promptVersion) {
      interpretCalls.push({ context, model, runId, promptVersion });
      return {
        output: null,
        trace: {
          run_id: runId,
          provider: 'qwen',
          model,
          prompt_version: promptVersion,
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
  it('产出分类 1 组独立性 + 2 组 GOF（S1，每别名一行）+ 连续 4 法（含 hsic，H2）+ 滚动行，run_id 一致', async () => {
    const { deps } = fakeDeps();
    const outcome = await runAnalysis(baseConfig, deps);
    expect(outcome.runId).toMatch(/^[0-9a-f-]{36}$/);

    const fullSample = outcome.results.filter((r) => r.window_end === null);
    const categorical = fullSample.filter((r) => r.test_family === 'categorical');
    const continuous = fullSample.filter((r) => r.test_family === 'continuous');
    expect(categorical).toHaveLength(3); // 两别名 → 1 对独立性 + 2 行拟合优度
    const independence = categorical.filter((r) => r.test_name === 'chi_square_independence');
    expect(independence).toHaveLength(1);
    // GOF（PRD 模块 E）：每别名一行，左右同为该别名，效应量为 null，notes 含参考期口径
    const gof = categorical.filter((r) => r.test_name === 'chi_square_goodness_of_fit');
    expect(gof.map((r) => r.left_series).sort()).toEqual(['A', 'B']);
    for (const row of gof) {
      expect(row.right_series).toBe(row.left_series);
      expect(row.lag).toBe(0);
      expect(row.effect_size).toBeNull();
      expect(row.notes).toContain('参考期');
    }
    expect(continuous.map((r) => r.test_name).sort()).toEqual([
      'hsic',
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

  it('导出面板（G4）：outcome.panel 含 01/04/05 号文件底座且维度自洽', async () => {
    const { deps } = fakeDeps();
    const outcome = await runAnalysis(baseConfig, deps);
    const panel = outcome.panel;
    expect(panel.run_id).toBe(outcome.runId);
    expect(panel.aliases.sort()).toEqual(['A', 'B']);
    expect(panel.dates.length).toBeGreaterThan(0);
    expect(panel.prices).toHaveLength(panel.aliases.length);
    expect(panel.categories).toHaveLength(panel.aliases.length);
    for (const row of panel.prices) expect(row).toHaveLength(panel.dates.length);
    for (const row of panel.categories) expect(row).toHaveLength(panel.dates.length);
    for (const alias of panel.aliases) {
      expect(panel.thresholds[alias]?.thresholds.length).toBeGreaterThan(0);
    }
    expect(panel.periods).toEqual(baseConfig.periods);
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

  it('researchQuestion 透传（G13，关 N12）：配置显式研究问题优先写入 LLM 上下文', async () => {
    const { deps, interpretCalls } = fakeDeps();
    await runAnalysis({ ...baseConfig, researchQuestion: '两市场涨跌状态是否存在领先滞后关系？' }, deps);
    expect(interpretCalls[0]!.context.research_question).toBe('两市场涨跌状态是否存在领先滞后关系？');
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

  it('事件标签（S4）：检验期事件产出 event_association 行（left=event:<名称>），参考期事件不产出行', async () => {
    const config: TaskConfig = {
      ...baseConfig,
      events: [
        { name: '降息官宣', date: '2024-07-15' }, // 周一，检验期内
        { name: '参考期旧闻', date: '2024-03-01' }, // 参考期 → 引擎记 skipped 不产出行
      ],
      rolling: { enabled: false, windowDays: 60, stepDays: 21 },
    };
    const { deps } = fakeDeps();
    const outcome = await runAnalysis(config, deps);
    const eventRows = outcome.results.filter((r) => r.test_name === 'event_association');
    // 仅检验期事件 × 2 别量产出行；参考期事件被跳过
    expect(eventRows).toHaveLength(2);
    for (const row of eventRows) {
      expect(row.test_family).toBe('categorical');
      expect(row.left_series).toBe('event:降息官宣');
      expect(row.window_end).toBeNull();
      expect(row.lag).toBe(0);
    }
    expect(eventRows.map((r) => r.right_series).sort()).toEqual(['A', 'B']);
  });

  it('双源一致性审计（PRD 模块 J）：dualSource 第二源口径差异 → 一致率低于阈值 warn，第二源不入分析面板', async () => {
    const config: TaskConfig = {
      ...baseConfig,
      dataSources: [
        { kind: 'ticker', alias: 'A', ticker: 'AAA', provider: 'mock', dualSource: { provider: 'mock2' } },
        { kind: 'ticker', alias: 'B', ticker: 'BBB', provider: 'mock' },
      ],
      rolling: { enabled: false, windowDays: 60, stepDays: 21 },
    };
    const { deps, interpretCalls } = fakeDeps({
      async fetchHistory(provider, ticker) {
        // mock2：与主源显著不同的价序 → 分箱状态大量不一致
        return makePanel(ticker, provider === 'mock2' ? 999 : ticker === 'AAA' ? 1 : 3);
      },
    });
    const outcome = await runAnalysis(config, deps);

    const auditA = outcome.audit.find((a) => a.series_alias === 'A')!;
    expect(auditA.source_match_ratio).toBeLessThan(0.98);
    expect(auditA.audit_status).toBe('warn');
    // 未配置双源的 B 保持单源语义（一致率 1）
    expect(outcome.audit.find((a) => a.series_alias === 'B')!.source_match_ratio).toBe(1);
    // 第二源仅供审计对账，不得产出分析行
    expect(outcome.results.length).toBe(7); // 1 分类独立性 + 2 GOF + 4 连续（含 hsic，与无双源基线一致）
    // 双源发现传导至 LLM 上下文
    expect(interpretCalls[0]!.context.audit_key_findings).toContain('双源一致率');
  });

  it('滚动窗口透传（G5）：methods 子集只产出所选方法，minSamples 允许末端部分窗口', async () => {
    const { deps } = fakeDeps();
    const baseline = await runAnalysis(baseConfig, deps);
    const baseWindows = new Set(
      baseline.results.filter((r) => r.window_end !== null).map((r) => r.window_end),
    );

    const config: TaskConfig = {
      ...baseConfig,
      rolling: { enabled: true, windowDays: 60, stepDays: 21, minSamples: 30, methods: ['pearson'] },
    };
    const outcome = await runAnalysis(config, deps);
    const rolling = outcome.results.filter((r) => r.window_end !== null);
    expect(rolling.length).toBeGreaterThan(0);
    // methods 透传：滚动行一律所选方法
    for (const row of rolling) expect(row.test_name).toBe('pearson');
    // minSamples 透传：窗口集为完整窗口基线的超集（末端部分窗口被保留）
    const windows = new Set(rolling.map((r) => r.window_end));
    expect(windows.size).toBeGreaterThanOrEqual(baseWindows.size);
    for (const w of baseWindows) expect(windows.has(w)).toBe(true);
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

  it('S5 周频重采样：frequency 透传引擎，分析轴收敛为周期末日（滚动窗口口径自然继承）', async () => {
    const config: TaskConfig = {
      ...baseConfig,
      frequency: 'weekly',
      rolling: { enabled: true, windowDays: 60, stepDays: 21 },
    };
    const { deps } = fakeDeps();
    const outcome = await runAnalysis(config, deps);
    // 全样本行照常产出（1 独立性 + 2 GOF + 4 连续）
    const fullSample = outcome.results.filter((r) => r.window_end === null);
    expect(fullSample).toHaveLength(7);
    // 周轴下检验期仅 ~27 周 < 窗口长 60 → 无完整窗口，滚动行归零（口径自然继承）
    expect(outcome.results.filter((r) => r.window_end !== null)).toHaveLength(0);
    // 导出面板日期轴 = 周期末日（全年 ≤53 周，远小于日频 ~261 交易日）
    expect(outcome.panel.dates.length).toBeLessThan(70);
    expect(outcome.panel.dates.length).toBeGreaterThan(40);
  });

  it('P1 rollingExecutor 注入：并行执行器接管滚动环节，入参透传且输出同口径接入结果表', async () => {
    let captured: { windowSize: number; stepSize: number } | null = null;
    const { deps } = fakeDeps();
    deps.rollingExecutor = (dataset, options) => {
      captured = { windowSize: options.windowSize, stepSize: options.stepSize };
      // 以引擎串行结果为「并行执行器输出」，验证接线而非实现（确定性口径由引擎接缝保证）
      return rollingWindowTests(dataset, options);
    };
    const outcome = await runAnalysis(baseConfig, deps);
    expect(captured).toEqual({ windowSize: 60, stepSize: 21 });
    const rolling = outcome.results.filter((r) => r.window_end !== null);
    expect(rolling.length).toBeGreaterThan(0);
  });

  it('P2 onProgress：编排 10 步按序上报（0..9，持久化步由路由层承担）', async () => {
    const { deps } = fakeDeps();
    const steps: number[] = [];
    await runAnalysis(baseConfig, deps, (stepIndex) => steps.push(stepIndex));
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 步数与注册表标签表对齐（编排 10 步 + 路由持久化 1 步）
    expect(RUN_STEPS.length).toBe(steps.length + 1);
  });

  it('prompt 版本透传（X6，LLM 模板 A/B）：config.promptVersion 传导至 interpret 入参', async () => {
    const config: TaskConfig = { ...baseConfig, promptVersion: 'v2' };
    const { deps, interpretCalls } = fakeDeps();
    await runAnalysis(config, deps);
    expect(interpretCalls[0]!.promptVersion).toBe('v2');
  });
});
