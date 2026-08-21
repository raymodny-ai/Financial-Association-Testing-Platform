# Financial Association Testing Platform · 金融关联性检验平台

面向金融研究场景的**关联性统计检验 Web 平台**：上传行情数据（Yahoo Finance 在线抓取或 CSV 上传）→ 五步向导配置样本区间 / 期间划分 / 检验选项 → 一键运行**卡方族 + 连续变量**统计检验流水线（含多重检验校正、滚动窗口与滞后分析）→ 内置**数据真实性审计**与**可选 LLM 智能解释**（qwen / deepseek）→ 三栏结果页可视化与一键导出。

> 匿名即用：无需注册登录，浏览器经 httpOnly Cookie 自动获得隔离的匿名工作区（G5 模型），任务与上传文件严格归属各自工作区。

---

## ✨ 核心功能

| 模块 | 能力 |
| --- | --- |
| 数据源 | Yahoo Finance 在线行情（主力源，≥1s 限速 + 24h 缓存）、CSV 上传（自定义列映射）、Stooq（休眠备用） |
| 检验流水线 | 标准化 + 离散化（等频/等宽分箱）→ 成对卡方独立性检验、Student's t、Pearson / Spearman 相关、互信息（置换检验） |
| 多重检验校正 | Bonferroni / Benjamini-Hochberg / Benjamini-Yekutieli，按族分批 |
| 滚动窗口 | 可配置窗口长度/步长/最小样本量/检验方法子集（G5 前端透传）的时序滚动重算（退化窗口记 skipped 不中断） |
| 滞后分析 | [-maxLag,+maxLag] 全整数滞后 Pearson 扫描（PRD 模块 H），最优 lag 自动标注；结果页曲线图 + 表格双视图 |
| 数据真实性审计 | 缺失率 / 跳点 / 陈旧数据六类审计，pass/warn/fail 三级判定；双源一致性审计（同标的第二数据源：状态一致率 + 同质性卡方）；fail 序列强制注入 LLM 安全旗标（置信降级） |
| LLM 解释 | qwen（DashScope）/ deepseek 可选；提示词模板版本化（`prompts/`），输出经 Zod Schema 严格校验；无密钥自动降级 skipped，不阻塞统计结果 |
| 前端 | 五步新建分析向导、三栏结果页（配置摘要 + 检验 Tab 区 + 导出）、历史任务列表；PRD 01~15 编号导出体系；分析模板复用（保存模板 / 复制分析 / 重跑同配置） |

---

## 🧱 技术栈

- **语言/工具链**：TypeScript（strict）· pnpm monorepo · Vitest · ESLint + Prettier
- **前端**：React 18 + Vite + Ant Design（样式一律走 `packages/ui` 设计 Token，禁止硬编码色值字体）
- **后端**：Express 5 · node-postgres（pg）+ 手写 SQL 迁移（无 ORM）· helmet 安全头 · 固定窗口限流 · 结构化 JSON 行日志
- **统计**：jstat 仅用分布函数 + TS 自实现统计量；scipy/numpy 黄金基准对拍（容差 1e-9）
- **部署**：Render Blueprint（同源单服务 + free PostgreSQL）· GitHub Actions CI
- **LLM**：OpenAI 兼容协议客户端（DashScope compatible-mode / deepseek），90s 超时 + 重试一次

关键决策详见 [`docs/adr/001-datasource-and-stats-engine.md`](docs/adr/001-datasource-and-stats-engine.md)，完整需求见根目录 PRD。

---

## 📦 仓库结构

```
├── apps/web                    # React + Vite 前端（向导 / 结果页 / 历史列表）
├── packages/
│   ├── schemas                 # Zod 契约唯一来源（入参 / 出参 / 持久化双向校验）
│   ├── shared                  # AppError 错误族
│   └── ui                      # 设计 Token 唯一来源（tokens.ts / tokens.css）
├── services/
│   ├── analysis-engine         # 纯函数统计/审计引擎（无 IO、无框架依赖，202 测试）
│   └── api                     # Express 5 网关：任务编排 / 数据适配 / LLM 推理（105 测试）
├── prompts/                    # LLM 提示词模板 + output_schema.json（版本号入 trace）
├── infra/db                    # PostgreSQL 迁移 SQL + 本地免管理员启停脚本
├── tests/fixtures              # 黄金基准集 stat-reference.json（scipy/numpy 参考值）
├── docs                        # DEPLOY.md 部署手册 + adr/
├── render.yaml                 # Render Blueprint（单服务同源 + free PG）
└── .github/workflows/ci.yml    # CI：typecheck + lint + build + test（带 postgres:16）
```

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20（推荐 22）
- pnpm 11（`corepack enable` 后按根 `package.json#packageManager` 自动锁定）
- PostgreSQL 14+（可用仓库自带免管理员脚本，见下）

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | PostgreSQL 连接串（本地默认 `postgresql://postgres:PlatformDev2026@127.0.0.1:5432/fap`） |
| `PORT` | 否 | API 端口，默认 8787 |
| `DASHSCOPE_API_KEY` | 否 | qwen 系 LLM 密钥；缺失时 LLM 步骤降级 skipped |
| `DEEPSEEK_API_KEY` | 否 | deepseek 系备选密钥 |
| `CORS_ALLOWED_ORIGINS` | 否 | 逗号分隔白名单；同源部署无需配置 |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 否 | 限流窗口 / 上限（默认 60000 / 300） |

### 3. 启动本地 PostgreSQL（可选，免管理员）

```powershell
pnpm db:start     # 首次自动下载免管理员二进制并初始化
pnpm db:stop      # 停止
```

### 4. 数据库迁移

```bash
pnpm --filter @platform/api db:migrate
```

### 5. 启动开发服务

```bash
# 终端一：API 网关（http://localhost:8787，tsx watch 热重载）
pnpm --filter @platform/api dev

# 终端二：前端（http://localhost:5173，/api 自动代理到 8787）
pnpm --filter @platform/web dev
```

打开 `http://localhost:5173` 即可使用。

---

## ✅ 常用命令

```bash
pnpm test                # 全仓测试（5 包共 376 例）
pnpm typecheck           # 全仓 TypeScript 严格检查
pnpm lint                # ESLint
pnpm build               # 全仓构建（web: vite / api: tsup）
pnpm --filter @platform/api db:migrate   # 应用数据库迁移（幂等）
```

测试矩阵：analysis-engine **202** · api **112**（含 PostgreSQL 集成测试与审计注入测试）· schemas **51** · ui **7** · shared **4**。

---

## ☁️ 部署（Render）

仓库自带 `render.yaml` Blueprint：**单一 web 服务同源托管 API + 前端产物**（保证 SameSite=Lax 工作区 Cookie 有效）+ free PostgreSQL。

```
https://dashboard.render.com/blueprint/new?repo=https://github.com/raymodny-ai/Financial-Association-Testing-Platform
```

部署后在 Dashboard 填入 `DASHSCOPE_API_KEY`（可选）即可。完整手册（构建链、环境变量、free 层限制、x-filename 私有约定等）见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

---

## 🔒 安全基线

- helmet 安全头 · 固定窗口限流（按 IP，超限 429 + Retry-After）· 请求体错误映射（400/413）
- 匿名工作区 Cookie：httpOnly，生产附加 Secure；非法 UUID 路径参数一律 404
- Origin 白名单 CORS（凭据支持，缺省同源）· x-request-id 生成/透传 · JSON 行结构化日志（不落 Cookie）

---

## 🗺️ 路线图与已知缺口

当前为 **P0 MVP**（T01~T20 已完成），PRD 缺口补全进行中：滞后分析（模块 H）、双源审计编排（模块 J）、01~15 编号导出、滚动窗口参数透传、配置模板复用已交付。在册缺口（详见 `.agent/CONTEXT.md`）：

- ~~web 主 chunk 1.3MB（待代码分割）~~（已闭：vendor 分割 + 路由懒加载，入口壳 4.5kB）
- 交易所节假日日历
- ~~Render free PostgreSQL 90 天试用期提醒~~（已闭：docs/DEPLOY.md 已给出备份 + 付费层升级 + Supabase 迁移双路径）

---

## 📄 许可

私有项目，暂未开源许可。© 2026 raymodny-ai
