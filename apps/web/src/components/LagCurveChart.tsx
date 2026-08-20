/**
 * 滞后曲线图（PRD 模块 H：lag 曲线图视图）。
 *
 * 零依赖 SVG 实现（项目未引入图表库；色板一律 @platform/ui tokens --chart-series-*）。
 * 横轴 = lag（左序列领先右序列的期数，正=领先 / 负=滞后于），纵轴 = Pearson r ∈ [-1, 1]。
 * 每个「左×右」变量对一条折线，显著点（p_adj < alpha）以实心圆加重。
 */
import { useMemo } from 'react';
import type { ResultRow } from '@platform/schemas';

interface LagCurveChartProps {
  /** 滞后行（test_name === 'pearson_lag'，window_end === null） */
  rows: readonly ResultRow[];
  /** 图表可视高度（px），宽度自适应容器 */
  height?: number;
}

/** tokens.css --chart-series-1..6 循环取色（与 ECharts/D3 序列色一致） */
const SERIES_COLORS = [
  'var(--chart-series-1)',
  'var(--chart-series-2)',
  'var(--chart-series-3)',
  'var(--chart-series-4)',
  'var(--chart-series-5)',
  'var(--chart-series-6)',
];

interface Series {
  key: string;
  color: string;
  points: Array<{ lag: number; r: number; significant: boolean }>;
}

export default function LagCurveChart({ rows, height = 300 }: LagCurveChartProps) {
  const series = useMemo<Series[]>(() => {
    const groups = new Map<string, ResultRow[]>();
    for (const r of rows) {
      const key = `${r.left_series}×${r.right_series}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return [...groups.entries()].map(([key, group], i) => ({
      key,
      color: SERIES_COLORS[i % SERIES_COLORS.length]!,
      points: group
        .map((r) => ({ lag: r.lag, r: r.stat_value, significant: r.significant }))
        .sort((a, b) => a.lag - b.lag),
    }));
  }, [rows]);

  // 画布坐标：viewBox 固定逻辑尺寸，实际渲染随容器缩放
  const W = 760;
  const H = height;
  const PAD = { top: 20, right: 24, bottom: 40, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const lags = series.flatMap((s) => s.points.map((p) => p.lag));
  const minLag = Math.min(...lags);
  const maxLag = Math.max(...lags);
  const lagSpan = Math.max(maxLag - minLag, 1);

  const xOf = (lag: number): number => PAD.left + ((lag - minLag) / lagSpan) * innerW;
  // r ∈ [-1, 1]：y 轴反转（SVG 原点在上）
  const yOf = (r: number): number => PAD.top + ((1 - r) / 2) * innerH;

  // x 轴刻度：端点 + 0（若在范围内），整数尽量均匀抽样
  const xTicks = useMemo(() => {
    const step = Math.max(1, Math.ceil(lagSpan / 8));
    const ticks = new Set<number>();
    for (let v = minLag; v <= maxLag; v += step) ticks.add(v);
    ticks.add(minLag);
    ticks.add(maxLag);
    if (minLag <= 0 && maxLag >= 0) ticks.add(0);
    return [...ticks].sort((a, b) => a - b);
  }, [minLag, maxLag, lagSpan]);

  const yTicks = [-1, -0.5, 0, 0.5, 1];

  if (series.length === 0) return null;

  return (
    <div className="lag-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="滞后相关曲线图"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {/* 水平网格线 + y 刻度 */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke={t === 0 ? 'var(--color-text-secondary)' : 'var(--color-border)'}
              strokeWidth={t === 0 ? 1.2 : 1}
              strokeDasharray={t === 0 ? undefined : '3 4'}
            />
            <text
              x={PAD.left - 8}
              y={yOf(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="lag-chart-tick"
            >
              {t}
            </text>
          </g>
        ))}

        {/* x 刻度 */}
        {xTicks.map((t) => (
          <text
            key={`x${t}`}
            x={xOf(t)}
            y={PAD.top + innerH + 18}
            textAnchor="middle"
            className="lag-chart-tick"
          >
            {t}
          </text>
        ))}

        {/* 轴标题 */}
        <text x={PAD.left + innerW / 2} y={H - 8} textAnchor="middle" className="lag-chart-axis">
          滞后期 lag（正=左序列领先）
        </text>
        <text
          x={14}
          y={PAD.top + innerH / 2}
          textAnchor="middle"
          className="lag-chart-axis"
          transform={`rotate(-90 14 ${PAD.top + innerH / 2})`}
        >
          Pearson r
        </text>

        {/* 折线 + 数据点 */}
        {series.map((s) => (
          <g key={s.key}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              points={s.points.map((p) => `${xOf(p.lag)},${yOf(p.r)}`).join(' ')}
            />
            {s.points.map((p) => (
              <circle
                key={`${s.key}-${p.lag}`}
                cx={xOf(p.lag)}
                cy={yOf(p.r)}
                r={p.significant ? 4.5 : 3}
                fill={p.significant ? s.color : 'var(--color-surface)'}
                stroke={s.color}
                strokeWidth={1.5}
              >
                <title>{`${s.key} · lag=${p.lag} · r=${p.r.toFixed(4)}${p.significant ? '（显著）' : ''}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>

      {/* 图例 */}
      <div className="lag-chart-legend">
        {series.map((s) => (
          <span key={s.key} className="lag-chart-legend-item">
            <span className="lag-chart-legend-swatch" style={{ background: s.color }} />
            {s.key}
          </span>
        ))}
      </div>
    </div>
  );
}
