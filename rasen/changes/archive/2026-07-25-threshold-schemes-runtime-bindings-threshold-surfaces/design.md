## Context

The two prerequisite slices are complete. Runtime identity now comes from the immutable capability registry, and threshold core now exposes:

- `listThresholdSchemes`, `readThresholdScheme`, `saveThresholdScheme`, and `deleteThresholdScheme`, with strict validation and atomic writes;
- `PROBE_RUNTIMES` and capability guards;
- `MODEL_PRESETS` plus built-in handoff/reuse defaults;
- space-scoped `thresholds.bindings.<runtime>` entries through the existing config API;
- resolver results carrying `source`, optional `binding { scope, row, scheme }`, and non-fatal diagnostics;
- pipeline handoff/reuse wrappers that already apply the approved precedence.

The current Pipelines page still presents the old role × model × handoff matrix and has no scheme or binding management. Its management pipeline wire drops the new binding metadata and reuse resolution. The shared orchestration template also describes the old threshold chain, so an agent following Step H can reason differently from the code.

This slice is the presentation and instruction layer only. It must consume the established core contracts rather than duplicate storage, runtime lists, preset matching, binding selection, or threshold resolution.

## Goals / Non-Goals

**Goals:**

- Expose safe machine-level scheme management and preset seed data through the authenticated management API.
- Keep root-package wire types and UI mirror types synchronized with threshold binding provenance and diagnostics.
- Make schemes and runtime bindings the primary threshold experience on the Pipelines page.
- Preserve every legacy threshold and keepalive control in a clearly labeled Advanced Overrides area.
- Give users non-destructive, accurate migration guidance when bindings shadow legacy values.
- Fully translate the new experience in English, Simplified Chinese, and Japanese.
- Make the canonical orchestration template state the same handoff/reuse precedence implemented by the resolver, and verify generated output through the repository's build/update/parity discipline.

**Non-Goals:**

- Changing scheme file format, name rules, resolver ordering, config schemas, or the headless `rasen scheme` commands.
- Adding store-distributed schemes, per-pipeline scheme bindings, editable model presets, or new runtime adapters.
- Automatically converting or deleting legacy configuration.
- Combining keepalive runtime gates with threshold bindings.
- Changing pipeline YAML, package dependencies, or package version.

## Decisions

### 1. Add one installation-wide threshold-scheme management endpoint

Create a focused management module and route:

```text
GET  /api/v1/threshold-schemes
POST /api/v1/threshold-schemes
```

The route inherits the management server's loopback and bearer-token posture. It is installation-wide and takes no `space` selector because scheme files, runtime capabilities, and model presets are machine-level. Space-scoped binding values continue through `GET/PUT/DELETE /api/v1/config`; creating a second binding API would split scope semantics and source badges.

The GET response contains three registry-backed collections:

- `schemes`: every `ThresholdSchemeListEntry`, including parsed valid definitions and per-file errors;
- `presets`: read-only seed records derived from `MODEL_PRESETS`, with match patterns, context window, a complete `{ handoff, reuse }` seed, and a per-family source (`preset` or built-in `default`);
- `bindingRows`: `PROBE_RUNTIMES` in registry order plus the separate `default` fallback row.

A preset's primary match string is its stable display/seed id. Its seed uses the preset suggestion when present and `DEFAULT_HANDOFF_CONFIG.threshold` / `DEFAULT_REUSE_CONFIG.threshold` otherwise. This produces a complete valid scheme draft without making presets editable or moving preset matching into the browser.

POST accepts discriminated requests:

```ts
{ op: 'create' | 'update'; name: string; scheme: ThresholdScheme }
{ op: 'delete'; name: string }
```

Create refuses any existing filename, including a malformed one; update requires an existing file and may replace malformed contents with a valid scheme; delete requires existence. The handler maps `ThresholdSchemeError` codes to 400/404 and uses 409 for create conflict. It calls the core library directly, following the named-profile API precedent: these are validated machine-config YAML writes, not pipeline-package subprocess operations.

Alternative considered: add CLI edit/delete commands and force the server through a subprocess bridge. The approved CLI surface is list/show only, while the core already owns safe writes. Adding unrequested CLI UX solely as an HTTP transport would expand scope and duplicate error mapping.

### 2. Mirror threshold resolution metadata rather than re-resolve in the UI

Introduce wire equivalents for `ThresholdBindingMetadata` and `ThresholdDiagnostic`. A stage's `effectiveHandoff` keeps `value` and `source` and gains optional `binding` and `diagnostics`. Each `WirePipeline` also gains `effectiveReuse`, mirroring the core result's modes, top-level/role thresholds, optional sources, bindings, and diagnostics.

The pipeline management handler uses its existing `pipelineResolutionBundle`, calls the same stage and reuse resolvers as `rasen pipeline show`, and projects their returned metadata. To resolve reuse roles correctly, it derives each role's effective runtime from the same server-side per-stage resolution already used for the inventory; it never infers a runtime in the browser.

The UI's hand-maintained API types mirror these shapes and are pinned by fixtures/type assertions. UI components may display server-provided sources and diagnostics, but never reproduce row-first binding selection.

Alternative considered: let the UI combine config entries, schemes, and pipeline definitions to calculate effective thresholds. Rejected because dangling-scheme fallback and explicit-row-before-default ordering are intentionally non-trivial and already authoritative in core.

### 3. Make the scheme library an explicit card/editor surface

The Pipelines page loads config, pipelines, and the threshold-scheme catalog together. The scheme section renders:

- one compact card per valid scheme, showing handoff/reuse scalars and collapsed role overrides;
- invalid file cards showing the server-provided error without breaking valid cards;
- create, edit, and delete actions;
- a modal or bounded inline editor with name (create only), dual-form scalar fields, and optional role overrides for the exact core role vocabularies;
- explicit confirmation before delete, warning that existing bindings may become dangling and will fall through safely.

Client validation gives immediate feedback, but the management API/core schema remains authoritative. A successful mutation refetches the scheme catalog and config entries so dynamic binding enum values, cards, and dangling warnings agree. Create conflict never silently becomes update, and edit never renames a scheme; rename remains create-new plus separately confirmed delete.

Alternative considered: edit raw YAML in the browser. Structured fields preserve dual-form semantics, role constraints, and actionable validation without introducing a second YAML parser to the UI bundle.

### 4. Present presets as immutable seed cards

The preset strip is read-only. Each card names its match family and context window, shows the effective handoff/reuse seed values, and labels whether each came from a model preset or the built-in default. “Seed scheme” opens the normal new-scheme editor populated with the server-provided complete seed; no file is written until the user supplies a valid non-reserved name and confirms creation.

Preset cards never imply that a runtime is bound or that a scheme exists. Editing a preset is unavailable; the prescribed path is seed → customize → bind.

Alternative considered: save a seeded scheme immediately under an invented name. Rejected because naming is user intent and `default` is reserved; an implicit write would make a read-only preset action surprisingly destructive.

### 5. Build binding rows from the runtime catalog and config API

The binding section joins two server-owned inputs:

- eligible row names from `bindingRows`;
- wildcard instance entries and raw `scopeValues` from the existing config API.

Rows show the runtime/default label, selected scheme, effective source badge, and any raw global/store/project values needed to explain per-key override. Writes use the existing page Global/Local scope mode and `putKey`/`deleteKey`. An inherited store row remains read-only in project-local mode with the existing edit-in-store path. Add offers only eligible rows not already represented at the active scope; remove unsets only the active scope, so a lower-scope value can reappear.

`default` is visually labeled “Other/unknown runtimes” and remains optional. With no set rows, the section shows the approved empty state: no bindings are configured and legacy resolution is unchanged. Audit-only `zed` cannot appear because the server derives rows from `PROBE_RUNTIMES`.

If a referenced scheme is absent/invalid, the row shows a dangling warning. The UI does not guess the fallback winner; effective pipeline metadata and diagnostics show what the server actually selected.

### 6. Slim Defaults and preserve legacy controls behind Advanced Overrides

The main Defaults area retains:

- the model-only default/per-role grid;
- `autopilot.gates` and `autopilot.selection`;
- the existing keepalive beat control.

Handoff scalar/role columns leave the primary grid. A collapsed Advanced Overrides area contains:

- legacy `handoff.threshold` and `handoff.roles.<role>` controls;
- independent `keepalive.runtimes.*` and `keepalive.contextFloor` controls;
- per-pipeline stage handoff instances, nested under each pipeline's configuration disclosure.

Stage gate/model and per-role dispatch-runtime controls keep their current locations. Every advanced value retains dual-form editing, active-scope writes, unset/inherit behavior, and source badges. Keepalive runtime gates remain explicitly described as lifecycle controls, not threshold binding rows.

This preserves compatibility and surgical stage overrides while making the ordinary path scheme → binding.

### 7. Migration guidance is detection-only and non-destructive

When at least one effective binding coexists with any explicitly set legacy machine handoff scalar/role value, the page shows a migration notice that:

- explains that a bound scheme outranks pipeline-wide and legacy machine thresholds, while configured stage instances and stage YAML remain higher;
- points to the scheme editor and Advanced Overrides;
- warns that legacy values remain stored and become active again if bindings are removed or unusable.

The notice performs no conversion, clearing, or automatic scheme creation. The approved source design left one-click migration as an open question with only an inclination toward a `migrated` scheme. Implementing that mutation without an approved collision policy, scope-folding rule, or role/scalar merge rule would exceed this slice. Detection-only guidance satisfies the approved prompt/safety boundary and is fully reversible.

### 8. Localize every new threshold-management string in all three catalogs

The refactored page uses `useT()` for scheme/preset/binding/advanced/migration labels, actions, field hints, source labels, empty states, confirmations, validation errors, loading, and mutation feedback. Each new key is present in `en`, `zh-cn`, and `ja`; none of these surfaces intentionally falls back to English in Japanese.

Runtime IDs, scheme names, model match strings, config paths, and server error detail remain data and are not translated. Tests compare catalog coverage and live rendering in all three locales.

Alternative considered: rely on the existing Japanese content fallback. The user explicitly requested three-language coverage for this feature, so accepted Japanese gaps do not apply here.

### 9. Update only the canonical orchestration template, then regenerate

Edit the Step H source in `src/core/templates/workflows/_orchestration.ts` and its feature-reduced replacement text. The full handoff precedence becomes:

1. configured per-stage instance;
2. stage YAML;
3. runtime-bound scheme role/scalar, with explicit runtime rows across project/store/global before default rows across those scopes;
4. pipeline YAML role/scalar;
5. legacy project, inherited-store, and global role/scalar;
6. model preset;
7. built-in default.

The per-role reuse chain becomes bound scheme role/scalar → pipeline role/scalar → model preset → default. The prose states that each worker uses its effective runtime, missing/invalid schemes warn and fall through, and top-level reuse uses only the default binding row. It continues to tell the LEAD to consume `rasen pipeline show` / `rasen agent context` results instead of manually evaluating files.

Template delivery follows repository discipline:

1. edit the TypeScript template source;
2. run `pnpm build` (the build script compiles templates);
3. run `node dist/cli/index.js update` to refresh installed/dogfooding skills;
4. run the template parity suite;
5. replace only the actual changed entries in both `EXPECTED_FUNCTION_HASHES` and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES`;
6. rerun parity and inspect that only expected shared-playbook consumers moved.

Generated skill files are never edited by hand. Feature-reduced orchestration bundles are covered so a replacement block cannot retain the old precedence.

## Risks / Trade-offs

- [Deleting a scheme leaves configured bindings dangling] → Confirm explicitly, preserve the core's warn/skip/fallback behavior, refetch all surfaces, and show diagnostics rather than pretending the binding vanished.
- [Create/update races overwrite user data] → Distinguish create from update, check existence at the handler boundary, and rely on atomic core writes.
- [UI and root wire types drift] → Update both mirrors in one task and pin representative responses with compile-time fixtures and API tests.
- [Preset display accidentally becomes another source of truth] → Derive all seed values and source labels server-side from `MODEL_PRESETS` and built-in constants.
- [Source badges imply scope precedence rather than actual resolver selection] → Use config badges for row ownership and server resolver metadata for effective stage/reuse selection; label the distinction.
- [Advanced controls become undiscoverable] → Keep a visible summary/count and migration notice link while collapsing the dense controls by default.
- [Japanese falls back to English mid-feature] → Require key-for-key coverage for this feature in all three catalogs and render-test each locale.
- [Shared template edits break feature-reduced bundles] → Update canonical and replacement prose together, then build, update, refresh both hash maps, and run orchestration bundle/parity tests.
- [Windows filesystem behavior differs] → Scheme writes remain entirely in the already cross-platform core library; management tests use temporary directories and path APIs.

## Migration Plan

1. Add management scheme/preset/runtime catalog handlers, routes, wire types, and tests.
2. Extend pipeline inventory with handoff/reuse binding metadata and synchronize UI mirror types.
3. Add UI client methods and scheme/preset/binding components.
4. Slim Defaults, move compatibility controls into Advanced Overrides, and add detection-only migration guidance.
5. Add complete three-language catalog entries and locale/UI tests.
6. Update canonical Step H and feature-reduced prose, run build → update → parity-hash refresh, and verify generated content.
7. Run management, config/pipeline integration, UI, i18n, template, type, and full relevant suites.

Rollout is additive. Existing config and scheme files are not rewritten. With no schemes or bindings, the page states the empty compatibility behavior and core resolution remains unchanged. Rollback removes the new surface/API/template prose; persisted schemes and bindings remain valid for the already-shipped core and headless CLI.

## Open Questions

None for this slice. Automatic legacy conversion remains deliberately deferred until its naming, collision, and multi-scope merge semantics are approved.
