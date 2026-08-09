## Context

`RECURSIVE_PROCESS_SCOPE_SEMANTICS` in `src/core/session-host/process-authority/types.ts:25-36` is a frozen ten-element array that shipped and archived with `ecp-platform-process-authority-foundation`. It is not a comment. Its per-element positional identity is enforced twice at runtime and copied by hand in four more places:

- `src/core/session-host/process-authority/registry.ts:109-115` rejects any descriptor whose `semantics` array differs in length or at any index.
- `src/core/session-host/process-authority/manifest.ts:61-62` applies the same index-exact comparison to a packaged provider manifest.
- `scripts/build-linux-process-authority.mjs:42-53` and `scripts/build-windows-process-authority.mjs:54-65` each hold an independent literal copy that is emitted verbatim into the shipped `providers.json`.
- `test/core/session-host/linux-process-authority-package-ci.test.ts:341-372` and `test/core/session-host/windows-process-authority-contract.test.ts:63-72` assert the literal array.

So this is a change to a shipped artifact format, not an edit to prose. Two entries in that array are now false, and a third advertises machinery whose purpose left with them.

`workload-non-escape` is false as stated. `rasen/changes/ecp-linux-process-authority-provider/evidence/f-l2-17-linux-escape-demonstration.md` demonstrates on a real kernel, unprivileged, that a workload inside the authority's user + PID + mount namespace can connect to `/run/user/<uid>/bus` and call `org.freedesktop.systemd1.Manager.StartTransientUnit`. The resulting process has a different PID namespace (`4026532287` versus `4026532340`), lives in the host user manager's cgroup tree, is parented to PID 376 (`comm = systemd`), survives complete authority teardown, and never appears in the guardian's `ECHILD` roster. The receipt records six falsifiers, each checked, including a rerun under `env -i` that reconstructs the bus path from the uid alone.

`replacement-recovery` is criterion 4. Direction Step 1 locked decision 11 moved criterion 4 to the upgrade path in full: daemon death is scope death, the in-flight action is typed `execution-lost`, and the Run resumes only from the last committed frontier. `rasen/changes/ecp-linux-process-authority-provider/evidence/step1-task-ledger-retier.md` grades tasks 2.7, 6.9, 6.10, 6.11 and 7.10 `MOVES-UPGRADE-PATH` on exactly that ground.

`publish-before-activate` follows them, by LEAD decision resolving what this Change first filed as an open question. The rows just cited are the durable publication machinery - the ledger, commit-before-ack, and the recovered-published-state reconciliation - and they are what gave the semantic its purpose: a durably published reference is what a replacement controller would have recovered. Retier row 2.5 states the split directly: "the published phase belongs to the three-phase protocol and moves to the upgrade path", while exactly-once activation itself stays via row 5.1. The macOS provider's design (D2 semantics table) already declares `publish-before-activate` as `Not claimed`, with behavioral inertness before activation explicitly provided but not claimed as this semantic - independent corroboration that the semantic and the discipline are separable.

The three land on one frozen array, and the array is compared index-exact, so any edit to any of them forces the same manifest re-emit and the same downstream re-bind. Splitting them across Changes would pay that cost repeatedly.

## Goals / Non-Goals

**Goals:**

- Make the contract state what the implementation measures and what 0.2.0 actually provides.
- Make the narrowed non-escape claim legible at the point where it is read, which is `providers.json`, not a TypeScript comment.
- Retain per-operation destructive-target safety explicitly and normatively, so that deferring replacement recovery cannot take it along.
- Decide the capability-id and contract-version question against evidence rather than reflex, and record the falsifier that would invert the decision.

**Non-Goals:**

- Any behaviour change. No mount-namespace change, no masking of `/run/user/<uid>`, no `pivot_root`, no allowlist, no new probe. Both rejected mitigations are recorded below so nobody re-derives them.
- Any native crate change. The Linux `087d87a5` source freeze and the Windows crate freeze both stay intact, so no re-freeze and no re-bind of crate-bound receipts.
- Deleting the replacement-recovery or publication implementations. Both are retained in version control on the upgrade path, and the coordinator's prepare-publish-activate mechanics keep running unchanged.
- Re-grading, closing, or escalating any open finding on the Linux or Windows provider Changes.
- Touching the legacy ProcessCapsule contract in any way. Its capability list reuses an identical token string; the boundary is a named decision below.

## Decisions

### Rename `workload-non-escape` to `forked-descendant-non-escape` rather than narrow prose only

The cheapest option is to keep the token and narrow only its description. It is rejected. The token is emitted verbatim into `providers.json`, which is the artifact an operator or a future provider author actually reads; prose in `types.ts` does not travel there. The overclaim lead-3 identified is precisely that a reader over-infers the name, so a fix that leaves the name intact does not fix the finding.

The usual argument against renaming is cost: it changes the array, which changes every emitted manifest and every hand-written copy. Here that cost is already being paid, because `replacement-recovery` and `publish-before-activate` are being removed from the same array in the same Change. The marginal cost of the rename is zero. That is what makes it the right call, and it is why all three entries must move together.

`exact-scope-empty` is left exactly as it is. The evidence is explicit that it is accurate as measured: no descendant remains in the exact authority. The residual risk was never the measurement, only a reader inferring "nothing the workload caused still exists" from it, and the spec now says so in the requirement text rather than changing what is measured.

### Do not fix the escape, and record why

The process authority is a janitor, not a sandbox. The agent already runs as the user, on the user's machine, with their credentials, in their repository. F-L2-17 splits into two unrelated situations: a tool subprocess that calls `setsid()` and detaches is caught, and that is exactly what we want caught, because it is an accidental leak of one of our own workers burning tokens; the agent asking `systemd --user` to start a dev server is not caught, and should not be, because the user asked for a dev server and got one.

Rejected, with reasons, so this is not re-derived:

- *Masking `/run/user/<uid>` in the mount namespace.* Actively harmful. It breaks legitimate `systemd-run` and other user-service use, for a threat model this Direction does not have.
- *Building a minimal mount tree via `pivot_root` plus an allowlist.* Reinstates exactly the containment complexity Step 1 removed, to solve a non-problem. Socket-by-socket masking is also a denylist, and this Direction distrusts denylists everywhere else.

There is no third option worth considering, because the gap is any reachable out-of-scope spawner and `systemd --user` is one instance of an open class.

### Hold `rasen-recursive-process-scope/1` and common contract version `1`

The instinct is that removing a guarantee requires a version bump. Applied here it would be wrong, and the reason is a fact about the field rather than a preference.

Nothing in the field binds this capability id. The archived spec's own requirement `Additive migration without platform or release claims` establishes it: the foundation shipped with no production provider registered, existing `rasen-process-scope/1` values stay on the legacy ProcessCapsule path and are never converted, and the portfolio keeps Linux and Windows blocked and macOS deferred until each provider's own local ship and archive complete. Neither provider Change has landed. `step1-task-ledger-retier.md` row 6.1 confirms the primary factory is registered "without registering it as the production ProcessScope default". So there is no shipped release, no persisted durable reference, and no external consumer that relied on either semantic. A version bump exists to protect a reader that does not exist.

Stale artifacts are already handled structurally, which is the part that makes holding the version safe rather than merely cheap. A `providers.json` emitted before this Change carries the ten-element array. `manifest.ts:61-62` compares length and every index against the runtime constant, so a post-change runtime rejects that manifest and fails closed before any preparation. `registry.ts:109-115` does the same for a runtime descriptor. The exact-array comparison is already the enforcement a version bump would have added, and the delta spec now states that behaviour as its own scenario so it is asserted rather than assumed.

The cost of the alternative is real. Bumping to `rasen-recursive-process-scope/2` changes the capability id embedded in both crates' contract surfaces and in every receipt that names the tuple, and lead-4 records that re-freeze plus receipt re-bind is a cycle to be budgeted deliberately, not spent incidentally.

**Falsifier, stated so the decision is testable.** This holds only while no released artifact and no persisted reference carries `rasen-recursive-process-scope/1`. Task 1.2 runs three checks: no published npm tarball ships a `providers.json`; no `dist/native/**` manifest is installed by a released version; no run-state or session-host record persists a `rasen-process-authority/1` reference whose capability id is the recursive-scope one. If any check finds an instance, the decision inverts to a `/2` bump and the Change stops for a LEAD decision rather than proceeding under the old plan.

### Remove `replacement-recovery` from the array; do not retain it as declared-unsupported

Retaining the token with a parallel "unsupported" flag was considered and rejected. A descriptor that lists a semantic it does not provide is the same overclaim being fixed on the other entry, and it collides directly with the archived requirement that a provider offering only a subset of the capability is rejected. Capability honesty in this Direction means the declaration is the truth, not a header to be qualified elsewhere.

Removal is therefore the honest form, and it does not destroy history, because history in this repository lives in git and in the spec record rather than in a runtime constant. The implementation stays on the upgrade path; the delta spec states the deferral normatively inside the requirement text, naming the upgrade path, so the archived contract carries the record that this was moved rather than forgotten.

With both removals the array becomes eight elements and every index after the first shifts. Two existing mutation tests slice the constant (`process-authority-manifest.test.ts:112` uses `.slice(1)`, `process-authority-registry.test.ts:130` uses `.slice(0, -1)`). After the shift `.slice(1)` drops `forked-descendant-non-escape` and `.slice(0, -1)` still drops `event-completeness`, which stays last; both therefore remain strict subsets and remain meaningful mutations, but the validators' length checks now compare against eight, so the task list requires confirming each mutation still fails before the production fix and passes after, rather than assuming a length-relative slice is automatically still meaningful. (An earlier draft of this document claimed `.slice(0, -1)` would drop `identity-drift-detection`; that was wrong - the slice drops the last element, and the last element does not change.)

### Retain reopen-and-revalidate as its own requirement, not as a footnote

This is the single largest risk in the Change and the design answers it structurally rather than with a warning comment.

On the Linux provider, every control verb is a separate helper process that consumes the private reference and reopens and revalidates the complete identity tuple before acting. `step1-task-ledger-retier.md` rows 2.3, 6.2, 6.3 and 6.4 all grade `NARROWS`, not `MOVES`, for exactly this reason, and lead-4 correction 2 calls it "the most load-bearing correction in this document": the same machinery is simultaneously the retained intra-lifetime destructive-target-safety path and the criterion-4 reattach path. A scope cut phrased as "remove reattach" and applied mechanically takes destructive-target safety with it.

The mitigation is a named boundary plus a positive requirement.

The boundary: `replacement-recovery` in this contract means one thing only, that a **new controller process, after the original controller died, resumes live authority over an already-published scope**. It does not mean "reopen and revalidate a reference before acting", which happens inside one controller lifetime, on every verb, and stays.

The positive requirement: the delta adds `Per-operation authority revalidation is retained independently of replacement recovery`, which states the retained ordering and the drift refusal as normative text and includes a scenario that declares a future change removing them to be a contract violation. Retaining it as its own requirement rather than as a clause inside a lifecycle requirement means a later mechanical edit to the lifecycle requirement cannot delete it as a side effect. `Identity drift forbids control` also changes its trigger from "recovery finds" to "an operation finds", so the drift refusal no longer reads as recovery machinery.

### Remove `publish-before-activate` too, and protect activation discipline the same way revalidation was protected

This is lead-4 correction 2's shape recurring on a third entry, and it gets the same structural answer.

The named boundary: `publish-before-activate` as an advertised capability semantic meant that a durably published reference gates activation - the first leg of the three-phase protocol whose consumer was a replacement controller recovering the published record. That purpose left with criterion 4. What does not leave: pre-activation workload inertness and exactly-once explicit activation, which are enforced independently of publication. `process-scope-adapter.ts:181` refuses a second activation with a local `activated` flag **before** the publication call at line 184 ever runs, and the coordinator settles activation exactly once per retier row 5.1. The coordinator's prepare-publish-activate mechanics themselves keep running unchanged - code doing more than the spec advertises is fine; a spec advertising more than the release does is the defect this Change exists to fix.

The positive requirement: the delta adds `Exactly-once explicit activation is retained independently of publication semantics`, standalone for the reason already established for revalidation - a clause buried inside the ordering requirement dies with the next mechanical edit. Its first scenario is anchored on the adapter's refusal happening before any provider or publication dispatch, and its final scenario declares a removal of activation discipline on deferral grounds to be a contract violation. The `Bounded prepare, publish, and activate ordering` requirement is retained in the delta with all seven scenarios verbatim and its prose reframed: the ordering is retained coordinator mechanics, not an advertised semantic, and the fixture publisher may be non-durable as the conformance requirement already provides.

Alternative considered: also delete the ordering requirement and its publication scenarios from the spec. Rejected - the behaviour they describe still runs on every activation and is still exercised by the shipped conformance harness, so deleting them would make the spec claim less than the system verifiably does, which is the same class of dishonesty as claiming more, and it would force behaviour-adjacent edits to the frozen conformance helper that this Change has no license for.

### The legacy ProcessCapsule capability list is a different contract and is out of bounds

Three consumers of the *identical token string* `publish-before-activate` belong to a different contract and MUST NOT change, verified directly rather than taken from the sweep that found them:

- `src/core/session-host/process-capsule/resolver.ts:13` - `REQUIRED_CAPABILITIES` under `rasen-process-capsule-manifest/1`, alongside `opaque-ref`, `exact-process-birth`, and `root-exit-scope-empty-v2`. This is ProcessCapsule protocol v2, not the recursive-scope capability.
- `scripts/build-process-capsule.mjs:56` - the same list emitted into the legacy capsule manifest.
- `test/core/session-host/process-capsule-package.test.ts:17` - the same list asserted.

The archived `Additive migration without platform or release claims` requirement says legacy values are preserved under the legacy path and never converted, so the token must keep meaning there what it always meant. The boundary is also structurally enforced: all three files are hash-pinned by `LEGACY_PROCESS_CAPSULE_INPUTS` in `test/core/session-host/linux-process-authority-boundary-guards.test.ts:14-29`, so an accidental "grep-and-remove" edit trips the legacy freeze guard immediately. The related `durable-process-scope-authority` spec (`rasen/changes/ecp-native-process-capsule-closure/specs/durable-process-scope-authority/spec.md:126`) names "the publish-before-activate discriminator" for that legacy contract and is equally untouched.

The trap for the next person is that the token is byte-identical across the two contracts, which is exactly what makes the wrong edit invisible. Every grep task in this Change therefore classifies hits by contract, and the enumeration below records the ProcessCapsule hits as MUST-NOT-CHANGE rather than omitting them.

### Sequence the two frozen-input rebaselines separately, because they become knowable at different times

`test/core/session-host/linux-process-authority-boundary-guards.test.ts:7-12` and `test/core/session-host/windows-process-authority-package-ci.test.ts:35-40` both pin two byte hashes: `rasen/specs/process-authority-provider/spec.md` at `05257eb1860aa40ce06a2289b63348e21a81187f4df4fd4aff346e7e8ac57d5a` and `test/helpers/process-authority-provider-conformance.ts` at `2e952cde167a72e195e437e45cfa870c5130e29de2cd09c8341ca5c0b93f8b60`. Both were verified as currently matching before this Change was written.

The conformance-helper hash becomes knowable during implementation, because that file is edited during implementation. The main-spec hash does not, because `rasen/specs/process-authority-provider/spec.md` changes only when this Change's delta is synced at archive. The sibling `process-authority-prepare-unavailability-outcome` hit the same shape and handled it as its task 4.3, rebaselining from the archived contract rather than from a predicted one. This Change follows that shape: the helper hash is updated in the same commit as the helper edit so the tree is never knowingly left red, and the spec hash is updated after archive from measured bytes.

Neither update is a weakening. Those guards exist to stop a provider implementer from drifting the accepted common inputs unilaterally. Recording a new hash from a contract change that went through its own review is the mechanism working as designed, which is why the task requires re-deriving the hash from the file rather than pasting one.

### The conformance case named for replacement recovery is renamed, not deleted

`test/helpers/process-authority-provider-conformance.ts:249-271` is titled `preserves %s during replacement recovery`, but its body prepares, optionally publishes, and then inspects through the **same** coordinator. It never constructs a replacement controller. It is an inert-phase preservation assertion with a misleading label, so the retained behaviour is real and only the name overclaims. The rename changes no assertion, so the receipt it takes stands and does not need re-taking. Leaving the old label would reintroduce, inside the shared harness that macOS is about to consume, the exact self-contradiction this Change exists to remove.

## Risks / Trade-offs

- **A mechanical reading of "remove replacement-recovery" deletes destructive-target safety.** This is the biggest risk in the Change. Mitigation: the named boundary above, plus a standalone ADDED requirement whose final scenario declares such a removal a contract violation, plus task 5.3 which verifies the opaque envelope, the revalidation ordering and the drift refusal are all still present and asserted after the edits land.
- **A mechanical reading of "remove publish-before-activate" deletes activation discipline.** Same shape, same structural answer: the second standalone ADDED requirement anchored on `process-scope-adapter.ts:181`, plus task 5.3's verification that the adapter refusal and the coordinator's exactly-once settlement remain present and asserted.
- **The identical token string exists in a second contract.** A tree-wide grep-and-remove of `publish-before-activate` would silently edit the legacy ProcessCapsule list and break a contract this Change has no license to touch. Mitigation: the named boundary decision above; every grep task classifies hits by contract; the ProcessCapsule files are hash-pinned by `LEGACY_PROCESS_CAPSULE_INPUTS`, so the guard also fails loudly if the boundary is crossed; and task 5.6 verifies the three files are byte-identical to baseline at the end.
- **Holding capability version 1 while changing what it means.** Mitigation: the three-check falsifier in task 1.2 runs before the constant is edited and inverts the decision if any field instance exists; plus the new `Provider advertises a retired semantic` scenario, which makes the fail-closed rejection of a stale ten-element manifest an asserted behaviour rather than an assumed one.
- **The four hand-written copies of the array drift from the constant.** Two are build scripts that produce shipped artifacts, so a missed one emits a manifest the runtime will then reject at install time, which is a confusing failure far from its cause. Mitigation: task 5.1 greps the whole tree for both retired tokens and requires the result to be empty except for historical evidence documents, which are deliberately not rewritten.
- **Rewriting history in evidence files.** Not done, and deliberately so. Receipts stand as taken; the ledger and gate rows keep their original wording and gain a disposition note rather than an edit. The audit trail is worth more than uniform vocabulary.
- **The Windows sibling is mid-re-freeze.** This Change touches no native source, so the two do not collide. Task 1.3 confirms that before starting, rather than assuming it.
- **CI is briefly red between archive and the spec-hash rebaseline.** Accepted, matching the sibling Change's sequencing, and bounded by making the rebaseline the first post-archive act.

## Migration Plan

No data migration and no runtime migration. No persisted value changes shape, because no persisted value binds this capability id.

Artifact migration is fail-closed and needs no code: a `providers.json` emitted before this Change is rejected by index-exact comparison at manifest validation, so a stale artifact next to a new runtime cannot be silently accepted. Rebuilding the native artifacts re-emits the manifest with the nine-element array.

Rollback is a git revert of a single-constant edit plus its four literal copies and the guard hashes. Nothing is deleted, so nothing needs restoring.

## Open Questions

Resolved since the first draft: whether `publish-before-activate` belongs in the array was this document's original first open question; the LEAD decided it and the decision is now in the Decisions section above.

1. **Where do Step 1's own unwritten obligations land?** `step1-task-ledger-retier.md` disagreement 5 records that inherited-pipe-EOF teardown, typed `execution-lost`, and the `durable: daemon-lifetime` capability declaration have no task anywhere. The third of those is a capability declaration and is adjacent to this contract, but the retier record is explicit that the placement decision is the LEAD's. This Change does not claim it.
2. **Does the macOS provider Change need to wait for this to archive?** `rasen/changes/ecp-macos-process-authority-provider/planning-context.md:85-96` says its capability declaration must not be written against a mid-flight contract. Sequencing is the LEAD's, but the dependency is real and one-directional. Its design's D2 semantics table already anticipates both pending edits and declares against neither version of the constant, so the wait is about the archived truth, not about redrafting.
