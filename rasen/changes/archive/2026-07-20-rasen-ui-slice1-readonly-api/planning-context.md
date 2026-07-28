# Planning Context — rasen-ui-slice1-readonly-api

## 用户意图（转述自本次会话）

为 rasen 自动化管理平台建立第一个垂直切片（切片1第一批，低冲突部分）。因主工作区有未提交的 config-page-coherence 修复（触及 src/core/config-keys.ts / config-schema.ts / global-config.ts / project-config.ts / pipeline-registry/run-state.ts），本批工作在本 worktree（分支 dev/rasen-ui-slice1，基于 dev/0.1.5）实施，只做与 config 修复零重叠的部分。

## 范围（IN）

1. **管理 API 路由组（全新文件）**：不修改 `src/core/config-api/` 任何现有文件（可参照其 server/router/auth/static 模式复制思路）：
   - `GET status` — 含身份响应头 `x-rasen-daemon: <version>` / `x-rasen-pid: <pid>`（为将来 adopt-or-spawn 发现机制打底）
   - `GET changes` — 变更列表（活跃 changes + 状态）
   - `GET runs` — 运行状态（读 auto-run.json / goal-run.json / portfolio-run.json）
2. **看板 UI**：packages/ui 新增看板页面组件与路由，app.tsx 改动最小化（一行路由级别）。

## 范围（OUT — 第二批，等 config-page-coherence 合并后）

- `rasen config ui` → `rasen ui` 命令改名（触及 src/commands/config.ts）
- config-api 骨架泛化/合流
- config 页面并入管理 UI
- daemon 常驻化（detach/adopt-or-spawn/后台调度）——归切片3

## 硬约束

- **只读依赖不得修改**：`src/core/project-home.ts`（workDir 解析）与 `src/core/pipeline-registry/run-state.ts`（schema）只 import 不改——run-state.ts 在主树有未提交改动，改它必然冲突。
- **daemon 不当真源**：API 全只读，每请求即时读文件系统，无数据库无缓存持久层。
- 交付模式 **local**：提交留在 dev/rasen-ui-slice1 分支，不 push 不开 PR（等 config 修复合并后再议）。
- 服务端沿用 config-api 的安全模式：127.0.0.1 回环绑定 + bearer token。

## LEAD 已知事实（来自双侦察实勘，勿重复调研）

### rasen 现状
- config-api（`src/core/config-api/`，8 文件 ~1050 LOC）：纯 node:http；server.ts 有 socket 追踪强销毁（防 undici keep-alive 退出挂起）+ 2s 关停守卫；router.ts 手写 dispatch，`/api/v1/*` bearer 鉴权，401/400 语义清晰；static.ts 伺服 UI 包 dist 且缺装降级提示页；ui-package.ts 解析可选装 UI 包（先 CLI node_modules 再兄弟目录探测）。
- run-state 定位：`src/core/project-home.ts` 的 `resolveProjectHome()` → `workDir(changeName)=<globalDataDir>/projects/<home>/changes/<name>/work`；registry 在 project-registry.ts。
- run-state schema：`src/core/pipeline-registry/run-state.ts`（RUN_STATE_FILENAME='auto-run.json'）；goal-run.json / portfolio-run.json 同目录。
- packages/ui：Preact 10 + preact-iso + Vite 6 + Vitest；唯一 fetch seam `src/api/client.ts`（Bearer 注入自 URL fragment token）；页面现仅 ConfigPage；刚完成暖色编辑风重设计（0.1.1）。
- 42 个 skills、122 个 specs。

### omnicross 参照（/Users/sayo/repos/elftia_dev/dev-branch-1/omnicross）
- 身份头发现：AdminServer 每响应带 `x-omnicross-daemon: <version>` + `x-omnicross-pid`，消费者探测 status 端点分类——本切片 status 端点照此设计。
- UI 同源伺服 + 唯一 fetch seam 双宿主（浏览器/Tauri）模式已验证。

### 战略依据
- rasen/changes/rasen-roadmap-research/report.md §6 切片1（看板）：验收标准 = 看板数据与 CLI `rasen spec list`/`rasen change list` 输出完全一致；每里程碑须真实跑起来（不是骨架+假数据）。
- 记忆 rasen-ui-daemon-split-analysis：包边界现在切、常驻语义切片3再上。

## 决策待 planner 细化

- 管理 API 放哪：`src/core/management-api/`（新目录，与 config-api 平级）还是直接建 `packages/daemon`——倾向前者（本批不引入新包发布面，包化可在第二批合流时做）；planner 可裁定但须给理由。
- 本批是否需要一个临时启动命令（如 `rasen ui --experimental` 或隐藏子命令）供运行时验证——切片验收要求"真实跑起来"，必须有某种启动入口，但不得占用/改动 `rasen config ui` 现有命令路径。

## Planner 追加事实（propose 阶段实勘，durable）

- 两个开放问题已裁定（理由见 design.md D1/D6）：管理 API 定址 `src/core/management-api/`（config-api 平级兄弟目录，不建 packages/daemon——本批 local 交付无新发布面，目录边界即将来包边界）；启动入口 = **隐藏顶层 `rasen ui`**（新文件 src/commands/ui.ts + src/cli/index.ts 两行注册，Commander hidden，不进 help）——这正是第二批要正名的命令面，避免造一次性名字；`rasen config ui` 零触碰。
- 组合路由可行且零改 config-api：`createRouter(context)` 是公共导出、返回裸 request handler，管理 router 处理 status/changes/runs 后其余（config 端点+静态资产）全量委派，同 token 同 origin；身份头在 server 层 `res.setHeader` 于路由前统一打（含 401/委派/静态响应）。
- 命令注册点：`src/cli/index.ts:352` 一带（`registerConfigCommand(program)` 模式）；`config ui` 启动流程在 src/commands/config.ts:1069-1128（token=crypto.randomBytes(32)，URL 用 `#token=` fragment，openInBrowser 平台三分支）。
- 只读 run 解析链已核实：`resolveProjectHome(root, { ensure: false })` 是文档化非突变探针（不铸 identity/不建目录/未注册返回 null）→ `home.workDir(name)` → `resolveRunStateLocation(changeDir, workDir)`（workDir 优先、changeDir legacy 回退）→ `readRunStateDetailed` 区分 ok/invalid/absent。portfolio 有 `readPortfolioState`（portfolio-state.ts, PORTFOLIO_STATE_FILENAME）；**goal-run.json 无类型化 reader 模块**（仅 types.ts 里 runArtifact 默认值），本批按 raw JSON + validity flag 上线。
- changes 数据 CLI 同源席位：`getActiveChangeIds`（src/utils/item-discovery.ts）+ `loadChangeContext`（src/core/artifact-graph/instruction-loader.ts，产 ChangeStatus 的 done/ready/blocked）+ `countTasksFromContent`（src/utils/task-progress.ts）。
- static.ts 已有 index.html SPA 回退，`/board` 路径直接可服务，无需改 static 层；app.tsx 现有路由仅 ConfigPage 三行，加一行 `/board` 即可。
- 产物齐套且 `rasen validate rasen-ui-slice1-readonly-api --json` 通过（valid: true, 0 issues）；specs 三份：management-http-api / board-ui / management-ui-command。
