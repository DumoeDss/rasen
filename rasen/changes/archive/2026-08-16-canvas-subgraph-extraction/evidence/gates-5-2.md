# Gates — task 5.2 (canvas-subgraph-extraction)

Run 2026-08-17, worktree `feat/canvas-gesture-ir-compiler` @ HEAD `5973d2ea`
(child-1 archive on ship `115857a0` on base `74568906` — the diff base named
by the task; the LEAD has not re-pinned it).

## IR frozen

- `git diff 74568906..HEAD -- src/core/pipeline-registry/` → **empty (0 lines)**.
- `git status --porcelain -- src/core/pipeline-registry/` (working tree) → **empty (0 entries)**.
- No file under `src/core/pipeline-registry/` was edited at any point in this
  change; `definition.ts` was read only (the `stage:`-prefix reference forms
  and the normalizeV1 rewire idiom).

## `V2_BODY_PALETTE_KINDS` unchanged

`packages/ui/src/canvas/draft.ts:704`:

```ts
export const V2_BODY_PALETTE_KINDS: readonly V2EditableNodeKind[] = ['AtomicStage'];
```

Still exactly `['AtomicStage']` — the spec-forbidden widening did not happen,
and `subgraphExtractionRefusals` rule 1 reads this constant (not its own list),
so the refusal vocabulary and the body palette cannot drift.

## Per-declaration-row insert action untouched (no capability hole)

`git diff 74568906 -- packages/ui/src/canvas/DeclarationsPanel.tsx` → **12
changed lines, all of them doc comments plus the two `export` keywords added
to `NameListField`/`PortListEditor`** (so `V2ExtractReviewPanel` can reuse the
declarations editor's row UX — one implementation). **Zero** changed lines
match `declaration-insert-ref` / `Insert into graph` /
`isReferenceableDeclaration`: the insert action's markup, enablement rule, and
handler wiring are byte-identical to child 1's delivered state, and the
real-browser pass (task 5.1) exercised it on the extracted declaration's own
row (`composite-ref-2` added).

## Also verified en route (not required by the task, recorded for review)

- Zero `legacyRuntimeOwner` writes: asserted at the model layer
  (`draft.test.ts`, `not.toHaveProperty` over every declaration body node and
  every root node post-extraction) AND on the definition actually POSTed to
  validation (`pipeline-canvas-page.test.tsx` walks every node of the body the
  gate sends).
- Full UI suite (CI-canonical `pnpm --dir packages/ui exec vitest run`):
  **67 files / 794 tests, exit 0** — baseline 67/768, +26 (21 model, 5
  component), zero regressions.
