# Planning context — canvas-authoring-surface

LEAD-seeded before the first propose. Everything below is **already verified against the
code on `dev/0.2.0` @ 9aa2b9e4** — do not re-derive it, build on it.

## User intent (verbatim, translated context preserved)

The user opened the v2 pipeline editor (`TEST-EDIT`, a `version: 2` definition) and asked three
things: what does "Pipeline 编排" mean in 0.2.0, what are the left-hand ROOT NODES, and **why does
the middle column eat so much width that the node canvas is squeezed**.

Then, after being shown the answer, the user made a product judgement that is the actual driver of
this change:

> 我觉得这个设计的完全不是给普通人用的啊。Choice FanOut Join 这些不应该是底层逻辑吗？我想象中的
> 用户的使用体验，就是往 canvas 上创建 workflow 的节点，然后连线，能够连成环（有出口），能够连
> 并行节点，现在这样子复杂的根本不知道如何下手。

The user then locked the scope for THIS change to **layout fix + palette de-IR-ification, with the
IR itself untouched**. A third option (a full canvas-gesture → IR compiler that infers BoundedLoop
from a drawn back-edge, extracts the enclosed subgraph into a declaration, and infers FanOut/Join
from branch-and-reconverge topology) was explicitly deferred as too large for `small-feature`.
**Do not propose that compiler here.** It is the next round's work; at most, leave the seams clean
for it.

## Verified findings — the layout defect

- `packages/ui/src/canvas/PipelineCanvasPage.tsx:1975-1976` renders the v2 authoring column inside
  a bare `<div class="pipeline-canvas__authoring-contracts">`, holding `DefinitionContractPanel`
  and `DeclarationsPanel`. It renders only when `editable && draft?.version === 2`.
- **That class has no CSS rule anywhere.** Neither does `.definition-contract` (only
  `.definition-contract__field--invalid` at `style.css:1685` and `.definition-contract__error` at
  `:1688` exist) nor `.declarations-panel` (only `.declaration-editor__*` rules exist).
- Its siblings ARE constrained: `.palette-panel { width:200px; flex-shrink:0; overflow-y:auto }`
  (`style.css:1657`) and `.stage-panel { width:280px; flex-shrink:0; overflow-y:auto }` (`:1673`).
- The parent is `.pipeline-canvas__body { display:flex; gap:var(--space-4); flex:1; min-height:0 }`
  (`:1654`); the canvas column is `.pipeline-canvas__flow-column { flex:1; min-height:0; display:flex;
  flex-direction:column }` (`:1716`).
- Consequence: the authoring div is a `flex: 0 1 auto` item sized to max-content, so it takes ~800px
  and the canvas gets the remainder. Inside it, the `<label>` elements are inline with no column
  direction, which is why "Named outcomes / Maximum actions / Budget" render on one run-together
  line — the unstyled-DOM signature.
- Git corroborates WIP status: `DefinitionContractPanel.tsx` has exactly one commit,
  `d638f87d wip(preserve): snapshot in-flight v2-authoring and session-host work`.

### Spec gap that must close with it

`rasen/specs/pipelines-ui/spec.md:391` requires the graph route to fit the viewport with no
page-level scrollbar, and names **only** "the skills palette and the stage properties panel" as the
panels that scroll within their own bounds. The v2 authoring column was added without being brought
under that requirement. The delta spec must extend this requirement to cover the authoring column
(fixed-width, own scroll, canvas keeps the remaining space). Note the same requirement's closing
sentence: because DOM-only test environments perform no layout, this contract is verified against
**real browser layout**, not markup assertions — honor that when specifying verification.

## Verified findings — why the palette is wrong

The 8 ROOT NODES buttons are `V2_ROOT_PALETTE_KINDS` (`packages/ui/src/canvas/draft.ts:696-705`),
a 1:1 mirror of `ECP_NODE_KINDS` (`src/core/pipeline-registry/definition.ts:31-40`). The user's
instinct that these are "底层逻辑" is correct, and the engine already proves it:

`normalizeV1()` (`definition.ts:3377`) compiles a **flat v1 stage list** into the v2 IR, synthesizing
every non-AtomicStage kind from simple stage properties:

| v1 stage property | synthesized v2 node | site |
|---|---|---|
| `condition: "<expr>"` | `Choice` | `definition.ts:3581-3590` |
| `gate: true` | `Gate` + dispositions | `:3591-3602` |
| `loop: {kind: review-cycle}` | declaration + `BoundedLoop` | `:3603-3643` |
| `parallelGroup: "<name>"` | `FanOut` + `Join` **pair** + all connections | `:3644-3750` |

So a v1 author never saw FanOut/Join — they wrote one `parallelGroup` string on two stages. The v2
Canvas WIP surfaced the IR directly instead of keeping an authoring vocabulary above it.

**The palette already contradicts its own module:** `createParallelPair()`
(`packages/ui/src/canvas/draft.ts:795`) creates both structural halves of one parallel frontier as a
single transaction ("Creates both structural halves of one parallel frontier as one transaction"),
yet the palette still offers `FanOut` and `Join` as two independent buttons. That is exactly how the
user's screenshot ended up with a lone floating FanOut and a lone floating Join.

### Target division (user-approved)

Palette keeps only author-meaningful gestures:

- **Stage** — should list the actual installed skills, not the word "AtomicStage". The v1 branch of
  `PalettePanel.tsx:71-104` already renders exactly that skill-card list; reuse that affordance
  rather than writing a second one.
- **Parallel** — one gesture, routed through the existing `createParallelPair()`.
- **Loop** — BoundedLoop (still an explicit gesture this round; back-edge inference is out of scope).
- **Finish**.

Withdrawn from the root palette:

- **Choice** → belongs on the outgoing edge as its condition.
- **Gate** → belongs as a property on a Stage (it was `gate: boolean` in v1; see `types.ts:366`).
- **Join** → never authored alone; comes paired with Parallel.
- **CompositeRef** → a select-and-group gesture ("打成复用块"), not a palette item.

### Hard constraints on this change

1. **The IR is frozen.** `ECP_NODE_KINDS` and every node interface in `definition.ts` stay exactly
   as they are. This change only alters what the Canvas *exposes* and how the draft module composes
   IR nodes on the author's behalf.
2. **Do not delete capability the palette is the only route to.** Anything withdrawn from the
   palette MUST have its replacement affordance land in the same change, or authors lose the ability
   to build a shape they could build before. `DeclarationsPanel` exists precisely because otherwise
   "the Canvas could reference a declaration but never create one"
   (`PipelineCanvasPage.tsx:1973-1974`) — do not reintroduce that class of hole.
3. **Both palette vocabularies have one home by design.** `draft.ts:707-718` documents that
   `V2_ROOT_PALETTE_KINDS` and `V2_BODY_PALETTE_KINDS` live side by side because "this portfolio has
   already paid for four independent encodings of that question drifting apart." Keep the new
   gesture vocabulary in that same module; do not let `PalettePanel.tsx` re-decide insertability.
   The existing `referenceableDeclaration()` helper (`draft.ts:729`) exists for the same reason —
   palette availability and the insertion itself must read one rule.
4. `V2_BODY_PALETTE_KINDS` (declaration-body palette) is `['AtomicStage']` only, and
   `executable-custom-composite` spec forbids widening it. Do not touch it.

## Repo conventions that apply

- Canvas tests: `packages/ui` has its own vitest config. The root vitest config **excludes**
  `packages/ui`, so `pnpm exec vitest run packages/ui/test/` silently runs 0 tests while printing
  "passed". Run UI tests through `packages/ui`'s own config.
- DOM-only tests perform no layout — a width/flex regression cannot be caught by asserting markup.
  Spec `pipelines-ui:391` already anticipates this; say how the layout claim is actually verified.
- Do not hand-edit `.claude/skills/` (generated artifacts).
