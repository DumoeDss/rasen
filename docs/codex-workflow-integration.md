# Feasibility Plan for Integrating Codex into the OPSX Workflow

> Date: 2026-06-08  
> Background: The current main path of the OPSX workflow is built on Claude Code subagents + `SendMessage`. This document analyzes how to introduce Codex into stages such as `propose` and `review` / `review-loop`, and how to support launch, parameter passing, result reception, same-stage session reuse, and cross-restart recovery.

## 1. Conclusion

Feasible. Moreover, we do not recommend invoking Codex as an ordinary `/codex:*` slash command. A more robust approach is to abstract Codex as a second worker runtime for OPSX:

- Claude worker: the current `Task` / subagent / `SendMessage` mechanism.
- Codex worker: driven through the Codex app-server's `thread/start`, `turn/start`, and `thread/resume`.

In other words, the pipeline's DAG, stages, gates, and run-state continue to be managed centrally by OpenSpec/OPSX; each stage merely gains an optional execution backend `runtime: claude | codex`. Codex's session-reuse unit is not Claude's `agentId + transcript` but Codex's `threadId`, and across restarts you can `thread/resume` straight into the same thread — closer to true resumption than warm-seeding a Claude subagent from its transcript.

The stages best suited to adopt Codex first:

1. `propose` planner: use a persistent Codex thread to reuse codebase-research context across multiple child proposes.
2. `verify` / `review-loop` reviewer: use Codex for independent review; when re-reviewing a fix, resume the same review thread and review only the delta.
3. `leadReview` adversarial review: use a read-only Codex to challenge from a non-author direction — low cost, clear boundaries.

We do not recommend letting Codex take on `apply` / `fixer` code-writing in the first phase, unless there is already a clear sandbox/approval policy and file-write auditing. Start with read-only review and artifact-producing propose — the lowest risk.

## 2. Current constraints

The current design in `docs/opsx-workflow-guide.md` and `_orchestration.ts` is built on Claude Code capabilities:

- `LEAD` orchestrates; workers are leaf subagents.
- Within the same live session, use `SendMessage` to continue a conversation with the same worker.
- After a restart, a Claude subagent's `agentId` is no longer a live handle; you can only read the `agent-<agentId>.jsonl` transcript to warm-seed a new worker.
- `auto-run.json` records `role` / `agentId` / `transcript` for each stage.
- `portfolio-run.json` records the propose-specific persistent planner in its top-level `planner`.
- `rasen pipeline resume <change> --json` reads the run-state and exposes `workers`, `inProgressStages`, `openFindings`, and the portfolio's `planner`.

The local Codex plugin for Claude Code already provides another model:

- Uses the local `codex` CLI's `codex app-server`.
- Calls `thread/start`, `turn/start`, `thread/resume`, `review/start`, `turn/interrupt` via JSON-RPC.
- `runAppServerTurn()` can start or resume a thread, returning `threadId`, `turnId`, `finalMessage`, `fileChanges`, `commandExecutions`.
- `runAppServerReview()` can start the built-in review, returning `threadId`, `sourceThreadId`, `reviewText`.
- The plugin's task mode defaults to `persistThread: true`, so the `threadId` can be used to continue the task.
- The plugin already implements job state, a background worker, result/status/cancel, and a broker that reuses the app-server runtime.

Therefore, Codex does not need to emulate Claude's `SendMessage`. Codex's native unit of recovery should be the `threadId`.

## 3. Recommended architecture

### 3.1 Add a Codex bridge rather than depending directly on the Claude plugin's commands

We recommend adding a lightweight bridge inside the OpenSpec repository:

```text
src/core/ai-runtimes/
  codex/
    app-server-client.ts
    codex-worker.ts
    codex-state.ts
```

It can start by porting / adapting the key implementations from the plugin:

- `CodexAppServerClient`
- `runAppServerTurn`
- `runAppServerReview`
- `interruptAppServerTurn`
- broker lifecycle, optionally reused

We do not recommend directly shelling out to `node <plugin>/scripts/codex-companion.mjs task ...` as the primary implementation, for these reasons:

- Plugin state lives under `CLAUDE_PLUGIN_DATA` or a temp directory by default, with its lifecycle bound to the Claude plugin — not suitable as OpenSpec's authoritative state.
- OPSX needs to write results into `auto-run.json`, `portfolio-run.json`, and stage artifacts; calling a slash-command-style tool directly adds an extra layer of state synchronization.
- The Codex plugin targets humans (`/codex:status` / `/codex:result`), whereas OPSX needs a machine-controllable stage executor.

In the short term the plugin can serve as a reference implementation or prototype; in the long term an OpenSpec-internal bridge should be built in.

### 3.2 Stage executor abstraction

Abstract "dispatch a stage" into a unified interface:

```ts
interface StageExecutor {
  runtime: 'claude' | 'codex';
  start(input: StageRunInput): Promise<StageRunResult>;
  resume(input: StageResumeInput): Promise<StageRunResult>;
  cancel?(ref: StageRuntimeRef): Promise<void>;
}
```

The Claude executor corresponds to the existing subagent prompt. The Codex executor does the following:

- If there is no `threadId`: `thread/start`, then `turn/start(prompt)`.
- If a `threadId` already exists: `thread/resume(threadId)`, then `turn/start(followupPrompt)`.
- Select the sandbox based on the stage type:
  - `propose`: recommend `workspace-write`, because it must write `proposal.md` / `design.md` / `specs` / `tasks.md`.
  - `review` / `leadReview`: `read-only`.
  - `fixer` / `apply`: open up `workspace-write` later.
- The stage prompt must require Codex to write canonical artifacts into the change directory, not just answer in the final message.

### 3.3 Pipeline configuration extension

Add optional fields to stages:

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

Suggested field semantics:

| Field | Meaning |
|---|---|
| `runtime` | `claude` by default; `codex` means the stage is handed to the Codex executor |
| `sessionReuse` | `none` / `stage` / `run-planner` / `review-thread` |
| `sandbox` | Optional override: `read-only` / `workspace-write` |
| `model` / `effort` | Optional Codex model and reasoning effort |
| `outputSchema` | Optional; review-style stages require structured JSON |

If you don't want to change the pipeline schema in the first phase, you can instead start with a global policy toggle:

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

In the long run, however, moving this into the pipeline data model is recommended, so that different pipelines can declare their execution backend explicitly.

## 4. Run-state design

The current `RunStateSchema` is `passthrough()`, so it can tolerate new fields. We recommend extending the worker record into a runtime-aware reference:

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

A Claude-compatible worker:

```json
{
  "runtime": "claude",
  "role": "reviewer",
  "agentId": "agent_xxx",
  "transcript": ".../agent-agent_xxx.jsonl"
}
```

We recommend extending `RunStateWorkerSchema` from accepting only `role/agentId/transcript` to:

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

At the same time, change `stageWorkers()` to return whichever resumable reference applies:

- Claude: `agentId || transcript`
- Codex: `threadId`

The output of `rasen pipeline resume --json` can still be called `workers`, but each entry carries a `runtime`, for example:

```json
{
  "workers": {
    "propose": { "runtime": "codex", "role": "planner", "threadId": "thread_xxx" },
    "verify": { "runtime": "claude", "role": "reviewer", "agentId": "agent_yyy", "transcript": "..." }
  }
}
```

This lets the LEAD / auto workflow decide, based on `runtime`, whether to do a `thread/resume` or a transcript warm-seed.

## 5. Propose stage integration

### 5.1 Single change

First propose:

1. LEAD writes `rasen/changes/<id>/planning-context.md`.
2. The Codex bridge creates a persistent thread:
   - `thread/start({ cwd, sandbox: "workspace-write", ephemeral: false, threadName })`
   - `turn/start({ prompt })`
3. The prompt requires Codex to:
   - Read `planning-context.md`.
   - Generate `proposal.md` / `design.md` / `specs/<cap>/spec.md` / `tasks.md`.
   - Append key findings to `planning-context.md`.
   - Return only a summary, the list of files written, and validation suggestions in the final message.
4. LEAD runs `rasen validate <change> --strict` or at least `rasen status --change <id> --json` for structural validation.
5. The Codex thread is written to `stages.propose.worker.threadId` in `auto-run.json`.

Resuming the same propose later:

1. `rasen pipeline resume <change> --json` returns the propose worker's `threadId`.
2. The Codex bridge calls `thread/resume(threadId)`.
3. `turn/start("Continue the propose stage...")`, attaching the list of artifacts currently missing or needing revision.

### 5.2 decompose / multi-child propose

This is where Codex is most valuable. The current Claude design reuses one persistent planner across all child proposes. Codex can realize this more naturally:

- `portfolio-run.json.planner` records the Codex planner thread:

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

- Child #1 propose: on the same planner thread, request generation of child #1's artifacts.
- Child #2 propose: `thread/resume(thread_planner_xxx)`, prompting it — already aware of child #1's interface commitments — to generate child #2 consistently.
- Each round still requires appending to `planning-context.md`, serving as an auditable digest and fallback.

When the planner thread grows too long:

1. Ask the current Codex thread to write a compact `planning-context.md` digest.
2. Start a new Codex thread.
3. Use the digest + sibling artifacts as the seed.
4. Update `portfolio-run.json.planner.threadId`, keeping `previousThreadIds` as an audit extension field.

## 6. Review / review-loop integration

### 6.1 Ordinary verify review

Two Codex review modes are available:

1. `review/start`: the Codex app-server's built-in review, suited to workspace-diff / base-branch review, returning `reviewText`.
2. `turn/start` + a custom prompt + `outputSchema`: suited to the structured findings OPSX needs, scoped to a specific change and checked against specific spec scenarios.

OPSX recommends the second as the primary path, because review-loop needs structured findings:

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

The Codex review thread writes:

- `rasen/changes/<id>/review-report.md`
- `auto-run.json.stages.verify.worker.threadId`
- `auto-run.json.openFindings`

### 6.2 review-loop initial review, fix, re-review

Initial review:

1. A read-only Codex reviewer thread reviews the current diff + proposal/spec/tasks.
2. It emits structured findings and writes `review-cycle-report.md` or `review-report.md`.
3. Record `reviewLoop.reviewer.threadId` or `stages.review-loop.worker.threadId`.

Fix:

- In the first phase, the Claude implementer/fixer should still own the fix, preserving the current author/verifier separation model.
- After the fix, LEAD computes the fix delta and writes it to `rasen/changes/<id>/review-delta-round-<n>.md`.

Re-review:

1. Resume the original Codex reviewer thread:
   - `thread/resume(originalReviewThreadId)`
   - `turn/start("Re-review only this delta...")`
2. The prompt must be explicit:
   - Do not re-review the entire codebase.
   - Judge whether each finding is resolved based only on the original findings + this round's delta.
   - Do not accept the fixer's self-attestation.
3. Codex outputs `resolved | still_open | superseded` for each finding.
4. LEAD updates `openFindings` and the round history.

This satisfies the core requirement of the current `review-cycle`: the re-reviewer is not the fixer, and the re-review carries the original context.

### 6.3 Relationship with Claude's `SendMessage`

If the reviewer is a Claude worker:

- Within the same session, keep using `SendMessage`.
- Across restarts, warm-seed from the transcript.

If the reviewer is a Codex worker:

- Both within a session and across restarts, use `thread/resume(threadId)`.
- No transcript warm-seeding needed.
- `threadId` is the resumable asset; `turnId` is the current-turn / cancel asset.

Therefore the run-state must distinguish runtimes; a Codex `threadId` must not be stuffed into `agentId`.

## 7. Launch, parameter passing, result reception

### 7.1 Launching Codex

Launch directly:

```text
codex app-server
```

Via the app-server JSON-RPC:

- `initialize`
- `thread/start`
- `turn/start`
- `thread/resume`
- `turn/interrupt`

We recommend reusing the plugin's broker approach:

- Within one OPSX run, reuse a single app-server broker as much as possible, to avoid repeatedly spinning up Codex for each stage.
- The broker only reuses the runtime connection; it is not the authoritative state.
- Authoritative state is still written to `auto-run.json` / `portfolio-run.json`.

### 7.2 Parameter passing

The Codex stage prompt should be generated by OpenSpec, not assembled ad hoc. We recommend including these fixed blocks:

- role: planner/reviewer/fixer.
- change: the change id and directory.
- stage contract: which files must be read and which must be written.
- current artifacts: a summary from `rasen show <change>` / `rasen status --json`.
- scope: diff / base branch / current working tree.
- resume context: if this is a resume, note that the previous-round thread already has context, and attach this round's delta / missing artifacts.
- output contract: the final-message format; reviews may carry a JSON schema.

### 7.3 Result reception

The Codex bridge returns:

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

The LEAD / executor must do a second-pass confirmation:

- artifact stage: check that the target files actually exist.
- propose: run `rasen validate <change>` or `rasen status --json`.
- review: parse the final JSON or check the report file.
- write-sandbox stage: record `touchedFiles` and require a human gate when necessary.

## 8. State-file examples

### 8.1 Single-change `auto-run.json`

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

## 9. Recovery strategy

### 9.1 Within the same session

- Claude worker: prefer `SendMessage(agentId)`.
- Codex worker: always `thread/resume(threadId)` + `turn/start(followup)`.

### 9.2 Across restarts

- Claude worker: the `agentId` is invalid; read the `transcript` to warm-seed a new subagent.
- Codex worker: `thread/resume(threadId)` directly.
- If the Codex thread does not exist or the app-server cannot resume it:
  1. Cold-reconstruct from the change directory, `planning-context.md`, and report files.
  2. Create a new thread.
  3. Record `resumeMode: "codex-cold-reconstruct"` and `previousThreadId` in the run-state.

### 9.3 Background-task recovery

If Codex background stages are supported, the following must be distinguished:

- `threadId`: session recovery.
- `turnId`: interrupting the current turn.
- `jobId`: OpenSpec's own background job record.

Do not rely on the Claude plugin's `task-*` job id as OpenSpec's authoritative id. OpenSpec should generate its own `opsx-codex-*` job id and store `threadId/turnId` in the job record.

## 10. Modules to modify

We recommend landing this in three layers.

### Layer 1: State compatibility and documentation

- Extend `RunStateWorkerSchema` to support `runtime/threadId/turnId/jobId`.
- Extend `stageWorkers()` so that `threadId` also counts as warm-seedable / resumable.
- Extend `PortfolioStateSchema.planner` to accept a Codex worker ref.
- Have `rasen pipeline resume --json` emit runtime-aware workers.
- Update `_orchestration.ts`: document the difference between Claude and Codex recovery.

### Layer 2: Codex bridge

- Add `CodexAppServerClient`.
- Add `runCodexTurn()` / `resumeCodexTurn()` / `runCodexReview()`.
- Add an optional broker lifecycle.
- Add `rasen codex setup/status` or an internal availability check.
- Test against a fake app-server, covering start/resume/failure/cancel.

### Layer 3: Workflow executor

- Add fields such as `runtime` to pipeline stages.
- Add runtime-selection rules to the auto/review-cycle prompts.
- Codex propose executor: write artifacts + validate.
- Codex review executor: structured findings + report file.
- Codex review-loop re-review: resume the original review thread and review only the delta.

## 11. Recommended minimum viable version

The MVP does not need to change the entire workflow system at once. It can be done in this order:

1. Support only the Codex reviewer for `review-loop`.
   - read-only sandbox.
   - The `threadId` is written to `auto-run.json`.
   - Re-review reuses the same `threadId`.
2. Support `leadReview` adversarial review.
   - Adversarially review the propose artifacts.
   - Emit `plan-review-report.md`.
3. Support the portfolio persistent planner.
   - `portfolio-run.json.planner.runtime = "codex"`.
   - Multiple child proposes share one Codex thread.
4. Finally, support the Codex planner for single-change propose.

The rationale for this order: read-only review is the lowest risk, so it can validate thread resume, structured results, and run-state integration first; the planner's file-write permissions and artifact validation are more complex and fit a second phase.

## 12. Risks and boundaries

- Whether a Codex `threadId` is recoverable long-term depends on the local Codex CLI's session storage; a cold-reconstruct fallback is mandatory.
- Codex file-writing stages must enable `workspace-write`, requiring a clear approval/sandbox policy.
- The Claude plugin's state and OpenSpec's run-state must not both be authoritative; OpenSpec must be the source of truth.
- If the Codex reviewer in review-loop also modifies code, it breaks author != verifier; the MVP must forbid the reviewer from writing.
- When multiple Codex stages run in parallel, a shared broker may be busy; each stage needs its own app-server, or a broker queue. The MVP can run Codex stages serially.
- The built-in `review/start` review may not meet OPSX's structured-finding needs; the primary path should use `turn/start + outputSchema`.

## 13. Recommended decision

Adopt the "hybrid runtime" approach:

- Keep Claude Code as the default execution backend.
- Codex as an optional stage-level runtime.
- The `propose` persistent planner and the `review-loop` reviewer are the priority integration points.
- Express Codex sessions in run-state as `runtime: "codex" + threadId`, without reusing Claude's `agentId/transcript` concept.
- Build a Codex bridge into OpenSpec, referencing the Claude Code Codex plugin's app-server implementation, but do not treat the plugin's job state as OpenSpec's authoritative state.

This preserves the existing workflow model with minimal change while leveraging Codex's native thread-resume capability, satisfying the need for "multiple proposes sharing one session, and re-reviewing a fix's result in the same review session."
