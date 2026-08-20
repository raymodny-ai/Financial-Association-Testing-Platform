/**
 * 分析引擎核心数据类型（T09）。
 * 上游（api 数据适配器 / CSV 解析）负责将原始面板规约为 NumericSeries 后传入。
 */

/** 单条数值序列：alias + (日期, 观测值) 点集 */
export interface NumericSeries {
  alias: string;
  points: Array<{ date: string; value: number }>;
}

/** 对齐后的面板：所有序列共享同一升序日期轴 */
export interface AlignedPanel {
  /** 序列别名（与 values 行序一致） */
  aliases: string[];
  /** 公共日期轴（升序） */
  dates: string[];
  /** values[i] 为 aliases[i] 在 dates 上的观测值 */
  values: number[][];
}
