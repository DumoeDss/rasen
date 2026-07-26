## 1. Host Detection and Dispatch Routes

- [x] 1.1 Add failing unit cases for `CODEX_THREAD_ID`-only Codex, inherited Claude fingerprints, explicit override, invalid override fallback, and unknown-host provenance.
- [x] 1.2 Implement the shared structured host detector and keep the existing keepalive detector API as a delegating compatibility wrapper.
- [x] 1.3 Add the typed host × target dispatch-route table (`native`, `exec-bridge`, `unsupported`, `legacy-fallback`) with exhaustive matrix tests.

## 2. Field-Wise Runtime Resolution

- [x] 2.1 Add resolver/schema tests proving that model-, sandbox-, effort-, and sessionReuse-only stage/role declarations do not create an explicit Claude runtime.
- [x] 2.2 Make object-form agent runtime optional before resolution while preserving plain-string and explicit object runtime declarations.
- [x] 2.3 Refactor stage runtime resolution to use configured role instance > stage runtime > pipeline role runtime > detected host > legacy Claude, with independent `runtimeSource`.
- [x] 2.4 Make role runtime resolution host-aware and report host versus legacy-default provenance without changing explicit configuration precedence.
- [x] 2.5 Thread the effective host-derived runtime through handoff/reuse threshold binding resolution and add tests for Claude, Codex, and unknown rows.

## 3. Shared Execution View and Observable Output

- [x] 3.1 Add a shared execution-plan/effective-stage resolver that accepts one detected host and the resolved project/store/global runtime overrides.
- [x] 3.2 Ensure parent and decompose-child stages use the same resolver inputs so display, threshold selection, and preflight cannot disagree.
- [x] 3.3 Extend `pipeline show` JSON and human output with host runtime/source plus per-stage runtime source and dispatch mode; add focused command tests.
- [x] 3.4 Extend `pipeline agents` role/stage output with host-derived defaults and dispatch modes while keeping runtime writes config-only.
- [x] 3.5 Update shared effective-stage/management handling to pass an explicit unknown-host context, preserve its existing fields, and avoid claiming a native LEAD route from the server process.
- [x] 3.6 Add and translate the human-facing runtime/route labels and diagnostics in English, Simplified Chinese, and Japanese without localizing JSON enum values.

## 4. Route-Aware Execution Preflight

- [x] 4.1 Add failing preflight tests for Codex-native no-probe, Claude→Codex single probe, Codex→Claude rejection, persisted runtime config, unknown compatibility, and decompose children.
- [x] 4.2 Refactor execution validation to detect/inject the host once and validate the shared resolved host × target plan rather than scanning target names.
- [x] 4.3 Probe Codex CLI at most once only for exec-bridge or legacy Codex-target routes, preserving the existing bounded injectable prober.
- [x] 4.4 Add actionable stable-code errors for unsupported routes and missing bridges, plus a non-fatal unknown-host compatibility notice naming `RASEN_AGENT_RUNTIME`.

## 5. Keepalive Runtime Gate

- [x] 5.1 Replace the keepalive-local fingerprint logic with the shared detector while preserving enabled/disabled gate ordering and return shapes.
- [x] 5.2 Extend keepalive tests for unrestricted Codex via `CODEX_THREAD_ID`, Codex-over-Claude precedence, explicit override, and platform-neutral environment objects.

## 6. Native Codex Worker Lifecycle and Orchestration

- [x] 6.1 Add optional canonical `dispatchMode` support to worker run-state records and tests for archived records with no new field.
- [x] 6.2 Implement conservative legacy handle inference: Codex `threadId` means exec bridge, native records use only returned native handles, and ambiguous records warn/fall back without fabrication.
- [x] 6.3 Refactor generated Step A/A.1/B guidance to consume the resolved host/dispatch mode and branch among Claude-native, Codex-native, exec-bridge, and legacy fallback.
- [x] 6.4 Add Codex-native leaf prompt/return guidance that uses the automatically delivered final `DONE`/`HANDOFF` result and reserves `send_message` for intermediate coordination.
- [x] 6.5 Add the sparse Codex-native join rule: wait only at a dependency barrier, use a long event-driven `wait_agent`, and never reflexively repeat short timeout waits.
- [x] 6.6 Preserve and regression-test the complete Claude Task/`SendMessage` lifecycle and external `codex exec` invocation/resume/failure contracts.
- [x] 6.7 Update lifecycle/run-state guidance so native Codex handles are never described as exec `threadId`s and exec mode never fabricates a turn id.
- [x] 6.8 Regenerate affected workflow/skill artifacts and update only the named parity hashes changed by the orchestration template.

## 7. Documentation and Migration Guidance

- [x] 7.1 Update the English and Chinese workflow/runtime guidance with host inheritance, explicit override precedence, the shipped route matrix, and unknown-host compatibility behavior.
- [x] 7.2 Update the Codex host diagnosis document with the implemented resolution, verification commands, and any intentionally deferred Codex TUI issue.

## 8. Verification

- [x] 8.1 Run the focused detector, runtime adapter, pipeline resolver, stage override, preflight, keepalive, command-output, run-state, and template parity test suites.
- [x] 8.2 Run TypeScript type checking, lint/format checks, and `git diff --check`, fixing only failures introduced by this change.
- [x] 8.3 Build the CLI/generated artifacts and smoke-test `pipeline show --for-execution --json` under injected Claude, Codex-thread-only, and unknown environments.
- [x] 8.4 Run the targeted applicable verification scope and `rasen validate fix-host-aware-runtime-dispatch --type change --json`; the user explicitly waived the full suite, and the intentionally cancelled full-suite attempt is not claimed as passing.
