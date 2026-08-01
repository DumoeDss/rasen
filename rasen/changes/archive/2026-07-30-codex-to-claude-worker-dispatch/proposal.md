## Why

Rasen currently rejects every Codex-hosted pipeline stage that explicitly targets Claude, even though Claude Code already exposes a non-interactive, resumable CLI suitable for a bridge. This leaves mixed-runtime pipelines asymmetric and makes the 0.1.6 release line report version 0.1.5 despite being the intended delivery target.

## What Changes

- Add a cross-platform Claude exec bridge that a Codex-hosted LEAD can launch without shell interpolation, with built-in structured-return contracts, bounded process handling, and machine-readable success or failure receipts.
- Make Claude bridge sessions resumable by their exact Claude session ID while preserving the session working directory and enforcing one active writer per session.
- Change Codex→Claude routing from `unsupported` to the Claude exec bridge and make execution preflight probe the CLI required by each bridge without regressing Claude-native, Claude→Codex, or Codex-native routes.
- Extend the generated orchestration playbook and user documentation with the Claude bridge launch, identity, failure, continuation, and recovery lifecycle.
- Advance the lockstep CLI/UI package release metadata and release notes to 0.1.6.

## Capabilities

### New Capabilities

- `claude-exec-runtime`: Non-interactive Claude worker invocation, structured result capture, session identity, failure handling, and explicit-session continuation for cross-host dispatch.

### Modified Capabilities

- `runtime-adapter-registry`: Codex-hosted Claude targets resolve to the shipped Claude exec bridge instead of an unsupported route.
- `opsx-pipeline-registry`: Execution preflight validates availability of the runtime-specific bridge required by the final host-aware plan.
- `opsx-orchestration`: The LEAD dispatches and resumes Claude exec-bridge workers according to the preflighted route and records their durable identity.
- `orchestration-worker-lifecycle`: Run-state and resume logic distinguish Claude exec-bridge sessions from Claude-native agent handles and Codex exec threads.

## Impact

- Affects runtime route resolution, pipeline execution plans and preflight, run-state worker identity, generated workflow templates, and host-aware documentation.
- Adds a Claude bridge runner and test-only Claude CLI shims; no real Claude request is required by the automated tests.
- Updates `package.json`, `packages/ui/package.json`, release notes, and current-version test expectations to 0.1.6 while retaining `dev/0.1.6` as the PR base.
- Introduces no pipeline schema break and preserves the existing three supported host/target routes.
