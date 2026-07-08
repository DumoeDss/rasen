# Planning Context — telemetry-rollups-dashboard

## User intent (verbatim)

「这个数据没法长久保存吗？以及能有图表展示，数据筛选等dashboard常见功能吗？」→ LEAD 方案获认可 → 「auto-decompose 开始推进吧！不用gate」（gates 全程免停授权）。

## Scope (LEAD 与用户确认的三件套)

1. **永久保存**：Analytics Engine 仅 ~90 天滚动保留。加每日 cron 聚合落盘 D1：
   - `wrangler d1 create`（建库，如 `rasen-telemetry-rollups`）+ wrangler.toml `[[d1_databases]]` binding + `[triggers] crons`（每日一次，如 "0 1 * * *" UTC）。
   - scheduled handler：用 SQL API（secret `TELEMETRY_SQL_TOKEN` 已配好）查前一日聚合（按 command/version/os/node_version 分组：events=SUM(_sample_interval)、users=count(DISTINCT index1) 标注近似），写入 D1 日粒度行。**只存聚合数字，绝不存 distinctId**——隐私契约不变。
   - **一次性回填任务**：首次部署后把 AE 里现存全部历史（现在只有 ~2 天）按日聚合灌入 D1，保证历史无缺口。可做成受保护的 admin API 端点（POST /api/admin/backfill）或部署时脚本。
   - 幂等：按 (date, command, version, os, node_version) 主键 UPSERT，cron 重跑不重复计数。
2. **stats API v2**：热层（AE，≤90d 细粒度）+ 冷层（D1，全历史日粒度）。时间范围超出 AE 窗口时用 D1；结果标注数据来源。
3. **面板 v2**：时间范围选择（7d/30d/90d/全历史）、维度筛选（command/version/os）、**隐藏测试流量开关（默认开，过滤 version='0.0.0'**——所有冒烟事件都是 0.0.0，真实 CLI 事件是 0.1.0）、趋势折线/堆叠图增强。优先保持单文件无构建（admin/index.html，内联 SVG）；复杂度确实超限可参照 elftia admin-spa 上小型构建，但须给出理由。

## Locked decisions / constraints (不要反转)

- ingest 热路径（POST /）零改动、零延迟增加；cron 是纯旁路。
- 隐私红线：D1 里没有任何 distinctId/IP/路径/参数——只有聚合计数。
- Access/JWT 鉴权层（src/access.ts）不动；新 admin API 端点一律走同一 verifyAdminAccess 门（fail-closed）。
- run_worker_first=true + not_found_handling="none" + **html_handling="none"** 三个 assets 旗标都是 load-bearing，别动（html_handling 教训：默认 auto-trailing-slash 会把 /index.html 307 到 /，把登录后的用户弹到 ingest 405——已修，1b1f6c7）。
- workers_dev=true 必须保留（已发布 CLI 硬编码 workers.dev ingest URL）。
- 交付 local（只 commit 不 push）。**所有提交必须带显式 pathspec**（`git commit -m ... -- <路径>`）——并行 phase-2 改名会话共用本工作树/index，普通提交会吞它的暂存文件（见记忆 shared-index-commit-pathspec，事故 4b37644）。多行提交信息用 `git commit -F <文件>`（PS5.1 here-string 会碎）。
- 全局 `openspec` 命令已被并行会话的 bin 改名弄断——一律用 `node bin\rasen.js <args>` 代替（在仓库根执行）。
- 本机 curl 对 localhost/非 workers.dev 域需 `--noproxy '*'`（代理环境变量劫持）。
- D1 创建若因 wrangler OAuth 缺 d1 scope 失败：报告确切错误并把"用户 dashboard 手动建库"做成 runbook 步骤，不要瞎试。

## Environment facts

- Worker `openspec-telemetry`（account 5cc51d8388c780c03fb4c6161bd403c4），live：https://openspec-telemetry.ws11579.workers.dev（公共 ingest）+ https://telemetry.rasen.io（custom domain，Access 罩 /admin*）。当前版本 3e3d19d8。
- secrets/vars 已配齐：TELEMETRY_SQL_TOKEN（Account Analytics Read）、ACCESS_TEAM_DOMAIN=atelierai.cloudflareaccess.com、ACCESS_AUD=82ce43e2…dac5。面板已端到端点亮（用户已登录看到数据）。
- AE dataset `openspec_telemetry`：blob1=command blob2=version blob3=os blob4=node_version index1=distinctId。现存数据 = 两天冒烟测试（11 个假"用户"，含一条 256 个 x 的截断测试命令）+ 少量真实 CLI 事件。
- telemetry-backend/ 用 npm（不是 pnpm），零构建，vitest 13 测试（本地 RS256 JWKS 注入模式可参照扩展）。
- wrangler 4.86.0 已认证（workers write）。cron 触发器部署即生效。
- 参照实现：elftia backend-cf（E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\elftia-website\backend-cf，只读）有 D1 + drizzle 用法可参考（但本项目保持零依赖手写 SQL 即可，别引 ORM）。

## Verification expectations

- vitest：scheduled handler 聚合逻辑（mock SQL API 响应 + 内存 D1 或 mock binding）、UPSERT 幂等、stats API 冷/热层选择、测试流量过滤。
- 部署后 live：手动触发一次 rollup（`wrangler dev --test-scheduled` 本地或线上 curl 触发端点）验证 D1 有行；面板筛选/时间范围/开关行为用户可肉眼验收；ingest 202 回归 + /admin 未鉴权 403/302 回归必测。
- `node bin\rasen.js validate telemetry-rollups-dashboard` 绿。

## Planner addendum (2026-07-09)

Artifacts written & validated (`validate --strict` 绿, 4/4 complete): proposal.md, design.md, specs/telemetry-backend/spec.md, specs/telemetry-admin-console/spec.md, tasks.md.

Durable decisions made during planning (encode these; don't re-litigate):
- **两个 capability 都是 MODIFIED，无新 capability**。delta 落在既有 `telemetry-backend`（ADDED: Permanent Daily Rollup Persistence / One-Time Historical Backfill / Two-Layer Aggregate Query）和 `telemetry-admin-console`（MODIFIED: Aggregate Stats API 扩 hot/cold+source+test-filter；ADDED: Dashboard Filtering and Time Range）。MODIFIED 块整段复制既有 requirement 再扩，header 文字须逐字对齐（archive 靠它匹配）。
- **D1 binding 名定为 `ROLLUPS`**，库名 `rasen-telemetry-rollups`，表 `rollups`，PK `(date, command, version, os, node_version)`，`events`/`users` INTEGER。UPSERT = `ON CONFLICT(...) DO UPDATE SET events=excluded.events, users=excluded.users`。空维度写入前归一为 `''`（AE 缺省 blob 返回空串，保证 PK 稳定）。
- **backfill 走 admin 端点** `POST /api/admin/backfill`（不是部署脚本）——塞进现有 `/api/admin/*` 分支、`verifyAdminAccess` 之后，白嫖 fail-closed 门，零新鉴权码。按 day+dimensions 分组一次性灌，和 daily rollup 同 key+UPSERT ⇒ 幂等可重跑。
- **stats v2 用 `range` 参数**（7d/30d/90d→hot AE，all→cold D1），旧 `days` clamp 保留向后兼容；每个响应加 `source: "hot"|"cold"`。`hideTest` 默认 true，hot 层 `blob2 != '0.0.0'` / cold 层 `version != '0.0.0'`。
- **冷层 distinct-user 跨天不可加**（每日 users 相加会重复计返访用户）——设计里已标注：全历史"users"只作近似上界，events（可加）为主指标。这是本次唯一的度量语义坑，实现别把 SUM(users) 当真实去重数。
- **SQL 注入面**：filter 值插进 SQL API 的 text body，约束为 dataset 自身 breakdown 返回的已知维度值 + 拒绝含引号/分号的值。
- **cron `"0 1 * * *"`（01:00 UTC）** 聚合 `[startOfDay(-1), startOfDay)`，保证目标日已闭。
- scheduled handler 用 `ctx.waitUntil`，纯旁路，与 handleIngest 零共享。runSql() 已是不抛异常的 discriminated result，rollup 直接复用，SQL 失败 = 干净 no-op 下轮重试。
