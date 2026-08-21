/**
 * @platform/schemas · 公共原子契约
 *
 * 跨包共享的基础类型：标识、日期、频率、检验族、审计状态等。
 * 所有类型一律由 Zod schema 推断（z.infer），保证运行时校验与编译期类型同源。
 */
import { z } from 'zod';

/** UUID 标识（任务 / 运行 / 工作区） */
export const idSchema = z.string().uuid();

/** ISO 日期字符串（YYYY-MM-DD） */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式须为 YYYY-MM-DD');

/** ISO 日期时间字符串 */
export const dateTimeSchema = z.string().datetime({ offset: true });

/** 数据频率 */
export const frequencySchema = z.enum(['daily', 'weekly', 'monthly']);
export type Frequency = z.infer<typeof frequencySchema>;

/** 检验族（主结果长表 test_family 字段取值） */
export const testFamilySchema = z.enum(['categorical', 'continuous', 'audit', 'llm']);
export type TestFamily = z.infer<typeof testFamilySchema>;

/**
 * 审计状态 → 与 @platform/ui 的 AuditRiskLevel 三档语义色一一对应：
 * pass=clear（低风险）/ warn=watch（中风险）/ fail=breach（高风险）
 */
export const auditStatusSchema = z.enum(['pass', 'warn', 'fail']);
export type AuditStatus = z.infer<typeof auditStatusSchema>;

/** 分箱方法（stddev 标准差分箱，S2） */
export const binningMethodSchema = z.enum(['quantile', 'equal_width', 'fixed_threshold', 'stddev']);
export type BinningMethod = z.infer<typeof binningMethodSchema>;

/** 多重检验校正方法 */
export const correctionMethodSchema = z.enum(['none', 'bonferroni', 'bh', 'by']);
export type CorrectionMethod = z.infer<typeof correctionMethodSchema>;

/** 方法学默认值（PRD：分位数三分离散化 / 252 日窗口 / 21 日步长 / 最大滞后 10） */
export const DEFAULTS = {
  binningBins: 3,
  rollingWindowDays: 252,
  rollingStepDays: 21,
  maxLag: 10,
  alpha: 0.05,
} as const;
