## Context

W3 of the ratified `rasen/office-hours/ui-config-and-library-redesign.md`, consuming the wildcard-config enabler's machinery. Verified state:
- `GET /api/v1/pipelines` (config-api `router.ts` `handleListPipelines`) is launch-project-rooted (no space addressing) and reports raw stage `gate` values only; its contract lives in `config-http-api` "Read-only pipelines inventory endpoint" (405s POST — must flip for the mutation bridge).
- Gate decisions are made by the LEAD following `auto.ts` §0.5 template prose; `resolveAutopilotGatePolicy` has no production callers; run-state records `gatePolicy { effective, source }` (W1 added source `store`).
- Model/handoff chains: `resolveStageRuntimeConfig` / `resolveStageHandoffConfig` (`pipeline-registry/types.ts:449,588`) take layer params; W1's pending ADDED texts in `opsx-pipeline-registry` and `pipeline-handoff-config` pin the current chains and source vocabularies.
- `rasen pipeline agents` sets per-role **runtimes** (claude/codex) — not models — and persists by writing a full frozen `pipeline.yaml` via `writeProjectPipelineOverride` (`pipeline.ts:770-777`). The freeze is not normative in any spec.
- Pipeline CLI mirrors workflow: `init --output` / `validate` / `import --force` / `export --force` / `delete --yes --force`, all `--json` — the W4 bridge pattern transplants directly.
- W2's pending ADDED text pins the five-tab Config page (interim Workflow tab) and left the gates-inventory requirement standing for W3 to remove.

## Goals / Non-Goals

**Goals:**
- One page where a pipeline's shape is inspected and its per-stage gate/model/handoff tuned, with overrides riding the config scope chain — never YAML forks.
- The mask: every ordinary gate individually controllable; `autopilot.gates` demoted from switch to mask base.
- The role matrix readable as the grid it is (Defaults table); Config page reaches its final four tabs.
- `pipeline agents` keeps its surface, loses the freeze.
- Pipeline library management (import/export/init/delete) from the UI via the CLI bridge.

**Non-Goals:**
- No `gate: 'vet'` changes of any kind — the always-pausing carve-out, the Zod union, the wire literal, the display branch, and all template prose about vet stay byte-identical (W5).
- No structural pipeline editing in the UI (adding/reordering stages stays `pipeline init` + fork authoring, per Fork 3's retained clause).
- No new visual language; no version bump; no changes to the supervised session tier.

## Decisions

**D1 — Effective per-stage values are computed server-side; the UI renders, never resolves.**
`GET /api/v1/pipelines` gains `?space=` (resolved like the config endpoints: project root + store layer for the addressed space; launch-project fallback unchanged) and each stage reports, beside its raw definition fields, the *effective* gate (after the mask), model, handoff threshold, and runtime, each with a scope-qualified source. This keeps `config-ui-package`'s "no configuration logic in the UI" principle intact — the alternative (client-side chain replication over config-list instances) would duplicate resolution in a second language and drift. The endpoint's contract moves to a new `pipeline-http-api` spec that owns the whole surface; `config-http-api` carries a REMOVED-with-migration. The vet-distinguishable scenario carries forward verbatim (W5's boundary).

**D2 — The mask is resolved in one place and consumed as data.**
A new resolver (`stage-overrides.ts`) reads the four family namespaces for one pipeline across project/store/global (via the enabler's instance machinery) and returns per-stage/per-role override maps with sources. `resolveStageRuntimeConfig`/`resolveStageHandoffConfig` gain the per-stage override as a new TOP layer param (above `stage.model`/stage `handoff` — the point is overriding YAML without touching it); their source unions gain scope-qualified values (`stage-override-project|store|global` shape). Gate masking composes in the same resolver: per-stage instance (project→store→global) → else `autopilot.gates: off` (flag→project→store→global) suppresses → else the stage's own `gate:`. A `'vet'` gate is returned as-is, outside the mask. `pipeline show --json` and the pipelines endpoint both report through this resolver, so CLI and UI can never disagree. Run-state keeps its recorded `gatePolicy` (the mask base + source, W1's shape); per-stage instances resolve live at each gate — freezing them into run-state would recreate the YAML-freeze defect at run scope.

**D3 — The LEAD learns the mask through prose + `pipeline show`, not new plumbing.**
`auto.ts` §0.5 is rewritten: the LEAD resolves each gate by consulting `rasen pipeline show <name> --json`'s effective per-stage gates (which already encode the mask) instead of combining `autopilot.gates` with stage definitions itself. Golden-hash repaste in `skill-templates-parity.test.ts` (~:159). §0.6 (selection) and every vet mention are untouched.

**D4 — `pipeline agents` re-points to a fourth family: `pipelines.<name>.runtimes.<role>`.**
The design doc's "re-point at this config family" cannot ride the three registered families — `agents` sets per-role *runtimes*, which none of them carry. A fourth family (enum `claude | codex`, scopes global/store/project, group `Pipelines`, no default) is registered — exactly the "table row, not code" addition the enabler's D1 promised. `pipeline agents` writes instances at the resolved root (project-scope semantics per W1's CLI asymmetry; `--store <id>` writes the store's own file) and reads back resolved runtimes with sources; `writeProjectPipelineOverride`'s agents-freeze path is deleted. Runtime chain: per-role family instance (project→store→global) → pipeline `agents.<role>.runtime` → default (claude). Per-role, not per-stage, because runtime genuinely is a role attribute (a role's stages share one runtime today); the role placeholder validates structurally like every placeholder — a typo'd role via raw `config set` is inert, and `pipeline agents` itself can only emit the five real roles. Consequence: the enabler's "four families" enumeration is re-cut to five (stacked REMOVED+ADDED on its pending ADDED text).
An existing frozen `pipeline.yaml` copy written by the old behavior stays untouched and keeps winning (it is the project layer of pipeline resolution) — migration guidance, not code: deleting the copy un-freezes; `pipeline show`'s source badge makes the situation visible.

**D5 — Page structure: Defaults up top, per-pipeline sections below, W2's scope mode throughout.**
The page opens with the Defaults table — the 12 role-matrix keys as a 2×6 grid (model row + handoff row per role, plus the `models.default`/`handoff.threshold` bases) and the `autopilot.gates`/`autopilot.selection` controls — all ordinary config keys written through the existing config API in the page-level Global/Local mode (W2's exact pattern, one learned behavior). Below, one section per pipeline: the stage graph in build order (data already served; rendering is a simple ordered lane, not a new graph engine), per-stage rows with gate (on/off/inherit + effective state), model (suggestion-backed text), handoff (dual-form), and the per-role runtime controls; provenance badge (`built-in`/`user`) and source badge (`project > user > package`). Library actions (import/export/init/delete) transplant W4's dialog flows verbatim, including CLI-verbatim errors and the built-in lock. Each action is offered only where the CLI supports it: the CLI's `pipeline export` AND `pipeline delete` are both user-library-only (they refuse `source !== 'user'` — built-in package pipelines and project-layer pipelines alike, exactly as their `workflow` counterparts do), so the affordances gate on the resolved SOURCE LAYER, not provenance: only a `sourceLayer: 'user'` pipeline exposes export/delete; a built-in or a project-layer copy is visibly locked. The UI never surfaces an action that would land on a dead CLI refusal. Pipeline validation is deliberately NOT a page action: the ratified office-hours §W3 scope lists only import/export/init/delete, and the mutation bridge admits only those four ops; validating a pipeline stays the CLI path (`rasen pipeline validate`) and the Workflows page's territory. Config page shrink lands in the same change: TAB_MAP loses the Workflow tab, `GatesInventoryPanel` is deleted, and the Workflow/Autopilot/Pipelines groups stop rendering there (pipelines-ui owns them).

**D6 — Mutation bridge transplants W4's shape.**
`POST /api/v1/pipelines` with `op: import | init | export | delete` (absolute-path guards, id charset guard, single argv tokens, `--yes` always on delete, `--force` only when flagged, cap-1, 60s timeout, 422 verbatim CLI errors, 409 busy). Four bounded whitelist rows: `import-pipeline`, `init-pipeline`, `export-pipeline`, `delete-pipeline` (tier 12 post-W4). The bridge is its own submitter module beside W4's (shared table, per-endpoint own-op admission — the change-submission invariant); if W4's review extracts a generic bounded submitter, this bridge adopts it at merge (LEAD merge point, noted in tasks).

## Risks / Trade-offs

- [Five stacked deltas make W3's REMOVED blocks brittle against sibling rewording during their reviews] → Each delta banner names the exact pending source; tasks include a pre-archive verbatim re-check of all five (W1, W2, enabler, W4 ×2). The LEAD's archive chain (W1→W2→W6→W4→enabler→W3→W5) is recorded in the proposal.
- [Mask semantics change what `autopilot.gates: on` means for users with per-stage expectations] → It doesn't: `on` = honour stage definitions is today's behavior verbatim; only `off` + per-stage `on` is new expressiveness. The CHANGELOG note calls out the reinterpretation of `off` (per-stage `on` can now pierce it).
- [Frozen pipeline copies from the old `agents` behavior shadow the new config overrides] → Accepted and visible: project-layer YAML beats built-ins by design; the source badge names it, docs say "delete the copy to re-track". No auto-migration — silently deleting user files is worse than the defect.
- [`pipeline show --json` output grows; consumers may depend on the old shape] → Additive fields only; existing fields keep meaning. The golden-hash template test catches the one prose consumer.
- [Store spaces: pipelines resolve from the store root's own planning dir] → Same rule as every space: the addressed root is the project layer. No special casing; tested.
- [W4 merge points (whitelist rows, Layout nav, possibly a shared submitter)] → Both changes add table rows/nav entries additively; LEAD reconciles at the recorded merge points.

## Open Questions

- None blocking. (Design doc OQ3 — per-space pipeline filtering — is answered by D1: the page shows the addressed space's resolved pipelines; user/package pipelines appear everywhere, project ones only in their space. OQ2 — store-scoped featureFlags — remains deferred.)
