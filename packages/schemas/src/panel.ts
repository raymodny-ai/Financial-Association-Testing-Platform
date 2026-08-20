/**
 * @platform/schemas · 导出面板契约（G4，PRD 导出规范）
 *
 * 一次运行的标准化研究面板快照，支撑编号导出文件 01~05：
 * 01_prices_raw.csv ← prices；02_prices_adj.csv ← adjusted；
 * 03_return_panel_pct.csv ← prices 前端派生；04_state_panel.csv ← categories；
 * 05_thresholds.json ← thresholds + periods。
 *
 * 持久化于 run_panels（JSONB），GET /api/tasks/:id/results 随产物一并返回。
 */
import { z } from 'zod';
import { dateSchema, idSchema } from './common';
import { periodSplitSchema } from './task';

/** 单序列参考期分箱拟合（阈值 + 标签 + 方法，供 05_thresholds.json） */
export const fittedThresholdsSchema = z.object({
  method: z.string().min(1),
  labels: z.array(z.string()),
  thresholds: z.array(z.number()),
});

export const exportPanelSchema = z
  .object({
    run_id: idSchema,
    /** 序列别名（含派生序列） */
    aliases: z.array(z.string().min(1)).min(1),
    /** 对齐后的公共日期轴（升序） */
    dates: z.array(dateSchema),
    /** 原始（对齐后）数值面板：prices[i] ↔ aliases[i]，与 dates 等长 */
    prices: z.array(z.array(z.number())),
    /** 离散化状态面板（箱序号）：categories[i] ↔ aliases[i]，与 dates 等长 */
    categories: z.array(z.array(z.number().int())),
    /** 参考期拟合阈值：alias → {method, labels, thresholds} */
    thresholds: z.record(z.string(), fittedThresholdsSchema),
    /** 复权收盘对照（仅上传源提供 adj_close 时存在）：alias → (date,value) 列表 */
    adjusted: z.record(z.string(), z.array(z.object({ date: dateSchema, value: z.number() }))),
    /** 期间划分（复现方法学所需） */
    periods: periodSplitSchema,
  })
  .refine((p) => p.prices.length === p.aliases.length, '价格矩阵行数须与别名数一致')
  .refine((p) => p.categories.length === p.aliases.length, '状态矩阵行数须与别名数一致')
  .refine((p) => p.prices.every((row) => row.length === p.dates.length), '价格行长度须与日期轴等长')
  .refine((p) => p.categories.every((row) => row.length === p.dates.length), '状态行长度须与日期轴等长');
export type ExportPanel = z.infer<typeof exportPanelSchema>;
