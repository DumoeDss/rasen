# Review report — canvas-loop-validate-clean-synthesis (stage: verify)

Reviewer: reviewer3 (independent non-author; dispatched, report-only).
Target: uncommitted delta vs `d0c761a6` under `packages/ui/` + the new untracked
`test/core/pipeline-registry/canvas-loop-synthesis-engine-clean.test.ts`.
Method: full read of change artifacts + planner digest, full-diff review,
independent read of every mirrored ENGINE function (the IR is frozen but
reading it is the only way to judge a mirror), independent re-run of all
three gates.

Scope check: CLEAN. Diff surface = exactly the 6 declared files (5 packages/ui
+ the new core TEST file; the frozen set is `src/core/pipeline-registry/`
only). NO `src/` outside packages/ui is touched at all — narrower than the
LEAD's worst case (the "shared mint layer" lives in `draft.ts`; the
`declareDefinitionOutcome` reuse needed no management-api reach). `bin/rasen.js`
is the known CRLF phantom (constraint-sweep already excludes it from the
pathspec). Tasks 20/20 complete.

## Verdict

**0 Blocker / 0 Major / 2 Minor / 1 Trivial.** Ship-able.

Independent gates (all re-run by this reviewer, 2026-08-17):
- UI suite `pnpm --dir packages/ui exec vitest run` → **68 files / 912
  passed, exit 0** (baseline 902 + 10 new unit tests; single clean run).
- Core test `pnpm exec vitest run
  test/core/pipeline-registry/canvas-loop-synthesis-engine-clean.test.ts`
  → **5/5, exit 0** (root config).
- `rasen validate canvas-loop-validate-clean-synthesis` → "valid".
- IR frozen BOTH ways: `git status --porcelain -- src/core/pipeline-registry/`
  empty AND `git diff d0c761a6 -- src/core/pipeline-registry/` empty.

## Gate-by-gate

### 1. The zero-edit acceptance + falsifiability — PASS (controls honest)

The core test (`test/core/pipeline-registry/canvas-loop-synthesis-engine-clean.test.ts`)
runs the REAL `EcpDefinitionModule.prepare` with the REAL
`createCapabilityCatalogSnapshot` over definitions built entirely through the
UI's own gestures (`addAtomicStageForCapability`, `addV2Connection`,
`declareDefinitionOutcome`, the confirm with opening defaults) — no mocks, no
hand-built wire fragments. Both gestures pinned green: drawn-back-edge wired
between externals (:154-161) and palette gesture over a well-formed body
(:163-211).

The three falsifiability controls (:216-257) each re-inject EXACTLY one
pre-fix defect shape and assert red through the same prepare:
- class-2: `inputs[0].type = 'input'` (the actual port-name-as-type) →
  `/requires 'input' but/`;
- class-1: `outcomes = ['atomic-stage-2']` (the actual severed stage-id name)
  → `/cannot be produced by the graph/`;
- class-3: `outcomes = ['done']` (drops `iteration-limit`) →
  `/terminal outcome 'iteration-limit', but it is not declared/`.

Each mutation touches one class only, so each control catches its fix's
regression independently — a revert of any single fix goes red while the
other two greens still pass. This file also closes child-1's review Minor
(the mock split): the engine verdict is now CI-visible, and the page test
carries an explicit pointer to it (`pipeline-canvas-page.test.tsx`, Validate
comment).

### 2. Producible-outcome derivation vs the engine — PASS (2 Minor notes)

Mirror verified line-by-line against the frozen engine:
- `loopPhaseOutcomeNamesMirror` (draft.ts) ≡ `loopPhaseOutcomeNames`
  (definition.ts:2777-2789) — all six cases identical in names AND order;
  unit test pins every case (`draft.test.ts`, phase table).
- Per-node consumption granularity `cutKey(node, port)` ≡ the engine's
  `${node}\0${name}` keying (definition.ts:2994-2996, :3051).
- Dedup-by-name in body-node order ≡ the engine's name-keyed outcome map
  (definition.ts:2999-3004) — two-sink and duplicate-name cases unit-tested.
- Exact cover two-directional (definition.ts:3100-3123): the producible set
  is the only validating choice, as claimed. Catalog-gap ⇒ review refusal +
  confirm re-check (unit-tested both, incl. null catalog); the engine itself
  would mark the body incomplete (:3033-3043) — the refusal fires EARLIER,
  never at Validate. ✓
- `loopExitOutcomeValues` ≡ `contractForNode`'s BoundedLoop output
  enumeration (definition.ts:2851-2867) — exit-ACTION values only;
  `defaultBoundedLoopExitOutcomeValues()` pinned to exactly
  `['iteration-limit']`.

Gate's edge shapes: two-stages-same-name (tested, dedup); phase projection
(tested, all six); NO-control-outcomes body — NOT tested (Minor 2); the
engine's type-match precondition on consumption is not mirrored (Minor 1,
below).

### 3. `ecp/control` typing — PASS

`CONTROL_PORT_TYPE = 'ecp/control'` (draft.ts) matches the engine constant
verbatim (definition.ts:2749), doc-cited. Severed rows re-typed in place
(names preserved: `base.inputs.map(row => ({...row, type}))`), fallback row
typed at mint — both pinned in unit tests and the page test
(`v2-loop-review-input-type` = `ecp/control`). No name churn beyond the
sanctioned supersessions (severed target ids `b`/`work-b` and fallback
`review` all unchanged in the new pins).

### 4. Supersession discipline — PASS (nothing smuggled)

Every old→new assertion delta maps to exactly a design-D5 item:
- input row TYPES `'input'`/`'control'` → `'ecp/control'` (D5-1) — incl. the
  reviewed-rows rewire test;
- outcome row NAMES `['c']`/`['fix']`/`['work-d']` → producible `['done']`
  (D5-2), exit-map keys following;
- outgoing rewire port `bounded-loop:c->…`/`bounded-loop:work-d->…` →
  `bounded-loop:done->…` (D5-3), incl. the multi-outcome test now pinning
  BOTH crossings onto the exit outcome (row-positional mapping explicitly
  documented as extract-path-only now);
- `def.outcomes` gaining `iteration-limit` (D5-4) — asserted in every
  synthesis pin + both palette cases.

What STAYS identical is pinned positively: severed input row NAMES and
derivation order, incoming positional rewire (`a:done->bounded-loop:b`
unchanged), body content preservation (`toBe(bNode)`, retained execution
notes), the refusals, id minting. The old RELATIONAL deep-equal pin was
replaced by an ABSOLUTE inventory pin that also pins `deriveSubgraphContract`'s
unchanged output inline — strictly stronger (this also addresses the
relative-assertion blindness noted in child-1's review). The author-renamed
test keeps the model honoring authored (possibly red) rows — Validate stays
the authority.

### 5. Extract/CompositeRef path byte-identical — PASS

`deriveSubgraphContract` and `computeSubgraphCut` have zero diff hunks
(hunk-header map checked; the `@@ ... deriveSubgraphContract` header is an
insertion point AFTER the function). `extractSubgraph` untouched.
`rewireCrossingsOnto` changed only by the OPTIONAL `outgoingPortOverride`
param applied as `override ?? rows… ?? derived…` — the extract path passes
nothing, so its positional mapping is byte-identical. The extract describe's
own tests pass unchanged in the suite.

### 6. Independent gates — PASS (counts cited above)

68/912 exit 0; core 5/5 exit 0; both match the implementer's claims.

### 7. Invariants — PASS

IR frozen both ways (cited above). `V2_BODY_PALETTE_KINDS` still
`['AtomicStage']` (draft.ts:829, no hunk touches it). The only
`legacyRuntimeOwner` diff lines are a doc comment and a negative
`not.toHaveProperty` assertion. Selection pairing (`confirmLoopReview`
same-tick override) and the round-2 positions tests are unchanged and green
in the suite.

### 8. Spec deltas + evidence — PASS

- MODIFIED ×2 target requirements currently on the tree
  (`rasen/specs/pipelines-ui/spec.md:730` and `:1053` — our own landed
  text): requirement 1 keeps all 7 landed scenarios and adds exactly the 2
  sanctioned refusals; requirement 2 keeps all 6 child-1 scenarios (renaming
  the editable-defaults one to input-names, honestly, since outcome rows are
  now body-derived) and adds the outcome-mirror scenario; child-1's deferral
  bullet is deleted by the superseding zero-edit claims it deferred to.
- ADDED "Loop synthesis needs no contract repair": 5 scenarios, all pinned
  (2 core engine greens, declare-at-synthesis unit + palette unit +
  engine green, catalog-gap refusal unit + review path, consumed-outcome
  unit).
- Format: zero em-dashes in the delta; SHALL on the first line of all three
  requirements' prose; `rasen validate` green (re-run).
- Evidence: browser-gate.md (ports 9352/9353, zero-edit flow both gestures,
  0-error assertions with the machine-warning caveat, honest one-driver-fix
  note) and constraint-sweep.md both match what the code and my independent
  checks show (including the byte-identity claim, the 13 pre-existing tsc
  errors note, and the phantom exclusion).

## Findings

### Minor 1 — consumption mirror skips the engine's type-match precondition

`bodyTerminalOutcomes` (draft.ts) marks `(from.node, from.port)` consumed for
EVERY internal region connection; the engine
(`resolveGraphTerminalOutcomes`, definition.ts:2985-2997) counts consumption
only when the connection's produced and consumed types both exist and are
EQUAL. Failure scenario: a body containing a type-mismatched internal edge
(an outcome port wired to a wrong/nonexistent input port) over-consumes in
the UI — the derived outcome rows omit a name the engine still counts
producible, and Validate reports "produces terminal outcome … not declared"
after confirm. Reachability today is low: canvas-drawn `outcome→input` edges
always type-match (production descriptors are `inputs: []`, widened to
control inputs), and a mismatched edge is itself already a Validate error on
the same graph — no NEW silent wrongness. Becomes live if typed-input
capabilities ever arrive. Fix belongs with the sibling-family follow-up
(extract path shares the derivation family); recording the divergence is
enough for this change.

### Minor 2 — zero-producible-outcome body is unpinned

A body whose stages yield no unconsumed control outcomes (an all-consumed
chain, or a capability descriptor with `outcomes: []` — schema-legal)
derives `outcomes: []`, minting a declaration with empty outcome rows and a
loop with `exits: {}`. Traced against the engine by this review: exact cover
holds trivially, MISSING_EXIT/UNREACHABLE_EXIT iterate empty sets, only the
lifecycle's `iteration-limit` emits (declared by D3) — the shape should
validate clean, but NO unit or core test pins it (`assertNamedOutcomes`
accepts `[]`, draft.ts:508-512). A regression here (e.g. a future blank
refusal or a mint change) would be invisible. Plain coverage gap.

### Trivial 1 — legacy-version stages: engine derives, UI refuses

The engine gives `capability.version === 'legacy'` stages a fallback contract
producing `'done'` (definition.ts:2807-2811) and exempts them from the
incompleteness mark (:3033-3035); the UI's catalog lookup would classify such
a stage as underivable and refuse the loop review. Unreachable from canvas
flows (zero `'legacy'` binds anywhere in packages/ui/src — grepped), so this
is a conservative-refusal-only divergence affecting hand-authored v2
definitions loaded with legacy-bound stages. No action needed; worth a line
in child 3's digest if body rendering ever meets loaded definitions.

## Notes (verified-sound, no action)

- Refusal-precedence reorder in `synthesizeBoundedLoopFromBackedge`
  (exit-declared → bound → region → underivable → extract; the bound check
  used to run after extraction). No test or spec pins the old order;
  cheap-checks-first. Behavior note only.
- The declare-notice includes `exitOutcome` among candidates, but it is
  always already declared (or empty, filtered) — the line shows only
  `iteration-limit` in practice; pinned by both page assertions.
- The palette gesture's declaration of the exit VALUE when the definition
  declared nothing (`def.outcomes[0] ?? 'done'` → `'done'`) is unit-pinned
  including idempotence over an already-declaring contract.
- `catalogCapabilityFor` ignores `enabled` (documented; engine resolves
  disabled-but-listed contracts the same way) and pins exact `(id, version)`
  — a stale bind surfaces as the honest catalog-gap refusal (design risk,
  accepted).
