# Review report — canvas-boxselect-containment-fix (verify stage)

- Reviewer: reviewer-1 (flagged the original m2 observation in child 2's review, saw it reproduced
  3/3 in child 3's gate, and proposed the drag-on-node/coordinate-transform hypotheses this
  change's root cause rules out; non-author for impl-5). Dispatched report-only mode: no fixes,
  no commits, no subagents, no working-tree edits.
- Date: 2026-08-17. Branch `feat/canvas-gesture-ir-compiler`, HEAD `9e74b4e0`; review target =
  uncommitted working-tree delta vs HEAD (3 tracked files, +31/−1; `draft.ts` 0-diff).

## Verdict: CLEAN — 0 Blocker, 0 Major, 0 Minor, 0 Trivial

## Independent test gate (mandatory)

- Command: `pnpm --dir packages/ui exec vitest run` from repo root, not piped.
- Result: **67 files / 815 tests, all passed, exit 0** — matches the claim exactly
  (baseline 67/814; +1 = the prop-pin test).
- IR frozen re-verified: `git status --porcelain -- src/core/pipeline-registry/` → empty;
  the gates record additionally checks `git diff 41dda20d..HEAD` (child-3's ship) → empty.
  `draft.ts` has zero diff lines (non-goal honored); `V2_BODY_PALETTE_KINDS` untouched.

## Scope check: CLEAN

Exactly the three expected files: `PipelineCanvasPage.tsx` (+2: the `SelectionMode` import and
`selectionMode={SelectionMode.Partial}` beside `selectionKeyCode="Shift"`),
`pipeline-canvas-page.test.tsx` (+27/−1: mock `selectionMode` prop type + wrapper
`data-selection-mode` + `SelectionMode` stand-in + test-side import + the prop-pin test),
`canvas-authored-composite-export.test.tsx` (+3: the same stand-in). No other source changes.

## Adversarial gates

### 1. Root-cause citation check — all three citations VERIFIED against the installed source

- `@xyflow/react/dist/esm/index.js` (ReactFlow prop destructuring, the cited :3728 area):
  `selectionMode = SelectionMode.Full` is the default. Confirmed verbatim.
- The box-select update (the cited :1519 area):
  `getNodesInside(nodeLookup, nextUserSelectRect, transform, selectionMode ===
  SelectionMode.Partial, true)` — the page-passed prop flows DIRECTLY into the cited path (the
  destructured parameter is used in this expression), and the same block derives edge
  co-selection from the selected nodes' connections ("We look for all edges connected to the
  selected nodes"), confirming the design's claim that fixing the node rule fixes edges too.
- `@xyflow/system@0.0.79` `dist/esm/index.js:354-381` (`getNodesInside`):
  `partially && overlappingArea > 0` (line 373) OR `overlappingArea >= area` (line 375) — under
  Full, only full containment counts; under Partial, any positive overlap selects. Confirmed.
- The deterministic miss pattern is fully explained: the archived probe construction is
  `from.x = Math.min(...target rects x) + 10` — the rect enters exactly 10px into the leftmost
  target's left edge (intersection contains every node, containment never contains the
  leftmost) — hence leftmost-only misses and a singleton zero. My earlier drag-on-node and
  coordinate-transform hypotheses are correctly ruled out by this mechanism (the geometry
  verification only asserted pane-start + no-other-intersection, not full containment).

### 2. Fix correctness

Exactly two product lines; the prop sits beside `selectionKeyCode="Shift"` in the shared
`CanvasFlow` (applies to v1 and v2 as proposed). Nothing else in the product diff.

### 3. Test discrimination

- The prop pin asserts `data-selection-mode` equals BOTH the imported `SelectionMode.Partial`
  and the literal `'partial'` — the second anchor defeats a mutated stand-in. Analytically:
  removing the prop → attribute `''` → fails; `SelectionMode.Full` → `'full'` → fails; stand-in
  mutation → literal anchor fails. The implementer additionally red-checked it (prop removed →
  1 failed; restored → green), recorded in gates-3-2.md. Discriminating.
- The second mock's stand-in is structurally necessary: `canvas-authored-composite-export`
  renders the real page, whose `import { SelectionMode } from '@xyflow/react'` resolves through
  the mock — without the key, `SelectionMode.Partial` is a TypeError on a `undefined` receiver
  and the whole suite fails. The +3 lines are the minimal fix.

### 4. Probe evidence faithfulness

- The new driver's `probeBoxSelect` is **byte-identical** to the archived child-3 driver's
  (verified by diff — same `+10` left-clip construction, same pad, same pane-start walk, same
  others-clear check); only the gate's assertion direction is inverted to REQUIRE full
  membership. The VERBATIM claim holds.
- Results: middle pair `[2,3]` ✓, singleton `[3]` ✓ (pre-fix `[]`), region triple `[2,3,4]` ✓ —
  full membership 3/3 plus the singleton case, exactly as claimed.
- Environment pinned: fresh port 9340 (9333-9338 busy, explained), fresh temp
  `--user-data-dir`, `--window-size=1600,1000` (the child-3 viewport-starvation lesson),
  throwaway headless Chrome, tab-alive check present. Screenshots + cdp-results.json + driver
  all present.

### 5. Independent test gate

Covered above: 67 files / 815 tests, exit 0, independently reproduced; IR frozen.

### 6. Regression lens — Partial is a monotone widening of Full

Containment implies overlap, so every selection Full allowed, Partial also allows; selection
can only grow, never shrink. No child-1/2/3 spec scenario relied on exclusion-by-clipping:
"box around four nodes → all four selected" holds under overlap; the mixed node+connection
scenario is unchanged in shape (edges co-select by connection, verified in source); v1 shares
`CanvasFlow` and widens identically. The one deliberate semantic change — a clipped node now
selects — is exactly the fix, and it is spec-pinned: the MODIFIED requirement changes only the
box-select sentence ("encloses" → "overlaps — full containment is NOT required") and adds two
scenarios (clipped-node, single-node rectangle); I compared the delta against the tree's
current requirement text at `rasen/specs/pipelines-ui/spec.md` — everything else, including all
ten original scenarios, is preserved word-for-word, so no child-1 wording is dropped by the
modification. The MODIFIED-not-ADDED deviation from the portfolio's ADDED-only rule is
explicitly justified in the proposal (the defect falsifies the shipped scenario's intent; the
f77bccdf merge-order rule covers only round-one-touched requirements; child-1's requirement
landed in this tree via its own archive) — sound and approve-worthy.

## Spec axis

The delta delivers exactly what the proposal pins: the one-prop fix, the prop pin, the spec
modification with the two new scenarios, and the browser probe rerun on the failing geometry.
All four tasks ticked with evidence.

## Counts

- Blocker: 0 · Major: 0 · Minor: 0 · Trivial: 0
- Standards axis worst: none. Spec axis: no failing items.
- Test gate: 67 files / 815 tests, exit 0 — independently reproduced.
