/**
 * @platform/schemas · 任务配置契约（前端模板字段，PRD「配置设计」节）
 *
 * TaskConfig 是前端「保存模板 / 复制分析 / 重新运行同配置」的持久化单元，
 * 也是 api_gateway 创建任务时的入参校验契约。
 * 附加 workspaceId（G5 决策：MVP 匿名工作区归属）。
 */
import { z } from 'zod';
import {
  binningMethodSchema,
  correctionMethodSchema,
  dateSchema,
  DEFAULTS,
  frequencySchema,
  idSchema,
} from './common';

/** 字段映射：标准列名 → 文件列名（至少一组） */
const columnMappingSchema = z
  .record(z.string(), z.string())
  .refine((m) => Object.keys(m).length > 0, '字段映射不得为空');

/** 数据源条目：ticker 拉取或 CSV 上传映射 */
export const dataSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ticker'),
    /** 序列别名（面板内唯一） */
    alias: z.string().min(1).max(64),
    /** 公开市场代码（MVP 主力源 Stooq） */
    ticker: z.string().min(1).max(32),
    /** 数据源标识，用于审计与可复现性 */
    provider: z.string().min(1),
    /** 双源一致性审计第二源（PRD 模块 J）：同 ticker 的另一 provider，仅供审计对账，不进入分析面板 */
    dualSource: z.object({ provider: z.string().min(1) }).optional(),
  }),
  z.object({
    kind: z.literal('upload'),
    alias: z.string().min(1).max(64),
    /** 上传文件引用 id */
    fileId: idSchema,
    /** 字段映射：标准列名 → 文件列名（至少一组） */
    columnMapping: columnMappingSchema,
    /** 双源一致性审计第二源（PRD 模块 J）：另一上传文件，仅供审计对账，不进入分析面板 */
    dualSource: z
      .object({
        fileId: idSchema,
        columnMapping: columnMappingSchema,
      })
      .optional(),
  }),
]);
export type DataSource = z.infer<typeof dataSourceSchema>;

/** 派生序列定义（如收益率、差分、比值；ratio 需配分母序列，S3） */
export const derivedSeriesSchema = z
  .object({
    alias: z.string().min(1).max(64),
    /** 基础序列别名（ratio 时为分子） */
    sourceAlias: z.string().min(1).max(64),
    transform: z.enum(['pct_return', 'log_return', 'diff', 'ratio']),
    /** 比值变换的分母序列别名（S3）：ratio 必填，其余变换禁用 */
    denominatorAlias: z.string().min(1).max(64).optional(),
  })
  .refine((d) => (d.transform === 'ratio') === (d.denominatorAlias !== undefined), {
    message: '比值变换（ratio）须携带分母序列（denominatorAlias），且仅限 ratio 使用',
  });
export type DerivedSeries = z.infer<typeof derivedSeriesSchema>;

/** 参考期 / 检验期划分（阈值在参考期固定、检验期复用） */
export const periodSplitSchema = z.object({
  referenceStart: dateSchema,
  referenceEnd: dateSchema,
  testStart: dateSchema,
  testEnd: dateSchema,
});
export type PeriodSplit = z.infer<typeof periodSplitSchema>;

/** 事件标签（S4，PRD 首期范围「预先离散化后的事件序列」的 MVP 落地：单点事件日） */
export const eventLabelSchema = z.object({
  name: z.string().min(1).max(64),
  date: dateSchema,
  /** 事件分类（如 财报/政策，仅供展示与分组） */
  category: z.string().min(1).max(32).optional(),
});
export type EventLabel = z.infer<typeof eventLabelSchema>;

/** 分箱配置（fixed_threshold 须携带用户阈值，其余方法禁用；S2 缺口 N7 转正） */
export const binningConfigSchema = z
  .object({
    method: binningMethodSchema.default('quantile'),
    /** 分位数分箱的桶数（默认三分） */
    bins: z.number().int().min(2).max(10).default(DEFAULTS.binningBins),
    /** 分类标签（与桶数等长） */
    labels: z.array(z.string().min(1)).optional(),
    /** 固定阈值分箱的用户阈值（升序，长度 = bins-1）：仅 fixed_threshold 使用 */
    thresholds: z.array(z.number()).optional(),
  })
  .refine((c) => (c.method === 'fixed_threshold') === (c.thresholds !== undefined), {
    message: '固定阈值分箱（fixed_threshold）须携带用户阈值（thresholds），且仅限该方法使用',
    path: ['thresholds'],
  })
  .refine(
    (c) => c.thresholds === undefined || c.thresholds.length === c.bins - 1,
    {
      message: '固定阈值个数须等于桶数减一（bins - 1）',
      path: ['thresholds'],
    },
  )
  .refine((c) => {
      const ts = c.thresholds;
      return ts === undefined || ts.every((t, i) => i === 0 || t > ts[i - 1]!);
    }, {
      message: '固定阈值须严格递增',
      path: ['thresholds'],
    });
export type BinningConfig = z.infer<typeof binningConfigSchema>;

/** 滚动窗口检验方法（与引擎 ROLLING_METHODS + ROLLING_EXTRA_METHODS 同源；hsic 为可选扩展，H2） */
export const rollingMethodSchema = z.enum([
  'chi_square_independence',
  'pearson',
  'spearman',
  'mutual_information',
  'hsic',
]);
export type RollingMethod = z.infer<typeof rollingMethodSchema>;

/** 滚动窗口配置 */
export const rollingConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    windowDays: z.number().int().min(30).default(DEFAULTS.rollingWindowDays),
    stepDays: z.number().int().min(1).default(DEFAULTS.rollingStepDays),
    /** 最小样本量（≥2 且 ≤ windowDays）；缺省 = windowDays，即仅完整窗口（引擎默认） */
    minSamples: z.number().int().min(2).optional(),
    /** 参与滚动重算的方法子集；缺省 = 全部四法（引擎默认） */
    methods: z.array(rollingMethodSchema).min(1).optional(),
  })
  .refine((c) => c.minSamples === undefined || c.minSamples <= c.windowDays, {
    message: '最小样本量不得超过窗口长度（windowDays）',
    path: ['minSamples'],
  });
export type RollingConfig = z.infer<typeof rollingConfigSchema>;

/** 统计检验选项 */
export const testOptionsSchema = z.object({
  alpha: z.number().gt(0).lt(1).default(DEFAULTS.alpha),
  correction: correctionMethodSchema.default('bh'),
  /** 置换检验重复次数（固定种子保证可复现） */
  permutations: z.number().int().min(100).max(100000).default(1000),
  permutationSeed: z.number().int().default(20260819),
});
export type TestOptions = z.infer<typeof testOptionsSchema>;

/** 审计阈值 */
export const auditThresholdsSchema = z.object({
  /** 缺失占比超过该值即 warn */
  missingRatioWarn: z.number().gte(0).lte(1).default(0.02),
  /** 缺失占比超过该值即 fail */
  missingRatioFail: z.number().gte(0).lte(1).default(0.1),
  /** 单日绝对收益率（%）跳点阈值 */
  jumpAbsReturnPct: z.number().gt(0).default(20),
  /** 双源一致率低于该值即 warn */
  sourceMatchRatioWarn: z.number().gte(0).lte(1).default(0.98),
});
export type AuditThresholds = z.infer<typeof auditThresholdsSchema>;

/** 任务配置（分析模板） */
export const taskConfigSchema = z
  .object({
    /** 项目名称 */
    projectName: z.string().min(1).max(128),
    /** 归属工作区（G5：匿名工作区 id） */
    workspaceId: idSchema,
    /** 数据源配置 */
    dataSources: z.array(dataSourceSchema).min(2),
    /** 时间范围 */
    startDate: dateSchema,
    endDate: dateSchema,
    /** 频率 */
    frequency: frequencySchema.default('daily'),
    /** 用户研究问题（G13，PRD 模块 K 输入要求）；缺省时 LLM 上下文由 projectName 派生 */
    researchQuestion: z.string().trim().min(1).max(512).optional(),
    /** 派生序列定义 */
    derivedSeries: z.array(derivedSeriesSchema).default([]),
    /** 参考期 / 检验期 */
    periods: periodSplitSchema,
    /** 分箱方法 */
    binning: binningConfigSchema.default({}),
    /** 统计检验选项 */
    tests: testOptionsSchema.default({}),
    /** 滚动窗口与步长 */
    rolling: rollingConfigSchema.default({}),
    /** 最大滞后 */
    maxLag: z.number().int().min(0).max(60).default(DEFAULTS.maxLag),
    /** 事件标签（S4）：事件日与非事件日状态分布关联检验，仅在检验期生效 */
    events: z.array(eventLabelSchema).default([]),
    /** 审计阈值 */
    audit: auditThresholdsSchema.default({}),
    /** LLM 模型名 */
    llmModel: z.string().min(1).default('qwen-plus'),
    /** prompt 模板版本（可复现性要求） */
    promptVersion: z.string().min(1).default('v1'),
  })
  .refine((cfg) => cfg.periods.referenceEnd < cfg.periods.testStart, {
    message: '参考期结束日期必须早于检验期开始日期',
    path: ['periods', 'referenceEnd'],
  })
  .refine((cfg) => cfg.startDate <= cfg.periods.referenceStart, {
    message: '样本起始日期不得晚于参考期起始日期',
    path: ['startDate'],
  })
  .refine((cfg) => cfg.periods.testEnd <= cfg.endDate, {
    message: '检验期结束日期不得晚于样本结束日期',
    path: ['periods', 'testEnd'],
  })
  .refine(
    (cfg) => {
      const seen = new Set<string>();
      for (const e of cfg.events) {
        const key = `${e.name}|${e.date}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    {
      message: '事件标签不得同名同日期重复',
      path: ['events'],
    },
  );
export type TaskConfig = z.infer<typeof taskConfigSchema>;

/** 创建任务请求（api_gateway POST /api/tasks 入参） */
export const createTaskRequestSchema = taskConfigSchema;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** 任务运行状态 */
export const taskStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** 任务记录（存储层返回结构） */
export const taskRecordSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  status: taskStatusSchema,
  config: taskConfigSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  /** 失败原因（status=failed 时） */
  errorMessage: z.string().nullable().default(null),
});
export type TaskRecord = z.infer<typeof taskRecordSchema>;
