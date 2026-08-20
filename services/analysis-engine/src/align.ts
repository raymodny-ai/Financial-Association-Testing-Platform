/**
 * 多序列日期对齐（T09）。
 * 交集语义：任一序列缺失的日期整行剔除（成对完整观测，检验前提）。
 */
import type { AlignedPanel, NumericSeries } from './types.js';

export function alignSeries(seriesList: readonly NumericSeries[]): AlignedPanel {
  if (seriesList.length === 0) {
    throw new RangeError('对齐需要至少 1 条序列');
  }

  // 逐序列建索引（同时校验重复日期）
  const indexed = seriesList.map((s) => {
    const map = new Map<string, number>();
    for (const point of s.points) {
      if (map.has(point.date)) {
        throw new RangeError(`序列 ${s.alias} 存在重复日期 ${point.date}`);
      }
      map.set(point.date, point.value);
    }
    return { alias: s.alias, map };
  });

  // 公共日期 = 全部序列日期集合的交集，升序
  const commonDates = [...indexed[0]!.map.keys()]
    .filter((date) => indexed.every((s) => s.map.has(date)))
    .sort();

  if (commonDates.length === 0) {
    throw new RangeError('序列之间无公共日期，无法对齐');
  }

  return {
    aliases: indexed.map((s) => s.alias),
    dates: commonDates,
    values: indexed.map((s) => commonDates.map((date) => s.map.get(date)!)),
  };
}
