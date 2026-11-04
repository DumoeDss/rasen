# Review Cycle Report: ecp-v2-default-authoring-and-builtins

- Round: 3 cap re-review
- Base: `origin/dev/0.2.0` (`a1306828a23b2c4adc0db81f92b09498a5e92710`)
- Reviewed branch/worktree HEAD: `wip/ecp-shared-bounded-loop-lifecycle-resume` / `050fc84332b26a75a07f441efd6b235842f89e1e`
- Mode: dispatched, report-only, same non-author reviewer as Round 2
- Scope check: **CLEAN** — all five families reopened by the post-Round-2 root report are independently closed; no Blocker or Major remains at the review cap.
- Verdict: **CLEAN**

| Severity | Count |
| --- | ---: |
| Blocker | 0 |
| Major | 0 |
| Minor | 0 |
| Trivial | 0 |

## Round history

| Round | Input | Result |
| --- | --- | --- |
| 0 | Independent review of the Child-2 implementation | `CHANGES REQUIRED`: 0 Blocker, 5 Major, 0 Minor, 0 Trivial. |
| 1 remediation | `review-remediation.md` / `handoff/implementer-4.md` claim all five closed | Structural fixes landed for all five areas. |
| 1 re-review | Source inspection, mutation/failure-path tests, profile/install closure, strict validation | Four original findings resolved; one remains open; two new Blockers and one Minor found. |
| 2 remediation | `review-remediation-round-2.md` / `handoff/implementer-5.md` claim all four closed | Pipeline-derived install closure, generic internal-id exclusion, typed Gate terminal actions, and authority comments were updated. |
| 2 re-review | Fresh source inspection, production-catalog reproductions, bounded install/update and cross-consumer matrices | `CLEAN`: 0 Blocker, 0 Major, 0 Minor, 0 Trivial; all four Round-1 findings are `RESOLVED`. |
| 3 remediation | Post-Round-2 root report plus `review-remediation-round-3.md` / `handoff/implementer-6.md` | 43 product/fixture failures remediated; 3 local-version failures classified as shared TEMP/concurrency interference. |
| 3 cap re-review | Exact four-file production inspection, eight changed tests, 11-file root-failure aggregate, native/v1 Gate adjacency, and two isolated local-version runs | `CLEAN`: 0 Blocker, 0 Major, 0 Minor, 0 Trivial; all five reopened families are `RESOLVED`. |

## Original finding disposition

### 1. Gate nodes are the single authority — **OPEN [Major]**

**Evidence of progress:** `GateNode` now types `target`, `outcomes`, and `dispositions` (`src/core/pipeline-registry/definition.ts:171`); retired `execution.gate` is outside the execution allowlist (`definition.ts:1002`); target/disposition validation is fail-closed (`definition.ts:1423`, `definition.ts:2477`); lowering uses the authored Gate id/outcomes/dispositions (`src/core/change-run/internal/lowerer.ts:575`). The mutation test at `test/core/change-run/lowerer-native-v2.test.ts:413` proves id/outcome/disposition mutation and Gate removal alter the plan.

**Remaining defect:** runtime execution still collapses authored `fail` and `escalate`. Although `RuntimePlanGateOutcome` preserves both values (`src/core/change-run/internal/runtime-plan.ts:13`), `gateDisposition` reduces every non-`proceed` result to `gate-decided-blocked` (`src/core/change-run/internal/reconciler.ts:1361`) and the caller always emits an `escalate` action (`reconciler.ts:556`). The mutation test deliberately changes `deny` to `fail` but stops at plan shape, so it does not catch the wrong terminal result.

**Required closure:** carry the selected typed disposition through `NodeDisposition` and emit `fail` for authored `fail`, `escalate` for authored `escalate`, and admission only for `proceed`. Add a reconciler mutation test covering all three dispositions.

### 2. Management API host parity — **RESOLVED**

`managementHost()` now uses an injected request host or `detectHostRuntime()` (`src/core/management-api/pipelines.ts:59`), and inventory/detail pass that same host into the shared execution projection (`pipelines.ts:330`, `pipelines.ts:485`). `test/core/management-api/pipelines-api.test.ts:1003` independently compares inventory and detail against the shared projection for both Codex and Claude, including runtime provenance, dispatch mode, and bridge. The focused API suite passed.

### 3. Native-v2 route and bridge preflight — **RESOLVED**

`validatePreparedPipelineForExecution()` projects the native-v2 execution view, rejects unsupported routes, deduplicates required bridges, and probes the selected bridge (`src/core/pipeline-registry/execution-validation.ts:371`). `selectForExecution()` invokes it before returning a selection (`src/core/pipeline-registry/prepared-registry.ts:139`), and CLI Run identity/context creation occurs later (`src/commands/pipeline.ts:1239`). The Codex-to-Claude and Claude-to-Codex unavailable-bridge cases at `test/core/pipeline-registry/prepared-registry.test.ts:404` both reject before selection and prove the unrelated probe is never called.

### 4. ReviewCycle fix capability — **RESOLVED**

The three built-ins now pin `rasen-review-fix` with fixer/write policy, while re-review remains `rasen-review` with reviewer/read policy (for example `pipelines/bug-fix/pipeline.yaml:43`). The new capability explicitly edits but cannot certify its own fix (`src/core/templates/workflows/review-fix.ts:5`). Production descriptors advertise closed phase contracts (`src/core/pipeline-registry/definition.ts:507`), and preparation rejects capability, role, or workspace mismatches (`definition.ts:2677`). Focused package and negative-path tests passed.

### 5. GoalLoop judge capability — **RESOLVED**

All three goal built-ins now keep work on `rasen-goal-iterate`/implementer/write and bind judge to `rasen-goal-judge`/reviewer/read (for example `pipelines/goal-loop-measure/pipeline.yaml:22`). The new judge prompt owns the variant-specific result contracts and forbids edits (`src/core/templates/workflows/goal-judge.ts:5`); phase-contract validation fails closed, and `test/core/change-run/goal-cycle-canonical.test.ts:670` proves same-actor work/judge completion is rejected before Record mutation.

## New findings

### A. [Blocker] Effective installation never closes over `requires.pipelines`, so supported drivers cannot prepare their own built-ins

**Locations:** `src/core/workflow-registry/selection.ts:59`, `src/core/workflow-registry/selection.ts:67`, `src/core/workflow-registry/builtins.ts:139`, `src/core/workflow-registry/builtins.ts:167`, `src/core/profiles.ts:197`, `src/core/pipeline-registry/execution-validation.ts:250`

`resolveEffectiveWorkflowInstallSelection()` follows only `requires.workflows` and optionally `requires.skills`; it never follows capabilities reached through `requires.pipelines`. The advisory dependency graph does compute those owners, but init/update/execution enablement do not consume that graph.

A pure production-catalog reproduction for the official `core` profile returned `auto-command: enabled`, `review: enabled`, and `review-fix: disabled`; preparing `bug-fix` then failed because `rasen-review-fix`, the `rasen-review-cycle` strategy, and `rasen-ship` were disabled. A custom selection containing only `goal-command` resolved to `retain-command`, `goal-judge`, and `goal-command`; preparing `goal-loop-measure` failed because goal work, strategy, ship, and archive capabilities were disabled.

This is a common supported path (`auto-command` is in `CORE_WORKFLOW_IDS`) and prevents the migrated built-ins from reaching execution, so it is a Blocker.

**Required fix:** make the effective install/enablement selection transitively close over every capability owner reachable through each selected workflow's `requires.pipelines` (including declaration bodies, lifecycle strategies, and tails), or encode an equivalent complete strong dependency set. Add core-auto and custom-goal tests that build the enabled production catalog and successfully prepare/select every required pipeline; assert each referenced capability is enabled.

### B. [Blocker] New internal workflows leak into the selectable built-in baseline and fail the existing profile gate

**Locations:** `src/core/workflow-registry/builtins.ts:75`, `src/core/profiles.ts:63`, `test/core/profiles.test.ts:171`, `src/core/update.ts:842`

`review-fix` and `goal-judge` are correctly omitted from `BUILT_IN_WORKFLOW_IDS` and declared internal/non-selectable, but `getCurrentBuiltInWorkflowIds()` excludes only `retain-command`. It now returns both new internal ids, contradicting `ALL_WORKFLOWS` and feeding them into the `knownBuiltInWorkflows` upgrade baseline. `test/core/profiles.test.ts` fails 1/39 with both ids present in the received list; update can consequently advertise internal, unpickable workflows as newly available.

**Required fix:** exclude every `INTERNAL_BUILTIN_WORKFLOW_IDS` member from the selectable baseline, not one hard-coded internal id. Keep a regression test for all current and future internal workflow ids.

### C. [Minor] Remediation leaves comments that describe the retired authority model

**Locations:** `src/core/change-run/internal/lowerer.ts:690`, `src/core/pipeline-registry/definition.ts:2751`

The lowerer still says Gate logic is encoded in the AtomicStage policy gate field, while the remediation makes the authored Gate the semantic source. The phase-output comment still says one same capability is usable for review/triage/fix/judge, despite the new separate fix and judge capabilities. These comments now contradict the code and can recreate the exact authority mistakes this remediation addressed.

**Required fix:** update both comments to distinguish the authored Gate contract from the effective gate boolean, and phase-specific capability semantics from phase-specific output-port projection.

## Focused coverage map

```text
authored Gate -> validate -> profile -> lower plan       [COVERED]
                                      -> reconcile
                                         proceed          [COVERED]
                                         fail             [OPEN: emits escalate]
                                         escalate         [COVERED]

Management request host -> shared projection             [COVERED: Codex + Claude]
native-v2 select -> route/bridge preflight -> Run create  [COVERED: both cross-host failures]

Review fix capability -> phase contract -> role/access    [COVERED]
Goal judge capability -> phase contract -> actor split    [COVERED]

workflow/profile roots -> workflow+skill closure          [COVERED]
                       -> pipeline capability closure      [OPEN]
internal catalog ids -> selectable upgrade baseline       [OPEN: existing test fails]
```

## Commands and results

1. `pnpm exec vitest run test/core/pipeline-registry/definition.test.ts test/core/change-run/lowerer-native-v2.test.ts test/core/management-api/pipelines-api.test.ts test/core/pipeline-registry/prepared-registry.test.ts test/core/pipeline-registry/native-loop-phase-port-contract.test.ts test/core/pipeline-registry/builtin-v2-package-audit.test.ts test/core/change-run/goal-cycle-canonical.test.ts`
   - **PASS:** 7 files, 213/213 tests.
2. `pnpm exec vitest run test/core/workflow-registry/selection.test.ts test/core/workflow-registry/dependency-graph.test.ts test/commands/review-cycle.test.ts test/core/init.test.ts test/core/update.test.ts --reporter=dot`
   - **PASS:** 5 files, 166/166 tests. This matrix does not exercise profile-baseline exclusion or pipeline-derived effective install closure.
3. `pnpm exec vitest run test/core/templates/loop-phase-capabilities.test.ts test/core/workflow-registry/builtins.test.ts test/core/profiles.test.ts test/core/change-run/reconciler.test.ts`
   - **FAIL:** 1 failed, 77 passed. The failure is `profiles.test.ts:174`, with `goal-judge` and `review-fix` leaking into the selectable baseline.
4. Pure Node production-catalog reproductions of `resolveDesiredWorkflowSelection()` followed by `loadPreparedPipelineByName()`:
   - **FAIL as reproduced:** core/auto cannot prepare `bug-fix`; custom/goal-command cannot prepare `goal-loop-measure` because reachable capability owners remain disabled.
5. `node bin/rasen.js validate ecp-v2-default-authoring-and-builtins --strict`
   - **PASS:** Change is valid.
6. `git diff --check`
   - **PASS:** no whitespace error; existing CRLF-conversion warnings were emitted.

The full repository suite and remote parent-PR CI were not rerun in this bounded successor review. No external/subagent review was run because the dispatch explicitly prohibited it.

## Durable findings

1. Gate authority is not closed until its typed disposition survives reconciliation, not merely canonicalization and lowering.
2. `selectForExecution()` is now the correct pre-Run route/bridge failure boundary; management and CLI can share the same host-aware projection.
3. Phase tags may refine ports, but write/read authority comes from distinct exact capabilities plus role/workspace validation.
4. Advisory pipeline dependency graphs do not install or enable anything; supported profile roots need an authoritative pipeline-capability closure, and internal catalog entries must stay outside selectable baselines.

## Round 2 re-review

- Reviewer: fresh non-author, dispatched report-only
- Scope: the four Round-1 findings and adjacent regressions only
- Findings: **0 Blocker, 0 Major, 0 Minor, 0 Trivial**
- Accepted Minor: **none**
- Final verdict: **CLEAN**

### Finding disposition

#### A. Required-pipeline capability install/enablement closure — **RESOLVED [was Blocker]**

`resolveEffectiveWorkflowInstallSelection()` now repeats workflow/skill resolution and the authoritative required-pipeline owner collector until no owner is missing (`src/core/workflow-registry/selection.ts:103-126`). The collector prepares required pipelines against the full production capability catalog, walks reachable v2 AtomicStage capabilities, bounded-loop strategies, declarations, conditional FanOut members and root tails, and recurses through v1 decompose children; unlike the advisory graph, a required-pipeline load/preparation failure is not swallowed (`src/core/workflow-registry/dependency-graph.ts:82-218`, `src/core/workflow-registry/dependency-graph.ts:267-315`).

The project root is threaded through the public install and execution consumers reviewed here: desired/project profile resolution, init overrides, update, drift, artifact-ledger drift, and execution skill-set resolution (`src/core/profiles.ts:200-215`, `src/core/profiles.ts:344-396`, `src/core/init.ts:463-491`, `src/core/update.ts:217-235`, `src/core/profile-sync-drift.ts:58-88`, `src/core/workflow-artifact-ledger.ts:390-407`, `src/core/pipeline-registry/execution-validation.ts:228-266`).

Independent production-catalog reproduction after a fresh build proved:

- `core` + `auto-command`: `small-feature`, `full-feature`, `bug-fix`, and `auto-decompose` all prepared with `capability.executable === true`; every referenced `skill:` capability had an enabled owner and each pipeline reported `missing: []`.
- custom roots `['goal-command']`: `goal-loop-measure` prepared with `capability.executable === true`; plan/work/judge/ship/retain/archive capability owners were selected and `missing: []`.

The regressions at `test/core/workflow-registry/selection.test.ts:171-199` exercise the same production catalog and preparation boundary. The install/update and cross-consumer matrices below both pass.

#### B. Internal workflows excluded from the selectable built-in baseline — **RESOLVED [was Blocker]**

`getCurrentBuiltInWorkflowIds()` now filters a set built from the complete `INTERNAL_BUILTIN_WORKFLOW_IDS` constant (`src/core/profiles.ts:71-82`), while the catalog keeps `retain-command`, `review-fix`, and `goal-judge` dependency-installable (`src/core/workflow-registry/builtins.ts:83-91`). The future-facing regression iterates the entire internal-id set (`test/core/profiles.test.ts:185-190`).

Independent built output reported `internal: [retain-command, review-fix, goal-judge]`, `leaked: []`, and 23 selectable built-ins. The profile and update matrices pass, so the upgrade baseline no longer advertises an internal workflow.

#### C. Authored Gate terminal dispositions survive reconciliation — **RESOLVED [was Major]**

`NodeDisposition` retains the typed `fail | escalate` terminal disposition (`src/core/change-run/internal/reconciler.ts:137-146`); reconciliation emits that exact action kind rather than hard-coding escalation (`src/core/change-run/internal/reconciler.ts:560-565`), and `gateDisposition()` preserves the authored runtime-plan outcome (`src/core/change-run/internal/reconciler.ts:1365-1384`). The table regression at `test/core/change-run/reconciler.test.ts:174-218` proves `proceed -> admit`, `fail -> fail`, and `escalate -> escalate`, including the stable gate rejection code for terminal outcomes.

#### D. Retired authority comments — **RESOLVED [was Minor]**

The lowerer now states that authored Gate nodes are the control contract and AtomicStage policy carries only the effective gate boolean (`src/core/change-run/internal/lowerer.ts:691-696`). The port-projection comment now distinguishes phase-specific capability semantics from output-port projection (`src/core/pipeline-registry/definition.ts:2752-2757`). A targeted source/test scan found no occurrence of the retired phrases; the original wording remains only above as historical review evidence.

### Bounded coverage map

```text
profile roots
  -> workflow + direct-skill closure
  -> required-pipeline capability-owner closure
       -> v2 root/declaration/strategy/conditional/tail owners   [COVERED]
       -> v1 decompose child owners                              [COVERED]
  -> install/update/drift/ledger/execution enablement            [COVERED]
  -> production prepare: core/auto + custom goal                 [COVERED]

internal built-in catalog
  -> dependency installation                                    [COVERED]
  -> selectable/upgrade baseline exclusion                       [COVERED]

authored Gate outcome
  -> proceed -> admit                                            [COVERED]
  -> fail -> fail                                                [COVERED]
  -> escalate -> escalate                                        [COVERED]
```

### Round 2 commands and results

1. `pnpm exec vitest run test/core/change-run/reconciler.test.ts test/core/profiles.test.ts test/core/workflow-registry/selection.test.ts --reporter=dot`
   - **PASS:** 3 files, 81/81 tests.
2. `pnpm exec vitest run test/core/templates/loop-phase-capabilities.test.ts test/core/workflow-registry/builtins.test.ts test/core/profiles.test.ts test/core/change-run/reconciler.test.ts --reporter=dot`
   - **PASS:** 4 files, 82/82 tests.
3. `pnpm exec vitest run test/core/workflow-registry/selection.test.ts test/core/workflow-registry/dependency-graph.test.ts test/commands/review-cycle.test.ts test/core/init.test.ts test/core/update.test.ts --reporter=json`
   - **PASS:** 5 files, 168/168 tests.
4. `pnpm exec vitest run test/core/workflow-artifact-ledger.test.ts test/core/profile-sync-drift.test.ts test/core/pipeline-registry/execution-validation.test.ts test/core/expert-install-flip.test.ts test/core/templates/loop-phase-capabilities.test.ts test/core/workflow-registry/builtins.test.ts test/core/profiles.test.ts test/core/change-run/reconciler.test.ts --reporter=json`
   - **PASS:** 8 files, 138 passed, 1 skipped, 0 failed.
5. Fresh-built Node production-catalog reproductions using `resolveDesiredWorkflowSelection()`, `createProductionCapabilityCatalogSnapshot()`, and `loadPreparedPipelineByName()`.
   - **PASS:** core/auto 4/4 executable with zero missing capability owners; custom goal 1/1 executable with zero missing capability owners; internal selectable-baseline leak count 0/3.
6. `pnpm build` followed by `pnpm exec tsc --noEmit`.
   - **PASS:** both exit 0.
7. `node bin/rasen.js validate ecp-v2-default-authoring-and-builtins --strict`.
   - **PASS:** Change is valid.
8. `git diff --check` and `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml`.
   - **PASS:** both exit 0; diff check emitted only existing Windows LF/CRLF notices, and the v1 compatibility fixture remains untouched.
9. `rg -n "gate logic is encoded in the AtomicStage|same capability is usable for review/triage/fix/judge" src test`.
   - **PASS:** no matches.

The 6,822-test repository suite was intentionally not rerun in this bounded re-review. Parent task 9.5 (remote Windows and normal Linux/macOS CI on the portfolio PR) remains an external delivery gate, not an open Round-2 code-review finding.

### Round 2 durable findings

1. Required-pipeline closure is authoritative only when it prepares the real layered pipeline and feeds the same resolved set to install, removal, drift, ledger, and execution-enablement consumers.
2. Dependency-only workflows belong in the catalog and closure but never in selectable profile roots or the upgrade baseline.
3. A Gate is authoritative only when its authored typed disposition survives all the way to the emitted reconciler action; plan-shape parity alone is insufficient.
4. Local review is clean, while cross-platform parent-PR CI remains separately pending under task 9.5.

## Round 3 cap re-review

- Reviewer: same non-author Round-2 reviewer, dispatched report-only
- Scope: only the five families reopened by the post-Round-2 clean-root report
- Findings: **0 Blocker, 0 Major, 0 Minor, 0 Trivial**
- Open findings: **none**
- Accepted Minor: **none**
- Final verdict: **CLEAN**

### Root-report input

The cited durable JSON at
`E:\OpenSpec-code-ecp6-post-review-root-temp-adc5b0dd992844a8ba3fe9b6b7a9c27b\ecp6-post-review-root-vitest.json`
was parsed directly. It contains 433 files, 6,840 tests, 6,760 passed, 46 failed,
and 34 skipped. The 46 failures occur in exactly 12 files and match the
remediation classification: 43 assertions in the five product/fixture families
below and 3 local-version assertions with `CLI_VERSION_MISMATCH`/launcher-state
symptoms under the shared full-suite TEMP.

### Reopened-family disposition

| Family | Input severity | Round-3 status | Independent evidence |
| --- | --- | --- | --- |
| Public selection vs execution/install closure | Blocker | **RESOLVED** | Public core and custom-goal sets exclude execution-only/internal units while effective sets retain every required owner; workflow-chain and root-failure aggregate pass. |
| V1 Gate compatibility while native-v2 remains authored authority | Blocker | **RESOLVED** | V1 lowers to historical `stage:<id>-gate` plus `approve/reject`; native-v2 keeps authored Gate id/target/decisions/dispositions; focused definition/lowerer and fresh-process journeys pass. |
| Native-v2 and ReviewCycle fixture contract corrections | Major | **RESOLVED** | Native fixtures contain no retired `execution.gate`; package controls use `approved`; ReviewCycle fixture declares phase contracts, role/access split, and a closed Finish path. |
| Internal template/profile surface | Major | **RESOLVED** | All internal ids are generically absent from picker/discoverability/public roots while `rasen-review-fix` and `rasen-goal-judge` remain generated and effectively installed. |
| Local-version environment classification | Not a product finding after reproduction | **RESOLVED AS ENVIRONMENTAL** | Two new dedicated `E:\` TEMP roots, one worker each, independently pass 7/7; no local-version product file changed in Round 3. |

#### 1. Public roots are separate from effective execution installation — **RESOLVED**

`resolvePublicWorkflowSelection()` resolves the authored profile plus ordinary
workflow dependencies and then removes all `INTERNAL_BUILTIN_WORKFLOW_IDS`
(`src/core/profiles.ts:154-169`). `resolveDesiredWorkflowSelection()` remains the
effective install/execution seam with pipeline-capability closure
(`src/core/profiles.ts:230-246`). Workflow-chain suggestions now consume only
the public seam (`src/core/workflow-chain.ts:194-205`).

A fresh-built production-catalog reproduction produced these distinct sets:

- core public workflows: `propose`, `explore`, `apply`, `sync`, `archive`,
  `help`, `auto-command`; public internal leaks `[]`.
- core effective-only workflows: `office-hours-command`, `ship-command`,
  `retain-command`, `review-cycle`, `review-fix`.
- custom `goal-command` public workflows: only `goal-command`; public internal
  leaks `[]`.
- custom `goal-command` effective-only workflows: `archive`, `ship-command`,
  `retain-command`, `goal-plan`, `goal-iterate`, `goal-judge`, `goal-report`.

Thus the Round-2 capability-install closure remains intact without turning its
owners into `nextWorkflows` suggestions or authored profile membership. The
11-file matrix includes the previously failing artifact-workflow and
workflow-chain assertions and passes 360/360.

#### 2. Native and v1 Gate contracts remain intentionally distinct — **RESOLVED**

Only v1 normalization creates the compatibility Gate identity
`stage:<id>-gate`, decisions `approve | reject`, and dispositions
`proceed | escalate` (`src/core/pipeline-registry/definition.ts:3565-3575`).
The v1 lowerer tests assert both historical gate identities and the decision
vocabulary (`test/core/change-run/lowerer.test.ts:627-657`,
`test/core/change-run/lowerer.test.ts:1071-1077`). Native-v2 preparation still
rejects retired AtomicStage `execution.gate`, and its lowerer continues to use
the authored Gate as the sole identity/target/decision/disposition authority
(`test/core/pipeline-registry/definition.test.ts:336-355`,
`test/core/change-run/lowerer-native-v2.test.ts:413-447`).

The package `bug-fix` Gate authors `approved | rejected`; its three changed
fresh-process fixtures now submit `approved`
(`test/commands/pipeline-bugfix-e2e.test.ts:332-333`,
`test/commands/pipeline-complex-e2e.test.ts:306`,
`test/commands/pipeline-complex-e2e.test.ts:360`,
`test/core/change-run/ack-loss-journeys.test.ts:665-666`). The same ACK-loss
file deliberately retains `approve` for its in-process legacy plan, proving
the compatibility and native contracts were not collapsed.

#### 3. Native-v2 and ReviewCycle fixtures match the production contract — **RESOLVED**

The two native pipeline-command fixtures now express only role/workspace in
AtomicStage execution and author no Gate where none is intended
(`test/commands/pipeline.test.ts:639-774`). The native ReviewCycle lowerer
fixture declares exact phase contracts; fix is a distinct write-capable fixer,
the read phases remain reviewers, and the root graph has an explicit Finish
path (`test/core/change-run/lowerer.test.ts:400-520`). These are contract
corrections rather than relaxations of production validation.

#### 4. Internal templates remain installable but are not public profile UI — **RESOLVED**

Both profile choice construction and discoverability filter the complete
`INTERNAL_BUILTIN_WORKFLOW_IDS` set (`src/commands/profile-editor.ts:259-270`,
`src/commands/profile-editor.ts:467-478`). Tests also seed caller state with
internal ids and prove they remain absent (`test/commands/profile-editor.test.ts:53-68`,
`test/commands/profile-editor.test.ts:87-94`). The synced-core fixture derives
installed skill directories from the effective production resolver
(`test/commands/config-profile.test.ts:205-222`), while skill generation
explicitly includes all 38 templates, including `rasen-goal-judge` and
`rasen-review-fix` (`test/core/shared/skill-generation.test.ts:12-16`,
`test/core/shared/skill-generation.test.ts:51-54`).

#### 5. Local-version failures classify as shared-environment interference — **RESOLVED AS ENVIRONMENTAL**

The full-root JSON's three local-version failures occurred under a shared TEMP:
two installed fixture CLIs exited 1 with an empty reported version after
concurrent npm pack/install activity, and one launcher-state assertion failed.
The reviewer then ran the unchanged seven-test file twice, serially, under two
new dedicated roots:

- `E:\rasen-ecp6-local-version-reviewer3-a-9816968b20d94a769d9bad61d8d975fd`:
  **7/7 passed**.
- `E:\rasen-ecp6-local-version-reviewer3-b-b4d398b8eae142018539344b920effb1`:
  **7/7 passed**.

Each run used `--maxWorkers=1 --minWorkers=1`; each test file still exercises
its own two-caller cold-start concurrency case. Reproduction is therefore
stable when isolated from unrelated full-suite TEMP/npm contention.

### Round 3 commands and results

1. Parsed the cited root JSON with PowerShell `ConvertFrom-Json`.
   - **CONFIRMED:** 433 files; 6,840 total; 6,760 passed; 46 failed; 34 skipped;
     12 failed files and the exact 46 failing test names match the remediation
     table.
2. `pnpm exec vitest run` over the 11 root-failure files: artifact workflow,
   config profile, bug-fix E2E, complex E2E, pipeline command, profile editor,
   profile command, workflow chain, ACK-loss, lowerer, and skill generation,
   with JSON output at
   `E:\rasen-ecp6-round3-reviewer3-0ce1619c119346f9ae5ca428599a3d0e\round3-aggregate.json`.
   - **PASS:** 11 files, 360/360 tests, 0 skipped.
3. `pnpm exec vitest run test/scripts/local-version-runtime.test.ts --maxWorkers=1 --minWorkers=1 --reporter=json` under dedicated TEMP A.
   - **PASS:** 1 file, 7/7 tests.
4. The same local-version command under fresh dedicated TEMP B.
   - **PASS:** 1 file, 7/7 tests.
5. `pnpm exec vitest run test/core/pipeline-registry/definition.test.ts test/core/change-run/lowerer-native-v2.test.ts --reporter=dot`.
   - **PASS:** 2 files, 121/121 tests; native authored-Gate authority and retired-field rejection remain green alongside the Round-3 v1 compatibility correction.
6. Fresh-built Node reproduction comparing `resolvePublicWorkflowSelection()`
   with `resolveDesiredWorkflowSelection()` for core and custom goal roots.
   - **PASS:** zero public internal leaks; effective-only owner sets retained as listed above.
7. `pnpm build`, `pnpm exec tsc --noEmit`, and
   `node bin/rasen.js validate ecp-v2-default-authoring-and-builtins --strict`.
   - **PASS:** all exit 0; Change is valid.
8. `git diff --check` and
   `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml`.
   - **PASS:** both exit 0; only expected Windows LF/CRLF notices were emitted,
     and authored `auto-decompose` bytes remain untouched.

### Accepted limitations and remaining gates

1. This cap review intentionally did not rerun the complete 6,840-test root
   suite. The LEAD owns the final long clean-root confirmation. The bounded
   matrix independently closes all 43 non-local-version failures, while the
   unchanged local-version file passes twice under dedicated serial roots.
   If the next clean-root run reproduces local-version failures under isolated
   TEMP, this classification must be reopened as a test-gate Blocker.
2. Parent task 9.5 still requires green Windows and normal Linux/macOS CI on
   the portfolio PR. This is an external delivery gate, not an open Child-2
   review finding.
3. No proposal/design/spec/task contract changed in Round 3; existing D3 and
   operational-registry requirements already encode effective capability-owner
   installation plus non-selectable internal units.

### Round 3 durable findings

1. Public workflow membership and executable installation are two deliberate
   projections of the same authored roots; using the install closure for UI or
   next-step suggestions leaks dependency implementation details.
2. Version normalization may preserve a compatibility control vocabulary, but
   it must be source-version-scoped so native authored authority remains exact.
3. Test fixtures at a closed typed boundary must author the same phase,
   role/access, Gate, and Finish contracts as production rather than revive
   retired convenience fields.
4. The code-review cap is clean; the remaining evidence obligations are the
   LEAD-owned full-root rerun and parent cross-platform CI.

### Final local-validation appendix (Round 3; no new review round)

The LEAD's final frozen-tree result at
`E:\OpenSpec-code-ecp6-final-round3-root-temp-ed4095707a6c4a65a3bbe1da2416e8f2\ecp6-final-round3-root-vitest.json`
was parsed independently. It contains 433 result files and 6,842 tests:
6,804 passed, 34 pending, and 4 failed. All four failures are confined to
`test/scripts/local-version-runtime.test.ts`; the complete non-local-version
surface is therefore **432/432 files clean**, with zero non-local-version test
failures.

The four failures are recorded rather than silently converted to passes. In
the shared full-suite TEMP they comprise three empty-version
`CLI_VERSION_MISMATCH` results following npm pack/install work and one
launcher-state mismatch. The exact unchanged seven-test file independently
passed **7/7 twice** under two distinct dedicated `E:\` TEMP roots:

- `E:\rasen-ecp6-local-version-reviewer3-a-9816968b20d94a769d9bad61d8d975fd`
- `E:\rasen-ecp6-local-version-reviewer3-b-b4d398b8eae142018539344b920effb1`

Each dedicated run used one Vitest worker while retaining the file's own
two-caller cold-start concurrency exercise. Taken together, the frozen-tree
local failures are classified as **shared-TEMP concurrent environmental
interference**, not a product-code regression. This final validation evidence
does not reopen the capped review: the code-review verdict remains **CLEAN**
with **0 Blocker, 0 Major, 0 Minor, and 0 Trivial** findings.
