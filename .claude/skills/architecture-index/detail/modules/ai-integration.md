<!-- architecture-index skill · on-demand · 仅在 skill 触发且需要该域时按需 Read，勿整文件预载。 -->
# 模块索引：AI / Agent 集成

> rasen 如何驱动外部 AI CLI（Claude Code、Codex）作为 leaf-worker，以及 keepalive、token audit、learned-skills 知识系统。所有路径前缀 `src/core/`。`claude/` 与 `codex/` 是对称兄弟，都产出 `pipeline-registry/run-state.ts` 的 `RunStateWorker`（`dispatchMode:'exec-bridge'`）。

## `claude/` — Claude Code leaf-worker 派发（`claude -p`）

- **关键文件**：`runner.ts`（跑一轮有界 `claude -p`）、`invocation.ts`（建 argv + stdin prompt）、`result.ts`（JSON 结果信封→类型化 receipt）、`session-state.ts`（单 writer/session 锁 + CWD 绑定）、`identity.ts`（建 `RunStateWorker`）。
- **核心**：`runClaudePrint(options)`（spawn `claude -p --input-format text --output-format json`，30 分钟超时 + 256KB 输出上限，解析恰好一个结构化结果信封）；`buildClaudePrintInvocation()` 注入 `CLAUDE_FLAT_HIERARCHY_GUARD`（"You are a leaf worker. Do not create/delegate/message/resume subagents…"）+ `--disallowedTools Agent,Task,TeamCreate,TeamDelete,SendMessage`；支持 `--resume <sessionId>` 暖续。
- **`ClaudeDispatchReceipt`**（success/failure 判别联合）；`claimClaudeSessionWriter()` 单 writer 锁；`CLAUDE_CLI_VERSION_PREMISE = '2.1.220'`（行为验证所钉版本）。
- **连接**：`codex/` 的对称兄弟。被 `keepalive/`（经 `CLAUDECODE` env 检测）、`token-audit/`（解析 `.jsonl` 转录）消费。

## `codex/` — OpenAI Codex leaf-worker 派发（`codex exec`）

- **关键文件**：`runner.ts`（`runCodexExec`）、`invocation.ts`（argv + prompt + resume）、`lifecycle.ts`（线程死亡检测 + 失败分类 + warm-seed 蒸馏）、`exec-events.ts`（解析 `codex exec --json` JSONL 事件流）、`rollout.ts`（定位/读 Codex 会话 rollout JSONL）。
- **核心**：`runCodexExec()`（spawn `codex exec`，建 scratch 文件 `--output-schema`/`-o last-message`，从 `thread.started` 取 `thread_id`，读 last-message）；`CODEX_FLAT_HIERARCHY_GUARD`；`ultra` effort 钳到 `xhigh`（ultra 会自动委派，违反 leaf 不变量）。
- **`CodexExecEvent` 联合**（`thread.started`/`turn.started`/`turn.completed`/`turn.failed`/`item.*`）；`detectThreadDeath(rolloutPath)`；`classifyTurnFailure()`→`retryable|fatal|unknown`（429 可重试/404 致命）；`distillWarmSeed()`（跨会话暖续蒸馏）；`findRolloutPath()`（`~/.codex/sessions/<Y>/<M>/<D>/rollout-<ts>-<threadId>.jsonl`）。
- **连接**：`claude/` 的对称兄弟。被 `token-audit/`（解析 rollout JSONL）消费。

## `hermes/` — Hermes Agent home 发现（未来第三后端 stub）

- **唯一文件**：`hermes-home.ts`（`resolveHermesHome()` = `$HERMES_HOME` 或 `~/.hermes`；skills 发现自 `<home>/skills/<name>/SKILL.md`，仅全局）。
- **连接**：镜像 `codex/codex-home.ts`。为加入 Hermes 作为第三 agent runtime 铺路；无本地 binary 可验证故无 `VERSION_PREMISE`。

## `completions/` — Shell 补全 + 动态 ID 补全

> 注意：这是 CLI-UX 子系统，不在 agent 派发路径上，但 `command-registry.ts` 含 `agent dispatch/context/wait/audit` 子命令定义。

- **关键文件**：`command-registry.ts`（静态 `COMMAND_REGISTRY` 命令树，每个 `rasen` 子命令的 flags/positionals/`completionValues`，**单一真相**）、`factory.ts`（`CompletionFactory` 派发 per-shell 生成器/安装器）、`completion-provider.ts`（2 秒缓存的动态补全：`getActiveChangeIds()`/`getSpecIds()`/`listSchemas()`）、`types.ts`。
- **核心**：`ResolvedCliPresentation`（全本地化、不可变，Commander 与补全渲染器共享）。
- **连接**：与 `cli/commander-presentation.ts` 共享命令结构真相。

## `keepalive/` — Prompt-cache 保活 beat 机制

让被 parked 的 subagent 在 pipeline stage 间保持 prompt cache 温热，避免恢复时付全 cache-write 价。

- **唯一文件**：`index.ts`（343 行）。
- **beat 机制**：有界阻塞调用在 5 分钟 Claude cache TTL 前（默认 270s）返回，使每次续接是 cache prefix 的干净 tool-result 延伸而非全上下文重写。经济上限 = **每角色 12 beats**（~54 分钟，与一次冷重写打平）。
- **核心类型**：`KeepaliveSignal = {kind:'resume'|'standDown',instruction?,ts?}`（LEAD 原子写信号文件到 `<changeRoot>/signals/<role>.json`，worker 每 5s 轮询）、`BeatState`（`<changeRoot>/signals/.state/<role>.json`）、`KeepaliveConfig`/`resolveKeepaliveConfig()`（`claude:true`/`codex:false`，`beatSeconds` 默认 270 clamp 90–280）。
- **`detectAgentRuntime(env)`** 优先级：`RASEN_AGENT_RUNTIME` > `CODEX_SANDBOX`(codex) > `CLAUDECODE`(claude) > `unknown`（codex 胜 claude 因嵌套会话继承 `CLAUDECODE`）。
- **连接**：LEAD 编排 playbook ↔ worker 派发后端之间的桥。`rasen agent wait` 是其薄消费者。import `../runtime-adapters.js` 的 `detectHostRuntime`。

## `knowledge-bundle/` — 可移植知识 bundle（`.bundle.json`）

在机器/store/项目 checkout 间传输 learned skills。

- **关键文件**：`schema.ts`（封闭版本化 Zod 契约 + `assertNoMachinePath` 机器路径守卫）、`export.ts`（导出项目 canonical learned skills）、`import.ts`（校验+计划+发布，两阶段硬链接，支持 `dryRun`）、`declaration.ts`（声明定位器解析 + 修复计划）。
- **核心**：`KnowledgeBundleSchema`(v1)（`bundleId`/`projectId`/`baseProjectCommit`/`records[]`，未知字段被 `assertOnlyPermittedFields` 拒）；`assertNoMachinePath()`（拒绝任何绝对机器路径，含 Windows drive/UNC/POSIX）；`exportKnowledgeBundle()`/`importKnowledgeBundle()`（staged 硬链接发布，TOCTOU-safe，事务标记文件支持崩溃恢复）。
- **连接**：重度依赖 `learned-skills/`（用其 manifest schema、`digestContent`、store 解析）。

## `learned-skills/` — Learned skill 生命周期（项目/全局/store 目录）

rasen 知识系统的深模块。管理 learned skill 的 create/read/resolve/mutate/retire。

- **关键文件**：`index.ts`（公共 API barrel）、`schema.ts`（candidate + manifest Zod，v1/v2）、`types.ts`、`catalog.ts`（canonical 记录读取 + 目录列表）、`mutate.ts`（**两阶段写** `planLearnedSkillMutation()`/`commitLearnedSkillPlan()`）、`resolve.ts`（`resolveLearnedSkills()`/`readCanonicalLearnedSkillCatalog()` 读路径）。
- **核心**：`LearnedSkillManifest`(v1/v2)（`id`/`knowledgeKey`/`scope:'project'|'global'`/`status:'active'|'retired'`/`contentDigest` SHA-256；v2 加 `owner`/`sources`）；`resolveEffectiveLearnedSkillPlan()`/`Records()`（解析执行有效集，含 store membership/conflict/applicability）；`freezeKnowledgeContext()`（冻结 run 的执行上下文快照）。
- **Store 解析**：`resolveCanonicalStore()`/`resolveGlobalStore()`/`resolveProjectStore()`/`resolveRegisteredKnowledgeStore()`（每 scope 的物理目录；store = `{dir,owner,root,projectId,lockPath}`）。
- **连接**：`knowledge-bundle/` 序列化/反序列化其记录；`completions/command-registry.ts` 暴露 `knowledge list/show/apply/effective/retire/migrate/bundle` 子命令；agent 编排系统在构建 worker prompt 时消费 resolved/effective skills。

## `token-audit/` — Token 花费审计（Claude/Codex/Zed）

- **关键文件**：`audit.ts`（顶层编排 `runAudit()`，自动检测 runtime）、`types.ts`（`ClaudeAuditResult`/`CodexAuditResult`/`ZedAuditResult`）、`classify.ts`（cache-churn 分类 + burst 聚类）、`parse.ts`（Claude `.jsonl`）、`parse-codex.ts`（Codex rollout JSONL）、`management.ts`（会话发现 + 报告管理 + import，用 `worker_threads`）。
- **cache-churn 分类**：每请求归类 `spawn|hit|ttl-expiry|rebase|context-drop|unattributed`。阈值 `HIT_PREFIX_RATIO=0.9`（cache_read≥前缀 90%=暖命中）、`DROP_CTX_RATIO=0.7`（上下文缩到 70% 以下=压缩）。Claude 60 分钟 main / 5 分钟 subagent TTL；Codex 5 分钟 idle-gap 近似。Burst 按 3 分钟 idle gap 切分（`BURST_GAP_MS`）。
- **`runAudit(target,options)`** 写 `rasen-token-audit/2` schema JSON 报告到 `~/.rasen/analytics/`。Claude 计费 `PRICING={cacheReadX:0.1,cacheWriteMainX:2,cacheWriteSubX:1.25}`；Zed 是诚实子集（仅 input/cached/output）。
- **连接**：import `codex/index.js`（`findRolloutPath`/`resolveCodexHome`）+ `agent-context.js`（`detectTranscriptKind`/`claudeProjectsDir`）。审计结果反馈 keepalive 经济模型（12-beat 上限源自同一 cache-pricing）。
