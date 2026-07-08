# Planning Context — telemetry-admin-console

## User intent

给已部署的遥测后端（`telemetry-backend/`，Worker `openspec-telemetry`，live at https://openspec-telemetry.ws11579.workers.dev）加一个管理后台：参照 elftia-website 的 admin-spa 同源模型，用 Cloudflare Access 做边缘鉴权（方案 A：同 Worker + 自有域名路径级 Access）。用户已注册 rasen.io 并将 NS 切至 Cloudflare（传播中，zone 可能尚未 Active）。用户授权持续推进（"你可以继续推进开发任务了"）。

## Locked architecture decisions (LEAD + user, 不要反转)

1. **方案 A，同 Worker 扩展**：不建第二个 Worker。`openspec-telemetry` 增加 `/admin`（面板静态资产）+ `/api/admin/*`（统计 API）。
2. **自定义域 `telemetry.rasen.io`**：wrangler.toml `routes = [{ pattern = "telemetry.rasen.io", custom_domain = true }]`。zone（rasen.io，account 5cc51d8388c780c03fb4c6161bd403c4）可能还在 NS 传播——custom domain 挂载/验证做成独立的、可重试的最后任务；zone 未 Active 时其余一切照常开发+部署到 workers.dev。
3. **公共 ingest 不能动**：`POST /` 到 workers.dev 的原始 URL 已硬编码在已发布的 B2 客户端里。workers.dev 路由保持开启；ingest 语义（202/405/400、隐私契约）零改动。
4. **Access 边缘鉴权 + Worker 内强校验（双层，后者必须）**：Cloudflare Access 应用罩 `telemetry.rasen.io/admin*`（含 /api/admin），policy=用户邮箱。因 workers.dev 域不经过 Access，Worker 内必须对 `/admin*` 与 `/api/admin*` 强制校验 `Cf-Access-Jwt-Assertion`（JWKS: https://<team>.cloudflareaccess.com/cdn-cgi/access/certs；校验 aud/iss/exp）。**Fail-closed**：`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` 未配置时 admin 路径一律 403——这样 Access 应用建好前部署也安全。
5. **统计读取走 CF SQL API**（AE binding 只写不读）：Worker 服务端 POST https://api.cloudflare.com/client/v4/accounts/5cc51d8388c780c03fb4c6161bd403c4/analytics_engine/sql，鉴权用 secret `TELEMETRY_SQL_TOKEN`（用户手动建 Account Analytics Read token 后 `wrangler secret put`）。secret 缺失时 stats API 返回明确的 503 + 提示，不崩。
6. **面板轻量化**：参照 elftia backend-cf/admin-spa 的同源模型（Worker [assets] 托管、零前端凭据、无登录 UI、401/重定向时提示 reload 重新过 Access），但 UI 瘦身——**默认单文件静态 `admin/index.html`**（vanilla JS + fetch + 内联 SVG/轻量图表），不引入 Vite/React 构建链（telemetry-backend 目前零构建，保持）。planner 有代码证据认为需要多文件可微调，但不得引入 npm build 步骤。
7. **面板内容（首版）**：总览卡（近 24h/7d 事件数、去重用户数）、DAU 日曲线（近 14-30 天）、command 分布、version 分布。计数用 **SUM(_sample_interval)**（采样期准确），去重用户 count(DISTINCT index1) 并标注采样近似（B1 review 结论）。数据列映射：blob1=command, blob2=version, blob3=os, blob4=node_version, index1=distinctId, dataset=openspec_telemetry。
8. **交付模式 local**（只 commit 不 push），与分支现状一致。
9. **用户手动步骤做成 runbook**（写进 change 的 notes.md 或 README）：(a) CF dashboard 建 Analytics Read API token → `wrangler secret put TELEMETRY_SQL_TOKEN`；(b) Zero Trust 建 Access 应用（self-hosted，domain=telemetry.rasen.io，path=/admin*，policy=allow email ws11579@gmail.com）→ 回填 team domain + AUD（`wrangler secret put` 或 vars）。精确到按钮。

## Reference implementations (read these)

- **elftia admin 模型**：`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\elftia-website\backend-cf\admin-spa\README.md`（同源部署模型、auth 模型、会话过期处理）；`backend-cf\wrangler.toml` 的 `[assets]` 配置；`backend-cf\src\routes\middleware.ts` / `src\routes\admin.ts`（Access JWT 校验中间件的现成写法，Hono 栈——注意 openspec-telemetry 不是 Hono，是裸 fetch handler，抄思路不抄框架）。只读参考，不要改 elftia 仓库任何文件。
- **现有遥测 Worker**：`telemetry-backend/src/index.ts`（裸 fetch handler，POST-only ingest，202/405/400）+ `telemetry-backend/wrangler.toml` + `telemetry-backend/README.md`（SQL API 查询模式、隐私契约、采样注意事项）。
- 环境事实：wrangler 4.86.0 已登录（workers write + workers_routes write scope）；本机 curl 有代理环境变量劫持 localhost 的坑（对 workers.dev/公网 URL 无影响，本地 wrangler dev 测试记得 `--noproxy '*'`）。

## Verification expectations

- Worker 单测或本地 wrangler dev 冒烟：admin 路径 fail-closed（无 env → 403；伪造 JWT → 403）；ingest 路径回归（POST 202 / GET 405）不被破坏。
- 部署到 workers.dev 后 live 验证：ingest 仍 202；/admin 403（Access env 未配时）。
- custom domain 任务：检测 zone Active（`nslookup -type=NS rasen.io` 出现 *.ns.cloudflare.com）后 wrangler deploy 挂域；未 Active 则记录为待重试，不阻塞 ship。
- 面板端到端（真数据渲染）依赖用户完成两个手动步骤——做成 runbook 验收项，不阻塞本 change 的 review/ship。
