/**
 * 分析编排器（T17，domain 层）。
 *
 * 全链路：数据加载（ticker 适配器 / CSV 上传映射）→ prepareDataset（T09）→
 * 卡方族（T10）+ 连续检验注册表（T11）+ 滞后扫描（PRD 模块 H）+ 多重校正（T12）→
 * 滚动窗口（T13）→ 审计（T14）→ buildLlmContext（T15）→ LLM 推理（T16，注入）。
 *
 * 依赖全部注入（RunnerDeps），本模块无 IO、无框架依赖，可纯单测。
 */
import {
  auditSeries,
  buildLlmContext,
  correctAndMark,
  eventAssociationScan,
  getContinuousMethod,
  goodnessOfFitScan,
  lagScan,
  listContinuousMethodNames,
  pairwiseChiSquare,
  prepareDataset,
  rollingWindowTests,
  type AuditPoint,
  type NumericSeries,
  type PreparedDataset,
  type RollingWindowOptions,
  type RollingWindowReport,
} from '@platform/analysis-engine';
import type {
  AuditRow,
  CorrectionMethod,
  ExportPanel,
  LlmContext,
  LlmOutput,
  LlmTrace,
  ResultRow,
  TaskConfig,
  TestFamily,
} from '@platform/schemas';
import { ValidationError } from '@platform/shared';
import { randomUUID } from 'node:crypto';
import { parseCsv } from '../infrastructure/adapters/csv-parse.js';
import type { HistoryPanel, HistoryQuery } from './data-provider.js';

export interface RunnerDeps {
  fetchHistory(provider: string, ticker: string, query: HistoryQuery): Promise<HistoryPanel>;
  readFileContent(fileId: string): Promise<string>;
  interpret(
    context: LlmContext,
    model: string,
    runId: string,
    /** prompt 模板版本（X6，模板 A/B；透传至提示词资产加载） */
    promptVersion: string,
  ): Promise<{ output: LlmOutput | null; trace: LlmTrace }>;
  /**
   * 滚动窗口执行器（P1）：注入 worker 线程池实现后台并行化；
   * 缺省同线程串行（单测与轻量场景）。输出须与串行口径一致（确定性）。
   */
  rollingExecutor?: (
    dataset: PreparedDataset,
    options: RollingWindowOptions,
  ) => Promise<RollingWindowReport> | RollingWindowReport;
}

export interface AnalysisOutcome {
  runId: string;
  /** 主结果长表（全样本 + 滚动，均已校正标记） */
  results: ResultRow[];
  /** 审计表（每个原始数据源一行） */
  audit: AuditRow[];
  /** 标准化研究面板快照（PRD 导出规范 01~05 底座，G4） */
  panel: ExportPanel;
  llm: { context: LlmContext; output: LlmOutput | null; trace: LlmTrace };
}

interface DraftRow {
  family: TestFamily;
  testName: string;
  left: string;
  right: string;
  windowEnd: string | null;
  lag: number;
  stat: number;
  pRaw: number;
  effect: number | null;
  notes: string | null;
}

/** 校正并定型为 ResultRow（correctAndMark 与 result 契约同口径） */
function finalize(
  drafts: readonly DraftRow[],
  runId: string,
  method: CorrectionMethod,
  alpha: number,
): ResultRow[] {
  if (drafts.length === 0) return [];
  const { adjusted, significant } = correctAndMark(
    drafts.map((d) => d.pRaw),
    method,
    alpha,
  );
  return drafts.map((d, i) => ({
    run_id: runId,
    test_family: d.family,
    test_name: d.testName,
    left_series: d.left,
    right_series: d.right,
    window_end: d.windowEnd,
    lag: d.lag,
    stat_value: d.stat,
    p_value_raw: d.pRaw,
    p_value_adjusted: adjusted[i]!,
    effect_size: d.effect,
    significant: significant[i]!,
    notes: d.notes,
  }));
}

/** CSV 上传映射：标准列名（date_col/close_col/adj_close_col）→ 文件列名 */
function extractUploadSeries(
  text: string,
  mapping: Record<string, string>,
): { points: AuditPoint[]; adjusted: Array<{ date: string; value: number }> } {
  const dateCol = mapping.date_col;
  const closeCol = mapping.close_col;
  if (!dateCol || !closeCol) {
    throw new ValidationError('上传文件字段映射必须包含 date_col 与 close_col');
  }
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) throw new ValidationError('上传 CSV 为空');
  const dateIdx = header.indexOf(dateCol);
  const closeIdx = header.indexOf(closeCol);
  const adjIdx = mapping.adj_close_col !== undefined ? header.indexOf(mapping.adj_close_col) : -1;
  if (dateIdx === -1 || closeIdx === -1 || (mapping.adj_close_col !== undefined && adjIdx === -1)) {
    throw new ValidationError('上传 CSV 表头缺少字段映射指定的列');
  }
  const points: AuditPoint[] = [];
  const adjusted: Array<{ date: string; value: number }> = [];
  for (const row of rows.slice(1)) {
    const date = row[dateIdx]?.trim();
    if (!date) continue;
    const close = Number(row[closeIdx]);
    points.push({ date, value: Number.isNaN(close) ? null : close });
    if (adjIdx >= 0) {
      const adj = Number(row[adjIdx]);
      if (!Number.isNaN(adj)) adjusted.push({ date, value: adj });
    }
  }
  if (points.length === 0) throw new ValidationError('上传 CSV 无有效数据行');
  return { points, adjusted };
}

/**
 * 执行一次完整分析（不碰存储；持久化与状态机由路由层负责）。
 * P2：onProgress 可选上报编排 10 步进度（0..9，持久化步由路由层承担）。
 */
export async function runAnalysis(
  config: TaskConfig,
  deps: RunnerDeps,
  onProgress?: (stepIndex: number) => void,
): Promise<AnalysisOutcome> {
  const runId = randomUUID();
  const report = (stepIndex: number): void => {
    if (onProgress !== undefined) onProgress(stepIndex);
  };

  // 1. 数据加载（dualSource 第二源仅供双源审计对账，不进入分析面板；PRD 模块 J）
  report(0);
  const rawSeries: NumericSeries[] = [];
  const auditPointsByAlias = new Map<string, AuditPoint[]>();
  const adjustedByAlias = new Map<string, Array<{ date: string; value: number }>>();
  const dualPointsByAlias = new Map<string, AuditPoint[]>();
  for (const ds of config.dataSources) {
    if (ds.kind === 'ticker') {
      const panel = await deps.fetchHistory(ds.provider, ds.ticker, {
        start: config.startDate,
        end: config.endDate,
        frequency: config.frequency,
      });
      auditPointsByAlias.set(
        ds.alias,
        panel.points.map((p) => ({ date: p.date, value: p.close })),
      );
      if (ds.dualSource !== undefined) {
        const dual = await deps.fetchHistory(ds.dualSource.provider, ds.ticker, {
          start: config.startDate,
          end: config.endDate,
          frequency: config.frequency,
        });
        dualPointsByAlias.set(
          ds.alias,
          dual.points.map((p) => ({ date: p.date, value: p.close })),
        );
      }
    } else {
      const { points, adjusted } = extractUploadSeries(await deps.readFileContent(ds.fileId), ds.columnMapping);
      auditPointsByAlias.set(ds.alias, points);
      if (adjusted.length > 0) adjustedByAlias.set(ds.alias, adjusted);
      if (ds.dualSource !== undefined) {
        const dual = extractUploadSeries(
          await deps.readFileContent(ds.dualSource.fileId),
          ds.dualSource.columnMapping,
        );
        dualPointsByAlias.set(ds.alias, dual.points);
      }
    }
    const points = auditPointsByAlias.get(ds.alias)!;
    rawSeries.push({
      alias: ds.alias,
      points: points
        .filter((p) => p.value !== null && !Number.isNaN(p.value))
        .map((p) => ({ date: p.date, value: p.value as number })),
    });
  }

  // 2. 标准化 + 离散化管道（S5：frequency 透传，周/月频先重采样再派生对齐）
  report(1);
  const dataset = prepareDataset({
    series: rawSeries,
    derivedSeries: config.derivedSeries,
    periods: config.periods,
    binning: config.binning,
    frequency: config.frequency,
  });

  // 3. 分类变量路线：成对卡方独立性检验（检验期，参考期阈值复用）
  report(2);
  const categoricalDrafts: DraftRow[] = pairwiseChiSquare(dataset).map((r) => {
    const warnings: string[] = [];
    if (r.notes) warnings.push(r.notes);
    if (!r.result.applicability.adequate) {
      warnings.push(`期望频数不足（min=${r.result.applicability.minExpected.toFixed(2)}<5）`);
    }
    return {
      family: 'categorical',
      testName: 'chi_square_independence',
      left: r.leftAlias,
      right: r.rightAlias,
      windowEnd: null,
      lag: 0,
      stat: r.result.statistic,
      pRaw: r.result.pValue,
      effect: r.result.cramersV,
      notes: warnings.length > 0 ? warnings.join('；') : null,
    };
  });

  // 3b. 分布漂移路线：每变量检验期状态分布 vs 参考期期望概率（PRD 模块 E，S1）
  // 参考期零概率箱退化由引擎记入 skipped（与连续路线退化跳过同例，不阻塞其余别名）
  const gofReport = goodnessOfFitScan(dataset);
  const gofDrafts: DraftRow[] = gofReport.rows.map((r) => {
    const warnings: string[] = [];
    if (r.notes) warnings.push(r.notes);
    if (!r.result.applicability.adequate) {
      warnings.push(`期望频数不足（min=${r.result.applicability.minExpected.toFixed(2)}<5）`);
    }
    return {
      family: 'categorical',
      testName: 'chi_square_goodness_of_fit',
      left: r.alias,
      right: r.alias,
      windowEnd: null,
      lag: 0,
      stat: r.result.statistic,
      pRaw: r.result.pValue,
      effect: r.result.cramersV,
      notes: warnings.length > 0 ? warnings.join('；') : null,
    };
  });

  // 3c. 事件标签路线：事件日 vs 非事件日状态分布关联（PRD 首期范围「事件标签」，S4）
  // 事件日不在检验期/日期轴或剪枝后退化由引擎记入 skipped（与 GOF 退化同例，不阻塞其余行）
  const eventReport = eventAssociationScan(dataset, config.events);
  const eventDrafts: DraftRow[] = eventReport.rows.map((r) => {
    const warnings: string[] = [];
    if (r.notes) warnings.push(r.notes);
    if (!r.result.applicability.adequate) {
      warnings.push(`期望频数不足（min=${r.result.applicability.minExpected.toFixed(2)}<5）`);
    }
    return {
      family: 'categorical',
      testName: 'event_association',
      left: `event:${r.eventName}`,
      right: r.alias,
      windowEnd: null,
      lag: 0,
      stat: r.result.statistic,
      pRaw: r.result.pValue,
      effect: r.result.cramersV,
      notes: warnings.length > 0 ? warnings.join('；') : null,
    };
  });

  // 4. 连续变量路线：检验期数值对 × 注册表全部方法（退化抛错即跳过）
  report(3);
  const [testStart, testEnd] = dataset.testIndex;
  const continuousDrafts: DraftRow[] = [];
  for (let i = 0; i < dataset.aliases.length; i += 1) {
    for (let j = i + 1; j < dataset.aliases.length; j += 1) {
      const x = dataset.values[i]!.slice(testStart, testEnd + 1);
      const y = dataset.values[j]!.slice(testStart, testEnd + 1);
      for (const name of listContinuousMethodNames()) {
        try {
          const result = getContinuousMethod(name).run(x, y);
          continuousDrafts.push({
            family: 'continuous',
            testName: result.testName,
            left: dataset.aliases[i]!,
            right: dataset.aliases[j]!,
            windowEnd: null,
            lag: 0,
            stat: result.statValue,
            pRaw: result.pValue,
            effect: result.effectSize,
            notes: result.notes,
          });
        } catch {
          // 退化（如零方差）不产出结果行；PRD 要求警告而非静默——由审计/notes 层承担
        }
      }
    }
  }

  // 5. 滞后分析（PRD 模块 H：检验期数值对 × [-maxLag, +maxLag] Pearson 扫描，单独成批校正）
  report(4);
  const lagDrafts: DraftRow[] = [];
  if (config.maxLag > 0) {
    for (let i = 0; i < dataset.aliases.length; i += 1) {
      for (let j = i + 1; j < dataset.aliases.length; j += 1) {
        const x = dataset.values[i]!.slice(testStart, testEnd + 1);
        const y = dataset.values[j]!.slice(testStart, testEnd + 1);
        try {
          const scan = lagScan(x, y, config.maxLag);
          for (const p of scan.points) {
            lagDrafts.push({
              family: 'continuous',
              testName: 'pearson_lag',
              left: dataset.aliases[i]!,
              right: dataset.aliases[j]!,
              windowEnd: null,
              lag: p.lag,
              stat: p.r,
              pRaw: p.pValue,
              effect: null,
              notes: p.lag === scan.bestLag ? `最大绝对相关 lag=${scan.bestLag}（|r|=${scan.bestAbsR.toFixed(4)}）` : null,
            });
          }
        } catch {
          // 检验期切片后样本量不足以支撑 maxLag：跳过该变量对（不产出滞后行）
        }
      }
    }
  }

  // 6. 滚动窗口（按族统一校正前单独成批；P1：注入并行执行器时后台并行，缺省同线程串行）
  report(5);
  let rollingDrafts: DraftRow[] = [];
  let rollingSkippedCount = 0;
  if (config.rolling.enabled) {
    const rollingOptions = {
      windowSize: config.rolling.windowDays,
      stepSize: config.rolling.stepDays,
      // G5：前端可配置项透传（缺省交给引擎默认：仅完整窗口 / 全部四法）
      ...(config.rolling.minSamples !== undefined ? { minSamples: config.rolling.minSamples } : {}),
      ...(config.rolling.methods !== undefined ? { methods: config.rolling.methods } : {}),
    };
    const report = deps.rollingExecutor
      ? await deps.rollingExecutor(dataset, rollingOptions)
      : rollingWindowTests(dataset, rollingOptions);
    rollingSkippedCount = report.skipped.length;
    rollingDrafts = report.rows.map((r) => ({
      family: (r.testName === 'chi_square_independence' ? 'categorical' : 'continuous') as TestFamily,
      testName: r.testName,
      left: r.leftAlias,
      right: r.rightAlias,
      windowEnd: r.windowEndDate,
      lag: 0,
      stat: r.statValue,
      pRaw: r.pValue,
      effect: r.effectSize,
      notes: r.notes,
    }));
  }

  // 7. 多重检验校正：全样本按族分批、GOF/事件/滞后/滚动各自单独成批（与 alpha 比较标记显著）
  report(6);
  const results = [
    ...finalize(categoricalDrafts, runId, config.tests.correction, config.tests.alpha),
    ...finalize(gofDrafts, runId, config.tests.correction, config.tests.alpha),
    ...finalize(eventDrafts, runId, config.tests.correction, config.tests.alpha),
    ...finalize(continuousDrafts, runId, config.tests.correction, config.tests.alpha),
    ...finalize(lagDrafts, runId, config.tests.correction, config.tests.alpha),
    ...finalize(rollingDrafts, runId, config.tests.correction, config.tests.alpha),
  ];

  // 8. 数据真实性审计（每个原始数据源；配置了 dualSource 的源附加双源一致性对账，PRD 模块 J）
  report(7);
  const audit: AuditRow[] = [];
  const auditNotes: Record<string, string[]> = {};
  for (const [alias, points] of auditPointsByAlias) {
    const dualPoints = dualPointsByAlias.get(alias);
    const report = auditSeries({
      alias,
      points,
      thresholds: config.audit,
      adjustedPoints: adjustedByAlias.get(alias),
      dualSource: dualPoints !== undefined ? { alias: `${alias}·第二源`, points: dualPoints } : undefined,
    });
    // 同质性检验结论入风险说明（引擎不持有 alpha，显著性判定在编排层）
    if (report.homogeneity !== null) {
      const h = report.homogeneity;
      const verdict = h.pValue < config.tests.alpha ? '两源分布显著不同，口径差异需排查' : '两源分布未见显著差异';
      report.notes.push(`双源同质性卡方=${h.statistic.toFixed(2)}（p=${h.pValue.toExponential(2)}）：${verdict}`);
    }
    audit.push(report.row);
    auditNotes[alias] = report.notes;
  }

  // 9. 导出面板快照（PRD 导出规范 01/04/05 底座；02 复权来自上传源 adj_close；03 收益率由前端派生）
  report(8);
  const adjustedExport: ExportPanel['adjusted'] = {};
  for (const [alias, adjusted] of adjustedByAlias) {
    adjustedExport[alias] = adjusted;
  }
  const panel: ExportPanel = {
    run_id: runId,
    aliases: [...dataset.aliases],
    dates: [...dataset.dates],
    prices: dataset.values.map((row) => [...row]),
    categories: dataset.aliases.map((alias) => [...dataset.categories[alias]!]),
    thresholds: Object.fromEntries(
      dataset.aliases.map((alias) => [
        alias,
        {
          method: config.binning.method,
          labels: [...dataset.binning[alias]!.labels],
          thresholds: [...dataset.binning[alias]!.thresholds],
        },
      ]),
    ),
    adjusted: adjustedExport,
    periods: { ...config.periods },
  };

  // 10. LLM 上下文 + 推理（缺密钥降级 skipped，失败不阻塞统计结果）
  report(9);
  const context = buildLlmContext({
    config,
    // G13：用户显式研究问题优先（缺省由引擎按 projectName 派生，关 N12）
    researchQuestion: config.researchQuestion,
    results,
    rollingSkippedCount,
    audit,
    auditNotes,
  });
  const llm = await deps.interpret(context, config.llmModel, runId, config.promptVersion);

  return { runId, results, audit, panel, llm: { context, output: llm.output, trace: llm.trace } };
}
