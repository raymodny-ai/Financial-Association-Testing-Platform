/**
 * 导出面板契约（G4，PRD 导出规范 01~05 号文件的数据底座）。
 *
 * run_panels 持久化与 GET results 出参共用该契约：
 * 原始价面板（01）/ 复权面板（02）/ 收益率面板（03 前端派生）/ 状态面板（04）/ 阈值（05）。
 */
import { describe, expect, it } from 'vitest';
import { exportPanelSchema } from './panel';

const validPanel = {
  run_id: '44444444-4444-4444-8444-444444444444',
  aliases: ['A', 'B'],
  dates: ['2024-01-01', '2024-01-02'],
  prices: [
    [100, 101],
    [200, 199],
  ],
  categories: [
    [0, 1],
    [2, 1],
  ],
  thresholds: {
    A: { method: 'quantile', labels: ['低', '中', '高'], thresholds: [100.5, 102.5] },
    B: { method: 'quantile', labels: ['低', '中', '高'], thresholds: [198, 201] },
  },
  adjusted: {
    B: [{ date: '2024-01-01', value: 200.5 }],
  },
  periods: {
    referenceStart: '2024-01-01',
    referenceEnd: '2024-01-01',
    testStart: '2024-01-02',
    testEnd: '2024-01-02',
  },
};

describe('exportPanelSchema（PRD 导出规范 01~05 底座）', () => {
  it('合法面板通过校验', () => {
    const parsed = exportPanelSchema.parse(validPanel);
    expect(parsed.aliases).toEqual(['A', 'B']);
    expect(parsed.prices[0]).toEqual([100, 101]);
    expect(parsed.thresholds.A?.thresholds).toHaveLength(2);
  });

  it('矩阵维度与别名数量不一致时拒绝', () => {
    const bad = { ...validPanel, prices: [[100, 101]] };
    expect(() => exportPanelSchema.parse(bad)).toThrow();
  });

  it('无复权数据时 adjusted 可为空对象', () => {
    const parsed = exportPanelSchema.parse({ ...validPanel, adjusted: {} });
    expect(parsed.adjusted).toEqual({});
  });
});
