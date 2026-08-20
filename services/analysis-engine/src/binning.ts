/**
 * 分箱离散化（T09，PRD 方法学默认：分位数三分）。
 *
 * 语义（PRD「配置设计」）：阈值在参考期拟合（fitBinning），检验期原样复用
 * （assignBins），保证「参考期定阈值、检验期复用」的可复现方法学。
 *
 * quantileLinear 与 numpy.quantile(method='linear') 完全一致：
 * pos = q*(n-1)，在排序样本上线性插值；黄金基准对拍容差 1e-9
 * （tests/fixtures/stat-reference.json）。
 */
import type { BinningConfig } from '@platform/schemas';

/** 拟合结果：升序阈值（bins-1 个）+ 与桶数等长的标签 */
export interface FittedBinning {
  thresholds: number[];
  labels: string[];
}

/** numpy 线性插值分位数（q ∈ [0,1]） */
export function quantileLinear(values: readonly number[], q: number): number {
  if (values.length === 0) {
    throw new RangeError('分位数计算需要至少 1 个观测值');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const frac = pos - lo;
  return sorted[lo]! + frac * (sorted[hi]! - sorted[lo]!);
}

/** 参考期拟合分箱阈值与标签 */
export function fitBinning(referenceValues: readonly number[], config: BinningConfig): FittedBinning {
  const { method, bins, labels } = config;

  if (labels && labels.length !== bins) {
    throw new RangeError(`标签数量（${labels.length}）须与桶数（${bins}）一致`);
  }
  if (referenceValues.length < bins) {
    throw new RangeError(
      `参考期观测值不足：${referenceValues.length} 个观测值无法拟合 ${bins} 箱`,
    );
  }

  const sorted = [...referenceValues].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  if (min === max) {
    throw new RangeError('参考期观测值零跨度（全部相同），无法离散化');
  }

  const thresholds: number[] = [];
  if (method === 'quantile') {
    for (let k = 1; k < bins; k += 1) {
      thresholds.push(quantileLinear(sorted, k / bins));
    }
  } else if (method === 'equal_width') {
    const width = (max - min) / bins;
    for (let k = 1; k < bins; k += 1) {
      thresholds.push(min + k * width);
    }
  } else {
    // fixed_threshold：契约缺 thresholds 字段（缺口 N7），MVP 不支持
    throw new RangeError(`MVP 暂不支持分箱方法：${method}`);
  }

  return {
    thresholds,
    labels: labels ?? Array.from({ length: bins }, (_, i) => `bin_${i + 1}`),
  };
}

/** 按拟合阈值分箱：value ≤ 阈值归入下箱；越界值归入首/末箱 */
export function assignBins(values: readonly number[], fitted: FittedBinning): number[] {
  return values.map((value) => {
    let bin = 0;
    while (bin < fitted.thresholds.length && value > fitted.thresholds[bin]!) {
      bin += 1;
    }
    return bin;
  });
}
