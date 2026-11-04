# ECP-5 `ecp-product-closure` — evidence ledger

> Direction reconciliation（2026-08-01）：**partial**。下方 ledger 准确记录了
> 当时 implementation portfolio 的测试、dogfood 和 review 证据，但不能覆盖其自身
> 记录的 FanOut/Join 只读 residual，也不能证明 v2 默认创作、完整公共 loop policy、
> 独立 Session executor、后续真实 Change 自宿主和当前 HEAD 发布审查。剩余验收已
> 进入 Roadmap ECP-6..8；历史 evidence 不改写。

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

**Revision.** Every RunId below was produced at **`3b33d5be`** — the whole
matrix is anchored to one revision. It has been re-run in full **twice**: once
after the section-7 fixes, and again after `3b33d5be` fixed the Blocker that
task 7.6 found (below). Re-running everything rather than patching the one
changed cell is the point: a matrix whose rows come from different trees is not
a matrix, and the header would be false as written. Four scripts, all `node <script>.mjs`
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
| `bug-fix` (ReviewCycle finding→fix→independent re-review) | built-in v1 | `run:dbbd559244c6bad3…` [^rc] | reconciler | loop `clean`, ship admitted | `dogfood-review-cycle.mjs`. F1 (major) → triage → fix (`fixerA`) → **same-actor re-review REFUSED** → independent `verifierA` → `clean`; 3 distinct actor identityDigests. ECP-1's original evidence for this cell is `run:b23b2cce16d90495…` |
| `small-feature` | built-in v1 | `run:308c9ca2d42f576a…` | reconciler (`default`) | **`completed`** | **NEW** — task 7.4, scenario A. 9 actions; review-cycle round 1/3 `clean`, F1 (major) `resolved`; per-stage ActionIds in the script's dump |
| `goal-loop-measure` (satisfied) | built-in v1 | `run:81b0934e9137dc65…` | reconciler | `satisfied` @ round 2 (score 90) | `dogfood-goal-cycle.mjs` scenario 1 |
| `goal-loop-measure` (exhausted) | built-in v1 | `run:163d87c69b3c4c33…` | reconciler | `escalated` / `exhausted` @ round 5 (score 35) | `dogfood-goal-cycle.mjs` scenario 2 |
| `goal-loop-evaluate` (loop only) | built-in v1 | `run:1b8e7a48276711b5…` | reconciler | `satisfied` @ round 1 | `dogfood-goal-cycle.mjs` scenario 3 |
| `goal-loop-research` | built-in v1 | `run:c3583225fa8b5b8f…` | reconciler | `completed` (report tail) | `dogfood-goal-cycle.mjs` scenario 4 |
| `goal-loop-evaluate` (whole pipeline) | built-in v1 | `run:92156d532e5c2762…` | reconciler (`default`) | **`completed`** | **NEW** — task 7.5, scenario B. define-goal → work → evaluate judge (`satisfied`, `gaps: []`, one rubric criterion) → ship → retain → archive. The pre-existing scenario 3 above stops at the loop's own termination; this one carries the Run to a terminal |
| `full-feature` (Choice/FanOut/Join + review loop) | built-in v1 | `run:1b411c04dac999a7…` | reconciler | **`completed`**, terminal `full-feature-completed` | `dogfood-full-feature.mjs` scenario A; `pipeline status` during the FanOut phase captured (ECP-4 task 13.5) |
| `full-feature` (optional member fails) | built-in v1 | `run:bfcff510425f9f3a…` | reconciler | join `proceeding`, Run continues | `dogfood-full-feature.mjs` scenario B1 — an optional member's failure is suppressed |
| `full-feature` (required member fails) | built-in v1 | `run:aca40facf224bc24…` | reconciler | **`escalated`**, terminal `experts-failed` | `dogfood-full-feature.mjs` scenario B2 — the Join refuses to proceed and the Run never reaches the review loop |
| `ecp5-canvas-composite` | **Canvas-authored v2, CONNECTED body** | `run:07ef84266520254b…` | reconciler (`default`) | **`completed`** | **NEW** — task 7.6, scenario C. Two body stages in a **sequential** chain, authored through the Canvas. See "the Canvas-authored cell" below |
| `small-feature` via the converged Step E protocol | built-in v1 | `run:fbcebfe852884e77…` | reconciler | **`completed`** | **NEW** — task 7.7, scenario D. 10 `resume-run` cycles, 9 `review-cycle` section reads, full transcript in the script's dump |

[^rc]: **Exact-tree provenance — the caveat is now moot, kept as provenance.**
At the previous revision this cell was `run:b19dbb95…`, from the **second**
invocation of `dogfood-review-cycle.mjs`; the first, `run:19ec03cd…`, was
discarded because the script printed a spurious WARNING on a *passing*
guarantee — it asserted the raw `actor_separation` token, which the CLI stopped
emitting once the refusal became a localized product message. That assertion fix
was **uncommitted** when `b19dbb95` was produced, so "produced at `11ce4d69`" was
true of the repo HEAD and not of the exact working tree. **That no longer
applies**: the fix landed in `50e80bd9`, and the current cell
(`run:dbbd559244c6bad3…`) came from a clean tree at `3b33d5be` with the script
already committed. Kept because a ledger that silently deletes a caveat once it
stops applying teaches its readers that caveats disappear on their own.

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
5. `rasen pipeline start` → **`completed`** (`run:07ef84266520254b…`).

#### The cell asserts ORDERING, not stage count — and why that distinction is the whole cell

A two-stage body with no edge between the stages is a **different pipeline**:
the reconciler admits disconnected stages **concurrently**. So "the body has two
stages" is equally true of correct authoring and of the broken kind, and
evidences neither. Sequential-versus-fan-out is the only observable that
separates them, and this cell asserts it twice:

| # | Assertion | Result at `3b33d5be` |
|---|---|---|
| 1 | **Structural** — the persisted plan carries the dependency | `stage-2.requires = [node:6c2817dc…]` (the `stage` node), `stage.requires = []`. Directional, not merely non-empty: `firstRequiresSecond: false` |
| 2 | **Behavioural** — the reconciler's own answer | `first frontier: ["root:composite-ref/stage"]` — **exactly one** action, read BEFORE any completion |
| 3 | **The falsifying contrast** | The pre-fix cell (`run:3c50063b…`, disconnected body) put **both** stages on the first frontier and completed them back to back. Same stage count, different pipeline |

Assertion 2 is the one that settles it. Assertion 1 reads the artifact; assertion
2 is what the engine actually did with it, and it is the assertion that would
have caught the disconnected body even if the plan had looked right.

The authored edge, verbatim from the Canvas's own save POST:

```json
{ "id": "stage:done->stage-2:input",
  "from": { "node": "stage", "port": "done" },
  "to":   { "node": "stage-2", "port": "input" } }
```

#### What this cell cost, and what it found

The first attempt at it **failed**, and the failure was the point. `pipeline
save` refused the Canvas's own output:

```
PORT_MISMATCH  /declarations/0/graph/connections/0/to/port:
Node 'stage-2' has no declared input port 'input'.
```

Root cause: `contractForNode` built an AtomicStage's input map from
`portMap(descriptor.inputs)`, and **none of the 42 production capability
descriptors declares any input** — the synthetic control contract fired only for
a *missing* descriptor at `version: 'legacy'`, i.e. the v1-normalization path.
So no Canvas-authored connection into an AtomicStage backed by a real capability
could ever save, and renaming the port would not have helped, because a found
descriptor yields an empty input map for **any** port name. The root connector
was affected identically — this was never an F1 regression, but a pre-existing
hole that F1's new affordance made reachable in a second place.

Fixed in `3b33d5be` by admitting the shared `CONTROL_INPUT_PORTS`
(`['input','in','start']`) for a found descriptor that declares no typed inputs
— the closed set Choice, Gate, FanOut and Finish already accepted, of which the
AtomicStage legacy branch's `'start'`-only was the narrower outlier. Scoped so a
descriptor that *does* declare typed ports keeps exactly those, and `'inpt'`
still fails `PORT_MISMATCH`.

**The cell could have been made green without the fix**, by feeding the Canvas a
fabricated catalog entry with declared ports — as ECP-2's and F1's own fixtures
do, which is why the hole survived them. That would have produced passing
evidence for something the product cannot do. The red reproduction was kept
instead and became the fix's acceptance test.

#### The cycle probe — what it demonstrates, stated exactly

Authoring the closing edge `stage-2 → stage` through the same affordance is
**refused by the Canvas**: the model throws, the panel surfaces the diagnostic
(`pipeline-canvas-toast`, text containing `cycle`), and the graph is unchanged —
still exactly one connection. The probe asserts **no toast was showing
beforehand**, without which a leftover toast from an earlier action would let it
pass while the refusal never happened.

**What this claims, precisely: the Canvas refuses to author a cycle.** It does
**not** demonstrate that the server's cycle validator is reachable — F1 puts the
rule in the model, so a cyclic body cannot get past the Canvas to find out. Those
are different sentences and the difference is the point of the probe.

The server-side backstop is separate and already proven:
`test/core/change-run/ecp-composite-validation.test.ts:178` → "rejects cyclic
body connection with `GRAPH_CYCLE`", on a body graph with `a→b` and `b→a` behind
a `CompositeRef`, via `tryPrepare`.

**Together they cover every input path — by composing two proven links, not by
one end-to-end test:**

1. ECP-2's test proves *prepare refuses a cyclic body*, on a programmatically
   built definition.
2. This cell's success path proves *a Canvas definition saved through
   `pipeline save` reaches prepare* — `pipeline show` reports a real support
   verdict afterwards, which is only computable if prepare ran.

So "a cyclic body arriving through save is refused" follows from (1) and (2). The
composition is sound because both links sit on the same call path and prepare's
validator set is not conditional on the caller — stated so a reader can check the
composition rather than take it. It is a composition; it is not a direct
end-to-end proof, and this ledger does not claim one.

No complementary check was added. A third test would reach the same validator
through a third door and cover nothing.

#### `profileDigest` changed, and that is correct

`sha256:e0d7168b…` → **`sha256:de2b441d5d61d55b…`**. A connected body is a
different definition, so it is a different plan and a different profile. The
engine reviewer reproduced the OLD value byte-identically during its audit, so
this reads as a regression to anyone who remembers it. It is not one.

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
| 1 | v1 定义兼容读取/编译，v2 definition 经 Canvas save/detail/export round-trip 后语义不变 | **MET** | v1 read/compile: `test/core/change-run/lowerer.test.ts`; `test/core/pipeline-registry/v1-parallel-only-lowering.test.ts` (v1 parallel-only now compiles through the same v2 path — ECP-5 §2). v2 round-trip: `packages/ui/test/canvas/pipeline-canvas-page.test.tsx` → "creates a declaration, references it from the root, and saves the round-trip" (asserted on the POSTed definition, not the DOM). End-to-end, through the real save path: dogfood scenario C — Canvas POST → `pipeline save` → `pipeline show` (`supported_v2_executable`) → Run `run:07ef84266520254b…` `completed`, i.e. the saved definition kept its semantics all the way to execution |
| 2 | Canvas 可以创建、引用、展开和校验受约束 Custom Composite | **MET** | Create + reference: `packages/ui/src/canvas/DeclarationsPanel.tsx`, commit `b5e9fcd0` (ECP-5 task 5A) — before it, `addDeclaration`/`removeDeclaration`/`addBodyStage` had **zero callers in `packages/ui/src`** and ECP-2 tasks 8.5/8.6 were false ticks, now annotated. Constrained: `V2_BODY_PALETTE_KINDS` (`draft.ts`) is `AtomicStage` only; `pipeline-canvas-page.test.tsx` asserts all five forbidden kinds absent. Expand (drill-down): ECP-2 commit `95bd1c53` composite-body progress projection. Validate: ECP-2 task 7.1 prepare-time validators (recursion, nested loop, cycle, missing exit, port mismatch, capability missing). Real: scenario C |
| 3 | `bug-fix`、`small-feature`、三个 goal pipelines、`full-feature` 与至少一个 Canvas-authored Custom Composite 均可完成真实 Run | **MET** | The dogfood matrix above — twelve cells, every RunId produced at `3b33d5be`. The three cells that had no real Run before this slice (`small-feature`, a whole-pipeline `goal-loop-evaluate`, a Canvas-authored composite) are `run:308c9ca2…`, `run:92156d53…`, `run:07ef8426…` — the last of them a **connected** two-stage body, which task 7.6 could not produce until `3b33d5be` |
| 4 | 同一 immutable plan + committed record 始终得到同一 next action | **MET** | `test/core/change-run/reconciler.test.ts` → describe "reconcile determinism (5.1)" (shuffled insertion order, poisoned clock/random/env/filesystem, replay). `fault-journeys.test.ts` → "different launch keys produce distinct deterministic RunIds (no global key index)" and the launch-binding immutability case. `ecp-composite-parity.test.ts` extends it across composite invocation |
| 5 | root stage 与 Composite invocation 的 crash-before/after-commit 故障注入均可恢复 | **MET** | `fault-journeys.test.ts` 50/50 — pre-publish, after-stage-before-fsync, after-fsync-before-publish, post-publish, O_EXCL race, post-commit/pre-projection, conflicting receipt, corrupt/gapped/duplicate revision fail-closed. `ack-loss-journeys.test.ts` 12/12. `archive-recreate-journeys.test.ts` 13/13. Composite invocation specifically: `ecp-composite-dogfood.test.ts` recovery path (resume after start with the body stage still active) |
| 6 | ReviewCycle 至少真实经历一次 finding -> fix -> independent re-review | **MET** | `run:dbbd559244c6bad3…` at this HEAD: F1 (major) → triage `fix_inline` → fix by `fixerA` → same-actor re-review **refused** ("The fixer cannot verify their own ReviewCycle fix.") → independent `verifierA` → `clean`; three distinct actor identityDigests. ECP-1's original run was `run:b23b2cce16d90495…`. Reproduced twice more here: scenarios A (`run:308c9ca2…`) and D (`run:fbcebfe8…`), each with four distinct phase actors |
| 7 | GoalLoopMeasure 与 GoalLoopEvaluate 都完成真实迭代并证明公共 loop lifecycle | **MET** | Measure: `run:81b0934e…` (fail round 1 → pass round 2 → `satisfied`) and `run:163d87c6…` (5 rounds → `exhausted`/`escalated`). Evaluate: `run:1b8e7a48…` (loop `satisfied`) and `run:92156d53…` — work → evaluate judge (`satisfied`, `gaps: []`) → ship → retain → archive → `completed`. Same loop lifecycle both variants: same `goal` section, same phase actor separation (the dogfood's first attempt was **rejected** with "The worker cannot judge their own GoalCycle work" — the shared guarantee firing) |
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
  `3b33d5be`, rather than ECP-1's and ECP-4's originals. Citing a sibling's
  RunId would have evidenced that slice's tree, not the integrated one; the
  originals are named beside the new ones so provenance is not lost.

### What the ledger deliberately does NOT rest on: the session contract

Design D9 rules that the committed agent action's `session.handoffTokenLimit`
and `session.reuseRoundLimit` are **placeholders** — 0.1.6 ships no config key
and no authoring surface for either, so every value a 0.1.6-era Record carries
for them is unchosen by definition. The `ecp-change-run-runtime` delta says so
at the contract level ("Recorded session guidance is placeholder until a slice
defines its authoritative source").

**No exit condition above cites them, and none needs to.** Stated rather than
left to be discovered, because an absence a reader has to verify for themselves
is weaker evidence than a claim they can falsify. The falsifiable form: no row
of the 14-condition table, and no row of the dogfood matrix, contains
`session`, `handoffTokenLimit`, `reuseRoundLimit`, or `reuse`. Before this
subsection existed, the only match anywhere in this file was Section 3's
worker-lifecycle prose ("worker lifecycle, warm reuse, briefing, Tier
fallbacks …") — orchestration-playbook text about the LEAD's own worker
handling, not a session-contract claim.

Where session-adjacent behaviour genuinely bears on a condition, it is the part
D9 rules **authoritative**, and the ledger cites only that:

- Condition 9 ("完成判断绑定 actor、tree、delta/result 和 evidence") rests on the
  completion contract's strict decode and the actor/attestation/evidence
  bindings — none of which reads the session block.
- Condition 10 ("三个入口不再拥有独立机械推进规则") rests on the deleted
  prompt-owned rules and their named kernel replacements. Worker lifecycle,
  warm reuse and relays are **retained** as the LEAD's, engine-neutral, by
  design D2 — so they are explicitly NOT evidence that mechanical ownership
  moved, and are not cited as such.
- The one session value D9 rules authoritative — the synthetic evaluator's
  `sessionReuse: 'never'` with `definition` provenance, because a one-shot
  evaluation has no session to reuse — is evidenced by
  `test/core/pipeline-registry/session-contract-fidelity.test.ts` (task 10.4)
  and is not load-bearing for any §15.4 condition either.

The forward-pointer is recorded in the architecture doc rather than only here:
§2 states that the kernel GRANTS and the caller EXECUTES (`deliveryMode:
'grant'`), §7 carries the placeholder guarantee, and §10 lists the session
execution layer as out of 0.1.6 scope.

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
`3b33d5be` — the same revision the whole dogfood matrix is anchored to, and
re-run again after the Blocker fix. All twelve still hold. Command outputs
verbatim:

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

All at `3b33d5be`, natively on Windows 11 (`win32`, Node 24.14.0) — which is
what makes this also the cross-platform evidence, not a separate exercise. Every
check re-run after the Blocker fix; nothing carried over from the earlier
revision.

| Check | Result |
|---|---|
| `pnpm build` | clean |
| root `npx tsc --noEmit` | **0 errors** |
| `packages/ui` `npx tsc --noEmit` | **0 errors** |
| root `npx vitest run` | **393 files · 6364 passed · 1 failed · 33 skipped** |
| `packages/ui` `npx vitest run` | **56 files · 604 passed · 0 failed** |
| `pnpm lint` (`eslint src/ test/ vitest.config.ts vitest.setup.ts`) | **0 errors**, 1 pre-existing warning |
| `node scripts/release-contract.mjs` | `verified lockstep release contract 0.1.5` |
| `node scripts/pack-version-check.mjs` | `pack-version-check: OK` |
| `node scripts/paired-pack-check.mjs` | `verified paired CLI/UI packages 0.1.5` |

### The one root failure — and what happened to the other five

**At `3b33d5be`, running alone, the suite reports a single failure**:
`test/core/token-audit/zed/audit.test.ts` — pre-existing, unrelated, and
environment-dependent (this machine has a Zed database at the default location,
so the test's "absent" precondition does not hold). Verified by checking that
test out at `2fcd5438`, before this change, and reproducing it identically.

The four Windows CLI-spawn flakes recorded below did **not** recur, and the
`command-registry` regression was fixed. The flakes not recurring is the
expected consequence of having the machine to myself: they are contention
artifacts, which is exactly what the isolated re-runs said. That earlier
attribution is preserved rather than deleted — it is what the evidence looked
like at the time, and this run is the stronger confirmation of it, not a
replacement for it.

### The 6 root failures at the previous revision, enumerated per file with attribution

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

### The `dist/` concurrency trap — the rule, the mechanism, and the signature

Two runs in this change were destroyed by it, mine and the engine reviewer's,
and each took a different wrong route to the diagnosis. The rule that actually
holds:

> **Never run a root vitest invocation, a build, or anything triggering the
> `prepare` hook concurrently with any of the others.** Not "pack-checks are
> unsafe beside the suite" — that was my first, too-narrow reading — and not
> "builds are unsafe beside the suite" either. Any two of the three collide.

**Mechanism** (verified from source, not inferred):

```
vitest.config.ts:128        globalSetup: './vitest.setup.ts'
vitest.setup.ts:40          await ensureCliBuilt()
test/helpers/run-cli.ts:136 if (!existsSync(cliEntry)) → runCommand('pnpm', ['run','build'])
build.js:19                 rmSync('dist', { recursive: true, force: true })
```

The consequence is the part neither of us predicted: **once any build has
deleted `dist`, the next root vitest invocation becomes a second `dist`
destroyer** — because its globalSetup finds `dist/cli/index.js` missing and
launches its own full build, which opens by removing `dist` again. This is true
even of a suite with no `dist` dependency in its test bodies. I told the LEAD
`test/core/templates/` was safe on exactly that reasoning; it is safe alone and
unsafe when raced, and the harness is why.

Two concurrent builds both report success. The surviving `dist` is the union
minus whatever the other side's `rm` caught mid-emit.

**Diagnostic signature** — worth more than either route we took, because it is
recognisable in seconds:

- `dist/` missing individual emitted files while others are present
- `node dist/cli/index.js --version` failing with `ERR_MODULE_NOT_FOUND`
- mass failures that **error-exit in ~200ms**, not timeouts

That last point is what separates it from the ordinary Windows CLI-spawn flake,
which presents as *timeouts* (30s/60s) plus `EBUSY`/`EPERM` on temp cleanup. A
run showing hundreds of instant error-exits is a poisoned `dist`; a run showing a
handful of slow timeouts is the flake. My first attempt reported **235 failed /
36 files** and the reviewer's **571**; both are tooling artifacts and neither
appears anywhere as evidence.

**Durable fixes — recommendations for a future change, NOT done here:** have
`build.js` emit to a temp directory and rename into place, so a partial build is
never observable; and/or have `ensureCliBuilt` take a lock file so concurrent
callers serialize instead of racing. Both are repo-infrastructure changes with
their own blast radius, and a closure slice is the wrong place for them.

### The other silent-write trap: an edit anchor that no longer matches

Same failure class, different surface, and it belongs beside the rule above
because both are cases where a convention *looks* like protection and only an
assertion actually is.

Three writers shared an uncommitted `tasks.md` across this slice. The
narrow-pathspec convention protects the **commit** — it stops you sweeping
someone else's staged file into yours. **Nothing protects the edit.** An edit
anchored on a string another writer may also be touching can silently drop their
version if the anchor moved, and git cannot help: with uncommitted content there
is nothing to conflict against, so a careless overwrite *loses* work rather than
failing.

The control is to read fresh and **assert the anchor matched exactly once**
before replacing. Both failure directions matter, for different reasons:

| Count | Meaning | Behaviour |
|---|---|---|
| `0` | the anchor moved | **Fails loudly.** Annoying, never dangerous |
| `> 1` | the anchor is ambiguous | a naive `replace` edits **every** occurrence, silently — and it is invisible in diff review, because each individual hunk looks correct |

So the assertion is `== 1`, not `>= 1`; the equality is what catches the silent
case. Anyone copying the pattern as "assert it matched" gets the loud protection
and not the quiet one. This is also why every edit in this change is a targeted
in-place replacement rather than a regeneration — a script that reconstructs a
file from a template has no anchor to assert and destroys concurrent work by
construction. It caught a real error while this very section was being written:
a malformed literal in the edit script tripped the `== 1` assert and the file was
never touched.

It is the same discipline as a mutation test that silently no-ops because the
pattern did not match: the tool reports success, the operation did nothing (or
too much), and only an explicit count distinguishes them. Write-side and
mutation-side, one rule.

### `scripts/skill-check.ts` — NOT repaired, and why

Task 3.7 offered it as one way to run the template checks, and the engine worker
found it **pre-broken on this branch**: it imports `test/helpers/skill-parser`,
deleted in `8d6ae877` (unrelated to ECP-5), so it cannot run at all.

Section 9's release checks do not require it, and it is not repaired here.
The evidence:

- It appears in **no** CI workflow (`.github/workflows/ci.yml` never mentions
  it) and in **no** `package.json` script.
- It is written for **Bun**, not Node — `import.meta.dir` is a Bun API.
- `docs/grill-gstack-absorption.md` records that the
  "bun/gen-skill-docs/skill-check toolchain" was **deleted** and the freshness
  gate "unified on a parity hash". That parity hash is
  `test/core/templates/skill-templates-parity.test.ts`, which runs in the suite,
  gates every template payload and generated skill file, and is what caught this
  change's template edits (two golden hashes regenerated).
- Its only remaining references are archived `rasen/specs/*` requirements from
  the gstack-absorption era.

So it is an orphan of a retired toolchain whose replacement is green. Repairing
it would resurrect a second, Bun-only freshness gate beside the one that
actually runs — the "accidental second implementation" this slice exists to
stop. **Recommendation, not enacted here:** delete it, as a separate change with
the archived specs' requirements updated alongside. Deleting a script on the way
past, inside a closure slice, is exactly the kind of silent scope creep this
ledger is supposed to make visible.

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
  the scripts themselves and verified absent — **on the success path.** Round 2
  found the `fs.rm` sits after each scenario's assertions, so a scenario that
  throws leaks its directory into the repo root (untracked). Observed directly,
  removed by hand; see Section 10, observation O-R1.

## Section 10 — Round 2: the re-review of the post-fix delta

Round 1 produced a Blocker (`PORT_MISMATCH`), a Major (F1) and four smaller
findings; `3b33d5be`, `7f2fc33d`, `7f1b71bf`, `df106499` and `f111ada3` closed
them. **That post-fix delta is itself a delta, and it got its own non-author
pass** — by the relay LEAD, which authored none of those six commits. Full
report: `work/review-report-round2.md`.

**Verdict: no Blocker, no Major.** Three findings, all Minor-or-below, all fixed
in-loop at `60b2d38a` and `c54af90a`. Round 1's six findings were each
re-checked as landed.

### The open question round 1 could not close

> Did any downstream fail-closed guarantee — `unsupported_pipeline_shape`
> particularly — rely on `PORT_MISMATCH` to reject a shape `3b33d5be` now admits?

**No weakening exists**, on three independent paths:

1. `unsupported_pipeline_shape` never reads a port. All three call sites in
   `execution-plan-internal.ts` compare the **sorted set of expected node IDs**
   (root AtomicStages + the body AtomicStages of referenced declarations) against
   `supportProfileNodeIds(profile)`. Connections and ports are not inputs to it.
2. Nothing downstream consumes `to.port` at all. The only port reads outside the
   validators are `lowerer.ts:868` (`from.port` matched against outcome names —
   the output side, untouched) and the requires derivation, which is node-ID-only:
   `incomingRequirements` (`lowerer.ts:79`) and the composite body lowering
   (`lowerer.ts:435-478`, Kahn's sort). The widening admits **authored graphs**,
   not new runtime shapes — the shapes now savable lower through exactly the code
   fixture-catalog tests already exercised, and the body lowerer keeps its own
   fail-closed layers (AtomicStage-only, cycle → `lowerer_shape_mismatch`).
3. The other `contractForNode` consumer gets **more** fail-closed, not less. A
   refused edge marked the graph `complete = false`, and
   `validateOwnerTerminalOutcomes` **skips** its "declares terminal outcome X but
   the graph cannot produce it" diagnostic while `!complete` (`definition.ts:1828`).
   Pre-fix that check was suppressed for exactly these definitions; post-fix it runs.

No previously-savable definition changes verdict either: any definition carrying
such an edge was refused outright before, and the legacy branch widened from
`{start}` to a superset containing `start`. The scoping is real in the code — an
unknown capability (no descriptor, non-legacy) still resolves to an EMPTY input
set, so every edge into it is still refused.

### The three findings

| # | Sev | Finding | Fix |
|---|---|---|---|
| F-R1 | Minor | **The cell this ledger leans on hardest could not fail.** Scenario C printed its semantic claims — discovery reason, the directional `requires` chain, the one-entry frontier, the terminal — and asserted none of them; the driver's per-scenario catch then let the process exit 0 regardless. Task 7.6 and the §7 table already said the cell "**asserts**" ordering. It did not: a human reading four lines of a dump was the only thing separating the authored pipeline from the disconnected one | `60b2d38a` + `c54af90a`: all four claims `throw`, directionally (`secondRequiresFirst && !firstRequiresSecond`), and any scenario error sets a non-zero exit code after the RESULTS dump prints. **Mutation-verified with the exact regression**: stripping the authored body edge before `save` now yields `SCENARIO C FAILED: body ordering is not the authored sequence` and **exit 1**, where it previously exited 0 |
| F-R2 | Minor | **The capability half of `updateBodyStage` had zero production callers** — the zero-caller signature this slice closed three times, inside the fix for it. `createBodyStage` stamps `firstExactCapability()` into every body stage and F1 shipped no way to change it, so a Canvas-authored multi-stage body could only repeat ONE capability while the requirement's own scenario says "adds an AtomicStage **with capability `skill:rasen-apply`**" | `60b2d38a`: the body stage row offers the same revision list, from the same filter, that the root graph's `V2NodePanel` has had since ECP-2. `capabilityAvailable: boolean` **replaced** by `capabilities: readonly {id,version}[]` — one fact, one owner (`capabilities.length > 0`). Probe asserts the two stages carry **different** capabilities in the POSTed definition; dropping the wire turns exactly one test red |
| F-R3 | Trivial → mechanism | **The Canvas's control ports were bound to the kernel's accepted sets by a comment.** Kernel narrowing was covered; a **UI-side** edit was not — it left every kernel test and every UI test green while production authored unsaveable definitions, which is what the Blocker actually was | `60b2d38a`: constants moved to the model module and exported; `test/core/pipeline-registry/canvas-control-port-provenance.test.ts` runs the **real `prepare`** over a production-shaped catalog with them, negative control included. **Mutation-verified**: drifting `CONTROL_TARGET_PORT` to `'inpt'` leaves all 110 UI canvas tests green and turns the kernel test red |

Observation **O-R1**: a dogfood scenario that throws leaks its
`test-dogfood-<name>-tmp/` into the repo root, because `fs.rm(ctx.testDir)` sits
after the assertions. Observed directly during the F-R1 mutation run and removed
by hand. Task 9.6's claim below is corrected to say "on the success path".

### Gates, re-taken at `c54af90a` (serialized, one owner of the tree)

Fresh build first (411 emitted JS, CLI `0.1.5`), then: root **393 files / 6364
passed / 1 failed / 33 skipped** — *identical* to the count claimed at
`3b33d5be`, same single `token-audit/zed` failure, same root cause
(`env.LOCALAPPDATA` outranks the test's `homedir` override at
`zed/database.ts:63`; this machine has a real Zed DB), file byte-untouched by the
delta. The four Windows flakes did not recur, nor did `supervisor-injection`.
UI **56 files / 605 passed / 0 failed** (604 + this round's capability probe).
Root tsc **0**; UI tsc **0**; `pnpm lint` **0 errors** + the same one
pre-existing warning. All three lockstep checks green at **0.1.5**, pack checks
dead last, `dist` verified intact afterwards. `git status` carries only the
user-parked untracked `packages/ui/package-lock.json`.

### The dogfood cell, re-run with the assertions live

All four scenarios pass with the new hard assertions (no scenario error, exit 0).
Scenario C alone, at `c54af90a`: discovery
`{"supported":true,"reason":"supported_v2_executable","profileDigest":"sha256:de2b441d5d61d55b…"}`
— **byte-identical to the digest `f111ada3` pre-announced** for the connected
body — `plan ordering: stage-2 requires stage = true`,
`first frontier: ["root:composite-ref/stage"]`, terminal **`completed`**,
`run:d99136b96bfabeed…`. The RunId differs from the matrix's `run:07ef8426…`:
fresh instance identity, expected. Terminals, ordering, frontier and digest match.

**What this round did not do**, stated rather than implied: the other eight
matrix cells were not re-run here (round 1 reproduced all twelve at `7f1b71bf`;
those eight are v1-authored built-ins carrying no authored v2 connection, so the
port widening cannot reach them — an argument, not a re-run), and this round's
own three fixes were authored by the reviewer that found them, so for
`60b2d38a`/`c54af90a` author == verifier, with mutation verification standing in
for the missing second pair of eyes.
