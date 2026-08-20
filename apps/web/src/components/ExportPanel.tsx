/**
 * apps/web · 导出面板（PRD 01~15 编号文件体系，浏览器端生成）
 *
 * G10：从结果页右栏抽取为独立组件，同时服务
 * - 右栏快速导出区（三栏布局原样保留）
 * - PRD 结果页第七个 Tab「原始导出」
 */
import { Button } from 'antd';
import type {
  AuditRow,
  ExportPanel,
  LlmContext,
  LlmOutput,
  LlmTrace,
  ResultRow,
  TaskRecord,
} from '@platform/schemas';
import { downloadJson } from '../lib/export';
import {
  export01PricesRaw, export02PricesAdj, export03ReturnPanel, export04StatePanel, export05Thresholds,
  export06ChiSquare, export07Continuous, export08Rolling, export09Lag,
  export10QualityAudit, export11SourceConsistency, export13Conclusion, export15FullReport,
  hasAdjusted,
} from '../lib/export-report';

export interface ExportPartitions {
  categorical: ResultRow[];
  continuous: ResultRow[];
  rolling: ResultRow[];
  lag: ResultRow[];
}

interface ExportPanelProps {
  task: TaskRecord;
  /** 导出面板快照（G4 之前运行的历史任务为 null，01~05 不可导出） */
  panel: ExportPanel | null;
  partitions: ExportPartitions;
  audit: AuditRow[];
  llm: { context: LlmContext; output: LlmOutput | null; trace: LlmTrace } | null;
}

export default function ExportPanel({ task, panel, partitions, audit, llm }: ExportPanelProps) {
  const exportInput = { task, results: [...partitions.categorical, ...partitions.continuous, ...partitions.rolling, ...partitions.lag], audit, panel, llm };
  const llmOutput = llm?.output ?? null;
  const forbiddenClaims = llm !== null ? llm.context.forbidden_claims : [];

  return (
    <>
      <div className="rail-card">
        <h3 className="rail-card-title">导出 · 数据面板</h3>
        <div className="export-buttons">
          {panel === null && (
            <div className="export-hint">历史任务无面板快照，重新运行后可导出 01~05 号文件。</div>
          )}
          <Button block disabled={panel === null} onClick={() => panel !== null && export01PricesRaw(panel)}>
            01 原始收盘价面板
          </Button>
          <Button block disabled={!hasAdjusted(panel)} onClick={() => panel !== null && export02PricesAdj(panel)}>
            02 复权收盘价面板
          </Button>
          <Button block disabled={panel === null} onClick={() => panel !== null && export03ReturnPanel(panel)}>
            03 收益率面板（%）
          </Button>
          <Button block disabled={panel === null} onClick={() => panel !== null && export04StatePanel(panel)}>
            04 离散状态面板
          </Button>
          <Button block disabled={panel === null} onClick={() => panel !== null && export05Thresholds(task, panel)}>
            05 阈值定义 JSON
          </Button>
        </div>
      </div>
      <div className="rail-card">
        <h3 className="rail-card-title">导出 · 检验结果</h3>
        <div className="export-buttons">
          <Button block disabled={partitions.categorical.length === 0} onClick={() => export06ChiSquare(partitions.categorical)}>
            06 卡方检验汇总
          </Button>
          <Button block disabled={partitions.continuous.length === 0} onClick={() => export07Continuous(partitions.continuous)}>
            07 连续依赖检验汇总
          </Button>
          <Button block disabled={partitions.rolling.length === 0} onClick={() => export08Rolling(partitions.rolling)}>
            08 滚动窗口结果
          </Button>
          <Button block disabled={partitions.lag.length === 0} onClick={() => export09Lag(partitions.lag)}>
            09 滞后分析结果（按变量对）
          </Button>
        </div>
      </div>
      <div className="rail-card">
        <h3 className="rail-card-title">导出 · 审计与 LLM</h3>
        <div className="export-buttons">
          <Button block disabled={audit.length === 0} onClick={() => export10QualityAudit(audit)}>
            10 数据质量审计
          </Button>
          <Button block disabled={audit.length === 0} onClick={() => export11SourceConsistency(exportInput)}>
            11 数据源一致性
          </Button>
          <Button
            block
            disabled={llm === null}
            onClick={() => llm !== null && downloadJson('12_llm_context.json', llm.context)}
          >
            12 LLM 上下文 JSON
          </Button>
          <Button
            block
            disabled={llmOutput === null}
            onClick={() => llmOutput !== null && export13Conclusion(llmOutput, forbiddenClaims)}
          >
            13 LLM 结论 Markdown
          </Button>
          <Button
            block
            disabled={llm === null}
            onClick={() => llm !== null && downloadJson('14_llm_trace.json', llm.trace)}
          >
            14 LLM 调用追踪 JSON
          </Button>
          <Button block type="primary" onClick={() => export15FullReport(exportInput)}>
            15 完整报告 HTML
          </Button>
        </div>
      </div>
    </>
  );
}
