# Review report — canvas-authoring-surface

- Reviewer: dispatched leaf reviewer (report-only), `verify` stage, `small-feature` pipeline, verifyPolicy `standard`
- Branch: `feat/canvas-authoring-surface`, base `dev/0.2.0` @ 9aa2b9e4
- Date: 2026-08-16
- Mode: dispatched / report-only. No code edited, no commits, no subagents.

## Counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 3 |
| Minor | 6 |
| Trivial | 2 |

Nothing here blocks on its own reading. Finding M2 is graded Major with an explicit note
that the LEAD may re-grade it to Blocker under the dispatch's own claim-1 rule; the argument
both ways is written out under that finding.

## Scope check

- **Intent:** constrain the v2 authoring column; re-divide the ROOT palette into four author
  gestures; ship a replacement affordance for each of the four withdrawn node kinds.
- **Delivered:** exactly that. Ten tracked files plus two new untracked files
  (`packages/ui/src/canvas/V2ConnectionPanel.tsx`,
  `packages/ui/test/style/canvas-authoring-column-lock.test.ts`), all under `packages/ui`.
- **Result: CLEAN.** No scope creep found. No requirement from `proposal.md` / `tasks.md`
  found unaddressed other than the two unticked verification tasks noted at m6.

Note for whoever commits: the two new files are **untracked**, so `git diff dev/0.2.0` does
not show them. Any review or gate that reads only the tracked diff misses `V2ConnectionPanel.tsx`
and the entire new CSS pin test.

---

## Major findings

### M1 — `unspliceChoice` silently discards a second inbound edge, or a second `matched` outbound edge

`packages/ui/src/canvas/draft.ts:1430-1452`

```
const inbound   = def.root.connections.find(c => c.to.node === choiceId);      // :1430  FIRST only
const outbound  = def.root.connections.filter(c => c.from.node === choiceId);  // :1431
const matchedOut= outbound.find(c => c.from.port === 'matched');               // :1432  FIRST only
const strayOut  = outbound.filter(c => c.from.port !== 'matched');             // :1433
```

`strayOut` guards only ports *other than* `matched`. `removeV2Node` (`draft.ts:1190-1193`)
then deletes **every** connection incident on the Choice, and only the single `inbound` /
`matchedOut` pair is restored (`:1440-1452`). Therefore:

- a Choice with **two inbound** connections → the second is deleted with no refusal and no toast;
- a Choice whose **`matched` port fans out to two targets** → the second is deleted with no
  refusal and no toast. `strayOut` cannot see it, because both have port `matched`.

**Reachable through ordinary UI actions.** `onConnect` (`PipelineCanvasPage.tsx:605-651`)
imposes no per-port arity limit, and `v2ConnectionIdFor` keys on both endpoints, so the two
duplicates get distinct ids and `addV2Connection` (`draft.ts:1310-1328`, dedupes on id only)
accepts both. Splice a condition, drag a second edge into the Choice, clear the condition —
the second edge is gone.

This is the exact failure class design D5 wrote the guard for, and it is a `SHALL` in this
change's own delta: *"Clearing SHALL be refused, with an explanation and no change, when
another branch of that branch point is wired, so no authored branch is silently discarded"*
(`specs/pipelines-ui/spec.md:53-54`).

**Fix:** make the guard count rather than find. Refuse when `inbound.length > 1` or when more
than one outbound uses `matched`, naming the extra edge the same way `strayOut` already does.

### M2 — the pre-change Choice shape is genuinely no longer authorable; three artifacts claim otherwise

Verified end to end, not inferred:

- `spliceConditionOntoConnection` (`draft.ts:1364-1367`) refuses a blank expression, so every
  authored Choice is born with an `expression` key.
- `commitExpression` (`V2NodePanel.tsx:168-176`) resets the field and returns on a blank input,
  so `expression` can **never be cleared** once present. There is no other affordance that removes it.
- The old outcome labels *are* still reachable: the pre-existing Branch-outcomes field renders
  for Choice (`V2NodePanel.tsx:273-293`) and `patchV2Node` → `updateV2NodeFields`
  (`PipelineCanvasPage.tsx:1162-1177`, `draft.ts:350-364`) is a plain spread with no allowlist.

So `{ id, kind: 'Choice', outcomes: ['default'] }` **with no `expression` key** — precisely what
the withdrawn palette button produced — is no longer producible by any sequence of editor actions.

The change's own test comment says so plainly (`pipeline-canvas-page.test.tsx:1218-1220`:
*"the old arbitrary-outcome-label shape, which is no longer authorable"*), and the fixture
docblock repeats it (`test/fixtures/canvas-v2-authoring.ts:196-205`). Three shipped artifacts
say the opposite:

| Artifact | Line | Claim |
|---|---|---|
| `specs/pipelines-ui/spec.md` | :118 | "every graph shape that was creatable through the editor SHALL remain creatable" |
| `specs/pipelines-ui/spec.md` | :131 | "AND the resulting definition is the same shape the editor produced for those kinds before the palette changed" |
| `proposal.md` | :60 | "no shape that was authorable before becomes unauthorable" |

All three are false for Choice. A spec that asserts a behavior the implementation does not have
misleads every future reader and every archive-time parity check.

**Fix (cheapest, and consistent with the already-approved D5):** carve the Choice narrowing into
the spec scenario and the proposal explicitly — D5 already made, argued, and disclosed the
decision; only the prose overclaims. **Alternative fix:** let `commitExpression` clear the field
(delete the key on blank), which would make the literal claim true.

**Grading note.** The dispatch's claim 1 says a replacement producing a *different* IR shape is
a Blocker. I grade this **Major**, not Blocker, because (a) the difference is one extra string
field that the design records as inert to today's engine and invisible to validation
(`definition.ts:1440-1441` reads only `outcomes`), (b) the old outcome labels remain reachable,
(c) the narrowing was a deliberate, argued, disclosed design decision rather than an oversight,
and (d) the defect that actually needs fixing is prose. If the LEAD treats the spec text as
binding-as-written, this is a Blocker on claim 1's own rule and the fix is one of the two above.

### M3 — the "disabled skill greyed **with its state named**" SHALL is half-implemented and has zero test coverage

`specs/pipelines-ui/spec.md:10-11` and scenario `:27`: *"skills the catalog reports as disabled,
or that carry no exact capability revision, SHALL be visibly greyed **with their state named**
and SHALL NOT be placeable."*

`PalettePanel.tsx:78-92` renders only `{skill.id}`, a `palette-card--disabled` class, a `disabled`
attribute, and a `title` tooltip. The v1 branch it was explicitly modeled on (D3: *"greyed exactly
as v1 greys disabled skills"*) additionally renders a **visible** state span
(`PalettePanel.tsx:138-145`, `<span class="palette-card__state">disabled</span>`,
testid `palette-card-disabled-state`). A tooltip is not a named state on screen.

And nothing tests it. `v2CatalogFixture` (`pipeline-canvas-page.test.tsx:265-266` and `:277-289`)
holds exactly two skills, **both `enabled: true` and both carrying a capability**, so
`skillDisabled` (`PalettePanel.tsx:76`) evaluates `false` at all nine v2 Stage-gesture call sites.
The greying, the `--disabled` class, the `disabled` attribute, and the "cannot be placed"
guarantee are asserted nowhere.

**Fix:** render the state span in the v2 branch as v1 does, and add a catalog fixture variant
with one disabled skill and one skill lacking a capability, asserting both are greyed, named,
and non-placeable.

---

## Minor findings

### m1 — the CSS width pin passes a `min-width` / `max-width` regression

`packages/ui/test/style/canvas-authoring-column-lock.test.ts:37`

```
expect(block).toMatch(/width:\s*280px/);
```

`min-width: 280px` and `max-width: 280px` both contain the substring `width: 280px`. Verified:

```
/width:\s*280px/.test('  min-width: 280px; flex-shrink: 0; overflow-y: auto;')  -> true
/width:\s*280px/.test('  max-width: 280px;')                                    -> true
```

Swapping `width` for `min-width` restores exactly the content-driven sizing this change exists
to remove, and the pin stays green. That is the "rule exists but does not constrain" failure
D8 named as the known local trap.

**Fix:** anchor the property, e.g. `/(^|[;{]\s*)width:\s*280px/`.

The pin's other assertions are sound — `flex-shrink: 0`, `overflow-y: auto`, and
`flex-direction: column` all fail correctly on removal, and `blockForSelectorAmong`'s
`\s*[,{]` terminator correctly refuses to match `.definition-contract__field` for
`.definition-contract`. This is the one hole.

### m2 — the availability predicate is duplicated back into `PalettePanel`

`PalettePanel.tsx:76` — `const skillDisabled = !skill.enabled || !skill.capability;` — is the
same predicate as `exactCapabilities()` (`PipelineCanvasPage.tsx:920-924`,
`.filter(skill => skill.enabled && skill.capability)`), the function that produces the
`disabledGestures` entry for `stage`. Two encodings of one rule, in two modules.

Design D3 sanctions the greying, so this is not a design violation, and the *gesture*
contradiction the change targeted is genuinely gone. But "one home" exists to keep exactly this
question single-sourced.

**Fix:** export `isBindableSkill(skill)` from `draft.ts` and have both call sites read it.

### m3 — no page-level coverage for the Choice expression editor or the "Remove condition" action

`v2-node-panel-choice-expression` (`V2NodePanel.tsx:302`) and `v2-node-panel-unsplice-choice`
(`V2NodePanel.tsx:314`) appear in **zero** test files. `unspliceChoice` is covered at the model
layer (`v2-authoring-model.test.ts`), but the wiring
`V2NodePanel → onUnspliceChoice → unspliceSelectedChoice → unspliceChoice`
(`PipelineCanvasPage.tsx:2122`) is untested, as is `commitExpression → onPatch({expression})`.
Tasks 7.4 and 9.2 both name that affordance; the spec scenario
"Clearing an unwired condition restores the direct connection" (`specs/pipelines-ui/spec.md:80-83`)
has no page-level test.

### m4 — `spliceConditionOntoConnection`'s read-only-endpoint refusal is untested

`draft.ts:1368-1377` (task 5.1's first clause). The model tests cover the missing-connection and
blank-expression refusals but not this one.

### m5 — `<button>` nested inside `<label>`

`V2NodePanel.tsx:294-320`: the "Remove condition" button sits inside the `<label>` wrapping the
expression input. Nested interactive content in a label is invalid HTML, and the label's
activation behavior forwards the click to the labeled control — focusing the input, then blurring
it, which runs `commitExpression` as a side effect of pressing an unrelated button.

**Fix:** move the button out of the `<label>`.

### m6 — task 10.3 is also unticked, and untracked temp dirs will be swept by a broad `git add`

`tasks.md:76` (10.3) is unticked alongside the dispositioned 10.5. Its three parts:

- "confirm `git diff` touches no file under `src/core/pipeline-registry/`" — **I verified this
  independently; it is clean** (see claim 2 below).
- "Run the root suite" and "`pnpm build`" — not run by this review and no evidence recorded.

Separately, `git status` in this worktree shows untracked temp directories at the repo root:
`.rasen-e2e-bugfix-BxSy2O/`, `.rasen-e2e-bugfix-VgEQmg/`, `.rasen-e2e-complex-pcHozn/`,
`.rasen-pipeline-command-GNGqDU/`, `.rasen-pipeline-command-rLhXkY/`,
`.rasen-pipeline-command-vYWQTS/`. A `git add -A` at ship time commits them. Use a narrow
pathspec (this repo already has a shared-index pathspec discipline).

---

## Trivial findings

### t1 — the kind-list assertion at the `:1098` site was weakened from an ordered array to a Set

`pipeline-canvas-page.test.tsx:1188-1196`: `toEqual([...eight kinds])` became
`new Set(...) toEqual(new Set([...]))`, dropping the node-order assertion. Harmless in practice —
the deep-equal against `CANVAS_V2_GESTURE_AUTHORED_DEFINITION` five lines above (`:1183`) already
pins order — but it is a weakening rather than a rewrite, so it is recorded rather than dropped.

### t2 — a misleading parity-test comment, and one unstyled new control

- `pipeline-canvas-page.test.tsx:1249-1251`: *"unlike the old raw-palette Gate, `setStageGate`
  does not (and need not) add a `root.connections` entry"* implies the old palette Gate added one.
  It did not — the removed branch called `addV2Node` alone. Behavior is identical; the comment
  reads as a difference where there is none.
- `.declarations-panel__insert-ref` (`DeclarationsPanel.tsx:184`) has no CSS rule, unlike the
  sibling classes task 1.4 styled. The live browser session exercised this control with
  declaration rows present and measured no layout problem, so this is cosmetic only.

---

## Verdict on the seven dispatch claims

### 1. No capability holes — PASS for Gate / Join / CompositeRef, PARTIAL for Choice

- **Gate — PASS, strictly better.** Old: `addV2RootNode('Gate')` always targeted *the first*
  AtomicStage. New: `setStageGate` targets the *selected* stage, with byte-identical outcomes
  and dispositions (`draft.ts:1218-1232` vs the removed branch). Gating a second stage was
  previously impossible; it now works. The only shape lost is two Gates targeting the same stage
  (`setStageGate` is idempotent at `:1220`) — a degenerate shape with no author value.
- **Join — PASS, confirmed independently.** The removed code (`PipelineCanvasPage.tsx`, branch
  `if (kind === 'FanOut' || kind === 'Join')`) ran the **same** `createParallelPair` for both
  buttons, differing only in which half got selected afterwards. A lone FanOut or a lone Join was
  never authorable. D7 is accurate.
- **CompositeRef — PASS, strictly better.** Same `isReferenceableDeclaration` predicate now reads
  by both the row's `disabled` (`DeclarationsPanel.tsx:183`) and `insertCompositeRef`
  (`draft.ts:864-871`); the author picks the declaration instead of getting the first one found.
  Confirmed the panel is unconditionally rendered in v2 edit mode
  (`PipelineCanvasPage.tsx:2002-2028`), so the action is always reachable.
- **Choice — PARTIAL.** The *branch structure* is fully reachable and the old outcome labels are
  re-editable, but the pre-change node shape (no `expression` key) is not reproducible. See M2.

### 2. The IR is frozen — PASS, verified independently

```
git diff dev/0.2.0 -- src/core/pipeline-registry/     -> empty
git diff dev/0.2.0 --stat -- src/core/pipeline-registry/ -> empty
```

No file under `src/core/pipeline-registry/` is touched, tracked or untracked. The whole branch
diff is confined to `packages/ui` plus the change's own artifacts.

### 3. The `legacyRuntimeOwner` trap — PASS, checked on the emitted shape

Checked the emitted node, not the comment. `spliceConditionOntoConnection` builds the Choice as an
object literal with exactly four keys — `id`, `kind`, `outcomes`, `expression`
(`draft.ts:1379-1388`) — and `addV2Node` appends it verbatim, so no `legacyRuntimeOwner` can be
present. Guarded at two independent layers with a real absence assertion:
`v2-authoring-model.test.ts` (`expect(choiceNode).not.toHaveProperty('legacyRuntimeOwner')`) and
`pipeline-canvas-page.test.tsx:1344` on the definition actually POSTed to `validatePipeline`.
Both would fail if the field were stamped. This one is properly closed.

### 4. One home for the vocabulary — PASS on gestures, PARTIAL on the skill predicate

- The gesture list, the availability rule (`unavailableRootGestures`, `draft.ts:730-740`), and all
  six composition helpers live in `draft.ts`. Confirmed.
- `V2_ROOT_PALETTE_KINDS` is gone from source (only doc-comment and change-artifact prose mention
  it), and `referenceableDeclaration` — the "find the first" wrapper — has zero remaining
  references in `packages/ui`.
- The `PalettePanel.tsx:48-51` contradiction is genuinely gone, not relocated: the panel now reads
  `disabledGestures` and recomputes no gesture rule (`PalettePanel.tsx:60`).
- **But** `PalettePanel.tsx:76` re-encodes the enabled+capability predicate that produced that
  very list. Sanctioned by D3, still a second home. See m2.

### 5. `V2_BODY_PALETTE_KINDS` untouched — PASS

`draft.ts:703` still reads `['AtomicStage']`, byte-identical (the diff only removes the
preceding constant). A dedicated new test pins it
(`v2-authoring-model.test.ts`, *"the declaration-body palette stays constrained to AtomicStage
only"*), and `pipeline-canvas-page.test.tsx:2585` still asserts the body palette offers no
widened kind.

### 6. Assertions replaced, not deleted — PASS

- Zero live `v2-palette-add-<Kind>` call sites remain; the four surviving textual references are
  three explanatory comments and one **negative** assertion
  (`pipeline-canvas-page.test.tsx:2645`, looping `Choice / Gate / FanOut / Join / CompositeRef`
  and requiring each to be absent) — which is task 9.3.
- `it(` count in the page test went **67 → 72**. Nothing was deleted wholesale; five tests were
  added, including the four per-withdrawal parity tests (9.2) and the all-eight-kinds
  load/render/select/edit/save round-trip (9.5).
- Every rewritten site drives the replacement affordance rather than dropping the claim. The one
  genuine weakening is t1 (ordered array → Set), already covered by a stronger neighbour.
- **The `:1098` fixture fix, scrutinized specifically:** `CANVAS_V2_GESTURE_AUTHORED_DEFINITION`
  is a pure append to `test/fixtures/canvas-v2-authoring.ts` (`@@ -193,3 +193,139 @@`, `+` lines
  only); `CANVAS_V2_AUTHORING_DEFINITION` is byte-untouched and its other consumers, including the
  root-level kernel-proof test, are unaffected. The fix is additive and correctly reasoned.
  *Caveat worth the LEAD's attention:* the new fixture carries implementation-specific defaults
  (`hierarchicalPath`, `condition: 'always'`, the full `createDefaultBoundedLoopLifecycle` block)
  that no one writes from scratch — it was almost certainly derived from a run, so the deep-equal
  at `:1183` is partly self-fulfilling in the classic local trap shape. **What saves it:** the four
  parity tests (`:1226-1355`) assert explicit inline literals — `['approved','rejected']`, the
  dispositions map, `branches` / `members` / `inputs` / `requiredMembers` / `joinNodeId`,
  `['matched','skipped']`, `expression`, and the `legacyRuntimeOwner` absence — with no fixture in
  the loop. The load-bearing parity claims have independent oracles; only node *ordering* and the
  lifecycle defaults rest on the fixture alone.

### 7. Guard quality — PASS with one real hole (m1)

Mutation-reasoned each new guard rather than reading it as prose:

- **`canvas-authoring-column-lock.test.ts`** — fails correctly if the rule is deleted, if
  `flex-shrink: 0` is dropped, if `overflow-y: auto` is dropped, or if either card's
  `flex-direction: column` goes. **Does not fail** if `width` becomes `min-width` / `max-width`
  (m1, verified by executing the regex). The `blockForSelectorAmong` helper is sound — its
  `\s*[,{]` terminator correctly refuses to match `__field` / `__list` descendants, and it picks
  the right multi-selector block.
- **`V2_ROOT_PALETTE_KINDS` absence** — reads the module namespace dynamically
  (`(draftModule as Record<string, unknown>).V2_ROOT_PALETTE_KINDS`), which is the right shape:
  a TS-only check would not catch a re-added export that nothing imports.
- **`legacyRuntimeOwner` absence** — `not.toHaveProperty` at both layers, and one of them runs on
  the definition actually POSTed. Would fail if the field returned.
- **The all-eight-kinds round-trip test** — deep-compares node-by-node against `v2Definition` with
  one deliberate edit, so it fails on any silent shape drift rather than only on a rendered string.
- **The gap:** M3's disabled-skill path is unreachable from every fixture in the file, so those
  assertions do not exist at all rather than being weak.

---

## Independently verified (so the LEAD knows what was actually covered)

| Check | Result |
|---|---|
| UI suite through `packages/ui`'s own vitest config | **67 files / 735 tests passed**, 68.4s — matches the LEAD's count exactly |
| `pnpm exec tsc --noEmit` in `packages/ui` | Only the three baseline errors (`ConsultationBindingEditor.tsx`, `IssuesDrawer.tsx`, `v2-node-panel-consultation.test.tsx`). **No new typecheck error from this branch** |
| `rasen validate canvas-authoring-surface --strict` | `Change 'canvas-authoring-surface' is valid` — task 10.6 confirmed |
| `git diff dev/0.2.0 -- src/core/pipeline-registry/` | Empty (claim 2) |
| The LEAD's Save-does-not-persist disposition | **Confirmed, and it holds.** The `PipelineCanvasPage.tsx` diff contains **zero** added or removed lines matching `save\|persist\|client.\|mutatePipeline\|export` (case-insensitive). The persistence defect the browser evidence hit is pre-existing and untouched by this branch. My reading does not contradict the LEAD's |
| Real-browser evidence sufficiency | **Sufficient.** It measures the three things D8 demands (`scrollHeight 805 === innerHeight 805`; computed `width=280px` / `overflow-y=auto` / `flex-shrink=0`; flow column 856px > 280px) as *computed* values on a live page, which is exactly the layer the CSS pin cannot reach. It also names its own gap honestly rather than papering over it, and its worktree module-resolution finding is a real trap worth keeping |
| `exactCapabilities()` parity with the removed hardcoded rule | `PipelineCanvasPage.tsx:920-924` filters `skill.enabled && skill.capability` — identical predicate to the removed `PalettePanel.tsx:48-51`. No behavior drift in the `stage` availability rule |
| `onEdgeClick` wiring | Real `@xyflow/react` prop, threaded through `CanvasFlow` (`PipelineCanvasPage.tsx:2170-2221`), guarded against non-v2 drafts and unknown edge ids (`:748-754`), and both selections cleared on `onPaneClick`. Selection is genuinely mutually exclusive, and a removed connection clears the panel (`:698-728`) |
| `expression` survives the patch path | `updateV2NodeFields` (`draft.ts:350-364`) is a plain spread with **no field allowlist**, so D5's "edit the expression afterwards" path works. Verified rather than assumed |
| Declaration insert reachability | `DeclarationsPanel` renders unconditionally in v2 edit mode (`PipelineCanvasPage.tsx:2002-2028`); `onInsertRef` is always wired |
| `V2NodePanel` gate checkbox scoping | Only rendered for root nodes; declaration-body stages use `V2ExecutionEditor` instead, so `setStageGate`'s "not a root AtomicStage" refusal is not reachable by accident |

## Checked and found fine

- Every removed `addV2RootNode` branch has an equivalent in `draft.ts`; the node construction
  moved wholesale rather than being retyped (compared the removed and added literals field by field).
- Id-allocation consistency: `addStageGesture` / `addRootGesture` / `insertDeclarationRef` each
  precompute `v2NodeIdFor(kind, draft)` for the post-insert selection while the helper recomputes
  it internally from the same `def` — deterministic, so the selection always lands on the node
  that was actually created.
- Every helper refusal is surfaced through `showToast`; no panel re-decides a model rule
  (task 7.6 holds).
- `V2ConnectionPanel` resets its draft on `connection.id` change and holds no rule of its own.
- CSS: the new rules match the `.palette-panel` / `.stage-panel` house convention, and D1's
  "single scroll on the column, none on the panels" is honored — neither card sets `overflow-y`.
- `.rasen/changes/canvas-authoring-surface/` contains only `ephemera/auto-run.json` (run state),
  not a duplicate change.

## Durable findings

1. **A `toMatch(/width:\s*280px/)` CSS pin cannot distinguish `width` from `min-width` / `max-width`
   — the substring matches.** Every CSS contract pin in this repo that guards a *constraining*
   property must anchor the property name (`/(^|[;{]\s*)width:/`), or it green-lights the exact
   "rule exists but does not constrain" regression the pins were written to catch.
2. **A `find`-based restore paired with a `remove-all-incident-edges` delete silently drops
   duplicates.** `unspliceChoice` guards the port it does not expect and ignores arity on the ports
   it does; anywhere this codebase restores "the" inbound/outbound edge, check whether the graph
   model permits two.
3. **Coverage can be absent rather than weak.** `v2CatalogFixture` has no disabled skill, so an
   entire `SHALL` branch has zero assertions while the suite reads fully green — the mirror image
   of the known fixture-coincides-with-the-defect trap: here the fixture never reaches the branch
   at all.

---

# Round-1 re-review (same reviewer, non-author)

Re-reviewed the fix delta only, against the eleven findings above. The original findings are left
intact; this section is the disposition. Read-only on source; no edits, no commits, no subagents.

**Verdict: all eleven resolved. Nothing above Minor remains. The loop can close.**

| id | prior severity | disposition |
|---|---|---|
| M1 | Major | **confirmed-resolved** — proven behaviorally, not read |
| M2 | Major | **confirmed-resolved** — prose now true; code verified untouched |
| M3 | Major | **confirmed-resolved** |
| m1 | Minor | **confirmed-resolved** — 9/9 mutations kill the pin |
| m2 | Minor | **confirmed-resolved** |
| m3 | Minor | **confirmed-resolved** |
| m4 | Minor | **confirmed-resolved** |
| m5 | Minor | **confirmed-resolved** |
| m6 | Minor | unchanged — process item for ship, not a code fix |
| t1 | Trivial | **confirmed-resolved** |
| t2a / t2b | Trivial | **confirmed-resolved** / **accepted, argument verified true** |

Three Trivial residuals are recorded at the end. None is fix-introduced; two are mine from round 0.

## Spot-checks executed (not taken on trust)

### Spot-check 1 — m1's CSS pin, nine real mutations

Replicated `blockForSelectorAmong()` and `declares()` **verbatim** from
`canvas-authoring-column-lock.test.ts` in an out-of-tree probe and ran them against mutated copies
of `style.css` held in memory. The repo was never modified.

```
PIN GREEN  BASELINE (unmutated)
PIN RED    MUT-1 width -> min-width                    {"width":false, ...}
PIN RED    MUT-2 width -> max-width                    {"width":false, ...}
PIN RED    MUT-3 flex-shrink 0 -> 0.5                  {"flexShrink":false, ...}
PIN RED    MUT-4 overflow-y auto -> visible            {"overflowY":false, ...}
PIN RED    MUT-5 width 280px -> 800px                  {"width":false, ...}
PIN RED    MUT-7 delete the authoring-column rule      {width,flexShrink,overflowY all false}
PIN RED    MUT-6a card flex-direction -> column-reverse
PIN RED    MUT-6b card flex-direction removed entirely
PIN RED    MUT-6c delete the whole card rule
```

Baseline green, all nine mutations red. The exact hole reported at m1 (`min-width` / `max-width`
satisfying a bare substring pin) is closed, and the `flex-shrink: 0.5` and `column-reverse`
near-misses the fixer additionally identified are closed too.

**A false-negative caught in my own probe, worth recording.** My first MUT-6 attempt returned
PIN GREEN and looked like a surviving hole. It was not: `String.replace` with a string literal
replaces only the first match, and the line
`display: flex; flex-direction: column; gap: var(--space-2);` occurs **19 times** in `style.css`
(first at `:459`, `.board-column__cards`). The probe had mutated an unrelated rule 1200 lines
above the target. Re-run against the real card rule via an anchored regex, all three card
mutations correctly went red. A mutation proof whose mutation lands somewhere else reports a
false green — worth knowing for anyone auditing the fixer's own mutation list the same way.

### Spot-check 2 — M1's guards, direct behavioral probe

Bundled `packages/ui/src/canvas/draft.ts` out-of-tree with esbuild and called the real
`unspliceChoice` with crafted graphs. Repo untouched.

```
spliced connections: ["work:done->choice:input","choice:matched->review:input"]

NO-THROW  CASE-1 one inbound + one matched out (ordinary)
          restored connections: ["work:done->review:input"]
THROWS    CASE-2 skipped branch wired      :: branch 'skipped' is still wired to 'finish'.
THROWS    CASE-3 two inbound               :: 'choice' has 2 incoming connections ('work', 'other');
                                              only one can be restored, so disconnect the others first.
THROWS    CASE-4 two matched outbound      :: branch 'matched' is wired to 2 targets ('review', 'finish');
                                              only one can be restored, so disconnect the others first.
```

Both new guards fire on the exact graphs reported at M1, each message naming the edge that would
otherwise vanish. CASE-1 proves the guards are not over-broad — the ordinary unsplice still
restores `work:done->review:input`. Both guards run **before** `removeV2Node`
(`draft.ts:1464`, `:1471` vs `:1479`), so a refusal leaves the draft unchanged, satisfying the
delta's "with an explanation and no change".

The model tests backing this are guards by construction, not by fixture: `toThrow(/2 incoming
connections/)` and `toThrow(/branch 'matched' is wired to 2 targets/)` cannot pass if the guard is
removed — the function would return a definition instead of throwing — and each carries a negative
control (`expect(() => unspliceChoice(spliced, choiceId)).not.toThrow()`) that rules out an
over-broad guard.

## Per-finding disposition

**M1 — confirmed-resolved.** `draft.ts:1456-1477`. `find` replaced by `filter` on both sides
(`inboundAll`, `matchedAll`); guards at `:1464` and `:1471` refuse with counts and named
offenders. Proven behaviorally above.

**M2 — confirmed-resolved, prose only; code verified untouched.** Per your ruling I did not
re-open the code question, but I did verify the code really is unchanged, because "prose only" is
itself a claim: `commitExpression` still resets on blank (`V2NodePanel.tsx:168-176`) and
`spliceConditionOntoConnection` still throws `'A branch condition cannot be blank.'`
(`draft.ts:1383`). So the narrowing the new prose describes is exactly the narrowing that exists.

The three false statements are now true:

- `specs/pipelines-ui/spec.md:118-120` — "every graph **shape**" became "every node **kind** …
  and the approval gate, the parallel fan-out and barrier, and the composite reference SHALL be
  created in the same shape". Same-shape is now claimed only for the three where I verified it holds.
- `:122-130` — a new paragraph names branch points as the one deliberate narrowing and states the
  restriction *positively and testably*: a newly authored branch point always carries a non-blank
  condition, and the editor SHALL NOT offer a way to create one without a condition or to clear the
  condition while keeping the node. Both halves match the code exactly. The carve-out is honest
  about what survives (outcome labels stay editable; pre-existing shapes still round-trip).
- `proposal.md:59-61` and the new `:75-85` paragraph say the same thing, and `:76-78` spells out
  the unproducible literal `{ kind: 'Choice', outcomes: ['default'] }` with no `expression`.

The scenario at `:134-140` was amended in step, and a new scenario "A branch point authored before
the narrowing still loads and edits" (`:142-147`) was added — backed by a real new test
(`pipeline-canvas-page.test.tsx:1493`) that loads the pre-change Choice shape and asserts the
editor neither refuses it nor rewrites it. That is the right way to close a narrowing: bound it
with a test that the *old* shape survives.

**The widened M1 SHALL is honest and relaxes nothing.** Old: refused only "when another branch of
that branch point is wired". New (`spec.md:52-56`): refused "whenever the branch point carries
more wiring than the single restored connection can hold — another outcome of that branch point
being wired, more than one connection leading into it, or its matched outcome leading to more than
one destination". The original case is retained verbatim as the first of three; the two additions
are exactly the two guards; "no authored **branch**" widened to "no authored **connection**". I
checked the surrounding requirement and the ADDED requirement at `:1-38` for a compensating
weakening elsewhere and found none — in particular the "state named" clause at `:10-11` was left
standing and the *code* was changed to satisfy it, which is the correct direction. One wording
overshoot in the purpose clause is recorded as R1 below.

**M3 — confirmed-resolved.** `PalettePanel.tsx:112-121` now renders a visible
`palette-card__state` span, mirroring v1's. The fixture gap is closed by
`v2CatalogWithUnplaceableSkills` (`pipeline-canvas-page.test.tsx:299-320`) carrying **both**
unplaceable shapes the requirement names — `enabled: false` with a capability, and `enabled: true`
with none. The test at `:1442` asserts, per skill, the `--disabled` class, the `disabled`
attribute, a non-null state span, and its exact text, plus a positive control on the bindable
skill and a "cannot be placed" probe comparing graph text before/after clicking. Guard by
construction: removing the span fails `expect(named).not.toBeNull()`.

*On the deliberate deviation from D3's "mirror v1":* distinguishing `disabled` from
`no exact capability` is **better than v1, and better justified**, because the requirement itself
names two reasons a skill is unplaceable and v1 only ever had one. Naming both is closer to the
spec than mirroring v1 would have been. I would not ask for this to be reverted.

*On reusing v1's `palette-card-disabled-state` testid:* **acceptable.** The two branches are
mutually exclusive on `definitionVersion` (`PalettePanel.tsx:86` and `:145`), the v2 span adds
`data-skill` that v1 lacks, and the M3 test scopes every lookup to the card element
(`card.querySelector(...)`) rather than the container, so it cannot pick up a v1 span even
hypothetically. You are right that the invariant is structural rather than enforced — a future
third branch, or any render that shows both versions at once, would collide. The cost of that
happening is a confusing test failure, not a silent pass, so it does not need pre-emptive work.

**m1 — confirmed-resolved**, and over-delivered. `declares(property, value)`
(`canvas-authoring-column-lock.test.ts:48-54`) anchors both ends: `(^|[;{])` before the property
so it cannot be the tail of a longer property, and `\s*(;|$)` after the value so it cannot be the
head of a longer value. The third test (`:73-91`) is a genuine meta-guard — it asserts the
near-misses against `declares()` directly, independent of `style.css`, so reverting the helper to
a substring match fails there rather than silently re-opening every pin above. That is a better
answer than the anchored regex I recommended.

**m2 — confirmed-resolved.** `isBindableSkill` (`draft.ts:736-738`) is the single owner; both
former encodings now call it — `PalettePanel.tsx:84` and `PipelineCanvasPage.tsx:923`
(`.filter(isBindableSkill)`). Confirmed by grep that there is no third reading left.

**m3 — confirmed-resolved.** New page test at `pipeline-canvas-page.test.tsx:1384` walks the full
wiring: splice via the Connection panel, select the Choice, read the expression back
(`expect(expression.value).toBe('ready')`), edit it through the node panel, assert the edit reaches
the POSTed definition, then press "Remove condition" and assert both that the Choice is gone and
that `connections` is exactly `[originalConnectionId]`. That last assertion is the strong one —
it fails on a restore that produces a different or extra edge, not just on a missing node.

**m4 — confirmed-resolved.** `v2-authoring-model.test.ts:887-921` covers the read-only-endpoint
refusal with a negative control on the *same draft* (an editable-endpoint connection still splices),
so the refusal is attributable to the preserved endpoint rather than to the extra node's presence.
That control is what makes it a real guard.

**m5 — confirmed-resolved.** `V2NodePanel.tsx:295-327`: the button is now a sibling of the
`<label>` inside a fragment, with a comment recording why. Invalid nesting and the
label-forwarding side effect are both gone.

**m6 — unchanged, and correctly so.** Task 10.3's root-suite and `pnpm build` halves remain unrun
(I re-verified its third half: `git diff dev/0.2.0 --stat -- src/core/pipeline-registry/` is still
empty). The six untracked `.rasen-e2e-*` / `.rasen-pipeline-command-*` temp dirs are still present.
Both are ship-time process items, not fixer work.

**t1 — confirmed-resolved.** `pipeline-canvas-page.test.tsx:1216-1228` restores the ordered array
(`AtomicStage, CompositeRef, BoundedLoop, FanOut, Join, Finish, Gate, Choice`) with a comment
naming why a Set would pass on a reordering. Your soft spot #3 is accurate: this array is a
hand-derived projection of the same fixture the deep-equal at `:1211` already pins, so it adds no
*independent* signal. That is fine — t1 was a report of a **weakening**, and the weakening is
undone; the assertion is now at least as strong as it was before this change. Independent oracles
for the load-bearing parity claims live in the four parity tests, as recorded in round 0.

**t2a — confirmed-resolved.** `pipeline-canvas-page.test.tsx:1281-1285` now states the true fact
(the old raw-palette Gate called `addV2Node` and nothing else, so this is parity, not a difference).

**t2b — accepted; the argument is verified true, not merely plausible.** Grepped `style.css`:
**neither** `.declarations-panel__insert-ref` **nor** `.declarations-panel__delete` has any rule.
Both row actions are bare buttons on the global `button` styling. Styling the new one alone would
create the visual inconsistency inside a single row, and the live browser session already measured
this row at 280px without a layout problem. No change needed.

## Residuals (all Trivial, none fix-introduced)

**R1 — the widened SHALL's purpose clause is broader than its own enumeration.** Proven in the
same probe as spot-check 2:

```
NO-THROW  CASE-5 ZERO inbound + one matched out    before ["choice:matched->review:input"] -> after []
NO-THROW  CASE-6 one inbound + ZERO matched out    before ["work:done->choice:input"]      -> after []
```

A half-wired Choice loses its surviving edge with no refusal. Read literally, that contradicts
"so no authored connection is silently discarded" (`spec.md:56`). Read correctly, it does not:
the surviving edge's own endpoint is the node being deleted, so there is nothing it could be
restored *to*, and this is the universal behavior of `removeV2Node` for every node kind — under
the strict reading, deleting any node at all would violate the clause. The three enumerated cases
are exact and the implementation meets all three. **Recommend a wording tightening only**, e.g.
"no connection that could have been restored is silently discarded". This case was missed in my
round-0 M1, so it is mine, not the fixer's.

**R2 — no page-level test proves an unsplice refusal reaches a toast.** The fixer flagged this
itself and it is real: `unspliceSelectedChoice` (`PipelineCanvasPage.tsx:874-885`) wraps the call
in try/catch → `showToast`, but no test asserts the toast text for any of the three refusals. The
mechanism is not unproven — that same `showToast` surface is asserted by five other refusal tests
(`pipeline-canvas-page.test.tsx:2379`, `:2440`, `:2630`, `:2737`, `:2756`) — so what is unproven is
only this handler's `catch` arm. It applies equally to the pre-existing `strayOut` refusal, so it
is not a regression. Cheap to close with one assertion on the existing
`[data-testid="pipeline-canvas-toast"]`.

**R3 — `declares()` depends on a trailing semicolon under CRLF.** `style.css` is CRLF in the
working tree (the probe printed `\r\n` in the block body). `declares()` terminates on `(;|$)`, and
JS `$` under `/m` matches before `\n` but not before `\r`. Every declaration in the pinned blocks
currently ends with `;`, so this is latent. If a future edit drops the final semicolon before the
closing brace, the pin fails **red**, not green — the safe direction — so this is a note, not a
defect.

## Re-verified independently this round

| Check | Result |
|---|---|
| UI suite through `packages/ui`'s own config | **67 files / 742 tests passed**, fully green — matches the fixer's count exactly (+7 over my round-0 baseline of 735) |
| `pnpm exec tsc --noEmit` in `packages/ui` | **11 errors, all in the same three baseline files** (`ConsultationBindingEditor.tsx`, `IssuesDrawer.tsx`, `v2-node-panel-consultation.test.tsx`). No new typecheck error from the fix delta |
| `git diff dev/0.2.0 --stat -- src/core/pipeline-registry/` | Still empty. **IR remains frozen** |
| Both untracked files read from disk | `V2ConnectionPanel.tsx` and `canvas-authoring-column-lock.test.ts` — the entire CSS pin rewrite lives in the second and is invisible to `git diff`. Still untracked |
| `PipelineCanvasPage.tsx` fix delta | Exactly two lines (`isBindableSkill` import + `.filter(isBindableSkill)`). Nothing else moved in that file |
| Change-artifact edits confined to prose | `specs/pipelines-ui/spec.md` and `proposal.md` only; the ADDED requirement's "state named" clause left standing rather than weakened |

## On the reported flake

**I buy the fixer's reading**, and the reason is one specific control rather than the argument as a
whole: it reproduced on a **stashed pre-change tree**. A regression introduced by this change
cannot fail on a tree that does not contain the change. Three secondary signals agree — the failure
lands on a *different unrelated* file each time (`i18n/catalog.test.ts`, `config/controls.test.ts`),
neither of which this branch touches; the symptom is "Test timed out in 5000ms" rather than an
assertion failure; and this repo already has Windows timeout flakiness recorded as a known
non-logical-regression class. The load hypothesis is consistent with the run profile — my green run
reported `environment 427.68s` against 50.9s wall clock, i.e. heavy parallelism against a 5s
per-test budget.

Stated plainly: **I did not reproduce the flake.** Both of my full runs were green (735/735 in
round 0, 742/742 now), so my evidence is consistent with the conclusion but does not independently
establish it. If you want it settled rather than reasoned, the decisive step is raising
`testTimeout` and confirming the rate drops — a genuine regression would not care.

---

# Round-2 confirmation (narrow pass: R1 and R2 only)

Scope honored: only the two residuals were re-examined. Nothing confirmed in round 1 was revisited.
Read-only; no edits, no commits, no subagents.

**R1 — confirmed-resolved. R2 — confirmed-resolved. The two residuals are closed.**

**The loop closes on findings.** One gate-evidence discrepancy is open and is the LEAD's call, not
a finding against this change: the reported clean suite does not reproduce here. Detail below.

## R1 — confirmed-resolved; the scoping is honest

`specs/pipelines-ui/spec.md:53-57` now reads "…so **no connection that clearing could have
restored is instead silently discarded**", with "can hold" → "can **represent**" on the preceding
clause.

I re-ran my round-1 probe cases against the new wording. It is literally true on all six:

| Case | Behavior | Under the tightened clause |
|---|---|---|
| 1 in, 1 matched out | restores `work:done->review:input` | nothing discarded — consistent |
| skipped branch wired | refused | enumerated case 1 |
| 2 inbound | refused | enumerated case 2 |
| 2 matched out | refused | enumerated case 3 |
| **0 inbound**, 1 matched out | edge dropped | **outside the clause** — with no inbound source there is nothing the edge *could have been restored* to |
| 1 inbound, **0 matched out** | edge dropped | **outside the clause** — symmetric, no destination |

The scoping narrows the guarantee to exactly the set the mechanism can serve rather than deleting
it, which is the honest repair. "Represent" is also the better verb: a single connection represents
one source→target pair, where "hold" was vague about what was being counted.

**Nothing else in that requirement shifted.** Compared against my round-1 read line by line:
paragraphs 1 and 2 are identical; in paragraph 3 the opening two sentences and all three enumerated
cases are verbatim unchanged. The five scenarios beneath it — including "Clearing a condition will
not discard a wired branch" (`:76-80`), the added "…duplicate connection" (`:82-86`), and "Clearing
an unwired condition restores the direct connection" (`:88-91`) — are unchanged from round 1. No
compensating weakening anywhere in the requirement.

## R2 — confirmed-resolved

New test `pipeline-canvas-page.test.tsx:1447`, "surfaces every unsplice refusal as a toast and
leaves the draft untouched". Run by name: **passes** (1631ms).

It is a real guard, on three counts:

1. **Real author path, not a synthetic model call.** Each case loads a definition already carrying
   the offending wiring and drives select-Choice → "Remove condition", so the exercised path is
   `V2NodePanel → onUnspliceChoice → unspliceSelectedChoice`'s catch arm — precisely the arm the
   model tests cannot see.
2. **Discriminating toast assertions.** `'2 incoming connections'`, `"branch 'matched' is wired to
   2 targets"`, `"branch 'careful' is still wired to 'finish'"` — specific enough that a stale or
   generic toast could not satisfy them. Each case remounts fresh (`render(null, container)` at the
   end of the helper), so no toast carries between cases.
3. **Draft-unchanged half is non-vacuous.** `expectedRoot` is a `structuredClone` taken *before*
   mount; `submittedRoot` comes from the definition actually POSTed to `validatePipeline` after the
   refusal. A refusal that mutated the draft fails the deep-equal. The helper additionally asserts
   the Choice still renders before submitting.

Coverage includes the pre-existing `strayOut` refusal, which I noted had the identical gap. Good —
that one was not this change's to fix, and closing it anyway is the right instinct.

*On the three-remounts-in-one-`it()` structure:* I agree with your ruling and would not spend a
round on it. The cost is a less granular failure report on a first-case failure; the coverage is
identical either way, and all three cases assert independently once reached.

## Spot-check: mutation anchor 2, executed

Picked `draft.ts:1464` (`if (inboundAll.length > 1)` → `if (false)`). Verified the landing site
first — the exact thing my round-0 durable finding was about — then ran it, all out-of-tree
(esbuild bundle of the real `draft.ts`, mutation applied to the bundle; repo never modified):

```
anchor occurrences in bundle: 1
landing line in bundle: 969
   966:       `Cannot remove this condition: branch '${strayOut[0].from.port}' is still wired ...
   968:   }
   969:   if (inboundAll.length > 1) {
   970:     throw new Error(
   971:       `... has ${inboundAll.length} incoming connections ...`

--- ORIGINAL bundle ---
  orig / two-inbound:     THROWS   Cannot remove this condition: 'choice' has 2 incoming connections...
  orig / two-matched-out: THROWS   Cannot remove this condition: branch 'matched' is wired to 2 targets...
--- MUTATED bundle (anchor 2 -> if (false)) ---
  mut  / two-inbound:     NO-THROW (connections 3 -> 1, 2 lost)
  mut  / two-matched-out: THROWS   Cannot remove this condition: branch 'matched' is wired to 2 targets...
```

Three things confirmed: the anchor is unique, it lands on the two-inbound guard (correct
neighbours above and below), and neutering it **reproduces the original M1 defect exactly** —
two connections silently lost. The mutation is also surgical: the sibling matched-out guard still
fires, so it disables only what it targets. Any test asserting the two-inbound refusal must fail
when that guard is removed. Anchor-2 claim verified.

Anchor 1 landing site verified by inspection but not executed: `showToast(… 'Could not remove this
condition.')` occurs **exactly once** in `PipelineCanvasPage.tsx`, at `:883`, inside
`unspliceSelectedChoice`'s catch (`:874-885`). Mutating it to `void error;` kills the toast half of
all three R2 cases and touches nothing else.

## Gate evidence: the clean suite does not reproduce here

Reported: 67 files / 743 tests, clean. **I could not reproduce that.** Enumerated in full rather
than extrapolated:

| Run | Result | Failures |
|---|---|---|
| Full suite, run A | 742 passed / **1 failed** (743) | not captured |
| Full suite, run B | 741 passed / **2 failed** (743) | `test/i18n/catalog.test.ts` (timed out, 5087ms/5000ms); `test/canvas/build-split.test.ts` (timed out, 84994ms/60000ms) |

Neither file is touched by this branch. Both are timeouts, never assertion failures. I then
isolated them, and **caught a methodology error in my own first attempt**: running the two files
together is not isolation — vitest runs files in parallel, and `build-split` runs a real bundle, so
it was competing with the very test I was trying to measure. Re-run properly:

- **`build-split.test.ts` alone: PASSES.** Its 85s in the full run was parallel contention. This
  is the one I was most concerned about, since this change adds `V2ConnectionPanel.tsx` to the
  canvas chunk graph; it is clear.
- **`catalog.test.ts` alone: still FAILS**, `tests 5.05s` against a hard 5000ms budget — a 1%
  overshoot with nothing else running.
- **Same test, `--testTimeout=30000`: 12/12 PASS.** So it is purely a budget miss, not an
  assertion failure — no missing i18n key, no content regression.

**Characterization, which is firmer than "load flake":** this test's real cost on this machine is
5.0–7.7s against a 5000ms budget. It is not occasionally unlucky, it is permanently at the cliff
edge, and a few tens of milliseconds of ambient noise decide it. That explains every observation at
once — the ~1-in-6 rate, the reproduction on a pre-change tree, the green round-1 run, and the
failure under true isolation.

**Not caused by the fix delta, and provably so:** the test scans `packages/ui/src`. Between my
round-1 all-green run and now, the only tree changes are R1 (a markdown file) and R2 (a file under
`test/`). Neither is under `src`, so the scanned input is byte-identical to a run where this test
passed. **One honest nuance:** the branch as a whole did add a source file and ~600 `src` lines, so
while it did not create the problem it plausibly moved an already-marginal test nearer the edge.
The fix is to raise that test's budget — one line, and outside this change's scope.

## Also re-confirmed this round

| Check | Result |
|---|---|
| IR frozen | `git diff dev/0.2.0 --stat -- src/core/pipeline-registry/` still empty |
| `git diff --check dev/0.2.0` | clean — no whitespace errors |
| `rasen validate canvas-authoring-surface --strict` | `Change 'canvas-authoring-surface' is valid` |
| Test count | 743 total, matching the reported figure (+1 for the new R2 test) |

Typecheck was not re-run this round: the fix delta is one markdown file and one test file, and both
were exercised by the runs above.
