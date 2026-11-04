## 1. Freeze the vertical-proof authority and failure-first baseline

- [x] 1.1 Re-read the ECP-6 slice acceptance, parent planning context, all three prerequisite review-clean reports, and Child 3 consumer-readiness evidence before changing code; record any newly discovered boundary conflict in this Change's planning context.
- [x] 1.2 Record the pre-change hash of `pipelines/auto-decompose/pipeline.yaml`, the exact shared fixture export path, and the current shared fixture source/capability/plan digests in implementation evidence.
- [x] 1.3 Add a discriminating failing root test proving that the current shared fixture's empty root connection set does not express the intended ordered loop-plus-parallel execution route.
- [x] 1.4 Add a discriminating failing mounted Canvas assertion requiring the blank-Canvas journey to create the vertical route through real rendered handles before Validate and Save.
- [x] 1.5 Audit the proposed tests for any second Definition object, serializer, hand-built `RuntimePlanInput`, canonical Record fixture, lifecycle reducer, or product-plane projector and remove that duplication from the plan before implementation proceeds.

## 2. Make the sole blank-Canvas fixture executable

- [x] 2.1 Extend the mounted blank-Canvas journey to connect the existing Composite/BoundedLoop, Choice, paired FanOut/required AtomicStage/Join, and Finish route using the same visible handles and connection mutation used by production Canvas.
- [x] 2.2 Retain the authored Gate as the sole gate authority for the required AtomicStage and verify that adding the route does not create or revive an AtomicStage-local gate field.
- [x] 2.3 Update `CANVAS_V2_AUTHORING_DEFINITION` only to the exact Definition request emitted by the mounted journey, including stable connection identities and typed ports; do not add another runtime fixture.
- [x] 2.4 Assert that the mounted Validate and Save request remains deep-equal to the one shared fixture after the new connections are authored.
- [x] 2.5 Pass the connected fixture through real `EcpDefinitionModule.prepare`, canonical serialize/read, and lowerer paths; assert the intended dependency route, bounded-loop body, FanOut member tag, Join partitions/outcomes, Gate, and Finish in the immutable plan.
- [x] 2.6 Re-run the real Management validate/save/detail/no-op-save/export/import journey and assert canonical bytes plus source, capability, policy, and plan digest stability for the connected fixture.
- [x] 2.7 Verify that one intentional typed-connection edit changes the source/plan meaning, retains unaffected capability meaning, and stabilizes on its next canonical no-op reload.
- [x] 2.8 Re-run authored-v1 open/edit/save/duplicate compatibility, all-eight Canvas controls, connection-handle, paired FanOut/Join, lifecycle, and nested diagnostic regressions after the shared fixture changes.

## 3. Close the public completion union with TDD

- [x] 3.1 Add a focused failing facade test showing that a valid `effect-observation` envelope accepted by the public decoder is currently rejected before it reaches the existing `observe-effect` reducer stimulus.
- [x] 3.2 Add a focused failing facade test for the declared `infrastructure-observation` variant so the public completion union is closed coherently rather than only for the success journey.
- [x] 3.3 Map verified effect observations to the existing canonical `observe-effect` stimulus and commit them through the immutable Run store without fabricating a domain result or settling the next node.
- [x] 3.4 Map verified infrastructure observations to the existing canonical infrastructure stimulus while retaining infrastructure classification, adapter artifact digest, evidence, and recovery semantics.
- [x] 3.5 Preserve the existing domain-result validation and reconcile/settle path exactly for `domain-action-result`, including ReviewCycle, GoalLoop, Choice, FanOut, and bounded-loop strategy result validation.
- [x] 3.6 Add effect-observation assertions for exact action/invocation/effect binding, actor attestation, evidence refs, receipt digest verification, Record version, effect state, and unchanged action-result state.
- [x] 3.7 Add infrastructure-observation assertions for exact action binding, error classification, retryability, adapter evidence, Record version, and absence of a fabricated domain result.
- [x] 3.8 Prove identical observation replay is idempotent and a conflicting receipt is rejected without Record mutation, using the existing completion-slot classification rather than a new deduplication model.
- [x] 3.9 Prove domain success remains rejected while any required effect is unobserved and becomes admissible only after the valid public observation receipt commits.
- [x] 3.10 Prove malformed variant shapes, wrong action/invocation/effect ids, wrong actor binding, unknown evidence, and bad receipt digests fail before mutation with actionable public errors.
- [x] 3.11 Exercise `PipelineCommand.complete` with real bounded JSON receipt files and trusted upload staging for observation variants, and assert it forwards the decoded envelope to the same facade and prints the canonical receipt/view outcome.
- [x] 3.12 Re-run reducer, completion, facade, CLI-complete, ack-loss, uncertain-effect, evidence, and fault-journey suites to show the new public dispatch did not weaken existing invariants.

## 4. Build one trusted, product-boundary vertical driver

- [x] 4.1 Create an isolated cross-platform temporary project/store/evidence layout using Node `path.join`/`path.resolve` and explicit environment isolation; avoid shared default TEMP state and shell-specific path syntax.
- [x] 4.2 Save the exact shared Canvas Definition through the real Management pipeline validation/save bridge and reload it through Management detail before launch.
- [x] 4.3 Launch the saved user pipeline through the built CLI with explicit reconciler ownership, production registry/capability/profile resolution, and the real filesystem-backed plan/Record store; do not construct runtime internals in the driver.
- [x] 4.4 Add a subprocess helper that starts a new Node process for every CLI start, status, resume-run, complete, and control command and returns bounded parsed JSON plus exit status.
- [x] 4.5 Implement a trusted-host effect step that performs a deterministic scoped workspace change inside the temporary project, captures before/after workspace revision, stages actual evidence through the existing host evidence writer/upload format, and submits the canonical effect receipt through `pipeline complete`.
- [x] 4.6 Implement public completion steps for the closed generic Composite/BoundedLoop result, Choice selection, FanOut active-member selection, required AtomicStage result, and any remaining granted action without accessing the private reducer or store mutation APIs.
- [x] 4.7 Resolve authored Gate waits only with the exact optimistic `change-run-control/1` request and assert stale Record versions or WaitIds fail closed.
- [x] 4.8 Capture a transition ledger after every public command containing process boundary, Record version/status, RunId, granted/outstanding ActionIds, effect states, waits/controls, loop lifecycle state, parallel Join state, and terminal outcome.
- [x] 4.9 Make the driver bounded and diagnostic: fail on an unknown grant/wait, repeated non-progressing Record head, unexpected action identity, or exceeded step limit, and include the last canonical view in the failure.

## 5. Prove the real success path

- [x] 5.1 Assert launch consumes the Management-saved canonical source and freezes the same source, capability, policy, plan, and profile digests reported before Run creation.
- [x] 5.2 Drive the Custom Composite and BoundedLoop body through actual effect/evidence receipts and the authored `done -> exit(done)` mapping, asserting the `bounded-loop-lifecycle/1` section at each transition.
- [x] 5.3 Drive Choice through its valid closed outcome and FanOut through a result that activates the declared required member, asserting the exact frozen member path and no undeclared/suppressed required member.
- [x] 5.4 Approve the authored Gate, perform and observe the required member's real workspace effect, submit its domain success, and assert the paired Join proceeds only after that required member settles.
- [x] 5.5 Assert the authored Finish produces the declared successful terminal outcome and no additional action is admitted after terminal closure.
- [x] 5.6 Assert every RunId, ActionId, InvocationId, AttemptId, EffectId, WaitId, and receipt/evidence digest remains stable across status calls and matches the canonical Record/projected view.
- [x] 5.7 Assert the successful journey imports only `CANVAS_V2_AUTHORING_DEFINITION` as its Definition oracle and does not contain a structurally equivalent inline object or a post-save translation.

## 6. Prove fresh-process filesystem recovery

- [x] 6.1 Stop the success journey at a named committed boundary after at least one bounded-loop action/effect and before the required parallel member/Join settles; discard every in-process server, facade, plan, and Record handle.
- [x] 6.2 In a new CLI process, load status from the filesystem store and assert the same sealed plan digests, Record version, RunId, outstanding action/wait identities, loop state, and parallel state.
- [x] 6.3 Resume or complete the exact outstanding identity from another new process and assert the granted next action equals the deterministic transition ledger rather than being re-derived with a new identity.
- [x] 6.4 Finish the Run using new processes for each remaining mutation, then start another process for final status and assert the terminal Record and view survive complete process loss.
- [x] 6.5 Run repeated fresh-process inspections at one Record head and prove they are byte/field stable and non-mutating.
- [x] 6.6 Cover Windows path separators/case behavior locally and leave the same subprocess/store journey enabled for the parent Linux/macOS/Windows CI matrix.

## 7. Prove malformed and required-member failure closure

- [x] 7.1 Submit a malformed completion body through the built CLI and assert decode fails before facade/store mutation, with the original Record version and outstanding action visible afterward.
- [x] 7.2 Submit validly shaped but wrong action, invocation, effect, actor-attestation, evidence, and receipt-digest combinations and assert each fails without advancing the Record.
- [x] 7.3 Attempt domain success before the required workspace effect receipt, assert fail-closed behavior, then submit the correct observation and prove the same action remains recoverable.
- [x] 7.4 Submit a successful FanOut result that omits or marks inactive the frozen required member and assert public completion rejects it without mutating or optionalizing the member.
- [x] 7.5 Launch a separate Run from the same saved Definition and same stable plan digests, activate the required member, record its real effect receipt, then submit a failed domain result for that member.
- [x] 7.6 Assert the required-member failure drives the authored Join failure/escalation contract, never reaches the success Finish, grants no post-terminal action, and identifies the exact failed required member in the canonical view.
- [x] 7.7 Assert the success and failure Runs have distinct deterministic RunIds/launch identities while retaining identical source/capability/policy/plan/profile digests.

## 8. Prove one CLI, Management, and Operations projection

- [x] 8.1 At selected running, waiting, parallel, and terminal Record versions, compare built-CLI `pipeline status --json` with real Management `GET /api/v1/runs/<change>/<run>` and assert exact canonical identifiers, status, controls, actions/effects, and versioned sections.
- [x] 8.2 Assert the cross-plane view includes root-DAG, `bounded-loop-lifecycle/1`, and `parallel/1` facts from the same Record/plan, including limits, iteration/outcome, member states, Join state, waits, and failure reason.
- [x] 8.3 Mount the real Operations component against the Management-produced `ChangeRunView` from the vertical setup and verify visible Run/Action/effect ids, loop lifecycle, required member/Join, controls, and success/failure terminal presentation.
- [x] 8.4 Prove Operations formats and interacts with server truth but does not recompute lifecycle counters, required-member selection, Join outcome, or terminal meaning and does not maintain a second view projector/fixture.
- [x] 8.5 Exercise Operations refresh/control behavior at a Record-version conflict and assert it refetches and renders the same canonical Management view rather than merging stale client state.

## 9. Evidence, full gates, independent review, and delegated delivery

- [x] 9.1 Run the focused red/green Canvas fixture, preparation/lowering, completion/facade, CLI, fresh-process E2E, Management parity, and Operations suites and record exact commands/results.
- [x] 9.2 Run the complete root test suite in an isolated temporary environment and retain machine-readable totals with zero failures.
- [x] 9.3 Run the complete UI test suite, root TypeScript check, UI typecheck, production build, and lint; require zero new errors or warnings and document any pre-existing warning exactly.
- [x] 9.4 Run strict Change validation and focused source-vs-artifact diff checks for every requirement/scenario and confirm every completed task has direct evidence.
- [x] 9.5 Recompute the `auto-decompose` source hash and prove it is byte-identical to the pre-change v1 baseline; also audit authored-v1 compatibility and the ECP-7/0.3.0 exclusions.
- [x] 9.6 Write `evidence/implementation-report.md` with the shared fixture path, canonical digests, success/failure RunIds, representative Action/Effect/Wait ids, transition ledger, cross-plane equality, fresh-process commands, negative results, and all gate totals.
- [x] 9.7 Write a fresh implementer handoff naming changed files, red-to-green discriminators, remaining risks, temporary artifact locations, and the explicit absence of a Session executor or private reducer completion path.
- [x] 9.8 Obtain an independent non-author review of implementation, specs, exact source diff, ECP-6 scope, security/evidence binding, failure closure, process recovery, projection ownership, and test freshness; resolve every Blocker/Major finding through a bounded review cycle.
- [x] 9.9 Mark implementation/review tasks complete only after the independent verdict is clean; leave child ship/archive delegated to the parent portfolio.
- [ ] 9.10 Delegate the single portfolio PR, remote Windows/Linux/macOS CI, merge, and archive to `ecp-v2-authoring-loop-contract-closure`; this task remains open until the parent delivery completes.
