## Why

Store planning is still resolved as one flat repository root, so callers either receive bare `changesDir`/`specsDir` paths or reconstruct them themselves. That contract cannot address Store v2 project partitions, cannot combine Store and project selection, and can silently send a project mutation to the Store integration checkout instead of one complete planning scope.

## What Changes

- Introduce one Store-planning scope resolver that freezes standalone or Store-backed ownership, project, target-line, layout, and intent before a caller reads or writes planning content.
- Replace raw-root path authority with typed planning addresses for project specs, design docs, active Changes, and Archives; retain narrow read-only projections for compatibility while callers migrate.
- Allow `--store` and `--project` together and add `--target-line` to project-scoped planning commands: the Store selector chooses the Store namespace, the project selector chooses a project planning partition inside it, and the target-line selector identifies the stable planning line; `--project` alone continues to address a registered project and follows its verified planning binding.
- Route list/show/validate/status/instructions/new, archive entry points, pipeline change lookup, context output, item discovery, and existing management read models through the same scope seam instead of joining `rasen/changes` or `rasen/specs` themselves.
- Distinguish Store aggregate reads from project-scoped reads and mutations. A project mutation without one unambiguous project scope fails with a stable diagnostic, and a Store v2 mutation without the required target-line/planning-worktree authority fails closed.
- Mint and verify Foundation v2 Change identity when a Store v2 Change is created in an authorized project scope, while legacy and standalone Change metadata remain compatible.
- Detect bound-project split planning truth and legacy flat Store layouts at routing time: existing content remains available to supported read-only commands, but new planning writes never fall back to flat or duplicate local paths.
- **BREAKING (Store v2):** `--store <id>` alone no longer grants project-mutation authority, `--store` and `--project` are no longer mutually exclusive, and Store project content no longer resolves under root-level `rasen/changes` or `rasen/specs`.
- **BREAKING (legacy flat Store):** `rasen work migrate` no longer moves legacy work files into a legacy flat Store; it fails closed with `legacy_flat_store_requires_migration` and moves nothing. The reason is not that the Store's planning tree is read-only — `new change` and `archive` still write it — but that work migration is itself a *bulk relocation of planning-owned files* (evidence, handoff, design docs) into a layout that the layout-migration slice is about to restructure. Running it first would move content twice and hand that slice a tree it has to re-inventory, so the capability is withheld until the migration it depends on exists. Retention (`rasen retain prepare`) is unaffected: it writes only execution-owned ephemera into the member checkout.

## Capabilities

### New Capabilities

- `store-planning-scope-routing`: Scope-complete selection, typed planning locations, intent-aware guards, v2 Change creation, stable diagnostics, and one routing seam for planning consumers.

### Modified Capabilities

- `store-project-namespace`: Replace selector mutual exclusion with orthogonal Store and project selection while preserving project-only namespace behavior and unambiguous follow-up hints.
- `store-config-inheritance`: Distinguish an unbound project's configuration-only Store inheritance from a bound project's Store-owned planning truth and split-truth failure.
- `planning-space-addressing`: Derive a project planning scope, not a bare Store root, from bound project checkouts and expose Store aggregate versus project-scoped reads explicitly.
- `cli-artifact-workflow`: Make status, instructions, and Change creation report and consume scope-resolved Store v2 paths and portable Change identity.
- `file-placement`: Resolve project planning files and project design docs through the selected project partition while retaining a distinct Store-level design-doc address.

## Impact

- Replaces `src/core/root-selection.ts` and `src/core/planning-home.ts` as path authorities with a Store-planning Module backed by the Foundation layout, catalog, and identity contracts.
- Updates CLI adapters and planning consumers across workflow commands, list/show/validate/archive, pipelines, context, discovery, placement, and management read models.
- Extends machine-readable root/planning context with scope identity, Store/project/target-line facts, layout state, intent, and resolved locations; compatibility fields remain non-authoritative projections.
- Adds focused Module-interface tests, cross-command contract tests, Store/standalone compatibility coverage, and Windows/POSIX path and selector matrices.
- Depends on the archived `store-planning-foundation-v2` contracts. Store layout migration, Git worktree creation/pairing, finalization outcomes, and new Store Issue/UI aggregation remain later portfolio slices.
