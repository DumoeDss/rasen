# Browser gate — canvas-loop-port-inference (task 5.2)

Date: 2026-08-17. Build: `pnpm --dir packages/ui run build` on the working
tree (draft.ts + PipelineCanvasPage.tsx edits in). Serve: `node bin/rasen.js
ui --no-open --no-daemon --port 9349`. Browser: throwaway headless Chrome
151 (`--window-size=1600,1000`, fresh user-data-dir, direct CDP 9350→9351 —
the first instance's debug session wedged after a mid-`Page.navigate` script
crash and was replaced). Driver + screenshots:
`.rasen/changes/canvas-loop-port-inference/ephemera/` (`browser-gate.mjs`,
`01`–`08*.png`, `validate-variants.mjs`, `validate-v5.mjs`,
`author-edits-to-green.mjs`).

## The flow, as driven through the real UI

1. Entry URL → space bootstrap → `/p/<project>/pipelines` → **New pipeline**
   (`loop-port-gate`) → empty v2 canvas (0 nodes asserted).
2. Two stages added from the palette Stage gesture (first enabled skill
   card, capability `skill:rasen-propose`): `atomic-stage`,
   `atomic-stage-2`.
3. Forward edge `atomic-stage → atomic-stage-2` drawn as a real CDP handle
   drag (fit-view before each drag; both endpoints asserted inside the flow
   pane — the first run failed precisely because node 2 rendered off-pane,
   x≈1836 in a 734px pane).
4. Back-edge `atomic-stage-2 → atomic-stage` drawn the same way → refused
   ("Rejected: … would create a cycle") → **the loop review opened with the
   FALLBACK rows** (screenshot `04-review-open.png`):
   - endpoints `atomic-stage-2 → atomic-stage`, region `{atomic-stage,
     atomic-stage-2}` (nothing else on the path — the standalone cycle),
   - input row value `atomic-stage` (the back-edge's TARGET),
   - outcomes value `atomic-stage-2` (the back-edge's SOURCE).
5. Blank drafts declare no outcomes, so the review's inline declare
   affordance was exercised: declared `done`, then **Create loop**.
6. **The synthesized BoundedLoop renders BOTH handles** (screenshot
   `05-loop-node.png`): target handle `data-handleid="atomic-stage"`,
   source handle `data-handleid="atomic-stage-2"`, card port labels
   `in: atomic-stage / out: atomic-stage-2`. (Before this change the loop
   rendered zero input handles — nothing was connectable.)
7. A third stage was added and dragged onto the loop's entry handle: the
   edge landed as `atomic-stage:done->bounded-loop:atomic-stage` — the
   connection exists and names the entry port (screenshot
   `07-external-connected.png`).

## Validate — the recorded facts

Machine caveat: every validation on this box carries one unrelated warning
("Dropping unknown workflow id(s) from stored profile: codebase-design,
navigator, prototype, tdd, workflow-review") — daemon profile state, not the
definition. Counts below exclude nothing; the warning is listed once.

**Intermediate state** (entry handle present, nothing connected — recorded
as a fact per the task, no engine/UI change made for it):

> `✕ 5 errors · 1 warning` — the two Composite-contract PORT_MISMATCHes
> (terminal outcome `done` not declared / declared `atomic-stage-2` not
> producible), UNREACHABLE_EXIT `atomic-stage-2`, MISSING_EXIT `done`, and
> the definition-level `iteration-limit` undeclared.

**Wired graph, unedited defaults**:

> `✕ 6 errors · 1 warning` — the five above plus
> `Port 'atomic-stage' requires 'input' but 'atomic-stage.done' produces
> 'ecp/control'` on the new entry connection.

**Engine-truth variant table** (same definition replayed through the same
`/api/v1/pipeline-validation` endpoint the Validate button uses):

| variant | edit | errors |
|---|---|---|
| V1 | as synthesized | 6 |
| V2 | declaration outcomes → `['done']` (exits reconcile) | 2 |
| V3 | V2 + input row type → `ecp/control` | 1 |
| V5 | V3 + definition declares `iteration-limit` | **0** (`valid: true`) |

**The green path is reachable in the real UI** (`author-edits-to-green.mjs`,
all existing affordances): declaration row select → outcomes field → `done`
(commit on blur; `updateDeclaration` reconciles the loop's exit map exactly
as designed); input row type field (free text) → `ecp/control`; definition
outcomes field → `done,iteration-limit`; Validate → **`✕ 0 errors · 1
warning`** — zero definition errors, the machine warning alone remains. The
loop's labels after the edits: `in: atomic-stage / out: done` (the entry
keeps the fallback NAME; only the type changed).

## The finding this gate surfaces (for the LEAD / reviewer)

The acceptance clause "Validate reports no issue for the wired graph"
(spec scenario "External stages connect after the loop exists") is **not
satisfiable for the unedited synthesized defaults under the frozen IR**, and
it was not satisfiable before this change either. Three pre-existing defect
classes, all shared with the round-one externals-first path (none introduced
by this delta):

1. **Declaration outcome rows must name producible terminal outcomes**
   (`validateOwnerTerminalOutcomes`, definition.ts:3060). Severed names
   (round one: the boundary stage id) and the D2 fallback (the back-edge
   source id) are both unproducible → 2 errors + UNREACHABLE_EXIT +
   MISSING_EXIT. Naming outcomes after stages can never validate clean.
2. **Declaration input rows carry the port NAME as the type**
   (`deriveSubgraphContract`: `type: port!`). The engine's control type is
   `ecp/control` (`CONTROL_PORT_TYPE`, definition.ts:2749), so any
   connection onto a derived row — severed (round one) or fallback (this
   change) — is PORT_MISMATCH. The fallback inheriting `CONTROL_TARGET_PORT`
   (`'input'`) matches the severed convention exactly; the defect class is
   identical.
3. **The default BoundedLoop lifecycle exits to `iteration-limit`**
   (`createDefaultBoundedLoopLifecycle`), which the definition must declare
   — true of every canvas-synthesized loop and the palette Loop gesture
   alike.

This delta's own acceptance claims all verified: fallback rows in the
review, both handles on the loop, the external connection landing on the
entry port, externals-first byte-preservation (unit pin 3.4), and green
reachable through the designed editable-default affordances. The page
test's "No issues" badge assertion runs against the standard mocked
validate response (the file's idiom); engine truth is what this document
records.

Suggested artifact follow-ups (LEAD's call): either amend the spec scenario
to "the connection lands on the entry port and Validate's remaining issues
are the pre-existing loop-contract class, none introduced by this change",
or open a follow-up change fixing the row-type convention (severed +
fallback rows typed `ecp/control`) and the default outcome naming — the
latter changes round-one outputs and needs its own byte-preservation
decision.
