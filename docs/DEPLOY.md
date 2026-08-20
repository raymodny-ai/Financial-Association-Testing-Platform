# 部署手册（Render，T20）

## 拓扑

单一 Render **web 服务**（`fap-platform`）同源托管 API 与前端静态产物，外加一个 **free PostgreSQL**（`fap-db`）。

选择同源而非「静态站 + API」双服务的原因：G5 匿名工作区依赖 httpOnly、SameSite=Lax 的
`fap_workspace` Cookie。跨站部署会使该 Cookie 成为第三方 Cookie，被现代浏览器拦截，
导致每次请求签发新工作区、任务/文件归属断裂。同源部署同时免除 CORS 配置。

```
浏览器 ──同源──► fap-platform (web 服务)
                  ├─ /            → apps/web/dist（vite 产物，SPA 深链回退 index.html）
                  └─ /api/*       → Express 5 网关（tsup 打包产物）
                                      └─► fap-db (PostgreSQL 16, free)
```

## 首次部署步骤

1. 仓库推送到 GitHub/GitLab/Bitbucket（`render.yaml` 必须随仓库入库）。
2. 打开 Blueprint 深链：
   `https://dashboard.render.com/blueprint/new?repo=<仓库 HTTPS 地址>`
3. 完成 Git OAuth，确认资源清单（1 web + 1 database）后点击 **Apply**。
4. 部署完成后在 Dashboard → `fap-platform` → Environment 填入密钥（`sync: false` 项）：
   - `DASHSCOPE_API_KEY`（可选，qwen 系 LLM 解释；缺失时 LLM 步骤降级 skipped，不阻塞统计结果）
   - `DEEPSEEK_API_KEY`（可选，deepseek 系备选）
5. 修改密钥后手动触发一次重新部署。

## 构建与启动链

| 阶段 | 命令 | 说明 |
| --- | --- | --- |
| 构建 | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @platform/web build && pnpm --filter @platform/api build` | pnpm 版本经根 `package.json#packageManager` 锁定；web 走 vite、api 走 tsup（生产不依赖 tsx） |
| 迁移 | `node dist/infrastructure/migrate.js` | 幂等（schema_migrations 记账），每次启动前执行 |
| 启动 | `node dist/index.js` | 监听 `0.0.0.0:$PORT`（Render 注入） |

运行时资产说明：`prompts/`（LLM 模板）与 `infra/db/migrations/*.sql` **不打包进 dist**，
由 `prompt-assets.ts` / `migrate.ts` 从模块位置向上寻路定位，故仓库目录结构须完整保留。

## 环境变量

| 变量 | 来源 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | fromDatabase | Blueprint 自动注入 `fap-db` 连接串 |
| `NODE_ENV` | production | 使工作区 Cookie 附加 `Secure` 标志 |
| `WEB_DIST_DIR` | `../../apps/web/dist` | 相对 `services/api` cwd 解析；删除该变量即回退纯 API 模式 |
| `DASHSCOPE_API_KEY` / `DEEPSEEK_API_KEY` | Dashboard 手填 | 可选，见上 |
| `CORS_ALLOWED_ORIGINS` | 未启用 | 同源部署无需配置 |

健康检查：`GET /api/health`（Blueprint `healthCheckPath` 已声明）。

## 私有约定与已知限制（部署相关）

- **x-filename 头（N16）**：CSV 上传的文件名经自定义 `x-filename` 请求头传递，
  采用 `encodeURIComponent` URI 编码（本仓私有约定，**非** RFC 5987）。
  若日后在 Render 前加装 CDN / 反代，须确保该自定义头不被剥离（预检
  `Access-Control-Allow-Headers` 已包含 x-filename）。
- **限流单实例内存计数（N17）**：`rateLimiter` 按进程内 Map 计数，
  Render free 单实例下成立；横向扩容（多实例/多区域）后各实例计数独立，
  有效限额被放大为 N 倍，需换 Redis 等共享存储（如 Upstash free 层，
  仅替换 `rateLimiter` 的计数读写，接口层无需改动）。
- **free PostgreSQL 生命周期**：Render free 数据库有 90 天试用期，到期处理见下节。
- **free web 服务冷启动**：约 50s 空闲后休眠，首请求有冷启动延迟；
  分析运行（含 LLM）最长约 2 分钟，在 Render 请求超时上限内。

## free PostgreSQL 到期迁移路径（G9）

Render free PostgreSQL 有 **90 天试用期**，到期后数据库进入只读保护（连接仍可用但拒写）。
应用对 PostgreSQL 的依赖仅为标准 SQL + pg 驱动（无扩展、无存储过程），
故迁移只需换连接串，无需改代码。建议到期前 1~2 周启动以下流程。

### 前置：备份（两条路径通用）

```bash
# 在 Render Dashboard → fap-db → Connect 获取 External Database URL
pg_dump "<EXTERNAL_DATABASE_URL>" --no-owner --no-privileges -F p -f fap-backup.sql
# 验证备份可读（可选）：psql -f fap-backup.sql 到本地临时库
```

### 路径 A：升级 Render 付费 PostgreSQL（最省事）

1. Dashboard → `fap-db` → Settings → **Upgrade plan**（Starter 起，按月计费）。
2. 升级不改变 `DATABASE_URL`，`fap-platform` 无需改环境变量，自动重连即生效。
3. 数据原地保留，无需导入导出；升级后 90 天倒计时解除。

### 路径 B：迁移到 Supabase free 层（继续零成本）

1. Supabase Dashboard 新建项目，记录 Connection string（URI 格式，含密码）。
2. 导入备份：`psql "<SUPABASE_CONNECTION_STRING>" -f fap-backup.sql`。
   （`schema_migrations` 表随备份一并迁入，`migrate.js` 幂等记账不会重跑已应用迁移。）
3. Render → `fap-platform` → Environment：把 `DATABASE_URL` 从 fromDatabase 引用改为
   手填 Supabase 连接串（若平台要求 SSL，追加 `?sslmode=require`）。
4. 手动重新部署，验证 `GET /api/health` 与历史任务列表可读。
5. 确认无误后在 Render 删除 `fap-db`（同时从 render.yaml 的 databases 段移除，
   避免下次 Blueprint Apply 重建）。

### 到期后应急（已进只读保护）

只读状态下 `pg_dump` 仍可用，备份流程不变；先导出再选路径 A/B。
本地开发库（`infra/db` 脚本起的 PostgreSQL 16）不受此限制，
随时可用 `migrate.js` + 备份重建。
