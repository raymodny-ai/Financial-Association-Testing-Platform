import { describe, expect, it } from 'vitest';
import {
  analysisTemplateSchema,
  auditRowSchema,
  binningConfigSchema,
  createTemplateRequestSchema,
  derivedSeriesSchema,
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

  it('upload 源空字段映射拒绝（Zod 3 record 无 min，refine 守卫，G15 关 N3）', () => {
    const bad = {
      ...base,
      dataSources: [
        { kind: 'upload', alias: 'spy', fileId: '22222222-2222-4222-8222-222222222222', columnMapping: {} },
        base.dataSources[1],
      ],
    };
    expect(() => taskConfigSchema.parse(bad)).toThrow(/字段映射不得为空/);
  });

  it('dualSource 第二文件空字段映射同样拒绝（G15 关 N3）', () => {
    const bad = {
      ...base,
      dataSources: [
        {
          kind: 'upload',
          alias: 'spy',
          fileId: '22222222-2222-4222-8222-222222222222',
          columnMapping: { date_col: 'date', close_col: 'close' },
          dualSource: {
            fileId: '33333333-3333-4333-8333-333333333333',
            columnMapping: {},
          },
        },
        base.dataSources[1],
      ],
    };
    expect(() => taskConfigSchema.parse(bad)).toThrow(/字段映射不得为空/);
  });
});

describe('derivedSeriesSchema 比值变换守卫（S3）', () => {
  it('ratio 变换携带 denominatorAlias 通过', () => {
    const parsed = derivedSeriesSchema.parse({
      alias: 'R',
      sourceAlias: 'A',
      denominatorAlias: 'B',
      transform: 'ratio',
    });
    expect(parsed.denominatorAlias).toBe('B');
  });

  it('ratio 变换缺 denominatorAlias 拒绝', () => {
    expect(() =>
      derivedSeriesSchema.parse({ alias: 'R', sourceAlias: 'A', transform: 'ratio' }),
    ).toThrow(/分母序列/);
  });

  it('非 ratio 变换携带 denominatorAlias 拒绝', () => {
    expect(() =>
      derivedSeriesSchema.parse({ alias: 'C', sourceAlias: 'A', denominatorAlias: 'B', transform: 'pct_return' }),
    ).toThrow(/分母序列/);
  });

  it('既有单源变换不带 denominatorAlias 保持通过', () => {
    expect(derivedSeriesSchema.parse({ alias: 'C', sourceAlias: 'A', transform: 'diff' }).transform).toBe('diff');
  });
});

describe('binningConfigSchema 分箱方法守卫（S2，缺口 N7 转正）', () => {
  it('fixed_threshold 携带合法阈值通过', () => {
    const parsed = binningConfigSchema.parse({
      method: 'fixed_threshold',
      bins: 3,
      thresholds: [-1, 0.5],
    });
    expect(parsed.thresholds).toEqual([-1, 0.5]);
  });

  it('fixed_threshold 缺 thresholds 拒绝', () => {
    expect(() => binningConfigSchema.parse({ method: 'fixed_threshold', bins: 3 })).toThrow(
      /固定阈值/,
    );
  });

  it('非 fixed_threshold 携带 thresholds 拒绝', () => {
    expect(() =>
      binningConfigSchema.parse({ method: 'quantile', bins: 3, thresholds: [1] }),
    ).toThrow(/固定阈值/);
  });

  it('阈值个数与桶数不一致（须 bins-1 个）拒绝', () => {
    expect(() =>
      binningConfigSchema.parse({ method: 'fixed_threshold', bins: 3, thresholds: [1] }),
    ).toThrow(/阈值个数/);
  });

  it('阈值非严格递增拒绝', () => {
    expect(() =>
      binningConfigSchema.parse({ method: 'fixed_threshold', bins: 3, thresholds: [2, 1] }),
    ).toThrow(/严格递增/);
  });

  it('stddev 分箱方法通过且默认桶数填充', () => {
    const parsed = binningConfigSchema.parse({ method: 'stddev' });
    expect(parsed.method).toBe('stddev');
    expect(parsed.bins).toBe(3);
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

describe('分析模板契约（G6，PRD 配置设计）', () => {
  it('analysisTemplateSchema 含 id/workspaceId/name/config/createdAt 五字段', () => {
    expect(Object.keys(analysisTemplateSchema.shape)).toEqual([
      'id',
      'workspaceId',
      'name',
      'config',
      'createdAt',
    ]);
  });

  it('createTemplateRequestSchema 仅含 name + config（workspaceId 服务端注入）', () => {
    expect(Object.keys(createTemplateRequestSchema.shape)).toEqual(['name', 'config']);
    expect(createTemplateRequestSchema.safeParse({ name: '', config: {} }).success).toBe(false);
  });
});

describe('taskConfigSchema researchQuestion（G13，PRD 模块 K 输入要求，关 N12）', () => {
  const base = {
    projectName: '研究问题',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    dataSources: [
      { kind: 'ticker', alias: 'A', ticker: 'AAA', provider: 'yahoo' },
      { kind: 'ticker', alias: 'B', ticker: 'BBB', provider: 'yahoo' },
    ],
    startDate: '2020-01-01',
    endDate: '2024-12-31',
    periods: {
      referenceStart: '2020-01-01',
      referenceEnd: '2022-12-31',
      testStart: '2023-01-01',
      testEnd: '2024-12-31',
    },
  };

  it('接受可选研究问题；缺省时不填充（由引擎按 projectName 派生）', () => {
    expect(taskConfigSchema.parse({ ...base, researchQuestion: '涨跌状态是否联动？' }).researchQuestion).toBe(
      '涨跌状态是否联动？',
    );
    expect(taskConfigSchema.parse(base).researchQuestion).toBeUndefined();
  });

  it('拒绝空白与超过 512 字符的研究问题', () => {
    expect(taskConfigSchema.safeParse({ ...base, researchQuestion: '  ' }).success).toBe(false);
    expect(taskConfigSchema.safeParse({ ...base, researchQuestion: '问'.repeat(513) }).success).toBe(false);
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
