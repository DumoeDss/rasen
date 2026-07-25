## Context

The approved Threshold Schemes + Runtime Bindings design needs a stable runtime key space before it can validate `thresholds.bindings.<runtime>`. Today the relevant key spaces are repeated:

- `agent-context.ts` owns `TranscriptKind = 'claude' | 'codex'` and a local override validator.
- `token-audit/audit.ts` extends that type locally with Zed and validates the same strings again.
- `token-audit/management.ts` declares a second audit union and a third membership check.
- `management-api/wire-types.ts` mirrors the audit union independently.
- Pipeline runtime schemas, config-key enum metadata, config parsers, stage overrides, command views, and wire views repeat the dispatch union or equivalent checks.

The sets are intentionally not identical. Claude and Codex can be probed, audited, and dispatched. Zed can be audited but has neither a context probe adapter nor a pipeline dispatch adapter. A single boolean such as `supported` cannot express those boundaries.

The existing `AI_TOOLS` registry solves a different problem: installation paths, discovery metadata, and whether a tool is offered during setup. It contains many tools that have no session adapter and includes Hermes in the adapted install surface even though the pipeline runtime schema does not dispatch Hermes. Conflating these registries would make either install behavior or runtime capability claims inaccurate.

This slice is a prerequisite for the two later portfolio children. It establishes the registry only; it does not add schemes, binding keys, threshold resolution, or UI.

## Goals / Non-Goals

**Goals:**

- Establish one leaf-level core module as the source of runtime identity and the three independent capabilities `canProbeContext`, `canAudit`, and `canDispatch`.
- Expose stable capability-derived runtime types, ordered value lists, and membership guards for later binding/config/UI work.
- Migrate every targeted local runtime allow-list and its necessary type propagation surfaces to those derived contracts.
- Preserve the current accepted values and observable behavior: probe = Claude/Codex, audit = Claude/Codex/Zed, dispatch = Claude/Codex.
- Protect the capability matrix and each consumer boundary with focused tests.

**Non-Goals:**

- Implementing a new Claude, Codex, Zed, Hermes, or third-party adapter.
- Adding threshold schemes, runtime bindings, placeholder validation, threshold resolution, CLI scheme commands, APIs, or UI.
- Merging `AI_TOOLS`, model presets, or keepalive's `claude|codex|unknown` lifecycle gate into this registry.
- Turning the registry into a runtime plugin loader or allowing user-defined runtime ids.
- Changing package version, persisted configuration, wire payload values, command flags, defaults, or error semantics.

## Decisions

### 1. Use a keyed, immutable registry in a dependency-leaf core module

Create `src/core/runtime-adapters.ts` with a keyed `as const` registry:

| Runtime | `canProbeContext` | `canAudit` | `canDispatch` |
|---|---:|---:|---:|
| `claude` | true | true | true |
| `codex` | true | true | true |
| `zed` | false | true | false |

The module imports no context, audit, pipeline, configuration, management, or UI code. This keeps the dependency direction one-way and prevents a registry consumer from becoming part of the registry's initialization.

The keyed-object form is preferred over three separate arrays because one adapter entry shows its complete capability declaration and duplicate ids are impossible. It is preferred over a class or mutable registration API because the shipped adapters are compile-time code with type and wire consequences; dynamic mutation would make Zod schemas and TypeScript unions disagree with runtime state.

### 2. Derive both type-level and runtime capability views

The module exports stable concepts equivalent to:

- `RuntimeAdapterId`
- `RuntimeCapability`
- `ProbeRuntime`, `AuditRuntime`, and `DispatchRuntime`
- ordered `PROBE_RUNTIMES`, `AUDIT_RUNTIMES`, and `DISPATCH_RUNTIMES`
- `hasRuntimeCapability(value, capability)` as the shared type guard

Types are selected from registry entries whose literal capability is `true`; runtime arrays and guards are computed from the same registry. Schema consumers that require a non-empty tuple may use a narrowly typed helper/cast at the registry boundary, rather than recreating literals at each Zod call site.

The exported arrays are deterministic in registry declaration order so help/error text and UI/API lists remain stable. The registry module owns any conversion required to provide a non-empty enum input; consumers do not cast arbitrary string arrays themselves.

Alternative: export only the registry and let consumers filter it. Rejected because each consumer would repeat filtering, ordering, and narrowing logic—the same drift problem in a new form.

### 3. Migrate consumers by the capability they actually require

- Context transcript detection and `--runtime` validation consume `ProbeRuntime` and the probe capability guard. Their filename/content detection algorithm remains unchanged.
- Token-audit command parsing and native audit management consume the shared `AuditRuntime` and audit capability guard. Runtime-specific parsers/discoverers remain explicit implementation lookups; the registry says which implementations are valid, not how they work.
- Pipeline `AgentRuntimeSchema`, runtime config metadata, on-disk config parsing, stage override types/guards, command views, and management wire runtime types consume `DispatchRuntime` or `DISPATCH_RUNTIMES`.
- Audit wire types alias/import the shared audit runtime contract instead of mirroring a literal union.

This includes type propagation beyond the five originally identified declarations where required to eliminate a new local union immediately downstream—for example `GlobalConfig.pipelines.*.runtimes`, project-config parsing, `StageConfigOverrides`, and effective pipeline wire views. No targeted consumer retains a handwritten runtime allow-list.

Alternative: migrate only the five named lines and leave adjacent aliases as `'claude' | 'codex'`. Rejected because the next runtime addition would still compile against contradictory pipeline/wire/config types.

### 4. Keep runtime-specific behavior explicit

The registry replaces eligibility lists, not adapter implementation dispatch. Code that must choose a parser, filesystem store, or process launcher continues to use explicit lookup/switch logic, exhaustively typed by the capability-specific union.

This avoids pretending that setting `canAudit: true` automatically supplies a database discoverer or parser. Adding a future adapter is complete only when its implementation exists and its registry capability is set; the compiler and tests then expose remaining exhaustive consumer work.

### 5. Preserve compatibility and validate capability independence

No runtime value changes in this slice. Invalid values remain rejected at the same surfaces with actionable messages built from the derived eligible list. Zed remains accepted by audit surfaces and rejected by context-probe and pipeline-dispatch surfaces.

Tests cover:

- the exact initial registry matrix and the derived ordered sets;
- guards rejecting unknown strings and false-capability entries;
- context-probe override validation from `canProbeContext`;
- audit CLI, report validation, management discovery, and audit wire compatibility from `canAudit`;
- pipeline Zod schema, config-key enum metadata, on-disk config parsing, stage overrides, and wire views from `canDispatch`;
- build/type-check coverage so core and management wire types cannot drift.

No filesystem paths are introduced by the registry. Existing path-oriented tests continue to follow `test/AGENTS.md` and use `path.join`/canonicalization where applicable.

## Risks / Trade-offs

- [Risk] Type inference from filtered registry entries widens to `string[]`, weakening downstream schemas → Mitigation: centralize the typed non-empty capability-list construction in `runtime-adapters.ts` and assert inferred schemas/types in build tests.
- [Risk] A developer marks a capability true before its implementation is wired → Mitigation: exact capability-matrix tests plus consumer contract tests fail when the derived set changes without the corresponding implementation.
- [Risk] `AI_TOOLS.adapted` and `canDispatch` look superficially equivalent but currently differ for Hermes → Mitigation: document the distinct domains in module comments and do not import `AI_TOOLS` into the runtime registry.
- [Risk] Converting wire aliases to imported core types creates a circular dependency → Mitigation: keep `runtime-adapters.ts` dependency-free and type-only import it from wire modules.
- [Trade-off] The registry is compile-time rather than dynamically extensible → Accepted because adapter support requires shipped parser/probe/dispatch code and synchronized TypeScript/wire contracts; user-defined ids would be misleading.

## Migration Plan

1. Add the dependency-leaf registry and its direct unit tests.
2. Migrate probe and audit consumers, preserving existing runtime-specific implementation branches.
3. Migrate pipeline schema/config/type propagation and management wire aliases.
4. Run focused agent-context, audit, management API, config-key, pipeline, and new registry tests, then run the package build and broader test suite.

There is no data migration. Rollback is the inverse code refactor because no persisted format or accepted value changes.

## Open Questions

None for this slice. The capability matrix and separation from schemes, bindings, keepalive settings, and `AI_TOOLS` are locked by the approved parent design.
