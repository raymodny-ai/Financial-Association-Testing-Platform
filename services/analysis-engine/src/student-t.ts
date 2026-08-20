/**
 * t 分布生存函数（T11）。
 *
 * 定案（ADR 001）：jstat 仅承担分布函数。实测 jstat studentt.cdf
 * 在 df=1 时精度仅 ~1.5e-9，不达容差；因此 df≤2 改用解析闭式解
 * （精确到浮点极限），df≥3 才经 jstat：
 * - df=1：sf(t) = 0.5 − atan(t)/π
 * - df=2：sf(t) = 0.5·(1 − t/√(t²+2))
 * 双侧 p = 2·sf(|t|, df)；验证见 student-t.test.ts。
 */
// ambient 声明无法经 import 传播；三斜线引用让 jstat.d.ts 随源文件进入消费方工程
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./jstat.d.ts" />
import jstat from 'jstat';

const { studentt } = jstat;

export function studentTSf(t: number, degreesOfFreedom: number): number {
  if (!Number.isInteger(degreesOfFreedom) || degreesOfFreedom < 1) {
    throw new RangeError(`自由度须为正整数（收到 ${degreesOfFreedom}）`);
  }
  if (typeof t !== 'number' || Number.isNaN(t)) {
    throw new RangeError(`t 统计量须为有效数值（收到 ${t}）`);
  }
  if (degreesOfFreedom === 1) {
    return 0.5 - Math.atan(t) / Math.PI;
  }
  if (degreesOfFreedom === 2) {
    return 0.5 * (1 - t / Math.sqrt(t * t + 2));
  }
  return 1 - studentt.cdf(t, degreesOfFreedom);
}
