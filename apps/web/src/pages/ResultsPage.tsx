import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Spin, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { AuditRow, LlmOutput, ResultRow } from '@platform/schemas';
import { getTaskResults } from '../lib/api';
import { downloadCsv, downloadJson } from '../lib/export';

/** 审计状态 → tokens.css 三级风险语义类（pass=clear / warn=watch / fail=breach） */
const AUDIT_RISK_CLASS: Record<AuditRow['audit_status'], string> = {
  pass: 'risk-clear',
  warn: 'risk-watch',
  fail: 'risk-breach',
};

const AUDIT_STATUS_TEXT: Record<AuditRow['audit_status'], string> = {
  pass: '低风险',
  warn: '中风险',
  fail: '高风险',
};

const LLM_STATUS_TEXT: Record<string, string> = {
  success: '生成成功',
  timeout: '超时',
  failed: '失败',
  skipped: '未配置密钥（降级跳过）',
};

/** 数字列统一数据字体（tokens.css .font-data / tabular-nums） */
function num(value: number | null): string {
  return value === null ? '—' : Number(value.toPrecision(6)).toString();
}

function resultColumns(extra?: ColumnsType<ResultRow>): ColumnsType<ResultRow> {
  return [
    { title: '左变量', dataIndex: 'left_series', width: 110 },
    { title: '右变量', dataIndex: 'right_series', width: 110 },
    { title: '检验', dataIndex: 'test_name', width: 170 },
    ...(extra ?? []),
    { title: '统计量', dataIndex: 'stat_value', width: 110, align: 'right', render: (v: number) => <span className="font-data">{num(v)}</span> },
    { title: 'p 值（原始）', dataIndex: 'p_value_raw', width: 120, align: 'right', render: (v: number) => <span className="font-data">{num(v)}</span> },
    { title: 'p 值（校正）', dataIndex: 'p_value_adjusted', width: 120, align: 'right', render: (v: number) => <span className="font-data">{num(v)}</span> },
    { title: '效应量', dataIndex: 'effect_size', width: 100, align: 'right', render: (v: number | null) => <span className="font-data">{num(v)}</span> },
    {
      title: '显著',
      dataIndex: 'significant',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="success">显著</Tag> : <Tag>不显著</Tag>),
    },
    { title: '备注', dataIndex: 'notes', render: (v: string | null) => v ?? '—' },
  ];
}

/** LLM 输出字段 → 中文标题（与 required_answer_sections 对齐） */
const LLM_OUTPUT_SECTIONS: Array<{ key: keyof LlmOutput; label: string }> = [
  { key: 'executive_conclusion', label: '研究结论摘要' },
  { key: 'statistical_interpretation', label: '统计结果解释' },
  { key: 'stability_assessment', label: '稳定性评估' },
  { key: 'data_quality_caveats', label: '数据质量注意事项' },
  { key: 'market_meaning', label: '市场含义' },
  { key: 'strategy_risk_notes', label: '策略风险提示' },
];

export default function ResultsPage() {
  const { taskId } = useParams<{ taskId: string }>();

  const query = useQuery({
    queryKey: ['task-results', taskId],
    queryFn: () => getTaskResults(taskId as string),
    enabled: taskId !== undefined,
  });

  const data = query.data;

  const partitions = useMemo(() => {
    const results = data?.results ?? [];
    return {
      categorical: results.filter((r) => r.test_family === 'categorical' && r.window_end === null && r.lag === 0),
      continuous: results.filter((r) => r.test_family === 'continuous' && r.window_end === null && r.lag === 0),
      rolling: results.filter((r) => r.window_end !== null),
      lag: results.filter((r) => r.lag > 0 && r.window_end === null),
    };
  }, [data]);

  if (taskId === undefined) {
    return (
      <Card>
        <Typography.Title level={3} className="font-display">
          分析结果
        </Typography.Title>
        <Empty description={<>请从 <Link to="/history">历史任务</Link> 选择一个已完成任务查看结果，或<Link to="/">新建分析</Link></>} />
      </Card>
    );
  }

  if (query.isLoading) {
    return (
      <Card>
        <Spin tip="加载结果中…" />
      </Card>
    );
  }

  if (query.isError || data === undefined) {
    return (
      <Card>
        <Alert
          type="error"
          showIcon
          message="结果加载失败"
          description={query.error instanceof Error ? query.error.message : '未知错误'}
        />
      </Card>
    );
  }

  const { task, results, audit, llm } = data;
  // 局部常量保持类型收窄，供 Tab 渲染闭包内安全引用
  const llmOutput = llm?.output ?? null;
  const config = task.config;
  const failedSeries = audit.filter((a) => a.audit_status === 'fail');
  const significantCount = results.filter((r) => r.significant).length;

  /* ---------------- 导出（浏览器端生成） ---------------- */

  const resultHeaders = ['run_id', 'test_family', 'test_name', 'left_series', 'right_series', 'window_end', 'lag', 'stat_value', 'p_value_raw', 'p_value_adjusted', 'effect_size', 'significant', 'notes'];
  function exportResultsCsv(): void {
    downloadCsv(
      '06_result_table.csv',
      resultHeaders,
      results.map((r) => [r.run_id, r.test_family, r.test_name, r.left_series, r.right_series, r.window_end, r.lag, r.stat_value, r.p_value_raw, r.p_value_adjusted, r.effect_size, r.significant, r.notes]),
    );
  }

  const auditHeaders = ['series_alias', 'missing_value_count', 'missing_business_days_count', 'duplicate_index_count', 'stale_run_count', 'jump_count', 'max_abs_return_pct', 'adjustment_flag_count', 'source_match_ratio', 'audit_status'];
  function exportAuditCsv(): void {
    downloadCsv(
      '08_audit_table.csv',
      auditHeaders,
      audit.map((a) => [a.series_alias, a.missing_value_count, a.missing_business_days_count, a.duplicate_index_count, a.stale_run_count, a.jump_count, a.max_abs_return_pct, a.adjustment_flag_count, a.source_match_ratio, a.audit_status]),
    );
  }

  /* ---------------- Tab 内容 ---------------- */

  const tabItems = [
    {
      key: 'categorical',
      label: `分类检验（${partitions.categorical.length}）`,
      children: (
        <Table<ResultRow>
          className="data-table"
          size="small"
          rowKey={(r) => `${r.test_name}-${r.left_series}-${r.right_series}`}
          columns={resultColumns()}
          dataSource={partitions.categorical}
          pagination={false}
        />
      ),
    },
    {
      key: 'continuous',
      label: `连续检验（${partitions.continuous.length}）`,
      children: (
        <Table<ResultRow>
          className="data-table"
          size="small"
          rowKey={(r) => `${r.test_name}-${r.left_series}-${r.right_series}`}
          columns={resultColumns()}
          dataSource={partitions.continuous}
          pagination={false}
        />
      ),
    },
    {
      key: 'rolling',
      label: `滚动窗口（${partitions.rolling.length}）`,
      children:
        partitions.rolling.length === 0 ? (
          <Empty description="未启用滚动窗口或窗口数不足" />
        ) : (
          <Table<ResultRow>
            className="data-table"
            size="small"
            rowKey={(r) => `${r.test_name}-${r.left_series}-${r.right_series}-${r.window_end}`}
            columns={resultColumns([{ title: '窗口结束', dataIndex: 'window_end', width: 110 }])}
            dataSource={partitions.rolling}
            scroll={{ y: 480 }}
          />
        ),
    },
    {
      key: 'lag',
      label: `滞后分析（${partitions.lag.length}）`,
      children:
        partitions.lag.length === 0 ? (
          <Empty description="滞后分析引擎尚未实现（缺口 N13），当前不产出滞后行" />
        ) : (
          <Table<ResultRow>
            className="data-table"
            size="small"
            rowKey={(r) => `${r.test_name}-${r.left_series}-${r.right_series}-${r.lag}`}
            columns={resultColumns([{ title: '滞后期', dataIndex: 'lag', width: 90, align: 'right' }])}
            dataSource={partitions.lag}
            pagination={false}
          />
        ),
    },
    {
      key: 'audit',
      label: `数据审计（${audit.length}）`,
      children: (
        <Table<AuditRow>
          className="data-table"
          size="small"
          rowKey={(a) => a.series_alias}
          pagination={false}
          dataSource={audit}
          columns={[
            { title: '序列', dataIndex: 'series_alias' },
            { title: '缺失值', dataIndex: 'missing_value_count', align: 'right' },
            { title: '缺失交易日', dataIndex: 'missing_business_days_count', align: 'right' },
            { title: '重复索引', dataIndex: 'duplicate_index_count', align: 'right' },
            { title: '冻结段', dataIndex: 'stale_run_count', align: 'right' },
            { title: '跳点', dataIndex: 'jump_count', align: 'right' },
            { title: '最大单日波动 %', dataIndex: 'max_abs_return_pct', align: 'right', render: (v: number) => num(v) },
            { title: '复权标记', dataIndex: 'adjustment_flag_count', align: 'right' },
            { title: '双源一致率', dataIndex: 'source_match_ratio', align: 'right', render: (v: number) => num(v) },
            {
              title: '结论',
              dataIndex: 'audit_status',
              render: (status: AuditRow['audit_status']) => (
                <span className={`risk-chip ${AUDIT_RISK_CLASS[status]}`}>{AUDIT_STATUS_TEXT[status]}</span>
              ),
            },
          ]}
        />
      ),
    },
    {
      key: 'llm',
      label: 'LLM 结论',
      children:
        llm === null ? (
          <Empty description="该任务尚无 LLM 产物" />
        ) : (
          <div>
            <div className="llm-split">
              {/* PRD：LLM 结论与统计原始结果并排呈现 */}
              <div>
                {llmOutput === null ? (
                  <Alert
                    type="warning"
                    showIcon
                    message={`LLM 结论未生成：${LLM_STATUS_TEXT[llm.trace.status] ?? llm.trace.status}`}
                    description={llm.trace.error_message ?? undefined}
                  />
                ) : (
                  <>
                    <Tag color={llmOutput.confidence_level === 'high' ? 'success' : llmOutput.confidence_level === 'medium' ? 'warning' : 'error'}>
                      置信级别：{llmOutput.confidence_level}
                    </Tag>
                    {LLM_OUTPUT_SECTIONS.map(({ key, label }) => (
                      <div key={key} className="llm-section">
                        <div className="llm-section-label">{label}</div>
                        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                          {llmOutput[key] as string}
                        </Typography.Paragraph>
                      </div>
                    ))}
                    {(llmOutput.next_research_steps.length > 0 || llmOutput.monitoring_suggestions.length > 0) && (
                      <div className="llm-section">
                        <div className="llm-section-label">后续研究 / 监控建议</div>
                        <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
                          {[...llmOutput.next_research_steps, ...llmOutput.monitoring_suggestions].map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="llm-section">
                      <div className="llm-section-label">禁止性推断提示</div>
                      <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
                        {llmOutput.forbidden_inference_flags.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>
              <div>
                <div className="llm-section-label">统计原始结果（摘要）</div>
                <Table<ResultRow>
                  className="data-table"
                  size="small"
                  rowKey={(r) => `${r.test_name}-${r.left_series}-${r.right_series}-${r.window_end ?? 'full'}-${r.lag}`}
                  columns={[
                    { title: '变量对', render: (_: unknown, r: ResultRow) => `${r.left_series} × ${r.right_series}` },
                    { title: '检验', dataIndex: 'test_name' },
                    { title: 'p（校正）', dataIndex: 'p_value_adjusted', align: 'right', render: (v: number) => <span className="font-data">{num(v)}</span> },
                    { title: '显著', dataIndex: 'significant', render: (v: boolean) => (v ? <Tag color="success">是</Tag> : <Tag>否</Tag>) },
                  ]}
                  dataSource={results.filter((r) => r.window_end === null && r.lag === 0)}
                  pagination={false}
                  scroll={{ y: 420 }}
                />
              </div>
            </div>
            <div className="llm-trace">
              调用追踪：provider={llm.trace.provider}，model={llm.trace.model}，prompt={llm.trace.prompt_version}，
              状态={LLM_STATUS_TEXT[llm.trace.status] ?? llm.trace.status}
              {llm.trace.latency_ms !== null ? `，耗时 ${llm.trace.latency_ms}ms` : ''}
            </div>
          </div>
        ),
    },
  ];

  return (
    <div>
      <h1 className="page-title font-display">{config.projectName}</h1>

      {/* PRD：审计高风险须固定醒目提示，不得折叠隐藏 */}
      {failedSeries.length > 0 && (
        <div className="results-banner risk-banner-breach">
          <strong>数据审计高风险：</strong>
          {failedSeries.map((a) => a.series_alias).join('、')} 未通过数据质量审计。
          全部统计结论需谨慎解释，建议补充数据源交叉验证后再作决策参考。
        </div>
      )}

      <div className="layout-results">
        {/* 左栏：配置摘要 + 风险标记条（tokens.css sticky） */}
        <div className="rail-left">
          <div className="rail-card">
            <h3 className="rail-card-title">配置摘要</h3>
            <div className="config-summary">
              <div>
                <div className="config-summary-label">样本区间</div>
                <div className="config-summary-value font-data">{config.startDate} ~ {config.endDate}</div>
              </div>
              <div>
                <div className="config-summary-label">参考期 / 检验期</div>
                <div className="config-summary-value font-data">
                  {config.periods.referenceStart} ~ {config.periods.referenceEnd}
                  <br />
                  {config.periods.testStart} ~ {config.periods.testEnd}
                </div>
              </div>
              <div>
                <div className="config-summary-label">频率 / 分箱</div>
                <div className="config-summary-value">{config.frequency} / {config.binning.method} × {config.binning.bins} 桶</div>
              </div>
              <div>
                <div className="config-summary-label">校正 / 显著性水平</div>
                <div className="config-summary-value">{config.tests.correction.toUpperCase()} / α={config.tests.alpha}</div>
              </div>
              <div>
                <div className="config-summary-label">数据源</div>
                <div className="config-summary-value">
                  {config.dataSources.map((s) => (s.kind === 'ticker' ? `${s.alias}（${s.ticker}@${s.provider}）` : `${s.alias}（上传文件）`)).join('、')}
                </div>
              </div>
              <div>
                <div className="config-summary-label">运行标识</div>
                <div className="config-summary-value font-data">{results[0]?.run_id ?? task.id}</div>
              </div>
            </div>
          </div>
          <div className="rail-card">
            <h3 className="rail-card-title">风险标记条</h3>
            <div className="risk-chips">
              {audit.map((a) => (
                <span key={a.series_alias} className={`risk-chip ${AUDIT_RISK_CLASS[a.audit_status]}`}>
                  {a.series_alias} · {AUDIT_STATUS_TEXT[a.audit_status]}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 中栏：总览 + 检验 Tab 区 */}
        <div>
          <Card style={{ marginBottom: 'var(--space-4)' }}>
            <div className="overview-stats">
              <div>
                <div className="config-summary-label">检验总数</div>
                <div className="font-data" style={{ fontSize: 'var(--text-heading)' }}>{results.length}</div>
              </div>
              <div>
                <div className="config-summary-label">显著（校正后）</div>
                <div className="font-data" style={{ fontSize: 'var(--text-heading)' }}>{significantCount}</div>
              </div>
              <div>
                <div className="config-summary-label">审计结论</div>
                <div>
                  {failedSeries.length > 0 ? (
                    <span className="risk-chip risk-breach">存在高风险</span>
                  ) : audit.some((a) => a.audit_status === 'warn') ? (
                    <span className="risk-chip risk-watch">存在中风险</span>
                  ) : (
                    <span className="risk-chip risk-clear">全部通过</span>
                  )}
                </div>
              </div>
              <div>
                <div className="config-summary-label">LLM 解释</div>
                <div>{llm === null ? '—' : LLM_STATUS_TEXT[llm.trace.status] ?? llm.trace.status}</div>
              </div>
            </div>
          </Card>
          <Card>
            <Tabs items={tabItems} />
          </Card>
        </div>

        {/* 右栏：导出 */}
        <div className="rail-right">
          <div className="rail-card">
            <h3 className="rail-card-title">导出</h3>
            <div className="export-buttons">
              <Button block onClick={exportResultsCsv} disabled={results.length === 0}>
                结果长表 CSV
              </Button>
              <Button block onClick={exportAuditCsv} disabled={audit.length === 0}>
                审计表 CSV
              </Button>
              <Button
                block
                disabled={llm === null}
                onClick={() => llm !== null && downloadJson('12_llm_context.json', llm.context)}
              >
                LLM 上下文 JSON
              </Button>
              <Button
                block
                disabled={llmOutput === null}
                onClick={() => llmOutput !== null && downloadJson('13_llm_output.json', llmOutput)}
              >
                LLM 结论 JSON
              </Button>
              <Button
                block
                disabled={llm === null}
                onClick={() => llm !== null && downloadJson('14_llm_trace.json', llm.trace)}
              >
                LLM 调用追踪 JSON
              </Button>
              <Button block onClick={() => downloadJson('99_full_payload.json', data)}>
                完整载荷 JSON
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
