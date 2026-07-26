## Why

Rasen currently treats the worker runtime as a target-only setting and falls back to Claude even when the LEAD is running inside Codex. That mismatch sends same-host Codex work down the external `codex exec` path, leaves unrestricted Codex sessions undetected because they expose `CODEX_THREAD_ID` rather than `CODEX_SANDBOX`, and amplifies orchestration latency through Claude-oriented completion and repeated short waits.

## What Changes

- Introduce one shared, provenance-reporting LEAD-host detector with precedence `RASEN_AGENT_RUNTIME` > `CODEX_THREAD_ID` > `CODEX_SANDBOX` > `CLAUDECODE` > unknown; Codex fingerprints win over inherited Claude fingerprints.
- Resolve a stage runtime independently from its other runtime-bundle fields. Preserve the existing explicit precedence (configured role instance > stage runtime > pipeline role runtime), then inherit the detected host instead of hard-coding Claude. A model-, sandbox-, effort-, or reuse-only declaration no longer masquerades as an explicit runtime.
- Add a host × target dispatch-route contract. Same-host Claude and Codex dispatch natively; the existing Claude-host → Codex-target route continues through the verified `codex exec` bridge; unsupported pairs fail execution preflight before any worker starts.
- Extend pipeline execution inspection with host-runtime provenance, per-stage runtime provenance, and dispatch mode so LEADs and users can see both why a target runtime was selected and how it will be launched.
- Update generated orchestration guidance so Codex-native workers use native collaboration tools, rely on the automatic final completion delivery, and wait sparsely at real dependency barriers with long event-driven waits. Preserve the existing Claude Task/`SendMessage` contract and external `codex exec` lifecycle.
- Reuse the shared host detector for `rasen agent wait`, including unrestricted Codex sessions identified only by `CODEX_THREAD_ID`.
- Execution preflight rejects a known unsupported host × target combination instead of guessing a dispatcher. An unknown host retains a clearly labelled legacy-compatible fallback with an actionable diagnostic, and automation outside a recognized host can set `RASEN_AGENT_RUNTIME=claude|codex` explicitly.
- Add focused resolver, detector, route-matrix, preflight, CLI-output, keepalive, generated-template, and parity regression coverage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-adapter-registry`: Adds canonical host detection with provenance and a host × target dispatch-route registry rather than treating target eligibility as sufficient proof of dispatchability.
- `opsx-pipeline-registry`: Makes the detected host the final runtime default, reports host/runtime/dispatch provenance, and validates the complete host × target execution plan (including decompose children) before dispatch.
- `opsx-orchestration`: Selects Claude-native, Codex-native, or external Codex-exec mechanics from the resolved dispatch mode and uses Codex-native completion plus sparse event-driven waits.
- `orchestration-worker-lifecycle`: Distinguishes native Codex worker handles/completion from `codex exec` thread records and keeps runtime-specific resume/accounting guidance honest.
- `cli-agent-wait`: Detects unrestricted Codex hosts through the shared `CODEX_THREAD_ID`-aware detector while retaining its existing keepalive gate behavior.

## Impact

- Core runtime resolution and routing: `src/core/runtime-adapters.ts`, the current keepalive-local detector, pipeline runtime schemas/resolvers, role/stage override resolution, threshold runtime binding inputs, and execution validation.
- Observable surfaces: `rasen pipeline show [--for-execution]`, `rasen pipeline agents`, their JSON/human output, and execution error diagnostics.
- Generated workflow content: the shared orchestration playbook and generated skills/commands that embed it; parity hashes will change intentionally.
- Existing Claude-host runs remain Claude-native by default. Existing explicit Claude-host → Codex-target workflows retain the shipped `codex exec` bridge. Explicit runtime declarations and stored config values are not rewritten.
- Unknown-host inspection and execution remain available through an annotated legacy fallback; known unsupported pairs fail early. No persistent data migration or new dependency is required.
