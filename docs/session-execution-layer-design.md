# 0.2.0 内核 Session 执行层设计（Plan B 重定位版）

> 版本：v2（重定位）。v1（面向 0.1.6 playbook 编排的「混合 Worker 后端」）见本文件的 git 历史（`0ff25ad1`）。
> 依据：`docs/audits/session-audit-9e36259d-cache-rebuild-review.md`（§8–13）；0.2.0 `change-run` 契约实读。
> 前置验证：`docs/experiments/session-cache-probe.md`（KC 探针，结果未回之前本设计的宿主选型是**假设**）。
> 状态：设计稿，待 ECP-4 契约冻结 + 探针结果后修订并排期。
> 日期：2026-07-29

---

## 1. 重定位说明：为什么从 0.1.6 playbook 改到 0.2.0 内核

v1 把「短 worker 走 subagent+beat、长 worker 走独立 session」实现为 0.1.6 prompt-playbook 编排的新后端。重定位基于两个事实：

1. **0.2.0 内核已经把 session 语义定义为一等契约。** `src/core/change-run/contracts.ts:192-208` 的 agent action 自带
   `session: { reuse: 'never' | 'same-invocation', handoffTokenLimit, reuseRoundLimit }`，`ActorRef` 含 `sessionIdentityDigest`。
   缺的不是概念，而是**真正把 agent action 跑在可复用独立 session 上的执行器**。
2. **v1 最重的投资会被内核作废。** playbook Step B.5、LEAD 侧路由、epoch fencing、LEAD handoff 存活——全都在为「编排者是一个会过期、会被 rebase、需要 relay 的 LLM LEAD 会话」代偿。0.2.0 的编排者是 deterministic reconciler：代码没有缓存要保护、不会休眠、重启从持久状态恢复。审计里最大的不可修复 churn（MAIN 60 分钟 TTL 165 万、teammate message 打进主链的 rebase、LEAD relay 机械）在内核架构下**结构性消失**。

因此本设计的交付物是：**change-run agent action 的 Session 执行层**——一个消费内核契约的 executor + session registry + run 级审计，让 `session.reuse: 'same-invocation'` 在 1 小时缓存档上真实成立。

目标架构下的成本结构：

```text
reconciler / kernel      确定性代码，0 token，可随时冷启动
launcher（thin CLI 会话） 小上下文，死了不心疼
worker sessions          大上下文，1 小时缓存档，空闲零成本，事件驱动唤醒
```

## 2. 目标与非目标

### 目标

- G1：实现 **SessionHost（resume-cli 宿主）**：agent action → 独立 Claude Code session 的创建、复用唤醒、touch、retire。
- G2：**Session registry**：机器可读的 session 身份链与生命周期（active/idle/retired、lastRequestAt、cwd、id 链），单写者为 rasen CLI。
- G3：**tier 决策**输入化：每个 agent action 按经济模型选择 5 分钟档（launcher 内 subagent）或 1 小时档（独立 session），默认值由 pipeline stage 配置承载。
- G4：**`rasen agent audit --run`**：按 runId 聚合 launcher + 全部 worker session，输出后端对照与经济性证据。
- G5：作为 ECP roadmap 的一个切片交付（建议位置：ECP-4 收口后、ECP-5 前或并入 ECP-5 的 dogfood 要求），以 ReviewCycle 真实闭环为退出证据。

### 非目标

- 不改 270 秒 beat 机制本身；0.1.6 playbook 编排照常运行，不做 v1 的 Step B.5 集成。
- 不做端口型 broker / HTTP / Channel；不引入 Agent SDK 依赖（升级位保留）。
- 不解决 launcher 自身 TTL 与机器休眠（launcher 应保持薄，冷启动便宜是设计出来的，不是保温出来的）。
- 不做 per-worker worktree 隔离（沿用 shared working copy；契约里 agent action 已有 `workspace.access: none|read|write`，正是 single-writer 的机器可校验载体）。

## 3. 与 v1 的差异清单（砍掉什么、保留什么）

| v1 内容 | 处置 | 理由 |
|---|---|---|
| playbook Step B.5 / LEAD 路由指令 / `_orchestration.ts` 全部改动 | **砍** | 0.1.6 专属；内核世界无 LLM LEAD |
| LEAD epoch fencing、`worker adopt`、mailbox 作为 LEAD↔worker 信道 | **砍** | 编排者是代码；调用序列由 reconciler 持久状态决定，无 split-brain 面 |
| `rasen agent signal` CLI | **降级为可选止血项** | 对 0.2.0 非必需；若 0.1.6 编排还要长期用，可单独小 PR（消灭手写 shell 信号），不属于本设计 |
| `rasen worker dispatch/send/touch/retire` 宿主层 | **保留**，改名挂到内核语汇（§5） | 架构中立，就是执行器的实现 |
| KC1–KC5 探针验证 | **保留**，已外包执行 | 两种架构共同的承重假设 |
| 5min vs 1h 档路由经济学（35 分钟 break-even、写入量惩罚） | **保留**，重述为 tier 决策（§6） | 经济模型与编排架构无关 |
| registry schema | **保留**，键改为内核 id 空间（runId/nodeId/invocationId） | 对齐 `change-run` 契约 |
| `audit --run` | **保留**，聚合键从 change name 改为 runId | 内核 Run 是天然聚合单位，比 v1 更正 |
| retired 终态机器强制、touch 决策规则、幂等/journal 思想 | **保留** | journal 职责部分由内核 record/evidence 承接，边界见 §7 |

## 4. 落点：内核如何获得 Session 执行层

现状（ECP-1..4 推进中）：reconciler 产出 agent action，实际的 agent 工作由 launcher 会话经 skill 执行——`session.reuse` 契约已声明，执行侧没有兑现物。本设计补的就是这个缺口：

```text
reconciler ──next action──▶ launcher / runtime
                               │  agent action (kind: 'agent', session.reuse, role, model, …)
                               ▼
                    rasen session exec（新 CLI，执行器入口）
                               │
              ┌────────────────┴───────────────┐
              ▼                                ▼
      tier = inline-subagent            tier = independent-session
      （launcher 会话内 Task 工具，        SessionHost（§5）：
        5 分钟档，现状路径）               reuse='never'    → 新 session
                                          reuse='same-invocation'
                                                          → registry 查 idle session → resume 唤醒
                               │
                               ▼
              result envelope + evidence（回投 reconciler）
              registry 更新（sessionId 链 / lastRequestAt / state）
```

### 4.1 启动面与 driver 兼容性（硬约束）

主流程控制权在 reconciler（程序控制），但**启动与驱动必须继续支持从 code CLI 交互会话发起**（当前用户路径）。这是 ECP 自身的目标态（roadmap §0.3-4：`rasen-auto` 等入口保留为 thin launcher；ECP-5：CLI、API、Canvas 三面一致），Session 执行层不得破坏：

| driver | 形态 | 说明 |
|---|---|---|
| Claude Code 交互会话（当前路径） | 用户 `/rasen:auto` 等 skill 入口 → 会话成为 launcher：循环调 `rasen` CLI 取下一 action 并执行，兼任进度叙述与人工 gate 界面 | inline-subagent tier 就跑在该会话内（Task 工具）；independent-session 由 SessionHost spawn 子进程 |
| Codex CLI 交互会话 | 同上（skill 入口 + CLI 调用） | inline tier 映射为 codex 原生 subagent 或降级为 independent-session；**SessionHost 是纯 CLI 子进程 spawn，Codex launcher 也能持有 Claude worker session**——现行路由矩阵的 Codex→Claude `unsupported` 死路被打通 |
| 裸终端 / 脚本 | 直接 `rasen pipeline run/resume` | 无 LLM launcher；inline tier 不可用，全部走 independent-session |
| daemon / API / Canvas（后续） | supervisor 已有 headless spawn 先例 | 增量启动面，不替代上述路径 |

支撑这一约束的正是本设计的状态归属：run 状态在内核持久层、worker 在独立 session、touch 在 daemon——**driver 可插拔可更换**。用户关闭 Claude Code 窗口后，新会话或裸终端 `rasen pipeline resume` 接着驱动，worker 不重启、缓存不掉（launcher 死亡只是换 driver，不是 run 中断）。SessionHost/registry 对调用方无 driver 类型假设（Q1 的另一半）。

### 4.2 接线定案（2026-07-29 深夜对表 feat/ecp-review-cycle @ `2fa693d8`，ECP-4 已收口、ECP-5 进行中）

契约核对结果：**agent action 的 `session` 块、`ActorRef.sessionIdentityDigest`、`workspace.access` 与本设计依据的形态逐字段零变化**（`contracts.ts:196-208,122,185-190`）。执行现实核对结果：**"执行 agent action"目前没有任何代码实现**——内核经 `facade.ts:14` 的 `deliveryMode: 'grant'|'defer'` 显式外包（grant 把可执行 payload 交给调用者、内核不执行；defer 封印 HTTP 面永不携带可执行 payload），实际由 launcher 会话按 playbook 用自身 Task/SendMessage 完成。Session 执行层填的是**从未存在过的空位**，不替换任何 runner。

接线形状（P2 实现）：

```text
launcher/daemon ── rasen pipeline resume-run <change> <pipeline> --json ──▶ receipt（grant：含 agent action 全量）
        │  对每个 kind:'agent' 的 admitted action：
        ▼
rasen session exec --action <receipt 中的 action>      # 本设计的 executor 入口
        │  tier 决策（§6）→ SessionHost create/wake → 收割 result
        ▼
completion JSON（actor digest 由 executor 计算；真实 sessionId 记入本层 registry，Record 不改）
        │
rasen pipeline complete <change> --run <id> --from <receipt.json>
```

daemon 侧驱动遵循 ECP-5 确立的 `run-control.ts` 桥接约定：服务端绝不 in-process 改 Record——pre-spawn 校验后 spawn 本地 CLI 子命令、解析其 JSON receipt。

**P1 模块落点修正**：不从零建 `src/core/session-host/`——`management-api/supervisor.ts` 已有 headless `claude` spawn、pid 管理、tree-kill、并发槽、Windows `.cmd` 转义（一次性 `-p`、stdin ignore）；`session-registry.ts` 是内存 registry 且注释预留了 daemon 独立构造。P1 = 给 supervisor 增加 stream-json stdin 多轮 + resume 宿主模式，并把 session registry 持久化（§7 schema），而非新起炉灶。

**与 ECP-5 的唯一实质协调点**：ECP-5 的 `opsx-orchestration` delta spec 刚把 worker 句柄/session-relay generation 的所有权划给 run-state + playbook（prompt-owned）。本层落地（P2）必须显式 delta 修订该 spec 及 playbook Step A/B.1/B.4/H.2，把"agent action 的执行与 session 生命周期"的所有权移交 executor+registry；不得绕过。ECP-5 task 6.3（重写 `docs/architecture/executable-composite-pipelines.md`，该文档当前零 "session" 命中）是插入本层章节的天然时机。

## 5. SessionHost（resume-cli 宿主）

沿用 v1 已论证的核心判断：**独立 session worker 不需要常驻进程**。session = 持久化 transcript + 服务端按前缀键控的 1 小时 prompt cache；每次唤醒是一次 `claude -p --resume` 新进程，前缀未变且在 TTL 内即 HIT。空闲 worker 的成本严格为零。

原语（内部 API + CLI 面，命名对齐内核语汇）：

| 原语 | 行为 |
|---|---|
| `create(role, prompt, model, effort, cwd)` | spawn `claude -p <bootstrap> --output-format stream-json --dangerously-skip-permissions`，从 init 事件捕获 sessionId（复用 `supervisor.ts:203-364,552-597` 的 spawn/发现层），登记 registry |
| `wake(sessionRef, message)` | 校验 cwd 与 state≠retired → 单飞锁（O_EXCL+PID+TTL）→ `claude -p --resume <sid> <msg>` → 收割 result → 更新 registry（含 KC4 身份链：若 resume 换 id，registry 记链、以新 id 续） |
| `touch(sessionRef)` | `wake` 的固定短消息特例，成本 ≈ 0.1×C；决策规则见 §6 |
| `retire(sessionRef, {finalTurn})` | finalTurn=true：末回合让 session 写 handoff distillate 再标记 retired（趁 warm 退休）；false：直接标记（已冷透时不花唤醒钱）。retired 为终态，`wake` 结构化拒绝 |

### 5.1 宿主形态（P0 探针定稿，2026-07-29；证据见 `docs/experiments/session-cache-probe-results.md`）

**主宿主 = `stream-json` 常驻进程；`resume-cli` 降级为崩溃恢复路径。** 探针裁决：

| hostKind | 形态 | P0 裁决 |
|---|---|---|
| `stream-json`（**主**） | 每 worker 一个常驻 `claude -p --input-format stream-json --output-format stream-json` 进程，消息经 stdin 排队 | **KC6 PASS**：在杀死 resume-cli 的同一 worktree cwd 下，空闲 35 分钟 HIT 99.5–99.9%（haiku 与 sonnet 一致）。存活进程的历史上下文冻结在会话内、不重渲染 |
| `resume-cli`（恢复路径） | `-p --resume` 一发即走 | **KC1a/KC1c FAIL**：repo cwd 下 resume 会重渲染 cwd 注入的项目上下文块（~7.3k），该块含 git 状态相关**及未定位的其他可变成分**（repo 静止的对照仍 MISS），前缀在 21.7k–26k 边界断开、其后全量重写。scratchpad cwd 下 15–40 分钟 8 战全胜——机制是前缀不稳定，不是 TTL/容量 |

推论与配套事实（探针实测）：

- **进程存活成为缓存资产的一部分**：worker 进程必须由 daemon 持有 stdin/stdout（父进程死 → EOF → 进程退出）。进程死亡的恢复 = `resume-cli` respawn，付一次重渲染 rebase（有界、audit 可见），随后回到 live 形态；
- **KC5 并发**：CLI 层无任何并发保护（并发双方都计费、一方回合被静默丢弃）——stream-json 主宿主下消息经单一 stdin 天然串行，resume-cli 恢复路径仍须单飞锁；
- **KC4**：session_id 全程不换（跨 7 次 resume）——registry 记单 id，`sessionIdChain` 简化为防御性字段；
- **KC2**：跨 cwd resume 硬报错 exit 1——registry 记录并校验 cwd（已在设计内）；
- SessionEnd/Stop hooks 无头模式正常触发（1.5s 预算）——registry 更新可由 hook 异步触发；不支持自定义 session id。

**P1 入口残余验证——已全部关闭（2026-07-29 深夜第二轮探针，live 进程 worktree cwd，haiku）**：

| 验证项 | 结果 |
|---|---|
| live 进程 55 分钟留存 | **HIT**（read 98,052 / write 467 = 99.5%），且空闲期间 worktree 存在 untracked 变化——**repo 变化免疫同步实证** |
| live 进程 65 分钟留存 | **MISS-rewrite**——1h TTL 上界对 live 进程成立，touch 只在预计空闲 >~55 分钟时需要（§6.2 原策略数字不变） |
| MISS 重写后 5 分钟 | **HIT**——live 进程重写一次后温链立即恢复（daemon respawn/TTL 穿透后的恢复语义） |
| fork HIT 率 | **0/2**：距 bootstrap 9 秒、repo 未变也 MISS——`--fork-session` 必然重渲染前缀，无热缓存继承（§6.3 已改写） |
| KC5 重复试验 | 复现且**非确定性**：4 条并发 resume 丢 1 条，双方均计费均报 success、无任何报错——恢复路径单飞锁必须严格自建，不得依赖 CLI 任何行为 |

约束（探针 KC 对应）：

- 所有 create/wake 以 argv 数组 spawn，prompt 走文件/stdin，杜绝 shell quoting（前科：审计 §8.6 的信号写入失败）；
- cwd 固定为 registry 记录值（KC2 结果决定校验强度）；
- bootstrap prompt 硬性禁令：session worker 不得再 spawn 内置 subagent（否则落回 5 分钟档且审计失真；audit --run 出现子 transcript 即告警）；
- 并发 wake 由单飞锁拒绝（KC5 结果决定是否需要更强措施）。

## 6. Tier 决策（5 分钟档 vs 1 小时档）

经济模型（审计 §13.8，v1 结论原样保留）：

```text
5 分钟 subagent：cache write 1.25×C，read 0.1×C
1 小时 session ：cache write 2.00×C，read 0.1×C
首次生命周期 break-even ≈ 0.75C / 0.1C ≈ 7.5 次保温 ≈ 34–36 分钟空闲
```

> **P0 定稿后的适用性**：上述原始模型对 **stream-json 主宿主完整成立**（live 进程空闲零成本、35 分钟实证 HIT、touch 仅 >55 分钟场景待 65 分钟复跑确认）——KC1a 曾引发的"~15 分钟 touch cadence、break-even 恶化到 45–50 分钟"重算**只适用于 resume-cli 恢复路径**，不再是主线经济学。

决策输入与规则（内核世界的重述）：

| 条件 | tier |
|---|---|
| `session.reuse = 'never'`（one-shot stage） | inline-subagent |
| `reuse = 'same-invocation'` 且轮间空闲预估 > 35 分钟 | independent-session |
| `reuse = 'same-invocation'` 且预估复用轮次 ≥ 2 | independent-session |
| 结果须跨 launcher 生命周期存活（launcher 可随时死） | independent-session |
| 轮间空闲 ≤ 30 分钟且单轮写入量大（implementer/fixer 型） | inline-subagent（2× 写系数作用于全部增量写入，重写型角色在 session 档持续更贵） |
| 30–35 分钟灰区 | 读多写少角色（reviewer/planner 型）→ session；否则 subagent |

### 6.1 daemon：从 touch 定时器升级为进程托管者（P0 定稿后角色扩大）

stream-json 主宿主使 daemon 从"可选的 touch 优化器"变为 **live worker 的进程托管者**：持有各 worker 进程的 stdin/stdout 管道、注入消息、收割 result 事件、崩溃时按 resume-cli 路径 respawn（付一次有界 rebase）。touch 在 live 宿主下的必要性取决于 65 分钟 KC6 复跑：若 live 进程留存贯穿 1h TTL，touch 仅在预计空闲 >55 分钟时需要（经 stdin 注入固定短消息即可，实现成本趋零）。

优雅降级重述：daemon 死亡 → worker 进程收到 EOF 退出 → registry 仍持有 sessionId/cwd → 任意 driver 经 resume respawn，付一次重渲染 rebase 后回到 live 形态。**正确性永不依赖 daemon 存活，只有缓存效率依赖。**

以下 touch 策略/执行分离机制保留（适用于 resume-cli 恢复路径及 >55 分钟场景）：

touch 时钟不能挂在 launcher 上——launcher 是 LLM 会话，50 分钟标记到达时它可能正闲置或已退出；用不可靠的时钟保精确的 TTL 窗口是自相矛盾。方案是把**判断**与**执行**分开：

- **策略（kernel/launcher 写，转 idle 时落 registry）**：`touchPolicy: { mode: auto|never, deadlineAt, maxTouches, deadlineAction: stop|retire-silent }`。deadline 来自 run 状态知识（如"review 轮修复的 ETA + 缓冲"），是唯一需要判断的部分。
- **执行（rasen daemon 机械执行）**：daemon scheduler 周期扫描各 run 的 registry，对满足
  `state=idle ∧ mode=auto ∧ now < deadlineAt ∧ touchesUsed < maxTouches ∧ (now − lastRequestAt) ≥ 50min`
  的 session 发 touch（走 §5 同一 `wake` 路径与单飞锁；锁被真实 wake 持有时直接跳过——真实唤醒本身就刷新了 TTL）。执行前重读 `lastRequestAt` 防竞态；每次 touch 记入 `wakes[]`（kind=touch）供 audit 对账。
- **deadline 到期**：`stop` = 停止 touch、标注 `staleAt`（下次真实 wake 自付 MISS）；`retire-silent` = 机械置 retired（等价 `retire(finalTurn=false)`，不花末回合）。需要写 handoff 的退休仍归 kernel/launcher 判断。
- **休眠恢复**：daemon 醒来后重扫，对 `gap > 60min` 的 session **不 touch**（缓存已冷，touch = 花全额重写换不确定的复用，决策权交回 kernel），只标注 cold。
- **优雅降级**：daemon 未运行时一切照常，只是 idle > 60 分钟的 session 在下次唤醒付一次 MISS 重写——成本有界、audit 可见，不构成正确性问题。touch 是优化不是依赖。

这同时强化了 tier 路由 R3 的语义：worker 的保温不再依赖任何 LLM 会话存活。

### 6.2 其余 touch/retire 决策（kernel/launcher 侧）

```text
转 idle 时预计 ~110 分钟内仍复用 → touchPolicy.mode=auto + 设 deadlineAt/maxTouches（默认 2）
预计不再复用                     → 立即 retire（默认 finalTurn=true，趁 warm 写 handoff）
```

### 6.3 implementer 边界策略（review-cycle 的等待问题）

关键观察：**等待边界同时是上下文价值边界**——implementer 完成 apply 时，其上下文大部分是探索噪音，对 fix 轮是死重；且大上下文 warm worker 的每请求读成本本身更贵（审计 §6.5：320k reviewer 跑 82 请求比 42k successor 多花 ~230 万 input-eq）。review-cycle 的多轮存活者是 reviewer/fixer（pipeline 本有的角色分裂），不是 implementer。默认策略：

```text
implementer：subagent 档实现（1.25× 写）→ DONE 时趁 warm 写 durable findings
             + working-set manifest → 退出。不保温。
             （唯一例外：首 verdict 预计 ~15-25 分钟内回 → subagent+beat 短暂 park，现行机制）
reviewer / fixer：session 档（多 episode、轮间空闲、读多写少），fixer 冷启动从
             findings + manifest + diff 定向播种（起步 ~80k 而非继承 600k）
```

**collection-heavy 例外**（如 C#/C++ 单文件数十至数百 KB、相关性密集，working set ≈ 全上下文，蒸馏不掉）：

1. **dispatch 时机选档**——档位不可中途切换（换档 = 全量 2×C 重写），planner 按任务画像预判：`C_workingset > ~0.6 × C_implementer` 或 fix 轮需要实现者脑内状态 → implementer 从一开始走 session 档，0.75×C 写溢价当保险费（stage 配置显式逃生门）；
2. **working-set manifest 无论如何都做**——handoff 附机器可读清单（文件路径 + 行区间 + 相关性理由），successor 重收集从"重新探索"降为"定向读切片"（大文件读 findings 指向的区间而非整文件）；
3. **重收集只付一次**——session 档 fixer 收集后跨全部 fix 轮保温摊薄，真实对比是 `0.75×C_impl` vs `1.25×C_ws 一次性`。
4. **`--fork-session` 继承（第二轮探针后改写）**——实测 fork **无热缓存继承**（距 bootstrap 9 秒、repo 未变仍 MISS，0/2）：fork 必然重渲染前缀。fork 的真实定位是"**付一次全量重写（~2×C_impl 写费）换完整上下文继承 + 零重探索请求**"，与 manifest 播种的 fresh fixer 同台比价：fork 省重探索的请求/输出成本，manifest 省无关上下文的重写成本。working set ≈ 全上下文（蒸馏不掉）时 fork 占优，否则 manifest 占优。边界不变：design-level fixer 须 fresh eyes；reviewer 永不 fork 自 implementer。

collection-heavy 任务同时逼近上下文窗口上限（`handoffTokenLimit` 契约字段管辖）——保温不解决窗口耗尽，manifest 层不可省。

承载位置（对表后定案）：**不新增 `sessionTier` 字段**——authored 层的四值 `sessionReuse: none|stage|run-planner|review-thread`（`types.ts:40-46`）恰好携带 tier 所需语义（`review-thread` → session 档多轮、`run-planner` → session 档 MILESTONE、`stage` → 短复用倾向 subagent、`none` → inline one-shot）。问题在下降链路：`pipeline.ts:843-846` 把三个非 none 值**全部压平成 `same-invocation`**，语义在契约层丢失。P2 上游前置：在 `EffectiveRunPolicy.stages` 保真 authored 值（如增 `sessionReuseAuthored` 字段），executor 据此路由；契约 `session.reuse` 二值保持不变。

## 7. Session Registry

`<runDir>/sessions.json`（与内核 run 持久状态同级；确切目录等 ECP-4 后按 run-state 布局对齐），schema `rasen-session-registry/1`：

```json
{
  "schema": "rasen-session-registry/1",
  "runId": "…",
  "launcherSessionIds": ["…"],
  "sessions": [
    {
      "sessionKey": "reviewer@invocation-…",
      "role": "reviewer",
      "nodeId": "…", "invocationId": "…",
      "hostKind": "stream-json",
      "sessionId": "sid-1",
      "pid": 12345,
      "cwd": "…", "model": "…",
      "state": "active|idle|retired",
      "dispatchedAt": "…", "lastRequestAt": "…",
      "touchPolicy": { "mode": "auto", "deadlineAt": "…", "maxTouches": 2, "touchesUsed": 0, "deadlineAction": "stop" },
      "staleAt": null,
      "retiredAt": null, "retireReason": null, "handoffPath": null,
      "wakes": [{ "messageId": "…", "at": "…", "gapSeconds": 0, "resultRef": "…" }]
    }
  ]
}
```

- 单写者 = rasen CLI/daemon（SessionHost 操作的副作用），lockfile + 原子 rename；
- `sessionId` 单值即可（KC4 定案：resume 不换 id）；`pid` 记录 live 进程句柄，respawn 时更新；
- `wakes[]` 是轻量投递台账，替代 v1 的独立 mailbox journal——**正式的执行证据走内核的 record/evidence 通道**（契约里 agent action 已要求 `resultContractDigest`/`evidenceContractDigest`），registry 不做第二套真相，只存内核契约不覆盖的宿主层事实（缓存时钟、身份链、生命周期）。

## 8. audit --run

```text
rasen agent audit --run <runId>
```

- 定位 run 目录 → 读 `sessions.json` → 收集 launcher id 链 + 全部 worker `sessionIdChain` → 每个 session 走现有单 session 解析（`token-audit/audit.ts`）；
- worker session 按 main-session 计价（TTL 60 分钟、write 2×）——`classify()` 的 `ttlMin`/`pricing` 按 hostKind 选择；
- 新增输出段：per-session 汇总、run 合计、**tier 对照**（touch 成本、唤醒 HIT/MISS、免保温反事实节省 vs inline-subagent 的 beat 成本）、registry `wakes[]` 与 usage 时间轴的对齐校验（发现计划外唤醒/子 subagent 违规）。

## 9. 分阶段计划与验收

**P0 — KC 探针（进行中，已外包）**
`docs/experiments/session-cache-probe.md`。KC2/KC4 结果直接改写 §5/§7 的 cwd 校验与身份链设计。

> **P0 中期发现（2026-07-29，探针未收工）**：KC1a FAIL——`-p` 会话 12 分钟 HIT、30 分钟 MISS，写入全为 ephemeral_1h 计费档。交叉验证：同账号交互式会话当天 18.6–39.9 分钟 gap 全 HIT，4 天前审计的交互式 MAIN 36.5–58.3 分钟全 HIT。结论修正：
> 1. **1h 是计费档 + 上限，不是留存保证**；无头会话的孤立条目实测留存落在 (12, 30) 分钟（二分定位中），交互会话明显更长（疑似客户端侧 warming ping）。
> 2. **原 kill 路由「转评估 Agent SDK 宿主」作废**——缓存是服务端按前缀键控、宿主无关的，SDK streaming 会继承同样的留存行为。真正的杠杆是 §6.1 daemon touch 的 cadence：从 55 分钟改为「实测 T_eff − 余量」（预计 ~15 分钟级）。
> 3. 死的是"55 分钟免费空闲"参数，不是架构；§6 经济模型待二分/KC1c 收工后按 T_eff 重算，MISS 惩罚不对称（2×C vs 1.25×C）会把路由阈值整体推向 subagent。
> 4. KC2 已定：跨 cwd resume 硬报错 → registry 必须记录并校验 cwd。KC4 已定：session_id 恒定不换 → `sessionIdChain` 简化为单 id + 防御性链。KC5 已定：并发 resume 双方计费但一方回合被静默丢弃 → 单飞锁必须在 CLI 之上自行实现（已在 §5 设计内）。
> 5. **排期解耦**：ECP-5 不等本层；本层在经济学重算为正后，再于 direction 校准排为 ECP-5 后切片。
> 6. **官方文档调研确认（同日）**：1h 档官方措辞即"尽力而为、可逐出、无存活保证"——KC1a 解读获背书；客户端保温行为文档零记载（机制仍未知）。新增待测假设：
>    - **KC6（高价值）**：常驻 `claude -p --input-format stream-json` 进程空闲 30–40 分钟后经 stdin 发消息是否 HIT——若"存活进程 = 交互式级留存"成立，宿主换 `stream-json` 形态（§5.1），touch 可能全免；
>    - **KC7（低优先）**：`claude --bg` 会话的留存行为（supervisor 或有未记载保温；无编程消息 API，暂不作宿主）。
>
> **P0 定稿（同日 20:06 收官，完整回报见 `docs/experiments/session-cache-probe-results.md`，25 次计费调用 $3.53）**：
> 1. **KC6 PASS（双模型档位）**：worktree cwd 下常驻 stream-json 进程空闲 35 分钟 HIT 99.5–99.9% → **主宿主定为 stream-json**（§5.1），resume-cli 降级为恢复路径；
> 2. **KC1a 根因定案为 cwd 前缀不稳定**：repo cwd 的 resume 重渲染注入的 ~7.3k 项目上下文块（含 git 状态相关成分——主链 5 次 HIT/MISS 与本 worktree 的 commit 时间窗完美相关；另含未定位的其他可变成分——repo 静止的对照仍 MISS）；scratchpad cwd 8 战全胜证明留存本身 ≥40 分钟。TTL/容量淘汰假设双双出局；
> 3. KC1c FAIL（touch 两腿皆冷）随根因重释：不是 touch 机制无效，是 resume 路径前缀不稳定——touch 在 live 宿主下经 stdin 注入不受此影响；
> 4. 遗留验证（P1 入口）：65 分钟 KC6 复跑（>35 分钟留存）、KC5 重复试验、fork HIT 率实测。
>
> **P0 第二轮（同日深夜收官，主会话直跑 + haiku subagent 操作员）**：上述三项全部关闭，结果见 §5.1 表——live 进程 55 分钟 HIT（含 repo 变化免疫实证）/65 分钟 MISS（1h TTL 上界）/重写后 5 分钟温链恢复；fork 无热继承（0/2，§6.3 已改写）；KC5 非确定性丢轮次复现。**touch 策略回归 §6.2 原始数字（~50 分钟 cadence、仅 >55 分钟空闲场景），P0 全部验证事项就此完结，P1 可开工（等 ECP 排期）。**
> 运维教训（第二轮又复现两次）：subagent 后台闲等的完成通知会丢——数据须落盘、收割不依赖通知，正是本设计 registry/journal 的立论；探针脚本的日志写入（Add-Content）可能撞瞬时文件锁导致脚本早退，结果文件先于日志落盘的顺序救了数据，P1 实现里 registry 写入须 retry-on-lock。

**P1 — SessionHost + registry + daemon touch scheduler（探针通过后；可与 ECP-4 后期并行的独立模块）**
新模块（建议 `src/core/session-host/`）+ `rasen session exec|list|retire` CLI + daemon 内的 touch scheduler（§6.1 机械执行器）+ 单测。不碰 `change-run/`（只读契约类型），与 ECP-4 无文件冲突。
门槛：真实 create→wake×N→touch→retire 链全绿；并发 wake 拒绝；retired 拒绝唤醒；registry 与 transcript 事实一致；daemon 在真实 50 分钟窗口自动 touch 续命且 deadline 后停止（KC1c 的自动化复现）；daemon 关闭时全链路仍正确（仅多付 MISS）。

**P2 — ReviewCycle dogfood 接线（接线已在 §4.2 定案；开工前有上游前置）**
ReviewCycle 的 reviewer stage 以 `same-invocation` 复用真实跑一个 change。
门槛：reviewer 跨轮唤醒 HIT 100%；review-loop 全程 reviewer 零 TTL 重写（对照审计基线：该场景 15 次短中 gap TTL 是最大可治理项）；崩溃后从 registry+内核状态恢复不重跑。

**P2 上游前置（对表发现，须在 ECP 侧或随本层修复）**：
1. `handoffTokenLimit: 10_000` / `reuseRoundLimit: 1` 在 profile/pipeline 层全部硬编码、provenance 恒 `'default'`、无配置层可改（`profile-resolver.ts:243-244,564-565,592-593,612,640`；`pipeline.ts:835-836`）——三字段当前是**孤儿**（零读取方、CLI 不透出），executor 是第一个读取方，行为化前必须重定默认值并开配置口（10k 阈值会让任何 agent 回合立刻触发 handoff；round limit 1 会禁掉 reviewer 多轮复用——恰是本层头号场景）；
2. 合成 stage（evaluator/review-cycle/default）硬写 `sessionReuse: 'never'`（`profile-resolver.ts:243,611,639`）——ReviewCycle 合成路径的复用被契约关死，须改为尊重 authored 值；
3. 四值→二值映射保真（§6 承载位置段）；
4. `opsx-orchestration` spec 所有权边界修订 + playbook Step A/B.1/B.4/H.2 移交（§4.2）。
以上 1–3 是既存 Record 的**休眠占位值**——发布前不修，行为化时旧 Record 里的 10_000/1/never 将成为既成事实约束。

**P3 — audit --run + 经济性 A/B**
同规模 run 对照 9e36259d 基线。门槛：eligible 场景 TTL 重写 ↓≥70%；tier 全场净 input-eq 明确为正；`wakes[]` 与 usage 对账误差 0。

**排期归属**：ECP 子 Direction 的 roadmap 决策（用户拍板）。建议在 ECP-4 收口的 direction 校准中排为下一切片；其退出证据同时喂给 ECP-5 的「canonical Run + dogfood」要求。

## 10. 风险与开放问题

| # | 风险/问题 | 处置 |
|---|---|---|
| R1 | repo cwd 下 resume 前缀不稳定（P0 定案：重渲染的项目上下文块，含未定位可变成分） | 主宿主 stream-json 免疫（§5.1）；resume 仅作恢复路径并把一次 rebase 计入恢复成本；不投入定位/修复该块（CLI 内部行为，版本间可漂移） |
| R2 | ECP-4 改动 agent action 契约形状 | §4/§6 接线与 schema 留白到契约冻结；P1 只依赖 `session.reuse` 语义存在 |
| R3 | 每 worker 独立配额消耗、并行 session 上限 | P2 限 ≤2 个 session worker；registry 容量上限配置 |
| R4 | Claude CLI 升级改变 `-p/--resume/stream-json` 行为 | 探针脚本可重跑作为回归；audit 有 format-drift 处理先例 |
| R5 | session 上下文膨胀触发 compaction（1h TTL 不解决增长） | 复用 `handoffTokenLimit` 契约字段：超限 retire+handoff |
| R6 | `--dangerously-skip-permissions` 无人值守面 | 与 supervisor/relay 同险级；workspace.access=read 的角色可叠加 edit-boundary |
| Q1 | ~~完整 wake/exec 的宿主~~ | **已关闭（§4.2）**：launcher 与 daemon 皆可经 `rasen session exec` 驱动；daemon 侧遵循 run-control 桥接约定 |
| Q2b | `sessionIdentityDigest` 对应关系 | **已核实**：它是提交方自报的 actor 身份摘要输入（`actors.ts:54-56`，防伪靠重算校验，不绑真实 session）——executor 生成 completion 时计算 digest，真实 claude sessionId 只入本层 registry，Record 契约不动 |
| R8 | workspace.access 已被内核强制为**并发调度锁**（writer 独占/readers 共存/跨 run reservation，`reconciler.ts:997-1074`），但零文件级执行（与 edit-boundary 无联动，access 由 `inferAccess` 按 role 推断） | §9 的 single-writer 假设获内核背书；worker 文件级只读加固仍走 bootstrap 禁令 + edit-boundary（R6 既有方案） |
| R7 | daemon 生命周期不可靠（用户进程非服务，可能未运行/被关），而 live worker 进程依赖 daemon 持有管道 | §6.1 降级：daemon 死 → worker 进程 EOF 退出 → registry 持 sessionId/cwd → resume respawn 付一次有界 rebase 后回到 live 形态；**正确性永不依赖 daemon，只有缓存效率依赖** |
| Q2 | `sessionKey` 与内核 `sessionIdentityDigest` 的对应关系 | P2 接线时对齐，registry 记录 digest 反引 |
| Q3 | 0.1.6 侧是否单独做 `rasen agent signal` 止血 | 独立小 PR，用户按 0.1.6 存续期决定，不入本设计 |
