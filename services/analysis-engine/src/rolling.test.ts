/**
 * T13 · 滚动窗口分析（RED 先行）。
 * PRD 模块 G：检验期内滚动重算 χ²独立性 / Pearson / Spearman / MI。
 *
 * 窗口语义：windowSize/stepSize 为对齐日期轴上的观测数（日频即交易日数）；
 * 窗口在检验期内滑动，末端钳制到检验期尾，长度 ≥ minSamples 才保留
 * （minSamples 默认 = windowSize，即仅完整窗口）。
 * 退化窗口（零方差/剪枝后不足 2×2/零跨度）不产出行，记入 skipped。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PreparedDataset } from './pipeline.js';
import { pairwiseChiSquare } from './chi-square-dataset.js';
import { permutationMiTest } from './mutual-information.js';
import { planWindows, rollingWindowTests } from './rolling.js';

describe('planWindows · 窗口调度（精确基准）', () => {
  it('步长 2 的完整窗口（默认 minSamples=windowSize）', () => {
    expect(planWindows(8, { windowSize: 4, stepSize: 2 })).toEqual([
      [0, 3],
      [2, 5],
      [4, 7],
    ]);
  });

  it('无重叠步长', () => {
    expect(planWindows(8, { windowSize: 4, stepSize: 4 })).toEqual([
      [0, 3],
      [4, 7],
    ]);
  });

  it('minSamples 允许末端部分窗口', () => {
    expect(planWindows(8, { windowSize: 4, stepSize: 2, minSamples: 2 })).toEqual([
      [0, 3],
      [2, 5],
      [4, 7],
      [6, 7],
    ]);
  });

  it('观测数不足一个窗口 → 空', () => {
    expect(planWindows(3, { windowSize: 4, stepSize: 1 })).toEqual([]);
  });

  it('末端钳制不产生重复窗口（余数恰为整窗）', () => {
    expect(planWindows(6, { windowSize: 3, stepSize: 3 })).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });

  it('拒绝非法配置', () => {
    expect(() => planWindows(8, { windowSize: 1, stepSize: 1 })).toThrow(/窗口长度/);
    expect(() => planWindows(8, { windowSize: 4, stepSize: 0 })).toThrow(/步长/);
    expect(() => planWindows(8, { windowSize: 4, stepSize: 1, minSamples: 5 })).toThrow(
      /最小样本量/,
    );
    expect(() => planWindows(8, { windowSize: 4, stepSize: 1, minSamples: 1 })).toThrow(
      /最小样本量/,
    );
  });
});

interface PearsonFixture {
  x: number[];
  y: number[];
  r: number;
  p_value: number;
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../tests/fixtures/stat-reference.json', import.meta.url)),
    'utf-8',
  ),
) as { continuous: { pearson: PearsonFixture } };

/** 两序列 8 观测检验期：窗口 1 = fixture pearson 数据；窗口 2 完全退化（B 恒定） */
function buildDataset(): PreparedDataset {
  const dates = Array.from({ length: 8 }, (_, i) => `2024-01-0${i + 1}`);
  return {
    aliases: ['A', 'B'],
    dates,
    values: [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [1, 3, 2, 5, 4, 4, 4, 4],
    ],
    referenceIndex: [0, 0],
    testIndex: [0, 7],
    binning: {
      A: { thresholds: [3.5], labels: ['low', 'high'] },
      B: { thresholds: [3.5], labels: ['low', 'high'] },
    },
    categories: {
      A: [0, 0, 0, 1, 1, 1, 1, 1],
      B: [0, 0, 0, 1, 1, 1, 1, 1],
    },
  };
}

describe('rollingWindowTests · 黄金基准对拍（容差 1e-9）', () => {
  it('窗口 1 的 pearson 与 fixture continuous.pearson 一致', () => {
    const report = rollingWindowTests(buildDataset(), {
      windowSize: 4,
      stepSize: 4,
      methods: ['pearson'],
    });
    const row = report.rows.find((r) => r.windowEnd === 3);
    expect(row).toBeDefined();
    expect(row!.leftAlias).toBe('A');
    expect(row!.rightAlias).toBe('B');
    expect(row!.windowEndDate).toBe('2024-01-04');
    expect(row!.testName).toBe('pearson');
    expect(Math.abs(row!.statValue - fixture.continuous.pearson.r)).toBeLessThan(1e-9);
    expect(Math.abs(row!.pValue - fixture.continuous.pearson.p_value)).toBeLessThan(1e-9);
    expect(row!.effectSize).toBeCloseTo(fixture.continuous.pearson.r, 9);
  });

  it('全检验期单窗口 χ² 与 pairwiseChiSquare 组合一致', () => {
    const dataset = buildDataset();
    const report = rollingWindowTests(dataset, {
      windowSize: 8,
      stepSize: 8,
      methods: ['chi_square_independence'],
    });
    const reference = pairwiseChiSquare(dataset)[0]!;
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.testName).toBe('chi_square_independence');
    expect(row.statValue).toBeCloseTo(reference.result.statistic, 9);
    expect(row.pValue).toBeCloseTo(reference.result.pValue, 9);
    expect(row.effectSize).toBeCloseTo(reference.result.cramersV!, 9);
    // 滚动层附加期望频数适用性警告（PRD：不满足前提必须警告）；剪枝说明与全期口径一致
    expect(row.notes).toContain('期望频数不足');
    expect(reference.notes === null || row.notes!.includes(reference.notes)).toBe(true);
  });

  it('全检验期单窗口 MI 与 permutationMiTest 组合一致（同种子确定性）', () => {
    const dataset = buildDataset();
    const report = rollingWindowTests(dataset, {
      windowSize: 8,
      stepSize: 8,
      methods: ['mutual_information'],
      mi: { bins: 3, permutations: 199, seed: 0 },
    });
    const reference = permutationMiTest(
      dataset.values[0]!,
      dataset.values[1]!,
      { bins: 3, permutations: 199, seed: 0 },
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.statValue).toBeCloseTo(reference.miNats, 9);
    expect(report.rows[0]!.pValue).toBe(reference.pValue);
    expect(report.rows[0]!.effectSize).toBeNull();
  });
});

describe('rollingWindowTests · 退化窗口与接缝校验', () => {
  it('零方差窗口：pearson/spearman/χ²/MI 全部跳过并记录原因', () => {
    const report = rollingWindowTests(buildDataset(), {
      windowSize: 4,
      stepSize: 4,
    });
    // 窗口 2（2024-01-05~08）B 恒定 → 四法皆退化
    expect(report.rows.every((r) => r.windowEnd !== 7)).toBe(true);
    const window2Skips = report.skipped.filter((m) => m.includes('2024-01-08'));
    expect(window2Skips).toHaveLength(4);
    expect(window2Skips.join('\n')).toContain('pearson');
    expect(window2Skips.join('\n')).toContain('spearman');
    expect(window2Skips.join('\n')).toContain('chi_square_independence');
    expect(window2Skips.join('\n')).toContain('mutual_information');
  });

  it('默认四法顺序：配对 × 窗口 × 方法', () => {
    const report = rollingWindowTests(buildDataset(), { windowSize: 8, stepSize: 8 });
    expect(report.rows.map((r) => r.testName)).toEqual([
      'chi_square_independence',
      'pearson',
      'spearman',
      'mutual_information',
    ]);
  });

  it('检验期外的观测不参与滚动', () => {
    const dataset = buildDataset();
    dataset.testIndex = [0, 3];
    const report = rollingWindowTests(dataset, {
      windowSize: 4,
      stepSize: 4,
      methods: ['pearson'],
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.windowEndDate).toBe('2024-01-04');
  });

  it('未知方法拒绝', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rollingWindowTests(buildDataset(), { windowSize: 4, stepSize: 4, methods: ['hsic'] as any }),
    ).toThrow(/方法/);
  });
});
