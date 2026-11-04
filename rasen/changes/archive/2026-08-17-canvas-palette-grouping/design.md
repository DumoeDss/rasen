## Context

User request 4 (round-2 live testing): the left stage list should separate experts from
ordinary workflows and pin the common stages (propose, apply, review, ship, archive) to
the top. Verified state at the current tree (child 2 shipped, ship 7677ff77):

- The palette is flat by construction: `PalettePanel.tsx` maps `skills` in API order in
  both branches — the v2 Stage-gesture expansion (`:79-124`, buttons gated by
  `isBindableSkill`) and the v1 draggable card list (`:146-179`).
- The kind metadata premise was checked before designing. The catalog payload lacks it
  (`PipelineCatalogSkill` = `id/description/enabled/capability?`,
  `src/core/management-api/wire-types.ts:294-310`), but the authoritative source has it:
  `WorkflowDefinition.kind: 'task' | 'driver' | 'internal' | 'expert'`
  (`src/core/workflow-registry/types.ts:13,49`). Built-ins default to `task`
  (`builtins.ts:214`); the drivers are `auto-command` and `goal-command` (`:150,:179`);
  internals are `retain-command`, `review-fix`, `goal-plan`, `goal-iterate`,
  `goal-judge`, `goal-report`, `task-loop` (`:144-174`); experts join the same unified
  catalog (`experts.ts:71`, `registry.ts:68`). `handlePipelineCatalog`
  (`src/core/management-api/pipelines.ts:757-776`) maps each definition to
  `id/description/enabled/capability` and drops `kind`. The fix is pass-through.
- The five core skill ids are exact installed template names, verified in the template
  sources: `rasen-propose` (`templates/workflows/propose.ts:12`),
  `rasen-apply-change` (`apply-change.ts:12`), `rasen-review-cycle`
  (`review-cycle.ts:160`), `rasen-ship` (`ship.ts:278`), `rasen-archive-change`
  (`archive-change.ts:13`).
- Server tests already pin the catalog shape at
  `test/core/management-api/pipelines-api.test.ts:1431+` (`skills[0]` has `enabled` at
  `:1443`), the seam for the `kind` assertion.
- Constraints: IR frozen (`src/core/pipeline-registry/` untouched — note
  `src/core/management-api/` and `src/core/workflow-registry/` are NOT frozen; this
  change reads the latter and edits the former's wire/handler only); one home (the
  grouping rule in `draft.ts`, the panel renders); `V2_BODY_PALETTE_KINDS` stays
  `['AtomicStage']`; no position writes (child 2's placement cache untouched); ADDED-only
  delta; UI baseline 67 files / 880.

## Goals / Non-Goals

**Goals:**

- The core five lead the palette in pipeline order; experts get their own visually
  distinct section; everything else stays reachable in stable, deterministic order.
- Kind comes from the workflow registry through the catalog wire — zero inference.
- One grouping rule serving both palette branches (v1 cards and v2 Stage expansion)
  identically.
- Bindability semantics byte-identical (`isBindableSkill`, disabled greying, v1 DnD).

**Non-Goals:**

- Palette drag-and-drop placement for new v2 nodes (child-2 digest: any future palette
  placement seeds the same placement cache; grouping neither adds nor forecloses it).
- Hiding or filtering any kind (internals are grouped, not removed — no capability
  hole), re-orderable or collapsible sections, profile or customization surface.
- Touching the v2 non-Stage gestures (Parallel/Loop/Finish) or the body palette
  (`V2_BODY_PALETTE_KINDS` unchanged).

## Decisions

**D1 — `kind` rides the existing catalog wire, optional, pass-through only.**
`PipelineCatalogSkill` gains `kind?: 'task' | 'driver' | 'internal' | 'expert'` on both
the server wire type and the UI API type (the `capability?` precedent for
older-server/fixture compatibility), and `handlePipelineCatalog` passes
`definition.kind` through. Alternative rejected: deriving kind in the UI from names or
directories — banned by the repo's explicit-list-over-pattern-matching rule and by the
brief; alternative rejected: a second catalog endpoint — one vocabulary, one wire.

**D2 — The grouping rule is one pure helper + one named constant in `draft.ts`.**
`CORE_PALETTE_SKILL_IDS` (the five verified ids, pipeline order) and
`groupPaletteSkills(skills)` returning ordered sections `core`, `workflows`
(`task` + `driver`), `experts` (`expert`), `internal` (`internal`), each preserving the
input order (stable = deterministic given the same catalog). Absent `kind` falls into
`workflows` (the registry's own default semantics). Core ids absent from the catalog
render nothing. `draft.ts` is the palette vocabulary's established home
(`V2_ROOT_PALETTE_GESTURES`, `V2_BODY_PALETTE_KINDS`, `isBindableSkill`,
`unavailableRootGestures` — its own doc comment records why: four independent encodings
of one question once drifted apart). Alternative rejected: the constant server-side
(next to `CORE_WORKFLOW_IDS`) — that list is workflow IDS (`propose`, `apply`), not
palette skill ids (`rasen-propose`, `rasen-apply-change`); coupling the palette to it
would need an id-translation the UI does not otherwise have.

**D3 — Four sections, experts visually distinct, internals last-but-present.**
Core first (the user's ask), Workflows next (the ordinary bindable population), Experts
in a visually distinct section (the user's ask; distinct styling on the section heading,
not per-card theming), Internal last — present and bindable, so nothing becomes
unreachable. The v1 DnD cards and the v2 Stage buttons render the SAME grouped model:
the panel calls `groupPaletteSkills` and maps sections to headings + entries; it decides
nothing (the same read-only-rule posture as `isBindableSkill` at
`PalettePanel.tsx:80-84`).

**D4 — Test seams.** Server: extend the existing catalog block
(`pipelines-api.test.ts:1431+`) to assert `kind` is present and correct for a known
task, driver, internal, and expert entry. UI: unit tests for the helper (order,
stability, absent kind, missing core ids, disabled membership); component tests for both
branches (section testids per group so order is assertable without layout); UI catalog
fixtures gain `kind`. Real browser: the palette against the REAL installed skills set
(the fixture cannot prove the real catalog carries kind end-to-end).

## Risks / Trade-offs

- [Older servers (pre-kind) group everything into Workflows] → accepted and spec-stated;
  the field is optional and the degradation is uniform, not error-shaped.
- [The core constant drifts if a core skill is renamed] → the constant names template
  ids whose renames are repo-wide events; a missing id simply stops rendering (no
  phantom row), and the CDP gate renders against the real catalog, so a rename shows up
  there as a missing core entry.
- [Fixture churn in UI tests] → fixtures gain `kind` once; component tests assert
  sections by testid, not by flat order, so later palette additions stay local.
- [Experts styling is a layout claim] → jsdom proves structure (sections, order,
  testids); the CDP check proves the distinct rendering on-screen; no width/flex claims
  are pinned from markup alone (repo discipline).
- [Spec base drift between branch and dev/0.2.0's unmerged sync] → ADDED-only delta, no
  em-dashes in requirement prose.

## Migration Plan

Forward-only; the wire field is optional and additive, so an old UI against a new server
ignores `kind` and a new UI against an old server degrades to the Workflows bucket.
Rollback is reverting the commit.

## Open Questions

- None blocking. If the user later wants internals hidden entirely or sections
  collapsible, both are render-side changes over the same helper.
