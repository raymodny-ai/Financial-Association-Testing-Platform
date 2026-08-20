/**
 * P0-1 · 滞后分析引擎（RED 先行，PRD 模块 H / 关闭 N13）。
 * 黄金基准对拍：tests/fixtures/stat-reference.json lag_scan（有理数闭式，容差 1e-9）。
 *
 * 约定：lag=k（k>0）表示 x 领先 y k 期 —— 相关对为 x[0..n-1-k] 与 y[k..n-1]；
 * k<0 对称（x 滞后 y）；k=0 同期。每个 lag 输出 Pearson r / p 值 / 样本量，
 * 并给出最大绝对相关对应的 bestLag（并列取 |lag| 更小者）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pearsonTest } from './correlation.js';
import { lagScan } from './lag.js';

interface LagFixture {
  x: number[];
  y: number[];
  expected: Record<string, { r: number; n: number }>;
}

const fixture = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../tests/fixtures/stat-reference.json', import.meta.url)),
      'utf-8',
    ),
  ) as { lag_scan: LagFixture }
).lag_scan;

describe('lagScan · 黄金基准对拍', () => {
  it('lag 0 / ±1 的 Pearson r 与样本量（闭式 r=31/35 与 r=0.8，容差 1e-9）', () => {
    const result = lagScan(fixture.x, fixture.y, 1);
    const byLag = new Map(result.points.map((p) => [p.lag, p]));
    expect(byLag.get(0)!.r).toBeCloseTo(fixture.expected.lag0!.r, 12);
    expect(byLag.get(0)!.n).toBe(fixture.expected.lag0!.n);
    expect(byLag.get(1)!.r).toBeCloseTo(fixture.expected.lag1!.r, 12);
    expect(byLag.get(1)!.n).toBe(fixture.expected.lag1!.n);
    expect(byLag.get(-1)!.r).toBeCloseTo(fixture.expected['lag-1']!.r, 12);
    expect(byLag.get(-1)!.n).toBe(fixture.expected['lag-1']!.n);
  });
});

describe('lagScan · 结构不变量', () => {
  const x = Array.from({ length: 40 }, (_, i) => Math.sin(i * 0.7) * 2 + i * 0.05);
  const y = Array.from({ length: 40 }, (_, i) => Math.cos(i * 0.5) * 1.5 + i * 0.03);

  it('points 覆盖 [-maxLag, +maxLag] 全整数 lag 且升序', () => {
    const result = lagScan(x, y, 5);
    expect(result.points.map((p) => p.lag)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
  });

  it('每个 lag 点等价于对切片直接 pearsonTest（r/p/n 一致）', () => {
    const maxLag = 3;
    const result = lagScan(x, y, maxLag);
    for (const point of result.points) {
      const k = Math.abs(point.lag);
      const xs = point.lag >= 0 ? x.slice(0, x.length - k) : x.slice(k);
      const ys = point.lag >= 0 ? y.slice(k) : y.slice(0, y.length - k);
      const direct = pearsonTest(xs, ys);
      expect(point.r).toBe(direct.r);
      expect(point.pValue).toBe(direct.pValue);
      expect(point.n).toBe(direct.n);
    }
  });

  it('bestLag 为最大绝对相关对应 lag（并列取 |lag| 更小者）', () => {
    const result = lagScan(x, y, 5);
    const maxAbs = Math.max(...result.points.map((p) => Math.abs(p.r)));
    const best = result.points.find((p) => p.lag === result.bestLag)!;
    expect(Math.abs(best.r)).toBeCloseTo(maxAbs, 12);
    expect(result.bestAbsR).toBeCloseTo(maxAbs, 12);
  });
});

describe('lagScan · 领先—滞后结构与退化处理', () => {
  it('完美领先结构：y[i]=x[i-1]（非单调序列）→ lag=1 处 |r|=1 且 bestLag=1', () => {
    // 非单调序列避免 lag=0 也恰好完全相关（等差序列同期 r 也为 1）
    const x = [3, 1, 4, 1, 5, 9, 2, 6];
    const y = [0, 3, 1, 4, 1, 5, 9, 2];
    const result = lagScan(x, y, 2);
    const at1 = result.points.find((p) => p.lag === 1)!;
    expect(Math.abs(at1.r)).toBeCloseTo(1, 12);
    expect(result.bestLag).toBe(1);
  });

  it('切片后退化为零方差的 lag 点被跳过（不产出、不中断）', () => {
    const x = [1, 2, 3, 4, 5, 6];
    // lag=2 切片 y[2..5] 全为 7 → 零方差 → 跳过
    const y = [3, 5, 7, 7, 7, 7];
    const result = lagScan(x, y, 3);
    expect(result.points.some((p) => p.lag === 2)).toBe(false);
    expect(result.points.some((p) => p.lag === 0)).toBe(true);
  });

  it('maxLag=0 → 仅产出 lag=0 单点', () => {
    const result = lagScan([1, 2, 3, 4], [4, 3, 2, 1], 0);
    expect(result.points.map((p) => p.lag)).toEqual([0]);
    expect(result.points[0]!.r).toBeCloseTo(-1, 12);
  });
});

describe('lagScan · 参数校验', () => {
  it('两序列不等长 → RangeError', () => {
    expect(() => lagScan([1, 2, 3, 4], [1, 2, 3], 1)).toThrow(RangeError);
  });
  it('maxLag < 0 → RangeError', () => {
    expect(() => lagScan([1, 2, 3, 4], [1, 2, 3, 4], -1)).toThrow(RangeError);
  });
  it('切片后样本量 < 3（n - maxLag < 3）→ RangeError', () => {
    expect(() => lagScan([1, 2, 3, 4], [4, 3, 2, 1], 2)).toThrow(RangeError);
  });
});
