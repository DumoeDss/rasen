## Why

Pipeline configuration is read-only and mis-placed: the Config page's Autopilot group shows a gates inventory that tells the user what it won't let them change, the only writable gate control is the blanket `autopilot.gates` on/off, and setting a per-role model via `rasen pipeline agents` permanently freezes a full `pipeline.yaml` copy into the project (a latent defect the ratified design names). This is W3 of `rasen/office-hours/ui-config-and-library-redesign.md` — the largest workstream: a Pipelines page where the stage graph, per-stage gate/model/handoff configuration, the role-matrix defaults, and pipeline library management live together, persisted through the wildcard config families the `ui-config-redesign-wildcard-config` enabler registered.

## What Changes

- **New Pipelines page** (space-prefixed route, header nav entry beside Board/Archive/Config): per pipeline, the stage graph from the registry's build order (read-only structure) and a per-stage configuration row binding `pipelines.<name>.gates.<stage>` / `models.<stage>` / `handoff.<stage>`, with provenance (built-in vs user) and the `project > user > package` source badge. The page reuses W2's Global/Local scope-mode pattern for all writes.
- **`autopilot.gates` becomes a mask.** Precedence: (1) `pipelines.<name>.gates.<stage>` (project → store → global) wins; (2) `autopilot.gates: off` (flag → project → store → global) suppresses remaining ordinary gates; (3) the stage definition's own `gate:`. `autopilot.gates: on` (the default) means honour the stage definitions. "Gate `small-feature` at `propose` only" = `autopilot.gates: off` + one per-stage `on`. The always-pausing `'vet'` carve-out stays exactly as it is (W5 removes it, not W3).
- **Per-stage model/handoff overrides sit above the existing chains** (`stage.model → pipeline agents role → models.roles → models.default`, and the handoff equivalent); the chains below are unchanged, and `rasen pipeline show --json` reports the new top layer with its scope-qualified source.
- **Defaults table** at the top of the page: the 12-key role matrix (6 model + 6 handoff rows) and the `autopilot.gates`/`autopilot.selection` keys move here from the Config page — W2's interim Workflow tab dies, the gates inventory panel dies, and the Config page settles at its final four tabs.
- **`rasen pipeline agents` stops freezing.** Per-role runtime updates persist as config-family instances (`pipelines.<name>.runtimes.<role>`, a fourth family this change registers as a table row on the enabler's machinery) instead of writing a full pipeline YAML copy. Same command surface; reads report resolved runtimes with sources.
- **Pipeline library management on the page**: import / export / init / delete through a CLI-spawning mutation bridge (`POST /api/v1/pipelines`), transplanting the W4 workflow-bridge pattern — four new bounded-whitelist operations (tier 8 → 12), built-in pipelines locked against deletion, CLI errors verbatim.
- **The pipelines endpoint grows up**: `GET /api/v1/pipelines` gains space addressing and per-stage effective gate/model/handoff values with sources (so the UI renders resolution without reimplementing it), and its contract moves from `config-http-api` into a new `pipeline-http-api` spec that owns the whole pipelines API surface.

## Capabilities

### New Capabilities
- `pipelines-ui`: The Pipelines page — route, nav entry, stage graph, per-stage config rows, defaults table, scope mode, library management flows, provenance badges, built-in lock.
- `pipeline-http-api`: The pipelines API — the inventory endpoint (migrated from config-http-api, extended with space addressing and effective per-stage configuration) and the CLI-backed mutation bridge with its guards.

### Modified Capabilities
- `autopilot-gate-policy`: the resolution requirement becomes the mask (stacked on W1's pending ADDED text; the vet requirement is untouched).
- `opsx-pipeline-registry`: the model-layer requirement gains the per-stage top layer (stacked on W1's ADDED text); a new requirement re-points `pipeline agents` persistence at configuration (the freeze was never normative — ADDED-only).
- `pipeline-handoff-config`: the resolution-order requirement gains the per-stage top layer (stacked on W1's ADDED text).
- `config-key-registry`: the enabler's four-family enumeration becomes five with `pipelines.<name>.runtimes.<role>` (stacked on the enabler's pending ADDED text).
- `config-ui-package`: W2's tabs requirement is re-cut without the interim Workflow tab (stacked on W2's pending ADDED text); the gates-inventory requirement is removed with no replacement (superseded by pipelines-ui).
- `config-http-api`: the "Read-only pipelines inventory endpoint" requirement is removed with migration to `pipeline-http-api`.
- `change-submission`: the bounded-CLI enumeration grows from eight to twelve operations (stacked on W4's pending ADDED text).
- `management-http-api`: the CLI-backed mutation enumeration gains `POST /api/v1/pipelines` (stacked on W4's pending ADDED text).

**Archive-order constraints implied by the stacked deltas**: W1, W2, the enabler, W6, and W4 must ALL archive before W3 (W3's REMOVED blocks quote their pending ADDED texts); W5 archives after W3. Full chain: W1 → W2 → W6 → W4 → enabler → W3 → W5 (enabler and the worktree children may interleave earlier as long as all five precede W3).

## Impact

**Touched files (implementation):**
- Backend: `src/core/config-keys.ts` (runtimes family row) · new `src/core/pipeline-registry/stage-overrides.ts` (per-scope family-instance resolver for a pipeline) · `src/core/pipeline-registry/types.ts` (`resolveStageRuntimeConfig`/`resolveStageHandoffConfig` gain the top layer + source values) · `src/commands/pipeline.ts` (show/agents reporting, agents re-point, freeze path removal) · `src/core/config-api/router.ts` + `serialize.ts` + `wire-types.ts` (pipelines GET space addressing + effective stage fields, POST wiring) · `src/core/management-api/whitelist.ts` (4 rows; **merge point with W4's rows**) · new `src/core/management-api/pipeline-submit.ts` (bridge mirroring W4's) · `src/core/templates/auto.ts` §0.5 (mask prose; golden-hash repaste in `test/core/templates/skill-templates-parity.test.ts`)
- UI: new `packages/ui/src/components/PipelinesPage.tsx` (+ stage rows, defaults table, action dialogs) · `app.tsx` routes · `Layout.tsx` nav (**merge point with W4's Workflows entry**) · `api/client.ts`/`api/types.ts` (pipelines calls, `instanceKey` mirror, effective stage shapes) · Config-page shrink: `ConfigPage.tsx`, `config/grouping.ts` TAB_MAP, `GatesInventoryPanel.tsx` deleted, labels
- Tests across all the above; run-state shape unchanged (per-stage overrides resolve live at gate time, never frozen into run-state).
- Not touched: `gate: 'vet'` in any form (YAMLs, Zod union, wire literal, display branch, template carve-out prose — all W5), version numbers, visual design tokens.
