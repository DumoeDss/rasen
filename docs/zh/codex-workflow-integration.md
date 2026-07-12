# Codex 接入 OPSX Workflow 的可行方案

> **已被取代 (2026-07-13)。** 本文是研究前的 app-server 方案设计（2026-06-08），不反映已发布的实现。rasen 实际以非交互式 `codex exec` 进程（exec 桥）派发 Codex worker，而非 app-server 线程、Codex Claude Code 插件或 `/codex:rescue`。正文保留作为历史记录——其中的协议笔记未来可能对 app-server 方案（tier-3）有参考价值。真实、已实机验证的机制见 `docs/codex-parity/README.md`（英文调研档案）、`docs/zh/codex-parity-solutions.md`（中文综合稿）与已发布的 `src/core/codex/` 模块；编排 playbook 中的 Codex 段落（`src/core/templates/workflows/_orchestration.ts`）是权威的操作指引。

> 日期：2026-06-08  
> 背景：当前 OPSX workflow 的主路径基于 Claude Code subagent + `SendMessage`。本文分析如何在 `propose`、`review` / `review-loop` 等阶段引入 Codex，并支持启动、传参、结果接收、同阶段会话复用与跨重启恢复。

## 1. 结论

可行，而且不建议把 Codex 当成一个普通 `/codex:*` slash command 文本来调用。更稳的方案是把 Codex 抽象成 OPSX 的第二种 worker runtime：

- Claude worker：当前 `Task` / subagent / `SendMessage` 机制。
- Codex worker：通过 Codex app-server 的 `thread/start`、`turn/start`、`thread/resume` 驱动。

也就是说，pipeline 的 DAG、stage、gate、run-state 继续由 OpenSpec/OPSX 统一管理；每个 stage 只多一个可选执行后端 `runtime: claude | codex`。Codex 的会话复用不是 Claude 的 `agentId + transcript`，而是 Codex 的 `threadId`，跨重启可以直接 `thread/resume` 到同一个 thread，这比 Claude subagent 的 transcript 暖播种更接近真正恢复。

首批最适合接 Codex 的阶段：

1. `propose` planner：用一个持久 Codex thread 跨多个 child propose 复用代码库调研上下文。
2. `verify` / `review-loop` reviewer：用 Codex 做独立审查，复审修复时 resume 同一个 review thread，只审 delta。
3. `leadReview` 方向复审：用 read-only Codex 做非作者方向挑战，成本低、边界清晰。

不建议第一阶段就让 Codex 承担 `apply` / `fixer` 写代码，除非已经有明确的 sandbox/approval 策略和文件写入审计。先从 read-only review 和 artifact-producing propose 做起，风险最低。

## 2. 现状约束

当前 `docs/opsx-workflow-guide.md` 与 `_orchestration.ts` 的设计建立在 Claude Code 能力上：

- `LEAD` 编排，worker 是叶子 subagent。
- 同一活会话内，用 `SendMessage` 续聊同一个 worker。
- 跨重启后，Claude subagent 的 `agentId` 已经不是活句柄，只能读 `agent-<agentId>.jsonl` transcript 暖播种一个新 worker。
- `auto-run.json` 每个 stage 记录 `role` / `agentId` / `transcript`。
- `portfolio-run.json` 顶层 `planner` 记录 propose 专属 persistent planner。
- `rasen pipeline resume <change> --json` 会读取 run-state，暴露 `workers`、`inProgressStages`、`openFindings`、portfolio 的 `planner` 等信息。

本地 Codex plugin for Claude Code 已经提供了另一个模型：

- 使用本机 `codex` CLI 的 `codex app-server`。
- 通过 JSON-RPC 调用 `thread/start`、`turn/start`、`thread/resume`、`review/start`、`turn/interrupt`。
- `runAppServerTurn()` 可以启动或恢复 thread，返回 `threadId`、`turnId`、`finalMessage`、`fileChanges`、`commandExecutions`。
- `runAppServerReview()` 可以启动内置 review，返回 `threadId`、`sourceThreadId`、`reviewText`。
- plugin 的 task 模式默认 `persistThread: true`，可用 `threadId` 继续任务。
- plugin 已实现 job state、background worker、result/status/cancel、broker 复用 app-server runtime。

因此，Codex 不需要模拟 Claude 的 `SendMessage`。Codex 原生的恢复单位应是 `threadId`。

## 3. 推荐架构

### 3.1 新增 Codex bridge，而不是直接依赖 Claude 插件命令

建议在 OpenSpec 仓库里新增一个轻量 bridge：

```text
src/core/ai-runtimes/
  codex/
    app-server-client.ts
    codex-worker.ts
    codex-state.ts
```

它可以先移植 / 改造插件中的关键实现：

- `CodexAppServerClient`
- `runAppServerTurn`
- `runAppServerReview`
- `interruptAppServerTurn`
- broker lifecycle 可选复用

不建议直接 shell 调 `node <plugin>/scripts/codex-companion.mjs task ...` 作为主实现，原因是：

- 插件 state 默认在 `CLAUDE_PLUGIN_DATA` 或 temp 下，生命周期绑定 Claude plugin，不适合作为 OpenSpec 的权威状态。
- OPSX 需要把结果写入 `auto-run.json`、`portfolio-run.json`、stage artifact；直接调用 slash command 风格工具会多一层状态同步。
- Codex plugin 面向人类 `/codex:status` / `/codex:result`，而 OPSX 需要机器可控的 stage executor。

短期可以把插件作为参考实现或 prototype；长期应内置 OpenSpec bridge。

### 3.2 Stage executor 抽象

把“派发一个 stage”抽象成统一接口：

```ts
interface StageExecutor {
  runtime: 'claude' | 'codex';
  start(input: StageRunInput): Promise<StageRunResult>;
  resume(input: StageResumeInput): Promise<StageRunResult>;
  cancel?(ref: StageRuntimeRef): Promise<void>;
}
```

Claude executor 对应现有 subagent prompt。Codex executor 做：

- 若无 `threadId`：`thread/start`，然后 `turn/start(prompt)`。
- 若已有 `threadId`：`thread/resume(threadId)`，然后 `turn/start(followupPrompt)`。
- 根据 stage 类型选择 sandbox：
  - `propose`：建议 `workspace-write`，因为要写 `proposal.md` / `design.md` / `specs` / `tasks.md`。
  - `review` / `leadReview`：`read-only`。
  - `fixer` / `apply`：后续再开放 `workspace-write`。
- stage prompt 必须要求 Codex 把 canonical artifacts 写入 change 目录，不能只在 final message 里回答。

### 3.3 Pipeline 配置扩展

给 stage 增加可选字段：

```yaml
stages:
  - id: propose
    skill: openspec-propose
    role: planner
    runtime: codex
    sessionReuse: run-planner

  - id: verify
    skill: openspec:review
    role: reviewer
    runtime: codex
    sessionReuse: stage
```

建议字段语义：

| 字段 | 含义 |
|---|---|
| `runtime` | `claude` 默认，`codex` 表示该阶段交给 Codex executor |
| `sessionReuse` | `none` / `stage` / `run-planner` / `review-thread` |
| `sandbox` | 可选覆盖：`read-only` / `workspace-write` |
| `model` / `effort` | 可选 Codex 模型与 reasoning effort |
| `outputSchema` | 可选，review 类阶段要求结构化 JSON |

如果不想第一阶段改 pipeline schema，也可以先用全局策略开关：

```json
{
  "codex": {
    "enabled": true,
    "stages": {
      "propose": true,
      "leadReview": true,
      "review-loop.review": true
    }
  }
}
```

但长期还是推荐进入 pipeline 数据模型，因为这样不同流水线可以显式声明执行后端。

## 4. Run-state 设计

当前 `RunStateSchema` 是 `passthrough()`，因此可以兼容新增字段。建议把 worker 记录扩展成 runtime-aware 引用：

```json
{
  "pipeline": "small-feature",
  "tier": "codex-hybrid",
  "stages": {
    "propose": {
      "status": "done",
      "worker": {
        "runtime": "codex",
        "role": "planner",
        "threadId": "thread_xxx",
        "turnId": "turn_xxx",
        "jobId": "opsx-codex-xxx",
        "sandbox": "workspace-write",
        "threadName": "OPSX planner: parent-change",
        "updatedAt": "2026-06-08T00:00:00.000Z"
      }
    }
  }
}
```

兼容 Claude 的 worker：

```json
{
  "runtime": "claude",
  "role": "reviewer",
  "agentId": "agent_xxx",
  "transcript": ".../agent-agent_xxx.jsonl"
}
```

建议把 `RunStateWorkerSchema` 从只接受 `role/agentId/transcript` 扩成：

```ts
runtime?: 'claude' | 'codex';
role?: string;
agentId?: string;
transcript?: string;
threadId?: string;
turnId?: string;
jobId?: string;
threadName?: string;
sandbox?: 'read-only' | 'workspace-write';
model?: string;
effort?: string;
```

同时把 `stageWorkers()` 改为返回任一可恢复引用：

- Claude：`agentId || transcript`
- Codex：`threadId`

`rasen pipeline resume --json` 的输出可以继续叫 `workers`，但每个 entry 带 `runtime`，例如：

```json
{
  "workers": {
    "propose": { "runtime": "codex", "role": "planner", "threadId": "thread_xxx" },
    "verify": { "runtime": "claude", "role": "reviewer", "agentId": "agent_yyy", "transcript": "..." }
  }
}
```

这样 LEAD / auto workflow 可以根据 `runtime` 决定是 `thread/resume` 还是 transcript 暖播种。

## 5. Propose 阶段接入

### 5.1 单 change

第一次 propose：

1. LEAD 写 `rasen/changes/<id>/planning-context.md`。
2. Codex bridge 创建持久 thread：
   - `thread/start({ cwd, sandbox: "workspace-write", ephemeral: false, threadName })`
   - `turn/start({ prompt })`
3. Prompt 要求 Codex：
   - 读取 `planning-context.md`。
   - 生成 `proposal.md` / `design.md` / `specs/<cap>/spec.md` / `tasks.md`。
   - 追加关键发现到 `planning-context.md`。
   - final message 只返回摘要、写入文件列表、验证建议。
4. LEAD 运行 `rasen validate <change> --strict` 或至少 `rasen status --change <id> --json` 做结构校验。
5. `auto-run.json` 的 `stages.propose.worker.threadId` 写入 Codex thread。

后续恢复同一个 propose：

1. `rasen pipeline resume <change> --json` 返回 propose worker 的 `threadId`。
2. Codex bridge `thread/resume(threadId)`。
3. `turn/start("Continue the propose stage...")`，并附上当前缺失/需修订的 artifact 清单。

### 5.2 decompose / 多 child propose

这是 Codex 最有价值的位置。当前 Claude 设计是一个 persistent planner 跨所有 child propose 复用。Codex 可以更自然地实现：

- `portfolio-run.json.planner` 记录 Codex planner thread：

```json
{
  "parent": "big-change",
  "planner": {
    "runtime": "codex",
    "role": "planner",
    "threadId": "thread_planner_xxx",
    "threadName": "OPSX portfolio planner: big-change"
  },
  "children": []
}
```

- child #1 propose：在同一 planner thread 上要求生成 child #1 artifacts。
- child #2 propose：`thread/resume(thread_planner_xxx)`，提示它已知道 child #1 的接口承诺，生成 child #2 并保持一致。
- 每轮都要求追加 `planning-context.md`，作为可审计 digest 和 fallback。

当 planner thread 过长时：

1. 要求当前 Codex thread 写一份 `planning-context.md` compact digest。
2. 开新 Codex thread。
3. 用 digest + sibling artifact 作为 seed。
4. 更新 `portfolio-run.json.planner.threadId`，保留 `previousThreadIds` 作为审计扩展字段。

## 6. Review / review-loop 接入

### 6.1 普通 verify review

可用两种 Codex review 模式：

1. `review/start`：Codex app-server 内置 review，适合工作区 diff / base branch review，返回 `reviewText`。
2. `turn/start` + 自定义 prompt + `outputSchema`：适合 OPSX 需要的结构化 findings、限定 change、限定 spec scenario 对照。

OPSX 推荐第二种作为主路径，因为 review-loop 需要结构化 findings：

```json
{
  "status": "fail",
  "findings": [
    {
      "severity": "major",
      "summary": "...",
      "file": "src/...",
      "line": 123,
      "recommendation": "..."
    }
  ]
}
```

Codex review thread 写入：

- `rasen/changes/<id>/review-report.md`
- `auto-run.json.stages.verify.worker.threadId`
- `auto-run.json.openFindings`

### 6.2 review-loop 初审、修复、复审

初审：

1. Codex reviewer thread read-only 审当前 diff + proposal/spec/tasks。
2. 输出结构化 findings，写 `review-cycle-report.md` 或 `review-report.md`。
3. 记录 `reviewLoop.reviewer.threadId` 或 `stages.review-loop.worker.threadId`。

修复：

- 第一阶段仍建议 Claude implementer/fixer 负责修，保持当前 author/verifier 分离模型。
- 修复后 LEAD 计算 fix delta，写入 `rasen/changes/<id>/review-delta-round-<n>.md`。

复审：

1. 恢复原 Codex reviewer thread：
   - `thread/resume(originalReviewThreadId)`
   - `turn/start("Re-review only this delta...")`
2. Prompt 明确：
   - 不重审整个代码库。
   - 只根据原 findings + 本轮 delta 判断是否 resolved。
   - 不能接受 fixer 自证。
3. Codex 输出每个 finding 的 `resolved | still_open | superseded`。
4. LEAD 更新 `openFindings` 与 round history。

这满足当前 `review-cycle` 的核心要求：复审者不是 fixer，并且复审携带原上下文。

### 6.3 与 Claude `SendMessage` 的关系

如果 reviewer 是 Claude worker：

- 同会话内继续用 `SendMessage`。
- 跨重启用 transcript 暖播种。

如果 reviewer 是 Codex worker：

- 同会话和跨重启都用 `thread/resume(threadId)`。
- 不需要 transcript 暖播种。
- `threadId` 是可恢复资产，`turnId` 是当前 turn/cancel 资产。

因此 run-state 里必须区分 runtime，不能把 Codex `threadId` 塞进 `agentId`。

## 7. 启动、传参、结果接收

### 7.1 启动 Codex

直接启动：

```text
codex app-server
```

通过 app-server JSON-RPC：

- `initialize`
- `thread/start`
- `turn/start`
- `thread/resume`
- `turn/interrupt`

建议复用 plugin 的 broker 思路：

- 一次 OPSX run 内尽量复用一个 app-server broker，避免每个 stage 反复拉起 Codex。
- broker 只负责 runtime 连接复用，不作为权威状态。
- 权威状态仍写在 `auto-run.json` / `portfolio-run.json`。

### 7.2 传参

Codex stage prompt 应由 OpenSpec 生成，而不是自由拼接。建议包含固定块：

- role：planner/reviewer/fixer。
- change：change id 与目录。
- stage contract：必须读哪些文件、必须写哪些文件。
- current artifacts：`rasen show <change>` / `rasen status --json` 摘要。
- scope：diff/base branch/current working tree。
- resume context：如果是 resume，说明上一轮 thread 已有上下文，并附本轮 delta / missing artifacts。
- output contract：final message 格式；review 可带 JSON schema。

### 7.3 结果接收

Codex bridge 返回：

```ts
{
  status: 0 | 1;
  threadId: string;
  turnId: string | null;
  finalMessage: string;
  touchedFiles: string[];
  commandExecutions: CommandExecution[];
  fileChanges: FileChange[];
}
```

LEAD / executor 必须做二次确认：

- artifact stage：检查目标文件是否真的存在。
- propose：跑 `rasen validate <change>` 或 `rasen status --json`。
- review：解析 final JSON 或检查 report 文件。
- write sandbox 阶段：记录 `touchedFiles`，必要时要求人工 gate。

## 8. 状态文件示例

### 8.1 单 change `auto-run.json`

```json
{
  "pipeline": "small-feature",
  "classification": "small-feature",
  "tier": "hybrid-codex",
  "stages": {
    "propose": {
      "status": "done",
      "worker": {
        "runtime": "codex",
        "role": "planner",
        "threadId": "thread_abc",
        "turnId": "turn_001",
        "threadName": "OPSX planner: add-export",
        "sandbox": "workspace-write"
      }
    },
    "apply": {
      "status": "done",
      "worker": {
        "runtime": "claude",
        "role": "implementer",
        "agentId": "agent_impl",
        "transcript": "..."
      }
    },
    "review-loop": {
      "status": "in_progress",
      "worker": {
        "runtime": "codex",
        "role": "reviewer",
        "threadId": "thread_review",
        "turnId": "turn_007",
        "sandbox": "read-only"
      }
    }
  },
  "rounds": 1,
  "openFindings": [
    { "severity": "major", "summary": "Export misses permission check", "stage": "review-loop" }
  ]
}
```

### 8.2 Portfolio `portfolio-run.json`

```json
{
  "parent": "settings-export-suite",
  "childPipeline": "small-feature",
  "tier": "hybrid-codex",
  "planner": {
    "runtime": "codex",
    "role": "planner",
    "threadId": "thread_portfolio_planner",
    "threadName": "OPSX portfolio planner: settings-export-suite"
  },
  "children": [
    {
      "id": "settings-export-api",
      "pipeline": "small-feature",
      "dependsOn": [],
      "status": "done",
      "mode": "parallel",
      "cohort": "A"
    },
    {
      "id": "settings-export-ui",
      "pipeline": "small-feature",
      "dependsOn": ["settings-export-api"],
      "status": "pending"
    }
  ]
}
```

## 9. 恢复策略

### 9.1 同一会话内

- Claude worker：优先 `SendMessage(agentId)`。
- Codex worker：始终 `thread/resume(threadId)` + `turn/start(followup)`。

### 9.2 跨重启

- Claude worker：`agentId` 失效，读 `transcript` 暖播种新 subagent。
- Codex worker：直接 `thread/resume(threadId)`。
- 如果 Codex thread 不存在或 app-server 无法恢复：
  1. 从 change 目录、`planning-context.md`、report 文件冷重建。
  2. 新建 thread。
  3. 在 run-state 记录 `resumeMode: "codex-cold-reconstruct"` 与 `previousThreadId`。

### 9.3 后台任务恢复

如果支持 Codex background stage，需要区分：

- `threadId`：会话恢复。
- `turnId`：中断当前 turn。
- `jobId`：OpenSpec 自己的后台 job 记录。

不要依赖 Claude plugin 的 `task-*` job id 作为 OpenSpec 权威 id。OpenSpec 应生成自己的 `opsx-codex-*` job id，并在 job record 里保存 `threadId/turnId`。

## 10. 需要修改的模块

建议分三层落地。

### 第一层：状态兼容与文档

- 扩展 `RunStateWorkerSchema`，支持 `runtime/threadId/turnId/jobId`。
- 扩展 `stageWorkers()`，让 `threadId` 也算 warm-seedable/resumable。
- 扩展 `PortfolioStateSchema.planner`，接受 Codex worker ref。
- `rasen pipeline resume --json` 输出 runtime-aware workers。
- 更新 `_orchestration.ts`：说明 Claude 与 Codex 的恢复差异。

### 第二层：Codex bridge

- 新增 `CodexAppServerClient`。
- 新增 `runCodexTurn()` / `resumeCodexTurn()` / `runCodexReview()`。
- 新增可选 broker lifecycle。
- 新增 `rasen codex setup/status` 或内部 availability check。
- 测试 fake app-server，覆盖 start/resume/failure/cancel。

### 第三层：workflow executor

- 为 pipeline stage 增加 `runtime` 等字段。
- auto/review-cycle prompt 中加入 runtime selection 规则。
- Codex propose executor：写 artifacts + validate。
- Codex review executor：结构化 findings + report 文件。
- Codex review-loop re-review：resume 原 review thread，只审 delta。

## 11. 推荐的最小可行版本

MVP 不需要一次性改完整 workflow 系统。可以按这个顺序做：

1. 只支持 `review-loop` 的 Codex reviewer。
   - read-only sandbox。
   - `threadId` 写入 `auto-run.json`。
   - 复审用同一个 `threadId`。
2. 支持 `leadReview` 方向复审。
   - 对 propose artifact 做 adversarial review。
   - 输出 `plan-review-report.md`。
3. 支持 portfolio persistent planner。
   - `portfolio-run.json.planner.runtime = "codex"`。
   - 多个 child propose 共用一个 Codex thread。
4. 最后再支持单 change propose 的 Codex planner。

这个顺序的原因是 review read-only 风险最低，可以先验证 thread resume、结果结构化、run-state 集成；planner 写文件的权限和 artifact 校验复杂度更高，适合第二阶段。

## 12. 风险与边界

- Codex `threadId` 是否长期可恢复取决于本机 Codex CLI 的会话存储；必须有冷重建 fallback。
- Codex 写文件阶段必须开启 `workspace-write`，需要明确 approval/sandbox 策略。
- Claude plugin 的 state 与 OpenSpec run-state 不能双主，OpenSpec 必须是权威。
- review-loop 中 Codex reviewer 如果也修代码，会破坏 author != verifier；MVP 应禁止 reviewer 写入。
- 并行多个 Codex stage 时，shared broker 可能 busy；需要每个 stage 独立 app-server 或 broker 队列。MVP 可串行 Codex stage。
- `review/start` 内置 review 不一定满足 OPSX 结构化 finding 需求；主路径应使用 `turn/start + outputSchema`。

## 13. 推荐决策

采用“hybrid runtime”方案：

- 保留 Claude Code 作为默认执行后端。
- Codex 作为 stage-level 可选 runtime。
- `propose` 的 persistent planner 与 `review-loop` 的 reviewer 是优先接入点。
- Run-state 中用 `runtime: "codex" + threadId` 表达 Codex 会话，不复用 Claude 的 `agentId/transcript` 概念。
- OpenSpec 内置 Codex bridge，参考 Claude Code Codex plugin 的 app-server 实现，但不把 plugin job state 当成 OpenSpec 权威状态。

这样能以最小改动保持现有 workflow 模型，同时利用 Codex 的原生 thread resume 能力，满足“多个 Propose 用同一个会话、review 修复结果用同一个 review 会话复审”的需求。
