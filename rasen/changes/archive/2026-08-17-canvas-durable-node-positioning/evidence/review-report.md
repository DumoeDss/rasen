# Review report — canvas-durable-node-positioning (verify, round 0)

- Stage: verify (verifyPolicy standard — one pass, no fix loop). Reviewer: reviewer-2
  (independent, non-author; fresh for this change's diff).
- Date: 2026-08-17. Branch `feat/canvas-authoring-followups`, HEAD 8679c6aa.
- Target: uncommitted working-tree delta vs 8679c6aa under `packages/ui/`.
- Scope check: CLEAN — exactly the claimed 4 files (`layout.ts` +49, `PipelineCanvasPage.tsx`
  +72/-9 hunk mix, `layout.test.ts` +93, `pipeline-canvas-page.test.tsx` +475); `draft.ts`
  diff is 0 bytes; nothing else under `packages/ui/`. Note: `bin/rasen.js` shows M in
  status with a ZERO-byte content diff (CRLF phantom, known autocrlf artifact — a
  ship-time pathspec note, not this change's work).

## Verdict

**FINDINGS — 0 Blocker / 0 Major / 0 Minor / 2 Trivial.** The implementation matches the
planner-digest contract precisely: rule in the geometry module, page only wires,
apply-then-prune with the selection-carry untouched, rename carry before the rebuild,
session-only lifetime, payload clean. Independent test gate: 67 files / 880 tests,
879 passed + 1 pre-existing Windows i18n timeout flake (green on isolated rerun).

## Gate results

### Gate 1 — Scope and payload cleanliness: PASS

- `git diff 8679c6aa --name-only -- packages/ui/` = the 4 claimed files; `draft.ts`
  0-byte diff (no position write exists on any draft-mutation path); `src/core/`
  untouched (`git diff fb243e83 -- src/core/pipeline-registry/` empty).
- Payload-clean test exists AND discriminates: scenario-6 test recursively walks the
  body submitted to `mutatePipeline` rejecting any `position`/`x`/`y` key anywhere
  (`containsPlacementField`, pipeline-canvas-page.test.tsx) — any code path leaking a
  position into the draft fails it. Structural backstop: the cache lives in a page ref
  (`authorPositionsRef`) never merged into the draft.

### Gate 2 — The three mutation claims: PASS (pins are real)

- Cache-not-applied -> scenarios 1/2/4 fail: each asserts the dragged node renders at
  `placement` (computed position + the fixed drag delta, always distinct) after the
  rebuild; without the `layoutGraph` third argument the rebuild snaps back to dagre.
- Prune-off -> scenario 5 fails: delete-then-re-add under the freed id asserts the
  re-added node sits at the computed position AND `.not.toEqual(placement)` — with the
  prune disabled the stale cache entry would resurrect the departed placement.
- Relayout-clear-off -> scenario 6 fails: asserts every node returns to computed after
  Re-layout AND a later edit still treats them as undragged (clear, not unapply).
- Additionally judged: capture-off is discriminated by the same follow-up-rebuild
  assertions (the drag alone writes the mock's flow state regardless); rename-carry-off
  is discriminated by scenario 4 (`picker` at placement, not dagre). The implementer's
  gates-6.md records three targeted self-mutations, each caught — consistent with this
  static analysis.

### Gate 3 — Selection-carry parity and freed-id: PASS

- The selection-stamping code inside `recomputeFlow` is untouched (no diff hunks reach
  it; only the `layoutGraph(...)` call arguments changed inline above it).
- Freed-id path: delete handler calls `recomputeFlow` (one of its 37 call sites —
  verified it is the single choke point every mutation funnels through), whose prune
  re-keys the cache to the rebuilt node ids; the re-added id is absent from the cache
  and lays out afresh. Pinned by the scenario-5 jsdom test and the CDP "re-added under
  the freed id lands on computed layout" step.

### Gate 4 — Rename carry ordering: PASS

- `renameSelectedV2Node` moves the cache entry (delete old id, set new id) BEFORE
  `recomputeFlow(nextDraft)` in the same synchronous handler
  (PipelineCanvasPage.tsx:2090-2100 region); the subsequent prune sees the new id
  present and the old id already gone — no off-by-one window exists, and scenario 4
  pins the behavior.

### Gate 5 — v1 exclusion and view-mode callers: PASS

- v1 is excluded at three independent layers: capture guarded `draft?.version === 2`
  (onNodesChange), cache passed only `def.version === 2` (recomputeFlow), and
  `layoutGraph` never applies a cached position to a `parallelGroup` member
  (parent-relative coordinate contract preserved; unit-pinned via the grouped fixture).
- View-mode caller `PipelineCanvasPage.tsx:3151` (`return layoutGraph(nodes, edges)`)
  is unchanged — the optional parameter defaults to none.

### Gate 6 — Child-1 regressions: PASS

- Child-1's tests all green in the suite (NameListField blur commit, no-edit-blur
  guard, loop-review live read, sink locate, acceptance). This change's scenario-2
  test literally drives child-1's `definition-outcomes` blur commit as its
  contract-edit mutation — the two children compose as intended, and the dragged
  placement surviving that rebuild is the point of the change (pinned).
- The ReactFlow mock changes (position change type in `applyNodeChanges`, drag
  trigger, positions dump) are additive; no existing mock-contract test broke.

### Gate 7 — Independent test gate and evidence: PASS (one unrelated flake)

- Fresh run `pnpm --dir packages/ui exec vitest run` (never piped; output to file):
  **67 files / 880 tests — 879 passed, 1 failed, exit 1**; full failure enumeration
  (exactly one): `test/i18n/catalog.test.ts > all literal catalog keys referenced in
  src exist in en.json` — "Test timed out in 5000ms" during src file collection.
  Isolated rerun of that file: **12/12 passed, exit 0**. This is the documented
  Windows parallel-load timeout flake (memory: timeout-not-assertion class), in a
  file the delta does not touch (no i18n keys added anywhere in the diff); not
  blamed on the delta. Substantively corroborates the claimed 67/880 exit 0
  (866 baseline + 14 new: 6 layout/prune + 8 page, counted in the diff).
- Evidence cross-checked: `cdp-transcript.md` (12 PASS steps, real drag physics with
  zoom compensation 1.68447, real typed rename + Tab, ports 9345/9346 re-verified
  free after child 1 released them), `cdp-results.json`, 5 screenshots,
  `gates-6.md` with a complete scenario-by-scenario traceability table. The
  contract-edit rebuild variant is jsdom-pinned (CDP pins the same mechanism via the
  palette add) — the table says so honestly.

### Gate 8 — Frozen invariants: PASS

- `src/core/pipeline-registry/`: porcelain empty, diff vs fb243e83 empty.
- `V2_BODY_PALETTE_KINDS` still `['AtomicStage']` (draft.ts:750, file untouched).
- Zero `legacyRuntimeOwner` occurrences in the diff; no node synthesis added.

## Findings (canonical severities)

### 1. TRIVIAL — Page ref redeclares the AuthorPosition shape inline

- `PipelineCanvasPage.tsx:266` — `useRef<Map<string, { x: number; y: number }>>`
  duplicates the shape that `layout.ts:33` exports as `AuthorPosition` for exactly
  this use. Structural typing keeps it safe today; importing the type would keep the
  page declaration locked to the geometry module's vocabulary (the one-home rule's
  spirit). One-line import.

### 2. TRIVIAL — Muddled comment in the prune unit test

- `layout.test.ts` (pruneAuthorPositions describe): the comment "a re-added 'departs'
  cannot resurrect its departed placement" sits atop an assertion that actually
  demonstrates purity (the input map still holds 'departs' after a pruned view was
  returned). The no-resurrection behavior is proven by the page-level scenario-5
  test, not this unit — the comment points at the wrong proof. Cosmetic.

## Notes for the LEAD (no action required in this change)

- `bin/rasen.js` phantom M (0-byte diff): keep it out of the ship pathspec (narrow
  pathspec discipline already covers this); same for the untracked ephemera dirs
  (`.rasen-e2e-*`, `test-pipeline-e2e-*`, `.rasen-pipeline-command-*`) the planning
  context already marks never-commit.
- The spec's "wiring a connection" rebuild variant is not separately pinned by a
  dedicated test, but every connection mutation funnels through the same
  `recomputeFlow` choke point (37 call sites verified), where durability is pinned —
  structural coverage; not a gap worth a fix round.
