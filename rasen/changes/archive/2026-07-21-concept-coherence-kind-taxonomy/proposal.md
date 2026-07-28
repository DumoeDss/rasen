## Why

`rasen workflow list` presents every built-in workflow as one undifferentiated flat list, even though the entries play three different roles. Most are **task** units (an internal-loop operation an agent runs in a session: `propose`, `apply`, `verify`, …). Two are **driver** engines that consume pipelines and drive the outer loop (`auto-command`, `goal-command`). Three are **internal** sub-units that exist only to be invoked by a driver and are noise in a human-facing list (`goal-plan`, `goal-iterate`, `goal-report`).

This is a presentation-layer gap, not a structural one: all three roles must stay in the workflow library because it is the only mechanism with install capability (moving drivers/internals elsewhere would mean building a second installer). The fix is to make the role explicit as a `kind` field and let `list` group by it and hide the internal sub-units by default. This is the settled portfolio decision #1 and the second sibling in the `concept-coherence` chain (it shares `builtins.ts` with the already-landed `remove-ff`, hence it runs after it).

## What Changes

### 1. Add a `kind` classification to workflow definitions

- Add `kind: WorkflowKind` to `WorkflowDefinition`, where `WorkflowKind = 'task' | 'driver' | 'internal'` (a named union so a later sibling can add `'expert'` with a one-line edit — do NOT add `'expert'` now).
- Assign built-in kinds in the adapter table: `auto-command` and `goal-command` = `driver`; `goal-plan`, `goal-iterate`, `goal-report` = `internal`; all others = `task`.
- `kind` is catalog/presentation metadata: it does NOT enter the built-in digest preimage (`digestBuiltIn`) or the user-workflow digest (`computeWorkflowDigest`). This keeps installed-artifact identity stable — no drift-healing churn, no golden-fixture change, no parity-SHA regeneration.

### 2. Default kind for user/imported workflows

- User workflows default to `kind: 'task'` when their manifest does not declare one (backward compatible: existing `workflow.yaml` files without the field keep validating).
- The `workflow.yaml` manifest MAY optionally declare `kind`, restricted to `'task' | 'internal'` (default `'task'`). `driver` is reserved for built-in outer-loop engines and is not a valid user-declared kind; `expert` does not exist yet. An out-of-range value is a strict manifest validation error.
- No package-format break: the package codec serializes each workflow as `{id, files, digest}`, and a declared `kind` rides inside `workflow.yaml` (already hashed into the workflow digest). No new serialized field, no `manifestVersion` bump. (Forward-compat note: because the manifest schema is strict, a package whose `workflow.yaml` declares `kind` will be rejected by an older CLI that predates the field; the general min-rasen-version gate is child 5's concern and is out of scope here.)

### 3. `rasen workflow list` groups by kind and hides internal

- Human table output groups entries into a **task** section and a **driver** section, each with a localized heading; `internal` workflows are hidden by default.
- Add an `--all` flag that additionally reveals the `internal` section. `--all` affects only the human table.
- `--json` output is unchanged in coverage: it always lists every workflow (task, driver, and internal), ungrouped and unhidden, with a new `kind` field on each entry, regardless of `--all`. Machine consumers always see everything, annotated by kind.
- `workflow show` / `workflow show --json` gains the `kind` field via `workflowDefinitionForJson`.
- New localized section-heading strings are added to the workflow UI messages and both locale catalogs (`en.json`, `ja.json`) in lockstep.

### 4. Docs

- Add a short, mechanical kind-taxonomy subsection to the workflow-library docs (en + zh) describing the three kinds and the `list` grouping/`--all` behavior. The deep two-axis concept doc is child 3's job — keep this minimal.

## Capabilities

### Modified Capabilities

- `workflow-library`: workflow definitions carry a `kind`; `list` groups by kind, hides `internal` by default, adds `--all`; JSON always exposes all workflows with `kind`; digests exclude `kind`; user workflows default to `task` and may declare `kind` in the manifest.

## Impact

- `src/core/workflow-registry/types.ts` — add `WorkflowKind` type and `kind` field
- `src/core/workflow-registry/builtins.ts` — add `kind` to adapter table + `getBuiltInWorkflowDefinitions` (excluded from `digestBuiltIn`)
- `src/core/workflow-registry/manifest.ts` — optional `kind` enum (`task|internal`, default `task`) in `WorkflowManifestSchema`
- `src/core/workflow-registry/validator.ts` — set `kind` on user `WorkflowDefinition` from manifest
- `src/commands/workflow-library.ts` — `list` grouping + `--all` + `kind` in list/JSON entries; `kind` in `show`
- `src/core/workflow-library.ts` — `kind` in `workflowDefinitionForJson`
- `src/commands/workflow-messages.ts`, `src/locales/en.json`, `src/locales/ja.json` — localized section headings (lockstep)
- `docs/`, `docs/zh/` — kind-taxonomy subsection
- Tests: `test/core/workflow-registry/validator.test.ts`, `test/core/workflow-package/codec.test.ts` (expected-definition shape gains `kind: 'task'`), `test/commands/workflow-library.test.ts` and `test/core/workflow-library.test.ts` (grouping/`--all`/JSON kind), plus new coverage for driver/internal grouping and manifest-declared kind
- Constraints: no version bump; golden fixture (`builtins-v1.json`) and parity SHAs are unaffected because `kind` is excluded from digests and from the fixture projection; locale catalogs must stay in lockstep.
