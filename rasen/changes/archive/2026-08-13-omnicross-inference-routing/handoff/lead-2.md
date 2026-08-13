# Handoff: omnicross-inference-routing — lead #2

## Original intent

用户要求在 `dev/0.2.0` 上新建 worktree 与开发分支，并通过 `$rasen-auto small-feature` 开发 `docs/architecture/omnicross-inference-routing.md`。目标是让 Rasen 只需为 Pipeline/Workflow stage 配置工具（Claude Code 或 Codex）、Provider/upstream 与模型，即可通过常驻 OmniCross daemon 自动申请该次执行专用的下游路由凭据和格式转换；用户不再手工创建或绑定下游 key。典型组合是 planner 使用 Claude Opus、implementer 使用 Claude Sonnet、ship 使用 DeepSeek，同时不得改写用户的 Codex `config.toml` / `auth.json` 或 Claude凭据文件。

## Position

Pipeline: `small-feature`. Completed stages recorded in run-state: `propose`. Current stage: `apply`（implementer 已返回结构化 `DONE`，32/32 tasks 完成并通过作者侧验证；LEAD 尚未把 `apply` 标记为 done，也尚未启动独立 verify）。

Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-omnicross-inference-routing`

Branch: `feat/omnicross-inference-routing`，基于 `dev/0.2.0` 的 `75c3366a`。

## Done / Remaining

Done: `tasks.md` 的 1.1–6.4 共 32 项已全部勾选。实现覆盖 OmniCross route contracts/config/client/lease lifecycle、Pipeline inference 与 frozen recovery、Claude/Codex dispatch、端到端及安全测试、文档和 architecture index。作者还修正了 config-key 数量锁定值、`rasen-auto` / `rasen-review-cycle` 模板 digest、以及依赖共享 workspace 状态的 UI package resolver 测试，并移除了 abandoned test fixture 的 4 个文件。

作者验证证据：完整 `pnpm test -- --reporter=dot` 通过（0 failure，1489.5s）；build 通过；lint 通过；change validation 为 valid；`git diff --check` 通过；严格 UTF-8 检查 88 files、0 regressions；5 个 JSON 与 4 个 YAML 均可解析；persistent secret scan clean。

Remaining: LEAD 核对作者结果并把 `apply` 写为 done；随后派发未参与实现的 verifier，生成 `evidence/review-report.md`，完成有界 review/fix/re-review；所有 Blocker/Major 解决后才能进入 ship 与 archive。

## Key decisions (and why)

- 即使 OmniCross 路由 stage 与 LEAD 使用相同 runtime，也必须走 `exec-bridge`；native worker 无法安全获得彼此隔离的 per-stage route environment。
- `stage.model` 是模型解析的唯一来源；`inference` 只保存 broker/upstream 身份，避免模型出现两个互相漂移的真相来源。
- OmniCross `extraArgs` 必须约简成封闭的 Claude/Codex allowlisted binding，不能任意透传上游返回的参数。
- route token 只能存在于内存和子进程环境；不得进入 run-state、Run Record、日志、argv、配置、receipt 或 evidence。
- resume 保留冻结的逻辑路由身份，但允许为新 attempt 获取新的 lease/token。
- Rasen 不得修改 Codex `config.toml` / `auth.json`、Claude settings/credential 文件，也不得修改 sibling OmniCross 仓库。
- LEAD 是 `auto-run.json` 的唯一写入者；worker 已完成实现，但 `apply` 状态仍须由 LEAD验收后更新。

## Dead ends & gotchas

- Implementer 曾错误派生 `/root/omnicross_implementer/omnicross_apply`，后者又派生 `apply_omnicross`。两者均已中断；顶层 implementer 随后独立审计并完成全部工作。后续保持 flat hierarchy，不要恢复这些 nested agent。
- 第一轮完整测试的唯一失败来自环境脆弱断言：`ui-package.test.ts` 假设共享 workspace 没有已构建 UI，但原始 checkout 的 `packages/ui/dist` 可以被合法解析。测试已改成环境无关契约：结果为 `null`，或为实际存在的绝对 dist 路径。聚焦测试 2/2 通过，之后完整 suite 0 failure。
- Windows 完整 suite 约需 25 分钟，`pipeline.test.ts` 单独约需 7 分钟；不要因旧的 10 分钟预期误判测试挂死。
- OmniCross orchestration 文本改动同时影响 `rasen-auto` 与 `rasen-review-cycle` 的模板 SHA-256；这 4 个 digest 已更新。
- `rasen agent context --runtime codex --latest --json` 因当前 session cwd 是原仓库而 change 位于新 worktree，返回 `no-transcript`。因此 run-state 的 handoff 指针省略 `pct`，不能猜测上下文占用。
- 工作区存在大量 LF→CRLF 提示；文本修改继续使用 `apply_patch`，不要通过 PowerShell 默认编码整文件重写。

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)

- “UI package resolver 功能回归”已被排除：失败仅来自测试对共享 workspace 构建状态的错误假设；环境无关断言的聚焦测试和后续完整 suite 均通过。

## Working set

- Change blackboard: `rasen/changes/omnicross-inference-routing/`；`tasks.md` 当前为 32 checked / 0 unchecked。
- Run-state: `.rasen/changes/omnicross-inference-routing/ephemera/auto-run.json`；`apply` 当前仍记录为 `in_progress`。
- 核心新增区域: `src/core/omnicross/`、`src/core/frozen-action-executor/omnicross-lifecycle.ts`
- 主要接线区域: `src/core/pipeline-registry/`、`src/core/claude/`、`src/core/codex/`、`src/commands/agent.ts`、`src/commands/pipeline.ts`
- 测试/fixtures: `test/core/omnicross/`、`test/core/pipeline-registry/omnicross-inference.test.ts`、`test/commands/agent-omnicross.test.ts`、`test/fixtures/omnicross/`、`test/core/config-api/ui-package.test.ts`
- 文档: `docs/architecture/omnicross-inference-routing.md`、`docs/omnicross-inference-routing.md`、`docs/experiments/omnicross-real-smoke.md` 与 architecture-index detail 页。
- 最新 `git diff --shortstat`: 57 tracked files changed，1,391 insertions / 91 deletions；`git status --short` 共 68 entries（包含 untracked change artifacts、新模块、测试和 ephemera）。
- 作者验证命令/结果以本文件“Done / Remaining”中的结构化 `DONE` 摘要为准；独立 verifier 仍须复核，而不能把作者自测当成 review 结论。

## Next action

先核对 implementer 的 `DONE` 与 blackboard，将 `.rasen/changes/omnicross-inference-routing/ephemera/auto-run.json` 中 `apply.status` 更新为 `done`，然后派发一名未参与实现的 verifier 并要求其写入 `evidence/review-report.md`。
