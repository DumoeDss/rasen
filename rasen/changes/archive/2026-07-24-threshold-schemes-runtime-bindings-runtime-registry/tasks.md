## 1. Runtime Registry Contract

- [x] 1.1 Add dependency-leaf `src/core/runtime-adapters.ts` with the immutable Claude/Codex/Zed capability matrix and exported runtime/capability types.
- [x] 1.2 Add capability-derived ordered runtime lists, non-empty schema input support, and a shared capability membership/type guard without importing consumer modules.
- [x] 1.3 Add `test/core/runtime-adapters.test.ts` coverage for the exact initial matrix, derived probe/audit/dispatch sets, deterministic ordering, unknown values, and Zed's audit-only boundary.

## 2. Probe and Audit Consumers

- [x] 2.1 Replace `agent-context.ts`'s local `TranscriptKind` allow-list and runtime override validation with the registry's probe-capable contract while preserving filename/content detection and defaults.
- [x] 2.2 Update agent-context tests to prove Claude/Codex remain valid, Zed and unknown values remain actionable errors, and implicit detection is unchanged.
- [x] 2.3 Replace the local audit runtime definitions and membership checks in `token-audit/audit.ts` and `token-audit/management.ts` with the registry's audit-capable contract while retaining explicit runtime parser/discoverer lookups.
- [x] 2.4 Replace `AuditRuntimeWire`'s handwritten union with the shared audit runtime contract and update audit/management API tests for Claude, Codex, Zed, invalid reports, and per-runtime unavailable degradation.

## 3. Dispatch, Pipeline, and Configuration Consumers

- [x] 3.1 Derive pipeline `AgentRuntimeSchema` and `AgentRuntime` from dispatch-capable registry values, preserving the Claude default and existing schema error behavior.
- [x] 3.2 Propagate the dispatch runtime type through pipeline stage overrides/resolution, command views, global/project config types and parsing, run-state schemas, and management pipeline wire types so no adjacent handwritten dispatch union remains.
- [x] 3.3 Derive `pipelines.<name>.runtimes.<role>` enum metadata and on-disk value validation from the dispatch-capable registry set rather than local Claude/Codex checks.
- [x] 3.4 Extend pipeline, config-key, project/global config, and management pipeline API tests to prove Claude/Codex round-trip unchanged while Zed and unknown runtimes are rejected at every dispatch boundary.

## 4. Compatibility Verification

- [x] 4.1 Run focused registry, agent-context, token-audit, audit management/API, config-key, project/global config, pipeline registry/command, and pipeline API test files; resolve all regressions without changing accepted runtime values.
- [x] 4.2 Run `pnpm run build` to verify core, declaration, and wire type consistency, then run lint and the full test suite.
- [x] 4.3 Inspect the final diff for duplicate targeted runtime allow-lists, accidental `AI_TOOLS` or keepalive coupling, path-separator assumptions, package-version changes, and out-of-scope scheme/binding work.
