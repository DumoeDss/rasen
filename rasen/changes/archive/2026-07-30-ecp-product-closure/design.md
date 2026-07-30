## Context

The portfolio's runtime is done; its ownership story is not. Today:

- **Step L vs Step E asymmetry.** `_orchestration.ts` Step L (goal loops) is already reconciler-driven: the LEAD launches the canonical Run, drives it via `pipeline resume-run`, dispatches per granted action, and reads the `goal` section — it owns no mechanical state. Step E (review-cycle loops) is the opposite: the prompt itself counts rounds ("Default cap: 3"), routes triage, enforces author ≠ verifier, decides clean, and escalates — independent mechanical progression living in prompt text, duplicating what `src/core/change-run` already enforces with real rejection paths (ECP-1). The standalone `rasen-review-cycle` skill was converged by ECP-1; `rasen-goal` by ECP-3; `rasen-auto` was not.
- **Engine selection is implicit and partially false.** `rasen pipeline start` hardcodes `engine: 'reconciler'` (`src/commands/pipeline.ts:917`); there is no config or flag to choose, disable, or display the engine, and no documented default/fallback policy. Capability discovery (`resolveReconcilerSupport`) mis-reports v1 parallel-only pipelines: `resolveCapabilityBindings` (`src/core/pipeline-registry/profile-resolver.ts:34`) only produces v2 hierarchical (`root:<id>`) bindings when `authoredVersion !== 1` or a ReviewCycle BoundedLoop is present, while `lowerRuntimePlanInput` (`src/core/change-run/internal/lowerer.ts:1020`) routes any FanOut/Join-bearing definition through the v2 lowerer. A v1 `parallelGroup`-only pipeline therefore carries `stage:<id>` bindings that the v2 lowerer cannot find: the strict binding check in `execution-plan-internal.ts:713` reports `unsupported_pipeline_shape`, making `supported_v2_parallel` unreachable for exactly the v1 audience ECP-4's normalizer work targeted.
- **A shipped spec promise is false.** ECP-1's `executable-review-cycle` delta requires CLI, Management API, and Operations to consume the same `ChangeRunView` review-cycle section. CLI renders it (`pipeline.ts:852`), the API returns it, but `getReviewCycleSection` (`packages/ui/src/api/types.ts:1750`) has zero consumers — `OperationsSection.tsx` renders parallel/choice (ECP-4) but not review-cycle.
- **Parity constants are hand-copied.** `packages/ui/test/components/ecp4-parallel-choice-parity.test.tsx` asserts DOM against hand-copied canonical constants; `test/core/change-run/reviewer-r3-ui-constants-provenance.test.ts` is the only thing pinning them to the real projector, by verbatim duplication.
- **The UI suite is red by baseline.** `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` has 2 pre-existing failures (fanout/join `data-editor-supported` expected `'false'`, actual `'true'`; creatable kinds missing `composite`).
- **Docs lag by four slices.** `docs/architecture/executable-composite-pipelines.md` — the self-described authoritative reference — still says Composite/BoundedLoop/GoalLoop/FanOut/Join execution is out of 0.1.6 scope.
- **Dogfood evidence has holes** against research-doc §15.4 condition 3: real Runs exist for bug-fix ReviewCycle (ECP-1, RunId `b23b2c…`), custom composite (ECP-2), goal-loop-measure/-research/-exhaustion (ECP-3), full-feature (ECP-4). Missing: a real `small-feature` Run (only a normalization test exists), a real `goal-loop-evaluate` Run, and proof the composite evidence was Canvas-authored (ECP-2's task 14.1 allowed "or construct programmatically").

Constraints: no new runtime model; children ship local; another session's uncommitted work lives in the primary checkout (this worktree only); `packages/ui/package-lock.json` is user-parked — do not touch.

## Goals / Non-Goals

**Goals:**
- One engine owner per Run, visibly selected, default `auto`, explicitly disableable, with legacy recovery untouched.
- `rasen-auto` reduced to selection/launch/adapter for reconciler-engine runs; prompt-owned duplicates of kernel-enforced rules deleted, each deletion justified by named replacement evidence.
- Truthful capability discovery for every built-in and v1-authorable shape.
- The cross-plane parity suite proves agreement **with the kernel**, not just among planes.
- Every §15.4 exit condition has a pointer-backed evidence entry; the packaging/build/release checks pass on a green suite.

**Non-Goals:**
- No new node kinds, reducers, sections, or wire-type versions.
- No removal of the legacy engine (retirement conditions are recorded; the decision is dogfood-driven and the user's).
- No version bump (user-owned release action).
- No `auto-decompose`/portfolio/Issue-plan work (0.2.0).
- No nested loops, recursion, or any §15.3 non-goal.

## Decisions

### D1. Engine policy: `runs.engine` config + `--engine` flag, enforced in the CLI, not the prompt

`runs.engine: auto | reconciler | legacy` (project > store > global; default `auto`), plus `--engine <reconciler|legacy>` on `rasen pipeline start` (flag > config). Resolution:
- `auto` → reconciler when `analyzeReconcilerSupport` says supported; otherwise the legacy path with the support reason displayed.
- `reconciler` → force; if unsupported, fail with the support reason (no silent fallback — the user asked for the engine by name).
- `legacy` → `pipeline start` refuses with typed error code `engine_disabled_by_config` naming the deciding config layer; launchers route to the legacy playbook.

Why CLI-enforced: a prompt can be asked to honor config but cannot be *proven* to; the refusal in `pipeline start` is testable and closes the only door that creates canonical Runs. `rasen-auto` additionally reads the same resolution to decide which playbook branch to run, and displays `Engine: reconciler (auto)` at launch alongside the existing gate/selection policy lines (same precedent: `autopilot.gates`, `autopilot.selection`). Alternative considered — an `autopilot.engine` key: rejected because the engine also governs the standalone launcher and `rasen-goal`, which are not autopilot.

Legacy recovery policy (restated, unchanged): a change with only legacy run-state resumes legacy forever; nothing in this change migrates a Run across engines. Ambiguous bilateral state blocks mutation via the engine-ownership guard — which this slice must first WIRE: `assertSingleEngineOwner` shipped in ecp-run-spine as a function with unit tests and zero production callers, so the blocking behavior did not exist until D8's wiring (see D8 for the discriminator that makes wiring compatible with D3).

### D2. Step E convergence mirrors Step L; deletion is scoped to duplicates with named replacements

For reconciler-engine runs, the review-loop stage is driven exactly like Step L drives goal loops: `pipeline start` (once, whole-pipeline Run) → per quiescent boundary `pipeline resume-run` → dispatch a worker per granted action (composing briefs from the `review-cycle` section) → `pipeline complete` with the result contract → read progress from the section. ECP-4's full-feature dogfood already proved the kernel drives the *entire* stage DAG (office-hours → … → archive), so this is product convergence, not new runtime.

Deleted from the playbook/auto text (each with its replacement evidence named in tasks): round counting and the "Default cap: 3" ownership (kernel: bounded-loop reducer + `goal_cycle_exhausted`-style exhaustion, `review-cycle` limits), clean determination (kernel: ship guard — open Blocker/Major cannot settle clean), author≠verifier enforcement (kernel: same-actor rejection at commit), malformed-result acceptance rules (kernel: pre-commit validation). Retained, explicitly labeled **legacy-engine path**: the full Step A–K mechanics for legacy runs and Tier B/C hosts, worker lifecycle/warm-reuse/briefing, the H escalation ladder for non-Run concerns (relay caps, session relays), portfolio orchestration. The playbook gains one engine branch, not two documents. Legacy retirement conditions are recorded in the architecture doc instead of deleting the legacy path now.

Why not delete the legacy mechanics outright: the research document explicitly keeps legacy recoverable and the off-switch two-way; deleting the only documentation of the legacy path would orphan every pre-existing run.

### D3. Run-state boundary: mechanical truth vs operational bookkeeping

For reconciler-engine runs, `auto-run.json` (and `goal-run.json`, already so) is bounded to: worker handles/transcripts, gate-policy freeze, retention mode, strategy attempts, session-relay generation — things the kernel does not model. Stage status, rounds, phases, findings, outcomes derive from the canonical Record and are written into run-state only as clearly-labeled projection (never read back to make progression decisions). Resume for reconciler-engine runs goes through `pipeline resume-run` (canonical frontier); `pipeline resume`'s artifact-heuristic remains the legacy-engine resume surface. This is the goal-loop precedent generalized, and it is what makes "one canonical state" true rather than aspirational.

### D4. One shared v2-migration predicate

Export a single `definitionRequiresV2Lowering(prepared)` (BoundedLoop-or-FanOut/Join-or-v2-authored) from the pipeline-registry layer and consume it in `lowerRuntimePlanInput`, `resolveCapabilityBindings`/`resolveRuntimeExecutionProfile` (v1 parallel-only definitions get v2 hierarchical bindings + remapped policy stages), and `analyzeReconcilerSupport`. The three divergent inline copies of "what needs v2" are deleted — that divergence *is* the Candidate-2 bug. The revived path (`supported_v2_parallel` for v1 parallel-only) is then re-reviewed semantically end-to-end: bindings, support report, lowering, one reconcile smoke — not just the predicate diff (lesson: fixing one defect makes the next reachable).

### D5. Operations review-cycle section + provenance-by-construction constants

Copy ECP-4's worked pattern: `ReviewCycleSection` component in `OperationsSection.tsx` consuming `getReviewCycleSection` (round/maxRounds, phase, outcome, findings with severity/status, actors, wait reason), with i18n entries in both locales. Constants move to one data module `packages/ui/test/fixtures/canonical-sections.ts` exporting the four ECP-4 constants plus new review-cycle constants; a node-side provenance test imports that module and asserts each constant deep-equals the real projector's output for the documented fixture (the kernel's answer — shared-reader lesson); UI parity tests import the same module and include deliberately-incoherent-section probes so a client-side recomputation fails. The existing `reviewer-r3-ui-constants-provenance.test.ts` stays as-is (kept as regression by `2fcd5438`); the new test supersedes its constant-duplication for future sections.

### D6. Canvas failures: adjudicate each against a cited spec, then keep the suite green

- fanout/join `data-editor-supported`: ECP-4 shipped FanOut/Join panels and authoring (`executable-parallel-pipelines` delta, Canvas requirements) — the expectation `'false'` predates that slice. Verdict expected: stale test; update the assertion citing the delta requirement. If inspection instead shows the panels are display-only in edit mode, the product is fixed, not the test.
- missing `composite` creatable kind: ECP-2's `executable-custom-composite` delta promises Canvas create/reference of Custom Composites. If creation exists via another flow (e.g. declaration-first) and root-palette insertion of `CompositeRef` is genuinely unsupported, the test is rewritten to exercise the real flow and the wording documents it; if no creation path exists in edit mode, that is a product gap against exit condition 2 and is fixed in the Canvas.
The rule either way: no assertion is changed to "whatever the code does today" without a spec citation in the test comment (lesson: a test asserting current behavior is not a test asserting correct behavior).

### D7. Evidence ledger and dogfood matrix live with the portfolio's research artifacts

`rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/product-closure/result.md` (ECP-1's `result.md` convention): a table of all 14 §15.4 exit conditions with per-condition evidence pointers (test file, RunId, doc section, or commit), and the dogfood matrix (pipeline × RunId × engine × terminal state × evidence refs). Missing cells are produced by real fresh-process CLI Runs against built `dist/` (stale-dist lesson): `small-feature`, `goal-loop-evaluate`, and — if ECP-2's evidence proves programmatic — one Canvas-authored Custom Composite Run. Cited cells keep their original RunIds plus a note that the integrated-HEAD full suite covers their regression surface.

### D8. The engine-ownership guard is wired with a declared-engine discriminator

**Fact found at task 1.7 (implementer, verified):** `assertSingleEngineOwner` / `classifyEngineOwnership` (`src/core/change-run/internal/engine-ownership.ts`) have zero production callers — ecp-run-spine shipped the function and its unit tests but never the wiring, so the bilateral guard was dead code and "blocks mutation" was aspirational. Naive wiring (`canonicalPresent && legacyPresent → refuse`) is also wrong: it would refuse every D3-converged run, because a reconciler-engine run legitimately keeps `auto-run.json` bookkeeping beside its canonical Record.

**Discriminator — run-state declares its engine; undeclared run-state is a legacy owner:**
- `canonicalPresent`: a canonical Run Record for the change **instance** in the RunStore — association-registry-bound, never name/alias-scoped (Gap-E lesson).
- `legacyPresent`: the change's run-state artifact (`auto-run.json` at its resolved workDir / sticky change-dir location) exists AND does not declare `engine.effective: 'reconciler'` (the optional `engine` field in `src/core/pipeline-registry/run-state.ts`). Absent declaration → legacy owner — this is the truthful reading, not a heuristic: only pre-convergence LEADs, which owned mechanical progression, ever wrote engine-less run-state. `engine.effective: 'legacy'` → legacy owner. `'reconciler'` → D3 bookkeeping, not an owner. Unreadable/unparseable run-state → counts as legacy-present (fail-closed: an unreadable artifact is never presumed harmless bookkeeping).
- **Never ownership inputs:** `goal-run.json`, Markdown reports, and every labeled projection — they are read-only derivations by construction (`projectGoalRunJson`); counting them would make every ECP-3 reconciler goal Run instantly ambiguous.

**Seams (the production callers this slice adds):** `pipeline start` computes the discriminator before creating a Record and refuses `engine_owner_conflict` whenever legacy-owner state exists — **explicitly including the legacy-only case with no canonical Record**: allowing that launch would create the dual state, handing the user a Run born unable to advance (its first mutation would hit the ambiguity refusal), so the launch seam refuses up front instead. `complete`, `control`, and `resume-run` recheck and refuse on ambiguity (resume-run admits actions, so it mutates). **Cancellation is deliberately unguarded, and that is load-bearing:** the refusal message names cancelling the canonical Run as one of the two resolutions, so guarding cancel would make the documented escape hatch unreachable and deadlock the change. Read-only surfaces (`pipeline status`) are unguarded by design. The refusal message is actionable: it names the run-state path and the Run, and states the operator's two resolutions (finish/cancel the canonical Run, or retire the legacy artifact). The runtime never writes, rewrites, or deletes run-state to resolve a conflict — single-writer stays with the LEAD. **One door, not two:** the management API needs no separate wiring — its run-control bridge spawns the CLI as a subprocess rather than calling the facade directly, so the UI plane inherits the guard; do not "fix" a second enforcement point later.

**Migration (pre-existing engine-less `auto-run.json` — the case that will occur in the wild):** alone → legacy owner: legacy resume unchanged (policy never re-homes a run), but `pipeline start` now refuses — this is the one path an existing user hits on upgrade, and the migration documentation must state it plainly (keep driving the change through legacy resume, or retire the legacy artifact to go canonical). Beside a canonical Record → ambiguous: launch and every canonical mutation except cancel refuse until the operator resolves; never auto-adopted, never rewritten. Converged runs always declare `engine` at run start (Step F / opsx-orchestration delta), so no new run enters the ambiguous class by construction.

**Why declared-engine over content-sniffing** (inferring ownership from mechanical fields being present): the declaration is one closed schema field — cheap to compute, trivially testable, stable under run-state evolution. Content-sniffing would re-derive the D3 boundary from file shape — a second implementation of the very boundary it polices.

This wired guard plus the launch-time freeze is the mechanism the evidence ledger cites for exit condition 11 ("one Run has one engine owner and one canonical state"); an unwired assertion could not have evidenced it.

### D9. Dormant session-contract fields: placeholders declared, fidelity preserved, numbers deferred

**Facts (peer session finding, independently verified):** `buildAgentAction` (`src/core/change-run/internal/actions.ts:205-209`) persists `session: { reuse, handoffTokenLimit, reuseRoundLimit }` into every committed agent action. `handoffTokenLimit: 10_000` and `reuseRoundLimit: 1` are hardcoded at all four write sites (`profile-resolver.ts:244/612/640`, `commands/pipeline.ts:864-865`), always with `'default'` provenance and **no config key**. All three synthesis paths stamp `sessionReuse: 'never'`. The CLI resolver flattens the four authored reuse scopes (`none | stage | run-planner | review-thread`, `src/core/pipeline-registry/types.ts:40`) to two contract values, so authored `stage`/`run-planner`/`review-thread` all become `same-invocation` — **with provenance `'stage'`**, i.e. the contract claims the author chose a value the author never wrote. Nothing reads any of these today; the 0.2.0 Session execution layer will be the first reader. And critically: the Record persists only `executionProfileDigest`, not the profile — so a Record-only reader sees the action's session block with **no provenance at all**.

**Adjudication, per issue:**
- **`handoffTokenLimit: 10_000` — placeholder; do not re-set the constant.** Choosing ≈150k now re-commits the same defect (an unchosen constant with `'default'` provenance, different magnitude). The real value is a session-layer design output — it depends on model window (the 200k-vs-1M probe lesson), relay policy, and probably belongs in scheme-style config — and re-setting it churns policy digests for zero behavior. Instead the spec now declares the value non-authoritative (below).
- **`reuseRoundLimit: 1` — same disposition**, with an explicit spec warning: behaviorizing the recorded `1` would forbid reviewer reuse across rounds — the *core* review-thread pattern — so this placeholder is not merely unchosen, it is directionally wrong as policy.
- **Evaluator synthesis `sessionReuse: 'never'` — correct, and definitional.** A one-shot condition/choice evaluation has no session worth reusing; the value is implied by the node kind, not defaulted. It gets provenance `'definition'` so the *correct* value survives the placeholder rule as authoritative.
- **Review-cycle (and default) synthesis `sessionReuse: 'never'` — placeholder, keep both value and `'default'` provenance.** `'never'` is the conservative value (a reader honoring it loses efficiency, never correctness), and nobody chose it — the truthful stamp. Hardcoding `'review-thread'` here would be ECP-5 designing reuse semantics that belong to the session layer. The authored-intent loss is repaired by fidelity capture (next), not by guessing.
- **Four→two flattening — the one accepted additive change: `sessionReuseAuthored`.** Unlike the two limits (values nobody chose, protectable retroactively by a rule), the flattening destroys intent an author DID express, and no future rule can recover what was never recorded. An optional `sessionReuseAuthored: 'none' | 'stage' | 'run-planner' | 'review-thread'` is captured verbatim on the EffectiveRunPolicy stage and carried into the action's session block; **omitted when unauthored or synthesized** (digest-stable for every existing fixture), no behavior attached, the two-value `reuse` enum unchanged. This also cures the false-provenance pair: (`reuse: 'same-invocation'`, `sessionReuseAuthored: 'review-thread'`, provenance `'stage'`) is self-describing.

**Why a spec'd placeholder rule instead of (or before) constants — the retroactivity argument:** every Record ECP-1..4 already wrote carries these values; a constant fix only changes Records written from now on and makes old-wrong and new-chosen values indistinguishable. Because the committed action carries no provenance and the profile is not persisted, the rule binds at the **contract level**: 0.1.6 defines no authoritative source for `handoffTokenLimit`/`reuseRoundLimit` (no config key exists — verified), therefore every 0.1.6-era recorded value for those fields is a placeholder *by definition*, and a Record-only reader needs no per-field provenance to apply the rule. When a future slice introduces the authoritative source, its explicitly-resolved values (non-`'default'` provenance at resolve time, new contract surface at read time) become authoritative — old Records stay protected forever.

**Deferred to the Session execution layer slice (recorded, not smuggled in):** choosing real limit values and their config keys; defining `review-thread`/`stage`/`run-planner` reuse semantics and restoring synthesized review-cycle phases' reuse from `sessionReuseAuthored`; any in-action provenance field; the pre-announced revision of the `opsx-orchestration` worker-handle/session-relay ownership boundary (spec.md:38) — deliberately left untouched here.

## Risks / Trade-offs

- [Playbook rewrite regresses legacy-engine behavior] → Engine branch is additive; legacy text is moved/labeled, not reworded; template parity checks and a targeted grep list (deleted phrases must be gone, retained anchors must remain) run in CI-equivalent tasks.
- [Prompt-text convergence is hard to falsify] → Every deletion task names the exact phrase that must no longer appear (`grep` falsifiable) and the replacement evidence (kernel test file); the dogfood matrix exercises the converged path with a real Run.
- [Reviving `supported_v2_parallel` for v1 exposes latent kernel paths] → Scoped semantic re-review task with reconcile smoke test, not just unit-diff; fail-closed remains the default for incomplete bindings.
- [Canvas verdicts could quietly become "edit the test"] → Each verdict task requires a spec citation in the test/product diff; the two failures get separate verdicts.
- [Real-CLI dogfood on Windows is flaky (EBUSY/timeouts)] → Known-flake protocol: clean temp, rerun isolated, enumerate the full failure list — never extrapolate from a truncated tail.
- [Slice size] → Strict dependency ordering in tasks; UI work (D5/D6) is independent of engine work (D1–D4) and can be reviewed file-by-file; no task depends on an unstated sibling.

## Migration Plan

No data or wire migration. Rollout is docs + config default (`auto` ≡ today's effective behavior). Rollback = revert the commit; legacy runs are unaffected in both directions. The 0.1.6 version bump and release execution remain the user's action; this change leaves the release-contract checks green at 0.1.5.

## Open Questions

- Whether ECP-2's composite dogfood was Canvas-authored is determined by a task (evidence read), not assumed either way here.
- Exact placement of the `runs.` config namespace vs a future `engine.` group — settled at implementation with the config-key registry's conventions; the spec pins the semantics, not the key's file layout.
