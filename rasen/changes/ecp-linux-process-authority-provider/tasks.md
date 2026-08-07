> Scope re-tier 2026-08-07 under Direction Step 1 (Target State locked decision 11, including the
> broker-to-0.3.0 handover recorded with it) and locked decision 12 (threat model). Marker
> convention, applied inline at the end of affected task lines:
> `[STAYS-0.2.0]` unchanged 0.2.0 scope (unmarked tasks are STAYS-0.2.0);
> `[NARROWS: ...]` task stays but its 0.2.0 acceptance shrinks as stated;
> `[MOVES-UPGRADE-PATH]` criterion-4 (replacement-safe identity) work, retained in git, no longer
> 0.2.0 acceptance;
> `[MOVES-0.3.0-BROKER]` authenticated installed-broker / cgroup-v2 work, retained in git,
> delivered by the 0.3.0 broker item.
> Tick states are evidence-bound and untouched; no task text was deleted or rewritten - a moved
> task stays visible below. Per-task verdicts, governing reasons, and anchored justifications for
> all 93 tasks: `evidence/step1-task-ledger-retier.md`.

## 1. Baseline and Boundary Locks

- [x] 1.1 Record the implementation start HEAD, targeted `git status`, Direction source revision, archived foundation revision/evidence paths, and architecture-replan digest without normalizing unrelated worktree changes.
- [x] 1.2 Record hashes for the accepted main `process-authority-provider` spec and `test/helpers/process-authority-provider-conformance.ts`; add a verification guard that this Change consumes both unchanged.
- [x] 1.3 Create an implementation file map that assigns the new Linux TypeScript adapter, native helper, broker service/install assets, artifact manifests, tests, and evidence files while excluding ProcessScope default switching, SessionHost integration, PGID removal, macOS, and ECP-8 release truth. [NARROWS: broker service/install assets in this map are 0.3.0-owned surface]
- [x] 1.4 Capture the current legacy ProcessCapsule Linux protocol/capabilities/package tests as migration baseline and add a guard that new provider work does not silently reinterpret `pidfd + process-group` as exact authority.
- [x] 1.5 Capture actual environment facts separately for Windows cross-target and WSL2 Linux, including kernel/WSL identity, Node/pnpm, namespace/pidfd probes, missing WSL cargo/rustc/cc, and the hybrid cgroup layout whose v2 mount lacks required controllers, `cgroup.events`, and `cgroup.kill`.
- [x] 1.6 Add named acceptance-gate records for platform-neutral contract, WSL primary runtime, real cgroup-v2 broker runtime, package/build matrix, closure integration, and ECP-8 release so no narrower receipt can close a broader gate. [NARROWS: the real cgroup-v2 broker runtime gate record moves to 0.3.0; the other gate records and the no-narrower-receipt discipline stay]

## 2. Provider Contract and RED Tests

- [x] 2.1 Add RED tests for the exact `rasen.linux.user-pidns` and `rasen.linux.broker-pidns-cgroupv2` descriptors, protocol/reference versions, complete common semantics, unique provider ids, and exact manifest entries. [NARROWS: broker-pidns-cgroupv2 descriptor coverage moves to 0.3.0; user-pidns coverage stays]
- [x] 2.2 Add RED tests that primary unavailability never selects or contacts the broker and that an exact broker tuple never probes the primary first.
- [x] 2.3 Add RED tests for a closed, bounded primary private-reference codec binding boot id, guardian PID/start ticks, PID namespace device/inode, one-use scope capability, helper protocol, and source identity. [NARROWS: codec stays as the live per-operation control capability; its daemon-restart reattach purpose moves to the upgrade path]
- [x] 2.4 Add RED tests for the broker reference extension binding authenticated install/key identity, broker lease token, and cgroup leaf device/inode, including unknown fields, future versions, tampering, and log-redaction mutations. [MOVES-0.3.0-BROKER]
- [x] 2.5 Add RED lifecycle mapping tests for prepared/published inert, live, exact code-or-signal root exit, exact empty, unavailable, uncertain, identity drift, event gap, timeout, and control loss without expanding the frozen common vocabulary. [NARROWS: the published-inert mapping moves to the upgrade path; the remaining lifecycle mapping stays]
- [x] 2.6 Add a Linux fixture that imports the existing provider-neutral conformance suite unchanged and initially fails its measured mutation snapshot against the unimplemented provider.
- [x] 2.7 Add RED durable-publication tests for no-record prepared state, commit-before-ack, crash after commit/before acknowledgement, crash after acknowledgement/before activate, exact recovered published state, forged/conflicting ledger provenance, and activation without a matching record. [MOVES-UPGRADE-PATH]

## 3. Linux Native Artifact and Closed Protocol

- [x] 3.1 Create `native/linux-process-authority` with pinned Rust settings, committed lockfile, locked `libc` and Ed25519 dependencies, license/provenance accounting, and separate helper and broker binary targets. [NARROWS: crate and helper target stay; broker binary target and its Ed25519 dependency accompany the 0.3.0 broker]
- [x] 3.2 Define the Linux helper protocol constants, closed frame/event schemas, maximum frame/string/vector counts, operation ids, monotonic event sequence, exact code-or-signal status encoding, and explicit protocol/reference versions.
- [x] 3.3 Implement strict launch decoding for a server-resolved absolute executable, absolute cwd, bounded args/env, no PATH resolution, no shell, no caller-supplied authority PID/path, and immutable launch snapshot ownership.
- [x] 3.4 Implement a provider-owned private runtime root and bounded scope-id directory/socket derivation with exact uid, mode, regular/socket type, realpath, symlink, and parent ownership checks outside the workload cwd. [NARROWS: checks stay as install/misconfiguration defence; adversarial check-to-use race hardening is no longer acceptance per locked decision 12]
- [x] 3.5 Implement adjacent native artifact manifest parsing and resolution for exact Linux platform/architecture/mode/protocol/length/hash/compiler/source digest, rejecting escape, symlink, PATH, download, runtime compiler, shell, and legacy-helper fallback.
- [x] 3.6 Add protocol and resolver mutation tests for truncation, oversize, unknown frame/field, duplicate/conflicting sequence, wrong artifact identity, socket escape, insecure modes, and late results.
- [x] 3.7 Add isolated build/output/export seams for the Linux helper and broker artifacts without modifying the meaning or source digest of the legacy ProcessCapsule manifest. [NARROWS: broker artifact seam accompanies the 0.3.0 broker; helper seam and legacy-manifest protection stay]

## 4. Primary Namespace Prepare

- [x] 4.1 Implement native feature probes for user/PID/mount namespaces, uid/gid mapping with `setgroups=deny`, private mount propagation, namespace-correct proc mounting, pidfd open/send/wait support, and required proc identity fields.
- [x] 4.2 Implement bounded parent/child construction that creates the user and mount namespaces, writes exact caller uid/gid maps, forks the child PID namespace guardian as PID 1, and kills/reaps every partial process on failure.
- [x] 4.3 Make mount propagation private and mount a PID-namespace-correct proc view before guardian readiness; verify namespace device/inode and proc identity from both expected viewpoints.
- [x] 4.4 Precreate and transfer only the minimum private control, activation, event, and runtime descriptors to the guardian; close unintended inherited descriptors and verify the endpoint remains inaccessible to the workload.
- [x] 4.5 Implement guardian readiness and prepare attestation containing boot id, outer PID/start ticks, PID namespace device/inode, pidfd proof, mapping/proc proof, helper identity, and a still-closed activation gate.
- [x] 4.6 Implement the TypeScript primary availability transaction that revalidates every attested fact before returning `prepared-inert` and maps denied/unsupported prerequisites to typed unavailable.
- [x] 4.7 Implement exact partial-construction reconciliation for every injected failure point from runtime-directory creation through final revalidation, proving no workload marker and no live guardian remain.
- [x] 4.8 Add unit/integration mutations proving prepare never executes workload code, never publishes an incomplete reference, and never falls back to PGID, session, PID-tree traversal, or sampled descendants.

## 5. Guardian Lifecycle and Exact Membership

- [x] 5.1 Implement exactly-once activation that forks/execs the immutable workload only after the activation frame and confirms the root remains in the guardian PID namespace before reporting live.
- [x] 5.2 Implement the provider runtime bridge over the authenticated private endpoint, opening stdin/stdout/stderr and root/empty event streams before activation without exposing provider-private fields above the existing adapter seam.
- [x] 5.3 Implement namespace PID 1 reaping for the root, orphaned descendants, double-forks, and nested PID-namespace processes with an exact nonblocking child-set oracle.
- [x] 5.4 Emit and durably order `prepared`, `activated`, exact `root-exited`, and `exact-scope-empty` records with a monotonic sequence; fsync terminal state before guardian exit.
- [x] 5.5 Preserve root exit as an exact code XOR signal while descendants remain and emit exact empty only after root exit plus `ECHILD` proves no workload process remains.
- [x] 5.6 Implement natural-empty reopening from the durable terminal record plus exact same-boot guardian state, rejecting missing, corrupt, conflicting, duplicated, or gap-containing records.
- [x] 5.7 Implement guardian unexpected-death classification using pidfd completion and Linux PID-namespace-init teardown semantics, returning exact empty only when the kernel/identity proof completes and retained uncertainty otherwise.
- [x] 5.8 Add native state-machine tests for activation replay, root-status corruption, descendant survival, final-child races, nested namespace lifecycle, guardian owner death, event gaps, and terminal-record crash points.

## 6. Primary Recovery, Inspect, Abort, and Terminate

- [x] 6.1 Implement the primary TypeScript provider factory, exact descriptor, prepare result, runtime opener, and common outcome mapping without registering it as the production ProcessScope default.
- [x] 6.2 Implement private reference creation/decoding with fresh native-owned random generation/scope/control capabilities, TypeScript exact validation and preservation, fixed size/count bounds, one-use generation behavior, and diagnostics limited to the common redacted view; TypeScript MUST NOT generate or backfill those capabilities. [NARROWS: stays for the live control path; the reference's durable reattach purpose moves to the upgrade path]
- [x] 6.3 Implement replacement reopen in the required order: verify envelope/version and boot, derive trusted endpoint, open namespace handle and pidfd, read start/inode, then reread and compare the complete tuple after pidfd open. [NARROWS: stays as the per-operation open/revalidate path; resume-after-daemon-death acceptance moves to the upgrade path]
- [x] 6.4 Distinguish expected PID absence, exact live identity, PID reuse, namespace inode drift, boot drift, inaccessible proc state, and control-endpoint loss without signalling on ambiguous or drifted identity. [NARROWS: drift/reuse refusal stays as destructive-target safety; the replacement-recovery classification purpose moves to the upgrade path]
- [x] 6.5 Implement inspect for prepared/live/root-exited/exact-empty and retained states using guardian journal/control results rather than PID/PGID/descendant sampling.
- [x] 6.6 Implement prepared and published abort by keeping activation closed, signalling only the revalidated guardian pidfd, waiting for exact teardown, and preserving uncertainty for interrupted proof. [NARROWS: prepared abort stays; published abort moves to the upgrade path]
- [x] 6.7 Implement activated termination with bounded graceful root delivery followed by `pidfd_send_signal` of the exact guardian, exact teardown observation, idempotent replay, and no individual descendant signals.
- [x] 6.8 Close the unchanged common conformance suite and provider mutation snapshot for the primary adapter, keeping provider-specific fault injection outside the production factory and shared suite.
- [x] 6.9 Implement the concrete trusted Linux publication ledger and existing common publisher callback with canonical reference reconstruction, exact binding/generation/operation/launch validation, atomic write/fsync, bounded recovery, trusted-root ownership, and acknowledgement only after commit. [MOVES-UPGRADE-PATH]
- [x] 6.10 Keep helper-native state as `inert` and map it to prepared/published only through the exact ledger; require the same ledger proof inside `ProviderPreparedAuthority.activate()` and never add a hidden PUBLISH frame or publication write to activate. [MOVES-UPGRADE-PATH]
- [x] 6.11 Add crash/replacement tests proving publication commit survives lost acknowledgement and pre-activate process death, missing record stays prepared, malformed/conflicting/untrusted ledger stays retained, and recovered published authority is reconciled without silent activation. [MOVES-UPGRADE-PATH]

## 7. WSL2 Actual Primary-Kernel Gate

- [x] 7.1 Provision pinned Rust 1.88.0, cargo, rustc, and a native C linker inside WSL2 Ubuntu 24.04 using an approved reproducible setup; record versions and keep Windows cross-target output out of the runtime evidence directory.
- [x] 7.2 Build the Linux helper natively inside WSL with locked dependencies and isolated output, then verify manifest length/hash/source/compiler and execute the built ELF on that same WSL kernel.
- [x] 7.3 Run and record the successful user+PID+mount namespace, namespace-correct proc, pidfd, and prepare-before-activate oracle on WSL.
- [x] 7.4 Run and record actual `setsid()` plus detached double-fork survival/recursive-kill mutations and prove PGID changes do not affect membership.
- [x] 7.5 Run and record actual `setpgid()` mutations with new groups and resistant descendants, proving inspection, natural empty, and kill use namespace authority.
- [x] 7.6 Run and record an actual nested PID namespace with live nested init/descendants, root exit while nested work remains, and eventual exact empty.
- [x] 7.7 Run and record controller replacement and guardian forced-death mutations, including pidfd reopen/revalidation, kernel teardown, and unrelated-process survival. [NARROWS: forced-death teardown and unrelated-process survival stay; the controller-replacement-resumes-live-authority acceptance moves to the upgrade path; drift refusal stays]
- [x] 7.8 Run and record natural empty, exact code exit, exact signal exit, root-exit-with-live-descendant, recursive force, prepared abort, and published abort actual-kernel oracles. [NARROWS: the published-abort row moves to the upgrade path; the other six named oracles stay]
- [x] 7.9 Run and record PID/start/namespace/boot/reference identity-drift and unavailable-configuration mutations, proving no destructive control targets a replacement or unrelated process.
- [x] 7.10 Run and record actual process replacement in the commit-before-ack and acknowledgement-before-activate windows, proving the durable ledger reports published-inert while the native workload remains unactivated. [MOVES-UPGRADE-PATH]
- [x] 7.11 Publish a WSL primary gate summary that names every command/receipt and limitation; leave broker/cgroup-v2, general distribution/install, packaging-matrix, closure, and ECP-8 gates explicitly open.

## 8. Explicit Installed Broker and Cgroup-v2 Authority

All tasks in this section: [MOVES-0.3.0-BROKER]. Implementation is complete and ticked; code and
evidence are retained in git and are not rolled back. The broker path is delivered by the 0.3.0
broker item and is no longer 0.2.0 acceptance surface. Per-task justifications:
`evidence/step1-task-ledger-retier.md`.

- [x] 8.1 Implement a separate broker provider/client protocol with bounded requests, fresh challenge nonces, Unix peer-credential checks, broker Ed25519 challenge signatures, pinned root-owned public-key manifest validation, and caller authentication.
- [x] 8.2 Add an explicit administrative broker installation layout and idempotent installer/uninstaller that enforce root-owned non-user-writable binary/key/state/socket/service paths and refuse insecure parents, active populated leases, or implicit installation during prepare.
- [x] 8.3 Implement broker startup probes for unified cgroup v2, required controllers/files, writable root-owned service subtree, `cgroup.kill`, `cgroup.events`, namespace operations, durable lease store, and authenticated key material.
- [x] 8.4 Implement a bounded, crash-safe, root-owned lease store keyed by random broker token and binding caller uid, boot id, guardian PID/start, PID namespace inode, cgroup leaf inode, lifecycle phase, and terminal state.
- [x] 8.5 Implement broker preparation that creates a unique root-owned leaf, denies workload/delegated-parent membership writes, constructs the namespace guardian, places it in the leaf, and revalidates leaf/guardian identity before prepared-inert.
- [x] 8.6 Implement broker activation and runtime bridging with the same immutable launch, publish-before-activate, root-exit, event sequence, and exact-natural-empty semantics as the primary path.
- [x] 8.7 Implement broker reopen that reauthenticates the installation, validates the same lease token/key/boot/guardian/namespace/cgroup inode, and distinguishes service restart from token, key, path, and inode drift.
- [x] 8.8 Implement broker terminate/abort using the exact leaf's recursive kill and stable `cgroup.events populated=0` oracle, deleting lease/leaf only after exact empty and retaining ambiguous failures.
- [x] 8.9 Implement broker-death behavior that leaves the root-owned leaf and durable lease intact, fails controls closed while unauthenticated/unavailable, and allows only an authenticated restart to resume the same lease.
- [x] 8.10 Add unit and privileged-fixture mutations for missing install/key/socket/controller, spoofed peer/signature, insecure ownership, leaf migration attempts, token/key/inode drift, crash-store recovery, repeated control, and populated-leaf uninstall refusal.

## 9. Actual Cgroup-v2 Broker Gate

All tasks in this section: [MOVES-0.3.0-BROKER]. The environment gate leaves the 0.2.0 critical
path with the broker (it is unreachable on this host by construction; see
`evidence/section-9-broker-cgroup-gate-availability-lead2.md`). Tasks remain unticked and
unaltered for 0.3.0 pickup. Per-task justifications: `evidence/step1-task-ledger-retier.md`.

- [ ] 9.1 Acquire and record a dedicated reconfigured WSL, Linux VM, or runner with writable unified cgroup v2, required controllers/operations, namespace support, root/admin test authority, and isolation from the ordinary WSL environment; do not use an injected cgroup fixture as terminal evidence.
- [ ] 9.2 Build and install the exact source-owned broker/helper on that runner, verify root ownership/modes/key identity/service peer credentials, and prove an unprivileged caller cannot alter install or lease state.
- [ ] 9.3 Run actual prepare/activate plus setsid, setpgid, double-fork, nested PID namespace, and attempted cgroup migration mutations inside the exact broker leaf.
- [ ] 9.4 Run actual broker kill/restart and client/controller replacement while populated, proving the same durable token and cgroup inode reopen and unrelated cgroups/processes survive.
- [ ] 9.5 Run actual token/key/guardian/PID-namespace/cgroup-inode drift mutations and prove the broker performs no destructive operation against a replacement identity.
- [ ] 9.6 Run actual natural empty, root-exit-with-live-descendants, prepared/published abort, `cgroup.kill`, populated-to-empty convergence, repeated termination, and unavailable-configuration mutations.
- [ ] 9.7 Publish the broker gate summary with kernel/distribution/cgroup mount/service/toolchain/commands/receipts and independent security review; do not mark the broker or Change terminal if any named actual gate is skipped.

## 10. Build, Package, and Cross-Platform Evidence

- [x] 10.1 Add a locked Linux-provider build script with isolated build root, native export/staging seams, source digest, compiler provenance, executable modes, and deterministic manifest ordering.
- [x] 10.2 Add package inclusion for the Linux helper/client manifests and exact provider entries while keeping the separately installed privileged broker binary/private key/state out of an implicit npm install path. [NARROWS: broker-client manifest entries are 0.3.0 surface; helper packaging and the broker-out-of-npm exclusion stay]
- [x] 10.3 Add package resolver tests for missing, foreign, future, wrong-mode, wrong-capability, wrong-length/hash/source, symlink, path escape, insecure permission, runtime compile/download/PATH/shell, and legacy helper fallback mutations.
- [x] 10.4 Add Windows path and package-shape tests using Node path APIs and the installed Linux Rust target for `cargo check`/cross-build evidence, labelling all such results non-runtime.
- [x] 10.5 Add a Linux CI job that provisions the pinned Rust toolchain, builds the provider natively, runs non-privileged primary tests where runner policy permits, and reports namespace-policy skips as open gates rather than passes.
- [x] 10.6 Add broker privileged CI/runner wiring only when the runner explicitly supplies writable cgroup v2 and installed-broker authority; prevent ordinary or forked CI from silently escalating privilege. [MOVES-0.3.0-BROKER]
- [x] 10.7 Verify the existing ProcessCapsule build, manifest, package, provenance, native, replacement, migration, and deadline tests remain unchanged in meaning until closure owns atomic migration.

## 11. Verification, Review, and Closure Handoff

- [ ] 11.1 Run focused TypeScript typecheck and unit/integration suites for descriptors, codecs, resolver, lifecycle mapping, provider adapter, shared conformance, primary native helper, broker client/service, package, and failure mutations. [NARROWS: broker client/service suites leave the 0.2.0 gate with the broker; the rest stays]
- [ ] 11.2 Run native `cargo fmt --check`, locked build/check/test, dependency/license audit, protocol fuzz/bounds tests, and source/artifact provenance checks for helper and broker targets. [NARROWS: 0.2.0 acceptance is the helper target; broker-target gates accompany 0.3.0]
- [ ] 11.3 Run the complete WSL primary matrix from Section 7 fresh and verify every receipt refers to an actual WSL Linux process/kernel rather than Windows launch or injected data. [NARROWS: the fresh re-run covers the retained Section 7 subset; the published-inert and publication-window rows have moved to the upgrade path]
- [ ] 11.4 Run the complete real cgroup-v2 broker matrix from Section 9 fresh; if the environment is unavailable, leave all affected tasks unchecked and report the Change non-terminal. [MOVES-0.3.0-BROKER: moves with Section 9; its non-terminal clause no longer binds 0.2.0 terminal status]
- [ ] 11.5 Run an independent security review focused on namespace construction, inherited descriptors, Unix endpoint authentication, reference/token secrecy, TOCTOU before signals, broker key/install ownership, lease durability, cgroup migration, and destructive target identity; resolve every Blocker/Major. [NARROWS: broker token/key/install/lease/cgroup clauses move with the broker; the remaining foci stay, reviewed under the locked-decision-12 threat model]
- [ ] 11.6 Run an independent spec/implementation review and mutation audit proving all requirements/scenarios are covered, the common spec/suite hashes are unchanged, recovered inert phase comes only from the authentic publication ledger, activate contains no publish side effect, and no PGID/PID-tree/sample claim remains in the new provider. [NARROWS: publication-ledger clauses re-grade to the upgrade path; requirement coverage, common spec/suite hashes, and the no-PGID/PID-tree/sample claims stay]
- [ ] 11.7 Run strict Change validation and targeted root regression/build/package gates proportional to touched code, recording exact commands, counts, environment exceptions, and zero hidden skips.
- [ ] 11.8 Produce the closure handoff with exact provider tuples, reference/protocol versions, manifest/artifact paths, runtime opener, actual evidence links, retained limitations, and explicit remaining closure/ECP-8 gates; do not switch defaults or claim Linux release support in this Change. [NARROWS: must state the primary tuple as 0.2.0 surface, the broker tuple as moved, Step 1 daemon-lifetime semantics, the upgrade-path inventory, and the decision-12 re-grades]
- [ ] 11.9 Run local ship only after every implementation, actual-kernel, verification, and review task in this ledger is complete - including Section 12 and any section appended after this task, with no positional exclusion; create a path-scoped child commit with no push, child PR, production-default switch, or unrelated retained file. [NARROWS: "every ... task in this ledger" excludes tasks marked moved; Section 9 and broker rows no longer gate local ship]
- [ ] 11.10 Immediately archive the locally shipped child through the authoritative archive engine, sync its delta spec, and record the real transaction/accounting result rather than deferring child archive to ECP-8.
- [ ] 11.11 Return terminal Linux evidence to the ECP-7 parent only after real local ship/archive; keep Windows scheduler-pending until Direction selects it, keep macOS decision-deferred, and do not resume native closure or claim release support. [NARROWS: core obligation stays; the Windows clause is overtaken (apply wave in flight) and the macOS clause is superseded by Step 1's explicit best-effort reopen]

## 12. Step 1 Daemon-Lifetime Obligations (post-freeze native wave)

Added 2026-08-07: the Step 1 re-tier surfaced that locked decision 11 created obligations with
no task in this ledger (`evidence/step1-task-ledger-retier.md`, "What this record does NOT
decide"; routing: `handoff/lead-4.md`). This section is one explicit native fault-domain wave:
tasks 12.1-12.2 change frozen crate source under `native/linux-process-authority` and therefore
BREAK the `087d87a5` source-digest freeze; 12.3 is the mandatory re-freeze/re-bind that pays for
it. Do not schedule any part of it without budgeting the whole wave. Nothing here is ticked; no
existing task text or tick state was changed. This section GATES local ship: task 11.9 covers
the whole ledger with no positional exclusion, and gating Section 12 was a LEAD scheduling
decision dated 2026-08-07 (reasoning: without 12.1-12.2 the provider does not establish locked
decision 11's daemon-death => scope-death property, so a ship gate excluding this section would
let the ledger claim semantics the code does not have). Direction can revisit that as a
recorded decision rather than discover it as a fact. The other two Step 1 obligations (typed
`execution-lost` for in-flight actions; the `durable: daemon-lifetime` capability declaration)
are deliberately NOT tasks in this ledger: they belong to `ecp-frozen-action-session-executor`
and are recorded for its proposer in `evidence/step1-obligation-tasks.md`.

- [ ] 12.1 Implement guardian-held inherited-pipe daemon-death teardown: the namespace guardian inherits one private pipe endpoint whose peer only the owning daemon holds, and EOF on that pipe (daemon death) causes the guardian, as PID-namespace init, to exit so the kernel tears down the namespace and kills every member - explicitly the pipe, not `PR_SET_PDEATHSIG`, which fires on thread death and is cleared across setuid/exec. This is scope-death-by-design under locked decision 11, in the same fault domain as the Section 4-5 construction. COST: edits frozen crate source and breaks the `087d87a5` freeze; run only inside this section's post-freeze wave with 12.3 budgeted.
- [ ] 12.2 Add native state-machine tests and a WSL actual-kernel oracle for daemon-death teardown: kill the owning daemon, and separately close only the daemon-side pipe end, while the root plus resistant descendants (setsid, double-fork, nested PID namespace) are live; prove zero workload orphans remain after kernel namespace teardown and that unrelated processes survive; take the discriminating mutation receipt - a teardown-disabled mutant must leave a live orphan and turn the oracle RED. This task establishes the daemon-death => scope-death property that task 7.7's controller-replacement half no longer claims (that half moved to the upgrade path; 7.7's retained forced-death teardown, unrelated-process survival, and drift-refusal receipts stand unchanged as taken). COST: part of the same freeze-breaking wave as 12.1.
- [ ] 12.3 Re-freeze and re-bind after 12.1-12.2 land: re-emit the native manifest (length, hash, source digest, compiler provenance) from the changed crate, record the new frozen source digest as superseding `087d87a5`, enumerate every receipt bound to the superseded digest (full enumeration, no truncated-tail extrapolation), and re-take or explicitly re-bind each one in an evidence re-bind table; ECP-8's zero-orphan receipt consumes only evidence bound to the new digest.
