/**
 * T11 · 连续变量依赖检验可插拔注册表（RED 先行）。
 * PRD 模块 F：可插拔扩展接口，便于后续接入 HSIC 等核独立性检验。
 * 内置方法：pearson / spearman / mutual_information / hsic（副作用注册）。
 */
import { describe, expect, it } from 'vitest';
import {
  getContinuousMethod,
  listContinuousMethodNames,
  registerContinuousMethod,
} from './continuous-registry.js';

describe('continuous-registry · 插件式注册', () => {
  it('内置四方法已注册', () => {
    expect(listContinuousMethodNames().sort()).toEqual([
      'hsic',
      'mutual_information',
      'pearson',
      'spearman',
    ]);
  });

  it('内置方法输出统一 ContinuousDependencyResult 形态', () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = [2, 1, 4, 3, 6, 5];
    for (const name of ['pearson', 'spearman', 'mutual_information', 'hsic'] as const) {
      const result = getContinuousMethod(name).run(x, y);
      expect(result.testName).toBe(name);
      expect(typeof result.statValue).toBe('number');
      expect(result.pValue).toBeGreaterThanOrEqual(0);
      expect(result.pValue).toBeLessThanOrEqual(1);
    }
  });

  it('第三方方法可注册与调用；重复注册拒绝', () => {
    registerContinuousMethod({
      name: 'mock_hsic',
      run: (x, y) => ({
        testName: 'mock_hsic',
        statValue: x.length + y.length,
        pValue: 0.5,
        effectSize: null,
        notes: null,
      }),
    });
    expect(getContinuousMethod('mock_hsic').run([1, 2], [3, 4]).statValue).toBe(4);
    expect(() =>
      registerContinuousMethod({
        name: 'mock_hsic',
        run: () => ({ testName: 'mock_hsic', statValue: 0, pValue: 1, effectSize: null, notes: null }),
      }),
    ).toThrow(/已注册/);
  });

  it('未知方法名抛错', () => {
    expect(() => getContinuousMethod('ghost')).toThrow(/ghost/);
  });
});
