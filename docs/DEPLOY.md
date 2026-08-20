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
  Render free 单实例下成立；横向扩容后需换 Redis 等共享存储。
- **free PostgreSQL 生命周期**：Render free 数据库有 90 天试用期，
  到期前需升级付费实例或导出数据（`pg_dump`）。
- **free web 服务冷启动**：约 50s 空闲后休眠，首请求有冷启动延迟；
  分析运行（含 LLM）最长约 2 分钟，在 Render 请求超时上限内。
