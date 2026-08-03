## 1. Shared Bridge Primitives

- [x] 1.1 Move the leaf and evaluate JSON-Schema/Zod contracts to a runtime-neutral core module, keep the existing `src/core/codex` exports compatible, and add parity tests proving both runtimes consume the same contract objects and parsers.
- [x] 1.2 Extract the management supervisor's shell-free agent CLI resolver/spawn logic into a shared helper without changing supervisor behavior, including the Windows `.cmd` double-escaping, native executable, POSIX, `shell: false`, and `windowsHide` paths.
- [x] 1.3 Extend the shared spawn helper to support writing a bounded stdin payload followed by EOF and add tests for multiline CJK/metacharacter round-trip through the platform-specific fixture path.

## 2. Claude Exec Runtime Core

- [x] 2.1 Create the public `src/core/claude/` module surface with a recorded Claude CLI premise, injectable `claude --version` availability probe, and focused availability tests that never call the real CLI.
- [x] 2.2 Implement `buildClaudePrintInvocation` for fresh and exact-session resume calls using structured argv, JSON output/schema, model/effort/sandbox mapping, stdin prompt transport, inlined template/skill content, and a named flat-hierarchy/no-delegation guard.
- [x] 2.3 Add builder tests for prompt composition, leaf-tool denial, read-only/workspace-write flags, model/effort validation, exact `--resume`, prompt absence from argv, and path/metacharacter preservation.
- [x] 2.4 Implement strict Claude result-envelope parsing and stable failure classification for success, HANDOFF, evaluate, non-zero exit, timeout, invalid JSON, Claude error result, missing structured output, and contract-invalid output, preserving bounded/redacted `result` and `errors` diagnostics on error envelopes.
- [x] 2.5 Implement the bounded process runner with raw-byte output limits, stateful UTF-8 decoding, timeout/tree termination, one-JSON-receipt behavior, a cross-process owner-safe single-writer claim keyed by Claude session ID, and durable canonical-cwd binding; test independent-session parallelism, multi-process same-session rejection, bridge-parent death with a surviving worker tree, serialized multi-contender stale recovery, conservative pre-bind failure, and cross-process wrong-cwd rejection.
- [x] 2.6 Add the cross-platform fake Claude CLI script plus Windows `.cmd` wrapper and fixture modes covering fresh/resume identity, cwd, success/HANDOFF/evaluate, stderr/nonzero, timeout, malformed/error envelopes, and invalid contracts.

## 3. Machine Dispatch Command

- [x] 3.1 Add the machine-oriented `rasen agent dispatch --runtime claude` command with prompt-file, contract, sandbox, model, effort, cwd, timeout, resume, and JSON options wired to the core runner.
- [x] 3.2 Validate files, directories, runtime/contract enums, effort, and resume input before launch; ensure every failure exits non-zero with one bounded structured receipt and no child stream leakage.
- [x] 3.3 Add CLI integration tests against the fake binary for a complete fresh→resume chain and every failure class, including multiline/CJK prompt transport on Windows-compatible paths.

## 4. Host-Aware Routing and Preflight

- [x] 4.1 Extend dispatch routes with explicit `codex-exec` and `claude-print` bridge identities, change Codex→Claude to `exec-bridge`, and carry bridge identity through execution-stage, CLI JSON, and management inspection surfaces.
- [x] 4.2 Update execution preflight to inject and probe the required Claude or Codex bridge at most once per used bridge kind, with bridge-specific actionable unavailable errors and no external probe for native stages.
- [x] 4.3 Expand runtime/preflight/CLI tests to cover all four host-target pairs, invocation role overrides, project/store/global runtime instances, decompose children, unknown-host fallback, correct prober selection, and preservation of the other three routes.

## 5. Worker Identity and Resume State

- [x] 5.1 Extend `RunStateWorkerSchema` with optional `sessionId` and `cwd`, add a Claude exec-bridge worker-record builder, and infer archived Claude session records as exec-bridge without changing Codex or native inference.
- [x] 5.2 Treat `sessionId` as a durable resume handle in stage worker collection/warnings and add backward-compatibility tests for old native, Codex-thread, transcript-only, unknown-key, and new Claude-session records.
- [x] 5.3 Update pipeline resume JSON/human surfaces and lifecycle tests so Claude exec sessions resume by exact session ID/cwd while Claude-native agentId and Codex thread behavior stay unchanged.

## 6. Orchestration and Documentation

- [x] 6.1 Add a distinct Claude exec-bridge branch to the generated orchestration playbook: prompt-file creation, `rasen agent dispatch`, receipt parsing, run-state identity, exact-session continuation, occupancy guard, failure handling, and no native parking/SendMessage.
- [x] 6.2 Narrow existing generic exec-bridge wording to Codex where it assumes thread IDs/rollouts, and update template snapshot/semantic tests to pin all four route lifecycles and author-not-verifier behavior.
- [x] 6.3 Update `docs/artifact-workflow-guide.md` and any runtime matrix/help text to advertise Codex→Claude `claude-print`, document prerequisites and continuation/failure semantics, and remove the current explicit rejection statement.
- [x] 6.4 Regenerate shipped workflow skill outputs if required by the repository's template generation path and verify generated sources contain the Claude bridge contract without hand-edit drift.

## 7. 0.1.6 Release Surfaces

- [x] 7.1 Set the root CLI and `packages/ui` manifests to 0.1.6 in lockstep and update only tests/fixtures whose literals model the running version, preserving historical 0.1.5 examples and archived records.
- [x] 7.2 Add a non-empty `## 0.1.6` changelog entry describing the Claude bridge and route support while preserving the `Unreleased` section and release-history markers.
- [x] 7.3 Run and fix the release-contract, CLI `--version`, UI package version, and pack-version checks so every shipped version surface reports 0.1.6.

## 8. Verification and Delivery Readiness

- [x] 8.1 Run focused Claude bridge, runtime route, pipeline preflight, run-state, CLI, orchestration-template, and supervisor regression tests on the implemented tree.
- [x] 8.2 Run `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`, and the full root test suite; run UI typecheck/test/build when required by the lockstep release contract.
- [x] 8.3 Verify Windows-path and `.cmd`-shim tests are included in the normal CI matrix, run `git diff --check`, confirm no test invoked the real Claude service, and record final evidence for shipping a PR to `dev/0.1.6`.
