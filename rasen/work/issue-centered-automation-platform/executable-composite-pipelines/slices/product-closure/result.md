# ECP-5 `ecp-product-closure` — evidence ledger

Per design D7. This file is built up as the change lands. It currently covers
**Sections 1–3 only** (engine selection policy, the one v2-migration predicate,
and the `rasen-auto` / playbook convergence). Sections 6–9 extend it with the
product-wording table, the dogfood matrix, and the §15.4 exit-conditions table
(tasks 6.1, 7.2–7.8, 8.1–8.3, 9.1–9.5); those rows are NOT yet present, and their
absence here is the honest state, not an omission.

## Section 1 — Engine selection policy

| Claim | Evidence |
|---|---|
| `runs.engine` is registered in the config-key registry and the schema | `grep -c "runs.engine" src/core/config-keys.ts src/core/config-schema.ts` → `1`, `1` |
| Values `auto \| reconciler \| legacy`, default `auto`, project > store > global | `resolveRunsEnginePolicy` (`src/core/project-config.ts`); `test/core/change-run/engine-selection-policy.test.ts` → "resolves flag > project > store > global > default" |
| `--engine` on `rasen pipeline start`, flag over config | `src/cli/index.ts` `pipeline start` option; test → "`--engine reconciler` overrides a configured `legacy`" (asserts `engineSource: 'flag'`) |
| Default `auto` selects the reconciler for a supported pipeline | test → "default `auto` selects the reconciler for a supported pipeline" (real CLI, asserts `engine: reconciler`, `engineSource: default`) |
| Explicit `legacy` refuses with `engine_disabled_by_config` naming the layer, and creates NO Record | test → "configured `legacy` refuses with engine_disabled_by_config and creates no Record" (real CLI; counts Run Records on disk before and after) |
| Forced `reconciler` on an unsupported pipeline fails with the support reason, no Run under either engine | test → "forced `reconciler` on an unsupported pipeline fails with the support reason" (asserts `unsupported_pipeline_shape` and `reconciler (flag)` in the output) |
| Policy never affects a change with only legacy run-state | test → "leaves a legacy-run-state change on the legacy resume path under any policy" (`runs.engine: legacy` + legacy `auto-run.json` → `pipeline resume` still reports `hasRunState: true`) |
| Effective engine + source surface in the launch receipt and `pipeline show --json` | `engine`/`engineSource`/`enginePolicy` on the start receipt; `enginePolicy: { configured, source, effectiveEngine }` on show; test → "reports the resolved policy on `pipeline show --json`" |

**Enforcement is in the CLI, not in prompt text** — that is the whole point of
D1. Every row above except the resolver-precedence one is a real fresh-process
`node dist/cli/index.js` run against the built `dist/`.

### Tasks 1.7 / 1.8 — the bilateral engine-ownership guard, wired (design D8)

The guard is no longer dead code. Verification grep:

```
$ grep -rn "assertSingleEngineOwner\|classifyEngineOwnership" src/
src/commands/pipeline.ts:108:  assertSingleEngineOwner,
src/commands/pipeline.ts:109:  classifyEngineOwnership,
src/commands/pipeline.ts:639:      return assertSingleEngineOwner({      <- mutation seams
src/commands/pipeline.ts:708:    const owner = classifyEngineOwnership({  <- launch seam
src/core/change-run/internal/engine-ownership.ts:41: (definition)
src/core/change-run/internal/engine-ownership.ts:57: (definition)
```

| Claim | Evidence |
|---|---|
| Discriminator is the run-state `engine` DECLARATION, not file presence | `resolveLegacyOwnerSignal` (`src/core/pipeline-registry/run-state.ts`): absent field → `undeclared`, `'legacy'` → `declared-legacy`, `'reconciler'` → not present (D3 bookkeeping), unparseable → `unreadable` (fail-closed) |
| Declared bookkeeping beside a Record is NOT a conflict | `test/core/change-run/engine-ownership-wiring.test.ts` → "lets canonical mutations proceed when run-state declares engine: reconciler" |
| Engine-less run-state beside a Record blocks start + every mutation | same file → "refuses every canonical mutation when engine-less run-state sits beside a Record" (`resume-run`, `complete`, `control`, and `start`) |
| **Both artifacts byte-identical after a refusal** | same test: sha256 of the run-state file and of every Record file compared before/after all four refusals |
| Projections never create a conflict | same file → "never treats a derived goal-run.json as an ownership signal" (`goal-run.json` + a generated report beside a Record) |
| Unreadable run-state fails closed, and is not repaired | same file → "fails closed when run-state cannot be parsed" (refusal + digest unchanged) |
| Ownership is instance-bound across archive + same-name recreate | same file → "binds ownership to the change instance across archive + same-name recreate". Holds by construction: `canonicalPresent` is `store.has(runId)` and `runId` derives from the association registry's ChangeInstanceId, so a recreated Change gets a different Run identity (the Gap-E lesson — the earlier guard looked up by alias and let an old Run through) |
| The runtime never writes/rewrites/deletes run-state to resolve a conflict | no write path exists in `resolveEngineOwner` / `assertCanonicalLaunchAllowed`; proven by the byte-identical assertions above |

**`pipeline cancel` is deliberately NOT guarded.** The refusal message names two
resolutions, one of which is cancelling the canonical Run; guarding cancel would
make that escape hatch unreachable and deadlock the change. Cancel only ever
ENDS the canonical claim, so it cannot deepen a conflict.

**Behavior-change audit (the proposal's fail-closed call-out).** Two paths
change, both refusals, both previously unchecked:

1. **Dual state** (legacy-owner run-state + canonical Record) → `start`,
   `resume-run`, `complete`, `control` refuse. This is exactly what the
   proposal's BREAKING line describes.
2. **Legacy-only** (legacy-owner run-state, no Record) → `pipeline start`
   refuses. Required by D8 ("refuses when legacy-owner state exists" — the
   run-spine "already owned by the other engine" case). **This is a
   single-owner state whose behavior changes, which the current BREAKING
   wording ("no valid single-owner state changes behavior") does not cover —
   flagged for the planner.** Permitting it instead would be strictly worse:
   `start` would create a Record, making the change dual, and every subsequent
   mutation would then refuse — a Run that is born unable to advance.

Nothing else changes: legacy `pipeline resume` is untouched (covered by
"leaves engine-less run-state alone on the legacy resume path"), `pipeline
status` is read-only and unguarded, and a canonical-only change behaves
exactly as before.

### Superseded — the original task 1.7 finding (kept for provenance)

`assertSingleEngineOwner` / `classifyEngineOwnership`
(`src/core/change-run/internal/engine-ownership.ts`) have **zero production
callers**: `grep -rn "assertSingleEngineOwner" src/` returns only the definition,
and `grep -rn "engine-ownership" src/` returns only that file's own doc comment.
`engine_owner_conflict` is declared in `ChangeRunRuntimeErrorCode`
(`src/core/change-run/facade.ts`) but nothing throws it. The module is covered
solely by `test/core/change-run/engine-ownership.test.ts`, which exercises the
pure function.

The design (D1) states the guard blocks bilateral mutation as EXISTING
behavior. It did not. Wiring was deliberately not attempted at that point
because the obvious wiring contradicts design D3: under D3 a reconciler-engine
run legitimately keeps an `auto-run.json` of operational bookkeeping beside its
canonical Record, so a guard reading `canonicalPresent && legacyPresent ->
refuse` would block every converged run.

**Resolved by design D8**, which adopted the nominated discriminator (the
run-state `engine` declaration introduced in playbook Step F) and specified the
seams. See "Tasks 1.7 / 1.8 — the bilateral engine-ownership guard, wired"
above for the implementation and its evidence.

## Section 2 — One v2-migration predicate (Candidate 2)

| Claim | Evidence |
|---|---|
| One exported predicate, grep-able in `src/` | `grep -rn "definitionRequiresV2Lowering" src/` → definition in `src/core/pipeline-registry/definition.ts` plus consumers in `lowerer.ts`, `profile-resolver.ts`, `execution-plan-internal.ts` |
| The lowerer's inline copy is gone | `grep -n "const requiresV2Lowering" src/core/change-run/internal/lowerer.ts` → no match |
| A v1 parallel-only definition gets `root:<id>` bindings | `test/core/pipeline-registry/v1-parallel-only-lowering.test.ts` → "resolves v2 hierarchical (`root:<id>`) bindings, including the FanOut evaluator" (asserts no `stage:` key survives) |
| Policy stages are remapped onto the SAME paths as the bindings | same file → "remaps policy stages onto the SAME hierarchical paths as the bindings" (an Action looks BOTH up under one path) |
| Support reports `supported_v2_parallel` | same file → "reports `supported_v2_parallel` with the production profile" |
| Incomplete bindings still fail closed BEFORE launch | same file → "fails closed before launch when a binding is missing" (drops the synthetic evaluator binding → `unsupported_pipeline_shape`) |
| Lowering produces FanOut + member + Join | same file → "lowers to a FanOut + member + Join plan" |
| The first reconcile admits the FanOut condition evaluator | same file → "admits the FanOut condition evaluator on the FIRST reconcile pass" (asserts `admissionKind: agent`, `access: none`, `input.fanOutCondition.fanOutPath`) |

### Task 2.6 — semantic re-review of the revived path

Reviving a dead path made it reachable; the portfolio lesson is that the
newly-reachable path then has its own bug. The revived path was therefore walked
end to end rather than diffed — see
`test/core/pipeline-registry/v1-parallel-only-lowering.test.ts` →
"drives the revived path evaluator -> members -> join -> ship -> finish", which
commits real results through the reducer at each step:

1. First reconcile grants exactly ONE action, the FanOut evaluator.
2. The evaluator's committed result activates both members; the next reconcile
   grants exactly the two member actions.
3. Both members succeed; the Join proceeds and the next reconcile grants the
   downstream stage that `requires` them.
4. The downstream stage succeeds; the Run reaches `finish`.

Findings from the walk (no defect requiring its own task):

- **Evaluator brief synthesis is correct for the v1 parallel-only shape.** The
  synthetic binding (`buildEvaluatorBinding`) gives `parallel-dispatch` with
  `workspace.access: 'none'` and `effects: []`, matching the plan node's `none`
  access, so the evaluator takes no workspace reservation. The policy stage
  (`synthesizeEvaluatorPolicyStage`) gives `role: dispatcher`,
  `sandbox: read-only`, `gate: false`. Both resolve under the same
  `root:<fanOutId>` path that `buildAction` looks up, which is what the old
  divergence broke.
- **Member policy is inherited, not defaulted.** `remapPolicyStagesForV2` maps
  each member through its `legacyStageId` to the authored v1 policy stage, so a
  member keeps its authored role and sandbox (asserted: `review` stays
  `reviewer`/`read-only`, `ship` stays `shipper`). A default-synthesized stage
  would have silently granted `implementer`/`workspace-write` to a reviewer.
- **`Join` correctly binds nothing** in all three layers now (resolver, expected
  set, lowerer) — it derives its state from committed member results and is
  never admitted.
- **`hasUnsupportedSemantics` reachability is unchanged.** It is now skipped
  whenever the shared predicate is true, which is the same set as before: the
  old code already escaped that check when FanOut/Join were present.

## Section 3 — `rasen-auto` + playbook convergence

### Deletions, each with its named replacement (task 3.3)

| Deleted from prompt text | Replacement (kernel) | Evidence |
|---|---|---|
| The round-cap DEFAULT (`Default cap: 3`) | bounded-loop cap in the Record | `grep -n "Default cap: 3" src/core/templates/workflows/_orchestration.ts` → no match; `test/core/change-run/review-cycle.test.ts` |
| Clean determination for the reconciler path | ship/settle guard — open Blocker/Major cannot settle clean | `test/core/change-run/facade-settle-completeness.test.ts` |
| author ≠ verifier as a LEAD VERDICT for the reconciler path | same-actor rejection at commit | `test/core/change-run/review-cycle-runtime.test.ts` |
| Malformed-result acceptance rules for the reconciler path | pre-commit result validation | `test/core/change-run/facade-runtime.test.ts` |

Guarded by `test/core/templates/orchestration-bundles.test.ts` →
"deletes the prompt-owned duplicates of kernel-enforced rules".

### Retained, explicitly labeled as the legacy-engine path (task 3.4)

Step E.2 keeps the complete Steps 1–5 legacy protocol (review, triage, fix,
non-author re-review, loop-or-terminate including "Never report clean while a
Blocker or Major finding is open" and "A finding is resolved ONLY after a
non-author confirms it"). It is labeled `**This is the legacy-engine path.**`
and is entered for an explicit `runs.engine: legacy`, for `auto` on a pipeline
the reconciler cannot own, and for any change whose existing run-state is
legacy-owned. Guarded by the same test file →
"keeps the legacy branch complete and explicitly labeled".

Worker lifecycle, warm reuse, briefing, Tier fallbacks, the Step H escalation
ladder for non-Run concerns, and portfolio orchestration are unchanged and
engine-neutral.

### Run-state boundary (task 3.5) and resume (task 3.6)

Playbook Step F now states the boundary by engine and requires
`engine: { effective, source }` at run start; mirrored mechanical facts are
labeled projections that MUST NEVER be read back to drive progression. Step F.1
and `rasen-auto`'s Resume section resume a reconciler-engine run from the
canonical frontier (`pipeline resume-run`) and keep `pipeline resume`'s artifact
heuristic as the legacy-engine surface. Guarded by
`test/core/templates/orchestration-bundles.test.ts` →
"bounds reconciler-engine run-state to bookkeeping and labeled projections" and
`test/commands/auto.test.ts` → the three ECP-5 cases.

### ECP-3 task 9.4 — discharged with evidence (task 3.9)

`grep -n "kind === 'goal'" src/core/templates/workflows/goal-iterate.ts src/core/templates/workflows/goal-report.ts`:

- `goal-iterate.ts:28` — reads `rasen pipeline status --change <name> --json` →
  `sections[].kind === 'goal'` for the prior round's score/gaps.
- `goal-report.ts:21` — reads the same section, and states "The canonical Record
  is the sole source of truth — do not consult `goal-run.json` for Run state."

`grep -n "goal-run.json" src/core/templates/workflows/*.ts` — every hit is
projection language or a bare artifact NAME, never a state source:

- `_orchestration.ts:200` — "a derived compatibility projection, NOT the
  authoritative spine"
- `goal-command.ts:52` — "a derived compatibility projection — it CANNOT
  back-drive the Run"; `:112` — "a read-only projection"
- `goal-iterate.ts:73` — "Do NOT write run-state or goal-run.json"
- `goal-report.ts:21`, `:37` — "do not consult ... for Run state" / "do not infer
  outcomes ... from the legacy `goal-run.json` file"
- `direction.ts:117`, `help.ts:73` — name the artifact only to distinguish
  `rasen-goal` from Direction; neither reads it.

ECP-3 9.4 is therefore substantively true in the shipped templates, and is
annotated in `rasen/changes/ecp-goal-loop/tasks.md` with a pointer here rather
than given a bare tick.
