import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Progress, Spin, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { AuditRow, LlmOutput, ResultRow } from '@platform/schemas';
import { getTaskProgress, getTaskResults, runTask } from '../lib/api';
import LagCurveChart from '../components/LagCurveChart';
import ExportPanel from '../components/ExportPanel';

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
    // P2/X1：运行中每 2s 轮询，到达终态自动停止并刷新结果
    refetchInterval: (q) => {
      const status = q.state.data?.task.status;
      return status === 'running' || status === 'queued' ? 2000 : false;
    },
  });

  const data = query.data;
  const taskStatus = data?.task.status;

  // 进度轮询（仅运行中）：当前步骤 + 总步数驱动进度条；终态后服务端清空自动停轮询条件不再成立
  const progressQuery = useQuery({
    queryKey: ['task-progress', taskId],
    queryFn: () => getTaskProgress(taskId as string),
    enabled: taskId !== undefined && taskStatus === 'running',
    refetchInterval: 1000,
  });

  // 失败重试（PRD：运行中状态展示含失败重试）：重新提交后回到运行中轮询
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => runTask(taskId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['task-results', taskId] });
    },
  });

  const partitions = useMemo(() => {
    const results = data?.results ?? [];
    return {
      categorical: results.filter((r) => r.test_family === 'categorical' && r.window_end === null),
      continuous: results.filter((r) => r.test_family === 'continuous' && r.window_end === null && r.test_name !== 'pearson_lag'),
      rolling: results.filter((r) => r.window_end !== null),
      // 滞后行（PRD 模块 H）：pearson_lag 全扫描（含负 lag 与 lag=0）
      lag: results.filter((r) => r.test_name === 'pearson_lag' && r.window_end === null),
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

  // P2/X1：运行中/排队中 —— 进度条 + 当前步骤（异步轮询，PRD L137/L556）
  if (taskStatus === 'running' || taskStatus === 'queued') {
    const progress = taskStatus === 'running' ? (progressQuery.data?.progress ?? null) : null;
    const percent =
      progress !== null ? Math.round(((progress.stepIndex + 1) / progress.totalSteps) * 100) : 0;
    return (
      <Card>
        <Typography.Title level={3} className="font-display">
          分析运行中
        </Typography.Title>
        {taskStatus === 'queued' ? (
          <Spin tip="排队等待执行…" />
        ) : progress !== null ? (
          <div className="run-progress">
            <Progress percent={percent} status="active" />
            <p className="field-hint">
              第 {progress.stepIndex + 1} / {progress.totalSteps} 步 · {progress.stepLabel}
            </p>
          </div>
        ) : (
          <Spin tip="运行中，等待进度上报…" />
        )}
      </Card>
    );
  }

  // 失败：错误信息 + 一键重试（错误文案含启动清扫的中断说明）
  if (data.task.status === 'failed') {
    return (
      <Card>
        <Alert
          type="error"
          showIcon
          message="分析执行失败"
          description={data.task.errorMessage ?? '未知错误'}
          action={
            <Button type="primary" loading={retry.isPending} onClick={() => retry.mutate()}>
              重新运行
            </Button>
          }
        />
      </Card>
    );
  }

  const { task, results, audit, panel, llm } = data;
  // 局部常量保持类型收窄，供 Tab 渲染闭包内安全引用
  const llmOutput = llm?.output ?? null;
  const config = task.config;
  const failedSeries = audit.filter((a) => a.audit_status === 'fail');
  const significantCount = results.filter((r) => r.significant).length;

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
          <Empty description="未启用滞后扫描（任务配置 maxLag=0）；新建分析时设置最大滞后期即可产出" />
        ) : (
          <>
            {/* PRD 模块 H 双视图：曲线图 + 表格 */}
            <LagCurveChart rows={partitions.lag} />
            <Table<ResultRow>
              className="data-table lag-table"
              size="small"
              rowKey={(r) => `${r.test_name}-${r.left_series}-${r.right_series}-${r.lag}`}
              columns={resultColumns([{ title: '滞后期', dataIndex: 'lag', width: 90, align: 'right' }])}
              dataSource={[...partitions.lag].sort(
                (a, b) =>
                  `${a.left_series}×${a.right_series}`.localeCompare(`${b.left_series}×${b.right_series}`) ||
                  a.lag - b.lag,
              )}
              pagination={false}
              scroll={{ y: 480 }}
            />
          </>
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
    {
      key: 'export',
      // PRD 结果页第七个 Tab：原始导出（01~15 编号文件体系）
      label: '原始导出',
      children: <ExportPanel task={task} panel={panel} partitions={partitions} audit={audit} llm={llm} />,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <h1 className="page-title font-display">{config.projectName}</h1>
        {/* X2：参数调整入口 → 克隆向导（变更后预览步提示哪些结果失效） */}
        <Link to={`/?clone=${task.id}`}>
          <Button>调整参数并重跑</Button>
        </Link>
      </div>

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
              {/* G13：显式研究问题非缺省时展示（LLM 上下文同字段） */}
              {config.researchQuestion !== undefined && (
                <div>
                  <div className="config-summary-label">研究问题</div>
                  <div className="config-summary-value">{config.researchQuestion}</div>
                </div>
              )}
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
                  {config.dataSources.map((s) => (s.kind === 'ticker' ? `${s.alias}（${s.ticker}@${s.provider}${s.dualSource !== undefined ? `，双源@${s.dualSource.provider}` : ''}）` : `${s.alias}（上传文件${s.dualSource !== undefined ? '，双源对账' : ''}）`)).join('、')}
                </div>
              </div>
              {/* G11：派生序列非空时在配置摘要展示（与向导预览同源字段） */}
              {config.derivedSeries.length > 0 && (
                <div>
                  <div className="config-summary-label">派生序列</div>
                  <div className="config-summary-value">
                    {config.derivedSeries.map((d) => `${d.alias} ← ${d.sourceAlias}（${d.transform}）`).join('、')}
                  </div>
                </div>
              )}
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

        {/* 右栏：PRD 导出规范 01~15 编号文件（G10 抽取为 ExportPanel，与「原始导出」Tab 同源） */}
        <div className="rail-right">
          <ExportPanel task={task} panel={panel} partitions={partitions} audit={audit} llm={llm} />
        </div>
      </div>
    </div>
  );
}
