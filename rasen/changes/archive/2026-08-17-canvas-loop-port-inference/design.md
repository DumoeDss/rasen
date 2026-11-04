# Design: canvas-loop-port-inference

## Context

Round-one loop synthesis (`canvas-backedge-loop-inference`, shipped as PR #167) turns a
refused cycle-closing draw into a `BoundedLoop` over the region the edge closes. The
body declaration's contract comes from `deriveSubgraphContract` (`draft.ts:2819`), which
enumerates the cut via `computeSubgraphCut` (`:2773`) and derives rows ONLY from
connections the extraction severs: one input per distinct severed-incoming
`(target, port)`, one outcome per distinct severed-outgoing `(source, port)`. A
standalone cycle (nothing external wired in or out) severs nothing: `inputs: []`, and
`outcomes` falls to the generic `['done']` default (`:2839`). The loop node's handles
render straight from that declaration (`lookupDeclarationPorts`, `layout.ts:86`, both
`CompositeRef` and `BoundedLoop` branches) — so the loop appears with zero input
handles: an island nothing can connect into. The author's only recourse is to have
wired externals FIRST (the round-one acceptance path), an ordering the IR never
required: `normalizeV1()` itself mints loop bodies with contract rows no edge severed
(`definition.ts:3603-3637`, `outcomes: ['done']` unconditional, `inputs: []`).

Structure already guarantees what the fallback names should be. The draft graph is
acyclic (the back-edge was refused precisely because it would close a cycle), and
`backedgeRegion` (`draft.ts:340`) returns `{to, from}` plus every node on a path
between them. In the body graph after extraction (the drawn back-edge never entered
the draft; internal edges are the region's forward edges):

- No internal edge can enter `to`: an edge `m → to` with `m` in the region would give
  `to ⇝* m ⇝* to` in the pre-existing draft — a cycle that cannot exist.
- Every other member is reachable from `to` through region members only (intermediate
  nodes of any `to ⇝* n` path satisfy the region predicate).

So `to` is the body's UNIQUE ROOT — where control re-enters the body each iteration —
and by the mirrored argument `from` is the body's UNIQUE SINK, the tail the body runs
to before the exit decision. The back-edge's two endpoints ARE the loop's entry and
exit; the fix is to let the derivation say so.

Constraints carried from the portfolio brief: IR frozen (assert empty diff vs
`f512e3ea`), all rules in `draft.ts` (one home), `V2_BODY_PALETTE_KINDS` unchanged, no
`legacyRuntimeOwner`, `layout.ts` needs nothing, UI baseline 68 files / 894.

## Goals / Non-Goals

**Goals:**

- A standalone-cycle loop renders an input handle and a self-describing exit outcome
  handle; external stages connect after the fact; authoring order stops mattering.
- Severed connections keep today's derivation byte-for-byte, per side (externals-first
  results identical; mixed regions take each side's own rule).
- One derivation site in the model, called by both the review-open path and the
  confirm-time transaction (no second derivation to drift).
- The derived names follow the existing boundary convention and remain editable
  (review defaults; declaration editor afterwards).

**Non-Goals:**

- The package-into-block (box-selection `extractSubgraph`) path: unchanged. It has no
  back-edge, so a self-contained selection keeps today's behavior (empty inputs,
  `'done'` outcome default). There is no structural entry to derive there.
- Loop-body visibility inside the node: child 2 (`canvas-loop-body-visibility`).
- The explicit palette Loop gesture (`addBoundedLoopOverDeclaration`): untouched.
- Any engine change, wire-shape change, or position/layout change.
- Auto-refresh of validation after edits (Validate stays the authority, round-2 rule).

## Decisions

### D1 — New composed derivation; `deriveSubgraphContract` untouched

New exported model function in `draft.ts`, beside the family it belongs to:

```
deriveBackedgeLoopContract(def, region, from, to): DerivedSubgraphContract
```

Body: `const base = deriveSubgraphContract(def, region)`; if `base.inputs` is empty,
that side becomes `[{ name: to, type: CONTROL_TARGET_PORT }]`; if `base.outcomes` is
empty, that side becomes `[from]`; otherwise each side passes through verbatim.
Deterministic, pure, and trivially byte-preserving whenever a side has severed rows.

Call sites (exactly two): `openLoopReview` (`PipelineCanvasPage.tsx:1406`) for the
review's opening defaults, and `synthesizeBoundedLoopFromBackedge`'s internal
re-derivation (`draft.ts:3110`), which supplies `rewireCrossingsOnto`'s fallback names.
The model re-owns the rule at confirm, exactly as it does today for the region and
refusals.

Alternatives rejected:

- **Optional back-edge parameters on `deriveSubgraphContract`** — the extract path
  must stay byte-identical and a mode-flagged shared function is exactly how the
  "four independent encodings" drift this portfolio already paid for begins. The
  extract path keeps calling the untouched original; the loop path gets its own name.
- **Pseudo-keys inside `computeSubgraphCut`** — rejected decisively: that enumeration
  feeds `rewireCrossingsOnto`'s POSITIONAL mapping (real crossing edges index into the
  severed key lists). Injecting pseudo-keys there would shift real indices and miswire
  mixed regions. Composing ABOVE the cut keeps rewire semantics untouched; because a
  fallback row exists only when that side's real key list is empty, a positional
  collision is impossible by construction.

### D2 — Naming: the boundary convention, extended to the back-edge

- Entry input port: named for the back-edge's target (`to`), typed `CONTROL_TARGET_PORT`
  — exactly what a severed incoming edge onto `to` would derive (`deriveSubgraphContract`
  names inputs after the severed edge's target stage).
- Exit outcome: named for the back-edge's source (`from`) — exactly what a severed
  outgoing edge from `from` would derive (outcomes are named after the source stage).

This is not convention-matching for its own sake: the names describe real control flow
(`to` is the body's unique root, `from` its unique sink — see Context). The author sees
`review` on the input handle and knows control enters at review; sees `fix` on the exit
outcome and knows the body runs to fix before the exit decision. On the outcome side
this REPLACES the generic `'done'` default for the loop path's empty side only.

Alternatives rejected:

- **Keep `'done'`** — it renders a handle today, but says nothing about the body,
  collides with definition-outcome vocabulary, and leaves the two sides asymmetric
  (generic exit, structural entry). The portfolio brief names the tail as the source
  of the exit outcome.
- **Reserved words (`entry` / `exit`)** — a second naming convention beside the
  severed one the same dialog already shows; worse, a reserved word can collide with a
  stage id. The boundary convention cannot collide: it reuses the stage's own id, and
  a lone row needs no suffix.

The names are defaults, not sentences: the review opens them in the same editable
`PortListEditor`/`NameListField` rows, and afterwards `updateDeclaration`
(`draft.ts:2239`) edits declaration rows and reconciles every referencing loop's exit
map (`:2259-2277`) — verified present, so "rename later" is a real affordance, not a
promise.

Self-loop region (`from === to`): both rows name the same stage — separate namespaces
(input ports vs outcomes), no collision; the body is one node with no internal edges,
still root and sink of itself.

### D3 — No rewire, panel, or layout change

- `rewireCrossingsOnto` (`draft.ts:2973`): untouched. It maps REAL crossing edges
  positionally; a standalone cycle has no crossings, and mixed regions have real edges
  only on the severed side, where the fallback does not fire.
- `V2LoopReviewPanel.tsx`: untouched — its `derived` prop shape is unchanged; the
  fallback rows arrive as ordinary derived defaults.
- `layout.ts`: untouched — the handles render from the declaration contract the moment
  the rows exist; no rendering branch learns about the fallback.
- The `loopReview` state's `derived` type annotation (`PipelineCanvasPage.tsx:317`)
  follows the new function's return type (same shape, honest provenance).

### D4 — Regression and mixed-case pins

- Existing round-one loop tests (externals-first) stay green UNCHANGED — they pin the
  severed path's outputs, including rewired connections and port names.
- New unit pin: for a region with any severed side,
  `deriveBackedgeLoopContract(...)` deep-equals `deriveSubgraphContract(...)`.
- Mixed cases unit-tested both ways (incoming severed / outgoing not; outgoing
  severed / incoming not), plus the standalone two-stage cycle and the single-node
  self-loop.

## Risks / Trade-offs

- [The validator flags an unconnected loop entry in the intermediate state (handle
  exists, nothing wired yet)] → This is the same class as any unwired node today. The
  browser gate recorded the intermediate state's Validate output in evidence as a
  FACT; no engine change, no UI special-casing (Validate stays the authority).
  CORRECTION (fix round 1, from the browser gate): the original claim that the END
  state validates green was an unverified planning assumption. The unedited
  synthesized defaults carry three PRE-EXISTING error classes shared with the
  round-one severed path (stage-id outcome names are never producible terminal
  outcomes, derived input rows carry the port NAME as type instead of the engine's
  `ecp/control`, and the default lifecycle exits to `iteration-limit` which the
  definition must declare). Zero errors IS reachable through existing authored
  affordances (producible outcome names + control-typed entry row + declaring the
  lifecycle exit outcome; driven end-to-end in the browser), and the spec scenario
  was amended to say exactly that. The deeper fix to the synthesis defaults is
  deliberately deferred to the sibling change `canvas-loop-validate-clean-synthesis`.
- [A port named after a stage reads as a node reference to the author] → It is the
  same convention severed ports already use in this exact dialog since round one; the
  name is editable in the review and renameable afterwards with exit-map
  reconciliation.
- [Two sources of derived rows (severed vs back-edge) drift apart someday] → One
  composed function with per-side precedence, one shared base (`deriveSubgraphContract`),
  and the D4 deep-equal pin; the extract path calling the base directly cannot see the
  fallback at all.

## Migration Plan

Single UI-layer change; no data migration. Definitions saved before this change keep
their contracts verbatim (the fallback only affects NEW loop synthesis derivations).
Rollback = revert the commit; no persisted state references the new rows.

## Open Questions

None material. The naming (D2) and per-side precedence (D1) decisions are made above;
child 2 consumes them via the planning-context digest (body rendering reads the same
declaration contract — entry/exit rows are already what its in-frame body view will
show flowing in and out).
