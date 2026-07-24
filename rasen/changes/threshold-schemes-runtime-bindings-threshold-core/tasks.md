## 1. Threshold primitives and scheme storage

- [x] 1.1 Extract the dual-form threshold schema/types and role constants into a leaf core module, retaining compatibility re-exports for existing pipeline-registry consumers.
- [x] 1.2 Implement strict threshold scheme name/content validation with required handoff/reuse scalars, constrained optional role maps, the reserved `default` name, unknown-field rejection, and the existing configuration file-size limit.
- [x] 1.3 Implement cross-platform scheme paths plus read/list/save/delete operations under the global config directory, including deterministic listing, per-file invalid results, missing-directory behavior, and atomic safe writes.
- [x] 1.4 Add core tests for valid and invalid scheme data, names, malformed/oversized YAML, safe replacement, deletion, sorted mixed-validity lists, and Windows-safe `path.join` expectations.

## 2. Runtime binding configuration

- [x] 2.1 Extend wildcard key definitions, path classification, and family instance collection with the optional family-specific placeholder validator while preserving all existing family behavior.
- [x] 2.2 Add `thresholds.bindings` to global and planning-root config schemas as an empty-by-default map whose keys admit `default` plus probe-capable runtime registry IDs and whose values preserve syntactically valid scheme names from disk.
- [x] 2.3 Register `thresholds.bindings.<runtime>` for global/store/project scopes with capability-based placeholder validation and dynamically enumerated scheme values that degrade to an empty set when enumeration fails.
- [x] 2.4 Extend effective-config loading to expose raw project/store/global binding maps without collapsing the explicit runtime and `default` rows.
- [x] 2.5 Add registry/schema/effective-config tests for `claude`, `codex`, `default`, rejected `zed`, dynamic scheme values, no implicit default row, round-trips in all scopes, inherited-store behavior, dangling names, and unchanged existing wildcard families.

## 3. Pure threshold resolution

- [x] 3.1 Define normalized scheme/binding/non-binding layer inputs, scope-qualified scheme source labels, binding metadata, and non-fatal diagnostics for one synchronous `resolveThreshold` API.
- [x] 3.2 Implement row-first binding selection: explicit recognized-runtime project/store/global candidates, then default-row project/store/global candidates, skipping missing or invalid schemes with diagnostics before continuing to non-binding layers.
- [x] 3.3 Implement handoff resolution for configured stage instance, stage YAML, scheme role/scalar, pipeline role/scalar, legacy project/store/global role/scalar, preset, and default candidates.
- [x] 3.4 Implement reuse resolution for per-role runtime schemes, pipeline role/scalar, preset, and default, plus default-row-only scheme resolution for the top-level threshold and unchanged mode resolution.
- [x] 3.5 Add table-driven resolver tests for every adjacent precedence pair, dual threshold forms, role/scalar selection, explicit-row versus default-row ordering, absent/unrecognized runtime, dangling/invalid fallback, source metadata, diagnostics, determinism, and no-binding compatibility.

## 4. Pipeline and agent-context integration

- [x] 4.1 Adapt pipeline handoff and reuse wrappers to inject scheme/binding layers and effective role runtimes into the shared resolver while preserving max-relay, stall-limit, mode, and public compatibility behavior.
- [x] 4.2 Update `rasen pipeline show` and config-facing callers to load one command-local scheme/binding snapshot, surface resolved scheme sources, and report rather than fail on dangling bindings.
- [x] 4.3 Add the detected runtime to successful `AgentContextResult` values and text/JSON output while preserving the minimal unavailable shape.
- [x] 4.4 Route agent-context handoff reporting through the shared resolver with detected runtime, scheme scalar, legacy scalar layers, no role/pipeline/stage/preset candidates, and unchanged fraction/remaining-token verdict semantics.
- [x] 4.5 Add integration tests covering pipeline stage runtimes, independent planner/implementer reuse bindings, agent runtime reporting, explicit runtime override, scheme-based verdicts, warning/fallback behavior, and byte-compatible no-binding results.

## 5. Headless scheme CLI and verification

- [x] 5.1 Implement and register `rasen scheme list [--json]` and `rasen scheme show <name> [--json]` without TTY dependencies, including sorted output, invalid-entry reporting, and actionable non-zero show failures.
- [x] 5.2 Add command tests for empty libraries, valid/malformed mixed lists, JSON shapes, valid show, invalid/missing names, malformed contents, and script execution without a terminal.
- [x] 5.3 Run focused core and CLI tests, type checking, formatting/lint checks, and change validation; fix all threshold-scheme and runtime-binding regressions.
- [x] 5.4 Run the repository's Windows CI-equivalent test commands and verify every new filesystem assertion uses platform path APIs rather than hardcoded separators.
