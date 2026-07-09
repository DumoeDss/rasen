# Planning Context — telemetry-dashboard-ux

## User intent (verbatim)

「当前都是下拉框很不好选择，也不好看，就是既不实用也不美观。可以参考一下claude-relay-service的dashboard：E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\claude-relay-service」

背景：telemetry-rollups-dashboard 刚 ship（archive db03060，后续 display 修复 73c3642 已部署 afd5f458）。现面板控制区 = 4 个原生 `<select>`（range/command/version/os）+ 1 个 checkbox（hideTest），用户嫌难用且丑。本 change 只重做面板 UI/UX，不碰后端 API。

## Reference design (LEAD 已勘察，claude-relay-service web/admin-spa)

Vue3 + element-plus + tailwind + Chart.js 的 SPA。可移植到我们单文件面板的模式：
- **时间范围 → segmented 按钮组**（el-radio-button 风格：一排互斥按钮，选中态填充高亮）——替代 range 下拉。我们只有 4 档（7d/30d/90d/all），按钮组完美适配。
- **维度筛选 → 可点击 chips/pills**：command/version/os 的值本来就少（个位数），下拉框反而藏起来了；改成一排可点选的 pill（选中高亮、再点取消、"All" 默认态），比下拉直观得多。command 值可能长（已有 40 字符截断先例）——pill 内同样截断 + title 悬停全文。
- **hideTest checkbox → toggle 开关**（滑块式 switch）。
- **视觉**：圆角卡片（rounded-2xl/3xl 感）、控件 hover 过渡、选中态用 accent 渐变或填充、控制区分组标签小写灰字。参考站用 glass-morphism（backdrop-blur 玻璃卡）——可选，酌情轻量借鉴，别为它引字体/图标库。

## Locked decisions / constraints (继承自上一个 change，不要反转)

- **admin/index.html 保持单文件、零构建、零外部依赖**（无 CDN、无 tailwind/element-plus/Chart.js 引入——CSP 与离线性都靠内联）。参考站的观感用纯 CSS 重现，不搬它的技术栈。
- **后端零改动**：stats API v2 的参数契约（range/command/version/os/hideTest）不变；本 change 理想情况只改 admin/index.html 一个文件。若 planner 发现确需后端小改（如 breakdown 返回排序），必须在 proposal 里说明理由。
- 现有行为保持：筛选变化触发 re-fetch、选中值在数据刷新后保留（populateFilter 的 current 保留逻辑要平移到 pill 实现）、source 徽章（hot/cold）、users 近似脚注、40 字符截断 + title（73c3642 刚修，别回退）。
- Access/JWT、ingest、wrangler.toml、三 assets 旗标全部不碰。
- 交付 local（只 commit 不 push）；**git 提交必须显式 pathspec**（并行 phase-2 会话共享 index，见 memory shared-index-commit-pathspec）；多行提交信息 `git commit -F <文件>`。
- 全局 openspec 断 → `node bin/rasen.js`。
- telemetry-backend/ 用 npm；vitest 29 测试须保持绿（本 change 是纯前端 HTML，预计不新增测试负担，但回归必跑）。
- curl：workers.dev 走代理（不带 --noproxy）；localhost/telemetry.rasen.io 带 `--noproxy '*'`。

## Environment facts

- Worker openspec-telemetry live：workers.dev（ingest）+ telemetry.rasen.io（Access 罩 /admin）。当前版本 afd5f458。wrangler 4.86.0 已认证，`npx wrangler deploy` 从 telemetry-backend/ 执行。
- admin/index.html 现状：内联 CSS（:root 变量 --bg/--panel/--fg/--accent/--border/--users，深色主题）+ 内联 JS（load() 拉 /api/admin/overview|series|breakdown，renderBreakdown/populateFilter/escapeHtml/fmt 等）。控制区 DOM：#range select、#fCommand/#fVersion/#fOs select、#hideTest checkbox、source 徽章 #sourceBadge。
- 面板数据现状：AE 里 ~2 天冒烟数据 + 少量真实事件；一条 256x 长命令（非 0.0.0，hideTest 滤不掉它，53 字符截断可见性已由 73c3642 处理）。
- D1 冷层可能还没数据（用户尚未跑 backfill）——UI 改动不依赖冷层有数据，但 all 档要优雅处理空数据（现有 "No data." 路径保留）。

## Verification expectations

- npm test 29/29 绿（回归，前端改动不应碰测试）。
- 部署后 live 回归：合法 ingest 202、非法 400、未登录 /admin 302/403。
- 面板验收（用户肉眼）：segmented 时间范围切换、pill 筛选点选/取消、toggle 开关、选中态刷新后保留、长命令 pill 截断 + title、空数据不破版、无横向滚动。
- `node bin/rasen.js validate telemetry-dashboard-ux` 绿。

## Planner addendum

- **Delta 目标 requirement**：`telemetry-admin-console` 的 `Dashboard Filtering and Time Range`（主 spec 第 111-118 行）。用 MODIFIED，header 逐字复制。这是刚 archive 的 telemetry-rollups-dashboard 新增的 requirement，本 change 只精化"控件形态"（segmented / pills / toggle + a11y + 空数据不破版），不改时间档集合、维度集合、hideTest 默认、单文件零构建、source 标注等既有契约。
- **状态模型（design 拍板）**：不引入 JS 状态对象；筛选值就地存 DOM——range 存 segment 组的 `data-range`，各维度存 pill 容器的 `data-value`（空串=All）。`currentParams()` 改成读这些属性替代 `<select>.value`，其余调用点（load/api/renderDau/renderBreakdown/source badge/footnote）零改动。blast radius 收在控制块 + currentParams + 新 renderPills。
- **populateFilter → renderPills**：逐字平移"保留当前选中值（含选中值跌出列表时 re-inject）+ 40 字符截断 + title"逻辑（73c3642 别回退）。pill 用真 `<button aria-pressed>`；segment 静态 4 按钮无需 repopulate；toggle 保留真 `<input type=checkbox>` 底层（a11y + 现有 change 事件不动），CSS 画滑块。
- **事件线**：旧 `['range','fCommand','fVersion','fOs','hideTest'].forEach('change')` 收缩为仅 hideTest；range/pills 各自 click 委托。escape 用现成 `escapeHtml`，选中比较读原始 dataset 值避免双重转义。
- 4 artifact 全绿 `validate --strict`。tasks.md 已含 ship 阶段 pathspec-only 本地提交（`git commit -- telemetry-backend/admin/index.html` + `git show --stat` 复核，共享 index）。
