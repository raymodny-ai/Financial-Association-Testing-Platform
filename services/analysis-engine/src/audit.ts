/**
 * 数据真实性审计引擎（T14，PRD 模块 J）。
 *
 * 六类审计（纯函数，输出对齐 auditRow 9 字段契约）：
 * 1. 缺失值统计（value 为 null/NaN）
 * 2. 重复索引统计（同日期多次出现，计超出次数；清洗保留首次出现）
 * 3. 缺失交易日统计（相邻观测日期之间的工作日缺口，周末不计；
 *    基于日期索引存在性，缺失值当日不计为缺失交易日）
 * 4. stale run：连续相同值 ≥ 3 观测的段计数（价格冻结）
 * 5. 跳点：主规则为日收益率 |pct| > jumpAbsReturnPct；无命中时降级使用
 *    MAD 鲁棒规则兜底（修正 z = 0.6745·(x−median)/MAD，|z| > 3.5，MAD=0 跳过）——
 *    避免高波动样本上 MAD 反把常态波动点误报为跳点
 * 6. 复权差异（原始 vs 复权收盘，相对差 > 1e-9 计标记）
 * 双源审计：主序列拟合等频三分箱阈值，对两源共享日期分箱，
 * 状态一致率 + chiSquareHomogeneity 分布同质性检验（复用 T10）。
 *
 * 状态判定：missingRatio ≥ fail → fail；≥ warn / 有跳点 / 有 stale /
 * 一致率 < sourceMatchRatioWarn → warn；否则 pass。
 */
import type { AuditRow, AuditThresholds } from '@platform/schemas';
import { chiSquareHomogeneity, type ChiSquareResult } from './chi-square.js';
import { quantileLinear } from './binning.js';

export interface AuditPoint {
  date: string;
  /** null/NaN 视为缺失 */
  value: number | null;
}

export interface AuditSeriesInput {
  alias: string;
  points: readonly AuditPoint[];
  thresholds: AuditThresholds;
  /** 复权收盘对照（与原始收盘同日期对账） */
  adjustedPoints?: readonly { date: string; value: number }[];
  /** 双源对照（状态一致率 + 同质性检验） */
  dualSource?: { alias: string; points: readonly AuditPoint[] };
}

export interface AuditReport {
  row: AuditRow;
  /** 风险说明（跳点/stale/缺失/一致率等，供前端风险提示与 LLM 上下文） */
  notes: string[];
  /** 双源同质性检验；单源为 null */
  homogeneity: ChiSquareResult | null;
}

function isMissing(value: number | null): boolean {
  return value === null || Number.isNaN(value);
}

/** 清洗：去缺失、同日期保留首次出现、按日期升序 */
function cleanPoints(points: readonly AuditPoint[]): Array<{ date: string; value: number }> {
  const seen = new Set<string>();
  return [...points]
    .filter((p) => !isMissing(p.value))
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((p) => {
      if (seen.has(p.date)) return false;
      seen.add(p.date);
      return true;
    })
    .map((p) => ({ date: p.date, value: p.value as number }));
}

/** 相邻观测日期之间缺失的工作日数（周一至周五，周末不计） */
function missingBusinessDays(dates: readonly string[]): number {
  let missing = 0;
  for (let i = 1; i < dates.length; i += 1) {
    const cursor = new Date(`${dates[i - 1]}T00:00:00Z`);
    const end = new Date(`${dates[i]}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    while (cursor < end) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) missing += 1;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return missing;
}

/** 连续相同值段计数（段长 ≥ minRun） */
function staleRunCount(values: readonly number[], minRun = 3): number {
  let runs = 0;
  let runLength = 1;
  for (let i = 1; i <= values.length; i += 1) {
    if (i < values.length && values[i] === values[i - 1]) {
      runLength += 1;
    } else {
      if (runLength >= minRun) runs += 1;
      runLength = 1;
    }
  }
  return runs;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 跳点检测：主规则阈值；零命中时降级 MAD 鲁棒规则兜底，返回触发日期 */
function detectJumps(
  clean: Array<{ date: string; value: number }>,
  thresholdPct: number,
): string[] {
  const returns: Array<{ date: string; pct: number }> = [];
  for (let i = 1; i < clean.length; i += 1) {
    const prev = clean[i - 1]!;
    const curr = clean[i]!;
    if (prev.value === 0) continue;
    returns.push({ date: curr.date, pct: ((curr.value - prev.value) / prev.value) * 100 });
  }
  const thresholdHits = returns.filter((r) => Math.abs(r.pct) > thresholdPct);
  if (thresholdHits.length > 0) return thresholdHits.map((r) => r.date);
  const med = returns.length > 0 ? median(returns.map((r) => r.pct)) : 0;
  const mad = returns.length > 0 ? median(returns.map((r) => Math.abs(r.pct - med))) : 0;
  if (mad === 0) return [];
  return returns
    .filter((r) => Math.abs((0.6745 * (r.pct - med)) / mad) > 3.5)
    .map((r) => r.date);
}

/** 复权差异计数：共享日期上相对差 > 1e-9 */
function adjustmentFlags(
  clean: Array<{ date: string; value: number }>,
  adjusted: readonly { date: string; value: number }[],
): number {
  const adjustedByDate = new Map(adjusted.map((p) => [p.date, p.value]));
  let count = 0;
  for (const p of clean) {
    const adj = adjustedByDate.get(p.date);
    if (adj === undefined) continue;
    const scale = Math.max(Math.abs(p.value), Math.abs(adj), 1);
    if (Math.abs(p.value - adj) / scale > 1e-9) count += 1;
  }
  return count;
}

/** 双源一致率 + 同质性：主序列等频三分箱阈值，共享日期分箱对账 */
function dualSourceAudit(
  clean: Array<{ date: string; value: number }>,
  other: readonly AuditPoint[],
): { matchRatio: number; homogeneity: ChiSquareResult | null; note: string | null } {
  const otherClean = cleanPoints(other);
  const otherByDate = new Map(otherClean.map((p) => [p.date, p.value]));
  const shared = clean.filter((p) => otherByDate.has(p.date));
  if (shared.length < 2) {
    return { matchRatio: 1, homogeneity: null, note: '双源共享观测不足 2，跳过一致性审计' };
  }
  const primaryValues = clean.map((p) => p.value);
  const sorted = [...primaryValues].sort((a, b) => a - b);
  if (sorted[0] === sorted[sorted.length - 1]) {
    return { matchRatio: 1, homogeneity: null, note: '主序列零跨度，跳过双源分箱对账' };
  }
  const t1 = quantileLinear(sorted, 1 / 3);
  const t2 = quantileLinear(sorted, 2 / 3);
  const assign = (v: number): number => (v <= t1 ? 0 : v <= t2 ? 1 : 2);

  const binsA: number[] = [];
  const binsB: number[] = [];
  for (const p of shared) {
    binsA.push(assign(p.value));
    binsB.push(assign(otherByDate.get(p.date)!));
  }
  const matches = binsA.filter((b, i) => b === binsB[i]).length;
  const countsA = [0, 0, 0];
  const countsB = [0, 0, 0];
  binsA.forEach((b) => {
    countsA[b] = countsA[b]! + 1;
  });
  binsB.forEach((b) => {
    countsB[b] = countsB[b]! + 1;
  });

  let homogeneity: ChiSquareResult | null = null;
  let note: string | null = null;
  try {
    homogeneity = chiSquareHomogeneity(countsA, countsB);
  } catch {
    note = '双源分箱分布退化（不足 2×2），同质性检验跳过';
  }
  return { matchRatio: matches / shared.length, homogeneity, note };
}

/** 对单个数据源别名执行完整审计（auditRow 9 字段 + 风险说明） */
export function auditSeries(input: AuditSeriesInput): AuditReport {
  const { alias, points, thresholds } = input;
  if (points.length === 0) {
    throw new RangeError('审计点集不得为空（无任何观测）');
  }

  const missingValueCount = points.filter((p) => isMissing(p.value)).length;
  const dateCounts = new Map<string, number>();
  for (const p of points) dateCounts.set(p.date, (dateCounts.get(p.date) ?? 0) + 1);
  const duplicateIndexCount = [...dateCounts.values()].reduce((acc, c) => acc + (c - 1), 0);

  const clean = cleanPoints(points);
  const notes: string[] = [];
  if (clean.length === 0) {
    return {
      row: {
        series_alias: alias,
        missing_value_count: missingValueCount,
        missing_business_days_count: 0,
        duplicate_index_count: duplicateIndexCount,
        stale_run_count: 0,
        jump_count: 0,
        max_abs_return_pct: 0,
        adjustment_flag_count: 0,
        source_match_ratio: 1,
        audit_status: 'fail',
      },
      notes: ['全部观测缺失，无法执行审计'],
      homogeneity: null,
    };
  }

  // 缺失交易日基于日期索引存在性（含缺失值日，值缺失不代表交易日缺失）
  const observedDates = [...new Set(points.map((p) => p.date))].sort();
  const missingBusinessDaysCount = missingBusinessDays(observedDates);
  const staleRuns = staleRunCount(clean.map((p) => p.value));

  const returns: number[] = [];
  for (let i = 1; i < clean.length; i += 1) {
    if (clean[i - 1]!.value !== 0) {
      returns.push(((clean[i]!.value - clean[i - 1]!.value) / clean[i - 1]!.value) * 100);
    }
  }
  const maxAbsReturnPct = returns.length > 0 ? Math.max(...returns.map(Math.abs)) : 0;
  const jumpDates = detectJumps(clean, thresholds.jumpAbsReturnPct);

  const adjustmentFlagCount = input.adjustedPoints
    ? adjustmentFlags(clean, input.adjustedPoints)
    : 0;

  let sourceMatchRatio = 1;
  let homogeneity: ChiSquareResult | null = null;
  if (input.dualSource) {
    const dual = dualSourceAudit(clean, input.dualSource.points);
    sourceMatchRatio = dual.matchRatio;
    homogeneity = dual.homogeneity;
    if (dual.note) notes.push(dual.note);
  }

  // 风险说明（PRD：不满足前提必须明确警告）
  const missingRatio = missingValueCount / points.length;
  if (jumpDates.length > 0) {
    notes.push(`跳点 ${jumpDates.length} 处（${jumpDates.join('、')}）：超过阈值或 MAD 鲁棒兜底规则`);
  }
  if (staleRuns > 0) notes.push(`stale run ${staleRuns} 段：连续 ≥3 观测价格冻结`);
  if (missingBusinessDaysCount > 0) notes.push(`缺失交易日 ${missingBusinessDaysCount} 天`);
  if (duplicateIndexCount > 0) notes.push(`重复索引 ${duplicateIndexCount} 条（保留首次出现）`);
  if (missingRatio >= thresholds.missingRatioWarn) {
    notes.push(`缺失占比 ${(missingRatio * 100).toFixed(2)}% 达到警告阈值`);
  }
  if (sourceMatchRatio < thresholds.sourceMatchRatioWarn) {
    notes.push(`双源状态一致率 ${(sourceMatchRatio * 100).toFixed(1)}% 低于阈值`);
  }
  if (adjustmentFlagCount > 0) notes.push(`复权差异 ${adjustmentFlagCount} 处`);

  const fail = missingRatio >= thresholds.missingRatioFail;
  const warn =
    missingRatio >= thresholds.missingRatioWarn ||
    jumpDates.length > 0 ||
    staleRuns > 0 ||
    sourceMatchRatio < thresholds.sourceMatchRatioWarn;

  return {
    row: {
      series_alias: alias,
      missing_value_count: missingValueCount,
      missing_business_days_count: missingBusinessDaysCount,
      duplicate_index_count: duplicateIndexCount,
      stale_run_count: staleRuns,
      jump_count: jumpDates.length,
      max_abs_return_pct: maxAbsReturnPct,
      adjustment_flag_count: adjustmentFlagCount,
      source_match_ratio: sourceMatchRatio,
      audit_status: fail ? 'fail' : warn ? 'warn' : 'pass',
    },
    notes,
    homogeneity,
  };
}
