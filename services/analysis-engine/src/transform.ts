/**
 * 派生序列变换（T09，ratio 为 S3 扩展）。
 * pct_return / log_return / diff：一律丢弃首个观测值（无前值可比）。
 * ratio：两序列同时刻逐点相除，无相邻依赖，不丢首点。
 */
export type TransformKind = 'pct_return' | 'log_return' | 'diff';

export function applyTransform(values: readonly number[], kind: TransformKind): number[] {
  if (values.length < 2) {
    throw new RangeError(`派生变换需要至少 2 个观测值（收到 ${values.length} 个）`);
  }
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1]!;
    const curr = values[i]!;
    if (kind === 'diff') {
      out.push(curr - prev);
      continue;
    }
    if (prev <= 0 || curr <= 0) {
      throw new RangeError(`收益率变换要求全部观测值为正（索引 ${i - 1} 或 ${i} 非正）`);
    }
    out.push(kind === 'pct_return' ? curr / prev - 1 : Math.log(curr / prev));
  }
  return out;
}

/** 比值序列（S3）：分子/分母逐点相除；调用方负责日期对齐后再传入 */
export function applyRatioTransform(
  numerator: readonly number[],
  denominator: readonly number[],
): number[] {
  if (numerator.length === 0) {
    throw new RangeError('比值变换需要至少 1 个观测值');
  }
  if (numerator.length !== denominator.length) {
    throw new RangeError(
      `比值变换要求分子/分母等长（收到 ${numerator.length} 与 ${denominator.length}）`,
    );
  }
  const out: number[] = [];
  for (let i = 0; i < numerator.length; i += 1) {
    const den = denominator[i]!;
    if (den === 0) {
      throw new RangeError(`比值变换分母为零（索引 ${i}，除法无定义）`);
    }
    out.push(numerator[i]! / den);
  }
  return out;
}
