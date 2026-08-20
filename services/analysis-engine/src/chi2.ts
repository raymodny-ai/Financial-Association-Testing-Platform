/**
 * 卡方分布生存函数（T10）。
 *
 * 定案（ADR 001）：jstat 仅承担分布函数，统计量一律 TS 自实现。
 * sf(x, df) = P(χ² > x)，即检验 p 值的计算通道；
 * 正确性由 chi2.test.ts 对偶数自由度闭式解 + 奇数自由度不完全伽马真值对拍（容差 1e-9）。
 */
// ambient 声明无法经 import 传播；三斜线引用让 jstat.d.ts 随源文件进入消费方工程
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./jstat.d.ts" />
import jstat from 'jstat';

const { chisquare } = jstat;

export function chi2sf(statistic: number, degreesOfFreedom: number): number {
  if (!Number.isInteger(degreesOfFreedom) || degreesOfFreedom < 1) {
    throw new RangeError(`自由度须为正整数（收到 ${degreesOfFreedom}）`);
  }
  if (!(statistic >= 0) || Number.isNaN(statistic)) {
    throw new RangeError(`卡方统计量须为非负数（收到 ${statistic}）`);
  }
  return 1 - chisquare.cdf(statistic, degreesOfFreedom);
}
