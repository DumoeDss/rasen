# Handoff: omnicross-inference-routing — lead #1

## Original intent

用户要求在 `dev/0.2.0` 上新建 worktree 与开发分支，并通过 `$rasen-auto small-feature` 开发 `docs/architecture/omnicross-inference-routing.md`。目标是让 Rasen 只需为 Pipeline/Workflow stage 配置工具（Claude Code 或 Codex）、Provider/upstream 与模型，即可通过常驻 OmniCross daemon 自动申请该次执行专用的下游路由凭据和格式转换；用户不再手工创建或绑定下游 key。典型组合是 planner 使用 Claude Opus、implementer 使用 Claude Sonnet、ship 使用 DeepSeek，同时不得改写用户的 Codex `config.toml` / `auth.json` 或 Claude 凭据文件。

## Position

Pipeline: `small-feature`. Completed stages: `propose`. Current stage: `apply`（implementer 正在独立收尾、核对任务并运行测试；尚未返回结构化 `DONE` 或 `HANDOFF`）。

Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-omnicross-inference-routing`

Branch: `feat/omnicross-inference-routing`，基于 `dev/0.2.0` 的 `75c3366a`。

## Done / Remaining

Done: `proposal.md`、`design.md`、6 份 delta spec 与 `tasks.md` 已生成；`rasen validate omnicross-inference-routing --type change --json` 已通过；proposal 已按全局 gate policy `off` 自动批准。实现工作已在 worktree 中落下大批源码、测试、fixture 与文档改动，但作者尚未完成最终核对，不能把这些改动视为已验收。

Remaining: `tasks.md` 中 1.1–6.4 在本检查点仍全部未勾选，须等待 implementer 按实际实现情况校准；收到作者回复后审计全部 touched files，执行严格 UTF-8 检查、focused tests、TypeScript/build/full tests 和 change validation；随后由非作者 verifier 写入 `evidence/review-report.md`，完成有界 review/fix/re-review，再进入 ship 与 archive。

## Key decisions (and why)

- 即使 OmniCross 路由 stage 与 LEAD 使用相同 runtime，也必须走 `exec-bridge`；native worker 无法安全获得彼此隔离的 per-stage route environment。
- `stage.model` 是模型解析的唯一来源；`inference` 只保存 broker/upstream 身份，避免模型出现两个互相漂移的真相来源。
- OmniCross `extraArgs` 必须约简成封闭的 Claude/Codex allowlisted binding，不能任意透传上游返回的参数。
- route token 只能存在于内存和子进程环境；不得进入 run-state、Run Record、日志、argv、配置、receipt 或 evidence。
- resume 保留冻结的逻辑路由身份，但允许为新 attempt 获取新的 lease/token。
- Rasen 不得修改 Codex `config.toml` / `auth.json`、Claude settings/credential 文件，也不得修改 sibling OmniCross 仓库。
- LEAD 是 `auto-run.json` 的唯一写入者；worker 只提交实现和任务状态结果。

## Dead ends & gotchas

- Implementer 曾错误派生 `/root/omnicross_implementer/omnicross_apply`，后者又派生 `apply_omnicross`。两者均已中断；已要求顶层 implementer 保留已落地工作、逐文件审计并独立完成。后续保持 flat hierarchy，不要恢复这些 nested agent。
- `rasen agent context --latest --json` 先命中默认 Claude 路径；显式使用 `--runtime codex` 后也因当前 Codex session cwd 是原仓库、change 位于新 worktree 而返回 `no-transcript`。因此本 handoff 的 run-state 指针省略 `pct`，不能据此猜测上下文占用。
- 当前 diff 很大且 `tasks.md` 尚未勾选；在作者返回前不要仅凭已存在文件推断任务已完成，也不要抢先改写任务状态。
- 工作区存在大量 LF→CRLF 警告；不要用 PowerShell 默认编码或整文件重写。文本修改使用 `apply_patch`，并在整合后做严格 UTF-8 与 diff 污染检查。

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)

none — 当前是 feature implementation，不是 fixer/debugger 调查。

## Working set

- Change blackboard: `rasen/changes/omnicross-inference-routing/`
- Run-state: `.rasen/changes/omnicross-inference-routing/ephemera/auto-run.json`
- 核心新增区域: `src/core/omnicross/`、`src/core/frozen-action-executor/omnicross-lifecycle.ts`
- 主要接线区域: `src/core/pipeline-registry/`、`src/core/claude/`、`src/core/codex/`、`src/commands/agent.ts`、`src/commands/pipeline.ts`
- 测试/fixtures: `test/core/omnicross/`、`test/core/pipeline-registry/omnicross-inference.test.ts`、`test/commands/agent-omnicross.test.ts`、`test/fixtures/omnicross/`
- 文档: `docs/architecture/omnicross-inference-routing.md`、`docs/omnicross-inference-routing.md`、`docs/experiments/omnicross-real-smoke.md` 与 architecture-index detail 页。
- 本检查点 `git diff --stat` 显示已跟踪文件约 1,148 insertions / 74 deletions（48 files），另有多个 untracked 新目录/文件；该数字仍可能随 implementer 收尾而变化。
- 已知规划验证命令: `rasen validate omnicross-inference-routing --type change --json`。

## Next action

等待 `/root/omnicross_implementer` 返回结构化 `DONE` 或 `HANDOFF`，不要打断它；返回后先核对 `tasks.md`、完整 diff 与作者测试证据，再记录 `apply` 完成并派发一名未参与实现的 verifier。
