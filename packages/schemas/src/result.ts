/**
 * @platform/schemas · 主结果长表契约（PRD「数据模型 · 主结果表」，13 字段）
 *
 * 统一长表模型，便于未来扩展更多检验方法。
 */
import { z } from 'zod';
import { dateSchema, testFamilySchema } from './common';

export const resultRowSchema = z.object({
  /** 本次运行唯一标识 */
  run_id: z.string().uuid(),
  /** 检验族 */
  test_family: testFamilySchema,
  /** 具体检验名，如 chi_square_independence / pearson / mutual_information */
  test_name: z.string().min(1),
  /** 左变量别名 */
  left_series: z.string().min(1),
  /** 右变量别名 */
  right_series: z.string().min(1),
  /** 滚动窗口结束日期（全样本检验为 null） */
  window_end: dateSchema.nullable(),
  /** 滞后期（0 同期；正：左变量领先；负：左变量滞后，PRD 模块 H） */
  lag: z.number().int().min(-60).max(60),
  /** 检验统计量 */
  stat_value: z.number(),
  /** 原始 p 值 */
  p_value_raw: z.number().gte(0).lte(1),
  /** 校正后 p 值（未校正时等于原始值） */
  p_value_adjusted: z.number().gte(0).lte(1),
  /** 效应量（如 Cramer's V），不可用时为 null */
  effect_size: z.number().nullable(),
  /** 是否显著（以校正后 p 值与 alpha 比较） */
  significant: z.boolean(),
  /** 风险标记或解释（如期望频数不足警告） */
  notes: z.string().nullable(),
});
export type ResultRow = z.infer<typeof resultRowSchema>;

export const resultTableSchema = z.array(resultRowSchema);
export type ResultTable = z.infer<typeof resultTableSchema>;
