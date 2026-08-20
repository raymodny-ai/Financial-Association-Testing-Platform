import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Spin,
  Steps,
  Upload,
  message,
} from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  DEFAULTS,
  taskConfigSchema,
  type AnalysisTemplate,
  type DerivedSeries,
  type RollingMethod,
  type TaskConfig,
  type UploadedFile,
} from '@platform/schemas';
import {
  createTask,
  deleteTemplate,
  getTask,
  listFiles,
  listTemplates,
  runTask,
  saveTemplate,
  uploadCsv,
} from '../lib/api';

/** G5：workspaceId 由服务端 Cookie 注入并覆盖，客户端 safeParse 仅占位校验 */
const PLACEHOLDER_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

const DATE_FORMAT = 'YYYY-MM-DD';

/** 向导内的数据源草稿（提交时映射为 dataSourceSchema 契约） */
interface DraftSource {
  key: string;
  kind: 'ticker' | 'upload';
  alias: string;
  ticker: string;
  provider: 'yahoo' | 'stooq';
  /** 双源一致性审计第二提供方（PRD 模块 J）；空串 = 未启用 */
  dualProvider: '' | 'yahoo' | 'stooq';
  fileId?: string;
  filename?: string;
  columns: string[];
  dateCol?: string;
  closeCol?: string;
  adjCloseCol?: string;
  /** 双源审计第二上传文件（PRD 模块 J，G12）；仅对 upload 源有效 */
  dualFileId?: string;
  dualFilename?: string;
  dualColumns: string[];
  dualDateCol?: string;
  dualCloseCol?: string;
  dualAdjCloseCol?: string;
  uploading: boolean;
  /** 第二文件上传中 */
  dualUploading: boolean;
}

let sourceSeq = 0;
function newDraftSource(): DraftSource {
  sourceSeq += 1;
  return {
    key: `source-${sourceSeq}`,
    kind: 'ticker',
    alias: `S${sourceSeq}`,
    ticker: '',
    provider: 'yahoo',
    dualProvider: '',
    columns: [],
    dualColumns: [],
    uploading: false,
    dualUploading: false,
  };
}

const STEP_TITLES = ['数据源', '样本区间', '期间划分', '检验选项', '预览与运行'];

/** 滚动窗口检验方法选项（与契约 rollingMethodSchema 同源，G5 前端透传） */
const ROLLING_METHOD_OPTIONS: Array<{ value: RollingMethod; label: string }> = [
  { value: 'chi_square_independence', label: '卡方独立性' },
  { value: 'pearson', label: 'Pearson 相关' },
  { value: 'spearman', label: 'Spearman 相关' },
  { value: 'mutual_information', label: '互信息（置换）' },
];

/** 派生序列变换选项（与契约 derivedSeriesSchema.transform 同源，G11） */
const TRANSFORM_OPTIONS: Array<{ value: DerivedSeries['transform']; label: string }> = [
  { value: 'pct_return', label: '百分比收益率（pct_return）' },
  { value: 'log_return', label: '对数收益率（log_return）' },
  { value: 'diff', label: '一阶差分（diff）' },
];

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cloneTaskId = searchParams.get('clone');
  const [step, setStep] = useState(0);

  const [projectName, setProjectName] = useState('');
  const [sources, setSources] = useState<DraftSource[]>([newDraftSource(), newDraftSource()]);
  /** 派生序列（G11：由基础序列经收益率/差分派生，参与后续全部检验） */
  const [derived, setDerived] = useState<DerivedSeries[]>([]);

  const [startDate, setStartDate] = useState<Dayjs | null>(null);
  const [endDate, setEndDate] = useState<Dayjs | null>(null);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const [referenceStart, setReferenceStart] = useState<Dayjs | null>(null);
  const [referenceEnd, setReferenceEnd] = useState<Dayjs | null>(null);
  const [testStart, setTestStart] = useState<Dayjs | null>(null);
  const [testEnd, setTestEnd] = useState<Dayjs | null>(null);

  const [binningMethod, setBinningMethod] = useState<'quantile' | 'equal_width' | 'fixed_threshold'>('quantile');
  const [bins, setBins] = useState<number>(DEFAULTS.binningBins);
  const [rollingEnabled, setRollingEnabled] = useState(true);
  const [windowDays, setWindowDays] = useState<number>(DEFAULTS.rollingWindowDays);
  const [stepDays, setStepDays] = useState<number>(DEFAULTS.rollingStepDays);
  /** 最小样本量；null = 缺省（引擎默认仅完整窗口） */
  const [minSamples, setMinSamples] = useState<number | null>(null);
  /** 滚动检验方法子集；默认全部四法 */
  const [rollingMethods, setRollingMethods] = useState<RollingMethod[]>(ROLLING_METHOD_OPTIONS.map((o) => o.value));
  const [alpha, setAlpha] = useState<number>(DEFAULTS.alpha);
  const [correction, setCorrection] = useState<'none' | 'bonferroni' | 'bh' | 'by'>('bh');
  const [permutations, setPermutations] = useState<number>(1000);
  const [maxLag, setMaxLag] = useState<number>(DEFAULTS.maxLag);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ---------------- 分析模板（G6：保存模板 / 复制分析） ---------------- */

  const [templates, setTemplates] = useState<AnalysisTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    void listTemplates().then(setTemplates).catch(() => undefined);
  }, []);

  function patchSource(key: string, patch: Partial<DraftSource>): void {
    setSources((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function handleUpload(key: string, file: UploadFile): Promise<void> {
    const raw = file as unknown as File;
    patchSource(key, { uploading: true });
    try {
      const uploaded = await uploadCsv(raw);
      patchSource(key, {
        uploading: false,
        fileId: uploaded.id,
        filename: uploaded.filename,
        columns: uploaded.columns,
        dateCol: undefined,
        closeCol: undefined,
        adjCloseCol: undefined,
      });
      message.success(`已上传 ${uploaded.filename}（${uploaded.rowCount} 行）`);
    } catch (error) {
      patchSource(key, { uploading: false });
      message.error(error instanceof Error ? error.message : '上传失败');
    }
  }

  /** G12：双源审计第二文件上传（仅供对账，不进入分析面板） */
  async function handleDualUpload(key: string, file: UploadFile): Promise<void> {
    const raw = file as unknown as File;
    patchSource(key, { dualUploading: true });
    try {
      const uploaded = await uploadCsv(raw);
      patchSource(key, {
        dualUploading: false,
        dualFileId: uploaded.id,
        dualFilename: uploaded.filename,
        dualColumns: uploaded.columns,
        dualDateCol: undefined,
        dualCloseCol: undefined,
        dualAdjCloseCol: undefined,
      });
      message.success(`已上传第二源 ${uploaded.filename}（${uploaded.rowCount} 行）`);
    } catch (error) {
      patchSource(key, { dualUploading: false });
      message.error(error instanceof Error ? error.message : '上传失败');
    }
  }

  /* ---------------- 分步校验 ---------------- */

  const step0Valid =
    projectName.trim() !== '' &&
    sources.length >= 2 &&
    new Set(sources.map((s) => s.alias.trim())).size === sources.length &&
    sources.every((s) => {
      if (s.alias.trim() === '') return false;
      if (s.kind === 'ticker') return s.ticker.trim() !== '';
      // G12：第二源一旦选定文件即要求完成字段映射（与主文件同口径）
      if (s.dualFileId !== undefined && (s.dualDateCol === undefined || s.dualCloseCol === undefined)) return false;
      return s.fileId !== undefined && s.dateCol !== undefined && s.closeCol !== undefined;
    }) &&
    // 派生序列：别名非空且与原始/其他派生不冲突，基础序列必须存在（引擎同名报错前置拦截）
    new Set(derived.map((d) => d.alias.trim())).size === derived.length &&
    derived.every((d) => {
      const alias = d.alias.trim();
      if (alias === '') return false;
      if (sources.some((s) => s.alias.trim() === alias)) return false;
      return sources.some((s) => s.alias.trim() === d.sourceAlias);
    });

  const step1Valid =
    startDate !== null && endDate !== null && !endDate.isBefore(startDate, 'day');

  const step2Valid =
    referenceStart !== null &&
    referenceEnd !== null &&
    testStart !== null &&
    testEnd !== null &&
    referenceEnd.isBefore(testStart, 'day') &&
    !testEnd.isBefore(testStart, 'day') &&
    (startDate === null || !referenceStart.isBefore(startDate, 'day')) &&
    (endDate === null || !testEnd.isAfter(endDate, 'day'));

  const stepValid = [step0Valid, step1Valid, step2Valid, true, true][step];

  /* ---------------- 组装配置（契约字段全集） ---------------- */

  function buildConfig(): Record<string, unknown> {
    const fmt = (d: Dayjs | null): string => (d === null ? '' : d.format(DATE_FORMAT));
    return {
      projectName: projectName.trim(),
      workspaceId: PLACEHOLDER_WORKSPACE_ID,
      dataSources: sources.map((s) =>
        s.kind === 'ticker'
          ? {
              kind: 'ticker',
              alias: s.alias.trim(),
              ticker: s.ticker.trim(),
              provider: s.provider,
              // 双源一致性审计（PRD 模块 J）：同 ticker 第二提供方，仅供审计对账
              ...(s.dualProvider !== '' ? { dualSource: { provider: s.dualProvider } } : {}),
            }
          : {
              kind: 'upload',
              alias: s.alias.trim(),
              fileId: s.fileId ?? '',
              columnMapping: {
                date_col: s.dateCol ?? '',
                close_col: s.closeCol ?? '',
                ...(s.adjCloseCol ? { adj_close_col: s.adjCloseCol } : {}),
              },
              // G12：双源一致性审计第二上传文件（契约 dualSource.fileId，关 N18）
              ...(s.dualFileId !== undefined
                ? {
                    dualSource: {
                      fileId: s.dualFileId,
                      columnMapping: {
                        date_col: s.dualDateCol ?? '',
                        close_col: s.dualCloseCol ?? '',
                        ...(s.dualAdjCloseCol ? { adj_close_col: s.dualAdjCloseCol } : {}),
                      },
                    },
                  }
                : {}),
            },
      ),
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      frequency,
      // G11：派生序列定义（契约 default []，显式透传以支持模板/复制分析回显）
      derivedSeries: derived.map((d) => ({ ...d, alias: d.alias.trim() })),
      periods: {
        referenceStart: fmt(referenceStart),
        referenceEnd: fmt(referenceEnd),
        testStart: fmt(testStart),
        testEnd: fmt(testEnd),
      },
      binning: { method: binningMethod, bins },
      tests: { alpha, correction, permutations, permutationSeed: 20260819 },
      rolling: {
        enabled: rollingEnabled,
        windowDays,
        stepDays,
        ...(minSamples !== null ? { minSamples } : {}),
        methods: rollingMethods,
      },
      maxLag,
      llmModel: 'qwen-plus',
      promptVersion: 'v1',
    };
  }

  const parsed = useMemo(() => taskConfigSchema.safeParse(buildConfig()), [
    // 预览步刷新时机：进入第 4 步或点击运行时重算即可，此处保持轻量依赖
    step, sources, derived, projectName, startDate, endDate, frequency,
    referenceStart, referenceEnd, testStart, testEnd,
    binningMethod, bins, rollingEnabled, windowDays, stepDays, minSamples, rollingMethods,
    alpha, correction, permutations, maxLag,
  ]);

  const issueTexts = useMemo(
    () =>
      parsed.success
        ? []
        : parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}：${issue.message}`),
    [parsed],
  );

  /* ---------------- 提交：创建任务 → 同步运行 → 跳转结果页 ---------------- */

  async function handleSubmit(): Promise<void> {
    if (!parsed.success) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const task = await createTask(parsed.data);
      await runTask(task.id);
      message.success('分析完成，正在打开结果页');
      navigate(`/results/${task.id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '运行失败');
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------- 模板加载：TaskConfig → 向导草稿状态 ---------------- */

  function applyConfig(config: TaskConfig, filesById: Map<string, UploadedFile>): void {
    setProjectName(config.projectName);
    setStartDate(dayjs(config.startDate));
    setEndDate(dayjs(config.endDate));
    setFrequency(config.frequency);
    setReferenceStart(dayjs(config.periods.referenceStart));
    setReferenceEnd(dayjs(config.periods.referenceEnd));
    setTestStart(dayjs(config.periods.testStart));
    setTestEnd(dayjs(config.periods.testEnd));
    setBinningMethod(config.binning.method);
    setBins(config.binning.bins);
    setRollingEnabled(config.rolling.enabled);
    setWindowDays(config.rolling.windowDays);
    setStepDays(config.rolling.stepDays);
    setMinSamples(config.rolling.minSamples ?? null);
    setRollingMethods(config.rolling.methods ?? ROLLING_METHOD_OPTIONS.map((o) => o.value));
    setAlpha(config.tests.alpha);
    setCorrection(config.tests.correction);
    setPermutations(config.tests.permutations);
    setMaxLag(config.maxLag);
    setSources(
      config.dataSources.map((ds) => {
        if (ds.kind === 'ticker') {
          return {
            ...newDraftSource(),
            kind: 'ticker',
            alias: ds.alias,
            ticker: ds.ticker,
            provider: ds.provider === 'stooq' ? 'stooq' : 'yahoo',
            dualProvider: ds.dualSource?.provider === 'stooq' ? 'stooq' : ds.dualSource?.provider === 'yahoo' ? 'yahoo' : '',
          };
        }
        const file = filesById.get(ds.fileId);
        const dualFile = ds.dualSource !== undefined ? filesById.get(ds.dualSource.fileId) : undefined;
        return {
          ...newDraftSource(),
          kind: 'upload',
          alias: ds.alias,
          fileId: ds.fileId,
          filename: file?.filename ?? '（文件已删除）',
          columns: file?.columns ?? [],
          dateCol: ds.columnMapping.date_col,
          closeCol: ds.columnMapping.close_col,
          adjCloseCol: ds.columnMapping.adj_close_col,
          // G12：第二源回显（文件已删除时降级标注，映射仍保留供核对）
          ...(ds.dualSource !== undefined
            ? {
                dualFileId: ds.dualSource.fileId,
                dualFilename: dualFile?.filename ?? '（文件已删除）',
                dualColumns: dualFile?.columns ?? [],
                dualDateCol: ds.dualSource.columnMapping.date_col,
                dualCloseCol: ds.dualSource.columnMapping.close_col,
                dualAdjCloseCol: ds.dualSource.columnMapping.adj_close_col,
              }
            : {}),
        };
      }),
    );
    setDerived(config.derivedSeries);
  }

  async function loadTemplate(template: AnalysisTemplate): Promise<void> {
    try {
      const files = await listFiles();
      applyConfig(template.config, new Map(files.map((f) => [f.id, f])));
      message.success(`已载入模板「${template.name}」，请核对后运行`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板载入失败');
    }
  }

  async function handleSaveTemplate(): Promise<void> {
    if (!parsed.success) return;
    const name = templateName.trim() === '' ? projectName : templateName.trim();
    try {
      await saveTemplate(name, parsed.data);
      setTemplates(await listTemplates());
      setSaveModalOpen(false);
      setTemplateName('');
      message.success(`模板「${name}」已保存`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板保存失败');
    }
  }

  async function handleDeleteTemplate(templateId: string): Promise<void> {
    try {
      await deleteTemplate(templateId);
      setTemplates(await listTemplates());
      message.success('模板已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模板删除失败');
    }
  }

  /* 复制分析（PRD）：?clone=<taskId> 预填同配置后可编辑重跑 */
  useEffect(() => {
    if (cloneTaskId === null) return;
    void (async () => {
      try {
        const [task, files] = await Promise.all([getTask(cloneTaskId), listFiles()]);
        applyConfig(task.config, new Map(files.map((f) => [f.id, f])));
        message.success(`已载入任务「${task.config.projectName}」的配置，可调整后运行`);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '任务配置载入失败');
      }
    })();
    // 仅首次挂载执行一次（clone 参数不变时不重复拉取）
  }, [cloneTaskId]);

  /* ---------------- 渲染 ---------------- */

  return (
    <div>
      <h1 className="page-title font-display">新建分析</h1>
      <Card>
        <Steps current={step} items={STEP_TITLES.map((title) => ({ title }))} />
        <div className="wizard-body">
          {step === 0 && (
            <div>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {templates.length > 0 && (
                  <div>
                    <span className="field-label">分析模板（一键载入已保存配置）</span>
                    <Space.Compact style={{ width: '100%' }}>
                      <Select<string>
                        style={{ width: '100%' }}
                        placeholder="选择模板后自动填充全部配置"
                        value={selectedTemplateId}
                        options={templates.map((t) => ({ value: t.id, label: t.name }))}
                        onChange={(id) => {
                          setSelectedTemplateId(id);
                          const t = templates.find((x) => x.id === id);
                          if (t !== undefined) void loadTemplate(t);
                        }}
                      />
                      <Popconfirm
                        title="删除选中的模板？"
                        disabled={selectedTemplateId === null}
                        onConfirm={() => {
                          if (selectedTemplateId !== null) {
                            void handleDeleteTemplate(selectedTemplateId);
                            setSelectedTemplateId(null);
                          }
                        }}
                      >
                        <Button danger disabled={selectedTemplateId === null}>删除选中</Button>
                      </Popconfirm>
                    </Space.Compact>
                  </div>
                )}
                <div>
                  <span className="field-label">项目名称</span>
                  <Input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="例如：沪深 300 与标普 500 关联性检验"
                    maxLength={128}
                  />
                </div>
                <div>
                  <span className="field-label">数据源（至少 2 组，序列别名面板内唯一）</span>
                  {sources.map((s) => (
                    <div key={s.key} className="source-card">
                      <div className="source-card-header">
                        <Radio.Group
                          value={s.kind}
                          onChange={(e) => patchSource(s.key, { kind: e.target.value })}
                          optionType="button"
                          options={[
                            { label: '市场代码', value: 'ticker' },
                            { label: 'CSV 上传', value: 'upload' },
                          ]}
                        />
                        <Button
                          danger
                          size="small"
                          disabled={sources.length <= 2}
                          onClick={() => setSources((prev) => prev.filter((x) => x.key !== s.key))}
                        >
                          移除
                        </Button>
                      </div>
                      <div className="source-fields">
                        <div>
                          <span className="field-label">序列别名</span>
                          <Input
                            value={s.alias}
                            maxLength={64}
                            onChange={(e) => patchSource(s.key, { alias: e.target.value })}
                          />
                        </div>
                        {s.kind === 'ticker' ? (
                          <>
                            <div>
                              <span className="field-label">市场代码</span>
                              <Input
                                value={s.ticker}
                                placeholder="如 AAPL / ^GSPC / 600519.SS"
                                maxLength={32}
                                onChange={(e) => patchSource(s.key, { ticker: e.target.value })}
                              />
                            </div>
                            <div>
                              <span className="field-label">数据提供方</span>
                              <Select
                                value={s.provider}
                                style={{ width: '100%' }}
                                onChange={(value) => patchSource(s.key, { provider: value, dualProvider: '' })}
                                options={[
                                  { label: 'Yahoo Finance（主力）', value: 'yahoo' },
                                  { label: 'Stooq（休眠备用）', value: 'stooq' },
                                ]}
                              />
                            </div>
                            <div>
                              <span className="field-label">双源审计（第二提供方）</span>
                              <Select
                                value={s.dualProvider}
                                style={{ width: '100%' }}
                                onChange={(value) => patchSource(s.key, { dualProvider: value })}
                                options={[
                                  { label: '不启用', value: '' },
                                  { label: 'Yahoo Finance', value: 'yahoo', disabled: s.provider === 'yahoo' },
                                  { label: 'Stooq', value: 'stooq', disabled: s.provider === 'stooq' },
                                ]}
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <span className="field-label">CSV 文件</span>
                              <Upload
                                accept=".csv,text/csv"
                                showUploadList={false}
                                beforeUpload={(file) => {
                                  void handleUpload(s.key, file as unknown as UploadFile);
                                  return false;
                                }}
                              >
                                <Button icon={<UploadOutlined />} loading={s.uploading}>
                                  {s.filename ?? '选择文件'}
                                </Button>
                              </Upload>
                            </div>
                            <div>
                              <span className="field-label">日期列（date_col）</span>
                              <Select
                                value={s.dateCol}
                                placeholder="选择列"
                                style={{ width: '100%' }}
                                disabled={s.columns.length === 0}
                                onChange={(value) => patchSource(s.key, { dateCol: value })}
                                options={s.columns.map((c) => ({ label: c, value: c }))}
                              />
                            </div>
                            <div>
                              <span className="field-label">收盘价列（close_col）</span>
                              <Select
                                value={s.closeCol}
                                placeholder="选择列"
                                style={{ width: '100%' }}
                                disabled={s.columns.length === 0}
                                onChange={(value) => patchSource(s.key, { closeCol: value })}
                                options={s.columns.map((c) => ({ label: c, value: c }))}
                              />
                            </div>
                            <div>
                              <span className="field-label">复权价列（adj_close_col，可选）</span>
                              <Select
                                value={s.adjCloseCol}
                                placeholder="可不选"
                                allowClear
                                style={{ width: '100%' }}
                                disabled={s.columns.length === 0}
                                onChange={(value) => patchSource(s.key, { adjCloseCol: value })}
                                options={s.columns.map((c) => ({ label: c, value: c }))}
                              />
                            </div>
                            {/* G12：双源一致性审计第二文件（PRD 模块 J，仅供对账，关 N18） */}
                            <div>
                              <span className="field-label">双源审计·第二文件（可选，同口径另一数据源）</span>
                              <Space>
                                <Upload
                                  accept=".csv,text/csv"
                                  showUploadList={false}
                                  beforeUpload={(file) => {
                                    void handleDualUpload(s.key, file as unknown as UploadFile);
                                    return false;
                                  }}
                                >
                                  <Button icon={<UploadOutlined />} loading={s.dualUploading}>
                                    {s.dualFilename ?? '选择第二文件'}
                                  </Button>
                                </Upload>
                                {s.dualFileId !== undefined && (
                                  <Button
                                    size="small"
                                    onClick={() =>
                                      patchSource(s.key, {
                                        dualFileId: undefined,
                                        dualFilename: undefined,
                                        dualColumns: [],
                                        dualDateCol: undefined,
                                        dualCloseCol: undefined,
                                        dualAdjCloseCol: undefined,
                                      })
                                    }
                                  >
                                    清除
                                  </Button>
                                )}
                              </Space>
                            </div>
                            {s.dualFileId !== undefined && (
                              <>
                                <div>
                                  <span className="field-label">第二源日期列（date_col）</span>
                                  <Select
                                    value={s.dualDateCol}
                                    placeholder="选择列"
                                    style={{ width: '100%' }}
                                    disabled={s.dualColumns.length === 0}
                                    onChange={(value) => patchSource(s.key, { dualDateCol: value })}
                                    options={s.dualColumns.map((c) => ({ label: c, value: c }))}
                                  />
                                </div>
                                <div>
                                  <span className="field-label">第二源收盘价列（close_col）</span>
                                  <Select
                                    value={s.dualCloseCol}
                                    placeholder="选择列"
                                    style={{ width: '100%' }}
                                    disabled={s.dualColumns.length === 0}
                                    onChange={(value) => patchSource(s.key, { dualCloseCol: value })}
                                    options={s.dualColumns.map((c) => ({ label: c, value: c }))}
                                  />
                                </div>
                                <div>
                                  <span className="field-label">第二源复权价列（adj_close_col，可选）</span>
                                  <Select
                                    value={s.dualAdjCloseCol}
                                    placeholder="可不选"
                                    allowClear
                                    style={{ width: '100%' }}
                                    disabled={s.dualColumns.length === 0}
                                    onChange={(value) => patchSource(s.key, { dualAdjCloseCol: value })}
                                    options={s.dualColumns.map((c) => ({ label: c, value: c }))}
                                  />
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => setSources((prev) => [...prev, newDraftSource()])}
                  >
                    添加数据源
                  </Button>
                </div>
                <div>
                  {/* G11：派生序列编辑（PRD 配置设计「派生序列定义」，关 N15） */}
                  <span className="field-label">派生序列（可选：由基础序列经变换生成，与原始序列同等参与检验）</span>
                  {derived.map((d, index) => (
                    <div key={`derived-${index}`} className="source-card">
                      <div className="source-card-header">
                        <span className="font-data">D{index + 1}</span>
                        <Button
                          danger
                          size="small"
                          onClick={() => setDerived((prev) => prev.filter((_, i) => i !== index))}
                        >
                          移除
                        </Button>
                      </div>
                      <div className="source-fields">
                        <div>
                          <span className="field-label">派生别名</span>
                          <Input
                            value={d.alias}
                            maxLength={64}
                            placeholder="如 rA"
                            onChange={(e) =>
                              setDerived((prev) => prev.map((x, i) => (i === index ? { ...x, alias: e.target.value } : x)))
                            }
                          />
                        </div>
                        <div>
                          <span className="field-label">基础序列</span>
                          <Select
                            value={d.sourceAlias}
                            placeholder="选择序列"
                            style={{ width: '100%' }}
                            onChange={(value) =>
                              setDerived((prev) => prev.map((x, i) => (i === index ? { ...x, sourceAlias: value } : x)))
                            }
                            options={sources
                              .map((s) => s.alias.trim())
                              .filter((alias) => alias !== '')
                              .map((alias) => ({ label: alias, value: alias }))}
                          />
                        </div>
                        <div>
                          <span className="field-label">变换方式</span>
                          <Select<DerivedSeries['transform']>
                            value={d.transform}
                            style={{ width: '100%' }}
                            options={TRANSFORM_OPTIONS}
                            onChange={(value) =>
                              setDerived((prev) => prev.map((x, i) => (i === index ? { ...x, transform: value } : x)))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      const firstAlias = sources.map((s) => s.alias.trim()).find((alias) => alias !== '') ?? '';
                      setDerived((prev) => [...prev, { alias: '', sourceAlias: firstAlias, transform: 'pct_return' }]);
                    }}
                  >
                    添加派生序列
                  </Button>
                </div>
              </Space>
            </div>
          )}

          {step === 1 && (
            <div className="source-fields">
              <div>
                <span className="field-label">样本开始日期</span>
                <DatePicker
                  value={startDate}
                  format={DATE_FORMAT}
                  style={{ width: '100%' }}
                  onChange={setStartDate}
                />
              </div>
              <div>
                <span className="field-label">样本结束日期</span>
                <DatePicker
                  value={endDate}
                  format={DATE_FORMAT}
                  style={{ width: '100%' }}
                  onChange={setEndDate}
                />
              </div>
              <div>
                <span className="field-label">数据频率</span>
                <Select
                  value={frequency}
                  style={{ width: '100%' }}
                  onChange={setFrequency}
                  options={[
                    { label: '日频（daily）', value: 'daily' },
                    { label: '周频（weekly）', value: 'weekly' },
                    { label: '月频（monthly）', value: 'monthly' },
                  ]}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="source-fields">
                <div>
                  <span className="field-label">参考期开始</span>
                  <DatePicker
                    value={referenceStart}
                    format={DATE_FORMAT}
                    style={{ width: '100%' }}
                    onChange={setReferenceStart}
                  />
                </div>
                <div>
                  <span className="field-label">参考期结束</span>
                  <DatePicker
                    value={referenceEnd}
                    format={DATE_FORMAT}
                    style={{ width: '100%' }}
                    onChange={setReferenceEnd}
                  />
                </div>
                <div>
                  <span className="field-label">检验期开始</span>
                  <DatePicker
                    value={testStart}
                    format={DATE_FORMAT}
                    style={{ width: '100%' }}
                    onChange={setTestStart}
                  />
                </div>
                <div>
                  <span className="field-label">检验期结束</span>
                  <DatePicker
                    value={testEnd}
                    format={DATE_FORMAT}
                    style={{ width: '100%' }}
                    onChange={setTestEnd}
                  />
                </div>
              </div>
              <Divider style={{ margin: 'var(--space-4) 0' }} />
              <Alert
                type="info"
                showIcon
                message="参考期用于固定离散化阈值，检验期复用该阈值做关联性检验；参考期结束日期必须早于检验期开始日期。"
              />
            </div>
          )}

          {step === 3 && (
            <div className="source-fields">
              <div>
                <span className="field-label">分箱方法</span>
                <Select
                  value={binningMethod}
                  style={{ width: '100%' }}
                  onChange={setBinningMethod}
                  options={[
                    { label: '分位数分箱（推荐）', value: 'quantile' },
                    { label: '等宽分箱', value: 'equal_width' },
                    { label: '固定阈值', value: 'fixed_threshold' },
                  ]}
                />
              </div>
              <div>
                <span className="field-label">分箱桶数</span>
                <InputNumber value={bins} min={2} max={10} style={{ width: '100%' }} onChange={(v) => setBins(v ?? DEFAULTS.binningBins)} />
              </div>
              <div>
                <span className="field-label">滚动窗口</span>
                <Radio.Group
                  value={rollingEnabled}
                  onChange={(e) => setRollingEnabled(e.target.value)}
                  optionType="button"
                  options={[
                    { label: '开启', value: true },
                    { label: '关闭', value: false },
                  ]}
                />
              </div>
              <div>
                <span className="field-label">窗口长度（交易日）</span>
                <InputNumber value={windowDays} min={30} style={{ width: '100%' }} disabled={!rollingEnabled} onChange={(v) => setWindowDays(v ?? DEFAULTS.rollingWindowDays)} />
              </div>
              <div>
                <span className="field-label">滚动步长（交易日）</span>
                <InputNumber value={stepDays} min={1} style={{ width: '100%' }} disabled={!rollingEnabled} onChange={(v) => setStepDays(v ?? DEFAULTS.rollingStepDays)} />
              </div>
              <div>
                <span className="field-label">最小样本量（观测数）</span>
                <InputNumber
                  value={minSamples}
                  min={2}
                  max={windowDays}
                  placeholder={`缺省=${windowDays}（仅完整窗口）`}
                  style={{ width: '100%' }}
                  disabled={!rollingEnabled}
                  onChange={(v) => setMinSamples(v)}
                />
              </div>
              <div>
                <span className="field-label">滚动检验方法</span>
                <Select<RollingMethod[]>
                  mode="multiple"
                  value={rollingMethods}
                  style={{ width: '100%' }}
                  disabled={!rollingEnabled}
                  options={ROLLING_METHOD_OPTIONS}
                  onChange={(v) => setRollingMethods(v)}
                />
              </div>
              <div>
                <span className="field-label">显著性水平 α</span>
                <InputNumber value={alpha} min={0.001} max={0.999} step={0.01} style={{ width: '100%' }} onChange={(v) => setAlpha(v ?? DEFAULTS.alpha)} />
              </div>
              <div>
                <span className="field-label">多重检验校正</span>
                <Select
                  value={correction}
                  style={{ width: '100%' }}
                  onChange={setCorrection}
                  options={[
                    { label: 'BH-FDR（推荐）', value: 'bh' },
                    { label: 'Bonferroni', value: 'bonferroni' },
                    { label: 'BY', value: 'by' },
                    { label: '不校正', value: 'none' },
                  ]}
                />
              </div>
              <div>
                <span className="field-label">置换检验次数</span>
                <InputNumber value={permutations} min={100} max={100000} style={{ width: '100%' }} onChange={(v) => setPermutations(v ?? 1000)} />
              </div>
              <div>
                <span className="field-label">最大滞后期</span>
                <InputNumber value={maxLag} min={0} max={60} style={{ width: '100%' }} onChange={(v) => setMaxLag(v ?? DEFAULTS.maxLag)} />
              </div>
            </div>
          )}

          {step === 4 && (
            <Spin spinning={submitting} tip="分析运行中（含 LLM 解释，约需 1~2 分钟）…">
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {issueTexts.length > 0 && (
                  <Alert
                    type="error"
                    showIcon
                    message="配置校验未通过"
                    description={
                      <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
                        {issueTexts.map((text) => (
                          <li key={text}>{text}</li>
                        ))}
                      </ul>
                    }
                  />
                )}
                {submitError !== null && <Alert type="error" showIcon message="运行失败" description={submitError} />}
                <Descriptions
                  bordered
                  size="small"
                  column={2}
                  items={[
                    { key: 'project', label: '项目名称', children: projectName },
                    { key: 'sources', label: '数据源', children: sources.map((s) => `${s.alias}（${s.kind === 'ticker' ? s.ticker : s.filename ?? 'CSV'}${s.kind === 'ticker' && s.dualProvider !== '' ? `，双源审计:${s.dualProvider}` : ''}${s.kind === 'upload' && s.dualFileId !== undefined ? `，双源审计:${s.dualFilename ?? 'CSV'}` : ''}）`).join('、') },
                    { key: 'derived', label: '派生序列', children: derived.length === 0 ? '无' : derived.map((d) => `${d.alias} ← ${d.sourceAlias}（${TRANSFORM_OPTIONS.find((t) => t.value === d.transform)?.label ?? d.transform}）`).join('、') },
                    { key: 'range', label: '样本区间', children: `${startDate?.format(DATE_FORMAT) ?? ''} ~ ${endDate?.format(DATE_FORMAT) ?? ''}` },
                    { key: 'periods', label: '参考期 / 检验期', children: `${referenceStart?.format(DATE_FORMAT) ?? ''} ~ ${referenceEnd?.format(DATE_FORMAT) ?? ''} / ${testStart?.format(DATE_FORMAT) ?? ''} ~ ${testEnd?.format(DATE_FORMAT) ?? ''}` },
                    { key: 'binning', label: '分箱', children: `${binningMethod} × ${bins} 桶` },
                    { key: 'tests', label: '检验选项', children: `α=${alpha}，校正=${correction}，置换=${permutations}，最大滞后=${maxLag}` },
                    { key: 'rolling', label: '滚动窗口', children: rollingEnabled ? `${windowDays} 日 / 步长 ${stepDays}${minSamples !== null ? ` / 最小样本 ${minSamples}` : ''} / ${rollingMethods.length} 法` : '关闭' },
                  ]}
                />
                <Space>
                  <Button type="primary" size="large" disabled={!parsed.success} onClick={() => void handleSubmit()}>
                    创建并运行分析
                  </Button>
                  {/* PRD 配置设计：保存模板（同配置可复用） */}
                  <Button
                    size="large"
                    disabled={!parsed.success}
                    onClick={() => {
                      setTemplateName(projectName);
                      setSaveModalOpen(true);
                    }}
                  >
                    保存为模板
                  </Button>
                </Space>
              </Space>
            </Spin>
          )}
        </div>

        <div className="wizard-footer">
          <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            上一步
          </Button>
          <div>
            {!stepValid && step < 4 && (
              <Alert type="warning" message="当前步骤尚有必填项未完成" style={{ display: 'inline-flex', marginRight: 'var(--space-4)' }} />
            )}
            <Button type="primary" disabled={!stepValid || step >= 4} onClick={() => setStep((s) => s + 1)}>
              下一步
            </Button>
          </div>
        </div>
      </Card>

      {/* 保存模板弹窗（PRD 配置设计：模板名缺省取项目名） */}
      <Modal
        title="保存分析模板"
        open={saveModalOpen}
        onOk={() => void handleSaveTemplate()}
        onCancel={() => setSaveModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <span className="field-label">模板名称</span>
        <Input
          value={templateName}
          maxLength={64}
          placeholder="缺省使用项目名称"
          onChange={(e) => setTemplateName(e.target.value)}
        />
      </Modal>
    </div>
  );
}
