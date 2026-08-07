## Context

The first three ECP-6 children have landed one shared bounded-loop lifecycle, native-v2 Change defaults and built-ins, and complete Canvas authoring for the closed eight-kind v2 vocabulary. Child 3 also established `packages/ui/test/fixtures/canvas-v2-authoring.ts` as the only cross-boundary Definition oracle: a mounted journey starts from the real blank-v2 draft, uses visible controls, and submits that exact object to Management validation/save; a root test prepares, canonically serializes, saves, reloads, exports, and imports the same object with stable source, capability, and plan digests.

That handoff is necessary but not sufficient for the ECP-6 merge-node proof. The fixture's root graph currently has `connections: []`. It proves authorability and preservation of every kind, but it does not prove the authored order of a loop-plus-parallel execution; disconnected executable nodes can be admitted as independent roots. Child 4 must add executable connections to the same mounted journey and fixture, not copy the object into a runtime-only model.

The canonical runtime already has immutable plans, deterministic identities, a filesystem-backed Run store, a public CLI/facade, trusted completion envelopes, the reconciler, and one `ChangeRunView` projector consumed by CLI, Management, and Operations. One product inconsistency blocks a truthful success proof: `CompleteRunAction` and `pipeline complete` accept `effect-observation` and `infrastructure-observation`, and the reducer implements their stimuli, but `createChangePipelineRuntime.complete()` rejects every completion other than `domain-action-result`. Existing complex E2E tests therefore inject effect observations through the private reducer. Repeating that pattern would test the kernel while bypassing the public product seam.

The vertical proof may use a trusted test host to perform deterministic workspace effects and submit signed/evidenced completion receipts. It must not create an agent process runner. Automated agent Session dispatch, automatic effect observation, worker reuse, handoff, usage accounting, and self-hosting remain ECP-7.

## Goals / Non-Goals

**Goals:**

- Turn the one shared Canvas-authored fixture into an intentionally connected loop-plus-parallel Definition through the real mounted authoring journey.
- Save that exact value through Management and consume the saved source through production preparation, profile resolution, lowering, CLI launch, the public completion facade, the reconciler, and the filesystem-backed Run store.
- Make the public facade honor the already-versioned observation completion variants without weakening receipt binding, effect ordering, evidence, idempotency, or Record immutability.
- Prove success, fresh-process continuation, malformed-receipt rejection, and required-member failure with stable Definition/plan digests and exact Run/Action identities.
- Prove that CLI status, Management Run detail, and Operations consume the same `ChangeRunView`, including root, bounded-loop, and parallel state.
- Preserve all prior ECP-6 contracts, authored-v1 compatibility, exact capability pins, and the byte-identical v1 `auto-decompose` source.

**Non-Goals:**

- Starting an agent CLI, creating a Session executor, observing effects automatically, managing worker reuse/handoff, or accounting Session usage (ECP-7).
- Claiming that a manual trusted-host receipt is self-hosted ECP execution.
- Adding a second Definition fixture, serializer, compiled-plan representation, Record, lifecycle reducer, or Operations projector.
- Reworking engine ownership, settle, reservation, association, archive, or release/version closure already assigned to other slices.
- Migrating `auto-decompose`, Issue Execution Plans, Dispatch, Acceptance, or portfolios (0.3.0).
- Supporting recursive Composite, nested loops, arbitrary scripts, remote runtimes, or a broader v2 language.

## Decisions

### D1: The mounted Canvas journey extends the sole Definition oracle with executable connections

The authoring test will continue to start from a not-found blank Canvas and construct `CANVAS_V2_AUTHORING_DEFINITION` through visible controls. It will additionally create typed connections using the real rendered source/target handles. The resulting graph will have one intentional successful route through the existing Custom Composite/BoundedLoop and paired FanOut/required member/Join to Finish; Choice and Gate remain the authored control nodes they already are, with Gate targeting the required AtomicStage. Connection ids and port names are captured from the same Canvas mutation path used in production, not hand-authored in a root test.

The shared fixture is updated only to the exact request produced by that journey. The existing Management round-trip test and every new runtime journey import the same symbol. Preparation and canonical serialization remain the authority for legality and digests. If executable wiring exposes a preparation, lowering, or Canvas handle gap, the implementation repairs that existing product boundary and updates the same fixture rather than translating it for runtime use.

Alternative considered: keep the all-eight authoring fixture disconnected and build a smaller connected runtime fixture. Rejected because two documents could drift while every layer's local test stayed green, defeating the core vertical-proof claim.

### D2: Management persistence and production launch form one source path

Each end-to-end journey creates an isolated temporary project using `path.join`/`path.resolve`, starts the real Management bridge, and saves the exact shared Definition under its Canvas name. The test then reads the stored canonical source and preparation metadata through Management detail before launching it with the built CLI and an explicit reconciler engine. Production registry resolution, capability catalog/profile freezing, lowerer, plan codec, runtime context, identity derivation, and filesystem Run store are used; tests do not construct `RuntimePlanInput`, `CanonicalRunRecord`, or a facade dependency object.

The proof captures and compares:

- canonical authored bytes plus source, capability, policy, plan, and profile digests;
- the sealed plan loaded at launch and after process restart;
- `RunId`, every granted `ActionId`/`InvocationId`, Record version, action/effect state, waits, transitions, and terminal outcome;
- root-DAG, bounded-loop-lifecycle, parallel, and any choice sections from the one projected view.

Alternative considered: call preparation and `createChangePipelineRuntime` directly in a root integration test. Rejected as primary evidence because it bypasses saved-source registry resolution, engine selection, CLI receipts, and fresh-process store discovery. Focused unit tests remain appropriate only for discriminating a specific fix.

### D3: The facade dispatches all existing completion variants through their canonical reducer stimuli

`complete()` continues to verify the envelope against the exact committed action before any mutation. It then maps the already-declared closed union to the existing canonical stimuli:

- `domain-action-result` -> `commit-action-result`, followed by the current reconcile-and-settle behavior;
- `effect-observation` -> `observe-effect` for the named admitted effect;
- `infrastructure-observation` -> `observe-infrastructure` for the exact action.

Observation completions commit through the same optimistic immutable store path and return a normal public receipt/view. They do not synthesize a domain result or advance an action whose required effects remain unresolved. Repeated identical receipts use the existing completion-slot classification/idempotency rules; a conflicting digest, wrong effect/action/invocation, wrong actor binding, malformed evidence, or illegal state fails before mutation. Domain success remains fail-closed until all required effects are successfully observed.

Supporting both observation variants closes the public union coherently; accepting only the success case needed by this journey would leave another documented completion kind unusable. This change exposes no general reducer API and grants no trust to arbitrary observation payloads beyond the existing actor attestation, receipt digest, and evidence contracts.

Alternative considered: let the E2E driver load the Record and call `reduceCanonicalRunRecord({kind:'observe-effect'})`. Rejected because it is precisely the private side door that caused the bootstrap dogfood to look executable only below the public facade.

### D4: A trusted host performs real deterministic effects; ECP-7 automates them later

The vertical driver acts as a trusted host, not as a simulated agent Session. For each granted workspace-writing AtomicStage, it performs a deterministic, scoped change inside the temporary project/worktree, records the before/after workspace revision, stages evidence through the existing host evidence writer/upload path, computes the canonical receipt digest, and submits an `effect-observation` completion through a fresh `pipeline complete` process. It then submits the domain result for the same `ActionId` through the same public command.

Host/orchestration actions such as Choice and FanOut receive their closed domain result envelopes through the public completion path. Gate waits are resolved through the typed `change-run-control/1` command. No action is marked complete by editing the store or by inferring success from a test callback.

This proves that a real Run can be driven today by an explicitly trusted owner. ECP-7 will replace the manual driving responsibility with authoritative Session execution and observation; it will not need a new completion format, Record, or reducer.

Alternative considered: invoke the actual `rasen-apply-change` agent skill in the test. Rejected because that is a Session executor/self-hosting test, is nondeterministic and expensive in CI, and belongs to ECP-7 rather than the deterministic kernel closure.

### D5: Fresh-process proof crosses multiple committed boundaries

The success journey uses a new Node process for launch, each status/resume/control/completion step, and final inspection. At a named mid-Run boundary after at least one loop action/effect has committed and before the parallel Join settles, the test discards all in-process handles. A later process resolves the Run from disk, checks the same sealed plan and Record head, resumes or completes the exact outstanding identity, and reaches the same next action as deterministic replay predicts.

The test records a compact transition ledger in evidence: command, process boundary, Record version, status, outstanding/granted `ActionId`s, waits, loop state, parallel join state, and terminal result. A direct JSON round-trip of an in-memory plan is useful unit coverage but cannot satisfy this requirement.

Alternative considered: create two facade objects over one in-memory store. Rejected because it does not exercise path resolution, plan/Record codecs, store head discovery, or CLI ownership in a fresh process.

### D6: Failure journeys share the same saved source and public boundaries

The negative matrix forks only run inputs/completion outcomes from the same Management-saved Definition and stable compiled plan:

1. A malformed or identity-mismatched completion/effect receipt is submitted through `pipeline complete`. The command/facade rejects it, the Record digest/version remains unchanged, and subsequent status reports the original outstanding action.
2. Domain success is attempted before its required workspace effect is observed. It is rejected without false completion; after a valid observation, the same action can complete normally.
3. The FanOut evaluator selects the declared required member, that member's real effect is observed, and its domain completion reports failure. The reconciler applies required-member failure/Join semantics, the Run cannot take the success Finish path, and every plane projects the same failed/escalated closure.
4. A malformed FanOut result that suppresses or omits the required member is rejected before mutation, proving the public validator does not convert it into an optional branch.

The required-member failure is a separate Run with a distinct `RunId`, derived from a distinct launch request while retaining identical source/capability/plan digests. No alternate failure-only Definition is authored.

Alternative considered: corrupt the fixture or compiled plan to produce failure. Rejected because that would test preparation/integrity rather than the required runtime-member closure requested by the slice.

### D7: CLI, Management, and Operations consume one projected view

The root E2E compares the JSON returned by `pipeline status` with `GET /api/v1/runs/<change>/<run>` at the same committed Record version. Both must expose identical identifiers, status, controls, action/effect states, and versioned sections. The Operations test mounts its real component against that Management-produced `ChangeRunView` and asserts the visible loop, parallel members/Join, waits, actions, evidence identifiers, and terminal state. The component may format labels and short ids, but it cannot derive lifecycle counters, join decisions, or terminal meaning locally.

Tests may share the one server-produced view object or a lossless serialized capture generated by the test setup. They must not maintain a handwritten Operations-specific state fixture that independently encodes the expected lifecycle/parallel result.

Alternative considered: assert equivalent but separately assembled CLI/API/UI objects. Rejected because structural similarity would not prove single-projector ownership.

### D8: Evidence and review gates close the slice without claiming release

Implementation evidence will record the exact shared fixture symbol/path, canonical digests, Run and Action identities, process-boundary ledger, success/failure terminal views, and the commands used. Focused red/green tests cover the facade inconsistency and executable fixture. The final gate includes the complete root suite, full UI suite, root and UI typechecks, build, lint with no new warnings/errors, strict Change validation, and an independent reviewer with zero Blocker/Major findings. Parent portfolio delivery owns the single PR and remote CI; Child 4 leaves ship/archive and that CI checkbox open.

The `auto-decompose` source hash is checked before and after implementation so this 0.2.0 proof cannot silently migrate the 0.3.0 pipeline.

## Risks / Trade-offs

- [Risk] Adding connections makes the existing all-eight fixture exercise more actions than the minimum loop-plus-parallel proof. -> Keep one deterministic route, derive ports through real Canvas handles, and use a bounded driver that reports every granted action rather than hard-coding a brittle count.
- [Risk] A facade observation fix accidentally settles a domain action or admits the next node early. -> Give each completion variant focused red/green tests, assert Record version/action/effect state after observation alone, and retain the existing effect-before-domain invariant.
- [Risk] The trusted test host is mistaken for an automated executor. -> Name it as a manual/evidence driver in artifacts, never spawn an agent runtime, and explicitly list ECP-7 responsibilities in code comments and evidence.
- [Risk] Fresh-process tests become platform-sensitive. -> Use Node process APIs, explicit environment isolation, `path.join`/`path.resolve`, bounded timeouts, and no shell-specific path syntax; run on Windows locally and the parent CI matrix.
- [Risk] Cross-plane assertions duplicate projector semantics in UI expectations. -> Compare server-produced payloads directly and restrict UI assertions to rendering/interaction over that payload.
- [Risk] One large E2E obscures the failing boundary. -> Keep focused facade, preparation/lowering, CLI-store recovery, Management parity, and Operations tests, plus one end-to-end success and one end-to-end failure journey.

## Migration Plan

1. Add discriminating failing tests for the disconnected shared fixture and rejected public observation completions.
2. Extend the mounted Canvas journey and sole fixture with executable typed connections; re-run real preparation/save/reload/digest evidence.
3. Close the facade's existing completion-union dispatch with focused receipt, idempotency, and no-mutation failure tests.
4. Add the trusted vertical driver and success/fresh-process/failure journeys using isolated cross-platform temporary roots and real built CLI processes.
5. Add CLI/Management exact-view parity and Operations consumption evidence, then write the implementation report and run full gates.
6. Rollback is a code/test revert. No stored Definition or Run migration is introduced; the fixture is test data, and the completion variants already exist in the public versioned contract.

## Open Questions

None. The single-oracle rule, trusted manual receipt seam, ECP-7 boundary, and parent-owned delivery are fixed by Direction and prerequisite evidence.
