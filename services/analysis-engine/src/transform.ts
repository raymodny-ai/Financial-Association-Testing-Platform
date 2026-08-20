/**
 * 派生序列变换（T09）。
 * pct_return / log_return / diff：一律丢弃首个观测值（无前值可比）。
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
