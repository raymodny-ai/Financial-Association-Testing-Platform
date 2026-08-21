# CONTEXT — 金融关联性检验平台

> 领域词汇表与模块-接缝关系。新词汇/新接缝必须即时登记（write-code 纪律）。

## 领域词汇表

| 术语 | 定义 |
| --- | --- |
| 工作区（Workspace） | 匿名隔离单元。httpOnly Cookie `fap_workspace` 签发 UUID，无登录；workspaceId 一律服务端注入，跨工作区查询视同 404（G5 定案）。 |
| 任务（Task） | 一次关联性检验编排单元。状态机 queued → running → completed/failed，config 为 taskConfigSchema 的 JSONB 持久化。 |
| HistoryPanel | 数据适配器统一返回：ticker + frequency + points(OHLCV) + 元数据三字段 source/source_version/fetched_at（ADR 001 条款 2）。 |
| NumericSeries | 分析引擎输入：alias + (date, value) 点集。由上游（适配器/CSV）将原始面板规约而来。 |
| AlignedPanel | 日期交集对齐后的面板：共享升序日期轴 + aliases + values 矩阵。 |
| 参考期 / 检验期 | PeriodSplit 闭区间。参考期用于拟合分箱阈值；检验期复用阈值做检验（可复现方法学）。 |
| 派生序列（DerivedSeries） | 由源序列经 pct_return/log_return/diff 变换派生，首点丢弃；ratio（S3）为双源变换：分子/分母按公共日期逐点相除不丢首点，契约 refine 守卫 denominatorAlias 与 ratio 互锁。 |
| 分箱拟合（fit/assign 分离） | fitBinning 仅在参考期拟合阈值；assignBins 对全轴复用。value ≤ 阈值归下箱，越界归首/末箱。四法：quantile/equal_width/fixed_threshold（S2 转正：用户阈值直用不拟合，契约 thresholds 与 method 互锁且升序、长度 = bins−1）/stddev（S2：均值中心 ± σ 间隔对称布点，样本标准差 ddof=1，偶数桶阈值含均值）。 |
| quantileLinear | numpy.quantile(method='linear') 等价实现：pos = q*(n-1) 线性插值。 |
| chi2sf | 卡方分布生存函数 P(χ²>x)，p 值计算通道；jstat 仅提供 CDF（ADR 001），已对偶数 df 闭式解验证达 1e-9。 |
| 期望频数适用性 | 卡方近似条件报告：minExpected、fractionExpectedBelow5、adequate(=minExpected≥5)；不满足时必须警告而非静默执行（PRD）。 |
| 零边际剪枝 | 检验期未出现的箱形成全零行/列，构造列联表后自动剪除并在 notes 记录；剪枝后不足 2×2 视为退化抛错。 |
| 卡方拟合优度（GOF，S1） | PRD 模块 E：逐别名检验期状态频数 vs 参考期期望概率（参考期频数/参考期样本量）；参考期零概率箱退化由 goodnessOfFitScan 记入 skipped 不阻塞其余别名；结果行 family=categorical、test_name=chi_square_goodness_of_fit、左右同为该别名、效应量 null，校正单独成批；前端分区/导出/LLM 摘要按族自动承接。 |
| 事件标签关联（S4） | PRD 首期范围「事件标签」的 MVP 落地：契约 events 数组（name/date/category 可选，同名同日期重复拒绝，default []）；引擎 eventAssociationScan 逐事件×逐别名构造「事件日 vs 非事件日」2×K 列联表（检验期、固定箱空间、零边际剪枝）走卡方独立性；事件日不在日期轴/检验期或剪枝后不足 2×2 记 skipped 不阻塞；结果行 family=categorical、test_name=event_association、left=event:<名称>、right=别名，校正单独成批；前端向导检验选项步事件编辑器（名称/日期/分类）+ 预览回显，结果分区/导出/LLM 按族自动承接。 |
| studentTSf | t 分布生存函数，相关系数 p 值通道；df≤2 用解析闭式解（jstat 精度不足），df≥3 走 jstat。 |
| 平均秩（ranksWithTies） | Spearman 秩变换：并列值取秩均值，Spearman = 秩上的 Pearson。 |
| 互信息（MI） | 定义式 Σ p(x,y)ln(p(x,y)/(p(x)p(y)))，自然对数；连续变量经等频分箱后估计；置换检验 p=(≥观测次数+1)/(B+1)，播种 mulberry32 可复现。 |
| HSIC（H2） | 核独立性检验（Gretton 2005）：有偏统计量 tr(KHLH)/(n−1)²，高斯 RBF 核 + 中位数带宽；计算走迹展开式免构造 H；置换检验播种 mulberry32，归一化 HSIC 作效应量；全样本内置（B=199），滚动层可选扩展法（B=99，不入默认四法）。 |
| 连续检验可插拔注册表 | ContinuousDependencyMethod 契约（name + run(x,y)），内置 pearson/spearman/mutual_information/hsic（H2 接入），后续插入无需改调用方。 |
| 多重检验校正（adjustPValues） | PRD 模块 I：bonferroni=min(p·m,1)；bh step-up 累积最小；by 乘 c(m)=调和数；语义对齐 statsmodels multipletests，按值而非位置校正。 |
| correctAndMark | 校正+显著性成对产出接缝：adjusted 写 p_value_adjusted，significant = adjusted < alpha（与 result.ts 契约同口径）。 |
| 滚动窗口调度（planWindows） | 检验期内按观测数（日频即交易日数）滑动：起点按步长推进，末端钳制到检验期尾，长度 ≥ minSamples（默认 windowSize）才保留。minSamples/methods（默认四法子集，hsic 可选扩展）经 rollingConfigSchema 可选字段透传（G5，refine 约束 minSamples≤windowDays），前端向导检验选项步可配（缺省交给引擎默认）。 |
| 退化窗口（skipped） | 窗口内零方差/剪枝后不足 2×2/零跨度等前提不满足时不产出结果行，原因记入 skipped（PRD：警告而非静默）。 |
| 审计（auditSeries） | PRD 模块 J 六类：缺失值/重复索引/缺失交易日（日期索引存在性口径）/stale run（≥3 同值）/跳点（阈值主规则，零命中降级 MAD 兜底）/复权差异；输出 auditRow 9 字段 + notes + 双源同质性。 |
| 双源一致率 | 主序列等频三分箱阈值对两源共享日期分箱，状态相同占比；同质性走 chiSquareHomogeneity；单源为 1。 |
| 双源一致性审计接入（dualSource，G3） | PRD 模块 J/用例 4 接通：dataSourceSchema 可选 dualSource（ticker→第二 provider；upload→第二 fileId+映射）；编排层装载第二源（不入分析面板）注入 auditSeries.dualSource；一致率低于 sourceMatchRatioWarn → warn；同质性卡方结论（含 α 显著性判定）由编排层写入 notes → 传导 LLM audit_key_findings；前端向导数据源步可选第二提供方（与主源互斥）。 |
| 审计状态判定 | missingRatio ≥ fail 阈 → fail；≥ warn 阈/有跳点/有 stale/一致率低于阈 → warn；否则 pass。 |
| 滞后扫描（lagScan） | PRD 模块 H（G1/G2）：lag=k（k>0）= x 领先 y k 期（x[0..n-1-k]↔y[k..n-1]），k<0 对称；扫描 [-maxLag,+maxLag] 全整数 lag 的 Pearson r/p/n，bestLag=最大 abs(r)（并列取 abs(lag) 更小）；退化切片（零方差）跳过不中断，全退化抛 RangeError；注意 -0 归一（Object.is 区分 ±0）。 |
| 滞后行（pearson_lag） | 编排产出：family=continuous、test_name='pearson_lag'、检验期数值切片、单独成批校正；最优 lag 行 notes 标注 abs(r)；DB lag 约束 ±60（迁移 004）；前端按 test_name 分区（兼容负 lag）。 |
| 滞后双视图（LagCurveChart） | 结果页滞后 Tab（PRD 模块 H）：零依赖 SVG 折线图（x=lag/y=r∈[-1,1]，按变量对取 --chart-series-* 序列色，显著点实心加重）+ 表格双视图；未启用时（maxLag=0）引导文案。 |
| 分析模板（AnalysisTemplate，G6） | PRD 配置设计三入口：「保存模板」（预览步弹窗，name+TaskConfig 落 config_templates 表 JSONB，迁移 006）/「复制分析」（历史页 → /?clone=<taskId> 预填向导）/「重跑同配置」（历史页重跑）；模板载入经 applyConfig 反向映射向导草稿（upload 源 columns 经 listFiles 补全，文件已删降级标注）；workspaceId 服务端注入（与 tasks 同口径）。 |
| 导出面板快照（ExportPanel，G4） | PRD 导出规范 01~05 号文件的数据底座：runAnalysis 产出 {aliases/dates/prices/categories/thresholds/adjusted/periods}，run_panels 表 JSONB 持久化（重跑 ON CONFLICT 替换，迁移 005），GET results 随产物返回；G4 前历史任务为 null（前端禁用 01~05 并提示重跑）。 |
| 导出规范 01~15（export-report.ts） | PRD 导出文件编号体系：01 原始价/02 复权价/03 收益率/04 状态面板/05 阈值 JSON（依赖 panel）· 06 卡方/07 连续/08 滚动/09 滞后按变量对拆分 · 10 质量审计/11 源一致性 · 12 LLM 上下文/13 结论 Markdown/14 追踪 · 15 完整报告 HTML（7 节：数据概况/方法/显著/不稳定/质量/LLM/禁止性，escapeHtml 防注入）；分区口径与 ResultsPage Tab 同源（partitionResults）。 |
| 研究摘要对象（buildLlmContext） | PRD 模块 K：LLM 不读大表，只读 12 字段上下文。输入 TaskConfig+ResultTable+AuditTable；行分区规则 window_end 非空=滚动、lag≠0=滞后、其余=全样本；输出经 llmContextSchema 运行时校验。 |
| 全局置信旗标（global_confidence_flags） | 输入侧安全约束注入：审计 fail→置信降级、弱效应显著→统计显著≠经济显著、少数窗口显著→禁述稳定规律、correction=none→假阳性提示。 |
| 提示词渲染（renderPrompt） | {{placeholder}} ← LlmContext 12 字段同源；数组渲染编号列表、空数组渲染「无」；未知占位符抛错防模板-契约漂移。 |
| LLM 推理编排（runLlmInterpretation） | 渲染→调用（90s 超时/重试一次）→剔围栏→JSON.parse→llmOutputSchema 校验；永不抛错，产出 {output|null, trace}：success/failed/timeout/skipped（无密钥降级），失败不阻塞统计持久化（meta.json）。 |
| OpenAI 兼容客户端（openAiCompatibleClient） | qwen（DashScope compatible-mode）与 deepseek 同一 chat/completions 协议；response_format=json_object；AbortError→LlmTimeoutError，非 2xx→AppError(502)。 |
| 黄金基准集 | tests/fixtures/stat-reference.json，scipy/numpy 参考值对拍，容差 1e-9（ADR 001 决策二）。 |
| 任务运行编排（runAnalysis） | T17-A domain 层纯 DI：数据加载（ticker 适配器/CSV 映射 date_col/close_col/adj_close_col）→ prepareDataset → 卡方独立性+拟合优度（GOF，S1）+连续注册表四法 → 滞后扫描（maxLag>0 时）→ 校正（全样本按族分批、GOF/滞后/滚动各自单独成批）→ 滚动窗口 → 每源审计 → buildLlmContext → interpret；重跑语义为 result/audit 整体替换、llm_artifacts ON CONFLICT 更新。 |
| 运行/结果端点 | POST /api/tasks/:id/run（running 时 409，失败回写 status=failed，成功后 panelRepository.save 落盘快照）与 GET /api/tasks/:id/results（task+results+audit+panel+llm 四产物一次返回，出参过 Zod 校验）。 |
| 新建分析向导（HomePage） | T17-B 五步 Steps：数据源（ticker/CSV 动态列表+列映射）→ 样本区间 → 期间划分 → 检验选项 → 预览与运行；提交前 taskConfigSchema.safeParse 全量校验（workspaceId 占位，服务端 Cookie 覆盖），创建→同步运行→跳结果页。 |
| 安全基线（T18） | helmet 安全头 + 固定窗口限流（rateLimiter 按 IP，默认 300/60s，内存计数）+ Origin 白名单 CORS（凭据 Cookie 支持，缺省同源）+ x-request-id 生成/透传 + 请求体错误映射（非法 JSON→400、超限→413）+ 非法 UUID 路径参数一律 404（assertUuidParam）+ 生产 Cookie Secure。 |
| 结构化日志（createLogger） | T18 定案：不引入 pino/winston（ADR 001 极简依赖；外部生成工具需密钥弃用），自实现 JSON 行日志（time/level/msg+字段，Error 序列化为 {message,stack}），sink 可注入；requestLogger 记 method/path/status/durationMs/requestId，不落 Cookie；path 记 originalUrl（顶层中间件 req.path 会丢挂载前缀）。 |
| 三栏结果页（ResultsPage） | .layout-results 左配置摘要+风险标记条 / 中总览卡+检验 Tab 区（分类/连续/滚动/滞后/审计/LLM）/ 右导出；审计 fail 用 .risk-banner-breach 固定顶部不可折叠（PRD）；LLM 结论与统计原始结果并排（.llm-split）。 |
| DataAdapterError | 外部数据源故障统一错误（HTTP 502），shared 包 AppError 子类。 |
| 审计注入测试（audit-injection.test.ts） | T19 集成验收：受污染 mock 面板（20% 缺失→fail / +30% 跳点→warn）与受污染 CSV（close=NA）双链路验证审计判定，并断言审计结论传导至 LLM 上下文（audit_key_findings 高风险文案 + global_confidence_flags 置信降级/警告旗标）；supertest 全程复用同一匿名工作区 Cookie（上传与建任务分属不同工作区会 404）。 |
| 部署拓扑（T20） | Render Blueprint 单 web 服务同源托管 API + web 产物（SameSite=Lax 工作区 Cookie 跨站会被当第三方 Cookie 拦截，同源免除 CORS）；api 经 tsup 双入口打包（index + infrastructure/migrate，生产不再依赖 tsx），启动前 node dist/infrastructure/migrate.js 幂等迁移；prompts/ 与 infra/db/migrations 不入 bundle，prompt-assets/migrate 自模块目录向上寻路 8 级；mountWebStatic 由 WEB_DIST_DIR 控制（未设→纯 API 模式），SPA 深链回退 index.html 且 /api 永不回退。 |

## 模块与接缝

| 模块 | 职责 | 关键接缝 |
| --- | --- | --- |
| packages/schemas | Zod 契约唯一来源（入参/出参/持久化双向校验） | 被 api / analysis-engine / web 消费 |
| packages/shared | AppError 族（含 DataAdapterError 502） | 被 api / analysis-engine 消费 |
| packages/ui | 设计 Token 唯一来源（tokens.ts/tokens.css），业务禁硬编码色值字体 | 被 web 消费 |
| services/api | Express 5 网关。presentation(路由 tasks/files/templates+中间件：workspace+error-handler+security 四件套+同源静态托管) → domain(契约/注册表/提示词渲染/LLM 编排/任务运行编排：含滞后扫描与 dualSource 双源对账) → infrastructure(适配器/仓储/迁移/LLM 客户端与提供方解析/logger) | DataProvider 契约（fetchHistory）插件式注册；LlmChatClient 传输契约；RunnerDeps 依赖注入；createApp(AppOptions) 安全基线可注入（rateLimit/cors/bodyLimit/logger）；pg + 手写 SQL 迁移；生产经 tsup 打包（tsup.config.ts，@platform/* 内联） |
| services/analysis-engine | 纯函数分析引擎：管道（T09）→ 卡方族（T10）→ 连续检验（T11）→ 校正（T12）→ 滚动窗口（T13）→ 数据真实性审计（T14）→ LLM 上下文构造（T15）→ 滞后扫描（lag.ts，PRD 模块 H） | 输入 NumericSeries[]/PreparedDataset/数值对/p 值批次/AuditPoint[]/TaskConfig+ResultTable+AuditTable，无 IO、无框架依赖；jstat 为 CJS 包，一律 default 导入（Node ESM 命名导入会 SyntaxError）；jstat.d.ts 经三斜线引用随源文件跨包传播 |
| apps/web | React + Vite + AntD + tokens.css（禁 Tailwind）：新建分析向导（G6 模板载入/保存/复制分析预填；G11 派生序列编辑器；G12 CSV 第二文件双源审计）/三栏结果页（G10 七 Tab 含原始导出）/历史任务列表（复制分析）；G7 路由级 React.lazy 懒加载 + manualChunks（vendor-antd/vendor-react 独立缓存）；lib/api.ts fetch 封装（credentials:'include'，出参过 Zod 校验）+ lib/export.ts 下载原语（downloadText 支撑 md/html）+ lib/export-report.ts 01~15 编号导出生成器 | 经 /api 调网关；样式一律 tokens.css 变量与语义类，页面补充样式在 app.css（仅引用 Token 变量） |
| infra/db | PostgreSQL 免管理员部署脚本 + 迁移 SQL（001 tasks/result_rows/audit_rows、002 uploaded_files、003 llm_artifacts、004 lag 约束放宽至 ±60、005 run_panels 导出面板快照、006 config_templates 分析模板） | migrate.ts 运行器（schema_migrations 记账）；start/stop-postgres.ps1 必须 UTF-8 带 BOM（PowerShell 5.1 无 BOM 时中文注释破坏解析） |
| prompts/ | LLM 提示词模板 + output_schema.json（PRD 模块 K 10 字段声明，G8 已与 llmOutputSchema 对拍核验） | T16 经 loadPromptAssets 消费（版本号写入 llm_trace）；G8 loadOutputSchema 与 llmOutputSchema 双源一致性守卫测试 |

## 已定案（速查）

- ADR 001：MVP 不引入 Python；jstat 仅分布函数 + TS 自实现统计；Yahoo chart API 主力源（修订 1，Stooq 休眠保留）+ CSV 并列第一入口；适配器 ≥1s 限速 + 24h 缓存。
- ADR 002（G14，V1 扩展预留；HSIC 部分已于 H2 落地）：HSIC 核独立性检验接入点 = analysis-engine 连续检验注册表 `registerContinuousMethod`（H2 已内置 hsic：hsic.ts 黄金基准实现 + 全样本自动生效 + 滚动层 ROLLING_EXTRA_METHODS 可选扩展 + rollingMethodSchema 枚举扩展，编排层零改动，印证可扩展性）；其余预留项不变。PRD 七层服务的 audit-engine/llm-service 已以 api 内 domain 模块形态落地；report-service（15_full_report.html）当前由前端 export-report.ts 浏览器端生成，V1 如需服务端渲染再抽独立服务，MVP 不拆微服务（与同源单服务部署约束一致）。
- 数据访问：node-postgres（pg）+ 手写 SQL 迁移，不用 ORM。
- ADR 003（G17，N11 定案）：交易日对齐以数据源实际日期为真值（对齐层按日期内连接，节假日自然剔除，不做插值）；周一至周五近似仅影响审计注记的「缺失工作日数」口径（audit.ts），不影响任何统计结果，MVP 不接交易所节假日日历。V1 如需精确口径，可引入纯前端节假日库（如 @date-holidays）仅替换 audit 的工作日计数，引擎无感。
- 统计/审计引擎代码：严格 TDD（RED→GREEN→REFACTOR），先写黄金基准对拍测试。

## 已知缺口（记录不阻塞）

~~N1 web 主 chunk 1.3MB/gzip 409KB（T17 分割待做）~~（G7 已闭：manualChunks vendor 分割 + 路由级懒加载，入口壳 4.5kB）· ~~N2 api 生产依赖 tsx~~（T20 已闭：tsup 打包）· ~~N3 Zod 3 record 无 min~~（G15 已闭：columnMappingSchema refine 守卫 + 空映射拒绝回归测试锁定，含 dualSource） · ~~N4 api 集成测试依赖本地 DB~~（T20 已闭：GitHub Actions CI 带 postgres:16 service）· N5 Yahoo 非官方无 SLA（回退路径见 ADR）· N6 ticker 符号命名校验（T17 前端提示）· N7 binningConfigSchema 缺 fixed_threshold 的 thresholds 字段（MVP 不支持 fixed_threshold，实现已显式抛错）· ~~N8 chi2sf 黄金验证仅覆盖偶数自由度~~（G16 已闭：不完全伽马本地真值补奇数 df 基准，jstat 精度达 1e-9） · N9 jstat studentt.cdf 精度仅 ~5e-9，df≤2 已改用解析闭式解规避 · ~~N10 rollingConfigSchema 缺 minSamples 与 methods 字段~~（G5 已闭：契约+编排+前端透传） · ~~N11 缺失交易日按周一至周五日历近似，未接入交易所节假日日历~~（G17 已闭：ADR 003 定案，近似仅影响审计注记口径，不影响统计结果） · ~~N12 taskConfigSchema 无 researchQuestion 字段，LLM 上下文缺省时由 projectName 派生（schemas/前端待补）~~（G13 已闭：契约可选字段 + 编排透传 + 向导输入/回显/预览） · ~~N13 滞后分析引擎未实现~~（G1/G2 已闭：lagScan 全扫描+双视图） · ~~N14 双源一致性审计未接入编排~~（G3 已闭：dualSource 接通） · ~~N15 新建分析向导无派生序列（derivedSeries）编辑 UI，默认空数组（前端待补）~~（G11 已闭：步骤 0 派生序列编辑器 + 预览/配置摘要回显） · N16 x-filename 头 URI 编码/解码为本仓私有约定，非标准 RFC 5987（已在 docs/DEPLOY.md 注明） · ~~N17 限流为单实例内存计数，多实例部署需换 Redis 等共享存储~~（G17 已闭：DEPLOY.md 注明扩容路径 Upstash/Redis 仅替换 rateLimiter 计数读写） · ~~N18 CSV 上传源的第二文件双源审计前端 UI 未实现（契约已支持 dualSource.fileId，G3 残留）~~（G12 已闭：向导第二文件上传 + 字段映射 + 回显） · N19 ~~配置模板复用未实现~~（G6 已闭：templates 端点 + 保存/载入/删除 UI + 复制分析预填） · ~~N20 Render free PostgreSQL 90 天到期迁移路径未入 DEPLOY.md~~（G9 已闭：备份 + 付费层升级 + Supabase 双路径）
