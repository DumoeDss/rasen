## Why

Rasen can choose a Claude Code or Codex runtime and a model per workflow stage, but it cannot safely bind that stage to a different configured Provider or subscription account without relying on the CLI's global login and provider configuration. Integrating with a resident OmniCross daemon lets workflows select heterogeneous upstreams per stage while keeping upstream credentials, protocol conversion, and ephemeral route tokens out of Rasen's durable state and the user's global CLI files.

## What Changes

- Add a typed `inference` declaration for pipeline stages that selects OmniCross and a credential-free upstream resource while continuing to use the stage's existing effective model resolution.
- Freeze the resolved runtime, upstream, model, broker endpoint reference, and optional broker revision into executable stage/action state so retries and resume cannot drift to another logical route.
- Add an OmniCross Route Lease consumer that discovers a loopback daemon from Rasen configuration, authenticates through an environment-backed control credential, validates versioned lease responses, renews long-running leases, and releases them without persisting launch secrets.
- Wrap Claude and Codex dispatch with the lease lifecycle: create before process spawn, inject only validated runtime-specific environment/arguments, fail closed before spawn on broker errors, and best-effort release after success, failure, timeout, or cancellation.
- Extend `rasen agent dispatch` and pipeline execution metadata so orchestrated stages can carry the frozen inference selection through fresh and resumed Claude/Codex turns without requiring a hand-authored OmniCross downstream key or binding.
- Redact Route Lease and control secrets from receipts, diagnostics, logs, run-state, and telemetry, while retaining safe lease identity, upstream, model, and failure classification for operators.
- Preserve all existing execution behavior when a stage has no OmniCross inference declaration; never read or modify Codex `auth.json`/`config.toml` or Claude credential/settings files.
- Treat the OmniCross daemon Route Lease endpoints and `env_key` launch descriptor as an external dependency. This change consumes and tests the contract with fakes; implementing the daemon endpoints, remote/TLS daemons, workflow editing UI, and paid-provider end-to-end tests remain deferred to OmniCross/productization work.

## Capabilities

### New Capabilities

- `omnicross-inference-routing`: Configures and consumes authenticated, loopback OmniCross Route Leases with frozen logical routing, bounded lifecycle management, fail-closed recovery, and secret-safe diagnostics.

### Modified Capabilities

- `opsx-pipeline-registry`: Pipeline stages can declare typed inference intent and execution inspection exposes the resolved, credential-free inference selection.
- `runtime-adapter-registry`: An OmniCross-routed stage uses a controllable runtime process bridge even when its target runtime matches the LEAD host, because native subagents cannot receive an isolated per-stage process environment.
- `frozen-action-session-executor`: Granted agent actions preserve the logical inference route and the production dispatch seam uses it on fresh execution and resume without persisting lease secrets.
- `codex-exec-runtime`: Codex dispatch accepts a validated per-turn OmniCross provider binding and environment, including resume, without using OpenAI login state or user configuration files.
- `claude-exec-runtime`: Claude dispatch accepts a validated per-turn OmniCross environment binding, including exact-session continuation, without modifying Claude settings or credentials.

## Impact

- Affected modules include `src/core/pipeline-registry/`, `src/core/runtime-adapters.ts`, `src/core/change-run/`, `src/core/frozen-action-executor/`, `src/core/codex/`, `src/core/claude/`, `src/commands/agent.ts`, CLI presentation/completions, configuration registry/resolution, generated orchestration instructions, and a new `src/core/omnicross/` deep module.
- The implementation depends on OmniCross's versioned `/admin/api/route-leases` create/renew/delete contract, Codex `env_key` launch descriptor, loopback control-plane authentication, and stable structured errors; those server-side capabilities are not implemented in this repository.
- Tests add schema/normalization coverage, fake-daemon HTTP integration, Claude/Codex spawn assertions, lifecycle and resume cases, concurrency isolation, redaction scans, and compatibility coverage for stages without `inference`.
- Architecture-index quick-locate and AI/workflow module documentation must be updated when the new core module and execution seams land.
