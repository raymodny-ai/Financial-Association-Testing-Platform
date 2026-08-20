/**
 * 连续变量依赖检验可插拔注册表（T11，PRD 模块 F）。
 *
 * 统一契约 ContinuousDependencyMethod：name + run(x, y) → 统一结果形态，
 * 与结果长表字段对齐（statValue / pValue / effectSize / notes）。
 * 内置 pearson / spearman / mutual_information（模块尾部副作用注册），
 * HSIC 等后续方法经 registerContinuousMethod 插入，无需改动调用方。
 *
 * mutual_information 的置换检验默认参数：bins=3（PRD 三分默认）、
 * permutations=199、seed=0（确定性可复现）。
 */
import { pearsonTest, spearmanTest } from './correlation.js';
import { permutationMiTest } from './mutual-information.js';

export interface ContinuousDependencyResult {
  testName: string;
  statValue: number;
  pValue: number;
  effectSize: number | null;
  notes: string | null;
}

export interface ContinuousDependencyMethod {
  readonly name: string;
  run(x: readonly number[], y: readonly number[]): ContinuousDependencyResult;
}

const registry = new Map<string, ContinuousDependencyMethod>();

export function registerContinuousMethod(method: ContinuousDependencyMethod): void {
  if (registry.has(method.name)) {
    throw new RangeError(`连续变量检验方法 ${method.name} 已注册`);
  }
  registry.set(method.name, method);
}

export function getContinuousMethod(name: string): ContinuousDependencyMethod {
  const method = registry.get(name);
  if (!method) {
    throw new RangeError(`未知连续变量检验方法：${name}`);
  }
  return method;
}

export function listContinuousMethodNames(): string[] {
  return [...registry.keys()];
}

registerContinuousMethod({
  name: 'pearson',
  run: (x, y) => {
    const result = pearsonTest(x, y);
    return {
      testName: 'pearson',
      statValue: result.r,
      pValue: result.pValue,
      effectSize: result.r,
      notes: null,
    };
  },
});

registerContinuousMethod({
  name: 'spearman',
  run: (x, y) => {
    const result = spearmanTest(x, y);
    return {
      testName: 'spearman',
      statValue: result.r,
      pValue: result.pValue,
      effectSize: result.r,
      notes: null,
    };
  },
});

registerContinuousMethod({
  name: 'mutual_information',
  run: (x, y) => {
    const result = permutationMiTest(x, y, { bins: 3, permutations: 199, seed: 0 });
    return {
      testName: 'mutual_information',
      statValue: result.miNats,
      pValue: result.pValue,
      effectSize: null,
      notes: `等频 3 箱离散化 + 置换检验 B=${result.permutations}（seed=0）`,
    };
  },
});
