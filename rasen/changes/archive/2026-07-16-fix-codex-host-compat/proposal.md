# Proposal: fix-codex-host-compat

## Why

A Codex CLI session running as the LEAD of a `rasen-auto` pipeline hits two hard failures that a Claude host never sees: (1) `rasen agent context --latest` exits non-zero when the machine has no Claude transcript for the cwd — but the auto workflow defines this probe as a non-blocking pre-flight, so a non-Claude host has to swallow an error to proceed; (2) the run-state schema rejects values a non-Claude LEAD legitimately writes (`transcript: null`, a fallback `runtime` string outside `claude|codex`), and because `readRunState` silently maps a validation failure to `null`, the symptom surfaces downstream as a misleading "No run-state (auto-run.json) found" from `rasen pipeline resume`. Non-Claude hosts driving rasen pipelines are a first-class scenario; the CLI's parse boundaries and probe exits must be host-runtime-neutral.

## What Changes

- **`rasen agent context` graceful degradation for environmental absence**: when `--latest` resolution finds no Claude projects directory or no main-session transcript (a non-Claude host's normal state), the command reports a machine-readable "unavailable" result and exits 0 instead of erroring. Input errors (invalid `--runtime`/`--limit`, an explicit `--transcript` that is unreadable or usage-free) remain hard non-zero errors.
- **Lenient run-state read boundary**: `parseRunState` normalizes host-written variance before validation — `transcript: null` is stripped to absent; a `runtime` string outside `claude|codex` is moved aside to a passthrough `runtimeRaw` field (original value preserved for observability) and `runtime` is dropped. `writeRunState` stays strict; writer guidance (auto workflow template) is updated so hosts stop writing non-canonical values in the first place.
- **Distinct "invalid run-state" reporting in `pipeline resume`**: a present-but-unparseable `auto-run.json` is reported as invalid (with the validation reason) rather than as "not found", so the residual failure mode is diagnosable.
- **Regression test for workDir-first run-state resolution**: `resolveRunStateLocation` (workDir first, sticky-legacy fallback) is already implemented and spec'd at HEAD (`src/commands/pipeline.ts:390`, `opsx-pipeline-registry` Pipeline CLI Surface); the screenshot's "can't find auto-run.json in workDir" was either the schema-rejection path above or an older installed version. Covered with a test asserting a Codex-flavored run-state in the external workDir resumes correctly end-to-end.
- **Out of scope — rasen-auto instruction length**: the generated instruction is ~90KB (auto template ~23KB + orchestration playbook ~67KB); Codex truncates the first read and falls back to segmented reads, which works. Splitting the template requires template-pipeline surgery disproportionate to this fix; declared known-open.

No version bumps.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-agent-context`: the context probe command gains a graceful-degradation contract — environmental absence under `--latest` (no transcript directory / no main-session transcript) yields an `available: false` machine-readable result with exit 0; success output gains `available: true`; input errors stay non-zero.
- `opsx-pipeline-registry`: run-state reading gains a host-tolerance requirement — the parse boundary normalizes `transcript: null` and unknown `runtime` strings instead of rejecting the file, and `resume` distinguishes an invalid run-state file from an absent one.

## Impact

- `src/core/agent-context.ts` — probe result type gains availability semantics; environmental-absence detection for `--latest`.
- `src/commands/agent.ts`, `src/cli/index.ts` — output shape and exit-code mapping for the unavailable case.
- `src/core/pipeline-registry/run-state.ts` — `parseRunState` normalization; invalid-vs-absent read distinction.
- `src/commands/pipeline.ts` — resume note for invalid run-state.
- `src/core/templates/workflows/auto.ts` (and/or `_orchestration.ts`) — writer guidance: record `runtime` only as `claude|codex`, omit `transcript` rather than writing null; probe pre-flight text references the `available: false` shape.
- Tests: `test/core/agent-context.test.ts`, `test/core/pipeline-registry/run-state.test.ts`, resume command tests.
- No API/dependency changes; no version bump (version discipline: user-owned).
