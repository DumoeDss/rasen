# Design: issue-autodecompose-graph

## Context

The fail-close, verified live: `pipeline show auto-decompose` reports `execution_profile_unavailable`
with `availableEngines: ['legacy','reconciler']`. The mechanism: auto-decompose is authored v1
(`pipelines/auto-decompose/pipeline.yaml`, byte-pinned since the ECP cutover); its review-loop makes
`definitionRequiresV2Lowering` true, so `analyzeReconcilerSupport`
(`src/core/pipeline-registry/execution-plan-internal.ts:964-989`) enters the v2-migration branch;
`resolveDiscoveryReconcilerSupportProfile` returns `null` because
`resolveCapabilityBindings` throws on the decompose stage — `normalizeV1`
(`src/core/pipeline-registry/definition.ts:3386-3390`) maps a decompose stage to the synthetic
capability `pipeline:<childPipeline>` @ `legacy`, which no catalog carries. `pipeline start` is the
reconciler-only door (`commands/pipeline.ts:1709-1808`; legacy is the off-switch), so the pipeline
cannot launch. The direction reserved this crossing: `PIPELINE_V1_COMPATIBILITY_BOUNDARIES` pins
the successor name `issue-dispatch-0.3.0`, and the kernel research states the target model —
decomposition "上移到 Dispatch/Execution Plan", each child Change keeping its own independent
Pipeline Run, with the three graph layers (Issue Execution Plan / Change Pipeline / Composite)
never blurred into one workflow.

What Phase 4 needs the output to BE: a reviewable, revisable Execution Plan revision on the Issue.
Phase 1–3 already built the carrier — `ExecutionPlanRevisionV1` (immutable, ordinal, digest-proven,
strict-read), intent nodes (`kind: 'intent'`, summary, project, line, dependsOn) for work no Change
exists for yet, the planning-member target gate on every node kind, per-project lanes and node
lines on the read surface, and `store issue start` to launch nodes. The roadmap's missing pieces
are exactly: per-node suggested pipeline, decomposition rationale/uncertainty, and the channel that
turns a decomposition into a revision.

Adjacent facts that bound the design:

- `--from-portfolio` deliberately writes "no child status, pipeline, cohort, or delivery fact into
  a node" (issue-plan-publication) — the portfolio run-state is not authority for pipelines, and
  its children already exist as committed Changes. A decomposition is the OPPOSITE shape: nothing
  exists yet, everything is proposal. A third source is the honest home; retrofitting either
  existing source would corrupt its authority story.
- `opsx-auto-command`'s "LEAD 自审拆分方案（默认无人类 gate）" governs the CHANGE-level decompose
  stage. The Issue dispatch's stop-for-review does not modify it — different surface, and the
  revision IS the review surface.
- The pinned acceptance scenario (`session-host-lifecycle` "Acceptance matches the reconciler
  support boundary") records the CURRENT reason string as expected behavior; changing the verdict
  reason is the sanctioned 0.3.0 boundary crossing, not a regression.

## Goals / Non-Goals

**Goals:**

- A decomposition document publishes as the Issue's next plan revision: intent nodes carrying
  target project/line, edges, lifecycle, suggested pipeline, rationale/uncertainty — reviewable on
  `store issue show`, driving no projection axis.
- The node schema gains the three optional fields with the exact digest/canonical discipline the
  lifecycle vocabulary established (absent = omitted; old revisions byte-stable).
- The `auto-decompose` fail-close resolves by the uplift: decomposition becomes executable through
  the Issue-dispatch surface, and the v1 fixture's reconciler verdict becomes truthful
  (`unsupported_pipeline_semantics`) with the fail-closed launch outcome unchanged.
- The LEAD playbook can drive Issue dispatch: decompose → publish → report review-ready → STOP.
- Issue #3 dogfood staged on the persistent store to "published, reviewable" with receipts.

**Non-Goals:**

- No human revision/confirm/relaunch flow, no suggested-pipeline consumption at `start` (the
  node's suggestion feeding the launch contract is g-003's surface — recorded for its planner).
- No v2 authoring of `pipelines/auto-decompose/pipeline.yaml` (byte-identical) and no native
  reconciler fan-out of child Change runs — the engine never gains a Decompose node kind.
- No auto-routing/project inference machinery; targets are LLM proposals gated by the
  planning-member rule, revised by humans.
- No UI, no version bumps, no changes to `--from-portfolio`'s or `--from-file`'s existing
  semantics beyond the shared node fields, no portfolio run-state changes.

## Decisions

### D1. Enablement = the uplift (the boundary crossing itself), not a reconciler-executable decompose stage

The LEAD's choice point: v2-author the built-in like the other six, or a narrower scoped
enablement. Decision: **narrower — the executable decomposition surface moves to the Issue-dispatch
layer** (document → `--from-decomposition` → revision), and the v1 fixture keeps its pinned
boundary label. Rationale:

- A v2 conversion cannot be honest: the v2 definition graph has no construct that means "fan out
  into N independent child Change runs, each with its own pipeline, worktree, review, and
  delivery". FanOut members are nodes inside ONE Run; using it for child Changes would blur the
  three identity/transaction/evidence domains the kernel research explicitly forbids blurring,
  and would change delivery ownership (one Run vs N per-change runs).
- Teaching `resolveCapabilityBindings` to bind the synthetic `pipeline:<child>` capability would
  ADMIT a node the engine cannot dispatch — a support verdict that lies. The truthful verdict is
  that the construct is out of the engine's domain.
- The direction already named this exact successor (`issue-dispatch-0.3.0`); the children
  (small-feature & co.) are already `supported_v2_*`; the Issue layer already owns dependency
  gating (`store issue start`). Nothing executable is lost — the entry point moves up one domain,
  which is what "上移" means.

### D2. The verdict becomes truthful; the fail-closed outcome does not move

One analyzer branch: in the `requiresV2` path (and the flat path's semantics check), a v1 pipeline
carrying a `kind: decompose` stage reports `unsupported_pipeline_semantics` — checked BEFORE the
null-profile short-circuit, so the reason no longer depends on where binding throws. `task-loop`
(v1, goal-loop, no decompose stage) is untouched; the six v2 built-ins are untouched;
`execution_profile_unavailable` remains reachable for its true meaning (bindings genuinely
unresolvable). Ripple, all deliberate: `test/acceptance/session-cache/pipeline-binding.test.ts:138`
and `test/core/change-run/engine-product-surface.test.ts:275` pins update;
`session-host-lifecycle`'s expected-behavior scenario is MODIFIED to the same fail-closed refusal
under the truthful reason. This is the ONLY pipeline-registry semantic change in this child.

### D3. A third publication source: `--from-decomposition <path>`

The exactly-one-source discipline extends from two to three (refusals name all sources). The
document: a YAML file with a `nodes:` list (same authoring shape as `--from-file`) plus
decomposition-level strictness — every node `kind: intent` (binding existing Changes is
`--from-portfolio`'s question; a change-kind node is refused pointing there), every node carries
`suggestedPipeline` and at least one of `rationale`/`uncertainty`. The strictness is what makes
"machine-proposed" a meaningful provenance distinct from manual `--from-file` authoring, where the
new fields stay optional. The document is read-only input (byte-identical after publication,
mirroring the portfolio run-state rule); its location is caller-supplied (dogfood puts it in
evidence) — no new placement surface. Publication reuses `publishPlan`'s existing
normalization/gates unchanged; unreadable-is-not-absent applies.

### D4. Node fields: base-level, optional, registry-validated, digest-stable

`suggestedPipeline`, `rationale`, `uncertainty` sit on `ExecutionPlanNodeBase` (both kinds — a
manual revision may suggest a pipeline for an existing Change node too). Canonical form omits
absent fields exactly as it omits an absent `lifecycle`, so pre-existing revisions re-derive their
digests byte-for-byte (the lifecycle-precedent scenario is mirrored in the delta). Validation at
publication: `suggestedPipeline` resolves through the SAME registry-validation seam
`store issue start --pipeline` already uses (issue-execution-binding's "validated against the
pipeline registry before the contract is emitted") — no second implementation; decompose-freeness
of the named pipeline is the launch path's existing guard, not publication's. `rationale` and
`uncertainty` pass `assertPortableIssueText` beside the existing node text checks
(`src/core/store/issues/plans.ts`). Strict-read forward incompatibility (older binaries refuse
revisions carrying the new fields) is accepted — the same trade the lifecycle vocabulary made.

### D5. Reviewable = the read surface carries the fields; the projection interprets none of them

Node lines on `store issue show` (and node facts in `list --json` parity) carry the recorded
suggestion and rationale/uncertainty in both forms. The projection treats them exactly like target
project: facts to read, driving no axis. An intent-only revision keeps the Issue in `planning`
phase (existing rule) — which is the review-ready signal: the dogfood's end state is observable as
`phase: planning` + a published revision, with nothing started.

### D6. Playbook wiring is a stop-short branch, template-disciplined

`src/core/templates/workflows/auto.ts` and `_orchestration.ts` (Step G) gain the Issue-dispatch
branch: when the target is a Store Issue — decompose into the document shape, publish via
`store issue plan --from-decomposition`, report review-ready (ordinal + node count), STOP. The
change-level Step G fan-out text is untouched; the branch names the distinction explicitly so the
generated skill cannot read as one behavior. Generated-skill changes follow the fixed discipline:
skill hash pinning, pipeline pins, dist rebuild (the store-v2 post-merge review's coordination
steps). No new top-level command for triggering decomposition — the LLM step needs an agent; the
CLI provides the publish door and the read surface.

### D7. Dogfood staging: Issue #3 on the persistent store, stopped at review-ready

The persistent store's Issue #3 carries this portfolio's goal. Staging (LEAD-coordinated writes):
decompose Issue #3's remaining work into a document (intent nodes for the remaining portfolio
children, real target projects, edges, suggestions, rationale), publish the revision, capture
receipts — publication report (both forms), the read-back `show` with per-node suggestions, and
the unchanged-bytes receipt for the document. The Issue stays open in `planning`; no node starts;
close/accept actions appear only in evidence.

## Risks / Trade-offs

- [A reviewer expects `auto-decompose` to become launchable in THIS change] → It does not, by
  design (D1): the capability crosses to the Issue-dispatch surface the boundary name has promised
  since 0.2.0; the proposal and the truthful verdict say so explicitly. Faking a `supported_*`
  verdict would be the defect the fail-close exists to prevent.
- [Reason-string change breaks pinned expectations] → Exactly two pinned sites
  (pipeline-binding acceptance, engine-product-surface) update; the session-host scenario delta is
  in this change; CI is the gate.
- [New fields shift old revisions' digests] → Canonical omission of absent fields; the delta pins
  the byte-stability scenario; existing digest-pinning tests stay green unchanged.
- [Suggested-pipeline validation needs registry access from a store-scoped command] → Reuse the
  start command's existing validation seam and its store-layer resolution; no new registry surface.
- [Playbook text churn regenerates skills] → Hash-pinned template parity tests + dist rebuild in
  tasks; the branch is additive prose, not a rewrite of Step G.
- [Decomposition proposes a non-member target] → The planning-member gate refuses at publication
  naming the project and repair — the delta pins it for the new source.
- [Scope creep pressure toward g-003 surfaces] → Non-Goals name them (revision flow, confirm,
  start-time consumption of suggestions); the dogfood stops at review-ready.

## Migration Plan

None beyond the reason-string ripple. No stored format changes (new node fields are optional and
omitted-when-absent); no pipeline YAML changes; the new CLI flag is additive. Rollback = revert;
published intent-only revisions remain valid revisions under the existing schema.

## Open Questions

None blocking. Recorded for g-003's planner: (1) the confirm action that turns a review-ready
revision into launchable work, and whether `store issue start` should adopt a node's recorded
`suggestedPipeline` as the contract's pipeline when no `--pipeline` is given; (2) the teardown and
revision UX vocabulary for decomposition revisions (merge/split as new revisions); (3) whether the
foreign-repo main-checkout widening from g-001 item 7 needs project-repo keying once g-003's
launch flow composes execution roots more aggressively — assess when that surface is touched.
