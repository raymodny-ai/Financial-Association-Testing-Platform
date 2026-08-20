/**
 * T09 · 派生序列变换（RED 先行）。
 * 行为契约：pct_return / log_return / diff，首个观测点被丢弃（无前值）。
 */
import { describe, expect, it } from 'vitest';
import { applyTransform } from './transform.js';

describe('applyTransform', () => {
  it('pct_return：相邻百分比收益率，丢弃首点', () => {
    const out = applyTransform([100, 110, 99], 'pct_return');
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(0.1, 10);
    expect(out[1]).toBeCloseTo(-0.1, 10);
  });

  it('log_return：对数收益率', () => {
    const out = applyTransform([100, 110], 'log_return');
    expect(out).toHaveLength(1);
    expect(out[0]).toBeCloseTo(Math.log(1.1), 12);
  });

  it('diff：一阶差分', () => {
    expect(applyTransform([10, 12, 9], 'diff')).toEqual([2, -3]);
  });

  it('样本不足 2 点抛错', () => {
    expect(() => applyTransform([100], 'pct_return')).toThrow(/至少 2 个观测值/);
    expect(() => applyTransform([], 'diff')).toThrow(/至少 2 个观测值/);
  });

  it('收益率变换遇非正前值抛错（对数/除法无定义）', () => {
    expect(() => applyTransform([0, 10], 'pct_return')).toThrow(/非正/);
    expect(() => applyTransform([10, -5], 'log_return')).toThrow(/非正/);
  });
});
