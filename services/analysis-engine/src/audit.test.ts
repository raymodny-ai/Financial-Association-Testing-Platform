/**
 * T14 · 数据真实性审计引擎（RED 先行）。
 * 黄金基准对拍：tests/fixtures/stat-reference.json audit 节（容差 1e-9）。
 * PRD 模块 J：缺失/重复索引/缺失交易日/stale run/跳点（阈值∪MAD 鲁棒）/
 * 复权差异/双源状态一致率与分布同质性；auditRow 9 字段契约。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AuditThresholds } from '@platform/schemas';
import { describe, expect, it } from 'vitest';
import { chiSquareHomogeneity } from './chi-square.js';
import { auditSeries, type AuditPoint } from './audit.js';

interface AuditFixture {
  max_abs_return_pct: number;
  jump_count: number;
  stale_run_count: number;
  missing_value_count: number;
  duplicate_index_count: number;
  missing_business_days_count: number;
  dual_source: {
    b_values: number[];
    match_ratio: number;
    chi_statistic: number;
    chi_p_value: number;
  };
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../tests/fixtures/stat-reference.json', import.meta.url)),
    'utf-8',
  ),
) as { audit: AuditFixture };

const fx = fixture.audit;

const thresholds: AuditThresholds = {
  missingRatioWarn: 0.02,
  missingRatioFail: 0.1,
  jumpAbsReturnPct: 20,
  sourceMatchRatioWarn: 0.98,
};

/** 黄金基准点集（与 fixture audit 节同源） */
const points: AuditPoint[] = [
  { date: '2024-01-01', value: 100 },
  { date: '2024-01-02', value: 100 },
  { date: '2024-01-03', value: 100 },
  { date: '2024-01-04', value: 101 },
  { date: '2024-01-05', value: null },
  { date: '2024-01-08', value: 102 },
  { date: '2024-01-08', value: 102.5 },
  { date: '2024-01-10', value: 103 },
  { date: '2024-01-11', value: 300 },
  { date: '2024-01-12', value: 300 },
];

const dualSourcePoints: AuditPoint[] = fx.dual_source.b_values.map((value: number, i: number) => ({
  date: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-08', '2024-01-10', '2024-01-11', '2024-01-12'][i]!,
  value,
}));

describe('auditSeries · 单序列统计（黄金基准对拍）', () => {
  it('缺失值 / 重复索引 / 缺失交易日 / stale run / 跳点 / 最大收益率', () => {
    const { row } = auditSeries({ alias: 'A', points, thresholds });
    expect(row.series_alias).toBe('A');
    expect(row.missing_value_count).toBe(fx.missing_value_count);
    expect(row.duplicate_index_count).toBe(fx.duplicate_index_count);
    expect(row.missing_business_days_count).toBe(fx.missing_business_days_count);
    expect(row.stale_run_count).toBe(fx.stale_run_count);
    expect(row.jump_count).toBe(fx.jump_count);
    expect(Math.abs(row.max_abs_return_pct - fx.max_abs_return_pct)).toBeLessThan(1e-9);
  });

  it('跳点与 stale 记入 notes（PRD：警告而非静默）', () => {
    const { row, notes } = auditSeries({ alias: 'A', points, thresholds });
    expect(notes.join('\n')).toContain('跳点');
    expect(notes.join('\n')).toContain('stale');
    expect(row.audit_status).not.toBe('pass');
  });

  it('复权差异审计：相对差 > 1e-9 计为调整标记', () => {
    const adjusted = points.filter((p) => p.value !== null).map((p) => ({ ...p, value: p.value! }));
    adjusted[0] = { ...adjusted[0]!, value: 99.9 }; // 复权调整 1
    adjusted[4] = { ...adjusted[4]!, value: 102.2 }; // 复权调整 2
    const { row } = auditSeries({ alias: 'A', points, thresholds, adjustedPoints: adjusted });
    expect(row.adjustment_flag_count).toBe(2);
  });

  it('无复权对照时 adjustment_flag_count = 0', () => {
    const { row } = auditSeries({ alias: 'A', points, thresholds });
    expect(row.adjustment_flag_count).toBe(0);
  });

  it('空点集拒绝', () => {
    expect(() => auditSeries({ alias: 'A', points: [], thresholds })).toThrow(/观测/);
  });

  it('MAD 兜底：阈值零命中时鲁棒规则识别离群日', () => {
    // 收益率序列 [0.1, 0.2, 0.1, 0.2, 5]%：中位数 0.2、MAD 0.1，
    // 5% 的修正 z = 0.6745×4.8/0.1 ≈ 32 > 3.5；均未超 20% 阈值
    const returnPcts = [0.1, 0.2, 0.1, 0.2, 5];
    const madPoints: AuditPoint[] = [{ date: '2024-02-01', value: 1000 }];
    returnPcts.forEach((r, i) => {
      const prev = madPoints[i]!.value as number;
      madPoints.push({ date: `2024-02-0${i + 2}`, value: prev * (1 + r / 100) });
    });
    const { row, notes } = auditSeries({ alias: 'M', points: madPoints, thresholds });
    expect(row.jump_count).toBe(1);
    expect(notes.join('\n')).toContain('2024-02-06');
  });
});

describe('auditSeries · 双源一致性（黄金基准对拍，容差 1e-9）', () => {
  it('状态一致率 + 同质性 χ² 与 fixture 一致', () => {
    const { row, homogeneity } = auditSeries({
      alias: 'A',
      points,
      thresholds,
      dualSource: { alias: 'B', points: dualSourcePoints },
    });
    expect(Math.abs(row.source_match_ratio - fx.dual_source.match_ratio)).toBeLessThan(1e-9);
    const reference = chiSquareHomogeneity(
      [3, 2, 3],
      [2, 3, 3],
    );
    expect(homogeneity).not.toBeNull();
    expect(Math.abs(homogeneity!.statistic - fx.dual_source.chi_statistic)).toBeLessThan(1e-9);
    expect(Math.abs(homogeneity!.pValue - fx.dual_source.chi_p_value)).toBeLessThan(1e-9);
    expect(homogeneity!.statistic).toBeCloseTo(reference.statistic, 9);
  });

  it('单源时 source_match_ratio = 1 且无同质性结果', () => {
    const { row, homogeneity } = auditSeries({ alias: 'A', points, thresholds });
    expect(row.source_match_ratio).toBe(1);
    expect(homogeneity).toBeNull();
  });
});

describe('auditSeries · 状态判定矩阵', () => {
  // 温和单调序列：收益率 ~1% 无跳点无 stale（i%5 会形成同值 stale 段，改用递增）
  const cleanPoints: AuditPoint[] = Array.from({ length: 50 }, (_, i) => ({
    date: `2024-03-${String(i + 1).padStart(2, '0')}`,
    value: 100 + i,
  }));

  it('pass：干净序列无跳点无 stale', () => {
    const { row } = auditSeries({ alias: 'C', points: cleanPoints, thresholds });
    expect(row.audit_status).toBe('pass');
  });

  it('warn：缺失占比超过 warn 阈值', () => {
    const withMissing = cleanPoints.map((p, i) => (i < 2 ? { ...p, value: null } : p));
    const { row } = auditSeries({ alias: 'C', points: withMissing, thresholds });
    expect(row.missing_value_count).toBe(2); // 2/50 = 4% > 2% warn
    expect(row.audit_status).toBe('warn');
  });

  it('fail：缺失占比超过 fail 阈值', () => {
    const withMissing = cleanPoints.map((p, i) => (i < 6 ? { ...p, value: null } : p));
    const { row } = auditSeries({ alias: 'C', points: withMissing, thresholds });
    expect(row.audit_status).toBe('fail'); // 6/50 = 12% > 10%
  });

  it('warn：双源一致率低于阈值', () => {
    const divergent = cleanPoints.map((p) => ({ ...p, value: (p.value as number) * 3 }));
    const { row } = auditSeries({
      alias: 'C',
      points: cleanPoints,
      thresholds,
      dualSource: { alias: 'D', points: divergent },
    });
    expect(row.source_match_ratio).toBeLessThan(thresholds.sourceMatchRatioWarn);
    expect(row.audit_status).toBe('warn');
  });
});
