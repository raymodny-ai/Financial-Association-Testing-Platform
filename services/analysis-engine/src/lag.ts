/**
 * 滞后分析引擎（PRD 模块 H，关闭 N13）。
 *
 * 对 [-maxLag, +maxLag] 全整数 lag 扫描 Pearson 相关：
 * lag=k（k>0）表示 x 领先 y k 期 —— 相关对为 x[0..n-1-k] 与 y[k..n-1]；
 * k<0 对称（x 滞后 y）；k=0 同期。
 * 切片后退化（零方差 / 样本量 <3）的 lag 点跳过不产出，不中断扫描。
 */
import { pearsonTest } from './correlation.js';

export interface LagPoint {
  /** 滞后期（正：x 领先 y；负：x 滞后 y；0：同期） */
  lag: number;
  /** Pearson 相关系数 */
  r: number;
  /** 双侧 p 值（t 近似，同 pearsonTest） */
  pValue: number;
  /** 该 lag 切片后的样本量（n − |lag|） */
  n: number;
}

export interface LagScanResult {
  /** 按 lag 升序；退化切片对应 lag 缺省 */
  points: LagPoint[];
  /** 最大绝对相关对应的 lag（并列取 |lag| 更小者） */
  bestLag: number;
  /** bestLag 处的 |r| */
  bestAbsR: number;
}

export function lagScan(
  x: readonly number[],
  y: readonly number[],
  maxLag: number,
): LagScanResult {
  if (x.length !== y.length) {
    throw new RangeError(`两序列须等长（收到 ${x.length} 与 ${y.length}）`);
  }
  if (!Number.isInteger(maxLag) || maxLag < 0) {
    throw new RangeError(`maxLag 须为非负整数（收到 ${maxLag}）`);
  }
  if (x.length - maxLag < 3) {
    throw new RangeError(`样本量不足以支撑 maxLag=${maxLag}（切片后 <3）`);
  }

  const points: LagPoint[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const k = Math.abs(lag);
    const lagValue = k === 0 ? 0 : lag; // 避免 -maxLag=-0 时产生 -0
    const xs = lag >= 0 ? x.slice(0, x.length - k) : x.slice(k);
    const ys = lag >= 0 ? y.slice(k) : y.slice(0, y.length - k);
    try {
      const test = pearsonTest(xs, ys);
      points.push({ lag: lagValue, r: test.r, pValue: test.pValue, n: test.n });
    } catch {
      // 零方差等退化切片：跳过该 lag（PRD 允许缺口，不中断扫描）
    }
  }

  if (points.length === 0) {
    throw new RangeError('全部 lag 切片退化（如零方差），无有效滞后点');
  }

  // 最大 |r|；并列取 |lag| 更小者（points 已升序，stable sort 保证先出现的胜出）
  const best = [...points].sort(
    (a, b) => Math.abs(b.r) - Math.abs(a.r) || Math.abs(a.lag) - Math.abs(b.lag),
  )[0]!;
  return { points, bestLag: best.lag, bestAbsR: Math.abs(best.r) };
}
