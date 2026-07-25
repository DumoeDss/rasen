## Context

Threshold behavior currently has two independent resolution paths. Pipeline inspection resolves stage handoff and worker reuse from pipeline YAML, legacy project/store/global handoff config, model presets, and defaults. `rasen agent context` separately resolves only the legacy handoff scalar. That duplication makes it easy for threshold policy and source reporting to drift.

The predecessor change introduced a canonical runtime-adapter registry. Its probe-capable view contains `claude` and `codex`; `zed` is deliberately audit-only. This change uses that registry as the authority for runtime binding keys. The literal `default` is a fallback binding row, not a runtime adapter.

The approved product design fixes several compatibility constraints:

- A scheme packages both handoff and reuse thresholds, never model selection.
- Scheme files are machine-level and are not copied into projects or stores.
- Existing pipeline YAML and legacy handoff configuration remain valid.
- Runtime bindings are scoped project over store over global, but an explicit runtime row is considered across all scopes before any `default` row.
- A missing or invalid referenced scheme is non-fatal: warn, skip that candidate, and continue the fallback chain.
- Runtime probing, config loading, and filesystem access stay outside the threshold resolver.

## Goals / Non-Goals

**Goals:**

- Provide strict, cross-platform storage and validation for named machine-level threshold schemes.
- Add capability-safe runtime bindings at global, store, and project scope.
- Make a single synchronous pure resolver authoritative for handoff and reuse values and their sources.
- Preserve all established pipeline, legacy config, preset, and default behavior when no usable binding exists.
- Make the detected runtime and binding-aware handoff verdict observable from `rasen agent context`.
- Provide scriptable `rasen scheme list` and `rasen scheme show` inspection.

**Non-Goals:**

- Pipeline-management UI, scheme editing UI, localization, or orchestration-template prose.
- Runtime adapter discovery, keepalive policy, `AI_TOOLS`, or model routing.
- Automatic creation of a default scheme or default binding.
- A separate machine-level `reuse.threshold` configuration key.
- Package-version changes or migration of existing config files.

## Decisions

### 1. Use one strict YAML file per machine-level scheme

Schemes live at `path.join(getGlobalConfigDir(), "schemes", "<name>.yaml")`. Names use the existing profile-style rule `^[a-z0-9][a-z0-9._-]{0,63}$`; `default` is reserved because it names the fallback binding row. Path construction uses Node's path APIs, and validation happens before any path is resolved, so names cannot traverse directories on Windows, macOS, or Linux.

The strict schema is:

```yaml
handoff: 0.5
handoffRoles:
  reviewer: 0.6
reuse: 0.25
reuseRoles:
  planner: 0.3
```

`handoff` and `reuse` are required dual-form threshold values. `handoffRoles` is optional and accepts only the five pipeline roles; `reuseRoles` is optional and accepts only `planner` and `implementer`. Unknown fields are rejected. Requiring both scalar families makes every valid scheme a complete policy and ensures a selected scheme cannot silently become a handoff-only or reuse-only object.

The core scheme library will provide read, list, save, and delete operations even though this change exposes only list/show in the CLI. Saves use the same temporary-file, backup, and rename strategy as named profiles. Reads cap file size, parse YAML, and return structured invalid-entry errors rather than crashing an entire list. Listing is deterministic by name; a missing directory is an empty library. Dynamic config enum values are derived from well-formed `.yaml` filenames and return an empty list when the directory is absent or unreadable.

Alternative considered: embed schemes in global config. Separate files win because they are independently inspectable, naturally enumerable for the later management UI, and do not turn one malformed policy into an unreadable global config.

### 2. Extend wildcard families with an optional placeholder validator

`ConfigKeyDefinition` gains:

```ts
validatePlaceholder?: (segment: string, index: number) => string | null
```

`classifyWildcardPath` invokes the hook after the existing conservative identifier check and reports the returned message as an invalid placeholder. Family instance collection applies the same hook, preventing hand-edited invalid paths from surfacing as effective entries. Families without the hook retain their current behavior byte-for-byte.

The new `thresholds.bindings.<runtime>` family is settable in global, store, and project scopes. Its placeholder validator accepts the literal `default` plus only runtime IDs from the probe-capable registry view. It therefore accepts `claude` and `codex`, rejects audit-only `zed`, and cannot drift when the registry evolves. The value is a dynamically enumerated scheme name. The binding map factory returns `{}`; it never pre-creates a `default` row.

Config schemas retain syntactically valid scheme-name strings read from disk even when the local scheme file is missing. This is necessary for a project or store config shared to another machine to remain parseable and to participate in the documented dangling-reference fallback. Registry-mediated writes still validate against the locally enumerated scheme names.

Alternative considered: validate every wildcard placeholder against a referent. A per-family hook is narrower and preserves the established inert-unknown behavior for pipeline and feature-flag families.

### 3. Separate threshold values, scheme I/O, and pure resolution

A leaf threshold module owns the dual-form `ThresholdValue` schema and shared threshold roles. Existing exports from pipeline registry types remain as compatibility re-exports. A scheme module owns names, schema, and filesystem operations. A resolver module owns no filesystem or asynchronous dependency.

Callers prepare normalized layers containing:

- validated scheme definitions and invalid/missing scheme diagnostics;
- raw project, inherited-store, and global binding maps;
- configured per-stage, stage YAML, pipeline role/scalar, legacy role/scalar, preset, and default candidates as appropriate.

`resolveThreshold({ family, role?, runtime?, pipeline?, stage?, layers })` is synchronous and deterministic. It returns the selected threshold, a source label, optional binding metadata (`scope`, binding row, and scheme name), and non-fatal diagnostics for skipped dangling or invalid scheme references. Callers decide where and how to deduplicate or print warnings.

The normalized API deliberately injects all I/O-derived state. That keeps resolver tests exhaustive and lets CLI, HTTP API, and orchestration consumers share semantics without hidden environment reads.

Alternative considered: let the resolver load config and scheme files. That would make a simple precedence calculation asynchronous, difficult to test, and dependent on current working directory and machine state.

### 4. Resolve binding rows in row-first, then scope order

When `runtime` is a recognized probe-capable runtime, binding candidates are:

1. `thresholds.bindings.<runtime>` at project, store, then global scope;
2. `thresholds.bindings.default` at project, store, then global scope.

When runtime is absent or unrecognized, only the default-row candidates are considered. Each candidate whose scheme is absent or invalid emits a diagnostic and is skipped; resolution continues to the next candidate. Only after every applicable binding candidate is exhausted does resolution continue into the family-specific legacy chain.

This row-first ordering is intentional: a store-scoped explicit `codex` binding beats a project-scoped `default` binding. Ordinary project-over-store-over-global precedence remains intact within each row.

For a selected scheme, a supported role override wins over its family scalar:

- handoff: `handoffRoles[role]` then `handoff`;
- reuse: `reuseRoles[planner|implementer]` then `reuse`.

The returned source labels are scope-qualified (`project-scheme-role`, `project-scheme`, and the equivalent store/global labels). Binding metadata separately records whether selection used the runtime row or `default`.

### 5. Apply one explicit precedence chain for each consumer

Handoff stage resolution is:

1. configured `pipelines.<pipeline>.handoff.<stage>` instance;
2. stage-level pipeline YAML handoff;
3. bound scheme role value, then bound scheme scalar;
4. pipeline YAML handoff role value, then pipeline scalar;
5. legacy project role/scalar, store role/scalar, then global role/scalar;
6. model preset;
7. built-in default.

Only the threshold uses config, schemes, legacy layers, or presets. `maxRelays` and `stallLimit` continue to come from stage/pipeline YAML and built-in defaults.

Reuse role resolution is:

1. bound scheme role value, then bound scheme scalar;
2. pipeline YAML reuse role value, then pipeline scalar;
3. model preset;
4. built-in default.

The top-level resolved reuse `.threshold` has no role-specific model identity. It therefore resolves from the selected default binding row's scheme scalar, then the pipeline scalar, then the built-in default. Explicit runtime rows apply to the planner and implementer role fields using each role's effective runtime; they are not arbitrarily borrowed for the top-level summary. Reuse modes remain declared value then default.

For the role-agnostic agent probe, the detected runtime is passed to the same handoff resolver with no pipeline, stage, role, or preset candidates. A selected scheme therefore contributes its handoff scalar, followed by legacy project/store/global scalar and the built-in default.

Alternative considered: insert a bound scheme below pipeline YAML. The approved design places machine-selected runtime policy above pipeline-wide role/scalar values while retaining the stage instance and stage YAML as surgical overrides.

### 6. Keep command surfaces headless and stable

`AgentContextResult` gains the detected `runtime`, and successful text/JSON output includes it. Unavailable latest-session results keep their existing minimal shape because no transcript was detected. Threshold output uses the shared resolver's source and binding-aware result; `shouldHandoff` comparison remains unchanged and never changes the command's exit status.

`rasen scheme list [--json]` and `rasen scheme show <name> [--json]` use the scheme library directly and do not require a TTY. List output is sorted and identifies invalid entries without hiding valid ones. Show returns the parsed scheme for a valid name and exits non-zero with an actionable error for an invalid name, missing file, or malformed scheme.

Alternative considered: add editing subcommands now. Inspection is the only approved CLI surface; write APIs are prepared for the later Pipelines management surface without expanding this change's UX.

## Risks / Trade-offs

- [A shared project references a scheme absent on this machine] → Preserve the string in config, warn at resolution time, skip it, and continue through lower binding candidates and legacy layers.
- [An invalid scheme could break all inspection] → Validate each file independently and surface per-entry errors; valid schemes remain listable.
- [Wildcard validation changes regress existing families] → Make the hook optional and cover all existing families with unchanged-behavior tests.
- [Source labels become ambiguous after inserting schemes] → Use scope-qualified scheme labels and carry binding row/name as structured metadata.
- [Pipeline top-level reuse has no unique runtime] → Apply only the `default` binding row there; resolve role fields with their own effective runtimes.
- [Scheme values change while a command is resolving] → Load a command-local snapshot before calling the pure resolver; atomic saves prevent partial file reads.
- [Windows path handling diverges] → Use `path.join`/`path.resolve`, canonicalized comparisons, and Windows-safe path expectations in tests.

## Migration Plan

1. Add the scheme schema/storage library and shared threshold value exports.
2. Add the wildcard placeholder hook, binding config schema, and dynamic enum values.
3. Add normalized binding/scheme layer loading and the pure resolver.
4. Adapt pipeline handoff/reuse wrappers and agent-context reporting while retaining their public compatibility shapes where possible.
5. Register and test the headless scheme commands.
6. Run focused core/CLI tests, type checking, and the full relevant suite.

The migration is additive. With no scheme files or binding keys, every existing resolution chain returns the same values and sources as before. Rollback consists of removing binding keys from config and reverting the additive code; existing pipeline and legacy threshold config require no data conversion.

## Open Questions

None. The approved design fixes storage location, schema contents, binding precedence, fallback behavior, resolver purity, and the command scope for this change.
