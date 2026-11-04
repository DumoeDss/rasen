# Proposal: canvas-palette-grouping

## Why

Live testing of the round-one canvas (PR #167 build, 2026-08-17, user request 4) asked
that the left stage list separate experts from ordinary workflows and pin the common core
stages (propose, apply, review, ship, archive) to the top. Today the palette is flat:
`PalettePanel.tsx` renders `(skills ?? []).map(...)` in raw API order in BOTH branches
(the v2 Stage-gesture expansion at `:79-124` and the v1 card list at `:146-179`), so
`rasen-propose` and an analysis expert sit as undifferentiated peers in a long list.

Premise check done before designing (the LEAD's stop-condition): the skills payload
genuinely lacks kind metadata — `PipelineCatalogSkill` carries only
`id/description/enabled/capability?` (`packages/ui/src/api/types.ts:1583-1596`,
`src/core/management-api/wire-types.ts:294-310`). But the SOURCE has it: every
`WorkflowDefinition` carries `kind: 'task' | 'driver' | 'internal' | 'expert'`
(`src/core/workflow-registry/types.ts:13,49`; built-ins default to `task` at
`builtins.ts:214`; drivers are `auto-command` and `goal-command`; internals are
`retain-command`, `review-fix`, the `goal-*` helpers, `task-loop`; experts join the same
unified catalog). The catalog handler simply drops it
(`handlePipelineCatalog`, `src/core/management-api/pipelines.ts:757-776`). So the fix is
wire plumbing from an existing authoritative field — no detection invented, no
name-pattern sniffing anywhere.

## What Changes

- The pipeline-catalog payload gains `kind` on each skill: `handlePipelineCatalog` passes
  `definition.kind` through, and `PipelineCatalogSkill` (server wire type + UI API type)
  gains an optional `kind` field (optional so older servers and existing fixtures stay
  source-compatible, mirroring the `capability?` precedent). `src/core/management-api/`
  is not frozen — only `src/core/pipeline-registry/` is, and it is untouched.
- The grouping and ordering rule lands in `draft.ts` as a pure helper plus a named
  constant: `CORE_PALETTE_SKILL_IDS` (the five common stages in pipeline order:
  `rasen-propose`, `rasen-apply-change`, `rasen-review-cycle`, `rasen-ship`,
  `rasen-archive-change` — exact installed skill template names, verified against the
  template sources) and `groupPaletteSkills(skills)` returning ordered sections:
  **Core** first, then **Workflows** (kinds `task` and `driver`), then **Experts**
  (`kind: 'expert'`) in their own visually distinct section, then **Internal**
  (`kind: 'internal'`). Within every section the original catalog order is preserved
  (deterministic given the same input). A skill whose `kind` is absent (older server)
  falls into Workflows. A core id not present in the catalog simply renders nothing —
  no phantom rows. `isBindableSkill` remains the single bindability predicate:
  disabled skills stay listed, greyed, inside their group.
- `PalettePanel` renders the grouped sections in BOTH palette branches (the v1 card
  list and the v2 Stage-gesture expansion); the panel calls the helper and renders —
  it decides nothing. The v2 non-Stage gestures (Parallel/Loop/Finish) are unaffected.
- Internal workflows are grouped, not hidden: they remain listed and bindable (no
  capability hole), just in their own section after experts.
- Spec coverage via an ADDED-only delta under `pipelines-ui`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipelines-ui`: ADDED-only delta adding one requirement covering the grouped palette:
  core stages first in pipeline order, experts in their own distinct section, other
  workflows and internal workflows in their own sections in stable catalog order, both
  palette branches grouped, and tolerance of a catalog without kind metadata.

## Impact

- `src/core/management-api/pipelines.ts` (+12 lines area `:757-776`): pass `kind`
  through in the catalog skills mapping; `src/core/management-api/wire-types.ts`:
  optional `kind?: 'task' | 'driver' | 'internal' | 'expert'` on
  `PipelineCatalogSkill`. Frozen dir untouched.
- `packages/ui/src/api/types.ts`: mirror the optional `kind` field.
- `packages/ui/src/canvas/draft.ts`: `CORE_PALETTE_SKILL_IDS` + `groupPaletteSkills`
  pure helper beside the existing palette vocabulary
  (`V2_ROOT_PALETTE_GESTURES`, `isBindableSkill`).
- `packages/ui/src/canvas/PalettePanel.tsx`: render grouped sections in both branches;
  `packages/ui/src/style.css`: section heading styles (experts visually distinct).
- Tests: server-side catalog assertions extended
  (`test/core/management-api/pipelines-api.test.ts:1431+` already pins the skill
  shape); UI unit tests for the helper; component tests for both branches; UI catalog
  fixtures gain `kind`; real-browser CDP check renders the palette against the real
  installed skills set. UI baseline 67 files / 880 via
  `pnpm --dir packages/ui exec vitest run`; server suite runs under the root config.
- Frozen and untouched: `src/core/pipeline-registry/` (asserted empty diff),
  `V2_BODY_PALETTE_KINDS`, no node synthesis, no `legacyRuntimeOwner`, no position
  writes (child 2's placement cache is not touched; grouping forecloses nothing — a
  future palette drag-and-drop would seed the same cache).
- Explicit non-goals: palette drag-and-drop placement for new v2 nodes, hiding or
  filtering any kind, re-orderable sections, profile changes, per-user customization,
  v1-versus-v2 divergence (both branches group identically).
