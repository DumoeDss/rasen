# Planning Context — codex-runtime (portfolio parent)

## User intent (2026-07-13)

依据已完成的 codex-parity 调研档案，实现 rasen 的 Codex runtime 支持。`/rasen-auto auto-decompose --no-gate`，无强制门全自动到任务结束。模型分配：planner/reviewer = fable，其余 subagent = sonnet。

## Authoritative sources (read these FIRST, they are evidence-backed and version-pinned to codex-cli 0.144.1)

- `docs/zh/codex-parity-solutions.md` — 中文综合稿，含三梯队实现优先级（本组合的切分依据）。
- `docs/codex-parity/README.md` + `solutions/01–14` + `experiments/E01–E13` — 英文原始档案，全部实机验证。
- `rasen/changes/codex-parity-research/report.md` — 调研 run 报告。

## Decompose plan (LEAD-audited)

Serial chain (conservative — spec folder overlap plausible between siblings):
1. **codex-runtime-exec-core** — 派发原语: `codex exec` invocation builder（统一 `< /dev/null` stdin 陷阱、`--json`、`-o`、`-s <sandbox>`、`-m` + `-c model_reasoning_effort`（叶子封顶 xhigh）、平铺守卫指令追加、可选 model_providers 覆盖注入）；客户端模板内联（读 .md → 剥 frontmatter → 参数替换 → 拼提示词，做成可插拔步骤，未来可被原生 skills 机制替换）；结构化返回契约 schema（DONE/HANDOFF + evaluate 门 `{satisfied,gaps}`）配 `--output-schema`；thread_id 捕获 + rollout 文件定位/解析工具（token_count 事件、事件日志读取）。运行态身份字段形状见 solution 14。
2. **codex-runtime-lifecycle** — `codex exec resume <threadId>` 封装；死亡检测（最后 `turn.started` 无匹配 `turn.completed`/`turn.failed`）；429 可重试/404 不可重试分类 + backoff；并行多进程纪律（每 thread 单写者）；跨会话暖种子（确定性 rollout 路径记录 + 结构化读取）。依赖 exec-core 的 rollout 工具。
3. **codex-runtime-context-probe** — `rasen agent context` 支持 Codex rollout（token_count 自带 model_context_window 直读），套现有阈值体系。复用 exec-core 的 rollout 解析。
4. **codex-runtime-playbook-integration** — `src/core/templates/workflows/_orchestration.ts` Step A.1/B 的 Codex 段落从"app-server threads / /codex:rescue 插件"虚构改写为实测机制（exec 桥）；AGENTS.md 全局约定指引（solution 11）；session-relay 结论存档（solution 13：现行 Claude-LEAD 架构无需实现）；把前三个子变更的模块接到 pipeline runtime 解析处。合流节点。

Out of scope（档案明确判定）：app-server 桥（最小闭环用不到，tier-3 item 10 仅在需要 turn 级流式/中途审批时引入）；session relay 实现（无需）。

## Key constraints from the dossier (verbatim-relevant)

- 本机 auth 走第三方代理：内置 openai provider 全 401，须 `-c model_providers.<name>.{base_url,wire_api,env_key}` + `model_provider="<name>"` 覆盖——builder 必须留注入点，但默认不硬编码本机代理。
- Codex 原生多 agent（spawn_agent/wait_agent）默认层级式：叶子派发词必须自动追加"禁止委派"守卫；`ultra` effort 自动委派 → builder 对叶子角色 effort 封顶 `xhigh`。
- `prompts/*.md` 双入口阴性：非交互派发唯一路径是客户端内联；实现为可插拔步骤。
- `codex exec` 不接管 stdin 会挂起：统一 `< /dev/null`。
- rollout JSONL `token_count` 事件自带 `model_context_window`，无需外部模型表。
- 版本钉死 codex-cli 0.144.1；行为差异要在代码注释/文档标注版本前提。

## Project conventions

- 版本号归用户管：绝不 bump version（读 package.json，发布类改动版本无关）。
- 子变更 ship 走 local delivery（只 commit 不 push）；组合级交付最后一次性由用户拍板。
- 测试跑 `pnpm test`（注意外层 pnpm-workspace.yaml 历史问题已修）；Windows flake 见记忆，本机 macOS。
- 提交须 `git commit -- <paths>` 显式 pathspec（并发 session 共享 index 教训）。

## Model policy (user directive)

planner / reviewer = fable; implementer / fixer / shipper = sonnet.

## Findings — exec-core proposal (planner-1, 2026-07-13)

- **Interfaces siblings must code against** (exec-core design.md D10, all exported via `src/core/codex/index.ts` only): `parseExecEventStream`/`extractThreadId` (exec-events.ts), `findRolloutPath`/`readRolloutOccupancy`/`readRolloutConversation` (rollout.ts — occupancy returns `null` = "zero completed turns, treat as 0%", NOT an error), `buildCodexExecInvocation`/`formatShellInvocation`/`CODEX_FLAT_HIERARCHY_GUARD` (invocation.ts), `LEAF_RETURN_SCHEMA`/`EVALUATE_GATE_SCHEMA` + parsers (contracts.ts), `buildCodexWorkerRecord` (identity.ts). Lifecycle child extends the builder's options additively with a `resume` variant; do not add a second builder.
- **No run-state schema change needed**: `RunStateWorkerSchema` already carries runtime/threadId/sandbox/model/effort, and the rollout JSONL path is recorded in the existing `transcript` field (its documented semantics — durable cross-session conversation pointer — match exactly); `turnId` stays unset in exec mode (bare exec events carry none). `stageWorkers()` already treats `threadId` as warm-seedable.
- **Design conventions set for the portfolio**: builder returns data and never spawns (process lifecycle is caller/lifecycle-child territory); `ultra` effort is CLAMPED to `xhigh` with a `warnings[]` entry (not an error); flat guard is always appended with no opt-out in this slice; version pin is the exported constant `CODEX_CLI_VERSION_PREMISE = '0.144.1'`; `resolveCodexHome()` in `src/core/codex/codex-home.ts` becomes the single CODEX_HOME resolution (the command-generation codex adapter is refactored to import it — siblings must not re-duplicate).
- New capability spec: `codex-exec-runtime` (5 requirements). Siblings own: lifecycle → likely new `codex-lifecycle` capability; context-probe → delta on existing `cli-agent-context`; playbook-integration → template/orchestration specs. No spec-folder overlap with exec-core expected if they keep to that split.

## Findings — lifecycle proposal (planner-1, 2026-07-13)

- **New export surface promised by lifecycle** (all via module root): `resume?: { threadId }` option on the ONE builder (argv `exec resume <id>` before flags; NO `--last` by design — racy under parallelism); `detectThreadDeath`/`detectDeathInRows`, `CODEX_REVIVAL_NOTICE` (caller-injected, never automatic), `classifyTurnFailure` → `retryable|fatal|unknown` (unknown is deliberate — playbook child owns unknown-policy), `backoffDelayMs(attempt, {baseMs:20_000, maxMs:120_000})` deterministic (caller sleeps), `claimThreadWriter`/`isThreadWriterClaimed` (in-process only; cross-process single-writer is a documented operator invariant, no lock files), `distillWarmSeed(conversation)` (pure — playbook child composes with fresh read or cache and owns any token-budget truncation).
- **Additive extensions to exec-core files**: `findRolloutPath` gains `archived_sessions/` flat-dir final fallback (the gap exec-core D8 parked); `RolloutConversation` gains `finalAnswerRecords: {text, source: 'agent_message'|'task_complete', phase?}[]` alongside unchanged `finalAnswers` — no exec-core spec delta needed (additive metadata).
- **Death-detection vocabulary is dual-family by design** (openers task_started/turn.started; closers task_complete/turn.completed/turn.failed/turn_failed/turn_aborted, top-level or event_msg payload) because dossier captures mix exec-stream and rollout vocabularies; tasks require a live kill-mid-turn capture on this machine to trim to reality. Opener-free rollout = idle, not dead (mirrors null-occupancy convention).
- **Distillation policy**: keep agent_message only when phase==='final_answer', dedupe exact-text repeats against task_complete; records WITHOUT phase are always kept (drift degrades to verbosity, never loss).
- Spec: new capability `codex-lifecycle` (5 requirements, 12 scenarios); zero overlap with codex-exec-runtime as planned.

## Findings — context-probe proposal (planner-1, 2026-07-13)

- **Probe routing is transparent to ALL consumers**: `probeAgentContext` AND `tryContextEstimate` (the never-throw path `pipeline resume` uses) both gain kind detection — so run-state records with rollout paths in `transcript` (exec-core's recording convention) probe correctly with zero playbook-side changes. Playbook child: `rasen agent context --transcript <rolloutPath>` just works; new `--runtime <claude|codex>` flag exists as deterministic override; `--latest` stays Claude-only; no `--thread-id` flag (deferred until a real call site shows path-passing is awkward).
- **Detection order**: explicit `--runtime` > basename `rollout-*.jsonl` (zero I/O, codex's own convention) > first-line sniff (`session_meta` expected — implementer live-captures a real rollout head and adjusts) > claude default.
- **Zero-turn rollout = exit 0 with pct 0/contextTokens 0/limit 0 (or --limit)** — deliberately asymmetric with usage-free Claude transcript (still an error): young rollout is well-formed, usage-free Claude transcript is malformed. Pinned in spec so it never gets "fixed" into symmetry. `limit: 0` audited safe (all threshold consumers key on pct).
- **Codex branch never consults `resolveModelLimit`** — inline `model_context_window` is exact; the prefix map stays a Claude-only concept. `--limit` override still wins on both kinds (pct recomputed).
- Spec: MODIFIED delta on existing `cli-agent-context` (both requirements, full-block MODIFIED discipline, +5 scenarios). No dependency on lifecycle's concurrent apply (uses only shipped `readRolloutOccupancy`, whose signature lifecycle leaves untouched).

## Findings — playbook-integration proposal (planner-1, 2026-07-13)

- **The playbook teaches COMMANDS, not APIs** (design D1): the LEAD can't call library functions, so Step B shows the rendered `codex exec` invocation shape the builder produces (with `< /dev/null`, `--output-schema`, `-o`, guard, effort rules stated as invariants); a `rasen codex dispatch` wrapper CLI was considered and deliberately deferred until a real `runtime: codex` run proves/disproves the shell shape — do NOT invent it during apply.
- **Fiction inventory to delete** (grep-verified): `_orchestration.ts` line ~42 (app-server threads / Codex plugin / turnId promise), ~62 (`/codex:rescue` sentence), Step F turnId mention; `pipeline-registry/types.ts` AgentRuntimeSchema comment; `docs/codex-workflow-integration.md` + zh mirror (573 lines each, 2026-06-08 pre-research app-server design → superseded banner + pointer, NOT rewritten — preserved for future tier-3 app-server work). auto.ts/help.ts runtime-flag lines are REAL and stay.
- **Parity blast radius**: ORCHESTRATION_PLAYBOOK feeds auto.ts, goal-command.ts, review-cycle.ts → re-pin rasen-auto/rasen-goal/rasen-review-cycle in BOTH golden-master hash maps (+ command payload entries) after an eyeballed generated-content diff; flow is build → `rasen update` → diff review → paste hashes.
- **Guard/notice text policy**: playbook cites `CODEX_FLAT_HIERARCHY_GUARD`/`CODEX_REVIVAL_NOTICE` by name and paraphrases — no verbatim duplication as normative text (library stays single source of truth; a hash-parity coupling between prose and constants was rejected as over-coupling).
- Spec: ADDED-only delta on `opsx-orchestration` (3 requirements, 10 scenarios — exec-bridge dispatch, lifecycle signals incl. resume-rejects-sandbox and no-turnId, prompt-reference context + AGENTS.md scope). No REMOVED needed: the app-server wording was template prose, never specced. Portfolio spec split held: zero folder overlap across all four children.
