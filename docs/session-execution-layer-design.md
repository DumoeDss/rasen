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

接线细节（executor 由谁调用、result 如何进 reconciler 的 record/settle 路径）**刻意留白**：ECP-4 正在改 `change-run` 的 contracts/lowerer/reconciler，等其落定后按当时的 facade-runtime 形态补一节接线设计，避免现在写一份马上过时的胶水规范。本设计先把**契约消费者侧**（SessionHost、registry、audit）的形状定死——这些不依赖 ECP-4 的改动面。

## 5. SessionHost（resume-cli 宿主）

沿用 v1 已论证的核心判断：**独立 session worker 不需要常驻进程**。session = 持久化 transcript + 服务端按前缀键控的 1 小时 prompt cache；每次唤醒是一次 `claude -p --resume` 新进程，前缀未变且在 TTL 内即 HIT。空闲 worker 的成本严格为零。

原语（内部 API + CLI 面，命名对齐内核语汇）：

| 原语 | 行为 |
|---|---|
| `create(role, prompt, model, effort, cwd)` | spawn `claude -p <bootstrap> --output-format stream-json --dangerously-skip-permissions`，从 init 事件捕获 sessionId（复用 `supervisor.ts:203-364,552-597` 的 spawn/发现层），登记 registry |
| `wake(sessionRef, message)` | 校验 cwd 与 state≠retired → 单飞锁（O_EXCL+PID+TTL）→ `claude -p --resume <sid> <msg>` → 收割 result → 更新 registry（含 KC4 身份链：若 resume 换 id，registry 记链、以新 id 续） |
| `touch(sessionRef)` | `wake` 的固定短消息特例，成本 ≈ 0.1×C；决策规则见 §6 |
| `retire(sessionRef, {finalTurn})` | finalTurn=true：末回合让 session 写 handoff distillate 再标记 retired（趁 warm 退休）；false：直接标记（已冷透时不花唤醒钱）。retired 为终态，`wake` 结构化拒绝 |

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

决策输入与规则（内核世界的重述）：

| 条件 | tier |
|---|---|
| `session.reuse = 'never'`（one-shot stage） | inline-subagent |
| `reuse = 'same-invocation'` 且轮间空闲预估 > 35 分钟 | independent-session |
| `reuse = 'same-invocation'` 且预估复用轮次 ≥ 2 | independent-session |
| 结果须跨 launcher 生命周期存活（launcher 可随时死） | independent-session |
| 轮间空闲 ≤ 30 分钟且单轮写入量大（implementer/fixer 型） | inline-subagent（2× 写系数作用于全部增量写入，重写型角色在 session 档持续更贵） |
| 30–35 分钟灰区 | 读多写少角色（reviewer/planner 型）→ session；否则 subagent |

touch/retire 决策（idle 的 session）：

```text
now − lastRequestAt 接近 50 分钟 且 预计 ~110 分钟内仍复用 → touch（每次续命 ~55 分钟）
预计不再复用 / 超过 2 个 touch 周期仍无 ETA               → retire（默认 finalTurn=true，趁 warm 写 handoff）
```

承载位置：pipeline stage 配置。`types.ts:40-45` 已有 `sessionReuse: none|stage|run-planner|review-thread`——本层落地时把 stage 级 tier 显式化（如 `sessionTier: inline|independent|auto`，`auto` 按上表），具体 schema 演进等 ECP-4 契约冻结后定，避免与其改动冲突。

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
      "hostKind": "resume-cli",
      "sessionIdChain": ["sid-1", "sid-2"],
      "cwd": "…", "model": "…",
      "state": "active|idle|retired",
      "dispatchedAt": "…", "lastRequestAt": "…",
      "retiredAt": null, "retireReason": null, "handoffPath": null,
      "wakes": [{ "messageId": "…", "at": "…", "gapSeconds": 0, "resultRef": "…" }]
    }
  ]
}
```

- 单写者 = rasen CLI（SessionHost 操作的副作用），lockfile + 原子 rename；
- `sessionIdChain` 承接 KC4 结果（resume 若每次换 id，链是审计聚合的关键）；
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
`docs/experiments/session-cache-probe.md`。KC1a 任一非 HIT = kill：冻结 P1+，转评估 Agent SDK 宿主（v1 §4.3 对照表仍有效）。KC2/KC4 结果直接改写 §5/§7 的 cwd 校验与身份链设计。

**P1 — SessionHost + registry（探针通过后；可与 ECP-4 后期并行的独立模块）**
新模块（建议 `src/core/session-host/`）+ `rasen session exec|list|retire` CLI + 单测。不碰 `change-run/`（只读契约类型），与 ECP-4 无文件冲突。
门槛：真实 create→wake×N→touch→retire 链全绿；并发 wake 拒绝；retired 拒绝唤醒；registry 与 transcript 事实一致。

**P2 — ReviewCycle dogfood 接线（ECP-4 收口、契约冻结后）**
补 §4 留白的接线设计；ReviewCycle 的 reviewer stage 以 `same-invocation` 复用真实跑一个 change。
门槛：reviewer 跨轮唤醒 HIT 100%；review-loop 全程 reviewer 零 TTL 重写（对照审计基线：该场景 15 次短中 gap TTL 是最大可治理项）；崩溃后从 registry+内核状态恢复不重跑。

**P3 — audit --run + 经济性 A/B**
同规模 run 对照 9e36259d 基线。门槛：eligible 场景 TTL 重写 ↓≥70%；tier 全场净 input-eq 明确为正；`wakes[]` 与 usage 对账误差 0。

**排期归属**：ECP 子 Direction 的 roadmap 决策（用户拍板）。建议在 ECP-4 收口的 direction 校准中排为下一切片；其退出证据同时喂给 ECP-5 的「canonical Run + dogfood」要求。

## 10. 风险与开放问题

| # | 风险/问题 | 处置 |
|---|---|---|
| R1 | KC1 不成立（resume 不 HIT） | P0 kill gate；SDK 宿主备胎 |
| R2 | ECP-4 改动 agent action 契约形状 | §4/§6 接线与 schema 留白到契约冻结；P1 只依赖 `session.reuse` 语义存在 |
| R3 | 每 worker 独立配额消耗、并行 session 上限 | P2 限 ≤2 个 session worker；registry 容量上限配置 |
| R4 | Claude CLI 升级改变 `-p/--resume/stream-json` 行为 | 探针脚本可重跑作为回归；audit 有 format-drift 处理先例 |
| R5 | session 上下文膨胀触发 compaction（1h TTL 不解决增长） | 复用 `handoffTokenLimit` 契约字段：超限 retire+handoff |
| R6 | `--dangerously-skip-permissions` 无人值守面 | 与 supervisor/relay 同险级；workspace.access=read 的角色可叠加 edit-boundary |
| Q1 | executor 由 launcher 调还是未来 daemon 调（runtime 宿主问题） | ECP-4 后与接线设计一并定；SessionHost 对调用方无假设 |
| Q2 | `sessionKey` 与内核 `sessionIdentityDigest` 的对应关系 | P2 接线时对齐，registry 记录 digest 反引 |
| Q3 | 0.1.6 侧是否单独做 `rasen agent signal` 止血 | 独立小 PR，用户按 0.1.6 存续期决定，不入本设计 |
