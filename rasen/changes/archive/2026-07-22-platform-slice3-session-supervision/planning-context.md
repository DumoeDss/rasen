# Planning Context — platform-slice3-session-supervision（路线图切片 3：会话生命周期监督，portfolio 父）

## 用户意图

"继续推进 phase3"。切片 1（看板+统一入口，已合并上线）、切片 2（任务提交写路径，PR #12 待合并）之后的最后一片：**平台自动拉起并监督 claudecode 会话**——用户不再手动开终端；运行中会话在看板实时可见；可以 kill；daemon 常驻语义在本切片正式落地（此前两切片刻意推迟，理由即"常驻的真实需求来自会话监督"）。

## 验收铁律（roadmap §6 切片 3 原文）

- 平台拉起/监控/回收 claudecode 会话
- **验收含"kill 掉一个会话，看板正确反映"这类真实运行时测试**
- 每个垂直切片真实跑通才算数，禁止骨架+假数据

## Portfolio 结构（LEAD 已裁定的 decompose 计划，children 已建目录）

1. **slice3-session-runtime**（核心，先行）：会话监督核心 + sessions API。
   - 进程监督器：spawn 长跑子进程（首要目标=以 headless 方式运行 claude CLI 驱动 rasen pipeline，如 `claude -p "/rasen:auto …"` 或经调研裁定的等价形态；至少必须支持"跑一个真实的 rasen auto/goal run"），in-memory run-registry（Map + 退出后自动清理），双超时（总时长 + 无输出看门狗），跨平台 tree-kill。
   - 白名单扩表：切片 2 的准入数据表加"supervised long-runner"一档（有界确定性终止的要求被"受监督"替代）。
   - API：`POST /api/v1/sessions`（启动）、`GET /api/v1/sessions`（列表：live 状态=registry + run-state 文件合成）、`DELETE /api/v1/sessions/:id`（kill，SIGTERM→SIGKILL 以 child close 为键——见记忆 subprocess-timeout-kill-pattern，spawn 类代码的三查点：升级键/释放键/抗信号夹具）。
   - **红线：daemon/服务端不当真源**——持久状态只在 run-state 文件与 rasen/ 工作区（由被 spawn 的 CLI/agent 写入），registry 只存活进程句柄；服务端仍不直接写工作区文件。
2. **slice3-daemon-residency**（依赖 runtime）：常驻语义。
   - 脱离终端的驻留形态（`rasen daemon start/stop/status` 命令族或 planner 裁定的等价物）；`rasen ui` 变为 adopt-or-spawn 消费者。
   - adopt-or-spawn 状态机（omnicross daemon_runtime.rs 模板）：探测固定端口 status 端点 → 凭身份头分类（x-rasen-daemon/x-rasen-pid 切片 1 已铺好）→ 同版本采纳 / 陈旧版本按上报 pid 杀掉重启 / 无身份头的陌生监听者绝不碰（Failed）。
   - "非己拉起绝不杀"；自己拉起的在退出时收尸（视驻留形态裁定）。
3. **slice3-sessions-ui**（依赖 runtime，与 daemon-residency 文件集不相交可并行）：
   - 看板/会话视图：运行中会话实时进度（pipeline 阶段、轮次、gate 状态——run-state 已结构化）、kill 按钮（确认后 DELETE）、从 UI 发起 auto/goal run（提交表单扩展或独立入口）。
   - 验收：kill 一个真实会话 → 看板正确反映其终态。

依赖 DAG：runtime → {daemon-residency, sessions-ui}（后两者文件集不相交：daemon=src/commands/*+server 生命周期；ui=packages/ui/*——正向独立性成立，Tier A 可并行；如实施中发现触碰面重叠立即降级串行）。

交付：children 全部 local ship；portfolio 级一次性交付（PR 到 dev/0.1.5，叠在 PR #12 之上或其合并之后——届时定）。

## 分支/环境

- worktree `/Users/sayo/repos/rasen-worktrees/platform-slice3`，分支 `dev/platform-slice3` 基于 `dev/platform-slice2@e01e017`（切片 2 的白名单/submit 模式是本切片的直接基础；PR #12 尚未合并，故堆叠）。
- 主树 dev/platform-slice2 上有用户的预览服务器（8890 端口）在跑——**不得动主树、不得占 8890**。

## 已知资产与模板（勿重复调研）

- **omnicross 参照**（/Users/sayo/repos/elftia_dev/dev-branch-1/omnicross）：`packages/cli-launcher/supervisor.ts`（ProcessSupervisor：双超时、scope 取消、kill-tree.ts 跨平台树杀）、`run-registry.ts`（内存 Map，>500 退出自动清理）、`apps/desktop/src-tauri/src/daemon_runtime.rs`（adopt-or-spawn 状态机全文）、`packages/daemon/src/{cli,bootstrap}.ts`（薄嵌入器装配）。切片 1 批 2 的 server 装配点模式（config router 零改动加路由组）是新 sessions 路由组的挂载模板。
- **切片 2 资产**：submit.ts 的 spawn 安全模式（execPath+自身 dist 入口、shell:false、argv 白名单数据表、cwd 锁定）、responded/childClosed 双状态、onChildClosed 释放回调——sessions 监督器直接演化自这套。
- **claude CLI headless**：`claude -p "<prompt>"` 非交互；`--dangerously-skip-permissions` 是三平台启动惯例（记忆 relay-launch-permissions-shipped）；会话产生的 run-state（auto-run.json/goal-run.json）由 agent 侧 LEAD 写入，服务端只读。**planner 须实测裁定确切 spawn 形态**（含 cwd=目标项目、环境变量、stdout/stderr 处置、无输出看门狗阈值）。
- **agent context 探测**：`rasen agent context --transcript` 可测 worker 占用——sessions 视图可显示（run-state 里有 transcript 指针），属加分项非必须。
- 新命令/可见 flag 的双 seam（completions registry + en/ja locales）——切片 1/2 三次踩过，daemon 命令族必中。
- UI 本地验证：sibling symlink 法（/Users/sayo/repos/@atelierai/rasen-ui，主树已有链接指向主树 packages/ui——worktree 验证时注意改指或换端口自验）。
- run-state schema：src/core/pipeline-registry/run-state.ts；goal-run.json 无类型化 reader（切片 1 按 raw+validity 上线，沿用）。

## 红线（全 children 共用）

1. daemon 只做**读者 + 进程拉起者**，绝不成为第二真源。
2. CLI/agent 是唯一写入口，服务端不直接写工作区。
3. spawn 类代码三查点：SIGKILL 升级以 child close 为键、资源释放以 child close 为键、测试配抗 SIGTERM 夹具。
4. 身份头/口径两条 SHALL NOT/config 契约零回归。
5. "非己拉起绝不杀"；无身份头的监听者绝不碰。
6. 交付 local；不 push 不开 PR（portfolio 级一次性交付，时机归用户/LEAD）。

## Child 1（slice3-session-runtime）planner 定案与实测发现（2026-07-20，planner-s3-1）

### 实测钉死的 spawn 形态（勿再猜）

- 交互 shell 里的 `claude` 是 **zsh function**（包了 `command claude --dangerously-skip-permissions`）；真二进制 `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.215`。spawn 看不见 shell function ⇒ 权限 flag 必须显式进 argv。
- 定案 argv（shell:false，单 prompt token）：`<claudeBin> -p "/rasen:auto <task>" --dangerously-skip-permissions --output-format stream-json --verbose`（goal 同形，换 `/rasen:goal`）。
- 二进制发现：`RASEN_CLAUDE_BIN` env 覆盖 → PATH 扫描（win 加 .exe/.cmd），每服务器解析一次缓存；缺失 = POST 时 503 `agent_cli_unavailable`。
- 实测：`-p … --output-format json` exit 0、stdout 单 JSON（含 `session_id`/`result`/cost）；`stream-json --verbose` = NDJSON，首行 `system/init`（带 session_id、permissionMode:bypassPermissions），随后 `system/thinking_tokens` 每几秒一条——这是看门狗的喂食流。plain json 到结束前完全静默，会饿死看门狗，故必须 stream-json。
- spawn 选项：cwd=launchProjectRoot、env 继承、stdio ignore/pipe/pipe、POSIX `detached:true`（自成进程组 ⇒ `-pid` 树杀可用）、win `windowsHide:true` + taskkill /T。

### Child 1 接口定案（siblings 须保持一致）

- **Session id = 服务端 randomUUID**（registry 键）；claude 自己的 session_id 从 init 事件解析存为 `agentSessionId`（仅观测/未来 resume 线索，绝不作键）。
- Registry 记录：`{ id, kind:'auto'|'goal', task, cwd, pid?, agentSessionId?, state:starting|running|exiting|exited, startedAt, lastOutputAt, endedAt?, exitCode?, exitSignal?, terminationReason?, changeName? }`；exited 保留上限 50 条 oldest-first 剪枝。`session-registry.ts` 零服务器依赖——**child 2 的 daemon 直接构造同一模块**。
- API：`POST /api/v1/sessions {kind,task,changeName?,timeoutMs?,noOutputTimeoutMs?}`→201 即回；`GET /sessions`（registry + changeName 存在时只读 join run-state——内存管进程事实、磁盘管 pipeline 事实，绝不合库）；`GET /sessions/:id`（+64KiB 尾巴）；`DELETE`→202 `exiting`（活）/200 幂等（已死）/404；升级与 finalize 全键在 child close。路由：sessions 前缀只吃一段 `:id`（UUID 形校验），更深 fall through。
- 超时默认：总时长 4h（cap 12h）、无输出看门狗 10min（cap 30min，理由：子代理长工具调用期父流静默数分钟）。并发 cap=3（与 slice2 的提交 cap-1 独立）。terminationReason 词表：`exit|signal|overall-timeout|no-output-timeout|killed|server-shutdown|spawn-error`。
- 白名单分层为数据（D7）：`bounded-cli`（create-change）+ `supervised-long-runner`（auto/goal，各带 skill 串与默认超时）；各端点只认本层。
- **前台退出姿态（child-1 世界的诚实答案）：kill-on-exit** —— 干净退出时 `shutdownAll('server-shutdown')` 树杀全部活会话（内存 registry 无人可收养，孤儿 claude 只烧钱无人管；run-state 落盘故人工可 resume）；SIGKILL 服务器仍会孤儿化=已记录局限，**child 2 的 residency 是真解**，supervisor 暴露 `shutdownAll()` 正是给 child 2 重新裁量用的。
- Child 3 消费面：wire types 在 `wire-types.ts`（`SessionRecordWire`/`LaunchSessionRequest`/`SessionsResponse`/`SessionDetailResponse`），POST 即 201 不等 run 推进，看板靠轮询 GET 观测终态（killed 的会话留在列表里）。
- Child 1 无新 CLI 命令/flag ⇒ completions+locale 双 seam 本 child 不触发；child 2 的 daemon 命令族必中，勿忘。

## Child 1 (slice3-session-runtime) SHIPPED — facts for children 2/3 (LEAD, 2026-07-20)

- commit **3df65f9** on dev/platform-slice3; 17 files; 3215 tests green; real-claude kill smoke passed.
- **Wire contract settled (child 3 builds against this)**: POST /sessions, GET /sessions/:id, DELETE /sessions/:id all return `{session: SessionRecordWire, ...}` (detail also has `tails`); GET /sessions (list) returns `{sessions: [{session: SessionRecordWire, runState}, ...]}` (each entry wraps the record + its read-only run-state join; runState is a ChangeRunEntry or {kind:'absent'}). `SessionActionResponse` in wire-types.ts.
- session-registry.ts + supervisor.ts have ZERO server deps → **child 2 (daemon) constructs the SAME modules directly**. `supervisor.shutdownAll(reason)` is exposed for child 2 to re-decide foreground-exit posture (child 1 chose kill-on-exit via stopServer→shutdownAll('server-shutdown'), 8s backstop).
- Sessions route group is mounted at the server composition point (config/management routers untouched) — child 2's daemon reuses this assembly.
- **Env gap fixed**: packages/ui had no node_modules in this worktree; LEAD ran `pnpm install` there (child 3 needs it for vite/vitest).
- Duplicate-implementer collision happened on child 1 (two sessions wrote the shared worktree). For children 2/3: ONE implementer each, and the shared-worktree pathspec-commit discipline is mandatory.

## Children 2/3 planner 定案（2026-07-20，planner-s3，同一 engagement 二连提案）

### Child 2（slice3-daemon-residency）定案

- **驻留形态 = run/start 双形**：`daemon run` 前台真身（复用 ui-launch 同一 server 装配 + 构造 child-1 零依赖的 registry/supervisor 模块）；`daemon start` detached 自 spawn（execPath+自身 dist 入口，stdio→`~/.rasen/daemon/daemon.log`，unref，20×250ms 就绪轮询验身份头，超时杀半启动子进程并报 log 路径）。命令族 `daemon start|stop|status|run` 全数入 completions registry + en/ja 双 locale（双 seam 已烤进 tasks 4.1-4.3）。
- **固定端口 8791**（绝不 8890；`RASEN_DAEMON_PORT`/`--port` 覆盖）+ **runtime 状态文件** `~/.rasen/daemon/daemon.json` {version,pid,port,token,startedAt} 0600、干净退出删除；token 变为 daemon 生命期铸造，adopter 从状态文件读。红线核验：此文件=进程 runtime 元数据，非 pipeline 真源。探测顺序=状态文件端口→默认端口；分类只信活探测的身份头，绝不信文件（陈旧文件自愈）。
- **adopt-or-spawn 状态机**（probing→adopted|spawning→running|failed）：同版本 ADOPT（token 不可读→failed 附 `daemon stop` 补救、不杀——健康但无法认证的 daemon 不是我们能毁的）；旧版本=已验明 rasen daemon → 按上报 pid 树杀+等端口释放+重生（"不杀不能识别之物"——已识别的旧版可杀）；无身份头=Foreign→failed 讲明端口与覆盖法，绝不碰。探测必须绕代理（omnicross .no_proxy() 教训 + 本仓 curl 代理史）。
- **关键偏离 omnicross 模板（有意，设计已论证）**：`rasen ui` 退出**不收尸自己 spawn 的 daemon**——sessions 活过终端正是本 change 的全部意义；daemon 到达 running 即自有。daemon 生命期只归 `daemon stop`/旧版替换/OS。父计划"自己拉起的在退出时收尸(视驻留形态裁定)"正是把此裁量给了 planner。
- **收尸随所有权走**：daemon 干净退出（stop/SIGTERM/SIGINT）跑 shutdownAll('server-shutdown') 再删状态文件；`rasen ui` 退出零动作；`ui --no-daemon` 保留 child-1 自宿主形态（含 kill-on-exit）当 dev 回路+spawn 故障 fallback。session-supervision 的关机条款用 MODIFIED delta 重述为"绑定 supervisor 属主进程"（stacked delta：child 1 先 archive）。
- **N1/N2 烤进 tasks 组 1（最先做）**：N2=launch() 在 `await resolveAgentCli()` 后复查 draining（释放槽位+503）；N1=同步 spawn-catch 路径对称删当前记录 tail。
- 并发竞态收敛：双 `rasen ui` 同见 NoListener → 输家 daemon run EADDRINUSE 退出、输家轮询转 adopt 赢家，无需锁文件。

### Child 3（slice3-sessions-ui）定案

- **placement**：独立 `/sessions` 第三导航页（SessionsPage）+ 看板轻量 live-session 计数 indicator（链到 /sessions）——sessions 是进程生命周期对象非 kanban 列对象，不塞看板列；验收"kill 反映在看板"由 indicator 变化 + sessions 页终态共同承担。
- **轮询**：sessions 页挂载期 3s 固定；detail tails 仅展开时同频；看板 indicator 仅上次响应有活会话时续轮询。kill 的 202 body 即时 patch 成 exiting（无闪烁窗口），poll 推进到 exited/killed；条目永不因 kill 消失（retained-exited 契约正为此）。
- **launch 表单**：kind(auto 预选|goal)+task textarea+可选 changeName（提示"链接既有 change 得实时进度"）；timeoutMs/noOutputTimeoutMs 线上有字段但表单不暴露（v1 少旋钮）；服务端是唯一权威校验，错误信封原样呈现（agent_cli_unavailable/busy 文案本身可读）。归并按 session id 防乐观插入重复。
- **mirror 纪律**：api/types.ts 手工镜像 wire-types.ts 的七个 session 形状（头注注明源文件）；client.ts 四调用全过既有 request() 封装。fixture 形状测试当 mirror 漂移警报。
- **文件占位**：packages/ui/ ONLY（tasks 5.4 明查 diff 全在 packages/ui 下）——与 child 2 并行安全成立；child 2 tasks 5.6 对称明查不碰 packages/ui。
- 注意：UI 是 preact 非 React（preact/hooks），沿现组件惯用法，零新依赖。

### 双 child 交汇处一致性核验（planner 自查）

- child 2 不改 sessions wire 契约（daemon 复用同一 server 装配，路由组零改动）；child 3 只消费 settled 契约 ⇒ 无交叉依赖，Tier A 并行成立。
- child 3 验收排练（tasks 5.6）在 child 2 未落地时用 `rasen ui`（child-1 前台形态）即可跑通；两者都落地后同一排练自动走 daemon 路径——验收脚本不依赖实施顺序。
