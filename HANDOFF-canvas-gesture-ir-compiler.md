# Handoff — Canvas gesture → IR compiler (the full deferred scope)

**Written 2026-08-16 by the LEAD of the `canvas-authoring-surface` run, for a fresh session that
will do the whole thing.** Everything stated as verified below was checked against the code at
`dev/0.2.0` tip `74568906`. Treat unverified claims in this doc as absent — there are none I know of,
and if you find one, that is a defect in this handoff, not a thing to work around.

---

## 1. Where this came from (do not lose the why)

The user opened the v2 pipeline canvas, saw the ROOT NODES palette listing all eight raw ECP node
kinds, and said:

> 我觉得这个设计的完全不是给普通人用的啊。Choice FanOut Join 这些不应该是底层逻辑吗？我想象中的
> 用户的使用体验，就是往 canvas 上创建 workflow 的节点，然后连线，能够连成环（有出口），能够连
> 并行节点，现在这样子复杂的根本不知道如何下手。

That sentence is the acceptance criterion for this whole workstream. The target experience is:
**drop nodes, draw edges, and let the editor infer the IR** — loops from a back-edge (with an exit),
parallelism from edges that fan out and reconverge. The author should never meet the word
`FanOut`, `Join`, or `Choice`.

## 2. What already shipped (PR #165, merged as `7456890`)

Round one delivered the *palette* half and the layout fix. Archived as
`rasen/changes/archive/2026-08-16-canvas-authoring-surface/` (archive PR #166).

- The authoring column was completely unstyled and stole ~800px from the graph. Now constrained:
  live-browser measured `width=280px`, `overflow-y=auto`, `flex-shrink=0`; flow column 856px;
  `documentElement.scrollHeight` 805 === `innerHeight` 805 (no page scroll).
- The palette went from 8 IR kinds to **4 author gestures**: Stage / Parallel / Loop / Finish.
  Gate became a Stage property, Choice became a connection condition, Join comes paired with
  Parallel, CompositeRef became a per-declaration-row "Insert into graph" action.
- **The IR was frozen and stays frozen.** `src/core/pipeline-registry/` was untouched and must
  remain untouched by this workstream too.

**What it deliberately did NOT do — your scope:** every gesture is still *explicit*. You still click
"Loop" to get a BoundedLoop and "Parallel" to get a FanOut+Join pair. Nothing is inferred from
topology, and there is no way to turn a set of existing nodes into a reusable declaration.

## 3. The design argument (this is why the approach is sound, keep it in the PR body)

The engine already contains a compiler in the other direction, and it is the proof that these node
kinds are IR rather than author vocabulary. `normalizeV1()` at
`src/core/pipeline-registry/definition.ts:3377` takes a **flat v1 stage list** and synthesizes every
non-AtomicStage kind from simple stage properties:

| v1 stage property | synthesized v2 node | site |
|---|---|---|
| `condition: "<expr>"` | `Choice` | `definition.ts:3581-3590` |
| `gate: true` | `Gate` + dispositions | `:3591-3602` |
| `loop: {kind: review-cycle}` | declaration + `BoundedLoop` | `:3603-3643` |
| `parallelGroup: "<name>"` | `FanOut` + `Join` **pair** + all connections | `:3644-3750` |

A v1 author never saw FanOut/Join — they wrote one `parallelGroup` string on two stages.

**The trap in reusing those templates:** nodes `normalizeV1()` emits carry
`legacyRuntimeOwner: 'prompt-owned-v1'`, and `orchestrationEvaluatorCapabilityFor()`
(`definition.ts:220-228`) reads the *absence* of that field as "authored, therefore requires a
`choice-select` orchestration evaluator". **Never copy `legacyRuntimeOwner` onto a node you
synthesize on an author's behalf** — stamping it silently exempts the node from an evaluator
requirement. Round one has a real guard for this (`not.toHaveProperty` at both the model layer and
on the definition actually POSTed, `pipeline-canvas-page.test.tsx:1344`); keep that discipline.

## 4. The decomposition

```
A  multi-selection model
    └─ B  subgraph extraction  (框选「打成复用块」)
            └─ C  back-edge → BoundedLoop inference
D  branch/reconverge → FanOut+Join inference
E  sink → Finish inference
```

**A — multi-selection model.** Today there is **no multi-select at all**: selection is three single
scalars, `selectedStageId` / `selectedConnectionId` / `selectedDeclarationId`, each `string | null`
(`PipelineCanvasPage.tsx:148`, `:152`, `:154`). No `SelectionMode`, no box-select, no
`onSelectionChange` anywhere in that file — verified by grep. You need Set-based selection state,
React Flow box-select, and every panel taught to render a multi-selection state. This ripples
through the node/edge mutual-exclusivity logic that round one just added (`onEdgeClick`, and
`onPaneClick` clearing both). Independently shippable on its own merits (multi-delete).

**B — subgraph extraction.** The real work: compute the cut for a selected node set, derive the
declaration's `inputs`/`artifacts`/`outcomes` from the edges the cut severs, build the
`CompositeDeclaration`, replace the selected nodes with a `CompositeRef`, and rewire root
connections onto that ref's ports. Depends on A for the selection. **This is the piece the previous
round deferred**, and the user's originally-approved wording for it was 框选「打成复用块」.

**C — back-edge → BoundedLoop.** A drawn back-edge alone does not carry the bound; the author must
supply max iterations and the exit outcome (the user already intuited this — "能够连成环（有出口）").
Then synthesize the BoundedLoop. **Depends on B**, because `BoundedLoopNode.body` is a
**declaration id** (`definition.ts:137`), not an inline subgraph — so the enclosed nodes must first
be extractable into a declaration. That dependency is structural, not a preference.

**D — FanOut+Join inference.** Edges that fan out from one node and reconverge at another are
structurally a parallel frontier. `createParallelPair()` (`draft.ts:940`) already builds both halves
as one transaction, and `addParallelFrontier()` (`:817`) already wraps it with defaults — so this
slice is mostly *detection* plus letting the author set `concurrencyCap` / `budget` /
required-vs-optional members on the inferred pair.

**E — sink → Finish inference.** Nodes with no outgoing edge are terminal; the author input is only
which named outcome each one carries. Smallest slice by far.

### Expect serial execution, and do not fight it

A/B/C is a hard chain. **D and E are logically independent of it but will still be forced serial**,
because rasen's parallel rule requires *no dependency edge* **AND** *no overlap in touched
capabilities / spec folders / files* — and all five slices edit `packages/ui/src/canvas/draft.ts`
and the `pipelines-ui` spec. Uncertain independence is treated as a dependency by design
("宁可串行也不能乱并行"). So `auto-decompose` buys you **separately reviewable diffs and incremental
landing**, not wall-clock parallelism. That is still worth it at this size; just do not expect a
speedup and do not be tempted to "prove" independence by splitting the shared files.

### Suggested invocation

```
/rasen-auto auto-decompose <describe the full gesture→IR compiler, referencing this handoff>
```

Point the planner at this file. Reasonable child pipelines: `full-feature` for A and B (the
selection refactor and the extraction algorithm both deserve the expert-review fan-out),
`small-feature` for C, D, E.

## 5. The current API surface you are building on

All in `packages/ui/src/canvas/draft.ts` (line numbers at `74568906`):

| symbol | line | note |
|---|---|---|
| `V2RootGesture` / `V2_ROOT_PALETTE_GESTURES` | `716` / `718` | the four author gestures |
| `V2_BODY_PALETTE_KINDS` | `704` | `['AtomicStage']` — **do not widen**, a spec forbids it |
| `unavailableRootGestures` | `746` | the single availability rule; panels must not re-decide |
| `isBindableSkill` | `736` | single owner of the `enabled && capability` predicate |
| `isReferenceableDeclaration` | `768` | |
| `addAtomicStageForCapability` | `795` | |
| `addParallelFrontier` / `createParallelPair` | `817` / `940` | **reuse for slice D** |
| `addBoundedLoopOverDeclaration` | `843` | **reuse for slice C** |
| `addFinishNode` | `870` | **reuse for slice E** |
| `insertCompositeRef` | `880` | **reuse for slice B's final step** |
| `gateForStage` / `setStageGate` | `1221` / `1238` | |
| `spliceConditionOntoConnection` / `unspliceChoice` | `1372` / `1447` | |

New file from round one: `packages/ui/src/canvas/V2ConnectionPanel.tsx`.

## 6. Non-negotiable constraints (all four were enforced in round one)

1. **The IR is frozen.** No edits under `src/core/pipeline-registry/`. Assert it: `git diff <base> --
   src/core/pipeline-registry/` must be empty.
2. **No capability holes.** Anything an inference replaces must still be authorable. If you make
   Parallel inferred, the explicit gesture either stays or its replacement lands in the same change.
3. **One home for the vocabulary.** The gesture list, the availability rule, and the composition
   helpers all live in `draft.ts`; `PalettePanel.tsx` renders and decides nothing. Its own doc
   comment says so, and round one had to strip a contradiction it had accumulated at `:48-51`.
   `draft.ts:707-718`'s comment records why: *"this portfolio has already paid for four independent
   encodings of that question drifting apart."*
4. **`V2_BODY_PALETTE_KINDS` stays `['AtomicStage']`.**

## 7. Repo traps that cost real time in round one

- **`packages/ui` has its OWN vitest config.** The root config *excludes* it, so
  `pnpm exec vitest run packages/ui/test/` runs **0 tests and prints "passed"**. Always cite the
  count. Current baseline: **67 files / 743 tests**.
- **jsdom performs no layout.** A width/flex claim cannot be substantiated by markup assertions. The
  repo's answer is two layers: a string-level CSS pin
  (`packages/ui/test/style/canvas-authoring-column-lock.test.ts`) **plus** a real-browser
  measurement. One layer alone is a known escape.
- **Real browser IS available** — a previous worker wrongly concluded otherwise after grepping for
  playwright/puppeteer. The route is CDP against real Chrome:
  `C:\Program Files\Google\Chrome\Application\chrome.exe` plus the repo's own
  `skills/experts/chrome-use/scripts/cdp-proxy.mjs`. Launch a **throwaway** instance
  (`--remote-debugging-port` + fresh temp `--user-data-dir`); the user's daily Chrome already has a
  proxy latched on 3456→9222 and must not be touched.
- **CSS pins must anchor the property AND the value.** `/width:\s*280px/` also matches
  `min-width: 280px`; `flex-shrink: 0` also matches `0.5`; `flex-direction: column` also matches
  `column-reverse`. All three were live holes. Round one added a `declares(prop, value)` helper with
  a near-miss meta-guard — use it.
- **Mutation proofs must land where you aim them.** `String.replace` with a literal hits the FIRST
  match, and `display: flex; flex-direction: column; gap: var(--space-2);` occurs **19 times** in
  `style.css`. Assert the anchor is unique, print the resulting line number, eyeball the neighbours.
  A misplaced mutation reports a false green indistinguishable from a real pass.
- **`recomputeFlow()` (`PipelineCanvasPage.tsx:304-316`) re-runs `layoutGraph` over every v2 node
  after each mutation**, so node positions are non-durable by construction. If any slice wants
  manual placement or drag, that function has to change first — today a drop coordinate is
  discarded on the next keystroke. Relevant to A.
- **Windows test flakiness is real and is always a timeout, never an assertion.** Before blaming
  your delta: re-run in isolation *on a settled machine* (another session's test run is invisible in
  your output and will contaminate a "clean" single-file measurement), and stash the delta to see
  whether the failure moves to an unrelated file.
- **Never pipe a gate command through `tail`.** The pipeline's exit status is `tail`'s, so a red
  suite reports exit 0, and the full failure list you need to enumerate is destroyed.
- **Narrow pathspec on every commit.** Throwaway `.rasen-e2e-*` / `.rasen-pipeline-command-*` dirs
  accumulate at the repo root; `.rasen/` is run-state ephemera. Never `git add -A`.
- **The stash stack is shared across worktrees.** Do not use bare `git stash`.
- **CRLF churn**: files can show as modified with an empty `git diff` (line endings only). Do not
  commit those.

## 8. Open decisions this handoff does NOT make

- Whether the explicit **Loop** and **Parallel** gestures survive once C and D land, or are replaced
  by pure inference. Round one's position is that explicit gestures are fine and inference is
  additive; that is a judgement to revisit with the working code in hand.
- Whether A is worth shipping alone. It is independently useful (multi-delete), but if the user
  wants everything anyway, it may read better as the first half of B's PR.
- **Recommendation from round one, offered and not taken up:** do A+B first and re-evaluate, because
  after 框选打包 lands the explicit Loop/Parallel gestures may already be enough. The user has since
  chosen to do all of it — this is recorded so the reasoning is visible, not to relitigate it.

## 9. Unrelated defect found along the way — do not fold it in

**Canvas Save does not persist.** Saving a v2 definition does not write
`~/.rasen/pipelines/<name>/pipeline.yaml`; the project-scoped in-repo locations implied by
`registry.json` were ruled out too. Verified **pre-existing**: `PipelineCanvasPage.tsx` changed 281
lines in round one with **zero** added/removed lines matching `save|persist|client.`. It blocked the
JSON-capture half of round one's task 10.5, which is why that task is honestly unticked at 49/50.
The LEAD of round one is investigating this separately. **Do not fix it inside this workstream** —
but be aware that any end-to-end verification of your slices that depends on saving and reloading a
definition will hit it.
