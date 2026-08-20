/**
 * T11 · t 分布生存函数（RED 先行）。
 * 定案：jstat 仅承担分布函数（ADR 001）。用 df=1/2 的解析闭式解校验
 * jstat 包装（容差 1e-9），达标后作为相关系数 p 值的计算通道：
 * - df=1：sf(t) = 0.5 − atan(t)/π（t ≥ 0）
 * - df=2：sf(t) = 0.5·(1 − t/√(t²+2))（t ≥ 0）
 */
import { describe, expect, it } from 'vitest';
import { studentTSf } from './student-t.js';

describe('studentTSf · 对拍闭式解（ADR 容差 1e-9）', () => {
  it('df=1 与 atan 闭式一致', () => {
    for (const t of [0.5, 1.0, 2.117, 6.3138]) {
      const expected = 0.5 - Math.atan(t) / Math.PI;
      expect(studentTSf(t, 1)).toBeCloseTo(expected, 9);
    }
  });

  it('df=2 与有理闭式一致', () => {
    for (const t of [0.4714, 1.0, 2.92, 4.3027]) {
      const expected = 0.5 * (1 - t / Math.sqrt(t * t + 2));
      expect(studentTSf(t, 2)).toBeCloseTo(expected, 9);
    }
  });

  it('df≥3 走 jstat 通道：中点 0.5、单调递减、与 df=2 粗粒度交叉（jstat 精度 ~5e-9，缺口 N9）', () => {
    expect(studentTSf(0, 3)).toBeCloseTo(0.5, 7);
    expect(studentTSf(1, 3)).toBeLessThan(0.5);
    expect(studentTSf(2, 3)).toBeLessThan(studentTSf(1, 3));
    // 同 t 下 df 越大尾越轻（趋近正态）：sf(t,4) < sf(t,2)
    expect(studentTSf(2, 4)).toBeLessThan(0.5 * (1 - 2 / Math.sqrt(6)));
  });

  it('对称性：sf(-t, df) = 1 − sf(t, df)', () => {
    expect(studentTSf(-1.5, 2)).toBeCloseTo(1 - studentTSf(1.5, 2), 9);
  });

  it('非法入参抛错', () => {
    expect(() => studentTSf(1, 0)).toThrow(/自由度/);
    expect(() => studentTSf(Number.NaN, 2)).toThrow(/统计量/);
  });
});
