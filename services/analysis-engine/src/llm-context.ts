/**
 * LLM 上下文构造器（T15，PRD 模块 K + 「数据模型 · LLM 上下文表」）。
 *
 * LLM 不直接读取大表，而是读取本模块构造的"研究摘要对象"（llmContextSchema 12 字段）。
 * 输入边界：TaskConfig + ResultTable（全样本 / 滞后 / 滚动行按 window_end、lag 分区）+ AuditTable。
 * 安全约束注入（PRD「安全约束」）：
 * - 审计 fail → 高风险前置声明 + 置信降级旗标；
 * - 弱效应（|effect|<0.1）但显著 → "统计显著不等于经济显著"；
 * - 仅少数滚动窗口显著 → 禁止描述为稳定规律；
 * - 禁止性表述（因果断言 / 确定性投资建议等）作为常量写入上下文。
 */
import {
  llmContextSchema,
  type AuditRow,
  type CorrectionMethod,
  type LlmContext,
  type ResultRow,
  type TaskConfig,
} from '@platform/schemas';

/** 必须回答的章节（与 prompts/user_prompt_template.txt 的 7 项任务一一对应） */
export const REQUIRED_ANSWER_SECTIONS = [
  '1. 研究结论摘要（executive_conclusion）',
  '2. 分类变量检验与连续变量检验的差异解释（statistical_interpretation）',
  '3. 关系是否稳健：结合滚动窗口与滞后分析（stability_assessment）',
  '4. 数据质量或数据源一致性是否影响结论（data_quality_caveats）',
  '5. 研究流程下一步建议（next_research_steps）',
  '6. 需要持续监控的指标与触发条件（monitoring_suggestions）',
  '7. 不能从当前结果推出的内容（forbidden_inference_flags）',
] as const;

/** 禁止性表述（PRD「安全约束」，不得出现在模型输出的任何字段中） */
export const FORBIDDEN_CLAIMS = [
  '不得将相关性表述为因果关系（本研究未检验因果）',
  '不得输出确定性的投资建议或收益承诺',
  '不得将仅少数滚动窗口显著的结果描述为稳定规律',
  '不得虚构输入结果中未出现的统计事实',
  '效应量弱而 p 值显著时，必须明示统计显著不等于经济显著',
] as const;

export interface LlmContextInput {
  config: TaskConfig;
  /** 用户研究问题；缺省时由 projectName 派生（G13 起由编排层从 config.researchQuestion 透传） */
  researchQuestion?: string;
  /** 主结果长表：window_end 非空 = 滚动行，lag≠0 = 滞后行，其余为全样本行 */
  results: readonly ResultRow[];
  /** 滚动分析中被跳过的退化窗口数量（T13 skipped） */
  rollingSkippedCount?: number;
  audit: readonly AuditRow[];
  /** 序列别名 → 审计风险说明（auditSeries notes） */
  auditNotes?: Readonly<Record<string, readonly string[]>>;
}

/** 数值格式化：6 位有效数字，去除尾零（确定性文案对拍口径） */
function fmt(x: number): string {
  return Number(x.toPrecision(6)).toString();
}

const CORRECTION_TEXT: Record<CorrectionMethod, string> = {
  none: '未校正',
  bonferroni: 'Bonferroni 校正',
  bh: 'BH(FDR) 校正',
  by: 'BY 校正',
};

const TRANSFORM_TEXT = {
  pct_return: '百分比收益率变换',
  log_return: '对数收益率变换',
  diff: '一阶差分变换',
  ratio: '比值变换',
} as const;

/** 弱效应阈值：|effect_size| < 0.1 视为弱（Cramer's V / 相关系数同口径） */
const WEAK_EFFECT_THRESHOLD = 0.1;
/** 滚动稳定性阈值：显著窗口占比低于该值即"仅少数窗口显著" */
const STABLE_RATIO_THRESHOLD = 0.5;

/** 全样本检验族摘要（分类 / 连续共用） */
function summarizeFamily(rows: readonly ResultRow[], correction: CorrectionMethod, alpha: number): string {
  if (rows.length === 0) return '未产出该类检验结果。';
  const sorted = [...rows].sort(
    (a, b) =>
      a.p_value_adjusted - b.p_value_adjusted ||
      a.left_series.localeCompare(b.left_series) ||
      a.right_series.localeCompare(b.right_series),
  );
  const significant = sorted.filter((r) => r.significant);
  const top = sorted[0]!;
  const lines: string[] = [];
  lines.push(`共 ${sorted.length} 组检验，显著 ${significant.length} 组（${CORRECTION_TEXT[correction]}，alpha=${fmt(alpha)}）。`);
  const effectText = top.effect_size === null ? '效应量不可用' : `效应量=${fmt(top.effect_size)}`;
  lines.push(
    `最强关联：${top.left_series}×${top.right_series}（${top.test_name}），统计量=${fmt(top.stat_value)}，校正 p=${fmt(top.p_value_adjusted)}，${effectText}。`,
  );
  lines.push(
    significant.length > 0
      ? `显著组合：${significant.map((r) => `${r.left_series}×${r.right_series}（p_adj=${fmt(r.p_value_adjusted)}）`).join('、')}。`
      : '无显著组合。',
  );
  const notes = [...new Set(sorted.map((r) => r.notes).filter((n): n is string => n !== null))];
  if (notes.length > 0) lines.push(`警告：${notes.join('；')}。`);
  return lines.join('\n');
}

interface RollingGroup {
  key: string;
  label: string;
  total: number;
  significantCount: number;
}

/** 滚动窗口摘要：按变量对×方法分组，显著占比低于阈值必须附不稳定声明 */
function summarizeRolling(rows: readonly ResultRow[], skippedCount: number): string {
  if (rows.length === 0 && skippedCount === 0) return '未产出滚动窗口结果。';
  const groups = new Map<string, RollingGroup>();
  for (const r of rows) {
    const key = `${r.left_series}×${r.right_series}|${r.test_name}`;
    const g =
      groups.get(key) ??
      ({ key, label: `${r.left_series}×${r.right_series}（${r.test_name}）`, total: 0, significantCount: 0 } as RollingGroup);
    g.total += 1;
    if (r.significant) g.significantCount += 1;
    groups.set(key, g);
  }
  const lines = [...groups.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((g) => {
      const ratio = g.significantCount / g.total;
      const verdict =
        g.significantCount === 0
          ? '无显著窗口'
          : ratio < STABLE_RATIO_THRESHOLD
            ? '仅少数窗口显著，不得视为稳定规律'
            : '多数窗口显著';
      return `${g.label}：共 ${g.total} 个窗口，显著 ${g.significantCount} 个（${fmt(ratio * 100)}%）—— ${verdict}。`;
    });
  if (skippedCount > 0) lines.push(`另有 ${skippedCount} 个退化窗口被跳过（前提不满足，详见 skipped 记录）。`);
  return lines.join('\n');
}

/** 滞后分析摘要：按变量对×方法分组，列显著滞后与最佳滞后 */
function summarizeLag(rows: readonly ResultRow[], maxLag: number): string {
  if (rows.length === 0) return `未产出滞后分析结果（maxLag=${maxLag}）。`;
  const groups = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const key = `${r.left_series}×${r.right_series}|${r.test_name}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const label = `${group[0]!.left_series}×${group[0]!.right_series}（${group[0]!.test_name}）`;
      const sigLags = group
        .filter((r) => r.significant)
        .map((r) => r.lag)
        .sort((a, b) => a - b);
      if (sigLags.length === 0) return `${label}：无显著滞后。`;
      const best = [...group].sort((a, b) => a.p_value_adjusted - b.p_value_adjusted)[0]!;
      return `${label}：显著滞后 [${sigLags.join(', ')}]，最佳滞后 lag=${best.lag}（p_adj=${fmt(best.p_value_adjusted)}）。`;
    })
    .join('\n');
}

/** 审计摘要：fail 前置高风险声明；每源一行 9 字段明细 + 风险说明 */
function summarizeAudit(
  rows: readonly AuditRow[],
  notesByAlias: Readonly<Record<string, readonly string[]>> | undefined,
): string {
  if (rows.length === 0) return '未执行数据质量审计。';
  const lines: string[] = [];
  const fails = rows.filter((r) => r.audit_status === 'fail');
  if (fails.length > 0) {
    lines.push(`审计高风险（fail）序列：${fails.map((r) => r.series_alias).join('、')}。全部统计结论需谨慎解释，优先补充数据验证。`);
  }
  for (const r of [...rows].sort((a, b) => a.series_alias.localeCompare(b.series_alias))) {
    let line =
      `${r.series_alias}：${r.audit_status}（缺失值 ${r.missing_value_count}、缺失交易日 ${r.missing_business_days_count}、` +
      `重复索引 ${r.duplicate_index_count}、stale ${r.stale_run_count}、跳点 ${r.jump_count}、复权 ${r.adjustment_flag_count}、` +
      `双源一致率 ${fmt(r.source_match_ratio * 100)}%）`;
    const notes = notesByAlias?.[r.series_alias];
    if (notes && notes.length > 0) line += `；${notes.join('；')}`;
    lines.push(`${line}。`);
  }
  return lines.join('\n');
}

/** 全局置信旗标（PRD 安全约束 → LLM 输入侧强制信号） */
function confidenceFlags(
  config: TaskConfig,
  partitions: { fullSample: ResultRow[]; rolling: ResultRow[] },
  auditRows: readonly AuditRow[],
): string[] {
  const flags: string[] = [];
  const fails = auditRows.filter((r) => r.audit_status === 'fail');
  const warns = auditRows.filter((r) => r.audit_status === 'warn');
  if (fails.length > 0) {
    flags.push(
      `审计高风险（${fails.map((r) => r.series_alias).join('、')}）：模型置信度必须下调为 low/medium，优先输出补充验证建议`,
    );
  }
  if (warns.length > 0) {
    flags.push(`审计警告（${warns.map((r) => r.series_alias).join('、')}）：解释统计结果前须先说明数据质量风险`);
  }
  const weakButSignificant = partitions.fullSample.filter(
    (r) => r.significant && r.effect_size !== null && Math.abs(r.effect_size) < WEAK_EFFECT_THRESHOLD,
  );
  if (weakButSignificant.length > 0) {
    flags.push('存在效应量弱（|effect|<0.1）但显著的检验：统计显著不等于经济显著');
  }
  const rollingKeys = new Set(partitions.rolling.map((r) => `${r.left_series}×${r.right_series}|${r.test_name}`));
  for (const key of rollingKeys) {
    const group = partitions.rolling.filter((r) => `${r.left_series}×${r.right_series}|${r.test_name}` === key);
    const sig = group.filter((r) => r.significant).length;
    if (sig > 0 && sig / group.length < STABLE_RATIO_THRESHOLD) {
      flags.push('部分滚动组合仅少数窗口显著，不得描述为稳定规律');
      break;
    }
  }
  if (config.tests.correction === 'none') flags.push('未启用多重检验校正，假阳性风险较高');
  return flags;
}

function variableDefinitions(config: TaskConfig): string {
  const lines = config.dataSources.map((ds) =>
    ds.kind === 'ticker'
      ? `${ds.alias}：公开市场序列，ticker=${ds.ticker}，数据源=${ds.provider}（收盘价语义）`
      : `${ds.alias}：上传文件序列，fileId=${ds.fileId}，字段映射=${JSON.stringify(ds.columnMapping)}`,
  );
  for (const d of config.derivedSeries) {
    lines.push(
      d.transform === 'ratio'
        ? `${d.alias} = ${d.sourceAlias}/${d.denominatorAlias} 经比值变换派生（S3）`
        : `${d.alias} = ${d.sourceAlias} 经${TRANSFORM_TEXT[d.transform]}派生`,
    );
  }
  return lines.join('\n');
}

function researchScope(config: TaskConfig): string {
  const rollingText = config.rolling.enabled
    ? `${config.rolling.windowDays} 观测窗口 / ${config.rolling.stepDays} 步长`
    : '未启用';
  return (
    `分类变量路线：${config.binning.method} 分箱（${config.binning.bins} 桶）+ 卡方族检验；` +
    `连续变量路线：pearson/spearman/mutual_information；` +
    `多重检验校正：${CORRECTION_TEXT[config.tests.correction]}（alpha=${fmt(config.tests.alpha)}）；` +
    `滚动窗口：${rollingText}；最大滞后：${config.maxLag}。`
  );
}

function sampleInfo(config: TaskConfig): string {
  const { periods } = config;
  return (
    `频率 ${config.frequency}；样本区间 ${config.startDate} 至 ${config.endDate}；` +
    `参考期 ${periods.referenceStart} 至 ${periods.referenceEnd}（拟合分箱阈值）；` +
    `检验期 ${periods.testStart} 至 ${periods.testEnd}（复用参考期阈值执行检验）。`
  );
}

/** 构造 LLM 研究摘要对象（返回前经 llmContextSchema 运行时校验） */
export function buildLlmContext(input: LlmContextInput): LlmContext {
  const { config, results } = input;
  const rolling = results.filter((r) => r.window_end !== null);
  const lag = results.filter((r) => r.window_end === null && r.lag !== 0);
  const fullSample = results.filter((r) => r.window_end === null && r.lag === 0);
  const categorical = fullSample.filter((r) => r.test_family === 'categorical');
  const continuous = fullSample.filter((r) => r.test_family === 'continuous');

  const context = {
    research_question: input.researchQuestion ?? `「${config.projectName}」关联性检验研究`,
    research_scope: researchScope(config),
    sample_info: sampleInfo(config),
    variable_definitions: variableDefinitions(config),
    categorical_key_findings: summarizeFamily(categorical, config.tests.correction, config.tests.alpha),
    continuous_key_findings: summarizeFamily(continuous, config.tests.correction, config.tests.alpha),
    rolling_key_findings: summarizeRolling(rolling, input.rollingSkippedCount ?? 0),
    lag_key_findings: summarizeLag(lag, config.maxLag),
    audit_key_findings: summarizeAudit(input.audit, input.auditNotes),
    global_confidence_flags: confidenceFlags(config, { fullSample, rolling }, input.audit),
    required_answer_sections: [...REQUIRED_ANSWER_SECTIONS],
    forbidden_claims: [...FORBIDDEN_CLAIMS],
  };
  return llmContextSchema.parse(context);
}
