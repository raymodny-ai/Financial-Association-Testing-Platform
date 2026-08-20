import { describe, expect, it } from 'vitest';
import {
  auditRowSchema,
  llmContextSchema,
  llmOutputSchema,
  resultRowSchema,
  taskConfigSchema,
  uploadedFileSchema,
} from './index';

/** PRD「数据模型」字段清单对拍，防止契约漂移 */
describe('schemas 契约字段完整性', () => {
  it('结果长表行含 PRD 定义的 13 字段', () => {
    expect(Object.keys(resultRowSchema.shape)).toEqual([
      'run_id',
      'test_family',
      'test_name',
      'left_series',
      'right_series',
      'window_end',
      'lag',
      'stat_value',
      'p_value_raw',
      'p_value_adjusted',
      'effect_size',
      'significant',
      'notes',
    ]);
  });

  it('审计表行含 PRD 定义的 9+1 字段（series_alias 为归属键）', () => {
    const keys = Object.keys(auditRowSchema.shape);
    expect(keys).toContain('series_alias');
    for (const f of [
      'missing_value_count',
      'missing_business_days_count',
      'duplicate_index_count',
      'stale_run_count',
      'jump_count',
      'max_abs_return_pct',
      'adjustment_flag_count',
      'source_match_ratio',
      'audit_status',
    ]) {
      expect(keys).toContain(f);
    }
  });

  it('LLM 上下文含 PRD 定义的 12 字段', () => {
    expect(Object.keys(llmContextSchema.shape)).toHaveLength(12);
    expect(Object.keys(llmContextSchema.shape)).toContain('forbidden_claims');
  });

  it('LLM 输出含 PRD 定义的 10 字段', () => {
    expect(Object.keys(llmOutputSchema.shape)).toHaveLength(10);
    expect(Object.keys(llmOutputSchema.shape)).toContain('forbidden_inference_flags');
  });
});

describe('taskConfigSchema 业务规则', () => {
  const base = {
    projectName: '示例研究',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    dataSources: [
      { kind: 'ticker', alias: 'spy', ticker: 'SPY.US', provider: 'stooq' },
      { kind: 'ticker', alias: 'gold', ticker: 'XAUUSD', provider: 'stooq' },
    ],
    startDate: '2018-01-01',
    endDate: '2024-12-31',
    periods: {
      referenceStart: '2018-01-01',
      referenceEnd: '2020-12-31',
      testStart: '2021-01-01',
      testEnd: '2024-12-31',
    },
  };

  it('合法配置通过校验并填充方法学默认值', () => {
    const parsed = taskConfigSchema.parse(base);
    expect(parsed.frequency).toBe('daily');
    expect(parsed.binning.method).toBe('quantile');
    expect(parsed.binning.bins).toBe(3);
    expect(parsed.rolling.windowDays).toBe(252);
    expect(parsed.rolling.stepDays).toBe(21);
    expect(parsed.maxLag).toBe(10);
    expect(parsed.tests.correction).toBe('bh');
  });

  it('拒绝参考期晚于检验期的配置', () => {
    const bad = {
      ...base,
      periods: { ...base.periods, referenceEnd: '2021-06-30', testStart: '2021-01-01' },
    };
    expect(() => taskConfigSchema.parse(bad)).toThrow(/参考期结束日期必须早于检验期开始日期/);
  });

  it('拒绝少于 2 个数据源的配置', () => {
    const bad = { ...base, dataSources: [base.dataSources[0]] };
    expect(() => taskConfigSchema.parse(bad)).toThrow();
  });

  it('双源一致性审计：ticker 源可携带第二数据源（dualSource.provider，PRD 模块 J）', () => {
    const withDual = {
      ...base,
      dataSources: [
        { kind: 'ticker', alias: 'spy', ticker: 'SPY.US', provider: 'yahoo', dualSource: { provider: 'stooq' } },
        base.dataSources[1],
      ],
    };
    const parsed = taskConfigSchema.parse(withDual);
    const spy = parsed.dataSources[0]!;
    expect(spy.kind).toBe('ticker');
    if (spy.kind === 'ticker') expect(spy.dualSource?.provider).toBe('stooq');
  });

  it('双源一致性审计：upload 源可携带第二上传文件（dualSource.fileId+columnMapping）', () => {
    const withDual = {
      ...base,
      dataSources: [
        {
          kind: 'upload',
          alias: 'spy',
          fileId: '22222222-2222-4222-8222-222222222222',
          columnMapping: { date_col: 'date', close_col: 'close' },
          dualSource: {
            fileId: '33333333-3333-4333-8333-333333333333',
            columnMapping: { date_col: 'd', close_col: 'c' },
          },
        },
        base.dataSources[1],
      ],
    };
    const parsed = taskConfigSchema.parse(withDual);
    const spy = parsed.dataSources[0]!;
    expect(spy.kind).toBe('upload');
    if (spy.kind === 'upload') expect(spy.dualSource?.fileId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('dualSource 缺必填字段时拒绝（ticker 缺 provider）', () => {
    const bad = {
      ...base,
      dataSources: [
        { kind: 'ticker', alias: 'spy', ticker: 'SPY.US', provider: 'yahoo', dualSource: {} },
        base.dataSources[1],
      ],
    };
    expect(() => taskConfigSchema.parse(bad)).toThrow();
  });
});

describe('rollingConfigSchema 滚动窗口透传（G5）', () => {
  const base = {
    projectName: '滚动透传',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    dataSources: [
      { kind: 'ticker', alias: 'spy', ticker: 'SPY.US', provider: 'stooq' },
      { kind: 'ticker', alias: 'gold', ticker: 'XAUUSD', provider: 'stooq' },
    ],
    startDate: '2018-01-01',
    endDate: '2024-12-31',
    periods: {
      referenceStart: '2018-01-01',
      referenceEnd: '2020-12-31',
      testStart: '2021-01-01',
      testEnd: '2024-12-31',
    },
  };

  it('接受 minSamples 与 methods 子集配置', () => {
    const parsed = taskConfigSchema.parse({
      ...base,
      rolling: { enabled: true, windowDays: 60, stepDays: 5, minSamples: 30, methods: ['pearson', 'spearman'] },
    });
    expect(parsed.rolling.minSamples).toBe(30);
    expect(parsed.rolling.methods).toEqual(['pearson', 'spearman']);
  });

  it('缺省时不填充（引擎默认：仅完整窗口 / 全部四法）', () => {
    const parsed = taskConfigSchema.parse(base);
    expect(parsed.rolling.minSamples).toBeUndefined();
    expect(parsed.rolling.methods).toBeUndefined();
  });

  it('拒绝 minSamples 大于 windowDays 或小于 2', () => {
    expect(
      taskConfigSchema.safeParse({ ...base, rolling: { windowDays: 60, stepDays: 5, minSamples: 61 } }).success,
    ).toBe(false);
    expect(
      taskConfigSchema.safeParse({ ...base, rolling: { windowDays: 60, stepDays: 5, minSamples: 1 } }).success,
    ).toBe(false);
  });

  it('拒绝空 methods 与未知方法名', () => {
    expect(taskConfigSchema.safeParse({ ...base, rolling: { methods: [] } }).success).toBe(false);
    expect(taskConfigSchema.safeParse({ ...base, rolling: { methods: ['kendall'] } }).success).toBe(false);
  });
});

describe('上传文件契约', () => {
  it('uploadedFileSchema 含元数据字段且拒绝空列', () => {
    expect(Object.keys(uploadedFileSchema.shape)).toEqual([
      'id',
      'workspaceId',
      'filename',
      'columns',
      'rowCount',
      'createdAt',
    ]);
    expect(() =>
      uploadedFileSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        workspaceId: '123e4567-e89b-12d3-a456-426614174001',
        filename: 'a.csv',
        columns: [],
        rowCount: 1,
        createdAt: '2026-08-19T10:00:00.000Z',
      }),
    ).toThrow();
  });
});
