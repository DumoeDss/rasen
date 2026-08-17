# Handoff — implementer-1, canvas-multi-selection (apply)

## Status: COMPLETE — 14/14 tasks ticked; apply unit durable; parked to beat cap without further LEAD routing

- Change: `canvas-multi-selection` (child 1 of `canvas-gesture-ir-compiler`), stage apply.
- Worktree: `feat/canvas-gesture-ir-compiler` @ base `74568906`, **no commits made** (ship stage owns commits). Working-tree delta: `packages/ui/src/canvas/PipelineCanvasPage.tsx`, `packages/ui/src/canvas/draft.ts`, `packages/ui/test/canvas/draft.test.ts`, `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` modified; `packages/ui/src/canvas/V2SelectionPanel.tsx` + this change dir new.
- Tests: full UI suite **67 files / 765 tests, all passed** (baseline 67/743; +22: 12 model, 10 component). Run via `pnpm --dir packages/ui exec vitest run`.
- Real browser: **ALL CHECKS PASSED** — `evidence/cdp-transcript.md`, `evidence/cdp-results.json`, 6 screenshots, rerunnable driver `evidence/cdp-multi-selection-check.mjs`.
- Gates: `evidence/gates-5-2.md` — IR frozen (empty status + empty diff vs base), `V2_BODY_PALETTE_KINDS` still `['AtomicStage']`, no `legacyRuntimeOwner` writes.

## Decisions a successor must know

1. **Gesture handlers UNION the new node into the selection, not replace** (design D3 table said replace; the spec delta's "Selection survives a non-destructive edit" scenario REQUIRES previously selected nodes to stay selected across a palette add). Union preserves today's singleton behavior from an empty selection. The parallel gesture unions BOTH halves (fan-out + join) — the pair is one unit.
2. **`onSelectionChange` must return the SAME state for an unchanged value** (`PipelineCanvasPage.tsx`). React Flow's `SelectionListenerInner` effect depends on the callback's identity and fires once at mount; a fresh object for the same value = re-render → new callback → re-fire → **infinite loop, hard tab freeze**. This was caught ONLY by the real-browser check (jsdom mock invokes the callback from button clicks only). Do not "simplify" this guard away.
3. **`removeV2Nodes` removes selected FanOut pairs BEFORE plain nodes** (two-pass). Single-pass draft order refused the last parallel member when the FanOut was in the same batch — an order artifact for the natural box-select of a frontier plus its members. Pairs-first makes the unit delete as one; regression test in `draft.test.ts` ("removes EVERY member of a selected pair plus the pair").
4. FanOut/Join remain `deletable: false` in `layout.ts` (unchanged round-one invariant), so the Delete KEY never removes a pair — the **selection panel's delete button** is the pair-removal path (`deleteSelection` → `applyV2BatchRemoval(selection.nodeIds, selection.connectionIds)`), shared with `onNodesChange`/`onEdgesChange`.
5. `pruneSelectionToDraft(nextDraft)` (drop every selected id absent from the next draft) is the mechanism behind "removed elements leave the selection" at every removal site, including splice/unsplice/pair-delete.

## Eliminated hypotheses (debugging record)

- Tab freeze after entering the editor was NOT: server death (a real interruption killed my 4523 daemon once — reproduced ERR_CONNECTION_REFUSED, restarted), not the space-store effect re-run closing the editor, not dagre/catalog cost. It was the RF selection-listener loop (decision 2), proven by `@xyflow/react` dist `index.js:157-164` (`}, [selectedNodes, selectedEdges, onSelectionChange];`) + a CDP probe showing the click evaluate RETURN and every later evaluate time out.
- "Ctrl+click doesn't toggle" was NOT a page bug: RF tracks the multi-select key via real keydown (synthetic mouse `modifiers` bits don't reach it) — the driver now presses/releases Control around the click.
- "Box-select selects everything" was NOT selection semantics: (a) a box drag must START on bare pane (starting on a node = node drag) and needs a real Shift keydown; (b) authoring gestures create ISOLATED nodes that dagre stacks in one over-fold column — click React Flow's own fit-view control before coordinate interactions; (c) RF box-select tests rect INTERSECTION.

## Environment notes for reruns

- `pnpm exec vitest run --config packages/ui/vitest.config.ts` FROM REPO ROOT resolves `test/**` against the repo root on this machine and runs the ROOT suite (wrong corpus, prints pass) — use the CI-canonical `pnpm --dir packages/ui exec vitest run`. Recorded in `evidence/gates-5-2.md`.
- packages/ui has its OWN install (`pnpm --dir packages/ui install`); the worktree needed it fresh.
- Serving the worktree's UI build: `node bin/rasen.js ui --no-open --no-daemon --port <p>` + junction `node_modules/@atelierai/rasen-ui -> packages\ui` (created, gitignored, left in place) so `resolveUiPackageDir()` prefers the worktree dist; otherwise the daemon serves the MAIN checkout's stale dist.
- The repo's `cdp-proxy.mjs` hardwires 127.0.0.1 but this machine's Chrome 151 binds the debug port on ::1 only — the evidence driver talks CDP directly over localhost. Throwaway chrome (port 9333, temp profile) was terminated and the profile removed after the run; the 4523 server was stopped.

## Next action

Hand to review (per pipeline). Nothing is unticked; no commits exist for ship to build on yet — ship should commit with narrow pathspecs: the four modified files, `packages/ui/src/canvas/V2SelectionPanel.tsx`, and `rasen/changes/canvas-multi-selection/`.
