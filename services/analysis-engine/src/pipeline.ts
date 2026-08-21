/**
 * 标准化 + 离散化管道编排（T09）。
 *
 * 处理顺序（PRD 方法学）：
 * 0. 周/月频重采样（S5：原始序列按期末值聚合，日频或缺省不变换）
 * 1. 派生序列计算（收益率/差分各自丢弃首点；比值按公共日期逐点相除不丢首点，S3）
 * 2. 全序列日期对齐（交集、升序）
 * 3. 参考期 / 检验期在对齐轴上定位（闭区间索引）
 * 4. 分箱阈值仅用参考期拟合，全日期轴分箱（检验期复用阈值）
 *
 * 输出 PreparedDataset 是 T10/T11 检验族的直接输入。
 */
import type { BinningConfig, DerivedSeries, PeriodSplit } from '@platform/schemas';
import { alignSeries } from './align.js';
import { assignBins, fitBinning, type FittedBinning } from './binning.js';
import { resampleToFrequency, type ResampleFrequency } from './resample.js';
import { applyRatioTransform, applyTransform } from './transform.js';
import type { NumericSeries } from './types.js';

export interface PrepareDatasetInput {
  series: NumericSeries[];
  derivedSeries: DerivedSeries[];
  periods: PeriodSplit;
  binning: BinningConfig;
  /** 分析频率（S5）：weekly/monthly 时先对原始序列重采样；缺省日频 */
  frequency?: ResampleFrequency;
}

export interface PreparedDataset {
  aliases: string[];
  /** 对齐后的公共日期轴（升序） */
  dates: string[];
  /** values[i] 对应 aliases[i] */
  values: number[][];
  /** 参考期在对齐轴上的闭区间索引 [start, end] */
  referenceIndex: [number, number];
  /** 检验期闭区间索引 */
  testIndex: [number, number];
  /** 各序列的分箱拟合（阈值来自参考期） */
  binning: Record<string, FittedBinning>;
  /** 各序列在全日期轴上的箱序号 */
  categories: Record<string, number[]>;
}

/** 按日期升序复制点集（派生变换依赖时间顺序） */
function sortedPoints(series: NumericSeries): Array<{ date: string; value: number }> {
  return [...series.points].sort((a, b) => a.date.localeCompare(b.date));
}

/** 闭区间 [start, end] 在升序日期轴上的索引范围；无观测返回 null */
function locateWindow(dates: string[], start: string, end: string): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i]!;
    if (date >= start && date <= end) {
      if (first === -1) first = i;
      last = i;
    }
  }
  return first === -1 ? null : [first, last];
}

export function prepareDataset(input: PrepareDatasetInput): PreparedDataset {
  const { derivedSeries, periods, binning } = input;

  // 0. 周/月频重采样（S5）：在派生变换之前聚合，周/月收益率自然为期末价口径；
  //    重采样后日期轴仍为真实观测日，参考/检验期与事件标签定位零适配。
  const baseSeries: NumericSeries[] =
    input.frequency === undefined || input.frequency === 'daily'
      ? input.series
      : resampleToFrequency(input.series, input.frequency);

  // 别名校验：原始 + 派生全局唯一，派生源必须存在
  const rawByAlias = new Map(baseSeries.map((s) => [s.alias, s]));
  const allAliases = [...rawByAlias.keys(), ...derivedSeries.map((d) => d.alias)];
  if (new Set(allAliases).size !== allAliases.length) {
    throw new RangeError('序列别名冲突：原始序列与派生序列别名必须全局唯一');
  }
  for (const derived of derivedSeries) {
    if (!rawByAlias.has(derived.sourceAlias)) {
      throw new RangeError(`派生序列 ${derived.alias} 引用的源序列 ${derived.sourceAlias} 不存在`);
    }
    if (derived.transform === 'ratio') {
      if (derived.denominatorAlias === derived.sourceAlias) {
        throw new RangeError(`派生序列 ${derived.alias} 的分子与分母不得为同一序列（${derived.sourceAlias}）`);
      }
      if (!rawByAlias.has(derived.denominatorAlias!)) {
        throw new RangeError(`派生序列 ${derived.alias} 引用的分母序列 ${derived.denominatorAlias} 不存在`);
      }
    }
  }

  // 1. 派生序列（ratio：公共日期逐点相除不丢首点；其余：单源变换丢首点，S3）
  const computed: NumericSeries[] = derivedSeries.map((derived) => {
    const source = sortedPoints(rawByAlias.get(derived.sourceAlias)!);
    if (derived.transform === 'ratio') {
      const denominator = sortedPoints(rawByAlias.get(derived.denominatorAlias!)!);
      const denByDate = new Map(denominator.map((p) => [p.date, p.value]));
      const common = source.filter((p) => denByDate.has(p.date));
      if (common.length === 0) {
        throw new RangeError(`派生序列 ${derived.alias}：分子与分母无公共日期，无法构造比值`);
      }
      const ratios = applyRatioTransform(
        common.map((p) => p.value),
        common.map((p) => denByDate.get(p.date)!),
      );
      return {
        alias: derived.alias,
        points: common.map((p, i) => ({ date: p.date, value: ratios[i]! })),
      };
    }
    const transformed = applyTransform(
      source.map((p) => p.value),
      derived.transform,
    );
    return {
      alias: derived.alias,
      points: source.slice(1).map((p, i) => ({ date: p.date, value: transformed[i]! })),
    };
  });

  // 2. 对齐（原始在前、派生在后，保持别名稳定顺序）
  const aligned = alignSeries([...baseSeries, ...computed]);

  // 3. 参考期 / 检验期定位
  const referenceIndex = locateWindow(aligned.dates, periods.referenceStart, periods.referenceEnd);
  if (!referenceIndex) {
    throw new RangeError('参考期在对齐日期轴上无观测，无法拟合离散化阈值');
  }
  const testIndex = locateWindow(aligned.dates, periods.testStart, periods.testEnd);
  if (!testIndex) {
    throw new RangeError('检验期在对齐日期轴上无观测，无法执行检验');
  }

  // 4. 参考期拟合 + 全轴分箱
  const fitted: Record<string, FittedBinning> = {};
  const categories: Record<string, number[]> = {};
  aligned.aliases.forEach((alias, i) => {
    const row = aligned.values[i]!;
    const referenceValues = row.slice(referenceIndex[0], referenceIndex[1] + 1);
    fitted[alias] = fitBinning(referenceValues, binning);
    categories[alias] = assignBins(row, fitted[alias]!);
  });

  return {
    aliases: aligned.aliases,
    dates: aligned.dates,
    values: aligned.values,
    referenceIndex,
    testIndex,
    binning: fitted,
    categories,
  };
}
