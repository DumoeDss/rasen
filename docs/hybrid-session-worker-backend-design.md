# 混合 Worker 后端设计方案（Plan B：Hybrid Session Workers）

> 分支：`feat/hybrid-session-workers`（基于 `origin/dev/0.1.6` @ `d623b8f5`）
> 依据：`docs/audits/session-audit-9e36259d-cache-rebuild-review.md`（尤其第 8–13 节）
> 状态：设计稿，待评审
> 日期：2026-07-29

---

## 1. 背景与问题

Session `9e36259d` 审计给出的核心事实：

1. **beat 机制本身有效**：270 秒 cadence 在 active park 窗口内 100% 保住了 5 分钟 subagent 缓存；三次 warm resume 局部净削减 62.6%。
2. **但全场净值近乎持平**（窄口径 -48,997 input-eq）：两个 beat-cap episode 消耗了 63.6% 的续拍成本却未兑现 warm resume；每 4.5 分钟一次的续拍对长等待越来越贵。
3. **残余重建的大头不在 beat**：34 次 churn 重写 1,431 万 token，其中"该 park 的没 park"（15 次短中 gap TTL）、teammate message rebase（55.2%）、机器休眠、retired handle 复用是主因。
4. 审计第 13 节 Plan B 调研结论：**独立 Claude Code session worker（1 小时主会话缓存档）技术可行**，但不应全量替换，应作为**混合路由**中的长等待分支。

本设计把审计的方向性结论落成可实施方案：

```text
短生命周期 / 短等待 worker  →  内置 subagent + beat 机制（5 分钟缓存档，现状路径）
长生命周期 / 长等待 worker  →  独立 Claude Code session（1 小时缓存档，事件驱动，无 beat）
```

## 2. 目标与非目标

### 目标

- G1：新增一种 worker 宿主后端 **independent-session**，与现有 builtin-subagent 后端并存，由 dispatch 时的路由规则选择。
- G2：独立 session worker **事件驱动、零轮询**——空闲时不发任何模型请求，由 LEAD 侧注入消息唤醒；1 小时 TTL 内唤醒即 cache HIT。
- G3：为 worker 建立**机器可读的 registry 与生命周期状态机**（active/idle/retired + generation + leadEpoch），LEAD session handoff 时 worker 不死亡。
- G4：所有跨 session 通信走**文件 mailbox + `rasen` CLI 原语**，含幂等、journal 与 epoch fencing；消灭手写 shell 信号的脆弱性（顺带交付审计 P1 建议的 `rasen agent signal`）。
- G5：run 级审计聚合（`rasen agent audit --run`），让混合后端的经济性可直接验证。
- G6：整体作为**实验性后端**分阶段交付，默认关闭；有明确的验收门槛与 kill criterion。

### 非目标

- 不改 270 秒 beat cadence 本身（审计判定其可靠）。
- 不做端口型 broker / HTTP 服务 / Channel 协议（见 §6.4）。
- 不解决 MAIN 自身 60 分钟 TTL 与机器休眠（审计 M/S 类，仍走 session handoff，本设计只保证 handoff 时 worker 存活）。
- 不引入 `@anthropic-ai/claude-agent-sdk` 依赖（保留为后续升级路线，见 §4.3）。
- 不做 per-worker worktree 隔离（Phase 内维持 shared working copy + single-writer，见 §9）。

## 3. 现状基线（代码事实）

设计依赖的现有能力与缺口，均已在本 worktree 核实：

| 事实 | 位置 | 对设计的意义 |
|---|---|---|
| 编排是纯 prompt 级 playbook，无任何 TS 代码 spawn/管理 worker | `src/core/templates/workflows/_orchestration.ts`（1008 行，Step A–H） | 新后端 = 新 CLI 原语 + playbook 新 Step，不是改一个"调度器" |
| reuse horizon（ONE_SHOT/LOOP_BOUND/MILESTONE_BOUND）只存在于 playbook 文本 | `_orchestration.ts:115-118`；spec `worker-reuse-orchestration:137` | 路由规则可直接挂在 horizon 判定之后 |
| run-state 无 worker registry；`RunStateWorkerSchema` 是 per-stage 记录（`.passthrough()`），`dispatchMode` 只有 `native\|exec-bridge\|legacy-fallback` | `src/core/pipeline-registry/run-state.ts:68-88` | 需要第四种 dispatchMode + 独立 registry 文件 |
| keepalive 信号协议：`<changeRoot>/signals/<role>.json` 原子写（temp+rename）、BOM 容忍、stale 丢弃、poison-pill 消费 | `src/core/keepalive/index.ts:78-179` | 直接复用为 mailbox 的写入协议 |
| `rasen agent signal` / `agent extend` **未实现**；LEAD 现在手写 shell 信号（审计 §8.6 已记一次 quoting 失败） | `src/cli/index.ts:834-981` 穷举确认 | 本设计交付 `agent signal`，为两种后端共用 |
| 仓库已有 `claude` CLI 无头启动器：argv 数组 spawn、`-p --output-format stream-json --verbose`、从 init 事件捕获 sessionId、`RASEN_CLAUDE_BIN` 发现、context 走文件不走 argv | `src/core/management-api/supervisor.ts:203-364,552-597` | dispatch/send 的 spawn 层可直接复用，无需新依赖 |
| LEAD relay 已有三平台可见窗口 spawn 配方（relay-prompt.txt 文件间接 + EncodedCommand） | `src/core/templates/workflows/handoff.ts:39-58` | worker 不需要可见窗口，走 supervisor.ts 的 headless 路径；仅 fencing 语义借鉴 |
| audit 只聚合"单 session + 其 subagents"，无 `--run`；run-state 已存 `transcript`/`agentId`/`threadId` 句柄 | `src/core/token-audit/audit.ts:214-226`；`run-state.ts:637-647` | run→session 指针已有雏形，聚合是纯增量 |
| pipeline stage schema 已有 `sessionReuse: none\|stage\|run-planner\|review-thread`、`runtime`/`model`/`effort` | `src/core/pipeline-registry/types.ts:40-45,356-361` | 后端选择可作为 stage 级配置自然扩展 |

## 4. 总体架构

### 4.1 两种 Worker 后端

```text
                         LEAD（Claude Code 主会话）
                                   │
                    dispatch 时路由决策（§4.2）
                   ┌───────────────┴────────────────┐
                   ▼                                ▼
        builtin-subagent 后端                independent-session 后端
        （现状，5 分钟缓存档）                （新增，1 小时缓存档）
                   │                                │
        Task tool spawn                  rasen worker dispatch
        park: rasen agent wait           （spawn `claude -p`，捕获 sessionId，登记 registry）
        （270s beat 轮询）                          │
        唤醒: signal 文件                 空闲：零请求，进程可退出，
        （新增 rasen agent signal 封装）   session = transcript + 服务端 1h prompt cache
                   │                                │
        SendMessage 回传                  唤醒: rasen worker send
                                          （`claude -p --resume <sessionId>`，前缀追加 → HIT）
                                          回传: stream-json result 由 CLI 捕获写 outbox
```

关键架构判断：**独立 session worker 不需要常驻进程**。Claude Code 的 "session" 本质是 持久化 transcript + 服务端按前缀键控的 prompt cache；`claude -p --resume <sessionId>` 每次唤醒都是新进程加载 transcript、追加一条消息、发起请求——只要前缀未变且在 1 小时 TTL 内即 cache HIT。因此：

- 空闲 worker 的成本严格为零（无 beat、无进程、无请求）；
- worker 天然在 LEAD handoff、rasen CLI 崩溃、甚至（transcript 层面）机器休眠后存活；
- "唤醒频率"从每 270 秒一次降为**每次真实任务一次**，外加可选的 ~50 分钟 warm touch（§5.3）。

### 4.2 路由决策规则（核心）

路由在 LEAD dispatch 每个 worker 时执行一次，输入是现有 horizon 判定 + ETA/复用预估：

```text
输入：role, horizon, 预计空闲窗口 idle_est, 预计复用轮次 reuse_est,
      是否须跨 LEAD handoff 存活, 预计写入量（实现型 vs 评审型）

规则（按序命中）：
R1  horizon = ONE_SHOT                                → builtin-subagent（不 park，现状）
R2  keepalive 关闭或 runtime ≠ claude                  → builtin-subagent ONE_SHOT（现状 Gate）
R3  须跨 LEAD session handoff 存活的 worker             → independent-session
R4  MILESTONE_BOUND persistent planner                 → independent-session
R5  LOOP_BOUND 且 idle_est > 35 分钟                    → independent-session
R6  LOOP_BOUND 且 reuse_est ≥ 2 个 park episode         → independent-session
R7  LOOP_BOUND 且 idle_est ≤ 30 分钟                    → builtin-subagent + beat（现状）
R8  30–35 分钟灰区                                     → 默认 builtin-subagent（保守），
                                                         除非 role 是评审型（reviewer/planner）
```

阈值依据（审计 §13.8 经济模型）：

```text
5 分钟 subagent：cache write 1.25×C，read 0.1×C
1 小时主会话：  cache write 2.00×C，read 0.1×C
首次生命周期 break-even ≈ (2.00−1.25)C / 0.1C ≈ 7.5 个 beat ≈ 34–36 分钟
```

两个修正项（来自本场实测反例，防止无脑切换）：

1. **写入量惩罚**：2.0× vs 1.25× 的系数差作用于 worker 工作期间的**全部增量 cache write**，不只首写。重写型 worker（implementer/fixer 产出大量代码与 tool result）的持续写入在 session 档更贵——本场 Implementer A 若走 session 档首次生命周期反而多花约 20 万 input-eq。因此 R5–R8 的天平对 implementer 更倾向 subagent，对"读多写少"的 reviewer/planner 更倾向 session。
2. **60 分钟仍是硬边界**：1 小时档只是把保温频率从 4.5 分钟放宽到 ~55 分钟，不是永久缓存。idle_est > 55 分钟时 session 后端也须在 warm touch（成本 ≈ 0.1×C）与 retire+handoff 之间做成本决策（§5.3）。

`idle_est` / `reuse_est` 不要求精确：playbook 给 LEAD 的操作化判据是"下一次接触大概率落在哪个窗口"（review-loop 单轮修复的历史中位数、pipeline 下一 stage 的类型），估错的代价是有界的（错走 subagent = 多付 beat；错走 session = 多付 0.75×C 首写）。

### 4.3 宿主路线选型

审计 §13.3 列了三条路线。本设计 Phase 1 选 **路线 C（`claude -p --resume` 每消息一进程）**，与审计"SDK streaming 为首选基线"的建议不同，理由如下：

| 维度 | 路线 C：resume-cli（本设计 Phase 1） | 路线 A：Agent SDK streaming | 路线 B：`claude --bg` + Channel |
|---|---|---|---|
| 依赖 | 零新增（复用 supervisor.ts spawn 层） | 新增 SDK 依赖 + 常驻 WorkerHost 进程 | 两项 research-preview 能力 |
| 进程托管 | 无需（无常驻进程） | Rasen 须自管崩溃恢复/backpressure | background supervisor 托管 |
| 耐久性 | 天然（transcript 即状态） | 进程死亡需重建流 | 依赖 preview 行为 |
| 延迟 | 每消息 ~1–3s CLI 冷启动 | 低 | 低 |
| 并发注入/中断 | 不支持（须 per-worker 串行化） | 支持 | 支持 |
| 适配本场景 | **好**：worker 消息是粗粒度回合制（assign/下一轮/standDown），频率低、回合长达数十分钟，低延迟无价值 | 过度：为不需要的流式交互付出托管复杂度 | 违反"验证前不上 preview 通道"约束 |

审计将路线 C 定位为 "durable fallback、不适合低延迟主通道"——该保留意见针对的是高频消息场景；Rasen 的 LEAD↔worker 通信恰是低频回合制，durable 正是第一诉求。**WorkerHost 抽象仍按接口设计**（`hostKind: 'resume-cli'` 为首个实现），SDK streaming host 保留为 Phase 4 升级位，若 A/B 数据显示 CLI 冷启动延迟或串行化成为瓶颈再引入。

须在 M0 用真实账单验证的前提假设（**kill criterion**）：

- KC1：`claude -p --resume` 在 10/30/55 分钟后的唤醒请求 cache HIT（audit 分类为 hit，非 rebase/ttl）。若 resume 触发前缀重写，整条路线不成立，退回评估 SDK host。
- KC2：resume 必须在与原 session 相同的 cwd 执行（transcript 按 encoded cwd 存放）；registry 固定并校验 cwd。
- KC3：LEAD 侧以 `run_in_background` Bash 运行 `rasen worker send` 后，任务完成通知注入 LEAD 会话是**前缀追加（HIT）**而非 rebase。若 rebase，LEAD 收口改为 park + `agent signal` 通道（§6.2 备选）。

## 5. 独立 Session Worker 生命周期

### 5.1 dispatch（创建）

```text
rasen worker dispatch --change <name> --role <key> \
    --prompt-file <path> [--model <m>] [--effort <e>] [--epoch <n>]
```

1. 读 prompt 文件（bootstrap prompt 由 playbook 模板生成，含角色、change 上下文指针、回合契约、平铺层级禁令——**worker 禁止再 spawn 任何 subagent**，否则退回 5 分钟档且审计失真）；
2. 以 argv 数组 spawn `claude -p <prompt> --output-format stream-json --verbose --dangerously-skip-permissions [--model <m>]`，cwd = project root（复用 `resolveAgentCliBin()`/`spawnAgentCli()`，supervisor.ts:203-222,552-597；权限模式沿用 supervisor 与 session-relay 的既有论证：无人值守续跑语义）；
3. 从 stream-json `init` 事件捕获 `sessionId`（supervisor.ts:121-125 同款解析）；
4. 写 registry 条目（§7），状态 `active`；
5. 首回合结束（进程退出）后：CLI 捕获 result 文本写 outbox，registry 状态置 `idle`，记录 `lastRequestAt`。

dispatch 本身是长阻塞操作（首回合可达数十分钟），LEAD 必须以 `run_in_background` 运行，完成通知即"worker 首回合完成"。

### 5.2 send（唤醒 / 追加任务）

```text
rasen worker send --change <name> --worker <workerId> \
    --kind <assign|resume|standDown|touch> \
    [--message-file <path> | --instruction <text>] --epoch <n>
```

执行序：

1. **fencing**：校验 `--epoch` ≥ registry 当前 `leadEpoch`，否则结构化拒绝（§8）；
2. **单飞锁**：获取 per-worker lockfile（`O_EXCL` + PID + TTL，沿用 Gap-E 教训），worker 回合进行中的并发 send 直接失败并提示排队——同一 session 不允许并发 resume；
3. **journal**：envelope 追加写 `mailbox/journal.jsonl`（状态 `enqueued`）；
4. **注入**：`claude -p --resume <sessionId> <message> --output-format stream-json`，消息体含 `messageId`；worker prompt 契约要求对已处理过的 `messageId` 直接回 `DUPLICATE`（at-least-once + 幂等，§6.3）；
5. **收割**：进程退出后捕获 result 写 `outbox/<messageId>-result.json`，journal 置 `done`，registry 更新 `lastRequestAt`/状态。

崩溃恢复：journal 中 `enqueued` 但无 result 的消息可安全重发（幂等由 messageId 保证）。

### 5.3 warm touch 与 60 分钟边界

worker `idle` 且 LEAD 判断"仍会复用、但下一次接触可能越过 1 小时"时：

```text
rasen worker touch --change <name> --worker <workerId> --epoch <n>
```

= `send --kind touch`，消息体为固定短文本（"keepalive touch，回复 OK 即可"）。成本 ≈ 0.1×C + 极小 write。决策规则（playbook 化）：

```text
now - lastRequestAt 接近 50 分钟 且 ETA 仍在 ~110 分钟内   → touch（每次续命 ~55 分钟）
ETA 未知或超过 2 个 touch 周期                             → retire（趁 warm 写 handoff，§5.4）
```

对照本场 Reviewer A 反事实（审计 §13.8）：12 次 beat 花 388,366；session 档 60 分钟内零成本、85 分钟场景 1 次 touch ≈ 32,364——节省 11.5–14.8 万 input-eq/episode。

### 5.4 retire 与 handoff

```text
rasen worker retire --change <name> --worker <workerId> --epoch <n> [--skip-final-turn]
```

- 默认：send 一条 standDown 消息，worker 在**仍 warm 时**写 `<workDir>/handoff/<role>-<n>.md`（沿用现有 H.3 distillate 模板）并回 `DONE + durable findings`；CLI 将 registry 状态置 `retired`。
- `--skip-final-turn`：不花最后一回合，直接标记 retired（适用于 worker 已冷透——审计教训：不要只为写退休 handoff 复活 64.5 万 token 上下文）。
- **retired 是终态**：`worker send` 对 retired 条目结构化拒绝（把现有"retired handle 禁复用"从文本规则变成机器强制——直接关闭审计 §8.3 的 Fixer A 缺陷类）。后继 worker 一律 `dispatch` 冷启动 + handoff seed。

生命周期状态机：

```text
dispatch → active（回合进行中）⇄ idle（空闲，零成本）
                                   │ retire / standDown
                                   ▼
                                retired（终态，send 拒绝）
```

## 6. 通信与控制平面

### 6.1 目录布局与 envelope

```text
<workDir>/                        # 现有 change-work-dir（auto-run.json 同级）
  workers.json                    # registry（§7）
  mailbox/
    journal.jsonl                 # append-only，全部 send/dispatch/touch/retire 事件
    <workerId>/
      inbox/<seq>-<messageId>.json    # 消息体超过内联上限时的 payload 文件
      outbox/<messageId>-result.json  # CLI 捕获的 worker 回合结果
```

envelope（journal 行 & inbox 文件共用，取审计 §13.5 提议的子集——单机文件场景不需要 topic/broadcast/payloadHash 全家桶）：

```json
{
  "messageId": "uuid",
  "runId": "<change-or-run-id>",
  "workerId": "reviewer-1",
  "kind": "assign|resume|standDown|touch",
  "leadEpoch": 2,
  "createdAt": "ISO-8601",
  "payload": "inline text ≤ 8KB",
  "payloadRef": "mailbox/reviewer-1/inbox/003-....json",
  "status": "enqueued|done|rejected|duplicate"
}
```

写入协议复用 `writeSignalAtomic` 的 temp+rename 与 `readSignal` 的 BOM/poison-pill 容错（keepalive/index.ts:99-132）。

### 6.2 worker → LEAD 回传

主路径：**LEAD 的 background Bash 任务完成通知**。`rasen worker send` 进程的退出即回合结束信号，result 已在 outbox——LEAD 无须轮询、无 teammate message、无 rebase 风险（KC3 验证项）。

备选路径（KC3 不成立时启用）：LEAD park 于 `rasen agent wait --role lead`，`worker send` 在收割后追加执行 `rasen agent signal --change <name> --role lead --resume-file <outbox 路径>`——两种后端共用同一信号协议，方向对称。

### 6.3 投递语义

- **at-least-once**：journal 先行，重发安全；
- **幂等**：worker prompt 契约按 `messageId` 去重（回 `DUPLICATE` 不执行）；
- **定向为唯一原语**：无 broadcast。控制类群发（cancel/epoch 变更）= CLI 遍历 registry 逐个定向 send，且**只发给将被唤醒是值得的 worker**——审计明确警告：对 40 万 token worker 的一次无关广播 ≈ 4 万 input-eq 温读。epoch 变更本身不需要通知 worker（fencing 在 CLI 层校验，worker 无感知）。

### 6.4 为什么没有 broker 端口

审计 §13.4 反对"LEAD 直连 N 个裸端口"，推荐单 broker endpoint。本设计走得更远：**Phase 1–3 完全没有网络面**。因为 resume-cli 宿主下不存在"向运行中进程推送"的需求——注入即进程创建，mailbox 即持久队列，`rasen` CLI 即 broker。这消除了端口分配、防火墙提示、stale listener、鉴权 token 全部问题面。SDK host 若在 Phase 4 引入，broker 进程再随之出现，届时 mailbox/journal/epoch 语义原样保留，只更换投递层。

## 7. Worker Registry（机器可读）

`<workDir>/workers.json`，单写者 = `rasen` CLI（LEAD 通过 CLI 操作；worker 永不写——保持现有"worker 不写 run-state"不变量）。写入走 lockfile + 原子 rename。

```json
{
  "schema": "rasen-worker-registry/1",
  "leadEpoch": 2,
  "leadSessionId": "<当前 LEAD 的 sessionId，供 audit --run>",
  "workers": [
    {
      "workerId": "reviewer-1",
      "role": "reviewer",
      "generation": 1,
      "hostKind": "resume-cli",
      "sessionId": "<claude session uuid>",
      "cwd": "E:/.../OpenSpec-code-hybrid-session-workers",
      "model": "claude-fable-5",
      "state": "idle",
      "horizon": "LOOP_BOUND",
      "dispatchedAt": "ISO-8601",
      "lastRequestAt": "ISO-8601",
      "retiredAt": null,
      "retireReason": null,
      "handoffPath": null
    }
  ]
}
```

- `lastRequestAt` 由每次 dispatch/send/touch 收割时刷新，是 touch 决策与 audit 对账的依据；
- run-state 的 `RunStateWorkerSchema` 增加第四种 `dispatchMode: 'independent-session'`，stage 记录只存 `workerId` 引用 + sessionId 快照，registry 是生命周期权威（避免两处状态漂移：stage 记录是"谁做的这个 stage"，registry 是"这个 worker 现在什么状态"）；
- `rasen worker list --change <name> --json` 供 LEAD/successor/audit 消费。

## 8. LEAD Handoff：从"停机切换"到"领导权切换"

现状不变量（H.7）：relay 前 quiesce、无 worker in flight、前任的 subagent handle 在新 session 不可恢复。Plan B 下 session worker 不再受此限制：

1. 旧 LEAD 完成 outbox 收割（journal 无 `enqueued` 残留）后写 handoff 文档，**内容新增 worker roster 段**（workerId/sessionId/state/lastRequestAt/pending 事项——从 `worker list` 生成，不手写）；
2. successor 启动后执行 `rasen worker adopt --change <name>`：CAS 递增 `leadEpoch`（旧值写入 handoff 供审计）；
3. 此后旧 LEAD 若仍存活，其一切 `worker send --epoch <旧值>` 被结构化拒绝（**fencing**，防 split-brain 双 LEAD 指挥同一 reviewer）；
4. worker 全程无感知：不重启、不写 handoff、不损失缓存。subagent 后端 worker 仍按现状随 LEAD 死亡——这本身是路由规则 R3 的输入（须跨 handoff 存活 → session 后端）。

quiesce 要求从"无 worker in flight"放宽为"无 **send** in flight"：idle 的 session worker 不阻塞 relay。

## 9. 工作区策略

Phase 1–3 维持 **shared working copy + single-writer**（与现状一致，`claude -p` 不做 worktree 隔离，天然共享）：

- registry 记录每个 worker 的 `cwd`，send 前校验一致（KC2）；
- 写权限按 role：implementer/fixer 可写，reviewer/planner 只读（bootstrap prompt 明示 + `rasen agent edit-boundary` 现有机制可选加固）；
- 同一时刻至多一个写者 worker 处于 active 回合——由 LEAD 编排保证，send 单飞锁兜底同 worker 并发，playbook 新 Step 明示跨 worker 写者互斥；
- reviewer 只在写者回合结束（milestone 落盘）后被唤醒——现状 review-loop 时序本就如此。

per-worker worktree + merge gate 列为 Phase 4 之后的独立提案（审计 §13.7 的长期方向），不与本设计捆绑。

## 10. CLI 新增面

| 命令 | 阶段 | 说明 |
|---|---|---|
| `rasen agent signal --change <n> --role <k> (--resume [--instruction <t> \| --instruction-file <p>] \| --stand-down)` | M0 | 审计 P1 #6。封装原子写/BOM/Windows 路径，两种后端共用；LEAD 不再手写 shell 信号 |
| `rasen worker dispatch` | M0 | §5.1 |
| `rasen worker send` | M0 | §5.2（含 `--kind touch` 的别名 `worker touch`） |
| `rasen worker retire` | M0 | §5.4 |
| `rasen worker list --json` | M0 | registry 查询 |
| `rasen worker adopt` | M2 | §8 epoch CAS |
| `rasen agent audit --run <change-or-run-id>` | M3 | §13 聚合 |

不做 `rasen agent extend`（审计 P1 #7）：session 后端使 12-beat cap 的延长争论对长等待失去意义（那正是 R5 路由走 session 的场景）；subagent 侧维持"12-beat + handoff"现状策略。若后续数据证明仍需要，另行提案。

## 11. 配置面

`config-keys.ts` 注册（scopes 均 `['global','project']`，经由现有 resolveEffectiveConfig 链）：

| key | 类型/默认 | 说明 |
|---|---|---|
| `worker.sessionBackend.enabled` | boolean / `false` | 总开关。false 时路由规则短路为全 subagent（现状 byte-for-byte 不变） |
| `worker.sessionBackend.minIdleMinutes` | int / `35` | 路由规则 R5 阈值（合法区间 15–55） |
| `worker.sessionBackend.touch` | `auto\|never` / `auto` | warm touch 策略；`never` = 到 55 分钟一律 retire |

runtime gating 沿用现状：session 后端仅在 LEAD runtime = claude 时可用（`detectAgentRuntime`），Codex LEAD 不路由到 session 后端。

## 12. Playbook / spec / run-state 改动面

按调研确认的改动点（含防雷项）：

1. **`_orchestration.ts`**：新增 Step `B.5 — Worker backend routing & session workers`（路由表 §4.2、send/touch/retire 操作契约、写者互斥）；同步四处：`OrchestrationModuleId` 联合、`ORCHESTRATION_MODULE_ORDER`、`STEP_HEADING_PATTERN`（`B.5` 须入 alternation）、`includesModule()`；新增 feature flag `sessionWorkers` 并更新三个 bundle 的 FeatureSet（AUTO 开、GOAL/REVIEW_CYCLE 视 M2 评估）；改动句子须回查 `replaceExactlyOnce` 各 render 函数的 search 串与 `assertReferenceClosure()`。
2. **Step B.4 / E.4 / H.7 局部修订**：B.4 头部加"先过 B.5 路由，落到 subagent 后端才适用本节"；E.4 的 resume 阶梯加 session worker 分支（`worker send` 优先于 signal/SendMessage）；H.7 的"无跨 session worker 复活"不变量改写为"subagent 后端无复活；session 后端按 §8 adopt"。
3. **run-state**：`dispatchMode` 枚举加 `independent-session`；`normalizeRunStateWorkerRecord()` nullable 列表、`inferWorkerDispatchMode()`、`stagesLackingDurableHandle()` 同步（sessionId 即 durable handle）。
4. **specs**：新建 `rasen/specs/session-worker-backend/spec.md`（registry/生命周期/fencing/mailbox 语义）；delta 修订 `worker-reuse-orchestration`（路由规则挂接 horizon）、`orchestration-worker-lifecycle`（第四种 dispatchMode 的死亡分类与 resume 阶梯）、`cli-agent-wait`（不改语义，交叉引用 signal 命令）、`session-relay`（quiesce 放宽 + roster 段 + adopt）。
5. **测试回归面**：`test/commands/handoff.test.ts` 等对 playbook 的字面断言会红——按句更新；新增 `worker-registry`/`worker-send`/`agent-signal` 单测与命令级测试（含 Store unavailable fail-soft：`agent signal`/`worker *` 在 planning-home 解析失败时输出结构化错误而非裸异常——补审计 §8.5 同类缺口）。

## 13. 审计与验收

### 13.1 `rasen agent audit --run`

- 输入：change/run id → 定位 workDir → 读 `workers.json` + run-state `sessionHandoff` 链 → 收集 LEAD 各 generation sessionId + 全部 worker sessionId；
- 每个 session 走现有单 session 解析（**session worker 按 main-session 计价：TTL 60 分钟、write 2×**——`classify()` 的 `ttlMin` 与 `pricing` 按 hostKind 选择）；
- 输出 `run-audit-<id>.json`（schema `rasen-token-audit/3` 或并列新 schema）：per-session 汇总 + run 合计 + **后端对照段**（session worker 的 touch 成本、唤醒 HIT/MISS、免 beat 反事实节省 vs subagent 的 beat 成本、warm resume 收益）；
- journal 的 send/收割时间戳与 usage 时间轴对齐，直接产出审计 §11 要求的 episode 级归因。

### 13.2 分阶段计划与验收门槛

**M0 — 原语 + 缓存行为验证（kill gate）**
交付：`agent signal`、`worker dispatch/send/retire/list`、registry、journal、单测。
验证（真实账单，非 mock）：

| 指标 | 门槛 |
|---|---|
| KC1：10/30/55 分钟 resume 唤醒 cache HIT | 3/3 HIT |
| 65 分钟无 touch 的唤醒 | audit 正确判为 ttl-expiry（预期 MISS，非 rebase） |
| 55 分钟 touch 后 85–90 分钟唤醒 | HIT |
| KC3：background send 完成通知注入 LEAD | 无 rebase |
| send 幂等重发 | 重复执行 0 |
| 并发 send 同一 worker | 第二个结构化拒绝 |

KC1 不达标 → 冻结 M1+，转 SDK host 评估。

**M1 — review-loop POC**
1 LEAD + 1 implementer（subagent，R7/写入量惩罚）+ 1 reviewer（session，R5），directed only，真实 change 全流程。门槛：审计 §13.11 表全项（投递 100%、重复执行 0、非目标唤醒 0、run 级 token 合计误差 0、并行写者 0）。

**M2 — playbook 集成 + handoff 存活**
Step B.5 落 playbook、run-state/spec 修订、`worker adopt` fencing。门槛：LEAD relay 一次，worker 重启 0、旧 epoch send 成功 0、roster 段完整。

**M3 — audit --run + A/B 经济性**
同规模 session 对照本次审计基线。门槛（继承审计 §11）：eligible 非休眠 subagent TTL 重写 ↓≥70%、parked/retired worker 收 teammate message 0、keepalive+session 后端全场净 input-eq 明确为正。

**M4（数据后决策）**：默认开启的 role/horizon 白名单；SDK host / worktree 隔离是否立项。

## 14. 风险与开放问题

| # | 风险 | 缓解 |
|---|---|---|
| R1 | `-p --resume` 唤醒不 HIT（前缀被 CLI 版本/注入方式改写） | M0 kill gate；WorkerHost 抽象保留 SDK 备胎 |
| R2 | 双份 quota：每个 session worker 独立消耗配额，并行 session 数受账户限制 | POC 限 ≤2 个 session worker；registry 上限配置 |
| R3 | Claude Code 升级改变 `-p`/`--resume`/stream-json 行为（非公开契约面小但存在） | 版本探测 + M0 验证脚本可重跑；audit 已有 format-drift 先例处理 |
| R4 | worker prompt 违反平铺层级偷开 subagent，落回 5 分钟档 | prompt 硬禁令 + audit --run 可见（子 transcript 出现即告警） |
| R5 | session worker 上下文膨胀触发 compaction（1h TTL 不解决增长） | 复用现有 H.2/H.3 阈值探测（`agent context --transcript`），超阈 retire |
| R6 | shared working copy 下 reviewer 读到写者中间态 | §9 时序 + 只读边界；worktree 隔离列为后续提案 |
| R7 | `--dangerously-skip-permissions` 的无人值守 worker 误操作面 | 与现有 supervisor/relay 同险级；edit-boundary + careful 皮带可叠加 |
| Q1 | `worker.sessionBackend` 配置 scope 是否需要 pipeline stage 级覆盖（types.ts `sessionReuse` 扩展 vs 全局 key） | M2 前拍板；倾向 stage 级 `backend: subagent\|session\|auto` 字段 |
| Q2 | LEAD 侧长空闲（等 worker 数十分钟）自身的 60 分钟 TTL | 超出本设计（审计 M 类）；background 通知使 LEAD 空闲时零请求，与现状同险 |
| Q3 | `workerId` 命名规范与 signal role key 的命名空间关系（`isValidRoleKey` 正则复用） | M0 定：`<role>-<generation>`，同一正则 |

## 15. 与审计建议的对照

| 审计建议 | 本设计 |
|---|---|
| P0-1 horizon/park 状态入 run-state 机器校验 | §7 registry + run-state dispatchMode（覆盖并超出） |
| P0-3 禁止向 parked/retired worker 发 teammate message | §5.4 retired 终态 CLI 强制；session 后端根除该通道 |
| P0-4 beat cap 成本决策 | §4.2 路由 + §5.3 touch/retire 决策（把决策点前移到 dispatch） |
| P1-6 `rasen agent signal` | §10 M0 交付 |
| P1-7 `agent extend` | 明确不做（§10，路由取代延长） |
| P1-8 wait 对 Store unavailable fail-soft | 新命令族命令级测试覆盖（§12.5）；wait 本体修复不阻塞、可并行小修 |
| P1-9/10 休眠降级、MAIN handoff | 非目标（§2）；§8 使 handoff 时 worker 存活，降低 relay 成本 |
| P2-11/12 audit 原生归因 | §13.1 --run 聚合 + 后端对照段 |
| §13.12 实现优先级（registry→SDK host→fencing→audit→Channel） | 采纳 registry/fencing/audit 次序；host 首选改为 resume-cli（§4.3 论证），SDK/Channel 后置 |
