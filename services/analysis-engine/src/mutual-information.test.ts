/**
 * T11 · 互信息估计 + 置换检验（RED 先行）。
 * 黄金基准对拍：tests/fixtures/stat-reference.json continuous.mutual_information
 * （定义式精确值，自然对数，容差 1e-9）。
 * 置换检验使用播种 PRNG（mulberry32），同种子结果可复现。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  estimateMutualInformation,
  mutualInformationFromCounts,
  permutationMiTest,
} from './mutual-information.js';

interface MiFixtureEntry {
  name: string;
  table: number[][];
  mi_nats: number;
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../tests/fixtures/stat-reference.json', import.meta.url)),
    'utf-8',
  ),
) as { continuous: { mutual_information: MiFixtureEntry[] } };

describe('mutualInformationFromCounts · 黄金基准对拍（容差 1e-9）', () => {
  for (const entry of fixture.continuous.mutual_information) {
    it(entry.name, () => {
      expect(mutualInformationFromCounts(entry.table)).toBeCloseTo(entry.mi_nats, 9);
    });
  }

  it('零计数单元格跳过、非法表拒绝', () => {
    expect(() => mutualInformationFromCounts([[5]])).toThrow(/列联表/);
    expect(() => mutualInformationFromCounts([[1, 2], [3]])).toThrow(/矩形/);
    expect(() => mutualInformationFromCounts([[1, -1], [1, 1]])).toThrow(/频数/);
  });
});

describe('estimateMutualInformation · 等频分箱估计', () => {
  it('完全单调对：2 箱对角表 → MI = ln 2', () => {
    const seq = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(estimateMutualInformation(seq, seq, { bins: 2 })).toBeCloseTo(Math.log(2), 9);
  });

  it('交错独立模式：MI = 0', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = [1, 5, 2, 6, 3, 7, 4, 8];
    expect(estimateMutualInformation(x, y, { bins: 2 })).toBeCloseTo(0, 9);
  });

  it('入参校验：等长、n≥2、bins≥2、零跨度拒绝', () => {
    expect(() => estimateMutualInformation([1, 2], [1], { bins: 2 })).toThrow(/等长/);
    expect(() => estimateMutualInformation([1], [1], { bins: 2 })).toThrow(/样本量/);
    expect(() => estimateMutualInformation([1, 2], [1, 2], { bins: 1 })).toThrow(/箱数/);
    expect(() => estimateMutualInformation([1, 1, 1], [1, 2, 3], { bins: 2 })).toThrow(/跨度/);
  });
});

describe('permutationMiTest · 播种置换检验', () => {
  const n = 30;
  const strongX = Array.from({ length: n }, (_, i) => i + 1);
  const strongY = strongX.map((v, i) => v + (i % 3) * 0.01);
  const indepY = [
    7, 21, 3, 28, 12, 17, 1, 25, 9, 30, 14, 5, 23, 11, 19, 2, 27, 8, 16, 29, 4, 22, 10, 26,
    13, 6, 18, 24, 15, 20,
  ];

  it('同种子可复现（p 值逐位一致）', () => {
    const a = permutationMiTest(strongX, strongY, { bins: 3, permutations: 99, seed: 42 });
    const b = permutationMiTest(strongX, strongY, { bins: 3, permutations: 99, seed: 42 });
    expect(a.pValue).toBe(b.pValue);
    expect(a.miNats).toBe(b.miNats);
  });

  it('强关联 → 小 p；独立排列 → p 显著更大', () => {
    const strong = permutationMiTest(strongX, strongY, { bins: 3, permutations: 99, seed: 42 });
    const indep = permutationMiTest(strongX, indepY, { bins: 3, permutations: 99, seed: 42 });
    expect(strong.pValue).toBeLessThanOrEqual(0.05);
    expect(indep.pValue).toBeGreaterThan(strong.pValue);
  });

  it('p 值下界为 1/(B+1)（加一平滑，永不为零）', () => {
    const strong = permutationMiTest(strongX, strongY, { bins: 3, permutations: 199, seed: 7 });
    expect(strong.pValue).toBeGreaterThanOrEqual(1 / 200);
  });
});
