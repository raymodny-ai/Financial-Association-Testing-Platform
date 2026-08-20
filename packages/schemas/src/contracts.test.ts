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
