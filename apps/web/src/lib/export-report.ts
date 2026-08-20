/**
 * apps/web · PRD 导出规范（G4）：01~15 编号文件的浏览器端生成。
 *
 * 一律纯函数（内容生成）+ 下载封装，不依赖服务端二次加工。
 * 01_prices_raw.csv      原始收盘价面板（panel.prices）
 * 02_prices_adj.csv      复权收盘价面板（panel.adjusted，仅上传源提供 adj_close 时有数据）
 * 03_return_panel_pct.csv 百分比收益率面板（prices 派生，首期为空）
 * 04_state_panel.csv     离散化状态面板（panel.categories → 标签）
 * 05_thresholds.json     参考期阈值定义 + 期间划分
 * 06_chi_square_summary.csv / 07_continuous_dependency_summary.csv /
 * 08_rolling_results.csv / 09_lag_results_<pair>.csv
 * 10_quality_audit.csv / 11_source_consistency.csv
 * 12_llm_context.json / 13_llm_conclusion.md / 14_llm_trace.json
 * 15_full_report.html    完整报告
 */
import type { AuditRow, ExportPanel, LlmContext, LlmOutput, LlmTrace, ResultRow, TaskRecord } from '@platform/schemas';
import { downloadCsv, downloadJson, downloadText } from './export';

export interface ExportInput {
  task: TaskRecord;
  results: ResultRow[];
  audit: AuditRow[];
  panel: ExportPanel | null;
  llm: { context: LlmContext; output: LlmOutput | null; trace: LlmTrace } | null;
}

/* ---------------- 结果行分区（与 ResultsPage Tab 口径一致） ---------------- */

export function partitionResults(results: readonly ResultRow[]) {
  return {
    categorical: results.filter((r) => r.test_family === 'categorical' && r.window_end === null),
    continuous: results.filter(
      (r) => r.test_family === 'continuous' && r.window_end === null && r.test_name !== 'pearson_lag',
    ),
    rolling: results.filter((r) => r.window_end !== null),
    lag: results.filter((r) => r.test_name === 'pearson_lag' && r.window_end === null),
  };
}

const RESULT_HEADERS = [
  'run_id', 'test_family', 'test_name', 'left_series', 'right_series', 'window_end', 'lag',
  'stat_value', 'p_value_raw', 'p_value_adjusted', 'effect_size', 'significant', 'notes',
] as const;

function resultRows(rows: readonly ResultRow[]) {
  return rows.map((r) => [
    r.run_id, r.test_family, r.test_name, r.left_series, r.right_series, r.window_end, r.lag,
    r.stat_value, r.p_value_raw, r.p_value_adjusted, r.effect_size, r.significant, r.notes,
  ]);
}

/* ---------------- 01~05：面板类（依赖 panel 快照） ---------------- */

export function export01PricesRaw(panel: ExportPanel): void {
  downloadCsv('01_prices_raw.csv', ['date', ...panel.aliases],
    panel.dates.map((date, i) => [date, ...panel.aliases.map((_, s) => panel.prices[s]![i]!)]));
}

export function export02PricesAdj(panel: ExportPanel): void {
  const rows: Array<[string, string, number]> = [];
  for (const [alias, points] of Object.entries(panel.adjusted)) {
    for (const p of points) rows.push([p.date, alias, p.value]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  downloadCsv('02_prices_adj.csv', ['date', 'alias', 'adj_close'], rows);
}

export function hasAdjusted(panel: ExportPanel | null): boolean {
  return panel !== null && Object.values(panel.adjusted).some((list) => list.length > 0);
}

export function export03ReturnPanel(panel: ExportPanel): void {
  downloadCsv('03_return_panel_pct.csv', ['date', ...panel.aliases],
    panel.dates.map((date, i) => [
      date,
      ...panel.aliases.map((_, s) => {
        const prev = i > 0 ? panel.prices[s]![i - 1] : undefined;
        const curr = panel.prices[s]![i]!;
        return prev === undefined || prev === 0 ? null : ((curr / prev) - 1) * 100;
      }),
    ]));
}

export function export04StatePanel(panel: ExportPanel): void {
  downloadCsv('04_state_panel.csv', ['date', ...panel.aliases],
    panel.dates.map((date, i) => [
      date,
      ...panel.aliases.map((alias, s) => {
        const cat = panel.categories[s]![i]!;
        return panel.thresholds[alias]?.labels[cat] ?? String(cat);
      }),
    ]));
}

export function export05Thresholds(task: TaskRecord, panel: ExportPanel): void {
  downloadJson('05_thresholds.json', {
    run_id: panel.run_id,
    periods: panel.periods,
    binning: task.config.binning,
    thresholds: panel.thresholds,
  });
}

/* ---------------- 06~09：检验结果类 ---------------- */

export function export06ChiSquare(rows: readonly ResultRow[]): void {
  downloadCsv('06_chi_square_summary.csv', [...RESULT_HEADERS], resultRows(rows));
}

export function export07Continuous(rows: readonly ResultRow[]): void {
  downloadCsv('07_continuous_dependency_summary.csv', [...RESULT_HEADERS], resultRows(rows));
}

export function export08Rolling(rows: readonly ResultRow[]): void {
  downloadCsv('08_rolling_results.csv', [...RESULT_HEADERS], resultRows(rows));
}

/** 09_lag_results_<pair>.csv：按变量对拆分（PRD 文件名 09_lag_results_*） */
export function export09Lag(rows: readonly ResultRow[]): void {
  const pairs = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const key = `${r.left_series}x${r.right_series}`;
    pairs.set(key, [...(pairs.get(key) ?? []), r]);
  }
  for (const [key, group] of pairs) {
    const sorted = [...group].sort((a, b) => a.lag - b.lag);
    downloadCsv(`09_lag_results_${key}.csv`, [...RESULT_HEADERS], resultRows(sorted));
  }
}

/* ---------------- 10~11：审计类 ---------------- */

const AUDIT_HEADERS = [
  'series_alias', 'missing_value_count', 'missing_business_days_count', 'duplicate_index_count',
  'stale_run_count', 'jump_count', 'max_abs_return_pct', 'adjustment_flag_count',
  'source_match_ratio', 'audit_status',
] as const;

export function export10QualityAudit(audit: readonly AuditRow[]): void {
  downloadCsv('10_quality_audit.csv', [...AUDIT_HEADERS],
    audit.map((a) => [
      a.series_alias, a.missing_value_count, a.missing_business_days_count, a.duplicate_index_count,
      a.stale_run_count, a.jump_count, a.max_abs_return_pct, a.adjustment_flag_count,
      a.source_match_ratio, a.audit_status,
    ]));
}

export function export11SourceConsistency(input: ExportInput): void {
  // 双源一致率投影；同质性细节随 12_llm_context.json 的 audit_key_findings 交付
  downloadCsv('11_source_consistency.csv', ['series_alias', 'source_match_ratio', 'audit_status'],
    input.audit.map((a) => [a.series_alias, a.source_match_ratio, a.audit_status]));
}

/* ---------------- 12~14：LLM 产物类 ---------------- */

export function export13Conclusion(llmOutput: LlmOutput, contextForbidden: readonly string[]): void {
  const lines: string[] = [
    '# LLM 研究结论',
    '',
    `> 置信级别：**${llmOutput.confidence_level}**`,
    '',
    '## 研究结论摘要', llmOutput.executive_conclusion, '',
    '## 统计结果解释', llmOutput.statistical_interpretation, '',
    '## 稳定性评估', llmOutput.stability_assessment, '',
    '## 数据质量注意事项', llmOutput.data_quality_caveats || '（无）', '',
    '## 市场含义', llmOutput.market_meaning || '（无）', '',
    '## 研究流程下一步建议',
    ...(llmOutput.next_research_steps.length > 0 ? llmOutput.next_research_steps.map((s) => `- ${s}`) : ['- （无）']),
    '',
    '## 需要持续监控的指标',
    ...(llmOutput.monitoring_suggestions.length > 0 ? llmOutput.monitoring_suggestions.map((s) => `- ${s}`) : ['- （无）']),
    '',
    '## 策略风险提示', llmOutput.strategy_risk_notes || '（无）', '',
    '## 不能从当前结果推出的内容',
    ...llmOutput.forbidden_inference_flags.map((s) => `- ${s}`),
    '',
    '## 禁止性表述（安全约束）',
    ...contextForbidden.map((s) => `- ${s}`),
    '',
  ];
  downloadText('13_llm_conclusion.md', lines.join('\n'), 'text/markdown');
}

/* ---------------- 15：完整报告 HTML ---------------- */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function htmlResultTable(rows: readonly ResultRow[], title: string): string {
  if (rows.length === 0) return `<h3>${escapeHtml(title)}</h3><p>（无数据）</p>`;
  const head = '<tr><th>左变量</th><th>右变量</th><th>检验</th><th>统计量</th><th>p(原始)</th><th>p(校正)</th><th>效应量</th><th>显著</th></tr>';
  const body = rows.map((r) =>
    `<tr><td>${escapeHtml(r.left_series)}</td><td>${escapeHtml(r.right_series)}</td><td>${escapeHtml(r.test_name)}</td>` +
    `<td>${r.stat_value.toPrecision(6)}</td><td>${r.p_value_raw.toPrecision(4)}</td><td>${r.p_value_adjusted.toPrecision(4)}</td>` +
    `<td>${r.effect_size === null ? '—' : r.effect_size.toPrecision(4)}</td><td>${r.significant ? '✓' : ''}</td></tr>`).join('');
  return `<h3>${escapeHtml(title)}</h3><table>${head}${body}</table>`;
}

export function buildFullReportHtml(input: ExportInput): string {
  const { task, results, audit, panel, llm } = input;
  const config = task.config;
  const parts = partitionResults(results);
  const significant = results.filter((r) => r.significant && r.window_end === null);
  const output = llm?.output ?? null;

  const auditRows = audit.map((a) =>
    `<tr><td>${escapeHtml(a.series_alias)}</td><td>${a.missing_value_count}</td><td>${a.jump_count}</td>` +
    `<td>${a.stale_run_count}</td><td>${a.adjustment_flag_count}</td><td>${(a.source_match_ratio * 100).toFixed(1)}%</td>` +
    `<td>${a.audit_status}</td></tr>`).join('');

  const llmSection = output === null
    ? '<p>LLM 解释未生成（未配置密钥降级跳过 / 调用失败）。</p>'
    : [
        `<p><strong>置信级别：${output.confidence_level}</strong></p>`,
        `<h3>研究结论摘要</h3><p>${escapeHtml(output.executive_conclusion)}</p>`,
        `<h3>稳定性评估</h3><p>${escapeHtml(output.stability_assessment)}</p>`,
        `<h3>数据质量注意事项</h3><p>${escapeHtml(output.data_quality_caveats || '（无）')}</p>`,
        `<h3>研究下一步建议</h3><ul>${output.next_research_steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('') || '<li>（无）</li>'}</ul>`,
        `<h3>不能从当前结果推出的内容</h3><ul>${output.forbidden_inference_flags.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`,
      ].join('');

  const forbidden = llm !== null ? llm.context.forbidden_claims : [];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(config.projectName)} · 完整报告</title>
<style>
body{font-family:system-ui,'Segoe UI',sans-serif;max-width:960px;margin:32px auto;padding:0 16px;color:#1f2933;line-height:1.6}
h1{border-bottom:2px solid #1f2933;padding-bottom:8px}
h2{margin-top:32px;border-bottom:1px solid #cbd2d9;padding-bottom:4px}
table{border-collapse:collapse;margin:8px 0;font-size:13px;width:100%}
th,td{border:1px solid #cbd2d9;padding:4px 8px;text-align:left}
th{background:#f5f7fa}
.meta{color:#52606d;font-size:13px}
</style>
</head>
<body>
<h1>${escapeHtml(config.projectName)} · 关联性检验完整报告</h1>
<p class="meta">运行标识 ${results[0]?.run_id ?? task.id} · 生成于 ${new Date().toISOString()}</p>

<h2>1. 数据概况</h2>
<ul>
<li>样本区间：${config.startDate} ~ ${config.endDate}（频率 ${config.frequency}）</li>
<li>序列：${config.dataSources.map((s) => escapeHtml(s.alias)).join('、')}</li>
<li>面板观测：${panel === null ? '（历史任务无面板快照，重跑后可导出 01~05 号文件）' : `${panel.dates.length} 个共享日期 × ${panel.aliases.length} 条序列`}</li>
</ul>

<h2>2. 方法说明</h2>
<ul>
<li>参考期 ${config.periods.referenceStart} ~ ${config.periods.referenceEnd} 拟合分箱阈值（${config.binning.method} × ${config.binning.bins} 桶），检验期 ${config.periods.testStart} ~ ${config.periods.testEnd} 复用</li>
<li>多重检验校正：${config.tests.correction.toUpperCase()}，显著性水平 α=${config.tests.alpha}</li>
<li>分类路线：成对卡方独立性检验；连续路线：Pearson / Spearman / 互信息（置换 ${config.tests.permutations} 次）</li>
<li>滚动窗口：${config.rolling.enabled ? `${config.rolling.windowDays} 观测 / 步长 ${config.rolling.stepDays}` : '未启用'}；最大滞后：${config.maxLag}</li>
</ul>

<h2>3. 核心显著关系（校正后）</h2>
${htmlResultTable(significant, '全样本显著检验')}

<h2>4. 不稳定关系与全量结果</h2>
${htmlResultTable(parts.categorical, '分类变量检验（全样本）')}
${htmlResultTable(parts.continuous, '连续变量检验（全样本）')}
${htmlResultTable(parts.rolling.slice(0, 200), `滚动窗口检验（前 200 行 / 共 ${parts.rolling.length} 行）`)}
${htmlResultTable(parts.lag, '滞后分析')}

<h2>5. 数据质量风险</h2>
<table><tr><th>序列</th><th>缺失值</th><th>跳点</th><th>冻结段</th><th>复权标记</th><th>双源一致率</th><th>结论</th></tr>${auditRows}</table>

<h2>6. LLM 结论与后续建议</h2>
${llmSection}

<h2>7. 禁止性推断与研究边界</h2>
<ul>
${(output === null ? [] : output.forbidden_inference_flags).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
${forbidden.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
</ul>
<p class="meta">本报告由金融关联性检验平台自动生成；相关性不等于因果，结论仅供研究参考。</p>
</body>
</html>`;
}

export function export15FullReport(input: ExportInput): void {
  downloadText('15_full_report.html', buildFullReportHtml(input), 'text/html');
}
