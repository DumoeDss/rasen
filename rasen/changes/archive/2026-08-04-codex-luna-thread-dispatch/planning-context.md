# Planning context

## User intent

Add first-class support for using Codex Luna Max as an isolated worker thread in Rasen's LEAD + subagent architecture. The work should expose model reasoning-effort configuration, avoid the observed external Codex process hang, and ship as a pull request targeting `dev/0.2.0`.

## Established runtime findings

- Current Codex documentation supports custom agents with `model = "gpt-5.6-luna"` and `model_reasoning_effort = "max"`.
- A direct `codex exec` Luna Max process succeeds when stdin is explicitly closed. Two independent Luna Max processes also run concurrently.
- A Luna thread can be resumed from a new process with `codex exec resume <thread-id>` while retaining its thread id.
- Codex native v2 can spawn a custom Luna agent when it is created without a full-history fork. A full-history fork cannot switch agent type/model because it inherits the parent type.
- The reported post-completion hang was not reproduced once stdin was closed. Existing repository evidence already identifies inherited/open stdin as the cause of a prompt process waiting for additional input.
- Luna startup has meaningful context cost, so the design should support bounded task batching instead of encouraging a fresh process for every microtask.

## Relevant existing code

- `src/core/pipeline-registry/types.ts` already accepts stage and `agents.<role>` effort declarations and resolves stage effort.
- `src/core/codex/invocation.ts` already renders `-c model_reasoning_effort=...` and declares ignored stdin in the invocation description.
- `src/core/effective-config.ts` resolves model defaults/role overrides but does not provide a symmetric machine/project effort layer.
- `src/commands/agent.ts` exposes `rasen agent dispatch` options for runtime/model/effort/resume, but currently implements only Claude dispatch.
- `src/core/templates/workflows/_orchestration.ts` describes native Codex spawning without making the resolved model/effort and no-full-history constraint operationally explicit.

## Scope and constraints

- Work only in the `feat/codex-luna-thread-dispatch` worktree based on `origin/dev/0.2.0`.
- Preserve cross-platform behavior on Windows, macOS, and Linux; use Node path/process APIs and explicitly closed stdin.
- Prefer extending existing Codex invocation and dispatch abstractions over introducing a parallel ad-hoc launcher.
- Preserve strict leaf-worker isolation and structured completion contracts.
- Model/effort configuration must have explicit, testable precedence and validation.
- The planner should decide whether the same-runtime external Codex process is represented by the existing `exec-bridge` mode or needs a narrowly scoped new route, minimizing schema churn.
- Do not depend on PR #133 (`feat/session-cache-optimization`); it is a separate, frozen Claude resident-process optimization.
- Do not modify global user agent configuration as part of this repository change.

## Delivery

- Pipeline: `small-feature`.
- Gate policy: off from global configuration.
- Target pull request base: `dev/0.2.0`.

## User clarification

- The capability is generic Codex worker configuration, not a Luna-only integration.
- Users must be able to select `gpt-5.6-luna`, `gpt-5.6-terra`, or another non-empty Codex model id and configure reasoning effort independently.
- Luna Max remains the primary runtime probe and acceptance example; model discovery and a built-in model allow-list remain out of scope.

## Planner decisions

- Represent every external Codex process/thread as the existing `exec-bridge` dispatch mode and expose it through `rasen agent dispatch --runtime codex`; do not add a Luna-specific route or pipeline dispatch-mode field.
- The first-class Codex runner will transport the assembled prompt through bounded stdin and close it with EOF, then return one bounded structured receipt; exact-thread resumes use durable cross-process one-writer ownership.
- Add `efforts.default`, `efforts.roles.<role>`, and `pipelines.<name>.efforts.<stage>` with stage-instance > stage YAML > pipeline role > project > inherited store > global > runtime-default precedence and independent `effortSource` provenance. Native Codex model/effort overrides use a no-history fork; process-backed workers keep exact-thread resume.
