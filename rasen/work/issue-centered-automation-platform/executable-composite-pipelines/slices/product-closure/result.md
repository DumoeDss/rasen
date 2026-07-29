# ECP-5 `ecp-product-closure` — evidence ledger

Per design D7. This file is built up as the change lands. It now covers
**Sections 1–3** (engine selection policy, the one v2-migration predicate, the
`rasen-auto` / playbook convergence) and **Sections 6–9** (product wording and
capability discovery, the dogfood matrix, the §15.4 exit-conditions table, and
the release checks). Sections 4, 5, 5A and 10 are evidenced in `tasks.md`'s own
annotations and are cited from here where a §15.4 condition depends on them.

The header of the earlier revision said "Sections 1–3 only … those rows are NOT
yet present, and their absence here is the honest state, not an omission". That
was true when written; it is preserved as provenance in the same spirit as the
superseded task-1.7 entry below.

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

## Section 6 — Product wording and capability discovery

### The reason-code -> product-copy table (task 6.1)

`resolveReconcilerSupport` can emit exactly eight reasons. Every one has product
copy in three locales, and the record is keyed by the analyzer's own union
(`RECONCILER_SUPPORT_REASON_KEYS`, `src/commands/pipeline-messages.ts`), so a
reason added there without copy is a **type error**, not a raw code leaking into
the terminal. `EngineSupportPanel`'s `REASON_LABELS` is keyed by the wire union
for the same reason.

| Reason code | CLI copy (en) | Canvas panel label | Emitted when |
|---|---|---|---|
| `supported_root_dag_bug_fix` | a flat root-DAG bug-fix shape the reconciler owns end to end | Supported: root-DAG bug-fix | v1, exact bug-fix shape, no v2 construct |
| `supported_v2_review_cycle` | a review-cycle loop the reconciler drives round by round | Supported: v2 ReviewCycle | v1 whose normalized form carries a ReviewCycle BoundedLoop (with or without a parallel group) |
| `supported_v2_executable` | a v2 definition whose Composite bodies and stages all resolve | Supported: v2 executable | v2-authored (a Custom Composite) |
| `supported_v2_parallel` | a parallel group the reconciler fans out and joins | Supported: v2 parallel (FanOut/Join) | v1 whose ONLY v2 construct is `parallelGroup` |
| `unsupported_definition_version` | the definition version is not one this engine compiles | Unsupported: definition version | **declared but never emitted** — see the note below |
| `unsupported_pipeline_shape` | some stage has no capability binding, so the run would stall mid-flight | Unsupported: pipeline shape | binding set does not equal the expected node-ID set (fail-closed) |
| `unsupported_pipeline_semantics` | the pipeline uses a stage kind or control flow this engine does not execute | Unsupported: pipeline semantics | non-standard stage kind, or a v2 definition whose capability executionMode is not `reconciler` |
| `execution_profile_unavailable` | the capability catalog could not be resolved for this pipeline | Unavailable: execution profile | no profile — at discovery, a capability the catalog does not carry |

`unsupported_definition_version` is in the union and reachable from no branch of
`analyzeReconcilerSupport`. Recorded as **declared-unreachable** rather than
deleted: removing a member of a wire-facing union is a compatibility decision,
not a cleanup, and it is the only reason whose copy is unexercised by production.

Human `pipeline show` now renders the analysis (it previously existed only in
`--json`):

```
$ node bin/rasen.js pipeline show bug-fix
...
Engine support:
  Engines: legacy, reconciler
  Reconciler: supported (supported_v2_review_cycle) — a review-cycle loop the reconciler drives round by round
  Policy: runs.engine=auto (from default) → starts on reconciler
```

### The defect the enumeration found (bigger than the table)

**No read plane could report ANY `supported_*` reason.** Both discovery call
sites passed `profile: null` to `analyzeReconcilerSupport`, which
short-circuits to `execution_profile_unavailable` before it looks at the
definition at all:

- `src/commands/pipeline.ts` — `pipeline show`
- `src/core/management-api/pipelines.ts` — `handlePipelineDetail`, which is what
  the Canvas `EngineSupportPanel` renders

So the panel shipped with copy for five verdicts it could never display, and
`executable-parallel-pipelines` scenario 1 — "`rasen pipeline show` SHALL report
`availableEngines` including `reconciler` with reason `supported_v2_parallel`"
— was **unsatisfiable in production** while its kernel-level sibling test
(`v1-parallel-only-lowering.test.ts`) passed. This is the portfolio's recurring
shape: shipped code behind a stale gate.

Closed by `resolveDiscoveryReconcilerSupportProfile` (`profile-resolver.ts`),
which resolves the SAME bindings through the SAME `resolveCapabilityBindings`
the launch profile uses — never a second implementation — reports the DISCOVERY
digest (unchanged from the synthetic marker the null path already used, so it
can never be mistaken for a frozen launch profile), and returns `null` when a
binding cannot resolve, which is the same fail-closed verdict as before.

Verification, by pipeline, real fresh-process CLI (`node bin/rasen.js pipeline show <name> --json`):

| Pipeline | before | after |
|---|---|---|
| `bug-fix` / `small-feature` / `full-feature` / all three goal loops | `execution_profile_unavailable` (unsupported) | `supported_v2_review_cycle` (supported) |
| a v1 `parallelGroup`-only pipeline | `execution_profile_unavailable` | `supported_v2_parallel` (supported) — **the spec sentence, now true** |
| a Canvas-authored Custom Composite | field absent entirely from `show`'s v2 branch | `supported_v2_executable` (supported) |
| `auto-decompose` | `execution_profile_unavailable` | `execution_profile_unavailable` — **unchanged and correct**: its decompose stage has no leaf capability, so discovery fails closed |

### The second defect, found while proving the first

The first attempt reported `unsupported_pipeline_shape` for **every** pipeline.
Cause: the three expected-node-ID comparisons in `analyzeReconcilerSupport`
compared `JSON.stringify` of the profile's node IDs against a **sorted**
expected set, and silently depended on the profile having been sorted by
`normalizeProfileInput` when it was sealed. A discovery profile has no sealing
pass, so its natural (definition) order produced a false NEGATIVE from ordering
alone. `supportProfileNodeIds` now sorts, making the analyzer independent of how
its input was built — the property those three comparisons always assumed.

Pinned by `test/core/change-run/engine-product-surface.test.ts` → "reports
supported for the natural order AND for a reversed one".

### Wire-mirror drift, found and closed

`packages/ui/src/api/types.ts`'s `ReconcilerSupportReason` had drifted from the
server union it claims to mirror in **both** directions: missing
`supported_v2_executable` (ECP-2) and `supported_v2_parallel` (ECP-4), and
carrying `unsupported_capability` and `unsupported_verify_policy`, which
`analyzeReconcilerSupport` has never emitted. Both halves were invisible while
every plane reported `execution_profile_unavailable`.

### The engine owner, rendered (task 6.2)

`ChangeRunView.engine` has been on the wire since ecp-run-spine and was rendered
by **no** plane — "one Run has one engine owner" was invisible to the one person
who has to act on it.

- CLI: `pipeline status` human output prints `Engine: <engine>`.
- Operations: the run-detail header renders it at
  `data-testid="ops-run-engine"`.

Verbatim in both: it is a server token all three planes print identically.
`packages/ui/test/components/cross-plane-parity.test.tsx` promised "without
deriving, transforming, or **omitting** any" and omitted exactly this field; it
now asserts it, and `operations-i18n.test.tsx` asserts zh-cn does NOT translate
it.

### Docs (tasks 6.3 / 6.4)

`docs/architecture/executable-composite-pipelines.md` was stale in **four**
places, not one: the status header, the RuntimePlan box in the §2 diagram, the
RuntimePlan and Reconciler rows of the §3 table, and the §9 scope list all still
said Composite/BoundedLoop/GoalLoop/FanOut/Join execution was rejected before
Run creation — four slices after it landed. All corrected, with the correction
**called out in the header** rather than silently rewritten. New §9 carries the
engine-selection policy, §9.1 the ownership guard, and §9.2 the five
legacy-retirement conditions (recorded, not enacted — the research doc makes
retirement a dogfood-driven decision, and it is the user's).

`docs/autopilot.md` gains §0 "Run engine" (the third policy axis, the only
always-resolved one), the engine row in the policy table, the Store layer in the
precedence sentence, and the run-state boundary. `docs/migration-guide.md` gains
"0.1.6: the reconciler engine owns Run progression", led by the ONE refusal an
upgrading user actually hits — `engine_owner_conflict` on `pipeline start` for a
change still holding pre-convergence run-state — and its two resolutions.

---

## Section 7 — Dogfood matrix (real fresh-process CLI, integrated HEAD)

**Build first** (task 7.1). Every cell below is a real `node dist/cli/index.js`
invocation against a freshly built `dist/`, in a throwaway project with an
isolated `XDG_DATA_HOME`. The stale-`dist` trap has produced false verdicts on
this project before; the global `rasen` binary points at a different checkout
and is never used here.

**Revision.** Every RunId below was produced at **`11ce4d69`** — the whole
matrix is anchored to one revision, re-run after the section-7 fixes rather than
carried over from earlier attempts. Four scripts, all `node <script>.mjs`
against the freshly built `dist/`:

| Script | Cells |
|---|---|
| `test/dogfood-ecp5-closure.mjs` (**new**) | A `small-feature` · B `goal-loop-evaluate` · C Canvas-authored composite · D converged Step E |
| `test/dogfood-goal-cycle.mjs` | the three goal pipelines, four scenarios |
| `test/dogfood-review-cycle.mjs` | `bug-fix` through the full ReviewCycle |
| `test/dogfood-full-feature.mjs` | `full-feature` success · optional-member failure · required-member failure · restart idempotency |

The new script is a sibling of the existing three and shares their conventions,
including effect observation applied directly to the record store (a
kernel-internal step with no CLI command).

### The matrix

| Pipeline | Provenance | RunId | Engine owner | Terminal | Evidence |
|---|---|---|---|---|---|
| `bug-fix` (ReviewCycle finding→fix→independent re-review) | built-in v1 | `run:b19dbb95d53084bc…` | reconciler | loop `clean`, ship admitted | `dogfood-review-cycle.mjs`. F1 (major) → triage → fix (`fixerA`) → **same-actor re-review REFUSED** → independent `verifierA` → `clean`; 3 distinct actor identityDigests. ECP-1's original evidence for this cell is `run:b23b2cce16d90495…` |
| `small-feature` | built-in v1 | `run:0c9d9cb29cf7795e…` | reconciler (`default`) | **`completed`** | **NEW** — task 7.4, scenario A. 9 actions; review-cycle round 1/3 `clean`, F1 (major) `resolved`; per-stage ActionIds in the script's dump |
| `goal-loop-measure` (satisfied) | built-in v1 | `run:c72075a3ca58bcef…` | reconciler | `satisfied` @ round 2 (score 90) | `dogfood-goal-cycle.mjs` scenario 1 |
| `goal-loop-measure` (exhausted) | built-in v1 | `run:ff989fea4cb212f5…` | reconciler | `escalated` / `exhausted` @ round 5 (score 35) | `dogfood-goal-cycle.mjs` scenario 2 |
| `goal-loop-evaluate` (loop only) | built-in v1 | `run:9fb8b770b6531587…` | reconciler | `satisfied` @ round 1 | `dogfood-goal-cycle.mjs` scenario 3 |
| `goal-loop-research` | built-in v1 | `run:ea8b5f3bf6459cd5…` | reconciler | `completed` (report tail) | `dogfood-goal-cycle.mjs` scenario 4 |
| `goal-loop-evaluate` (whole pipeline) | built-in v1 | `run:25d59a28f2ef44a7…` | reconciler (`default`) | **`completed`** | **NEW** — task 7.5, scenario B. define-goal → work → evaluate judge (`satisfied`, `gaps: []`, one rubric criterion) → ship → retain → archive. The pre-existing scenario 3 above stops at the loop's own termination; this one carries the Run to a terminal |
| `full-feature` (Choice/FanOut/Join + review loop) | built-in v1 | `run:c8474be7bcb69522…` | reconciler | **`completed`**, terminal `full-feature-completed` | `dogfood-full-feature.mjs` scenario A; `pipeline status` during the FanOut phase captured (ECP-4 task 13.5) |
| `full-feature` (optional member fails) | built-in v1 | `run:cca8a3c49600980a…` | reconciler | join `proceeding`, Run continues | `dogfood-full-feature.mjs` scenario B1 — an optional member's failure is suppressed |
| `full-feature` (required member fails) | built-in v1 | `run:28d29eddc30ed5c1…` | reconciler | **`escalated`**, terminal `experts-failed` | `dogfood-full-feature.mjs` scenario B2 — the Join refuses to proceed and the Run never reaches the review loop |
| `ecp5-canvas-composite` | **Canvas-authored v2** | `run:3c50063bea7fed8e…` | reconciler (`default`) | **`completed`** | **NEW** — task 7.6, scenario C. See "the Canvas-authored cell" below |
| `small-feature` via the converged Step E protocol | built-in v1 | `run:0ad1efbe057dcfac…` | reconciler | **`completed`** | **NEW** — task 7.7, scenario D. 10 `resume-run` cycles, 9 `review-cycle` section reads, full transcript in the script's dump |

### Task 7.6 — the Canvas-authored cell, and what ECP-2's evidence actually was

Task 7.6 says to read ECP-2's recorded evidence first. **It was programmatic and
in-process.** ECP-2's task 14.1 permitted "author … in the Canvas (**or
construct programmatically**)", and its dogfood — commit `c6aa7026`,
`test/core/change-run/ecp-composite-dogfood.test.ts` — is a facade-level test
over a hand-written `DefinitionSourceV2` literal and an in-memory store. Its own
commit message says so: "Add facade-level dogfood test proving the full layer
chain … Success path (stage A admitted on start) and recovery path (resume after
start with A still active)". No real CLI process, no Canvas.

That is not a criticism of ECP-2's choice — until commit `b5e9fcd0` (this
change, task 5A) the Canvas had **no affordance to create a declaration at
all**, so the option its task offered was unreachable. The §15.4 condition
"at least one **Canvas-authored** Custom Composite completes a real Run"
therefore had no evidence, and could not have had any.

The cell is now produced end to end:

1. `packages/ui/test/canvas/canvas-authored-composite-export.test.tsx` mounts the
   **real** `PipelineCanvasPage` over an EMPTY v2 definition (zero declarations,
   zero root nodes — nothing can be inherited from a fixture that already looks
   like the answer), drives the real affordances (create declaration → two body
   stages from the constrained body palette → reference it from the root via
   `CompositeRef`), clicks Save, and captures **what the Canvas POSTs**.
2. The catalog the Canvas is served is the machine's real production capability
   catalog (`skill:rasen-apply-change` at its content digest), read by the
   dogfood script from `freezeProductionPreparedPipelineRegistry` — the same
   values the server's catalog endpoint serves in production.
3. That POSTed definition is installed through the real CLI
   (`rasen pipeline save ecp5-canvas-composite --from <export> --json`).
4. `rasen pipeline show --json` reports
   `{"supported":true,"reason":"supported_v2_executable","profileDigest":"sha256:e0d7168bdb248980…"}`
   — a verdict that was itself unreachable before section 6.
5. `rasen pipeline start` → both body stages admitted
   (`root:composite-ref/stage-2`, `root:composite-ref/stage`) → **`completed`**
   (`run:3c50063bea7fed8e…`).

The authored definition is reproduced verbatim in the scenario-C dump of
`node test/dogfood-ecp5-closure.mjs`.

### Task 7.7 — the converged Step E protocol, and the two defects it found

Scenario D drives `small-feature` exactly as the converged playbook prescribes:
read the resolved engine from `pipeline show --json`
(`Engine: reconciler (default)  support=supported_v2_review_cycle`), launch one
canonical Run, then loop `pipeline resume-run` → dispatch one role-isolated
worker per granted action → `pipeline complete` → read the `review-cycle`
section. Nine section reads track `phase: review → triage → fix → re-review` and
`outcome: null → clean`, `openFindings 0 → 1 → 0`, and the Run reaches
`completed`.

Following the playbook literally is what surfaced two real defects:

1. **The playbook named a flag that does not exist.** Step E.1 said
   `rasen pipeline complete <change> --action-id <id> --json`. There is no
   `--action-id` option — `complete` takes `--run <runId> --from <body>`, with
   the `actionId` inside the completion. A LEAD following the converged path
   literally fails at step 3. The same phantom invocation was in ECP-1's
   `rasen-review-cycle` skill template (`review-cycle.ts`), so it predates this
   slice. Both corrected; guarded by `orchestration-bundles.test.ts` → "names
   commands that actually exist on the CLI", whose own prior assertion had
   asserted the phantom flag.

2. **`pipeline complete` dropped the actions it granted.** Under
   `deliveryMode: 'grant'` the facade settles to quiescence and grants the next
   ready actions — but the CLI receipt printed only `runId`/`disposition`/
   `status`, unlike `start` and `resume-run`, which both report `actions`. The
   consequence is exactly the loop Step E describes: `complete` swallowed the
   grant, and the `resume-run` that follows it correctly reported **zero**
   (nothing was left ungranted), so a LEAD reading receipts saw no next action
   and could read the Run as finished. Fixed in `src/commands/pipeline.ts`;
   the transcript went from "receipt granted 0 next action(s)" at every step to
   "granted 1". Guarded by `test/commands/pipeline-bugfix-e2e.test.ts` (the
   field must exist — it was absent entirely before).

   The playbook now also states plainly that `resume-run` is the RECOVERY seam
   and an empty `actions` there means "nothing outstanding", never "finished",
   and that `status`'s `root-dag` section lists every `actionId` with its
   `deliveryState` — so `status` alone is always sufficient.

### Task 7.8 — named crash-recovery and parity suites, on the integrated HEAD

| Suite | Tests |
|---|---|
| `test/core/change-run/fault-journeys.test.ts` | 50 passed |
| `test/core/change-run/archive-recreate-journeys.test.ts` | 13 passed |
| `test/core/change-run/ack-loss-journeys.test.ts` | 12 passed |
| `test/core/change-run/cross-plane-parity.test.ts` | 2 passed |
| `test/core/change-run/review-cycle-parity.test.ts` | 2 passed |
| `test/core/change-run/ecp-composite-parity.test.ts` | 5 passed |
| `test/core/change-run/projector-parallel-choice.test.ts` | 11 passed |
| `test/core/change-run/ui-constants-provenance.test.ts` | 7 passed |
| **root subtotal** | **8 files / 102 passed / 0 failed** |
| `packages/ui/test/components/cross-plane-parity.test.tsx` | 2 passed |
| `packages/ui/test/components/ecp4-parallel-choice-parity.test.tsx` | 11 passed |
| `packages/ui/test/components/review-cycle-operations-parity.test.tsx` | 9 passed |
| **UI subtotal** | **3 files / 22 passed / 0 failed** |

---

## Section 8 — Exit-conditions evidence ledger (research doc §15.4)

All **14** conditions of `deterministic-pipeline-kernel-research.md` §15.4
(lines 1828–1847), quoted verbatim in the original Chinese, each with at least
one concrete pointer. **No condition is marked satisfied without one.**

| # | Exit condition (verbatim, §15.4) | Verdict | Evidence |
|---|---|---|---|
| 1 | v1 定义兼容读取/编译，v2 definition 经 Canvas save/detail/export round-trip 后语义不变 | **MET** | v1 read/compile: `test/core/change-run/lowerer.test.ts`; `test/core/pipeline-registry/v1-parallel-only-lowering.test.ts` (v1 parallel-only now compiles through the same v2 path — ECP-5 §2). v2 round-trip: `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` → "creates a declaration, references it from the root, and saves the round-trip" (asserted on the POSTed definition, not the DOM). End-to-end, through the real save path: dogfood scenario C — Canvas POST → `pipeline save` → `pipeline show` (`supported_v2_executable`) → Run `run:f1304f3da73f5ecc…` `completed`, i.e. the saved definition kept its semantics all the way to execution |
| 2 | Canvas 可以创建、引用、展开和校验受约束 Custom Composite | **MET** | Create + reference: `packages/ui/src/canvas/DeclarationsPanel.tsx`, commit `b5e9fcd0` (ECP-5 task 5A) — before it, `addDeclaration`/`removeDeclaration`/`addBodyStage` had **zero callers in `packages/ui/src`** and ECP-2 tasks 8.5/8.6 were false ticks, now annotated. Constrained: `V2_BODY_PALETTE_KINDS` (`draft.ts`) is `AtomicStage` only; `pipeline-canvas-page.test.tsx` asserts all five forbidden kinds absent. Expand (drill-down): ECP-2 commit `95bd1c53` composite-body progress projection. Validate: ECP-2 task 7.1 prepare-time validators (recursion, nested loop, cycle, missing exit, port mismatch, capability missing). Real: scenario C |
| 3 | `bug-fix`、`small-feature`、三个 goal pipelines、`full-feature` 与至少一个 Canvas-authored Custom Composite 均可完成真实 Run | **MET** | The dogfood matrix above — twelve cells, every RunId produced at `11ce4d69`. The three cells that had no real Run before this slice (`small-feature`, a whole-pipeline `goal-loop-evaluate`, a Canvas-authored composite) are `run:0c9d9cb2…`, `run:25d59a28…`, `run:3c50063b…` |
| 4 | 同一 immutable plan + committed record 始终得到同一 next action | **MET** | `test/core/change-run/reconciler.test.ts` → describe "reconcile determinism (5.1)" (shuffled insertion order, poisoned clock/random/env/filesystem, replay). `fault-journeys.test.ts` → "different launch keys produce distinct deterministic RunIds (no global key index)" and the launch-binding immutability case. `ecp-composite-parity.test.ts` extends it across composite invocation |
| 5 | root stage 与 Composite invocation 的 crash-before/after-commit 故障注入均可恢复 | **MET** | `fault-journeys.test.ts` 50/50 — pre-publish, after-stage-before-fsync, after-fsync-before-publish, post-publish, O_EXCL race, post-commit/pre-projection, conflicting receipt, corrupt/gapped/duplicate revision fail-closed. `ack-loss-journeys.test.ts` 12/12. `archive-recreate-journeys.test.ts` 13/13. Composite invocation specifically: `ecp-composite-dogfood.test.ts` recovery path (resume after start with the body stage still active) |
| 6 | ReviewCycle 至少真实经历一次 finding -> fix -> independent re-review | **MET** | `run:b19dbb95d53084bc…` at this HEAD: F1 (major) → triage `fix_inline` → fix by `fixerA` → same-actor re-review **refused** ("The fixer cannot verify their own ReviewCycle fix.") → independent `verifierA` → `clean`; three distinct actor identityDigests. ECP-1's original run was `run:b23b2cce16d90495…`. Reproduced twice more here: scenarios A (`run:0c9d9cb2…`) and D (`run:0ad1efbe…`), each with four distinct phase actors |
| 7 | GoalLoopMeasure 与 GoalLoopEvaluate 都完成真实迭代并证明公共 loop lifecycle | **MET** | Measure: `run:c72075a3…` (fail round 1 → pass round 2 → `satisfied`) and `run:ff989fea…` (5 rounds → `exhausted`/`escalated`). Evaluate: `run:9fb8b770…` (loop `satisfied`) and `run:25d59a28…` — work → evaluate judge (`satisfied`, `gaps: []`) → ship → retain → archive → `completed`. Same loop lifecycle both variants: same `goal` section, same phase actor separation (the dogfood's first attempt was **rejected** with "The worker cannot judge their own GoalCycle work" — the shared guarantee firing) |
| 8 | open Major 永远不能进入 ship | **MET** | `test/core/change-run/review-cycle.test.ts` and `review-cycle-runtime.test.ts` (`assertReviewCycleMayShip`); `facade-settle-completeness.test.ts` (settle cannot declare clean with an open Blocker/Major). Kernel-anchored in the UI too: `ui-constants-provenance.test.ts` → "the escalated fixture really is the kernel refusing to call an open Major clean" |
| 9 | 所有完成判断绑定 actor、tree、delta/result 和 evidence | **MET** | `test/core/change-run/completion.test.ts` + `cli-complete.test.ts` (strict `change-run-completion/1` decode; unknown fields, missing fields, orphaned uploads, digest mismatch, symlink body, oversize body all rejected before the facade). The fix-result contract carries `beforeTree`/`afterTree`/`delta`/`tests`; every dogfood completion in this slice carries actor + attestation + evidence refs, and the CLI rejects any that does not |
| 10 | `rasen-auto`、`rasen-goal`、`rasen-review-cycle` 不再拥有独立机械推进规则 | **MET** | `test/core/templates/orchestration-bundles.test.ts` → "deletes the prompt-owned duplicates of kernel-enforced rules" (`grep -c "Default cap: 3" _orchestration.ts` → 0) and the four "do not …" assertions on the reconciler branch, each with named replacement evidence (§3 table above). `rasen-goal` converged in ECP-3 (task 9.4 evidence, §3); `rasen-review-cycle` in ECP-1; `rasen-auto` in this slice. Proven end to end by scenario D driving the whole pipeline through the canonical Run |
| 11 | 一个 Run 只存在一个 engine owner 和一个 canonical state | **MET** | The **wiring**, commit `2fa693d8` — not the assertion's existence. `assertSingleEngineOwner` shipped in ecp-run-spine with unit tests and **zero production callers**; until `2fa693d8` the guarantee was dead code and `test/core/change-run/engine-ownership.test.ts` proved only that a pure function computes. Now: `grep -rn "assertSingleEngineOwner\|classifyEngineOwnership" src/` → 5 hits in `src/commands/pipeline.ts` (launch seam + mutation seams) beside the 3 in the definition. Behavioural evidence: `test/core/change-run/engine-ownership-wiring.test.ts` — engine-less run-state beside a Record refuses `start`/`resume-run`/`complete`/`control` with both artifacts **byte-identical after every refusal**; declared `engine: reconciler` bookkeeping does not conflict; `goal-run.json` never counts; unparseable run-state fails closed; ownership is instance-scoped across archive + same-name recreate. Visible at last: `Engine:` in `pipeline status` and the Operations header (task 6.2) |
| 12 | Canvas declaration、compiled plan、runtime behavior 与 Operations projection 通过端到端 parity 验证 | **MET** | The chain, in one run: scenario C takes a Canvas declaration → `pipeline save` → prepared plan → real Run → `pipeline status` projection. Plane-to-plane: `test/core/change-run/cross-plane-parity.test.ts` (2), `review-cycle-parity.test.ts` (2), `ecp-composite-parity.test.ts` (5), `projector-parallel-choice.test.ts` (11). Plane-to-**kernel**: `ui-constants-provenance.test.ts` (7) deep-equals every shared UI constant against the real projector's output, and the UI parity suites import that same module — drift is a test failure, not a reviewer probe |
| 13 | Operations 能准确显示和安全控制 root/composite frontier、round/phase、wait/escalation 与 evidence | **MET** | Display: `OperationsSection.tsx` renders root-dag frontier/invocations/actions/waits, the review-cycle section (round/maxRounds/phase/outcome/findings/actors/waitReason — commit `0bd68293`, closing ECP-1's zero-consumer `getReviewCycleSection`), ECP-4's parallel/choice sections, and now the engine owner. Safe control: `packages/ui/test/components/operations-controls.test.tsx` → one interactive control per submittable `allowedControl`, decision submitted with the exact `recordVersion` + `waitId` + `decisionId` + outcome, and **no arbitrary-completion form** (agent/command/host completion stays a trusted CLI seam). Localized in en/ja/zh-cn with server tokens rendered verbatim (`d36a41f5`, `operations-i18n.test.tsx`) |
| 14 | legacy Run 可继续恢复，reconciler engine 可显式关闭，兼容投影不会成为第二份真相 | **MET** | Legacy recovery: `test/core/change-run/engine-selection-policy.test.ts` → "leaves a legacy-run-state change on the legacy resume path under any policy" (real CLI: `runs.engine: legacy` + legacy `auto-run.json` → `pipeline resume` still reports `hasRunState: true`); `engine-ownership-wiring.test.ts` → engine-less run-state alone leaves the legacy resume path untouched. Explicit off-switch: same file → configured `legacy` refuses with `engine_disabled_by_config` naming the deciding layer and **zero Run Records on disk before and after**. Projections are not a second truth: design D3 + playbook Step F (`orchestration-bundles.test.ts` → "bounds reconciler-engine run-state to bookkeeping and labeled projections"), ECP-3 task 9.4 grep evidence (§3), and D8's rule that `goal-run.json` and reports are **never** ownership inputs (`engine-ownership-wiring.test.ts` → "never treats a derived goal-run.json as an ownership signal") |

**14 of 14 evidenced. 0 OPEN.**

Two things this table deliberately does NOT claim:

- Condition 11's evidence is the **wiring commit plus the wiring test**, not the
  assertion's existence. Citing `engine-ownership.test.ts` alone would have been
  a seventh false tick in this portfolio: that file passed for the entire period
  in which the guard had no production caller.
- The `bug-fix` and `full-feature` rows carry RunIds produced **here**, at
  `11ce4d69`, rather than ECP-1's and ECP-4's originals. Citing a sibling's
  RunId would have evidenced that slice's tree, not the integrated one; the
  originals are named beside the new ones so provenance is not lost.

### Task 8.2 — Slice E closure list (research doc §11, lines 1477–1487)

| Slice E item | Disposition |
|---|---|
| v1 read/compile compatibility 与 v2 save/export/round-trip | **Done** — exit condition 1 |
| built-in Composite 与 Custom Composite 使用完全相同的 compiler/runtime contract | **Done** — one `EcpDefinitionModule.prepare` → one lowerer → one reconciler for both; `ecp-composite-parity.test.ts` (5), `lowerer-composite.test.ts`, and scenario C's Canvas composite running on the same `pipeline start` seam as `bug-fix` |
| Canvas 覆盖全部首版 node、Composite、BoundedLoop、limits/exits/outcome ports | **Done with a residual.** Root palette + declaration editor cover AtomicStage/Gate/Choice/Finish/CompositeRef/BoundedLoop (`V2_ROOT_PALETTE_KINDS`, `V2_BODY_PALETTE_KINDS`, `b5e9fcd0`). **Residual, recorded not fixed:** ECP-4's `FanOut`/`Join` panels are read-only by design, and its shipped scenario calls their cap/budget "configurable scalars" while they render as `<output>`. Adjudicated at task 5.1 (commit `bb448317`): making them editable would contradict the display-only authoring boundary the same delta sets. Left for a deliberate ECP-6 decision, not silently ticked |
| Operations 覆盖 Run timeline、frontier、round/phase、evidence、wait/escalation 与安全控制 | **Done** — exit condition 13 |
| `rasen-auto`、`rasen-goal`、`rasen-review-cycle` 完成薄入口收敛 | **Done** — exit condition 10; the last of the three (`rasen-auto`) in this slice |
| 用户文档、迁移说明、preview/fallback/engine ownership 说明 | **Done** — tasks 6.3/6.4 |
| built-in 与 Custom Composite 的端到端 dogfood | **Done** — the matrix; the Custom Composite cell is Canvas-authored for the first time |
| legacy engine 的清退条件被记录，但是否立即默认关闭由 dogfood 证据决定 | **Done as recording only** — `docs/architecture/executable-composite-pipelines.md` §9.2 lists five conditions. **Not enacted**: `runs.engine` still defaults to `auto`, and retirement is the user's call |

### Task 8.3 — the anti-false-tick grep sweep

Every grep-falsifiable claim in sections 1–6, re-run in one pass at
`11ce4d69`. Command outputs verbatim:

```
$ grep -c "runs.engine" src/core/config-keys.ts src/core/config-schema.ts
src/core/config-keys.ts:1
src/core/config-schema.ts:1

$ grep -rn "assertSingleEngineOwner\|classifyEngineOwnership" src/ | cut -d: -f1 | sort | uniq -c
      5 src/commands/pipeline.ts                              <- launch + mutation seams
      3 src/core/change-run/internal/engine-ownership.ts      <- definition
      1 src/core/project-config.ts

$ grep -rl "definitionRequiresV2Lowering" src/
src/core/change-run/internal/lowerer.ts
src/core/pipeline-registry/definition.ts
src/core/pipeline-registry/execution-plan-internal.ts
src/core/pipeline-registry/profile-resolver.ts

$ grep -c "const requiresV2Lowering" src/core/change-run/internal/lowerer.ts
0

$ grep -c "Default cap: 3" src/core/templates/workflows/_orchestration.ts
0

$ grep -rl "getReviewCycleSection" packages/ui/src
packages/ui/src/api/types.ts
packages/ui/src/components/OperationsSection.tsx           <- the consumer ECP-1 promised

$ grep -rn "resolveDiscoveryReconcilerSupportProfile" src/ | cut -d: -f1 | sort | uniq -c
      3 src/commands/pipeline.ts
      2 src/core/management-api/pipelines.ts
      1 src/core/pipeline-registry/execution-plan-internal.ts
      1 src/core/pipeline-registry/profile-resolver.ts

$ grep -c 'Engine: ${v.engine}' src/commands/pipeline.ts
1
$ grep -c "ops-run-engine" packages/ui/src/components/OperationsSection.tsx
1

$ node -e "for (const l of ['en','ja','zh-cn']) { … engineReason* keys … }"
en 8
ja 8
zh-cn 8                                <- all 8 emitted reasons, all 3 locales

$ grep -rl "V2_BODY_PALETTE_KINDS" packages/ui/src
packages/ui/src/canvas/DeclarationsPanel.tsx
packages/ui/src/canvas/draft.ts

$ grep -c "action-id" src/core/templates/workflows/_orchestration.ts src/core/templates/workflows/review-cycle.ts
src/core/templates/workflows/_orchestration.ts:0
src/core/templates/workflows/review-cycle.ts:0            <- the phantom flag, gone from both
```

---

## Section 9 — Release checks on the integrated HEAD (discharges ECP-3 13.1–13.4)

All at `11ce4d69`, natively on Windows 11 (`win32`, Node 24.14.0) — which is
what makes this also the cross-platform evidence, not a separate exercise.

| Check | Result |
|---|---|
| `pnpm build` | clean |
| root `npx tsc --noEmit` | **0 errors** |
| `packages/ui` `npx tsc --noEmit` | **0 errors** |
| root `npx vitest run` | **393 files · 6357 passed · 6 failed · 33 skipped** — every failure attributed below |
| `packages/ui` `npx vitest run` | **56 files · 592 passed · 0 failed** |
| `pnpm lint` (`eslint src/ test/ vitest.config.ts vitest.setup.ts`) | **0 errors**, 1 pre-existing warning |
| `node scripts/release-contract.mjs` | `verified lockstep release contract 0.1.5` |
| `node scripts/pack-version-check.mjs` | `pack-version-check: OK` |
| `node scripts/paired-pack-check.mjs` | `verified paired CLI/UI packages 0.1.5` |

### The 6 root failures, enumerated per file with attribution

Never extrapolated from a truncated tail — the full log was captured to a file
and the FAIL lines enumerated from it. Each suspect was then re-run **in
isolation** before being called a flake.

| File | Tests | Isolated re-run | Attribution |
|---|---|---|---|
| `test/commands/context.test.ts` | 1 | **passes** | Windows CLI-spawn flake: 30s timeout + `EPERM` on temp cleanup |
| `test/commands/pipeline.test.ts` | 1 ("localizes representative 'en' paths across all ten subcommands") | **passes** (97/97) | Windows CLI-spawn flake: 60s timeout + `EBUSY: rmdir test-pipeline-command-tmp`. Re-run because this file is one **this change edits** — the flake had to be ruled out, not assumed |
| `test/commands/store-membership-cli.test.ts` | 2 | **passes** | Windows CLI-spawn flake: 30s timeout + `EPERM` on temp cleanup |
| `test/core/completions/command-registry.test.ts` | 1 | **fails** | **REAL, and fixed here.** `--engine` shipped on `pipeline start` in section 1 without its completion-registry entry; the test diffs the registry against Commander's real option list and caught it. Fixing it exposed a second gap — the flag description had no locale entry — so the registry entry and en/ja/zh-cn descriptions both landed. Now 10 files / 308 passed |
| `test/core/token-audit/zed/audit.test.ts` | 1 ("errors when the default database location is absent and no `--db` is given") | **fails** | **PRE-EXISTING and unrelated.** Verified by checking out `test/core/token-audit/` at `2fcd5438` (the ECP-4 tip, before this change) and re-running: it fails identically. Environment-dependent — this machine has a Zed database at the default location, so the test's "absent" precondition does not hold. Not touched by ECP-5 and not fixed here |

The lint warning is `test/core/change-run/facade-settle-completeness.test.ts:139`
— "Unused eslint-disable directive", introduced by `27faedd3`
(`ecp-settle-completeness`), not by this change. Reported rather than
opportunistically fixed: it is another change's file and another change's line.

### The invalidated first attempt, recorded rather than deleted

The first full-suite run reported **235 failed / 36 files**. That run is
**invalid** and its numbers appear nowhere above. Cause: `pack-version-check.mjs`
and `paired-pack-check.mjs` were run concurrently with it, and both **remove and
rebuild `dist/`** — while several hundred tests spawn `node dist/cli/index.js`.
Recorded because the failure mode is worth knowing: on this repo the release
checks are not safe to run beside the suite, and a catastrophic-looking FAIL
count from a concurrent run is a tooling artifact, not a regression. The clean
re-run above followed a fresh `pnpm build` with nothing else touching `dist/`.

### Versions (task 9.5)

In-repo versions stay **0.1.5** — CLI `package.json`, `packages/ui/package.json`,
and the release contract all agree, and all three lockstep checks pass at that
version. The **0.1.6 bump is the user's release-time action**; this change
verifies the contract and does not perform it.

### ECP-3 tasks 13.1–13.4 (task 9.4)

Discharged here and annotated in `rasen/changes/ecp-goal-loop/tasks.md` with a
pointer to this section — never a bare tick. ECP-3 could not have run these more
meaningfully than the final slice can: they are full-suite / tsc / lint /
cross-platform checks, and only the integrated HEAD has all seven slices in it.

### Stray artifacts (task 9.6)

- `git status` carries only this change's intended files.
- `packages/ui/package-lock.json` remains **untracked and untouched** (user-parked).
- Sibling change directories are edited only by the annotation tasks: ECP-2's
  `tasks.md` (5A.5), ECP-3's `tasks.md` (3.8, 3.9, 9.4). No other
  `rasen/changes/ecp-*` file is modified.
- `pack-version-check.mjs` leaves an `atelierai-rasen-0.1.5.tgz` in the repo
  root; it is `.gitignore`d and was deleted after the check.
- Dogfood temp directories (`test-dogfood-*`, `test-engine-*`) are removed by
  the scripts themselves and verified absent.
