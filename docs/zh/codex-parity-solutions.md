# Codex 对等能力最终方案（Codex Parity Solutions）

> 本文是 `codex-parity-research` 调研运行的最终方案综合稿，面向中文母语开发者，可直接照做实现。
> 英文原始档案（含全部实验日志）位于 `docs/codex-parity/`（`README.md` 索引 + `solutions/01–14` + `experiments/E01–E13`）。

## 目的与方法

**目的**：rasen 的编排体系（LEAD 派发角色隔离的 worker、并行分组、暖续、context 占用探针、结构化返回、门禁与运行态记录等）目前依赖一系列 Claude Code 专属机制。本文给出把这套编排落到 **Codex runtime** 上的完整对等方案——每一项 Claude 专属能力，都对应一个 Codex 侧的原生机制、变通方案或模拟（emulation）设计。

**方法一句话**：全部结论来自实机试验（live experiments），版本钉死在 **codex-cli 0.144.1**；无法实测的项给出明确的 `code-analysis-only` 判定与理由。本轮为调研轮，**不改动 rasen 源码**——本文是后续开发的施工蓝图。

**状态标签含义**：
- **live-verified**：实机跑通，有真实命令与捕获输出为证；
- **needs-emulation**：Codex 无原生对应（实测为阴性结果），已给出模拟设计;
- **code-analysis-only**：仅基于 CLI help/代码面分析，未实测（附不实测的理由）。

## 总览表（14 项）

| # | 能力 | Codex 方案一句话 | 状态 | 证据实验 |
|---|---|---|---|---|
| 1 | 子代理派发、角色隔离、平铺层级 | 每 worker 一个 `codex exec` 子进程（天然线程隔离）；Codex 原生多 agent 默认层级式，须用提示词守卫压平 | live-verified | E01, E11, E02 |
| 2 | 并行派发（`parallelGroup`） | N 个 `codex exec` 子进程 OS 级并发，各自独立 thread，无争用 | live-verified | E08 |
| 3 | 暖续 / SendMessage（Tier A） | `codex exec resume <thread-id>` 跨进程重建同一 thread，完整保留先前上下文 | live-verified | E02, E11 |
| 4 | 基建死亡后的会话内复活 / DONE 未勾任务催办 | `kill -9` 后 `resume` 照常工作，已落盘轮次全部幸存 | live-verified | E02 |
| 5 | transcript 占用探针 | rollout JSONL 的 `token_count` 事件自带 `model_context_window`，比 Claude 更简单 | live-verified | E03, E07 |
| 6 | 跨会话恢复（transcript 暖种子） | thread id 定位 rollout 文件 + `resume`，或结构化读取事件日志重建对话 | live-verified | E02, E01, E03 |
| 7 | worker 内的 skill / 斜杠命令调用 | `prompts/*.md` 在两个调用面均被拒（双阴性实测）→ 客户端内联模板是唯一路径 | needs-emulation | E06, E13 |
| 8 | 结构化 worker 返回（DONE/HANDOFF；evaluate 门禁 JSON） | `--output-schema` 强制最终消息为严格 JSON，优于 prose 标记解析 | live-verified | E10 |
| 9 | 按次派发的 model / reasoning-effort 覆盖 | `-m <model>` + `-c model_reasoning_effort="<v>"`；`model/list` 实测枚举 7 个模型 | live-verified | E05, E01, E07 Step 3 |
| 10 | 按角色的沙箱 / 权限模式 | `-s read-only|workspace-write|danger-full-access`，read-only 为 OS 层硬拦截 | live-verified | E04 |
| 11 | 项目上下文注入（CLAUDE.md 对应物） | AGENTS.md 根+嵌套合并注入；按变更上下文改走"提示词引用文件路径"（已实测非幻觉） | live-verified | E09, E12 |
| 12 | 程序化桥接：`codex app-server` JSON-RPC / MCP 模式 | stdio 换行分隔 JSON-RPC，完整 thread/turn 生命周期 + 推送事件 + 审批回调 | live-verified | E07 |
| 13 | 会话接力（Step H.7） | Claude 专属机制，Codex worker 不受影响；若架构反转有 `codex resume` / `codex fork` 候选 | code-analysis-only | — |
| 14 | 运行态与门禁（身份字段、可恢复性） | `thread_id` 为核心身份句柄；turn 粒度须走 app-server；429 可重试 / 404 不可重试分类 | live-verified | E01, E02, E03, E07 |

---

## 逐项方案

### 1. 子代理派发、角色隔离、平铺层级

**rasen 里的作用**：LEAD 通过 Task 工具派发角色隔离的 subagent worker（planner / implementer / reviewer 等），每个 worker 有独立上下文和角色提示词，且强制平铺——worker 不得再派发子 worker。

**Codex 对应机制**——获得一个 Codex "worker" 有两条截然不同的路：

**A. 进程级（LEAD 驱动，与 rasen 的 Task 工具模型最贴合）**。LEAD（Claude 进程）为每个 worker 启动一个 `codex exec` 子进程，携带角色提示词、沙箱模式和 model/effort 覆盖（见第 9、10 节）。每次 `codex exec` 调用都获得一个**全新 thread**（除非显式传 `resume`），有自己的 rollout 文件和 developer-message 脚手架——两次 `codex exec` 之间不存在任何交叉污染，角色隔离天然成立。

**B. 线程内原生（Codex 自带的多 agent 系统）**。E11 实测证明：单个 Codex thread 可以调用 `spawn_agent(task_name, message, fork_turns)` fork 出一个**子 thread**（子线程 `session_meta` 中带 `forked_from_id` / `parent_thread_id`），再用 `wait_agent(timeout_ms)` 阻塞等待结果。这套系统由 feature flag `multi_agent` 控制，**0.144.1 默认开启**，且**默认是递归层级式的**（`agent_path` 形如 `/root/pong`，子代理可以再生孙代理）——这与 rasen 的平铺不变式直接冲突。

**平铺层级如何强制**：Codex 每个 thread 默认带 `<multi_agent_mode>explicitRequestOnly</multi_agent_mode>` 守卫（E01/E11 实测确认），它只抑制*主动*的 `spawn_agent` 调用——所以不提及委派的叶子 worker 提示词不会自行触发多 agent 工具。但本轮**没有找到任何 `-c` / CLI flag 能在代码层硬禁用** `spawn_agent`/`wait_agent`/`send_message`，唯一实测有效的手段是提示词级抑制。**建议**：rasen 派发的每个 Codex 叶子 worker 提示词必须附带显式否定指令，等价于：

> "You are a leaf worker. Do not use spawn_agent, followup_task, or any sub-agent delegation tool under any circumstances."

这与 Claude Task-tool worker 现有的信任模型相同（靠模型遵守指令，而非代码硬拦）。

**恢复/身份句柄**：进程级——`thread.started` 事件（JSONL）里的 `thread_id`，或 plain 输出的 `session id:` 行（E01）。线程内原生——父线程 rollout 中 `sub_agent_activity` 事件的 `agent_thread_id` 字段（E11）。

**结构化输出**：见第 8 节（`--output-schema`）。

**已观测失败模式**：
- worker 提示词若含"delegate"/"parallel"之类措辞，即便是叶子角色也可能意外触发 `spawn_agent`——需审计派发提示词中的意外委派语言；
- 本轮无实测手段在 config/CLI 层硬禁用该工具族，仅验证了提示词级抑制。

### 2. 并行派发（`parallelGroup`）

**rasen 里的作用**：LEAD 同时派发多个互不依赖的 worker 并发执行。

**Codex 对应机制**：LEAD 并发启动 N 个独立的 `codex exec` 子进程（标准 OS 级并发——后台运行各进程，`wait` 全部）。E08 实测：2 个 `codex exec` 同时跑在同一个一次性 git 仓库上，各自在 `-s workspace-write` 下写入不同文件——双双干净完成、文件正确落盘、无锁错误、无串扰。每个并发进程自动获得独立 thread id 和 rollout 文件（默认每次调用新建 thread），只要 LEAD 不从两个进程同时 `resume` 同一个 thread id（未测试，推定不安全——**一个 thread id 按单写者对待**），就不存在共享 thread 竞争。

**锁与争用注意**：`~/.codex` 全局状态（logs/state/goals/memories 的 sqlite 库、`session_index.jsonl`、`history.jsonl`）会被每个并发进程写入；N=2 时两进程 stderr 均未见 `SQLITE_BUSY` 类错误。更高 N 与同文件写竞争（两个 worker 并发改同一源文件）未压测——若 rasen 的 `parallelGroup` 里 Codex worker 写集可能重叠，需后续跟进。

**恢复/身份句柄、结构化输出**：同第 1 节——每路并行派发就是一个独立 `codex exec` 进程，各有 thread id；捕获用 `--output-schema`（第 8 节）。

**已观测失败模式**：N=2 无。限流（429，见 E02）是本环境代理下*任何*并发或串行调用共有的失败模式，突发负载下更易出现——生产派发器应对含 `429` 的 `turn.failed` 消息实现 backoff 重试。

### 3. 暖续 / SendMessage（Tier A）

**rasen 里的作用**：Tier A 的 SendMessage 暖续——LEAD 给已有上下文的 worker 发新消息（增量复审、goal-loop 暖复用 implementer、planner 复用），而不是冷启新 agent。

**Codex 对应机制（进程级，建设基础）**：

```
codex exec resume <thread-id> --json -o <out-file> "<new message>"
# 或：codex exec resume --last --json -o <out-file> "<new message>"
```

`resume` 用一条全新用户消息重新接入既有 thread，模型**完整保留先前轮次上下文**——E02 实测：第 1 轮教给它一个事实（`ZEBRA-19`），从完全独立的进程、甚至不同 `cwd` 发起 `resume`，都正确回忆。与 Claude 的区别只在机制：不是给*仍存活*的 agent 进程发消息，而是每轮结束后终止 `codex exec` 进程，需要再接入时凭 id **重建**同一 thread。对 rasen 而言功能等价——rasen 自己的暖续模式本来就是"发消息然后等结果"，不是持久双向通道。

**线程内原生（本轮仅代码面分析）**：E11 发现 Codex 原生带 `followup_task`（"给既有 agent 一个新任务并触发一轮"）和 `send_message`（"给运行中 agent 传消息但不触发轮次"），与实测通过的 `spawn_agent`/`wait_agent` 同属一个工具族。本轮**未实测**（预算原因）——待办：父线程 `spawn_agent` 出子线程后，在 `wait_agent` 之前 `send_message`，验证子线程下一轮反映注入消息（这能证明真正的运行中双向消息，`resume` 机制做不到——`resume` 必须等上一轮完全结束）。

**恢复/身份句柄**：`thread_id`（来自 `thread.started` / `session id:`，E01）是唯一需要的句柄；`resume` 接受它或 `--last`。

**结构化输出**：与任何派发相同的 `--output-schema` 机制（第 8 节），在 `resume` 调用上同样生效。

**已观测失败模式**：E02 中一次 `resume` 调用瞬时 `429 Too Many Requests`（与 resume 正确性无关，是 provider 限流，约 20 秒后重试成功）。本轮未发现任何 resume 上下文/历史丢失的证据，包括 `kill -9` 轮次中途击杀之后（见第 4 节）。

### 4. 基建死亡后的会话内复活（Step H.4a(b)）与 DONE 未勾任务催办（H.4b）

**rasen 里的作用**：worker 因基建故障死掉后，LEAD 在同一会话内复活它；或 worker 报 DONE 但任务未勾完时催办。

**Codex 对应机制**：`codex exec resume <thread-id>` 在硬杀（`kill -9`）轮次中途之后照常工作，**所有已落盘轮次全部幸存**。E02 的测法：先教一个事实（`PANTHER-7`），再触发 `sleep 30` shell 命令以便在命令执行中途 `kill -9`（无优雅关闭），然后 resume——模型正确回忆起击杀前轮次的 `PANTHER-7`。原理：Codex 在轮次进行中就把每个 `response_item` 逐条追加进 rollout JSONL（E02 的部分捕获显示击杀前已有 `thread.started`/`turn.started`，而被杀轮次的 `turn.completed` 永远没出现）——所以只丢**在途未提交轮次的最终回答**；此前每个已提交轮次、以及发起被杀轮次的那条用户消息（模型开始响应前就已追加）都完好。

**对 H.4a(b)/H.4b 的实操含义**：LEAD 复活基建死亡的 Codex worker 在概念上与 Claude 相同（重新接入并发消息），机制不同——不是"SendMessage 给仍存活的进程"，而是"启动全新的 `codex exec resume <thread-id>` 进程"。**死亡检测信号**：该 thread rollout JSONL 的最后一段中，`turn.started` 之后没有对应的 `turn.completed`/`turn.failed`（等价于 Claude 的 transcript 检测）。然后发 `resume`：(a) 催办消息（"continue where you left off" / "you were interrupted, please finish and report DONE/HANDOFF"），对应 H.4b 的未勾任务催办模式；或 (b) 全新指令，若 LEAD 想改道而非续做。

**恢复/身份句柄**：同一 thread id（第 3 节）。app-server 驱动的 LEAD 检测死亡：进程/连接死亡且无 `turn/completed` 通知（E07）。

**结构化输出**：复活的 `resume` 调用仍可用 `--output-schema` 要求 schema 合规的 DONE/HANDOFF 输出。

**已观测失败模式**：只丢在途轮次未提交内容；击杀时执行中的命令（E02 里是 `sleep 30`）永不完成、其输出在恢复后的上下文中缺失——LEAD 的复活提示词应声明"最后一个动作可能没做完"（例如让 worker 重新核实文件状态，而不是相信击杀前轮次对命令结果的说法）。

### 5. transcript 占用探针（`rasen agent context --transcript`）

**rasen 里的作用**：探测 worker 上下文占用比例，驱动 handoff（0.5）/ 复用（0.25）/ research relay（0.35）阈值决策。

**Codex 对应机制**——**比 Claude 严格更简单**。每个 rollout JSONL（`~/.codex/sessions/<Y>/<M>/<D>/rollout-<ts>-<thread_id>.jsonl`）都含 `payload.type == "token_count"` 的 `event_msg` 行：

```json
{"type":"event_msg","payload":{"type":"token_count","info":{
  "total_token_usage":{"input_tokens":8053,"cached_input_tokens":7680,"output_tokens":6,
    "reasoning_output_tokens":0,"total_tokens":8059},
  "last_token_usage":{...同形，仅本轮...},
  "model_context_window":353400
}}}
```

**精确配方**：打开 rollout 文件，找*最后一条* `payload.type=="token_count"` 行，计算 `pct = payload.info.total_token_usage.total_tokens / payload.info.model_context_window`。Claude 侧的 `agent-context.ts` 要从最后一条 `message.usage` 求和 `input + cache_read + cache_creation`，还得另查模型→窗口对照表；**Codex 把 context window 内联在同一事件里**，完全不需要外部查表。`task_started` 事件也独立携带 `model_context_window`，可作冗余交叉核验。

app-server 驱动的 LEAD（第 12 节）零轮询即得同样数据——推送通知 `thread/tokenUsage/updated`：`{threadId, turnId, tokenUsage: {total: {...}, last: {...}, modelContextWindow}}`（E07，字段名 camelCase，形状相同）。

**阈值族**：rasen 现有阈值（handoff 0.5、复用 0.25、research relay 0.35）直接迁移——算同样的 `pct` 套同样的截断值；`model_context_window` 是精确值而非估计（`gpt-5.6-sol` 在本档案所有实验中恒为 353400），无需 Codex 侧重新校准。

**恢复/身份句柄**：用 thread id 定位 rollout 文件（glob `~/.codex/sessions/**/*<thread_id>*.jsonl`，或直接读 app-server `thread/start`/`thread/resume` 响应的 `path` 字段——E07 确认该字段有值）。

**已观测失败模式**：无——这是 provider 直发的信号，比 Claude 的客户端计算更可靠。一个注意点：`token_count` 事件只保证在至少一个完成轮次之后出现；零完成轮次的 thread（例如任何 `turn.completed` 之前被杀，见第 4 节）还没有 `token_count` 行——**把"找不到 token_count 事件"当作"占用 0%"处理，不是错误**。

### 6. 跨会话恢复（transcript 暖种子，Step F.1）

**rasen 里的作用**：Step F.1 的 glob-and-reseed 模式——重启后定位前任 worker 的 transcript（`agent-<agentId>.jsonl` + `.meta.json` sidecar），读回发现，播种新 worker。

**Codex 对应机制**：

1. **重启后定位会话文件**：`grep -rl "<thread_id>" ~/.codex/sessions/**/*.jsonl`；更直接的是确定性路径 `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO-ts>-<thread_id>.jsonl`——建议 LEAD 在记录 thread id 时连创建时间戳一起记，免去全树 grep。
2. **跨进程/会话边界的 `codex exec resume <id>`**：E02 实测——从与原 thread 不同的 cwd、全新进程发起 resume，正确回忆先前轮次事实。身份完全基于 thread id，与任何进程或终端状态无关。
3. **提取"前任已确立的内容"**：与 Claude 的纯 prose transcript 不同，Codex rollout 是结构化事件日志（E03）——暖种子读取器应过滤 `role in {user, assistant}` 的 `response_item` 行（跳过每个 thread 顶部固定的 `developer` 角色系统脚手架）重建人类可读对话，并取 `payload.type in {task_complete, agent_message}` 的 `event_msg` 行作为每轮"最终答案"的简明信号——比回放所有 `item.*` delta 事件便宜。

**恢复/身份句柄**：thread id，同第 3/4 节。

**结构化输出**：若前任最后一轮用了 `--output-schema`（第 8 节），暖种子读取器可直接把最后一条 `agent_message` 的文本按严格 JSON 解析，无需 prose 解析。

**已观测失败模式**：除第 3/4 节已述（瞬时 429）外无跨会话特有问题。本轮未测的缺口：rollout 文件被移动/归档后的 resume（`codex archive`/`codex delete` 子命令存在于 `codex --help`，未演练）——生产 reseed 流程应在按 id 直接 resume 失败时检查 `archived_sessions/` 回退路径（本机确实存在历史归档，例如 `~/.codex/archived_sessions/rollout-2026-02-13T21-04-30-....jsonl`）。

### 7. worker 内的 skill / 斜杠命令调用

**状态：needs-emulation**——两个调用面**双双实测阴性**：`codex exec` 非交互模式与交互式 TUI 均拒绝 `$CODEX_HOME/prompts/*.md` 自定义 prompt。这不是任一方向上的假设，两面都实机驱动过。

**rasen 里的作用**：worker 通过斜杠命令调用 rasen 生成的 skill/prompt 模板。rasen 现有适配器 `src/core/command-generation/adapters/codex.ts` 已经往 `<CODEX_HOME>/prompts/rasen-<id>.md` 写带 `description`/`argument-hint` frontmatter 的文件——frontmatter 形状与 Codex 文档一致（已核对适配器源码并用手写测试 prompt 交叉验证）。

**双阴性实测**：
- **阴性 1（`codex exec`，E06）**：`codex exec "/parity-test world"` **不**展开 prompt 文件——模型把 `/name args` 当字面聊天文本处理（对话式回复了 "Hello, world!"，而非模板化的 `CUSTOM_PROMPT_OK for world`）。rollout 中没有任何触碰 prompt 文件的 file-read 工具调用。
- **阴性 2（交互式 TUI，E13，round 2）**：用脚本化伪终端（Python `pty`/`fcntl.ioctl(TIOCSWINSZ)` + `pyte` 精确渲染终端）非交互地驱动真实 `codex` TUI，对着与 E06 相同的临时 `CODEX_HOME`。键入裸 `/` 呼出命令面板——只列出 8 个固定内置命令（`/model`、`/fast`、`/ide`、`/permissions`、`/keymap`、`/vim`、`/experimental`、`/approve`），**`parity-test` 缺席**。键入 `/parity-test` 无任何自动补全匹配。提交 `/parity-test world` 得到引擎级明确拒绝：

  ```
  • Unrecognized command '/parity-test'. Type "/" for a list of supported commands.
  ```

**解读——不只是 exec 模式的缺口，整个 `prompts/` 前提都存疑**。Round 1 的框架是"TUI 可用、exec 模式需内联模板变通"；round 2 的 TUI 实测推翻了它：**0.144.1 上两个调用面都不把 `$CODEX_HOME/prompts/*.md` 识别为自定义命令源**（至少在 rasen 当前写的朴素 frontmatter 格式下）。两个不互斥的可能性（本轮均未追，留给 round 3）：(1) 该功能在此版本确实不存在/被改名迁移，或需要额外注册步骤（如 config.toml 条目，而不只是丢文件）；(2) 0.144.1 真正的"可复用命名指令集"扩展面是 **skills/SKILL.md** 系统——`codex doctor` 的启用 feature flags 含 `skills`、`skill_mcp_dependency_install`、`plugins`；E01 基线 rollout 里有真实的 `<skills_instructions>` 系统提示块，枚举了真实 skill（如 `imagegen`）及 `file` 来源定位符。

无论哪个成立，对 rasen 的实操结论不变：**不要依赖 Codex 在派发时从 `$CODEX_HOME/prompts` 解析任何东西——在客户端内联内容。**

**模拟设计（必需——这是双重确认的真实缺口，不是配置疏漏）**。rasen 的实际用例是非交互派发（LEAD 走 `codex exec`/`resume`，从不用交互 TUI），适配器需要一个**本地模板展开步骤**，永不依赖 Codex 自己解析 `/name`：

1. 读 rasen 已生成的 `.md` 文件（可以继续同时写到 `$CODEX_HOME/prompts/rasen-<id>.md` 供前向兼容和人工在 rasen 仓库里直接跑交互 `codex` 用，但鉴于上述 TUI 阴性结果，自动化用途上把这份写入当作惰性/未验证）。
2. 剥掉 YAML frontmatter，按 `argument-hint` 声明的参数做简单的位置/`$ARGUMENTS` 式替换（对齐 Claude Code 自己的 skill 调用约定），把展开后的正文直接拼进 `codex exec` 的提示词字符串。
3. 于是每次 Codex worker 派发都是**一个自包含的单一提示词字符串**，skill 正文已内联——运行时对 Codex 读 `$CODEX_HOME/prompts` 零依赖，交互与否都一样。

**已观测失败模式**：跳过模拟步骤、把字面 `/name args` 经 `codex exec` 发出去时，模型**静默**地把它当会话文本、幻觉出貌似合理实则错误的回复（E06）——静默失败。交互 TUI 的失败是响亮的（`Unrecognized command`，E13），但 rasen 从不程序化驱动 TUI，所以操作上要害的是 `codex exec` 的静默失败——**派发器必须无条件自己做模板展开**，不能当可选优化。

### 8. 结构化 worker 返回（DONE/HANDOFF 契约；evaluate 门禁 `{satisfied, gaps}` JSON）

**rasen 里的作用**：worker 完成时按 DONE/HANDOFF 契约返回；evaluate 门禁 reviewer 返回 `{satisfied, gaps}` 判定。Claude 侧目前是 prose 里嵌标记、正则解析。

**Codex 对应机制**：`codex exec --output-schema <schema-file>` 接受标准 JSON Schema 文件，强制 agent 的最终 `agent_message` 是严格 schema 合规的 JSON（无 prose 包装、无 markdown 围栏）。E10 用 `{status: "DONE"|"HANDOFF", gaps: string[]}` 形状实测——`required`、`enum`、`additionalProperties: false` 全部精确遵守：最终消息就是 `{"gaps":["missing tests","no docs"],"status":"HANDOFF"}`，别无其他。`-o <file>`（`--output-last-message`）把这个字符串原样写入文件供调用方读取解析。

**这严格优于 Claude Code 当前约定**（prose 中的 DONE/HANDOFF 标记 + 正则解析）——每个角色族定义一次契约 schema（叶子 worker DONE/HANDOFF 一个、evaluate 门禁 `{satisfied: boolean, gaps: string[]}` 一个），每次该角色的 Codex 派发都传 `--output-schema`；解析变成 `json.loads(open(output_file).read())`，不再需要任何 prose 启发式。

**推荐契约 schema**：

```json
// 叶子 worker DONE/HANDOFF
{"type":"object","required":["status"],"properties":{
  "status":{"type":"string","enum":["DONE","HANDOFF"]},
  "summary":{"type":"string"},
  "handoffReason":{"type":"string"}
}, "additionalProperties": false}

// evaluate 门禁
{"type":"object","required":["satisfied","gaps"],"properties":{
  "satisfied":{"type":"boolean"},
  "gaps":{"type":"array","items":{"type":"string"}}
}, "additionalProperties": false}
```

**恢复/身份句柄**：thread id 同任何派发（第 3 节）；`--output-schema` 与 `resume` 调用可组合（未单独重测，但它是最终响应整形约束，与 thread 连续性正交，无理由怀疑）。

**已观测失败模式**：E10 单次测试中无。本轮未测：模型的自然回答确实无法满足 schema 时（比如要求 `enum: ["DONE","HANDOFF"]` 但实际状态含糊）Codex 是内部重试、报错还是优雅降级——待查。**建议 schema 里始终留一个逃生舱字段**（如自由文本的 `summary`），让模型有地方放细微差别而不破坏严格 schema 合规。

### 9. 按次派发的 model / reasoning-effort 覆盖

**rasen 里的作用**：按角色分配模型与推理强度（现行：仅 planner/propose 用高档模型，其余角色低档）。

**Codex 对应机制**——两个 flag，均可在 `codex exec` 上按次调用：
- `-m <model-id>`——如 `-m gpt-5.6-sol`。真实存在但本地无元数据的 model id 产生软警告（`item.type=="error"`，"Model metadata ... not found, defaulting to fallback metadata"）但可能仍成功；确实不供货的 model id 产生硬 `turn.failed`（`404 Not Found: model <id> is not available for /codex prefix`，E05）——退出码 1。
- `-c model_reasoning_effort="<value>"`——TOML 引号字符串，如 `"low"`、`"xhigh"`。0.144.1 实测语法（本档案基线调用全程使用），也验证了现有 `/codex` skill 的已知可用模式（`src/core/templates/experts/codex.ts`）。
- 另有 `-p/--profile <name>`（叠加 `$CODEX_HOME/<name>.config.toml`），适合整角色/整 profile 而非逐调用 flag——本轮未实测，`codex exec --help` 文档确认与 `-c` 同样的覆盖优先级。

**本 auth 下可用模型（round 2 经 `model/list` 实测枚举，E07 Step 3）**——共 7 个：

| id | 显示名 | 默认 effort | 最高 effort | 备注 |
|---|---|---|---|---|
| `gpt-5.6-sol` | GPT-5.6-Sol | low | ultra | **默认**（`isDefault:true`，与 `config.toml` 的 `model = "gpt-5.6-sol"` 一致）；"Latest frontier agentic coding model" |
| `gpt-5.6-terra` | GPT-5.6-Terra | medium | ultra | "Balanced agentic coding model for everyday work" |
| `gpt-5.6-luna` | GPT-5.6-Luna | medium | max | "Fast and affordable agentic coding model" |
| `gpt-5.5` | GPT-5.5 | medium | xhigh | "Frontier model for complex coding, research, and real-world work"；支持 personality |
| `gpt-5.4` | GPT-5.4 | medium | xhigh | "Strong model for everyday coding"；支持 personality |
| `gpt-5.4-mini` | GPT-5.4-Mini | medium | xhigh | "Small, fast, and cost-efficient model for simpler coding tasks"；支持 personality |
| `gpt-5.2` | GPT-5.2 | medium | xhigh | "Optimized for professional work and long-running agents" |

7 个模型都接受 `low`/`medium`/`high`/`xhigh`；`gpt-5.6-sol`/`gpt-5.6-terra` 额外接受 `max` 和 `ultra`；`gpt-5.6-luna` 额外接受 `max`。

**与第 1 节平铺守卫的重要交互**：后端自己把 `ultra` reasoning effort 文档化为 *"Maximum reasoning with automatic task delegation"*——即 `ultra` 强度下模型被显式授权调用原生多 agent 工具（E11），哪怕提示词里没有任何委派请求。**必须保持平铺的 rasen 叶子 worker 派发不得使用 `-c model_reasoning_effort="ultra"`——叶子 worker 的 effort 封顶 `xhigh` 或更低。**

**对 rasen 按角色模型分配的建议**：把现有的角色-模型表（fable vs sonnet 的类比）映射为每次 `codex exec` 派发追加的 `-m`/`-c model_reasoning_effort` flag。既然真实 id 已知，候选映射：`gpt-5.6-luna` 或 `gpt-5.4-mini` 作"快/便宜"档（两者官方措辞就是 fast/affordable/cost-efficient），`gpt-5.6-sol` 作"高能力"档（frontier 模型，也是本 auth 的配置默认）。

**恢复/身份句柄、结构化输出**：不受影响——这些 flag 与 `resume`、`--output-schema` 的组合方式与任何其他派发 flag 相同。

**已观测失败模式**：确实不供货的 model id 硬 404（快速失败，同 id 不要重试）；真实但本地无列表的 model id 软 metadata-not-found 警告（可能仍成功——按非致命处理）。两种失败模式都是在*可用的*代理 provider 覆盖下观测到的，反映真实 Codex/后端行为，与本机 auth 怪癖无关。

### 10. 按角色的沙箱 / 权限模式

**rasen 里的作用**：LEAD playbook Step B 的角色→沙箱分配——reviewer/evaluator 只读，产物写入角色可写。

**Codex 对应机制**：`codex exec` 的 `-s read-only|workspace-write|danger-full-access` 与 Step B 假设精确对应：
- `-s read-only`：文件系统写入在 **OS 沙箱层硬拦截**，不是靠模型自律——实测 `echo hello > newfile.txt` 失败于 `zsh:1: operation not permitted: newfile.txt`（shell 自身的拒绝，说明沙箱在写 syscall 到达磁盘前拦截），目标文件从未创建（`ls` diff 确认）。
- `-s workspace-write`：同样的写入成功——文件落盘、内容正确、两条命令 `exit_code:0`。

**建议**：reviewer/evaluator 角色派发用 `-s read-only`，产物写入角色用 `-s workspace-write`——与现有 playbook Step B 意图完全一致，无需设计改动，只是确认。

**审批策略注意**：`codex exec` **没有 `-a/--ask-for-approval` flag**（`--help` 确认；传入报 `unexpected argument '-a' found`——E01/E04）。非交互 exec 模式的审批行为是隐式的：命令失败（含沙箱拒绝）直接返回给模型自行处理/报告，此模式下不存在阻塞式人工审批提示。（`-a` **确实**存在于顶层交互式 `codex` 和 `codex resume` 上；app-server 有等价的 `approvalPolicy` 字段——E07 显示 `thread/start` 响应里 `"approvalPolicy":"on-request"` 是 per-thread 字段，所以 app-server 驱动的 LEAD 在这里比 `codex exec` 有更细的控制。）

**网络访问**：每个 thread 注入的 permissions-instructions developer message（E01 rollout）声明默认 profile 下 `"Network access is restricted"`。本轮未单独实测（没有实验在任一沙箱模式下尝试出网）——若 rasen 将来派发需要网络的 Codex worker 角色（如 web 抓取的 research 角色），此项是待查。

**恢复/身份句柄、结构化输出**：不受沙箱模式影响。

**已观测失败模式**：read-only 下除预期拒绝行为外无。未测：`danger-full-access`（第三个文档化沙箱值）——本轮没有需要升级到它的场景；按其名称与 `--help` 描述推定为完全关闭沙箱层（对应 Claude 的最宽松模式），未独立确认。

### 11. 项目上下文注入（CLAUDE.md 对应物）

**rasen 里的作用**：CLAUDE.md 把项目约定自动注入每个 worker；rasen 还需要把变更目录的 proposal/design/tasks 上下文传给 worker。

**Codex 对应机制**：AGENTS.md 的发现规则是从调用 `cwd` **向上走到仓库根**，合并沿路发现的每个 AGENTS.md（根优先排序），不是"最近者胜"的单文件解析。E09 实测：从根调用时仓库根 `AGENTS.md` 的规则生效；从嵌套子目录调用时，根和嵌套目录的规则**都**生效，回复排序中根指令在前。与 Claude 自己的 CLAUDE.md 发现/合并行为（根+嵌套、近作用域叠加在上）直接平行。

**对 rasen 按变更上下文的建议**：rasen worker 通常以仓库根为 `cwd` 派发（不是变更目录），要靠嵌套的 `rasen/changes/<name>/AGENTS.md` 自动注入就必须把 worker 的 `cwd` 设到变更目录（或以下）——不是 rasen 现行派发模式，还会妨碍 worker 跨仓库改文件。**推荐做法（与 goal-plan 自身建议一致）：按提示词引用传递变更上下文**——在派发提示词里写明变更目录路径，指示 worker 直接读 `rasen/changes/<name>/proposal.md`/`design.md`/`tasks.md`，不依赖 AGENTS.md 自动发现。仓库根 `AGENTS.md` 仍是**全局** rasen 约定的好去处（如"本仓库使用 rasen artifact workflow；活跃工作见 `rasen/changes/`"），对每个 Codex worker 无差别生效。

**"提示词引用"这条建议本身已被实测证实，不只是貌似合理的设计**（round 2，E12）：派发提示词只写了文件路径（`rasen/changes/fake-change/proposal.md`），该文件里埋了不可猜测的 token（`FLAMINGO-42`），要求 worker 报告 token。worker 跑了真实的 `rg -n "CONTEXT_TOKEN" rasen/changes/fake-change/proposal.md` 命令（JSONL 中可见 `command_execution` item）并正确报出 `FLAMINGO-42`——该值不出现在提示词文本任何位置，排除幻觉。**提示词引用文件读取是已证机制，不是假设。**

**本轮未测**：全局 `~/.codex/AGENTS.md`（任何 git 仓库之外、机器级全会话生效）——两个一次性测试仓库都没走这条路。也未测：AGENTS.md 很大时的文件大小/截断行为（超出本轮范围；rasen 若采用，AGENTS.md 会很短）。

**恢复/身份句柄、结构化输出**：不适用——AGENTS.md 注入在 thread 启动时自动发生，与派发机制（`exec` 或 `app-server`）无关，与其他 developer 角色脚手架同类。

**已观测失败模式**：无。AGENTS.md 内容成为每个新 thread 起点的固定 developer 角色上下文（与 E01/E11 观测的 permissions/skills/multi-agent 脚手架同类消息）——**看起来不会在既有 thread 的 `resume` 时重读**（本轮未独立验证，但与所有其他启动脚手架的行为一致：thread 创建时注入一次，非每轮注入）。

### 12. 程序化桥接：`codex app-server` JSON-RPC 与 MCP 模式

**rasen 里的作用**：为 LEAD 提供比子进程更细粒度的程序化控制面（thread/turn 粒度、流式、审批回调）。

**Codex 对应机制**：playbook 的词汇表（"app-server threads"、`threadId`/`turnId`）现已实测确认，**且拿到了确切的真实方法名**（seed 清单里的方法名是占位虚构；以下是从 `codex app-server generate-json-schema --experimental` 提取的 0.144.1 真实面）：

**Thread/turn 生命周期（LEAD 调用的 `ClientRequest` 方法）：**
```
initialize → thread/start（或 thread/resume、thread/fork）→ turn/start
  → [飞行中可 turn/interrupt | turn/steer] →（轮次完成）
thread/list, thread/read, thread/items/list, thread/turns/list, thread/archive/unarchive/delete,
thread/compact/start, thread/goal/{set,get,clear}, thread/backgroundTerminals/*,
thread/shellCommand, thread/rollback
```

**推送事件（LEAD 应订阅的 `ServerNotification`）：**
```
thread/started, thread/status/changed, thread/tokenUsage/updated（第 5 节占用探针的推送源）,
turn/started, turn/completed, item/started, item/completed, item/agentMessage/delta（流式）,
item/reasoning/*Delta（流式推理）, error, warning
```

**审批回调（`ServerRequest`，server 反过来向 client 请求许可）：**
```
applyPatchApproval, execCommandApproval, item/commandExecution/requestApproval,
item/fileChange/requestApproval, item/permissions/requestApproval, item/tool/call,
item/tool/requestUserInput
```
想要 `on-request`/`untrusted` 审批语义（而非 `codex exec` 事实上的 `never`，见第 10 节）的 LEAD 必须实现这些 handler——本轮未实测触发（E07 捕获的 `thread/start` 响应里默认 approvalPolicy 是 `on-request`，但那次唯一的 `turn/start` 没有尝试被拒动作，所以没触发审批请求）。

**实测跑通的往返（传输：stdio，换行分隔 JSON-RPC）**：

```
codex app-server -c 'model_providers.proxy.name="proxy"' -c 'model_providers.proxy.base_url="..."' ...
```
然后经 stdin/stdout：`initialize` →（未经请求的 `remoteControl/status/changed` 通知）→ `initialized` → `thread/start {cwd}` → 结果携带 `thread.id`、`thread.path`（rollout JSONL 路径）、`sandbox`、`approvalPolicy`、`model`、`reasoningEffort`、`multiAgentMode` → `turn/start {threadId, input:[{type:"text",text:...}]}` → 流式 `item/started` / `item/agentMessage/delta` / `item/completed` → `thread/tokenUsage/updated` → `thread/status/changed{idle}` → `turn/completed`。完整 transcript 见 E07-app-server-jsonrpc.md。

**`codex mcp-server`（Codex 作为可被 Claude Code 调用的 MCP server）**：`codex mcp-server --help` 确认这是独立于 `app-server` 的 stdio MCP server 模式。**本轮未实测**（预算）。鉴于 app-server 协议面更丰富（thread/turn 粒度、流式 delta、显式审批回调、与第 1 节原生多 agent 机制对应的 `thread/fork`），**需要完全程序化控制的 LEAD 推荐走 app-server**；`codex mcp-server` 更适合轻量的"Codex 作为 Claude Code 可调用的一个工具"集成（如现有 `/codex` 二次意见 skill），而非派发/跟踪完整 Codex worker 的骨干。

**恢复/身份句柄**：`thread/start`/`thread/resume` 结果中的 `thread.id`（与 `codex exec` 的 `thread_id` 是同一 id 空间——UUID 格式相同，E07 的 app-server 创建线程产生的 `~/.codex/sessions/**/*.jsonl` rollout 文件布局与任何 `codex exec` 线程一致）。

**结构化输出**：经 schema 检视确认（非实测调用）：`TurnStartParams`（下载的 schema 包中 `schema/v2/TurnStartParams.json`）有 `outputSchema` 字段，描述为 *"Optional JSON Schema used to constrain the final assistant message for this turn"*——正是 `codex exec --output-schema` 的 app-server 等价物。本轮未在 app-server 上实测（E10 的实测走 `codex exec`），但 schema 层的存在加上 `codex exec` 的实证行为给出高置信度。待办：做一次带 `outputSchema` 的 `turn/start` 实测收尾。

**已观测失败模式**：单次实测往返中无。取消（`turn/interrupt`）在方法清单中存在但未演练。

### 13. 会话接力（Step H.7）

**状态：code-analysis-only**（按 goal-plan.md，此项本就可能收敛为代码面分析 + 一个小实测；小实测本轮未做——缺口见下）。

**分析**：Step H.7 的会话接力是 **Claude Code 专属机制**——LEAD（交互式 Claude Code 会话）触及上下文/能力上限时，spawn 一个带蒸馏提示词种子的*后继交互会话*，供人接续交互线程。它本质上是接力**交互的、面向人的**会话——与 Codex worker 正交，后者在 rasen 设计里永远是非交互派发目标（`codex exec`），不是 LEAD 本身。

两个子情形：
1. **LEAD 是 Claude、Codex worker 是派发目标**（现行架构）：会话接力完全不触及 Codex——Codex worker 的已完成/被中断线程由下一个接手工作的 LEAD 进程简单地 `codex exec resume <id>`（第 3/4/6 节）恢复即可；不需要"后继 Codex 会话"概念，因为 Codex worker 从来不是交互会话，从 LEAD 视角它们始终是单发 `codex exec` 派发。
2. **若 Codex 自己成为 LEAD**（超出现行 rasen 设计范围）：Codex 的交互模式确有直接类似原语——顶层 `codex resume [SESSION_ID] [PROMPT]`（注意是顶层 `codex resume`，不是 `codex exec resume`）按其 `--help` 接受可选的种子 PROMPT 参数；`codex fork [--last]`（"Fork a previous interactive session... use --last to fork the most recent"）与"带继承上下文 spawn 后继会话"更贴——两者都在 CLI 命令清单中存在（`codex --help` 列出 `resume`、`fork` 为顶层子命令），本轮均未实测。

**结论**：**会话接力保持 Claude 专属；Codex worker 不受影响**，与 goal-plan 预期的收敛一致。现行 rasen 架构（Claude LEAD、Codex 叶子 worker）不需要任何模拟设计——只有当 rasen 架构反转为 Codex 驱动的 LEAD 时此项才变得实测相关，届时 `codex resume <id> "<seed prompt>"` 或 `codex fork --last` 是具体的实测候选。

**恢复/身份句柄、结构化输出**：现行架构下 N/A；若重启此项，与第 3/6 节相同的 thread-id 机制。

**已观测失败模式 / 待查**：`codex resume`/`codex fork` 的种子提示词行为本轮未实测（鉴于情形 1 已覆盖 rasen 实际架构，属超范围）——只有 LEAD 角色假设改变时才值得关闭的真实缺口。

### 14. 运行态与门禁（auto-run.json / goal-run.json、`rasen pipeline resume`、门禁暂停）

**rasen 里的作用**：运行态文件记录每个 worker 的身份字段供恢复；门禁暂停后 `rasen pipeline resume` 接续。

**Codex worker 记录可解析的身份字段**：
- **`threadId`**：来自 `--json` 的 `thread.started` 事件（`{"type":"thread.started","thread_id":"<uuid>"}`），或 plain（非 `--json`）输出头部的 `session id: <uuid>` 行——两种模式都可用，E01 实测。
- **`turnId`**：`codex exec` 的 `--json` 事件流**不直接暴露**（本轮观测的 exec 模式 JSONL schema 里 `turn.started`/`turn.completed` 都不带 turn id 字段——E01/E02/E04/E05 全部样本均为裸 `{"type":"turn.started"}`）。**rollout 文件**的 `task_started`/`task_complete` `event_msg` payload 携带 `turn_id`（E03）可供运行态记录用；或者 app-server 协议（第 12 节）在 `turn/start` 结果和 `turn/started`/`turn/completed` 通知 payload 里直接暴露 `turn.id`——**运行态记录若在乎 turn 级粒度，优先 app-server 而非 `codex exec`**。
- **沙箱/模型元数据**：plain 输出头块（E01）直接打印 `model`、`provider`、`approval`、`sandbox`、`reasoning effort`——不用 `--json` 都能便宜捕获。app-server `thread/start` 结果（E07）给出同样字段的结构化版本，外加 `multiAgentMode` 和 rollout 文件 `path`。
- **rollout 文件路径**（运行态记录直接指向 transcript 而不必重推导）：只有 app-server 的 `thread/start`/`thread/resume` 结果暴露（`thread.path`）——`codex exec` 自身输出不打印 rollout 路径，只有 thread id（可经确定性 `~/.codex/sessions/<Y>/<M>/<D>/rollout-<ts>-<id>.jsonl` 模式或 `grep -rl` 兜底推导，见第 6 节）。

**推荐的 Codex worker 运行态记录形状**：

```json
{
  "runtime": "codex",
  "threadId": "019f5504-86db-7cf1-9b59-5cdcf0f70672",
  "turnId": null,
  "model": "gpt-5.6-sol",
  "modelProvider": "proxy",
  "sandbox": "workspace-write",
  "reasoningEffort": "low",
  "rolloutPath": null
}
```
（不直接用 app-server 时，`turnId`/`rolloutPath` 事后经第 6 节的 glob 从 rollout JSONL 补齐。）

**可恢复性已确认**：`rasen pipeline resume` 对暂停/被门禁的 Codex worker 记录直接映射为 `codex exec resume <threadId>`（第 3/4/6 节）——跨进程边界、跨 cwd、甚至轮次中途硬杀之后均实测通过。本轮未发现 Codex worker 特有的门禁/暂停流断裂；值得标记的一处不对称（第 10 节）：`codex exec` 没有 `-a/--ask-for-approval` flag，所以期望*轮次中途*暂停 worker 等人工审批（而非*派发之间*暂停）的 rasen 门禁需要 app-server 桥（`ServerRequest` 审批回调，第 12 节），plain `codex exec` 做不到。

**已观测失败模式**：瞬时 `429 Too Many Requests`（E02/E05）在运行态中应归类为**可重试**；真正的 `turn.failed`（如模型 404，E05）应归类为**不改配置不可重试**——两类须区分。

---

## 横切要点（实现前必读）

### 本机 auth 代理陷阱与 `model_providers` 覆盖写法

本机的全局 `OPENAI_API_KEY`/`OPENAI_BASE_URL` 指向第三方反向代理，而内置 `openai` model_provider **不遵守** `OPENAI_BASE_URL`（硬编码 `api.openai.com`），导致每次调用 401。修复方式（会话级，不改文件）——用 `-c` 定义自定义 `model_providers.<name>` 并选中它：

```
codex exec --json --skip-git-repo-check \
  -c 'model_providers.proxy.name="proxy"' \
  -c 'model_providers.proxy.base_url="https://code.newcli.com/codex/v1"' \
  -c 'model_providers.proxy.wire_api="responses"' \
  -c 'model_providers.proxy.env_key="OPENAI_API_KEY"' \
  -c 'model_provider="proxy"' \
  -o /tmp/last-msg.txt "<prompt>" < /dev/null
```

这纯属本机 API-key 路由的环境怪癖，**不属于 rasen↔Codex 对等设计面**——正常 ChatGPT 认证或标准 OpenAI key 的安装不需要。但任何在类似代理环境上包装 `codex exec` 的自动化都会遇到完全相同的 401，除非 (a) 知道覆盖 `model_providers`，或 (b) 用户在 `~/.codex/config.toml` 里一次性写好 `[model_providers.x]` 块 + `model_provider = "x"`（E01-baseline-exec-and-auth.md）。

**附带的 stdin 挂起陷阱**（E01 Finding 1）：`codex exec` 在已给位置 PROMPT 参数、但 stdin 未关闭时会打印 `Reading additional input from stdin...` 并永久阻塞等 EOF（其 `--help` 说明 stdin 若被 pipe 会作为 `<stdin>` 块追加）。**脚本/自动化里的每次 `codex exec` 调用必须 `< /dev/null`**（或显式 heredoc），否则挂死。

### 原生多 agent 默认层级式 → 平铺守卫是提示词级的

Codex 0.144.1 自带原生多 agent 系统（`spawn_agent`/`wait_agent`/`followup_task`/`send_message`，feature flag `multi_agent` 默认开启），且默认**层级式**（子代理可再生孙代理）——goal-plan 原始前提（假设 Codex 需要外部桥接才能多 agent）是错的。抑制手段只有提示词级守卫 `<multi_agent_mode>explicitRequestOnly</multi_agent_mode>`，没有找到代码级硬开关。**每个 rasen 叶子 worker 派发提示词必须携带显式"不得委派"指令**（措辞见第 1 节），并审计提示词中意外的 delegate/parallel 语言。

### `ultra` effort 自动委派 → 叶子角色封顶 `xhigh`

后端把 `ultra` reasoning effort 文档化为 "Maximum reasoning with automatic task delegation"——`ultra` 下模型无需提示词请求即被授权调用多 agent 工具。这与平铺守卫直接冲突：**叶子 worker 的 `-c model_reasoning_effort` 封顶 `xhigh`，绝不用 `ultra`**（`ultra` 只有 `gpt-5.6-sol`/`gpt-5.6-terra` 支持，见第 9 节表）。

### `prompts/*.md` 双入口阴性 → 客户端内联模板是唯一路径

`$CODEX_HOME/prompts/*.md` 自定义 prompt 在 0.144.1 的**两个**调用面都被拒：`codex exec` 把 `/name` 当字面聊天文本静默处理（E06）；交互 TUI 的命令面板不列出它、提交时明确报 `Unrecognized command`（E13）。rasen 的 Codex 适配器**必须在客户端把 skill/prompt 正文内联进 `codex exec` 提示词字符串**（第 7 节的三步模拟设计）——不能把内联当可选优化，因为 exec 面的失败是静默幻觉。是否存在另一个真正的原生机制（`skills/SKILL.md` 系统，由 feature flags 和 `<skills_instructions>` 系统提示块暗示）留待 round 3。

### rollout JSONL `token_count` 自带 `model_context_window` → 占用探针直读

占用探针在 Codex 上不需要任何模型→窗口对照表：rollout JSONL 最后一条 `token_count` 事件同时携带 `total_token_usage.total_tokens` 和 `model_context_window`，一次除法得占用比；app-server 场景下 `thread/tokenUsage/updated` 推送同样数据、零轮询。rasen 现有阈值（0.5/0.25/0.35）直接沿用。唯一注意点：零完成轮次的 thread 还没有 `token_count` 行——按 0% 处理，不是错误（第 5 节）。

---

## Round-3 待查清单

照 README 的 open follow-ups 原样列出（均为前瞻项，非本轮覆盖缺口）：

1. 查明 Codex 0.144.1 是否存在*可用的*可复用命名指令原生机制（feature flags 与系统提示脚手架暗示的 `skills/SKILL.md` 系统，区别于已双重证伪的 `prompts/*.md`）——若存在真原生路径，rasen 可撤掉客户端内联模拟（solution 07）。
2. 实测对*仍在运行*（尚未完成）的子 agent 发 `followup_task`/`send_message`——本轮只证明了 `spawn_agent` + 阻塞式 `wait_agent`（E11）。
3. 实测 `codex mcp-server` 模式作为 `app-server` 的替代/互补桥（solution 12）。
4. 直接在 app-server 的 `turn/start` 调用上实测 `--output-schema`/`outputSchema`（schema 中确认存在，尚未实测演练）。
5. 实测 `danger-full-access` 沙箱模式，以及各沙箱模式下的网络访问行为（solution 10）。
6. 实测全局 `~/.codex/AGENTS.md` 发现（本轮只测了仓库作用域的 AGENTS.md——solution 11）。
7. 实测 `codex resume`/`codex fork` 的种子提示词行为（仅当 rasen 架构反转为 Codex 驱动的 LEAD 时才相关——solution 13）。
8. 查证 `spawn_agent`/多 agent 工具能否经 `-c`/feature flag 硬禁用（而非只靠提示词级抑制），以及 `ultra` 的自动委派能否被独立抑制（solution 01/09）。

## 实现建议优先级

以下是给后续开发的建议实施顺序——目标是让一个 Codex worker 先跑通最小闭环，再逐步补齐编排全貌。此排序是本文的综合建议，不来自档案原文：

**第一梯队（最小闭环：LEAD 能派发一个 Codex worker 并拿回结构化结果）**
1. **派发原语封装**（solutions 01/09/10 + 横切要点）：封装一个 `codex exec` 调用构造器——统一带上 `< /dev/null`、`--json`、`-o`、`-s <sandbox>`、`-m`/`-c model_reasoning_effort`（叶子封顶 `xhigh`）、平铺守卫指令追加、以及可选的 `model_providers` 覆盖注入点。这是所有其他方案的地基。
2. **客户端模板内联**（solution 07）：读 `.md` → 剥 frontmatter → 参数替换 → 拼进提示词。没有它，任何 skill 化派发都会静默幻觉。
3. **结构化返回**（solution 08）：为叶子 worker DONE/HANDOFF 和 evaluate 门禁各定义一份契约 schema，每次派发传 `--output-schema` + `-o`，解析即 `JSON.parse`。
4. **运行态身份字段**（solution 14）：捕获 `thread_id` 写入 run-state 记录（`runtime: "codex"` 形状见第 14 节）。

**第二梯队（生命周期：暖续、复活、占用、并行）**
5. **暖续与复活**（solutions 03/04）：`codex exec resume <threadId>` 封装 + "最后 `turn.started` 无匹配 `turn.completed`/`turn.failed`" 死亡检测 + 429 可重试/404 不可重试分类。
6. **占用探针**（solution 05）：rollout 最后一条 `token_count` 行直读，套现有阈值。
7. **并行派发**（solution 02）：多进程并发 + 每 thread 单写者纪律 + 429 backoff。
8. **跨会话暖种子**（solution 06）：确定性 rollout 路径记录 + 结构化事件日志读取器。

**第三梯队（增强：更细控制面与上下文）**
9. **AGENTS.md 全局约定 + 提示词引用变更上下文**（solution 11）：仓库根 AGENTS.md 放全局约定；派发提示词写明变更目录路径。
10. **app-server 桥**（solution 12）：仅当需要 turn 级粒度、流式、或轮次中途审批门禁时引入——最小闭环用不到它。
11. **会话接力**（solution 13）：现行架构无需实现，仅存档结论。

配合 round-3 清单第 1 项（`skills/SKILL.md`）的结论，第 2 步的内联模拟未来可能被原生机制替换——实现时把模板展开做成可插拔步骤为宜。
