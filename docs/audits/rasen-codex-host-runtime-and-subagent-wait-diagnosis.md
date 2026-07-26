# Rasen 在 Codex 宿主中的 subagent 等待与 runtime 选择诊断

> 日期：2026-07-26
> 分支：`fix/host-aware-runtime-dispatch`
> 诊断范围：Rasen 当前工作树、相邻 `codex` 源码仓库、一次真实 Codex/Rasen 会话 trace
> 状态：已确认现状与目标模型；宿主感知 runtime 分发、原生续跑语义和最终执行预检修复已实现

## 1. 执行结论

结论不是“Codex subagent 完全有问题”或“Rasen 完全没有问题”二选一，而是：

1. **大量重复等待主要由 Rasen 当前在 Codex 宿主上的编排方式触发。** Rasen 要求 LEAD 把每个完整 stage 派发给 leaf worker，并在关键路径上收齐结果；当前运行又以较短 timeout 反复调用 `wait_agent`，因此产生大量等待回合。
2. **Codex 的消息传递本身不是靠轮询 worker 状态实现的。** `wait_agent` v2 等待的是 mailbox/steer 的异步活动通知；子 agent 完成时，Codex 会自动把其最终结果投递到父 agent 的 mailbox。
3. **Codex TUI 存在一个独立的可观测性问题。** timeout 和 mailbox 唤醒都可能被渲染成相同的：

   ```text
   Waiting for agents
   Finished waiting
   └ No agents completed yet
   ```

   所以这段 UI 不能证明底层正在轮询，也不能区分“超时”与“已经收到 mailbox 活动”。
4. **用户提出的宿主选择预期是合理的，但当前 Rasen 尚未实现。** 默认 worker runtime 应当继承当前工具宿主；只有 workflow、stage、role 或命令显式指定其他 runtime 时才覆盖默认值。当前 pipeline runtime 的最终 fallback 仍然硬编码为 `claude`。
5. **Rasen 虽然已有 `detectAgentRuntime()`，但它只用于 `rasen agent wait` 的 keepalive gate，没有参与 pipeline runtime 解析或 LEAD 能力层级选择。** 同时它没有识别当前 Codex 进程稳定提供的 `CODEX_THREAD_ID`，所以在本次 Codex 环境中会返回 `unknown`。

因此，问题归因如下：

| 层级 | 判定 | 影响 |
|---|---|---|
| Rasen 宿主/runtime 解析 | 主要设计缺口 | Codex LEAD 下未自动选择 Codex-native 派发，默认仍为 Claude |
| Rasen 等待策略与完成协议 | 主要放大因素 | 短 timeout 重复等待；Codex-native 最终返回之外又要求 worker 主动 `SendMessage(DONE)` |
| Codex mailbox/消息传递 | 基本正常 | 已有事件驱动等待、自动完成投递、`send_message`/`followup_task` |
| Codex TUI 等待状态展示 | 次要实现问题 | timeout 与真实 mailbox 唤醒显示相同，造成“持续轮询且没有结果”的错觉 |

## 2. 真实会话证据

审计的 Codex rollout：

```text
C:\Users\Sayo\.codex\sessions\2026\07\26\
rollout-2026-07-26T17-30-28-019f9dc2-f9f9-7483-9787-d273ab76dafd.jsonl
```

截至 `2026-07-26 21:46:37 +08:00` 的快照：

| 指标 | 数量 |
|---|---:|
| `spawn_agent` 调用 | 8 |
| `wait_agent` 调用 | 278 |
| 明确返回 `Wait timed out.` | 238 |
| 明确返回 `Wait completed.` | 39 |
| 快照时尚未匹配完成结果的调用 | 1 |

这个会话当时仍在运行，所以数字是快照，不是最终总数。它已经足以说明：等待次数远高于 agent 数量，主要模式是短 timeout 到期后再次等待。

同一 trace 中，Rasen stages 基本沿一条串行关键路径运行：

| 本地时间 | worker |
|---|---|
| 09:38 | `propose_f1` |
| 09:50 | `apply_f1` |
| 10:41 | `verify_f1` |
| 10:57 | `fix_publication_f1` |
| 12:27 | `ship_f1` |
| 12:39 | `archive_f1` |
| 13:00 | `propose_f2` |
| 13:11 | `apply_f2` |

这不是“8 个独立任务并行执行但父 agent 无事可做”，而是父 agent 多次在下一 stage 所依赖的 leaf worker 上阻塞。Rasen 的编排约束要求完整 stage 由 leaf worker 执行，并要求继续前收齐结果，见：

- [`_orchestration.ts`](../../src/core/templates/workflows/_orchestration.ts#L22)：LEAD 不直接完成整个 stage，每个 stage 派发给 leaf worker。
- [`_orchestration.ts`](../../src/core/templates/workflows/_orchestration.ts#L133)：并行组继续前必须收齐所有结果。

所以“需要等待某个关键路径 worker”本身是合理的；不合理的是把一次逻辑 join 拆成数百次短等待。

## 3. Codex 的等待不是 worker 状态轮询

### 3.1 `wait_agent` v2 等待 mailbox 事件

Codex 的实现位于相邻源码仓库：

- [`wait.rs`](../../../codex/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs#L178)
- [`wait.rs`](../../../codex/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs#L189)

核心等待是：

```rust
timeout_at(deadline, activity_rx.changed()).await
```

`activity_rx` 是 Tokio watch receiver。它在 mailbox 或用户 steer 活动发生时被唤醒，timeout 只是等待边界，不是“每隔 N 秒查询一次所有子 agent 状态”。

因此可以使用一个较长的 `wait_agent` 作为同步屏障：worker 完成或发消息时会提前唤醒，不需要为了及时收信而把 timeout 切成 30 秒。

Codex 自己给模型的工具指导也明确要求：

- [`multi_agents_spec.rs`](../../../codex/codex-rs/core/src/tools/handlers/multi_agents_spec.rs#L735)：只在下一关键路径步骤立即依赖结果、确实被阻塞时使用。
- [`multi_agents_spec.rs`](../../../codex/codex-rs/core/src/tools/handlers/multi_agents_spec.rs#L738)：不要反射式地重复等待。

### 3.2 子 agent 完成结果会自动投递

Codex 在子 agent 完成时调用：

- [`session/mod.rs`](../../../codex/codex-rs/core/src/session/mod.rs#L1928)
- [`session/mod.rs`](../../../codex/codex-rs/core/src/session/mod.rs#L1938)
- [`session_prefix.rs`](../../../codex/codex-rs/core/src/session_prefix.rs#L27)

`forward_child_completion_to_parent()` 会把包含子 agent 最终输出的 completion message 送进父 agent mailbox；该消息使用 `trigger_turn=false`，含义是：

- 父 agent 正在执行其他工作时，不强制打断当前 turn；
- 父 agent 正在 `wait_agent` 时，mailbox 活动会唤醒等待；
- 父 agent 后续继续运行时可以消费该结果。

Codex 同时提供：

- `send_message`：向现有 agent 投递消息；
- `followup_task`：给已存在且空闲的 agent 新任务并触发 turn；
- `wait_agent`：在同步点等待 mailbox/steer 活动；
- 子 agent 最终结果的自动上行投递。

所以 Codex 并不是“不能像 Claude Code 一样传消息，只能轮询”。其 API 语义不同，但已经具备消息和恢复原语。

### 3.3 TUI 为什么总显示 “No agents completed yet”

当前 v2 wait 事件向 TUI 提供空的 `receiver_thread_ids` 和空的 `agents_states`：

- [`wait.rs`](../../../codex/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs#L85)
- [`wait.rs`](../../../codex/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs#L107)

TUI 对这两个空集合的固定渲染是：

- [`multi_agents.rs`](../../../codex/codex-rs/tui/src/multi_agents.rs#L392)：`Waiting for agents`
- [`multi_agents.rs`](../../../codex/codex-rs/tui/src/multi_agents.rs#L590)：`No agents completed yet`

另一方面，工具结果内部其实已经有：

```json
{ "message": "Wait completed.", "timed_out": false }
```

或：

```json
{ "message": "Wait timed out.", "timed_out": true }
```

问题是 TUI 没有把这个 outcome 显示出来。这是 Codex 的展示缺陷，但不是 mailbox 机制失效。

## 4. Rasen 为什么放大了等待

### 4.1 当前编排模型主要按 Claude LEAD 设计

当前 playbook 明确区分：

- Claude worker：使用 Task/subagent 和 `SendMessage`；
- Codex worker：由 LEAD 启动独立的 `codex exec` 进程，并记录 `threadId`。

参见：

- [`_orchestration.ts`](../../src/core/templates/workflows/_orchestration.ts#L42)
- [`_orchestration.ts`](../../src/core/templates/workflows/_orchestration.ts#L58)
- [`codex-workflow-integration.md`](../codex-workflow-integration.md#L1)

这个桥接方案适用于“Claude LEAD 显式选择 Codex worker”的跨 runtime 场景。但当 LEAD 本身已经运行在 Codex 中时，Codex 原生的 `spawn_agent`、`send_message`、`followup_task` 和 `wait_agent` 才是同宿主默认路径；再把默认 stage 当成外部 `codex exec`，会多造一层进程/thread 生命周期。

仓库自己的 E11 实验已经验证 Codex native multi-agent：

- [`E11-native-multi-agent-collaboration.md`](../codex-parity/experiments/E11-native-multi-agent-collaboration.md#L101)

该文档仍把 native multi-agent 定位成 `codex exec` 的补充，前提是“Rasen LEAD 是另一个 Claude 进程”。一旦 Rasen 直接运行在 Codex LEAD 中，这个前提就不成立，native adapter 应成为同宿主主路径。

### 4.2 完成协议对 Codex-native 重复

Rasen 的通用 leaf contract 要求 worker：

- 返回结构化 `DONE`/`HANDOFF`；
- 另外通过 `SendMessage` 把 `DONE` 送给 LEAD；
- 不依赖普通 final text，因为当前 playbook 假设 LEAD 可能观察不到它。

参见：

- [`_orchestration.ts`](../../src/core/templates/workflows/_orchestration.ts#L50)
- [`_orchestration.ts`](../../src/core/templates/workflows/_orchestration.ts#L310)
- [`_orchestration.ts`](../../src/core/templates/workflows/_orchestration.ts#L311)

这个假设对某些 Claude worker 生命周期有历史依据，但对 Codex-native 不成立：Codex 已经自动把 final output 作为 completion message 发给父 agent。Codex worker 再主动 `send_message(DONE)`，可能形成两次 mailbox 活动或重复结果。

建议把完成协议改成 runtime adapter 能力：

| 场景 | 完成通道 |
|---|---|
| Codex-native leaf | 以自动 completion/final 上行为唯一完成通道 |
| Codex-native 中间进度 | 必要时使用 `send_message` |
| Claude-native leaf | 保留当前经验证的 Task/`SendMessage` contract |
| 外部 `codex exec` | 以进程退出、JSONL 和 last-message 文件为完成通道 |

## 5. 宿主 runtime 自动选择：期望正确，当前未实现

### 5.1 必须区分两个概念

Rasen 应区分：

| 概念 | 含义 | 示例 |
|---|---|---|
| `hostRuntime` | 当前承载 LEAD 和工具调用的宿主 | 当前会话是 `codex` |
| `targetRuntime` | 某个 stage/role 显式或默认选择的 worker 后端 | 默认 `codex`；某个 review 可显式为 `claude` |

正确的默认解析应是：

```text
现有显式 runtime 配置层（保持当前优先级）
    ↓ 若没有显式值
检测到的 hostRuntime
    ↓ 若仍未知
明确的 unknown 策略（告警/询问/兼容 fallback）
```

换句话说：

```text
targetRuntime = explicitRuntime ?? hostRuntime
```

而不是当前的：

```text
targetRuntime = explicitRuntime ?? "claude"
```

“workflow 显式指定另一个 runtime”应继续拥有更高优先级；但这表示跨 runtime 派发，必须额外验证当前宿主是否有对应 bridge，不能只因为目标 runtime 名字存在就假定可执行。

### 5.2 当前 pipeline 仍固定 fallback 到 Claude

[`resolveStageRuntimeConfig()`](../../src/core/pipeline-registry/types.ts#L545) 的 runtime 解析最终 fallback 为 `claude`：

- stage/config-family override；
- stage `runtime`；
- role `agents.<role>.runtime`；
- **`claude`**。

关键位置：

- [`types.ts`](../../src/core/pipeline-registry/types.ts#L608)
- [`types.ts`](../../src/core/pipeline-registry/types.ts#L631)
- [`pipeline.ts`](../../src/commands/pipeline.ts#L1047)

在本次 Codex 会话内实际执行：

```powershell
node bin/rasen.js pipeline show small-feature --for-execution --json
```

得到：

| stage | runtime | runtimeSource |
|---|---|---|
| propose | claude | default |
| apply | claude | default |
| verify | claude | default |
| review-loop | claude | default |
| ship | claude | stage |
| archive | claude | stage |

这直接证明当前 pipeline 解析没有让默认 stage 继承 Codex 宿主。`ship` 和 `archive` 是 workflow 的显式 stage 配置，按用户提出的规则可以继续覆盖宿主默认；其他 `runtimeSource=default` 的 stage 不应在 Codex 宿主下自动变成 Claude。

### 5.3 已有宿主检测器没有接入 pipeline

Rasen 已有：

- [`detectAgentRuntime()`](../../src/core/keepalive/index.ts#L255)

当前优先级为：

```text
RASEN_AGENT_RUNTIME
  > CODEX_SANDBOX
  > CLAUDECODE
  > unknown
```

但它只在 [`agent.ts`](../../src/commands/agent.ts#L386) 中用于 `rasen agent wait` 的 keepalive runtime gate。没有证据表明它参与以下任一过程：

- pipeline 默认 runtime 解析；
- 当前 LEAD 宿主识别；
- Tier A/B/C 能力选择；
- native adapter 与 exec bridge 选择；
- pipeline execution preflight。

归档变更也明确记录过：runtime tier 目前由 LEAD 根据 playbook 自报，不存在 CLI 环境探测：

- [`proposal.md`](../../rasen/changes/archive/2026-07-18-fix-run-state-worker-handles/proposal.md#L31)
- [`orchestration-worker-lifecycle/spec.md`](../../rasen/changes/archive/2026-07-18-fix-run-state-worker-handles/specs/orchestration-worker-lifecycle/spec.md#L110)

这与公开 guide 中“capability tier auto-detected”的表述不一致：

- [`artifact-workflow-guide.md`](../artifact-workflow-guide.md#L42)
- [`artifact-workflow-guide.md`](../artifact-workflow-guide.md#L238)

应将其视为文档与实现漂移。

### 5.4 当前 Codex 环境会被现有检测器误判

本次 Codex shell 中的相关环境变量是：

```text
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
CODEX_THREAD_ID=019f9e97-616f-7780-8ae9-519cffb8b227
```

不存在：

```text
CODEX_SANDBOX
CLAUDECODE
```

直接用源码执行红测试：

```powershell
node --experimental-strip-types --input-type=module -e "
  import { detectAgentRuntime } from './src/core/keepalive/index.ts';
  const actual = detectAgentRuntime({ CODEX_THREAD_ID: 'thread-repro' });
  console.log({ expected: 'codex', actual });
  if (actual !== 'codex') process.exit(1);
"
```

实际结果：

```json
{"expected":"codex","actual":"unknown","passed":false}
```

`CODEX_SANDBOX` 只在特定 sandbox 路径中出现，不能作为所有 Codex 宿主的唯一指纹。Codex 源码明确保证：只要存在 thread id，即使 shell env 使用 include-only，仍会注入 `CODEX_THREAD_ID`：

- [`exec_env.rs`](../../../codex/codex-rs/core/src/exec_env.rs#L23)
- [`shell_environment.rs`](../../../codex/codex-rs/protocol/src/shell_environment.rs#L6)
- [`shell_environment.rs`](../../../codex/codex-rs/protocol/src/shell_environment.rs#L104)

建议检测优先级：

```text
显式测试/诊断 override（RASEN_AGENT_RUNTIME）
  > CODEX_THREAD_ID
  > CODEX_SANDBOX
  > CLAUDECODE
  > unknown
```

Codex 必须优先于 Claude 指纹，因为 Codex 可能从父 Claude 进程继承 `CLAUDECODE`。不能用 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 判断当前宿主是 Claude：Rasen 会把该配置写进项目设置，它可以出现在 Codex 进程环境中。

### 5.5 当前 preflight 只验证目标 Codex CLI

[`execution-validation.ts`](../../src/core/pipeline-registry/execution-validation.ts#L55) 只检查 pipeline 是否有 stage 解析成 `codex`；如果有，就探测 `codex` CLI 是否可用。没有 Codex stage 时，不做 runtime 可用性检查。

[`runtime-adapters.ts`](../../src/core/runtime-adapters.ts#L1) 也只有“某 target runtime 是否 `canDispatch`”这一维能力，没有：

```text
hostRuntime × targetRuntime × dispatchMode
```

所以当前 preflight 无法回答：

- Codex host 能否 native dispatch Codex worker？
- Codex host 能否 dispatch Claude worker？
- Claude host 是否应通过 `codex exec` dispatch Codex worker？
- 同宿主是否错误地绕到外部 exec bridge？

## 6. 建议的 runtime/adapter 解析模型

### 6.1 保留显式配置，只改变最终默认

不需要推翻现有 stage/role/config-family 优先级。只需要把最终 hard-coded `claude` 改为 host-aware default，并保留来源：

```text
stage override
  > explicit stage runtime
  > explicit role runtime
  > detected host runtime
  > unknown-host policy
```

建议新增来源值：

```text
runtimeSource: host
hostRuntime: claude | codex | unknown
dispatchMode: native | exec-bridge | unsupported
```

这样 `pipeline show --for-execution --json` 能明确展示“为什么选了这个 runtime”，而不是把宿主继承混成普通 `default`。

### 6.2 使用 host × target 派发表

建议的最小派发表：

| hostRuntime | targetRuntime | 默认 dispatchMode | 当前实现状态 |
|---|---|---|---|
| claude | claude | Claude native Task/subagent | 已有 |
| claude | codex | `codex exec` bridge | 已有 |
| codex | codex | Codex native collaboration tools | Codex 已有能力，Rasen 未正式接入 |
| codex | claude | Claude bridge | 当前未证明；没有 adapter 时应 preflight 失败 |

这满足两个目标：

1. 未显式指定 runtime 时，Rasen 自然使用当前宿主最原生、最低摩擦的 worker 机制。
2. workflow 显式选择不同 runtime 时仍然生效，但只有对应跨 runtime adapter 确实可用才执行。

### 6.3 capability tier 应来自宿主 adapter

当前 Tier A/B/C 主要由 prompt 让 LEAD 自行判断。建议改为：

```text
detectHostRuntime()
  → resolveHostAdapter()
  → capabilities {
      canSpawn,
      canSendMessage,
      canFollowup,
      canWaitForMailbox,
      autoForwardsFinal,
      canResumeCompleted,
      canCrossRuntimeDispatch
    }
```

playbook 只消费已解析能力，不再自己猜测宿主。Claude 和 Codex 的能力并不完全同构，不能只用一个“是否有 SendMessage”布尔值表达。

## 7. 建议的等待策略

### Rasen

1. **把 `wait_agent` 当作 join，不当作 heartbeat。** 只有下一关键路径确实依赖 worker 结果时才 wait。
2. **一次较长的事件等待替代反复 30/60 秒等待。** mailbox 活动会提前唤醒；长 timeout 不会延迟结果接收。
3. **有其他安全工作可做时不 wait。** 例如整理 run-state、检查已落盘 artifact、准备不依赖 worker 结果的下一 dispatch。
4. **Codex-native leaf 不再强制额外 `send_message(DONE)`。** 使用自动 completion；`send_message` 只承担中间进度或 LEAD 主动追问。
5. **在 run-state 中记录逻辑 join，而不是每次 timeout。** UI/日志应呈现“正在等待 apply worker，共等待 12m”，避免显示几十个等价回合。

### Codex

1. TUI 显示真实 outcome：`mailbox activity`、`timed out`、`steered`。
2. v2 wait start/end 事件携带目标或 activity 摘要，避免空 `receiver_thread_ids` / `agents_states` 触发误导性文案。
3. 若 wait 因 mailbox 唤醒但没有 agent final，应显示“收到消息，agent 尚未结束”，而不是“No agents completed yet”。

## 8. 建议回归测试

### 宿主检测

- `CODEX_THREAD_ID` 单独存在时返回 `codex`。
- `CODEX_THREAD_ID` 与继承的 `CLAUDECODE` 同时存在时仍返回 `codex`。
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 单独存在时不判定为 Claude。
- `CLAUDECODE` 单独存在时返回 `claude`。
- 无稳定指纹时返回 `unknown`，并走明确告警/兼容策略。

### runtime 解析

- Codex host + 无显式 runtime → `targetRuntime=codex`、`runtimeSource=host`、`dispatchMode=native`。
- Claude host + 无显式 runtime → `targetRuntime=claude`、`runtimeSource=host`、`dispatchMode=native`。
- Codex host + workflow 显式 `runtime: claude` → 保留 Claude target；无 bridge 时 preflight 明确失败。
- Claude host + workflow 显式 `runtime: codex` → `dispatchMode=exec-bridge`，并探测 Codex CLI。
- 现有 stage/role/config-family override precedence 不回归。

### 等待与完成

- 一个 Codex-native child 完成只生成一个可消费的 stage completion。
- 中间 `send_message` 唤醒 wait，但不被误判为 child final。
- 单次长 wait 在 child 完成时提前返回。
- timeout 与 mailbox wake 在 TUI/结构化日志中可区分。

## 9. 最终判定

用户提出的行为应当成为 Rasen 的正式规则：

> Rasen 自动识别当前工具宿主，并把它作为未显式指定 runtime 的默认 worker runtime；workflow、stage、role 或命令显式指定的不同 runtime 继续覆盖该默认值，但跨 runtime 执行必须由已验证的 adapter 支持。

当前代码不满足这条规则：

- pipeline 默认仍固定为 Claude；
- 已有宿主检测只用于 keepalive；
- 检测器遗漏 `CODEX_THREAD_ID`；
- capability tier 仍主要由 LEAD 自报；
- preflight 没有 host × target 维度；
- Codex-native 完成投递没有被 Rasen completion contract 利用。

因此，大量 `Waiting for agents` 的首要修复方向应在 Rasen：补齐宿主感知的 runtime/adapter 解析，并将 Codex-native 等待收敛为少量真正的同步屏障。Codex 侧需要修复的是 TUI 的等待结果展示，而不是重写整个 subagent 消息机制。

## 10. 已实施的修复（2026-07-26）

本次变更 `fix-host-aware-runtime-dispatch` 已把上述结论落到运行时与生成的编排指引中：

- 新增共享结构化宿主检测器，优先级为有效 `RASEN_AGENT_RUNTIME` > `CODEX_THREAD_ID` > `CODEX_SANDBOX` > `CLAUDECODE` > `unknown`；keepalive 复用同一检测器。
- runtime 改为字段级解析。只有显式 `runtime` 才能覆盖宿主；仅配置 `model`、`sandbox`、`effort` 或 `sessionReuse` 不再暗中生成 Claude runtime。
- `pipeline show --for-execution --json` 和 `pipeline agents --json` 输出宿主来源、runtime 来源与 `dispatchMode`；CLI、阈值绑定和执行预检消费同一套宿主感知解析输入。
- 执行预检按 host × target 路由检查：Codex native 不探测外部 CLI，Claude → Codex 的 exec-bridge 最多探测一次，Codex → Claude 在没有 adapter 时以稳定错误码拒绝，unknown 宿主保留旧兼容行为并提示 `RASEN_AGENT_RUNTIME`。
- Codex-native 编排使用 `spawn_agent` / `followup_task`，worker final 自动作为唯一的 `DONE` / `HANDOFF` 完成投递；`send_message` 只用于中间协调。
- `wait_agent` 只在真正的依赖屏障使用；优先一次较长、事件驱动的等待，禁止机械重复 30/60 秒短轮询。
- run-state 可选记录规范化的 `dispatchMode`。原生 Codex 只记录工具实际返回的 agent handle；只有 exec-bridge 记录 `threadId`，且绝不伪造 `turnId`。旧记录保持可读。

验证命令包括：

```text
pnpm exec vitest run test/core/runtime-adapters.test.ts test/core/keepalive.test.ts
pnpm exec vitest run test/core/pipeline-registry/pipeline.test.ts test/core/pipeline-registry/stage-overrides.test.ts
pnpm exec vitest run test/core/pipeline-registry/execution-validation.test.ts
pnpm exec vitest run test/core/pipeline-registry/run-state.test.ts
pnpm exec vitest run test/core/templates/orchestration-bundles.test.ts
pnpm exec tsc --noEmit
pnpm run build
```

### 有意延后的 Codex TUI 问题

本变更修复 Rasen 的错误等待策略和宿主路由，但不修改上游 Codex TUI。`wait_agent` 因 mailbox 活动、超时或 steer 返回时，TUI 仍可能统一显示 `No agents completed yet`，这是展示层对 wait outcome 的信息丢失。它不会阻止消息传递或 final 自动回传；后续 Codex 侧应分别呈现 `mailbox activity`、`timed out` 与 `steered`，并在收到中间消息但 agent 尚未完成时使用准确文案。
