/**
 * 多重检验校正（T12，PRD 模块 I）。
 *
 * 语义对齐 statsmodels.stats.multitest.multipletests：
 * - bonferroni：adj = min(p·m, 1)
 * - bh（Benjamini-Hochberg FDR）：按 p 升序 step-up，
 *   adj_k = min_{i≥k} min(p_(i)·m/i, 1)（累积最小保证单调）
 * - by（Benjamini-Yekutieli）：同 bh 但乘 c(m) = Σ 1/i（任意依赖下控 FDR）
 * - none：原样保留
 *
 * 结果层同时保留 p_value_raw 与 p_value_adjusted（PRD），
 * significant 以校正后 p 值与 alpha 比较（见 result.ts 契约注释）。
 * 黄金基准对拍见 correction.test.ts（容差 1e-9）。
 */
import type { CorrectionMethod } from '@platform/schemas';

const METHODS: readonly CorrectionMethod[] = ['none', 'bonferroni', 'bh', 'by'];

function validateInputs(pValues: readonly number[], method: string): void {
  if (!METHODS.includes(method as CorrectionMethod)) {
    throw new RangeError(`未知校正方法（收到 ${method}，支持 ${METHODS.join(' / ')}）`);
  }
  for (const p of pValues) {
    if (typeof p !== 'number' || Number.isNaN(p) || p < 0 || p > 1) {
      throw new RangeError(`p 值须为 [0,1] 内的有效数值（收到 ${p}）`);
    }
  }
}

/** step-up 校正（bh factor=1；by factor=c(m)），结果按输入位置还原 */
function stepUp(pValues: readonly number[], factor: number): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjSorted = new Array<number>(m);
  let running = 1;
  for (let k = m - 1; k >= 0; k -= 1) {
    const v = Math.min((order[k]!.p * m * factor) / (k + 1), 1);
    running = Math.min(running, v);
    adjSorted[k] = running;
  }
  const out = new Array<number>(m);
  order.forEach((o, rank) => {
    out[o.i] = adjSorted[rank]!;
  });
  return out;
}

/** 调和数 c(m) = Σ_{i=1}^m 1/i（BY 校正因子） */
function harmonic(m: number): number {
  let sum = 0;
  for (let i = 1; i <= m; i += 1) sum += 1 / i;
  return sum;
}

/**
 * 对一组原始 p 值施加多重检验校正，返回与输入同序的校正后 p 值。
 * 'none' 返回副本（调用方可安全写回结果长表的 p_value_adjusted）。
 */
export function adjustPValues(pValues: readonly number[], method: CorrectionMethod): number[] {
  validateInputs(pValues, method);
  if (method === 'none') return [...pValues];
  if (method === 'bonferroni') return pValues.map((p) => Math.min(p * pValues.length, 1));
  if (method === 'by') return stepUp(pValues, harmonic(pValues.length));
  return stepUp(pValues, 1);
}

export interface CorrectedBatch {
  /** 校正后 p 值（与输入同序，写入 p_value_adjusted） */
  adjusted: number[];
  /** 校正后 p < alpha 为显著（写入 significant） */
  significant: boolean[];
}

/**
 * 校正 + 显著性标记一次产出（结果长表 p_value_adjusted / significant 双字段接缝）。
 * alpha 须为 (0,1) 开区间内数值，与 taskOptionsSchema.alpha 同口径。
 */
export function correctAndMark(
  pValues: readonly number[],
  method: CorrectionMethod,
  alpha: number,
): CorrectedBatch {
  if (typeof alpha !== 'number' || Number.isNaN(alpha) || alpha <= 0 || alpha >= 1) {
    throw new RangeError(`alpha 须为 (0,1) 内的有效数值（收到 ${alpha}）`);
  }
  const adjusted = adjustPValues(pValues, method);
  return { adjusted, significant: adjusted.map((p) => p < alpha) };
}
