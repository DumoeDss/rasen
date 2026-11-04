## Why

A user opened a `version: 2` pipeline in the Canvas editor and could not get started. Two
independent defects, reported in one sitting:

**The middle column swallows the canvas.** In v2 edit mode the editor renders a third column
holding the definition contract and the declarations editor. That column has no CSS rule at all —
not for its container, not for either panel inside it. As an unconstrained flex item it sizes to
max-content and takes roughly 800px, leaving the node graph a sliver, and its fields render as one
run-together line of text ("Named outcomes / Maximum actions / Budget") because nothing gives them
a column direction. Both sibling columns are already constrained (`.palette-panel` is 200px with
its own scroll, `.stage-panel` is 280px with its own scroll); this one was added without being
brought under the same rule.

**The palette speaks the IR, not the author's language.** The ROOT NODES palette lists eight
buttons that are a 1:1 mirror of the eight ECP node kinds: AtomicStage, CompositeRef, BoundedLoop,
Choice, FanOut, Join, Gate, Finish. The user's judgement, in their own words, was that Choice,
FanOut, and Join are underlying machinery, and that what they expect to do is place workflow nodes
on a canvas, wire them up, make a loop with an exit, and make things run in parallel — and that as
it stands they have no idea where to begin. (Verbatim quote preserved in `planning-context.md`.)

They are right, and the engine already agrees with them. `normalizeV1()` compiles a flat v1 stage
list into the same v2 IR by *synthesizing* every non-AtomicStage kind from ordinary stage
properties: `condition:` becomes a Choice, `gate: true` becomes a Gate, `loop:` becomes a
declaration plus a BoundedLoop, and one `parallelGroup:` string on two stages becomes a FanOut, a
Join, and all their connections. A v1 author never typed the word "FanOut" in their life. The v2
Canvas skipped the authoring vocabulary and put the compiler's output on a palette.

The palette also already contradicts its own module. `createParallelPair()` exists precisely to
create "both structural halves of one parallel frontier as one transaction" — and yet the palette
offers FanOut and Join as two separate buttons, which is exactly how the user's screenshot ended
up with one floating FanOut and one floating Join that mean nothing on their own.

## What Changes

**A. The v2 authoring column becomes a real, constrained column.**

- Give `.pipeline-canvas__authoring-contracts` a fixed width (280px, matching `.stage-panel`),
  `flex-shrink: 0`, and its own `overflow-y: auto`, so the node canvas keeps the remaining space
  no matter how much contract or declaration content exists.
- Give `.definition-contract` and `.declarations-panel` the stacked-card treatment their siblings
  already have (bordered surface, column layout, labelled fields on their own lines) so the
  contract fields stop rendering as one unstyled run-on line.
- Close the matching spec gap: the viewport requirement in `pipelines-ui` names only the skills
  palette and the stage properties panel as independently-scrolling panels. The authoring column
  comes under that same requirement.

**B. The ROOT palette offers author gestures instead of IR node kinds.**

The palette keeps four entries:

| Gesture | What it does | IR it composes |
|---|---|---|
| **Stage** | lists the actual installed skills, author picks one | one `AtomicStage` bound to that skill's exact capability |
| **Parallel** | one click | a `FanOut` + `Join` pair via the existing `createParallelPair()` |
| **Loop** | one click | a `BoundedLoop` over a declaration body |
| **Finish** | one click | a `Finish` node |

Four entries are withdrawn from the palette, each with its replacement affordance landing in this
same change — every node kind that was authorable before stays authorable, with one deliberate
narrowing recorded below:

| Withdrawn | Replacement affordance (in this change) |
|---|---|
| **Gate** | a *Requires approval* checkbox on the AtomicStage properties panel, which creates/removes the Gate node targeting that stage — this is what `gate: boolean` was in v1 |
| **Choice** | a *Condition* field on a selected outgoing edge, which splices a Choice onto that edge and un-splices it when cleared |
| **Join** | already paired with Parallel; the existing paired-delete control removes both |
| **CompositeRef** | an *Insert into graph* action on each row of the Declarations panel — where the reusable blocks already live |

Two of these are strict improvements, not just relocations. Today the palette's AtomicStage button
silently binds the *first* enabled capability it finds, and the CompositeRef button silently
references the *first* declaration it finds; in both cases the author now chooses.

**The one deliberate narrowing: Choice.** Splicing always requires a non-blank condition, and a
condition cannot be cleared off a Choice while keeping the node — so `{ kind: 'Choice',
outcomes: ['default'] }` with no `expression`, precisely what the withdrawn palette button
produced, is no longer producible by any sequence of editor actions. That is the point: a branch
point with placeholder outcome labels and no condition is a shape the engine cannot evaluate and an
author cannot use, and it was the *only* shape the button could make. What survives is stated
exactly: the branch *structure* is fully reachable through splicing, arbitrary outcome labels
remain reachable on any Choice through the Branch-outcomes field, and any existing definition
containing a Choice in any shape still loads, renders, edits, and saves in that shape. Gate,
FanOut+Join, and CompositeRef are relocations with byte-identical output and carry no such caveat.

**C. One home for the palette vocabulary.** The gesture list, the IR composition helpers, and the
"which gestures are available right now" rule all live in `packages/ui/src/canvas/draft.ts`, beside
`V2_BODY_PALETTE_KINDS`, whose comment already records that this project has paid for four
independent encodings of that question drifting apart. `V2_ROOT_PALETTE_KINDS` is removed rather
than left alongside the new vocabulary. `PalettePanel.tsx` renders what it is handed and decides
nothing — including the AtomicStage-availability rule it currently hardcodes in its own body, in
direct contradiction of its own doc comment.

**Not changing:** the IR itself. `ECP_NODE_KINDS` and every node interface in
`src/core/pipeline-registry/definition.ts` stay byte-identical. This change alters only what the
Canvas *exposes* and how the draft module composes IR nodes on the author's behalf. The
declaration-body palette (`V2_BODY_PALETTE_KINDS`, `AtomicStage`-only) is untouched.

**Explicitly out of scope** (deferred by the user as too large for one change): the canvas-gesture
→ IR compiler that would infer a BoundedLoop from a drawn back-edge, extract an enclosed subgraph
into a declaration, or infer FanOut/Join purely from branch-and-reconverge topology. Loop and
Parallel remain explicit gestures here. Because *"extract the enclosed subgraph into a
declaration"* is named in that deferral, the select-and-group version of the CompositeRef gesture
is deferred with it; the parity-preserving *Insert into graph* affordance above closes the
capability hole in this round, and `design.md` records the seam.

## Capabilities

### New Capabilities

None. This change modifies the behavior of existing UI capabilities.

### Modified Capabilities

- `pipelines-ui`: (1) the viewport requirement extends to the v2 authoring column — fixed width,
  its own scroll, canvas keeps the remainder; (2) the v2 root-vocabulary requirement is reframed
  from "the palette offers node kinds" to "the palette offers author gestures", with Gate authored
  as a stage property and Choice as an edge condition, while all eight kinds remain renderable,
  selectable, editable, and deletable.
- `executable-custom-composite`: referencing a declaration from the root graph moves from the root
  palette to a per-declaration *Insert into graph* action, and the author chooses which declaration
  instead of the editor picking the first one it finds.

## Impact

**Code**

- `packages/ui/src/style.css` — new rules for `.pipeline-canvas__authoring-contracts`,
  `.definition-contract`, `.declarations-panel` and their fields.
- `packages/ui/src/canvas/draft.ts` — gesture vocabulary, gesture-availability rule, and the
  composition helpers (`setStageGate`, `setConnectionCondition`, stage-from-capability); removal of
  `V2_ROOT_PALETTE_KINDS`.
- `packages/ui/src/canvas/PalettePanel.tsx` — renders gestures and, for Stage, the installed-skill
  card list already used in v1; stops deciding availability itself.
- `packages/ui/src/canvas/PipelineCanvasPage.tsx` — routes gestures to the helpers; edge selection
  for the condition affordance.
- `packages/ui/src/canvas/V2NodePanel.tsx` — the AtomicStage gate checkbox and the edge-condition
  editor.
- `packages/ui/src/canvas/DeclarationsPanel.tsx` — per-declaration *Insert into graph* action.

**Not touched**: `src/core/pipeline-registry/definition.ts` (frozen IR), the server, the wire
format, and any saved definition. Every gesture produces IR that was already producible by hand, so
existing v2 definitions load, edit, and save unchanged.

**Tests**: `packages/ui` has its own vitest config and the root config excludes it — UI tests must
run through `packages/ui`'s config or they silently run zero tests. The layout claim cannot be
verified by DOM assertions (jsdom performs no layout); it is verified by a CSS contract pin in the
style of `packages/ui/test/style/canvas-lock.test.ts` plus a real-browser measurement recorded as
evidence, exactly as the existing viewport requirement already demands.
