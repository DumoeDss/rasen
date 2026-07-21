## Context

The `concept-coherence` portfolio treats rasen's three concepts as two axes: schema (content), workflow (inner loop), pipeline (outer loop). Within the workflow library, the built-in entries are not homogeneous — some are inner-loop task units, some are outer-loop driver engines that consume pipelines, and some are internal sub-units of a driver. Today `rasen workflow list` shows all of them flat, which misrepresents the model and clutters the human view with sub-units a user never invokes directly.

The settled decision (portfolio #1) is a presentation-layer fix: annotate each definition with a `kind` and let `list` group and hide accordingly. Crucially, ownership does not move — drivers and internals stay in the workflow library because it is the only mechanism that can install skills/commands.

## Goals / Non-Goals

**Goals**
- Add an extensible `kind` field to `WorkflowDefinition` and assign it for all built-ins.
- Group `workflow list` by kind, hide `internal` by default, add `--all`; keep `--json` complete and kind-annotated.
- Define the default and manifest-declared kind for user workflows without breaking the package format.
- Keep digests, the golden fixture, and parity SHAs unchanged.

**Non-Goals**
- No `'expert'` kind yet (arrives with the expert-integration sibling). The union is left open for a one-line extension.
- No `requires`/dependency-graph work (that is the dependency-graph sibling).
- No deep two-axis concept doc (that is the concept-docs sibling); docs here are minimal and mechanical.
- No `manifestVersion` bump and no package min-version gate (child 5).

## Decisions

### D1. `kind` is catalog metadata, excluded from all digests

Two digest preimages exist: `digestBuiltIn` (`builtins.ts`, over `{format, version, id, dirName, skill, command}`) and `computeWorkflowDigest` (`digest.ts`, over `{format, version, id, files}`). Neither currently includes `requires`/`recommends`, and `kind` follows the same principle: it classifies the entry for presentation but does not change the installed SKILL.md or command bytes. Therefore `kind` is deliberately **not** added to either preimage.

Consequences (the "expected churn" answer): digests are byte-identical to before, so:
- `test/fixtures/workflow-registry/builtins-v1.json` is unchanged (it projects only `id/skillName/dirName/commandId`, and digests are stable anyway).
- `skill-templates-parity.test.ts` `EXPECTED_FUNCTION_HASHES` / generated-content hashes are unchanged (templates are untouched).
- No drift-healing triggers on installed machines.

The only test churn is in tests that deep-assert a full `WorkflowDefinition` object — `validator.test.ts` and `workflow-package/codec.test.ts` — which must add `kind: 'task'` to their expected definitions. This is intentional and localized.

### D2. `WorkflowKind` is a named open union

Define `export type WorkflowKind = 'task' | 'driver' | 'internal';` in `types.ts`. A named alias means adding `'expert'` later is a single-line edit. Avoid writing exhaustive `switch` statements with a `never` default on `kind` in this change, so a future member does not force cascading edits; the `list` grouping iterates a small ordered list of kinds instead.

### D3. Built-in kind assignment lives in the adapter table

Add an optional `kind?: WorkflowKind` to `BuiltInWorkflowAdapter` and set it per entry; `getBuiltInWorkflowDefinitions` writes `kind: adapter.kind ?? 'task'`. Assignments per decision #1: `auto-command`, `goal-command` → `driver`; `goal-plan`, `goal-iterate`, `goal-report` → `internal`; everything else omits it and defaults to `task`. Keeping the default implicit minimizes diff noise and matches how most entries read.

### D4. User workflows default to `task`; manifest may declare `task|internal`

`WorkflowManifestSchema` gains an optional `kind: z.enum(['task', 'internal']).default('task')`. Rationale for the restricted enum:
- `driver` implies outer-loop pipeline-consumption semantics that only built-in engines have; a user package must not claim it.
- `expert` does not exist yet.
- `task` and `internal` are both meaningful for authored packages (`internal` marks a skill-only sub-unit that other workflows call but a human should not pick directly).

The validator sets `definition.kind = manifest.kind` (which is `'task'` when omitted). Because the value lives in `workflow.yaml` — already one of the hashed `files[]` — the workflow digest and package format need no new serialized field. The package codec continues to emit `{id, files, digest}` per workflow unchanged.

**Backward/forward compatibility**: old packages (no `kind` in `workflow.yaml`) load as `task` — backward compatible. A new package that declares `kind` will be rejected by an older CLI because the manifest schema is a `strictObject` that rejects unknown keys; this new→old direction is not a guarantee rasen makes today and is the province of the package min-rasen-version gate (child 5). No action here beyond documenting it.

### D5. `list` grouping, hiding, and JSON semantics

- **Human table**: iterate kinds in a fixed order — `task`, then `driver` — printing a localized heading per non-empty section followed by its entries (existing `id / source / skillName / unused` row format retained). The `internal` section is emitted only when `--all` is passed. `--unused` filtering composes with grouping as today.
- **`--all`**: a boolean flag on `workflow list` that reveals the `internal` section. It affects only the human table.
- **`--json`**: always includes every workflow regardless of `--all`, ungrouped, each entry gaining `kind`. This preserves the machine contract: consumers see the whole catalog with kind annotations and apply their own filtering. (This satisfies workflow-library's existing "machine contracts are locale-neutral / stable" requirement — `kind` is a stable enum value.)
- **`workflow show`**: `workflowDefinitionForJson` gains `kind`; the human `show` output MAY print a localized kind label (minor, optional).

### D6. Localized section headings stay in lockstep

Section headings ("Tasks", "Drivers", "Internal") are Rasen-owned presentation, so they belong in the locale catalogs, not hardcoded. Add message keys to `WorkflowUiMessages` and populate both `en.json` and `ja.json`. Per the remove-ff implementer finding, locale catalogs are checked for parity; adding a key to one without the other breaks non-obviously. Add both in the same change.

## Risks / Trade-offs

- **Strict-manifest forward-compat wrinkle** (D4): accepted and documented; the min-version gate is a later sibling.
- **Two notions of "kind"** now coexist: package `kind` (`workflow`|`profile`) in the codec, and workflow `kind` (`task`|`driver`|`internal`) on the definition. They are unrelated; code comments should note this to prevent conflation.
- **`--all` naming**: chosen for consistency with common CLI convention; it reveals hidden (internal) entries rather than changing verbosity.

## Migration Plan

Purely additive. Existing installs and packages continue to work; `kind` defaults to `task` everywhere it is not specified. No config or artifact rewrite. First `workflow list` after upgrade simply shows grouped output with internal sub-units hidden.

## Open Questions

None — all points are settled by portfolio decision #1 and verified against the current code (post-remove-ff) shape.
