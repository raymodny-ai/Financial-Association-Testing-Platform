/**
 * @platform/schemas · 审计表契约（PRD「数据模型 · 审计表」，9 字段）
 *
 * 每个数据源别名对应一条审计记录。
 */
import { z } from 'zod';
import { auditStatusSchema } from './common';

export const auditRowSchema = z.object({
  /** 被审计序列别名 */
  series_alias: z.string().min(1),
  /** 缺失值数量 */
  missing_value_count: z.number().int().min(0),
  /** 缺失交易日数量 */
  missing_business_days_count: z.number().int().min(0),
  /** 重复索引数量 */
  duplicate_index_count: z.number().int().min(0),
  /** 价格冻结（stale）连续段数量 */
  stale_run_count: z.number().int().min(0),
  /** 异常跳点数量 */
  jump_count: z.number().int().min(0),
  /** 最大单日绝对收益率（百分比） */
  max_abs_return_pct: z.number().gte(0),
  /** 复权调整标记数量 */
  adjustment_flag_count: z.number().int().min(0),
  /** 双源一致率（0~1，单源时为 1） */
  source_match_ratio: z.number().gte(0).lte(1),
  /** 审计结论：pass / warn / fail */
  audit_status: auditStatusSchema,
});
export type AuditRow = z.infer<typeof auditRowSchema>;

export const auditTableSchema = z.array(auditRowSchema);
export type AuditTable = z.infer<typeof auditTableSchema>;
