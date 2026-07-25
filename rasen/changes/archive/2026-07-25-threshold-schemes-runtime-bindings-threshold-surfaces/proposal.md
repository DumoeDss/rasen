## Why

The threshold core can now store schemes, bind them to probe-capable runtimes, and report the selected source, but those capabilities remain invisible and difficult to manage from the web UI. The final slice turns that core into a clear Pipelines experience and aligns the orchestration instructions with the runtime-aware handoff and reuse rules that the code now executes.

## What Changes

- Add bearer-secured management API and mirrored wire types for listing, creating, updating, and deleting machine-level threshold schemes.
- Expose a read-only model-preset seed catalog and the probe-capable runtime vocabulary from their core registries so the UI does not duplicate either.
- Extend pipeline inventory wire output with resolver-owned threshold binding metadata and diagnostics.
- Reorganize the Pipelines page into a threshold scheme library/editor, read-only preset fallback cards with seed-from-preset, runtime binding rows with scope/source badges, and an empty state that explains compatibility behavior.
- Slim the Defaults matrix to models and existing non-threshold controls, and move legacy handoff values, stage threshold overrides, and independent keepalive controls behind an Advanced Overrides disclosure.
- Show non-destructive migration guidance when legacy threshold overrides coexist with bindings; no automatic conversion or cleanup is introduced.
- Translate every new threshold-management UI string in English, Simplified Chinese, and Japanese.
- Update the shared orchestration Step H prose to state the binding-aware handoff and reuse precedence, then run the required template build, generated-skill update, and both parity-hash refreshes.
- Add management API, wire-mirror, UI interaction/i18n, orchestration-content, and compatibility integration coverage.

## Capabilities

### New Capabilities

- `threshold-scheme-management-api`: Management HTTP and wire contracts for machine-level scheme CRUD, preset seeds, and capability-derived binding rows.

### Modified Capabilities

- `pipelines-ui`: Replace the threshold-heavy Defaults matrix with scheme, preset, binding, migration-guidance, and advanced-override surfaces.
- `pipeline-http-api`: Carry threshold binding provenance and diagnostics through the server-owned effective pipeline view.
- `ui-i18n`: Require complete three-language coverage for the new threshold-management experience.
- `orchestration-handoff`: Teach Step H the runtime-bound scheme layer and complete handoff precedence.
- `worker-reuse-orchestration`: Teach Step H and cross-change decisions the runtime-bound reuse precedence.
- `workflow-template-parity`: Regenerate shared orchestration consumers through the build/update flow and refresh both pinned hash maps.

## Impact

This change affects management routing and wire types, pipeline inventory projection, the UI API client/mirror types, the Pipelines page and styles, UI locale catalogs, the shared orchestration template, generated dogfooding skills, parity hashes, and their tests. It reuses the existing scheme library, config API wildcard writes, runtime registry, model-preset data, and pure resolver metadata; it does not change core storage/resolution semantics, the headless scheme CLI, package dependencies, or the package version.
