# ADR 001：行情数据源与统计计算引擎选型

- **状态**：已定案（2026-08-19，经项目负责人确认）
- **决策范围**：G1（ticker 行情数据源）+ G2（统计计算库选型）合并决策
- **关联任务**：TODO List 中 T08、T09~T12、T22、T32

## 背景

PRD 要求平台支持公开市场 ticker 输入（模块 B 数据接入层），并提供卡方族检验、连续变量检验、多重检验校正等统计能力（模块 E~I）。但 PRD 未指定行情数据供应商；同时项目技术栈已定案为 pnpm monorepo + Node.js(>=20) + TypeScript 全栈，而 Node 生态在行情数据与统计计算两方面均缺少成熟方案：

- 免费行情 API 普遍存在配额或品种限制（2026 年核实：Alpha Vantage 免费档已降至 25 次/天）。
- Node 生态缺少成熟统计库（卡方分布 p 值、互信息估计等需自实现或引入 jstat 类库）。

G1 与 G2 本质是同一个问题：**坚持纯 TypeScript 全栈，还是引入 Python**。

## 决策红线

1. **MVP 不引入 Python**：保持已定案技术栈，避免 Render 部署复杂度翻倍（多一套 Python 运行时/依赖链）。
2. **所有决策留下可换轨的契约接口**：数据适配器接口、引擎计算接口均按插件式设计，V1 需要时可低成本切换到 Python 实现，不推翻已写代码。

## 决策一：行情数据源（G1）

### 候选对比（2026-08 核实）

| 数据源 | 配额/成本 | 品种覆盖 | Node 接入 | 结论 |
|---|---|---|---|---|
| Stooq | 免 key、免费 CSV 下载（无官方 SLA，需自建限速） | 美股/ETF/全球指数/外汇/商品，日/周/月频齐全 | 简单 HTTP + CSV 解析 | ✅ MVP 主力适配器 |
| CSV 上传 | 无限制 | 用户自有数据 | PRD 模块 B 本就要求 | ✅ MVP 并列第一入口 |
| Alpha Vantage | 免费仅 25 次/天 | 广（含宏观） | REST + JSON | ⚠️ 仅作为可选 Key 适配器，非主力 |
| yahoo-finance2 (npm) | 免费非官方 | 最广（含期货连续合约） | 现成 npm 包 | ⚠️ ToS 风险，P1 备选，需稳定性评估 |
| yfinance (Python) | 免费非官方 | 最广 | 需 Python sidecar | ❌ MVP 排除，作为 T32 换轨触发点 |

### 定案

1. **主力源为 Stooq**（ticker 路径），**CSV 上传为并列第一入口**（自有数据路径），两者即满足 PRD 双输入能力闭环。
2. 统一适配器接口先于任何具体 provider 落地（T08）：
   - 契约：`fetchHistory(ticker, { start, end, frequency }) → 标准研究面板原始列`。
   - 每个 provider 返回必须携带元数据三字段：`source`、`source_version`、`fetched_at`（满足 PRD 可复现性要求）。
   - provider 以插件式注册（符合 PRD 可扩展性要求）。
3. 保护性约束：Stooq 客户端内置请求间隔（≥1s）+ 本地缓存层（同 ticker + 区间 24h 内复用），防封禁并节省下载时间。
4. Alpha Vantage 仅在用户自备付费 Key 时作为可选适配器接入，不进入 MVP。

### 换轨触发点（满足任一即启动 Python data-worker 评估，T32 前置）

- 需要 A 股/国内市场品种；
- 需要期货连续合约的滚动拼接逻辑；
- Stooq 数据质量或可用性不达标。

## 决策二：统计计算库（G2）

### 需求拆解（对照 PRD 模块 E~I）

| 计算需求 | Node 方案 | 自实现难度 |
|---|---|---|
| 卡方分布 p 值、CDF | jstat（含 chisquare 分布） | 引入即用 |
| Pearson / Spearman | simple-statistics 或自实现（Spearman 需排序 + 结值修正） | 低 |
| Cramer's V、拟合优度、同质性 | 自实现（公式简单） | 低 |
| 期望频数检查 | 自实现 | 低 |
| 互信息估计 | 自实现（等频分箱 + 经验概率） | 中 |
| 置换检验 | 自实现（seeded RNG，保证可复现） | 低-中 |
| BH / BY / Bonferroni 校正 | 自实现（纯排序算法） | 低 |

### 定案

1. **jstat（仅用于分布函数）+ 其余全部自实现**，零重依赖。
2. 正确性保障（核心机制）：
   - 建立 `tests/fixtures/stat-reference.json` 黄金基准集：用 scipy 离线生成标准样例（列联表→卡方/p/Cramer's V、相关系数→p、MI 置换分布分位数），所有自实现必须对拍通过（容差 1e-9）。
   - 基准集即 write-code 严格 TDD 的失败测试（红→绿→重构）。
   - 置换检验使用固定种子 PRNG（如 mulberry32），保证结果可回放（PRD 可复现性要求）。
3. 引擎契约接口：`analysis_engine` 对外只暴露 `runTest(testName, panel, config) → 结果长表行`，内部实现与调用方完全解耦——未来 Python 化时只换实现不动网关（T32 成本可控的关键）。

## 决策矩阵（评审结论）

| 组合 | MVP 成本 | 品种覆盖 | 统计成熟度 | 部署复杂度 | 决策 |
|---|---|---|---|---|---|
| A. TS 数据 + TS 统计 | 低 | 中（Stooq+CSV） | 中（自实现+基准对拍） | 低（单运行时） | ✅ 采纳 |
| B. Python 数据 + TS 统计 | 中 | 高 | 中 | 中（sidecar） | 触发点再议 |
| C. TS 数据 + Python 统计 | 中 | 中 | 高 | 中 | V1 备选 |
| D. 全 Python 后端 | 高 | 高 | 高 | 高（推翻技术栈定案） | ❌ 排除 |

## 关联缺口决策（一并记录）

### G3 · 骨架目录（随 T01~T06 落地）

```text
financial-association-platform/
├── apps/web/                    # T05 · React+Vite 前端
├── services/
│   ├── api/                     # T06 · 网关+任务编排（含 llm_context_builder 起步模块）
│   ├── analysis-engine/         # T09 · 统计计算（含数据管道）
│   └── audit-engine/            # T14 · 数据审计
├── packages/
│   ├── ui/                      # 已存在
│   ├── schemas/                 # T02 · Zod 契约
│   └── shared/                  # T01 · 工具函数/常量/错误类型
├── prompts/                     # T04 · system/user 模板 + output_schema.json
├── tests/
│   ├── fixtures/stat-reference.json   # 黄金基准集
│   ├── integration/             # T19
│   └── e2e/                     # T28
├── infra/                       # T20 · render.yaml 相关与环境模板
└── docs/adr/                    # 决策记录
```

### G4 · 根构建脚本（T01 落地内容）

```json
{
  "scripts": {
    "dev": "pnpm --filter @platform/web dev",
    "build": "pnpm -r build",
    "build:web": "pnpm --filter @platform/web build",
    "lint": "eslint . --cache",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  }
}
```

配套约定：TS project references（composite）；Vitest 统一测试运行器；ESLint flat config + typescript-eslint；strict 级 tsconfig（含 `noUncheckedIndexedAccess: true`，统计代码防越界关键项）。

### G5 · MVP 用户模型（建议方案）

匿名工作区 + 本地会话标识：首次访问签发 `workspace_id`（UUID，httpOnly Cookie，SameSite=Lax），任务/模板/文件均挂 `workspace_id` 外键；T27 引入 users 表时以 `users ← workspaces` 一对一绑定迁移，零破坏性。任务查询 API 校验 Cookie 归属，防枚举（default deny 前置应用）。

## 影响

- **正面**：技术栈保持单运行时，部署与 CI 简单；基准对拍机制保障统计正确性；契约接口保留 Python 换轨能力。
- **代价**：统计能力初期弱于 scipy 生态（无 HSIC 等现成实现，T33 自实现）；Stooq 无 SLA，数据可用性依赖缓存与降级策略。
- **风险缓解**：换轨触发点明确、白纸黑字；黄金基准集使未来任何实现替换都可回归验证。

## 修订记录

### 修订 1（2026-08-19，经项目负责人确认）：Yahoo 转正为主力源，Stooq 休眠保留

- **触发事实**：T08 冒烟实测发现 Stooq 已启用 JS PoW 反爬（SHA-256 挑战页），服务端纯 HTTP 抓取不可用；伪造浏览器 UA / Referer 均无效。命中本文「换轨触发点：Stooq 数据质量或可用性不达标」。
- **决策**：Yahoo Finance chart API（`query1.finance.yahoo.com/v8/finance/chart`，免 key）经同一 `DataProvider` 契约转正为 MVP ticker 主力源；Stooq 适配器保留实现并休眠，待上游放松后可重新启用。CSV 上传仍为并列第一入口不变。
- **不变项**：统一适配器契约（fetchHistory + source/source_version/fetched_at 三字段）、插件式注册、≥1s 限速与 24h 缓存等保护性约束全部沿用。
- **代价与风险**：Yahoo 接口非官方、无 SLA，且存在 ToS 风险（决策一时已提示）；若 Yahoo 亦不可用，回退路径为 CSV 上传单入口或启动 Python data-worker 评估。
