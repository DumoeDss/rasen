# Handoff — implementer-1, canvas-loop-validate-clean-synthesis (apply)

Status: ALL 20 tasks done; stage complete. Working tree carries the full
implementation, UNCOMMITTED per the round-3 implementer discipline — the
ship stage owns the narrow-pathspec commit (inventory + pathspec in
`evidence/constraint-sweep.md`): `packages/ui/src/canvas/draft.ts`,
`packages/ui/src/canvas/PipelineCanvasPage.tsx`,
`packages/ui/src/canvas/V2LoopReviewPanel.tsx`,
`packages/ui/test/canvas/draft.test.ts`,
`packages/ui/test/canvas/pipeline-canvas-page.test.tsx`,
`test/core/pipeline-registry/canvas-loop-synthesis-engine-clean.test.ts`
(new), `rasen/changes/canvas-loop-validate-clean-synthesis/`. `bin/rasen.js`
is a CRLF phantom — stays out of every pathspec. `.rasen/…/ephemera/`
(driver + screenshots) stays untracked.

## What shipped

- **Class 1 (producible outcome rows)**: new `bodyTerminalOutcomes(def,
  region, catalog)` in draft.ts — mirrors the engine's
  `resolveGraphTerminalOutcomes` over AtomicStage-only bodies (capability
  outcomes resolved in `catalog.skills` by (id, version), REPLACED by the
  `loopPhaseOutcomeNames` mirror when phase-tagged, minus internally
  consumed (from.node, from.port), dedup in body-node order). Feeds
  `deriveBackedgeLoopContract`'s outcome rows on EVERY side. Child-1's
  `[from]` fallback and round-one's stage-id names superseded (comments
  name the change in code and tests). Catalog gap →
  `underivableBodyStages` probe + `underivableBodyStageRefusals` messages,
  rendered in the review (blocks confirm) AND re-checked in the model at
  confirm.
- **Class 2 (control-typed rows)**: `CONTROL_PORT_TYPE = 'ecp/control'`
  constant (doc cites engine definition.ts:2749 + the no-widening rule);
  severed AND fallback input rows re-typed in
  `deriveBackedgeLoopContract` — names unchanged. `deriveSubgraphContract`
  itself byte-identical (verified vs HEAD).
- **Class 3 (declared lifecycle exits)**: `ensureLoopExitOutcomesDeclared`
  appends every missing exit-ACTION outcome value (exits + lifecycle.exits)
  through `declareDefinitionOutcome` (the single rule site); called from
  BOTH `synthesizeBoundedLoopFromBackedge` and
  `addBoundedLoopOverDeclaration` (palette gesture covered by the shared
  mint layer). `defaultBoundedLoopExitOutcomeValues()` feeds the review's
  new muted declare-notice line (`v2-loop-review-declares`).
- **Exit rewiring**: `rewireCrossingsOnto` optional `outgoingPortOverride`
  — the loop path passes the review's exit outcome (a BoundedLoop's output
  ports are its exit values); the extract path passes nothing (positional
  mapping byte-kept). New model refusal: an undeclared exit outcome throws
  naming it.
- **Signatures changed** (all call sites updated): `deriveBackedgeLoopContract(def,
  region, to, catalog)` — the `from` parameter was DROPPED (outcomes no
  longer derive from the back-edge source; input naming needs only `to`);
  `synthesizeBoundedLoopFromBackedge(def, input, catalog)`.
- **The mock-split gap closed (the child-1 Minor)**: new
  `test/core/pipeline-registry/canvas-loop-synthesis-engine-clean.test.ts`
  reaches across to the UI model (the provenance-test direction) and runs
  the REAL `EcpDefinitionModule.prepare` over the real zero-edit flow built
  ONLY with the UI's own gestures — back-edge case and palette case both
  report zero diagnostics, and three falsifiability controls re-inject each
  pre-fix defect class (name-typed row, stage-id outcome, undeclared
  iteration-limit) and prove it red through the same prepare.
- Tests: draft.test.ts +5 describes rewritten/added (derivation, phase
  table, palette declare-on-synthesis, model refusals, supersession
  inventory), page test extended to the full zero-edit acceptance (incl.
  loop-onward via a new mock authored route `bounded-loop:done->finish:input`).

## Gates (all green, first run unless noted)

- Full UI suite `pnpm --dir packages/ui exec vitest run`: **68 files / 912**
  (baseline 68/902, +10, zero failures; no flake encountered).
- Core pin: 5/5.
- Real browser (fresh ports 9352 server / 9353 CDP, throwaway Chrome 151
  1600x1000): review facts exactly the new synthesis (`ecp/control` entry,
  producible `done` rows, declare notice); wired graph Validate `✕ 0 errors
  · 1 warning` (the machine's known unrelated workflow-profile warning);
  palette-gesture second loop also 0 errors. Driver + screenshots in
  `.rasen/changes/canvas-loop-validate-clean-synthesis/ephemera/`;
  narrative in `evidence/browser-gate.md`.
- Constraint sweep in `evidence/constraint-sweep.md`: IR frozen (empty
  `git status --porcelain -- src/core/pipeline-registry/`), extract path
  byte-identical, `V2_BODY_PALETTE_KINDS` untouched, no
  `legacyRuntimeOwner` stamps, typecheck at exactly the 13 pre-existing
  errors (none in this change's files).

## Eliminated hypotheses (debugging this stage)

- "GATE 2 timed out because the pipelines page failed to load" — no: the
  driver derived the project route from the ENTRY URL's pathname, which is
  `/` for `/?space=project:<id>#token=…`; navigating to
  `/pipelines#token=…` (no `/p/<project>` prefix) 404'd the SPA route. The
  route must come from the `?space=` query param (child-1 hardcoded theirs;
  the param derivation is the reusable fix). One-line fix, then the whole
  gate passed in a single run.
- "The unused-import type error needed the import removed" — no: the right
  fix was a direct unit pin (`ensureLoopExitOutcomesDeclared` idempotence
  over an already-declaring contract), which uses the export meaningfully
  and kept the helper covered at the unit level too.
- "The first focused run's `EXIT:0` with 1 failed test meant vitest lied" —
  no: the command piped through `tail`, which masked the exit code (the
  known pipe-masks-exit-code trap); the failure itself was real
  (`standaloneCycleDef` out of scope in the synthesize describe — the
  describe-local fixture pattern bit exactly as it looks). Fixed by a local
  fixture; all subsequent runs unpiped.

## Durable findings for the next workers

- The review's inline declare remains the ONE review-time input the
  empty-contract flow needs (declaring the exit outcome before confirm) —
  design input, not contract repair; the acceptance forbids POST-synthesis
  edits and none are needed anymore.
- Known boundary (unchanged, recorded in design non-goals): the extract/
  package-into-block path still mints engine-red defaults (same class-1/2
  defects in `deriveSubgraphContract` rows) — a future change; and
  `layout.ts` renders loop output handles from the declaration's rows while
  engine ports are the exit values (valid whenever they coincide — the
  default flow; general fix belongs to child 3's body-visibility work).

Next action (ship stage): commit with the narrow pathspec above; PR per
portfolio discipline (children ship LOCAL; parent delivers once).
