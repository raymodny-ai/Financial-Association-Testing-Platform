/**
 * 周频/月频重采样（S5，PRD「日频为主、周频与月频兼容」）。
 *
 * 口径（金融惯例）：
 * - 周频：按 ISO 周分桶（周一为界，用日期轴整数天数整除 7 对齐，
 *   1970-01-01 恰为周四，天然形成周一~周日桶），桶值取期末（桶内最后一个观测）；
 * - 月频：按日历月前缀（YYYY-MM）分桶，同口径取期末值；
 * - 日期标签保留桶内最后观测的真实日期（日期轴始终为真实观测日，
 *   事件标签与参考/检验期定位无需任何适配）；
 * - 日频：原样返回。
 *
 * 重采样发生在派生变换之前（见 pipeline），故周/月收益率 = 期末价/期末价 − 1。
 */
import type { NumericSeries } from './types.js';

export type ResampleFrequency = 'daily' | 'weekly' | 'monthly';

const DAY_MS = 86_400_000;

/** ISO 周桶键：该日期所在周的周一（纪元 1970-01-01 为周四，dow 4=周一，回退 (dow+3)%7 天） */
function isoWeekKey(date: string): string {
  const utc = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  const days = Math.floor(utc / DAY_MS);
  const dow = (((days % 7) + 7) % 7);
  const monday = new Date((days - ((dow + 3) % 7)) * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/** 月桶键：日历月前缀 */
function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * 将原始序列重采样到目标频率（纯函数，输入乱序自动整理）。
 * 返回与输入同序、同别名的新序列数组。
 */
export function resampleToFrequency(
  seriesList: readonly NumericSeries[],
  frequency: ResampleFrequency,
): NumericSeries[] {
  if (frequency === 'daily') {
    return seriesList.map((s) => ({
      alias: s.alias,
      points: [...s.points].sort((a, b) => a.date.localeCompare(b.date)),
    }));
  }
  const bucketKey = frequency === 'weekly' ? isoWeekKey : monthKey;
  return seriesList.map((s) => {
    if (s.points.length === 0) {
      throw new RangeError(`序列 ${s.alias} 无观测，重采样需要至少 1 个观测点`);
    }
    const sorted = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
    const points: Array<{ date: string; value: number }> = [];
    let currentKey = '';
    for (const point of sorted) {
      const key = bucketKey(point.date);
      if (key !== currentKey) {
        points.push({ date: point.date, value: point.value });
        currentKey = key;
      } else {
        points[points.length - 1] = { date: point.date, value: point.value }; // 期末覆盖
      }
    }
    return { alias: s.alias, points };
  });
}
