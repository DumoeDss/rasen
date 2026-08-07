> Scope re-tier 2026-08-07 under Direction Step 1 (Target State locked decision 11, including the
> broker-to-0.3.0 handover recorded with it) and locked decision 12 (threat model). Marker
> convention, identical to the legend at the top of `tasks.md`:
> `[STAYS-0.2.0]` unchanged 0.2.0 scope (an unmarked requirement is STAYS-0.2.0 in full);
> `[NARROWS]` the requirement stays but its 0.2.0 acceptance shrinks exactly as the marker states;
> `[MOVES-UPGRADE-PATH]` criterion-4 (replacement-safe identity) work, retained here, no longer
> 0.2.0 acceptance;
> `[MOVES-0.3.0-BROKER]` authenticated installed-broker / cgroup-v2 work, retained here, delivered
> by the 0.3.0 broker item.
> No requirement or scenario text was deleted or rewritten and no requirement or scenario was
> renamed; the markers are additive `**Scope**:` lines appended to the requirement body, and they
> classify every scenario by name. All 11 requirements and all 47 scenarios were graded; 2
> requirements (`Namespace membership prevents recursive escape`, `Native artifacts have adjacent
> integrity and build provenance`) are STAYS-0.2.0 in full and are therefore unmarked.
> WARNING - this preamble does NOT project into the main spec: `rasen archive` / `rasen sync-specs`
> copy only the `### Requirement:` blocks. That is why every marker also lives inside its
> requirement body, where projection carries it. Per-task verdicts and governing reasons:
> `evidence/step1-task-ledger-retier.md`.

## ADDED Requirements

### Requirement: Linux authority is selected by an exact manifest-bound provider tuple
The system SHALL expose Linux recursive process authority only through an exact registered provider id, recursive-scope capability id, protocol version, common-contract version, provider-reference version, complete semantic list, and adjacent artifact identity. The unprivileged namespace provider and privileged broker provider SHALL have different provider ids and SHALL be selected explicitly; failure of one SHALL NOT select the other.

**Scope**: [NARROWS] Step 1 re-tier 2026-08-07 (`evidence/step1-task-ledger-retier.md`, task 2.1).
0.2.0 acceptance is the primary `rasen.linux.user-pidns` tuple; the broker provider id, its exact
tuple, and its explicit selection are delivered by the 0.3.0 broker item. The fail-closed
"failure of one SHALL NOT select the other" clause stays (task 2.2, capability honesty). Per
scenario: `Exact primary provider is selected` [STAYS-0.2.0]; `Exact broker provider is selected`
[MOVES-0.3.0-BROKER]; `Tuple mismatch fails closed` [STAYS-0.2.0]; `Non-Linux runtime does not
promote a cross-built artifact` [STAYS-0.2.0].

#### Scenario: Exact primary provider is selected
- **WHEN** a frozen Linux execution requests the exact `rasen.linux.user-pidns` provider tuple present in the validated manifest
- **THEN** the coordinator selects that provider with the complete recursive-scope semantics
- **AND** preparation uses only its declared adjacent Linux artifact

#### Scenario: Exact broker provider is selected
- **WHEN** a frozen Linux execution explicitly requests the exact `rasen.linux.broker-pidns-cgroupv2` tuple and the installed provider is manifest-bound
- **THEN** the coordinator selects the broker provider rather than probing the primary provider first

#### Scenario: Tuple mismatch fails closed
- **WHEN** provider id, capability id, protocol version, common-contract version, reference version, semantics, or artifact identity differs from the manifest
- **THEN** preparation returns typed `authority-unavailable`
- **AND** no workload code and no alternate provider starts

#### Scenario: Non-Linux runtime does not promote a cross-built artifact
- **WHEN** a Linux provider artifact is inspected or cross-compiled on a Windows or macOS runtime
- **THEN** it is treated as build or fixture evidence only
- **AND** the runtime cannot select it as actual Linux authority

### Requirement: Primary prepare establishes a complete inert namespace authority
The primary provider SHALL create and prove the user, PID, and supporting mount namespace guardian, namespace-correct process view, exact guardian identity, pidfd, private control endpoint, immutable launch snapshot, and closed activation gate before returning `prepared-inert`. A failed or unavailable prerequisite SHALL be reconciled without executing workload code and SHALL NOT fall back to a process group, process session, PID tree, or sampled descendant set.

**Scope**: [NARROWS] Step 1 re-tier 2026-08-07 (`evidence/step1-task-ledger-retier.md`, tasks
4.1-4.8 stay; 2.7 / 6.10 move). Prepare construction, the still-closed activation gate, typed
unavailability, and exact partial-construction reconciliation are 0.2.0 acceptance. What leaves is
publish-before-activate: the requirement that activation waits on a durable publication
acknowledgement is criterion-4 machinery and is no longer 0.2.0 acceptance. Per scenario:
`Successful prepare stays inert` [STAYS-0.2.0]; `Publication precedes activation`
[MOVES-UPGRADE-PATH]; `Unprivileged namespace policy is unavailable` [STAYS-0.2.0]; `Prepare probe
becomes ambiguous` [STAYS-0.2.0].

#### Scenario: Successful prepare stays inert
- **WHEN** all required Linux namespace, mapping, mount, pidfd, identity, endpoint, and helper-integrity probes succeed
- **THEN** prepare returns a fresh `prepared-inert` authority reference
- **AND** the namespace guardian exists as PID 1 in the new PID namespace
- **AND** the workload command has not executed

#### Scenario: Publication precedes activation
- **WHEN** authority is prepared and its common reference has not received an exact durable publication acknowledgement
- **THEN** the activation gate remains closed and workload code cannot run
- **AND** an acknowledgement mismatch is reconciled through abort without activation

#### Scenario: Unprivileged namespace policy is unavailable
- **WHEN** user or PID namespace creation, uid/gid mapping, private mount setup, namespace-correct proc mount, or pidfd opening is denied or unsupported
- **THEN** prepare returns typed `authority-unavailable` after exact partial-construction cleanup
- **AND** it neither contacts the broker nor uses PGID or PID-tree authority

#### Scenario: Prepare probe becomes ambiguous
- **WHEN** any required identity or construction probe changes, times out, or cannot be revalidated before the prepared reference is returned
- **THEN** the provider retains a typed failure for the prepare phase
- **AND** no prepared reference is published and no workload code executes

### Requirement: Durable publication truth projects the recovered inert phase
The system SHALL use one concrete trusted durable publication ledger with the existing common publisher callback to distinguish a provider-native inert authority that is prepared from one whose exact common reference is published. The ledger SHALL bind the canonical full-reference digest, preparation operation id, publication version, provider generation, and immutable launch digest, SHALL commit before returning acknowledgement, and SHALL be revalidated before activation or recovered phase reporting. Native activation SHALL NOT create, imply, or replace publication truth.

**Scope**: [MOVES-UPGRADE-PATH] Step 1 re-tier 2026-08-07 (`evidence/step1-task-ledger-retier.md`,
tasks 2.7 / 6.9 / 6.10 / 6.11 / 7.10; findings WSL-R4-M04 and WSL-R4-M06 travel with it). This
requirement is the durable half of the prepared -> published -> activate three-phase protocol,
which exists for criterion 4 (replacement-safe identity). Under locked decision 11 scope lifetime
is daemon lifetime, so none of it is 0.2.0 acceptance. Implementation, tests and receipts are
retained in git and this text is retained in full. All five scenarios move: `Prepared inert has no
publication record`, `Publisher commits before acknowledgement`, `Process crashes after
publication commit`, `Activation checks durable publication`, `Publication ledger is forged or
ambiguous` - each [MOVES-UPGRADE-PATH].

#### Scenario: Prepared inert has no publication record
- **WHEN** the guardian reports native inert and the trusted ledger proves no publication record exists for the exact reference generation
- **THEN** provider inspection reports `prepared-inert`
- **AND** activation remains unavailable

#### Scenario: Publisher commits before acknowledgement
- **WHEN** the common publisher receives the exact binding
- **THEN** it atomically commits and fsyncs the exact ledger record before returning the matching acknowledgement
- **AND** the acknowledgement does not itself create native activation

#### Scenario: Process crashes after publication commit
- **WHEN** the publisher commits the exact record and the process crashes before acknowledgement delivery or before the later activate call
- **THEN** replacement inspection reconstructs the canonical reference digest and reports `published-inert`
- **AND** the recovered owner may reconcile/terminate it without executing workload code

#### Scenario: Activation checks durable publication
- **WHEN** the in-memory published authority invokes provider activation
- **THEN** the provider verifies one exact durable ledger record for its preparation operation, generation, and launch digest before opening the native activation gate
- **AND** no hidden publish command is sent as part of activation

#### Scenario: Publication ledger is forged or ambiguous
- **WHEN** the ledger source is structurally forged, unavailable, malformed, conflicting, wrong-generation, wrong-operation, or bound to a different launch/reference digest
- **THEN** inspect or activate returns retained authority uncertainty, event gap, or control loss
- **AND** the workload remains inert and no exact-empty receipt is fabricated

### Requirement: Namespace membership prevents recursive escape
Every activated root and descendant in the primary provider SHALL remain inside the guardian's parent PID namespace for the authority lifetime. Session changes, process-group changes, double-forking, reparenting, and workload-created nested PID namespaces SHALL NOT remove a live process from that recursive authority.

#### Scenario: Workload calls setsid
- **WHEN** the root or a descendant calls `setsid()`, changes its process group, double-forks, and keeps running
- **THEN** the process remains a member of the guardian's PID-namespace authority
- **AND** recursive termination reaches it without PID-tree enumeration

#### Scenario: Workload calls setpgid
- **WHEN** a descendant creates or joins a different process group with `setpgid()`
- **THEN** inspection still reports the same authority live
- **AND** natural-empty and recursive-kill decisions do not depend on the descendant's PGID

#### Scenario: Workload creates a nested PID namespace
- **WHEN** an authorized descendant creates a nested PID namespace and leaves processes running inside it
- **THEN** those processes remain visible within the guardian's ancestor PID namespace
- **AND** the outer authority cannot report exact empty until the nested processes are gone

### Requirement: Root exit and exact scope empty are distinct exact facts
The provider SHALL report the activated root's exact exit code or exact terminating signal once, while continuing to own and reap surviving descendants. It SHALL report `exact-scope-empty` only from a positive namespace or broker membership oracle proving no workload member remains; root exit, guardian transport closure, a missing sampled PID, or a quiet polling interval SHALL NOT substitute for that proof.

**Scope**: [NARROWS] Step 1 re-tier 2026-08-07 (`evidence/step1-task-ledger-retier.md`, tasks 5.4 /
5.5 / 5.7 stay). Only one clause leaves: the "or broker membership oracle" alternative in the
second sentence is the 0.3.0 broker's cgroup-v2 oracle. For 0.2.0 the positive membership oracle
is the namespace one, and the no-substitute rule is retained verbatim. All four scenarios stay:
`Root exits while a descendant remains`, `Scope becomes naturally empty`, `Root status is
malformed or lost`, `Guardian dies with namespace members` - each [STAYS-0.2.0].

#### Scenario: Root exits while a descendant remains
- **WHEN** the root exits with an exact code or signal and a detached, reparented, or nested descendant remains live
- **THEN** inspection reports `root-exited` with exactly one non-null code-or-signal branch
- **AND** exact-scope-empty observation remains pending or live

#### Scenario: Scope becomes naturally empty
- **WHEN** the root and every descendant exit naturally and the namespace guardian reaps the final child
- **THEN** the provider emits the root result if not already emitted
- **AND** emits one authentic `exact-scope-empty` outcome based on the exact child-set oracle

#### Scenario: Root status is malformed or lost
- **WHEN** the native event stream supplies neither an exact exit code nor an exact signal, supplies both, or has a sequence gap around root exit
- **THEN** the provider returns `control-loss` or `event-gap`
- **AND** retains authority without producing exact empty

#### Scenario: Guardian dies with namespace members
- **WHEN** the namespace PID 1 guardian is forcibly killed while workload members exist
- **THEN** the Linux kernel tears down the PID namespace and kills its members
- **AND** the provider returns exact empty only after pidfd/identity/kernel teardown proof, otherwise it retains a typed uncertain result

### Requirement: Abort and recursive termination converge on exact authority empty
The provider SHALL implement prepared abort, published abort, activated termination, and repeated reconciliation against the namespace or cgroup authority itself. It SHALL use bounded graceful policy only before an exact forced authority operation and SHALL return an exact-empty receipt only after the exact authority reports empty.

**Scope**: [NARROWS] Step 1 re-tier 2026-08-07 (`evidence/step1-task-ledger-retier.md`, tasks 6.6 /
7.8; finding WSL-R4-M04). Two clauses leave. "published abort" travels with the publication
machinery to the upgrade path; "or cgroup authority" is the 0.3.0 broker leaf. Prepared abort,
activated termination, repeated reconciliation against the namespace authority, bounded-graceful-
before-forced ordering, and the exact-empty receipt rule are 0.2.0 acceptance. Per scenario:
`Prepared authority is aborted` [STAYS-0.2.0]; `Published inert authority is aborted`
[MOVES-UPGRADE-PATH]; `Recursive force follows session and namespace escape attempts`
[STAYS-0.2.0], except its "or broker cgroup authority" alternative [MOVES-0.3.0-BROKER];
`Termination proof is interrupted` [STAYS-0.2.0].

#### Scenario: Prepared authority is aborted
- **WHEN** abort is requested after prepare and before publication
- **THEN** the activation gate remains closed, the guardian and partial authority are destroyed, and exact empty is observed
- **AND** workload code never executes

#### Scenario: Published inert authority is aborted
- **WHEN** publication succeeds but runtime-bridge opening or later activation setup fails
- **THEN** abort destroys the still-inert authority and returns exact empty when proven
- **AND** the workload command remains unexecuted

#### Scenario: Recursive force follows session and namespace escape attempts
- **WHEN** an activated scope contains roots or descendants that ignore graceful signals, use new sessions/groups, or create a nested PID namespace
- **THEN** forced termination operates on the revalidated namespace guardian or broker cgroup authority
- **AND** returns exact empty only after all members are gone

#### Scenario: Termination proof is interrupted
- **WHEN** the control channel, pidfd wait, cgroup event read, or deadline fails before exact empty is proven
- **THEN** the outcome is retained as timeout, control-loss, authority-uncertain, or identity-drift
- **AND** a later exact reconciliation may resume from the same reference

### Requirement: Durable references reopen only the same Linux authority
Every provider-private reference SHALL be fresh, versioned, bounded, sensitive, and canonically integrity-bound by the common envelope. The envelope digest detects corruption and tuple drift but is not signer authority; control authenticity SHALL come from revalidating the provider-owned capability, endpoint, ledger, or broker lease against the live authority. Native preparation SHALL generate the random one-use scope id/common generation plus independent scope and control capabilities; TypeScript SHALL validate and preserve the exact attested values and SHALL NOT generate or backfill them. A primary reference SHALL bind provider path, boot id, guardian PID/start identity, PID namespace device/inode, both capabilities, and helper protocol/source identity. A broker reference SHALL additionally bind the authenticated broker installation/key, broker lease token, and cgroup-v2 leaf device/inode. Replacement inspection or control SHALL open pidfd/namespace or broker lease handles and immediately revalidate the complete identity before using them.

**Scope**: [NARROWS] Step 1 re-tier 2026-08-07 (`evidence/step1-task-ledger-retier.md`, tasks 2.3 /
6.2 / 6.3 / 6.4 narrow; task 2.4 moves). This requirement MUST NOT be read as moving whole. On
this provider every control verb is a fresh helper process that consumes the private reference and
reopens/revalidates identity before acting, so the codec, the native-owned one-use capabilities,
the TypeScript-must-not-generate-or-backfill rule, the primary binding list, and the
open-then-revalidate ordering are the LIVE per-operation control path and the destructive-target
safety mechanism - all 0.2.0 acceptance. What leaves is purpose, not mechanism: the reference's
durable reattach purpose, i.e. resuming authority after the owning daemon dies, is criterion 4
[MOVES-UPGRADE-PATH]. The broker-reference sentence (authenticated install/key, lease token,
cgroup-v2 leaf inode) and the "or broker lease handles" alternative are [MOVES-0.3.0-BROKER]. Per
scenario: `Exact replacement recovery succeeds` [MOVES-UPGRADE-PATH] (its broker-lease branch also
[MOVES-0.3.0-BROKER]); `PID is reused` [STAYS-0.2.0]; `Boot identity changes` [STAYS-0.2.0];
`Reference bytes are tampered or future-versioned` [STAYS-0.2.0]; `Expected guardian is absent
without a conflicting identity` [STAYS-0.2.0] (same-boot, same-daemon natural-empty reopen, task
5.6). A scope cut phrased as "remove reattach" and applied mechanically to this requirement would
take destructive-target safety with it.

#### Scenario: Exact replacement recovery succeeds
- **WHEN** the original TypeScript provider/controller exits and a replacement receives an authentic reference on the same boot
- **THEN** the replacement opens the guardian pidfd and namespace handle or the authenticated broker lease
- **AND** rereads the full stable identity before reporting or controlling the existing scope

#### Scenario: PID is reused
- **WHEN** the referenced guardian PID now has a different start identity or PID namespace inode
- **THEN** inspection and control return `identity-drift`
- **AND** no signal or destructive cgroup operation is issued to the new process

#### Scenario: Boot identity changes
- **WHEN** a reference from a prior Linux boot is reopened
- **THEN** the provider returns `identity-drift` or `authority-unavailable`
- **AND** does not treat a matching numeric PID or path as authority

#### Scenario: Reference bytes are tampered or future-versioned
- **WHEN** the common envelope, provider-private payload, version, length, discriminator, token, or bounded field is malformed or unsupported
- **THEN** recovery fails closed before native control
- **AND** the sensitive full reference is absent from diagnostics and logs

#### Scenario: Expected guardian is absent without a conflicting identity
- **WHEN** an authentic same-boot reference is reopened after its exact guardian PID has exited and no conflicting live identity occupies it
- **THEN** the provider applies the Linux PID-namespace-init teardown oracle and durable terminal record rules
- **AND** returns exact empty only when those rules positively prove the old scope empty

### Requirement: Privileged broker authority is explicit, authenticated, and non-migratable
The broker provider SHALL operate only as a separately installed, explicitly selected provider. It SHALL mutually authenticate the local client and root-owned broker installation, create the workload guardian inside a unique root-owned cgroup-v2 leaf before activation, prevent workload migration out of that leaf, and use the stable leaf plus lease token as an independently reopenable exact membership and kill boundary.

**Scope**: [MOVES-0.3.0-BROKER] Step 1 re-tier 2026-08-07 (`evidence/step1-task-ledger-retier.md`,
all of Sections 8 and 9 plus tasks 2.4 / 10.6 / 11.4; findings NATIVE-SEAM-R1-M01, M02,
BRK-R2-B01, BRK-R2-B02-M03, and the broker half of BRK-R2-B06 travel with it). The authenticated
installed broker and its non-migratable cgroup-v2 authority are delivered by the 0.3.0 broker item
and are not 0.2.0 acceptance. Implementation is complete, ticked and retained in git; the Section 9
actual-kernel gate is unreachable on the current host by construction. ONE SCENARIO IS EXCEPTED
AND STAYS: `Primary failure does not invoke broker` [STAYS-0.2.0] - task 2.2, capability honesty,
`authority-unavailable` must never silently reroute, and with the broker in 0.3.0 an exact broker
tuple must still fail typed rather than probe the primary. The other six move: `Broker
installation is missing or unauthenticated`, `Broker creates a non-migratable leaf`, `Workload
attempts cgroup migration`, `Broker dies and restarts`, `Broker token or leaf inode drifts`,
`Broker recursively kills and proves empty` - each [MOVES-0.3.0-BROKER].

#### Scenario: Primary failure does not invoke broker
- **WHEN** the primary user/PID namespace provider returns unavailable
- **THEN** the same preparation ends unavailable
- **AND** no broker socket, service, installation, or privileged operation is contacted implicitly

#### Scenario: Broker installation is missing or unauthenticated
- **WHEN** the broker socket, root-owned install manifest, peer credentials, challenge signature, pinned key, cgroup-v2 controller, durable store, or required operation is missing or invalid
- **THEN** broker prepare returns `authority-unavailable` before workload code executes

#### Scenario: Broker creates a non-migratable leaf
- **WHEN** authenticated broker prepare succeeds
- **THEN** the guardian is placed in a unique root-owned cgroup-v2 leaf before activation
- **AND** workload credentials cannot write the leaf or any delegated parent membership control
- **AND** the reference binds the broker lease token and exact leaf inode

#### Scenario: Workload attempts cgroup migration
- **WHEN** the workload attempts to write itself or a descendant into another cgroup
- **THEN** the migration is denied and every member remains inside the broker's leaf authority

#### Scenario: Broker dies and restarts
- **WHEN** the broker service dies while the leaf remains populated
- **THEN** the authority remains retained and the root-owned leaf continues containing the workload
- **AND** only an authenticated restart that reopens the same durable token and inode may resume observation or control

#### Scenario: Broker token or leaf inode drifts
- **WHEN** a replacement broker presents a different lease token, key identity, or cgroup inode at the same apparent path
- **THEN** the provider returns identity drift and performs no destructive operation on the replacement leaf

#### Scenario: Broker recursively kills and proves empty
- **WHEN** termination is requested for an exact authenticated broker lease
- **THEN** the broker uses the leaf authority's recursive kill operation
- **AND** returns exact empty only after the same leaf reports `populated=0`

### Requirement: Linux provider failures remain bounded and retained
Every prepare, publish, activate, inspect, terminate, abort, and exact-empty observation SHALL honor the common deadline and abort context, use bounded native frames and records, settle once, and map uncertainty into the frozen common outcome vocabulary. A late, duplicated, conflicting, or unavailable result SHALL NOT release authority or settle a later generation.

**Scope**: [NARROWS] Step 1 re-tier 2026-08-07 (`evidence/step1-task-ledger-retier.md`, task 2.5).
One item in the verb list leaves: `publish` is part of the moved publication machinery, so
publish-phase deadline and outcome mapping is no longer 0.2.0 acceptance. Every other verb -
prepare, activate, inspect, terminate, abort, exact-empty observation - keeps the deadline,
bounded-frame, settle-once and frozen-vocabulary obligations, and the late/duplicate/conflicting
rule stays whole. All three scenarios stay: `Each lifecycle phase times out`, `Native transport
fails`, `Late or duplicate result arrives` - each [STAYS-0.2.0].

#### Scenario: Each lifecycle phase times out
- **WHEN** a provider operation does not complete before its phase deadline
- **THEN** it returns `timeout` for that exact phase
- **AND** no exact-empty receipt is fabricated

#### Scenario: Native transport fails
- **WHEN** the helper exits, the private socket breaks, a frame exceeds its bound, or a response violates the closed protocol
- **THEN** the provider returns `control-loss` or `authority-uncertain`
- **AND** retains the reference for later reconciliation

#### Scenario: Late or duplicate result arrives
- **WHEN** a native result arrives after deadline settlement or conflicts with an already accepted sequence/result
- **THEN** it is quarantined or classified as event gap
- **AND** it cannot activate twice, signal twice under a new generation, or produce an optimistic empty receipt

### Requirement: Native artifacts have adjacent integrity and build provenance
Every Linux provider helper used by a runtime SHALL be a source-owned, adjacent, exact platform/architecture/protocol artifact whose closed manifest records length, digest, compiler, source digest, capability, and provider mode. Runtime resolution SHALL NOT compile, download, search PATH, follow a symlink escape, invoke a shell, or reinterpret a legacy ProcessCapsule artifact.

#### Scenario: Exact packaged helper resolves
- **WHEN** the provider manifest and companion artifact manifest identify an adjacent regular Linux helper with matching platform, architecture, protocol, mode, length, SHA-256, and source provenance
- **THEN** the provider resolves that exact real path and can begin availability probing

#### Scenario: Packaged helper integrity differs
- **WHEN** the helper is missing, symlinked, outside its package root, wrong platform/architecture/mode/version, wrong length/hash/source, or missing a required capability
- **THEN** resolution fails closed as authority unavailable or helper-integrity failure
- **AND** no PATH, compiler, download, shell, broker, or legacy helper fallback occurs

#### Scenario: Linux helper is cross-compiled on Windows
- **WHEN** the pinned Windows Rust toolchain produces a Linux target artifact or compile fixture
- **THEN** the result can satisfy build-shape checks only
- **AND** no actual-Linux runtime scenario is marked passed from that result

### Requirement: Verification distinguishes actual kernel truth from build and release claims
Provider acceptance SHALL consume the archived common provider conformance suite unchanged and SHALL include actual-Linux mutation receipts for every authority invariant. Evidence SHALL identify its kernel, runtime, toolchain, configuration, command, and skipped gates. A fixture, injected result, cross-target build, or unavailable environment SHALL NOT be reported as actual Linux, broker/cgroup-v2, distribution, package-install, or release support evidence.

**Scope**: [NARROWS] Step 1 re-tier 2026-08-07 (`evidence/step1-task-ledger-retier.md`, tasks 1.6 /
11.2 / 11.3 / 11.6 narrow, 11.4 moves). "every authority invariant" now means every invariant that
is still 0.2.0 acceptance under the markers in this file; broker/cgroup-v2 acceptance is owed by
the 0.3.0 broker item. The honest-evidence rules themselves - identify kernel/toolchain/commands
and skipped gates, never relabel a fixture, injected result, cross-target build or unavailable
environment as actual evidence - stay whole under both locked decisions. Per scenario: `Shared
common conformance remains unchanged` [STAYS-0.2.0] for the primary fixture, its broker fixture
[MOVES-0.3.0-BROKER]; `WSL primary matrix runs on the actual kernel` [NARROWS] - setsid, setpgid,
nested-PID-namespace, guardian death, root-exit, natural-empty, recursive-kill, prepared abort,
identity-drift and unavailable-configuration rows stay, while the controller-replacement and
publication-window rows move [MOVES-UPGRADE-PATH] (tasks 7.7, 7.10, and 7.8's published-abort
row); `Current WSL configuration lacks the required broker cgroup-v2 operations` [NARROWS] - the
never-relabel-primary-receipts-as-broker-evidence discipline stays, while tracking the broker
scenarios as open moves with the broker; `Broker matrix runs on configured cgroup-v2 Linux`
[MOVES-0.3.0-BROKER]; `Release claim is evaluated later` [STAYS-0.2.0].

#### Scenario: Shared common conformance remains unchanged
- **WHEN** the Linux primary and broker fixtures run provider-neutral conformance
- **THEN** they import and pass the archived shared suite body without modifying it
- **AND** provider-specific mutations live outside the shared suite

#### Scenario: WSL primary matrix runs on the actual kernel
- **WHEN** pinned cargo, rustc, and a native linker are provisioned inside the available WSL2 Ubuntu environment
- **THEN** the native Linux helper runs actual setsid, setpgid, nested-PID-namespace, controller/guardian death, root-exit, natural-empty, recursive-kill, abort, recovery, identity-drift, and unavailable-configuration oracles
- **AND** evidence records Linux/WSL and toolchain identities and exact commands

#### Scenario: Current WSL configuration lacks the required broker cgroup-v2 operations
- **WHEN** WSL exposes only a hybrid/unusable cgroup-v2 hierarchy without required controllers, `cgroup.events`, or `cgroup.kill`
- **THEN** WSL broker/cgroup-v2 scenarios remain explicitly open or unavailable
- **AND** primary-path receipts are not relabelled as broker evidence

#### Scenario: Broker matrix runs on configured cgroup-v2 Linux
- **WHEN** a real Linux runner provides writable cgroup v2, the explicit installed authenticated broker, and required kernel operations
- **THEN** actual owner-death/restart, non-migration, token/inode drift, natural-empty, recursive-kill, abort, and unavailable-configuration mutations must pass before broker terminal status

#### Scenario: Release claim is evaluated later
- **WHEN** primary and broker provider implementation gates pass
- **THEN** this Change records the exact provider capabilities and remaining environment gates
- **AND** clean distribution/install/package and final claimed-OS support remain ECP-8 evidence rather than being inferred here
