/**
 * X2 参数失效提示（PRD L363：参数变更后提示哪些结果将失效并需要重新运行）
 *
 * diffTaskConfig 对基线配置（复制分析来源任务的已运行配置）与当前草稿
 * 逐域比对，按影响面分组返回失效域；仅元数据（项目名/工作区）变更不失效。
 * 分组顺序固定：全域 → 分箱 → 检验选项 → 滚动 → 滞后 → 事件 → 审计 → LLM。
 */
import { describe, expect, it } from 'vitest';
import { diffTaskConfig, taskConfigSchema, type TaskConfig } from './index';

/** 与 contracts.test.ts 同口径的最小合法配置（经 parse 填充全部默认值） */
const baseline: TaskConfig = taskConfigSchema.parse({
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
});

describe('diffTaskConfig 参数失效分类（X2）', () => {
  it('配置完全一致 → 无失效域', () => {
    expect(diffTaskConfig(baseline, { ...baseline })).toEqual([]);
  });

  it('仅项目名变更 → 不产生失效（元数据不影响结果）', () => {
    expect(diffTaskConfig(baseline, { ...baseline, projectName: '改名' })).toEqual([]);
  });

  it('数据源变更 → 全部分析结果失效', () => {
    const impacts = diffTaskConfig(baseline, {
      ...baseline,
      dataSources: [
        { kind: 'ticker', alias: 'spy', ticker: 'SPY.US', provider: 'yahoo' },
        baseline.dataSources[1]!,
      ],
    });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.scope).toBe('全部分析结果');
    expect(impacts[0]!.changed).toContain('数据源');
  });

  it('频率变更 → 全部分析结果失效（重采样改变分析轴）', () => {
    const impacts = diffTaskConfig(baseline, { ...baseline, frequency: 'weekly' });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.scope).toBe('全部分析结果');
    expect(impacts[0]!.changed).toEqual(['频率']);
  });

  it('参考期/检验期变更 → 全部分析结果失效（阈值与切片口径改变）', () => {
    const impacts = diffTaskConfig(baseline, {
      ...baseline,
      periods: { ...baseline.periods, referenceEnd: '2019-12-31', testStart: '2020-01-01' },
    });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.changed).toEqual(['期间划分']);
  });

  it('分箱变更 → 分类与状态分布相关结果失效', () => {
    const impacts = diffTaskConfig(baseline, {
      ...baseline,
      binning: { ...baseline.binning, bins: 5 },
    });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.scope).toBe('分类检验与状态分布相关结果');
    expect(impacts[0]!.changed).toEqual(['分箱方法']);
  });

  it('检验选项（α/校正/置换）变更 → 显著性结论失效', () => {
    const impacts = diffTaskConfig(baseline, {
      ...baseline,
      tests: { ...baseline.tests, alpha: 0.01 },
    });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.scope).toBe('全部检验的显著性结论与置换 p 值');
  });

  it('滚动窗口配置变更 → 仅滚动结果失效', () => {
    const impacts = diffTaskConfig(baseline, {
      ...baseline,
      rolling: { ...baseline.rolling, windowDays: 120 },
    });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.scope).toBe('滚动窗口结果');
  });

  it('最大滞后变更 → 仅滞后分析结果失效', () => {
    const impacts = diffTaskConfig(baseline, { ...baseline, maxLag: 20 });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.scope).toBe('滞后分析结果');
  });

  it('事件标签变更 → 仅事件关联结果失效', () => {
    const impacts = diffTaskConfig(baseline, {
      ...baseline,
      events: [{ name: '降息', date: '2022-03-16' }],
    });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.scope).toBe('事件关联分析结果');
  });

  it('审计阈值变更 → 仅审计结论失效', () => {
    const impacts = diffTaskConfig(baseline, {
      ...baseline,
      audit: { ...baseline.audit, missingRatioFail: 0.2 },
    });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.scope).toBe('数据审计结论');
  });

  it('研究问题变更 → 仅 LLM 解读失效（统计结果不受影响）', () => {
    const impacts = diffTaskConfig(baseline, { ...baseline, researchQuestion: '新问题' });
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.scope).toBe('LLM 解读');
  });

  it('多处变更 → 按固定顺序分组（全域优先，LLM 最后）', () => {
    const impacts = diffTaskConfig(baseline, {
      ...baseline,
      endDate: '2025-06-30',
      binning: { ...baseline.binning, method: 'stddev' },
      maxLag: 30,
      researchQuestion: '新问题',
    });
    expect(impacts.map((i) => i.scope)).toEqual([
      '全部分析结果',
      '分类检验与状态分布相关结果',
      '滞后分析结果',
      'LLM 解读',
    ]);
  });
});
