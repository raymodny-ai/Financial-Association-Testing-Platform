/**
 * T15 · LLM 上下文构造（RED 先行）。
 * 纯函数 buildLlmContext：TaskConfig + ResultTable + AuditTable → LlmContext（12 字段）。
 * PRD 模块 K：LLM 只读"研究摘要对象"；审计高风险必须前置；少数窗口显著不得称稳定；
 * 弱效应显著必须提示"统计显著不等于经济显著"。
 */
import { llmContextSchema, type ResultRow, type TaskConfig } from '@platform/schemas';
import { describe, expect, it } from 'vitest';
import { buildLlmContext, FORBIDDEN_CLAIMS, REQUIRED_ANSWER_SECTIONS } from './llm-context.js';

const UUID = '00000000-0000-0000-0000-000000000001';

const config: TaskConfig = {
  projectName: 'A股与美股联动研究',
  workspaceId: '00000000-0000-0000-0000-0000000000aa',
  dataSources: [
    { kind: 'ticker', alias: 'A', ticker: 'sh.000001', provider: 'yahoo' },
    { kind: 'ticker', alias: 'B', ticker: '^GSPC', provider: 'yahoo' },
  ],
  startDate: '2020-01-01',
  endDate: '2024-12-31',
  frequency: 'daily',
  derivedSeries: [{ alias: 'rA', sourceAlias: 'A', transform: 'pct_return' }],
  periods: {
    referenceStart: '2020-01-01',
    referenceEnd: '2022-12-31',
    testStart: '2023-01-01',
    testEnd: '2024-12-31',
  },
  binning: { method: 'quantile', bins: 3 },
  tests: { alpha: 0.05, correction: 'bh', permutations: 1000, permutationSeed: 20260819 },
  rolling: { enabled: true, windowDays: 252, stepDays: 21 },
  maxLag: 10,
  audit: {
    missingRatioWarn: 0.02,
    missingRatioFail: 0.1,
    jumpAbsReturnPct: 20,
    sourceMatchRatioWarn: 0.98,
  },
  llmModel: 'qwen-plus',
  promptVersion: 'v1',
};

function row(
  partial: Partial<ResultRow> &
    Pick<
      ResultRow,
      | 'test_family'
      | 'test_name'
      | 'left_series'
      | 'right_series'
      | 'stat_value'
      | 'p_value_raw'
      | 'p_value_adjusted'
    >,
): ResultRow {
  return {
    run_id: UUID,
    window_end: null,
    lag: 0,
    effect_size: null,
    significant: false,
    notes: null,
    ...partial,
  };
}

describe('buildLlmContext · 头部字段', () => {
  it('显式研究问题优先；缺省时由 projectName 派生', () => {
    const withQ = buildLlmContext({ config, researchQuestion: '涨跌状态是否联动？', results: [], audit: [] });
    expect(withQ.research_question).toBe('涨跌状态是否联动？');
    const fallback = buildLlmContext({ config, results: [], audit: [] });
    expect(fallback.research_question).toBe('「A股与美股联动研究」关联性检验研究');
  });

  it('sample_info 覆盖频率 / 样本区间 / 参考期 / 检验期', () => {
    const ctx = buildLlmContext({ config, results: [], audit: [] });
    expect(ctx.sample_info).toBe(
      '频率 daily；样本区间 2020-01-01 至 2024-12-31；参考期 2020-01-01 至 2022-12-31（拟合分箱阈值）；检验期 2023-01-01 至 2024-12-31（复用参考期阈值执行检验）。',
    );
  });

  it('variable_definitions 覆盖数据源金融语义与派生序列', () => {
    const ctx = buildLlmContext({ config, results: [], audit: [] });
    expect(ctx.variable_definitions).toContain('A：公开市场序列，ticker=sh.000001，数据源=yahoo');
    expect(ctx.variable_definitions).toContain('B：公开市场序列，ticker=^GSPC，数据源=yahoo');
    expect(ctx.variable_definitions).toContain('rA = A 经百分比收益率变换派生');
  });

  it('research_scope 覆盖双路线 / 校正 / 滚动 / 滞后配置', () => {
    const ctx = buildLlmContext({ config, results: [], audit: [] });
    expect(ctx.research_scope).toContain('quantile');
    expect(ctx.research_scope).toContain('BH(FDR) 校正');
    expect(ctx.research_scope).toContain('252');
    expect(ctx.research_scope).toContain('最大滞后：10');
  });
});

describe('buildLlmContext · 检验摘要', () => {
  const categoricalRows: ResultRow[] = [
    row({
      test_family: 'categorical',
      test_name: 'chi_square_independence',
      left_series: 'A',
      right_series: 'B',
      stat_value: 12.5,
      p_value_raw: 0.01,
      p_value_adjusted: 0.01,
      effect_size: 0.35,
      significant: true,
    }),
    row({
      test_family: 'categorical',
      test_name: 'chi_square_independence',
      left_series: 'rA',
      right_series: 'B',
      stat_value: 1.2,
      p_value_raw: 0.4,
      p_value_adjusted: 0.4,
      effect_size: 0.11,
      notes: '期望频数不足（min=2.10<5）',
    }),
  ];

  it('categorical_key_findings：计数 / 最强关联 / 显著组合 / 警告', () => {
    const ctx = buildLlmContext({ config, results: categoricalRows, audit: [] });
    const lines = ctx.categorical_key_findings.split('\n');
    expect(lines[0]).toBe('共 2 组检验，显著 1 组（BH(FDR) 校正，alpha=0.05）。');
    expect(lines[1]).toBe(
      "最强关联：A×B（chi_square_independence），统计量=12.5，校正 p=0.01，效应量=0.35。",
    );
    expect(lines[2]).toBe('显著组合：A×B（p_adj=0.01）。');
    expect(lines[3]).toBe('警告：期望频数不足（min=2.10<5）。');
  });

  it('audit/llm 族行不计入检验摘要', () => {
    const ctx = buildLlmContext({
      config,
      results: [
        ...categoricalRows,
        row({
          test_family: 'audit',
          test_name: 'audit',
          left_series: 'A',
          right_series: 'A',
          stat_value: 0,
          p_value_raw: 1,
          p_value_adjusted: 1,
        }),
      ],
      audit: [],
    });
    expect(ctx.categorical_key_findings).toContain('共 2 组检验');
  });

  it('无连续检验时输出占位说明', () => {
    const ctx = buildLlmContext({ config, results: categoricalRows, audit: [] });
    expect(ctx.continuous_key_findings).toBe('未产出该类检验结果。');
  });

  it('rolling_key_findings：少数窗口显著必须附不稳定声明', () => {
    const rollingRows = [1, 2, 3].map((i) =>
      row({
        test_family: 'continuous',
        test_name: 'pearson',
        left_series: 'A',
        right_series: 'B',
        window_end: `2024-01-0${i}`,
        stat_value: 0.2,
        p_value_raw: i === 1 ? 0.01 : 0.6,
        p_value_adjusted: i === 1 ? 0.03 : 0.6,
        significant: i === 1,
      }),
    );
    const ctx = buildLlmContext({
      config,
      results: rollingRows,
      rollingSkippedCount: 2,
      audit: [],
    });
    const text = ctx.rolling_key_findings;
    expect(text).toContain('A×B（pearson）：共 3 个窗口，显著 1 个（33.3333%）—— 仅少数窗口显著，不得视为稳定规律。');
    expect(text).toContain('另有 2 个退化窗口被跳过');
    // 滚动行不得混入全样本连续摘要
    expect(ctx.continuous_key_findings).toBe('未产出该类检验结果。');
  });

  it('lag_key_findings：显著滞后列表与最佳滞后', () => {
    const lagRows = [1, 2].map((lag) =>
      row({
        test_family: 'continuous',
        test_name: 'pearson',
        left_series: 'A',
        right_series: 'B',
        lag,
        stat_value: 0.3,
        p_value_raw: lag === 1 ? 0.01 : 0.6,
        p_value_adjusted: lag === 1 ? 0.02 : 0.6,
        significant: lag === 1,
      }),
    );
    const ctx = buildLlmContext({ config, results: lagRows, audit: [] });
    expect(ctx.lag_key_findings).toBe(
      'A×B（pearson）：显著滞后 [1]，最佳滞后 lag=1（p_adj=0.02）。',
    );
    // 滞后行不得混入全样本摘要
    expect(ctx.continuous_key_findings).toBe('未产出该类检验结果。');
  });

  it('无滞后结果时输出 maxLag 占位说明', () => {
    const ctx = buildLlmContext({ config, results: [], audit: [] });
    expect(ctx.lag_key_findings).toBe('未产出滞后分析结果（maxLag=10）。');
  });
});

describe('buildLlmContext · 审计与全局置信旗标', () => {
  const passRow = {
    series_alias: 'A',
    missing_value_count: 0,
    missing_business_days_count: 0,
    duplicate_index_count: 0,
    stale_run_count: 0,
    jump_count: 0,
    max_abs_return_pct: 3.2,
    adjustment_flag_count: 0,
    source_match_ratio: 1,
    audit_status: 'pass',
  } as const;
  const failRow = { ...passRow, series_alias: 'B', missing_value_count: 60, audit_status: 'fail' } as const;

  it('audit_key_findings：fail 前置高风险声明 + 每源明细行', () => {
    const ctx = buildLlmContext({
      config,
      results: [],
      audit: [failRow, passRow],
      auditNotes: { B: ['缺失占比 12.00% 达到失败阈值'] },
    });
    const lines = ctx.audit_key_findings.split('\n');
    expect(lines[0]).toBe('审计高风险（fail）序列：B。全部统计结论需谨慎解释，优先补充数据验证。');
    expect(lines[1]).toBe(
      'A：pass（缺失值 0、缺失交易日 0、重复索引 0、stale 0、跳点 0、复权 0、双源一致率 100%）。',
    );
    expect(lines[2]).toBe(
      'B：fail（缺失值 60、缺失交易日 0、重复索引 0、stale 0、跳点 0、复权 0、双源一致率 100%）；缺失占比 12.00% 达到失败阈值。',
    );
  });

  it('审计 fail 触发置信降级旗标', () => {
    const ctx = buildLlmContext({ config, results: [], audit: [failRow] });
    expect(ctx.global_confidence_flags.join('\n')).toContain('审计高风险');
    expect(ctx.global_confidence_flags.join('\n')).toContain('置信度');
  });

  it('弱效应但显著：提示统计显著不等于经济显著', () => {
    const ctx = buildLlmContext({
      config,
      results: [
        row({
          test_family: 'continuous',
          test_name: 'pearson',
          left_series: 'A',
          right_series: 'B',
          stat_value: 2.1,
          p_value_raw: 0.03,
          p_value_adjusted: 0.03,
          effect_size: 0.05,
          significant: true,
        }),
      ],
      audit: [],
    });
    expect(ctx.global_confidence_flags.join('\n')).toContain('统计显著不等于经济显著');
  });

  it('correction=none 提示假阳性风险', () => {
    const ctx = buildLlmContext({
      config: { ...config, tests: { ...config.tests, correction: 'none' } },
      results: [],
      audit: [],
    });
    expect(ctx.global_confidence_flags.join('\n')).toContain('未启用多重检验校正');
  });

  it('全部干净时无任何旗标', () => {
    const ctx = buildLlmContext({ config, results: [], audit: [passRow] });
    expect(ctx.global_confidence_flags).toEqual([]);
  });
});

describe('buildLlmContext · 任务清单与禁止性表述', () => {
  it('required_answer_sections 为模板 7 章节且与常量一致', () => {
    const ctx = buildLlmContext({ config, results: [], audit: [] });
    expect(ctx.required_answer_sections).toEqual([...REQUIRED_ANSWER_SECTIONS]);
    expect(ctx.required_answer_sections).toHaveLength(7);
  });

  it('forbidden_claims 为 PRD 安全约束常量', () => {
    const ctx = buildLlmContext({ config, results: [], audit: [] });
    expect(ctx.forbidden_claims).toEqual([...FORBIDDEN_CLAIMS]);
    expect(ctx.forbidden_claims.join('\n')).toContain('因果');
    expect(ctx.forbidden_claims.join('\n')).toContain('投资建议');
  });

  it('输出通过 llmContextSchema 运行时校验', () => {
    const ctx = buildLlmContext({ config, results: [], audit: [] });
    expect(() => llmContextSchema.parse(ctx)).not.toThrow();
  });
});
