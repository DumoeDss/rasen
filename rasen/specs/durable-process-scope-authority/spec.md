# durable-process-scope-authority Specification

## Purpose
TBD - created by archiving change ecp-native-process-capsule-closure. Update Purpose after archive.
## Requirements
### Requirement: Durable Sessions use one opaque exact process-scope authority

A durable hosted Session SHALL bind each process generation to one opaque process-scope reference that is established while the backend remains inert, durably published before activation, and used for all later inspection and termination. Numeric process ids and platform containment details MAY be projected for diagnostics but SHALL NOT authorize control outside the native process-scope boundary. Missing, foreign, malformed, unsupported, or uncertain native authority SHALL fail closed before new work or signalling.

**Decision-13 re-scope.** "Exact" here names the opaque-reference control seam -
one integrity-bound `ProcessRef` as the sole control capability - which is
retained and remains 0.2.0 acceptance. It does NOT claim a kernel-proven
whole-scope emptiness: the 0.2.0 hosted tiers declare best-effort and mint a
declared-unproven terminal (see `rasen/specs/hosted-best-effort-process-scope/`),
while kernel-enforced exact containment and scope-empty are parked to the upgrade
path. The legacy capsule's internal exact vocabulary below this seam is permitted
by design (cutover D3): honesty is enforced at the scope seam that re-declares
those terminals as unproven, not by rewriting the frozen helper. The
published-before-activation, activate-at-most-once, foreign-zero-signal, and
fail-closed-on-unavailable properties below hold on every tier.

#### Scenario: Published authority precedes backend work
- **WHEN** a new hosted generation is prepared
- **THEN** the contained supervisor remains inert until its opaque reference has been committed under the current Session generation and registry revision
- **AND** activation occurs at most once for that reference

#### Scenario: Foreign identity receives zero signals
- **WHEN** inspection resolves a stored numeric id to a process whose native birth identity differs from the reference
- **THEN** the operation reports `process-identity-foreign`, sends no process or group signal, retains the durable authority record, and does not restart the Session

#### Scenario: Native capability is unavailable
- **WHEN** the supported platform cannot establish the required exact containment or birth-identity capability before activation
- **THEN** preparation returns a typed containment or authority failure and the backend never starts

### Requirement: macOS process birth uses the complete kernel unique-identity contract

**Decision-gated after the 2026-08-04 architecture replan.** This requirement and its scenarios are retained as evidence for the already implemented native/PGID candidate. They do not select Endpoint Security over a VM or support-matrix alternative, do not authorize macOS implementation or distribution, and SHALL NOT be used as current platform acceptance until a later Direction decision selects a macOS authority whose design actually consumes this identity contract.

The macOS adapter SHALL call the kernel unique-identifier interface with the complete 56-byte `proc_uniqidentifierinfo` ABI, protect the native layout with a compile-time size assertion, and accept identity only when the kernel returns the complete structure with a non-zero unique id. Cross-target compilation SHALL be reported only as compile evidence; macOS runtime identity claims SHALL require execution on macOS.

#### Scenario: Same-second macOS processes remain distinct
- **WHEN** multiple processes start within the same wall-clock second on macOS
- **THEN** each process-scope identity is derived from its kernel unique-birth fields and remains distinct even where a second-resolution timestamp would collide

#### Scenario: Reused macOS PID does not authorize control
- **WHEN** a stored PID now resolves to a different macOS kernel unique-birth identity
- **THEN** inspection reports foreign, termination sends zero signals, and the retained reference is not cleared

#### Scenario: macOS unique source is unavailable
- **WHEN** `proc_pidinfo` does not return the complete 56-byte structure or returns no usable unique id
- **THEN** the operation fails closed as unsupported or uncertain and neither activation nor signalling proceeds

#### Scenario: Cross compilation is not runtime proof
- **WHEN** the helper compiles for a macOS target on Windows or Linux but no macOS oracle has executed
- **THEN** ECP-7 records compile-only evidence and the exact unexecuted macOS runtime obligation, while ECP-8 must run that obligation before the release claims macOS support

### Requirement: Backend-root exit is distinct from whole-scope closure

The native protocol and ProcessScope contract SHALL report backend-root exit separately from exact whole-scope empty. A hosted generation SHALL retain its opaque reference, writer ownership, capacity, and termination ability while its controller, supervisor, or any descendant remains in scope. Only an observed scope-empty terminal receipt SHALL authorize clean detachment, authority removal, restart admission, or a clean shutdown result.

**Decision-13 re-scope.** The root-exit-distinct-from-terminal invariant and the
control-loss-retains-authority property (SEC-001) hold on every 0.2.0 tier. On the
shipped hosted best-effort tiers the terminal is declared-unproven
(`completed | cancelled / emptiness-unproven`), not a kernel-proven scope-empty;
the "scope-empty terminal" the scenarios below name is the retained exact tier's
form and travels to the upgrade path with the parked crates. Release stays gated:
only a proven scope-empty (exact tier) or a declared-unproven terminal whose
best-effort declaration was published before start (hosted tier) authorizes
detachment - `receiptAuthorizesRelease` refuses `uncertain` regardless of tier.

#### Scenario: Root exits with a detached descendant
- **WHEN** the backend root exits after creating a detached descendant that remains in the process scope
- **THEN** the backend exit is observable, the scope remains live and controllable, and the Session retains its registry and writer authority

#### Scenario: Descendants later empty naturally
- **WHEN** the backend root has exited and the last contained descendant subsequently exits
- **THEN** ProcessScope emits exactly one scope-empty terminal result and the host may release that exact generation's authority

#### Scenario: Exact terminate closes descendants after root exit
- **WHEN** the backend root has exited but a contained descendant remains and an authorized cancel, retire, shutdown, or reconcile requests termination
- **THEN** termination targets the retained opaque scope and reports closed only after the entire scope is observed empty

#### Scenario: Controller or control pipe closes before scope-empty
- **WHEN** the controller exits or its control channel closes without an exact scope-empty observation
- **THEN** the host records typed control uncertainty, keeps the opaque authority and writer claim, and does not report the generation cleanly closed

### Requirement: POSIX replacement reaps the exact reserved process group

**Superseded by architecture replan on 2026-08-04.** This requirement and its four scenarios are retained as review provenance only. They SHALL NOT be used as acceptance evidence because a workload can escape a process group with `setsid()`/`setpgid()`. The kernel-backed authority requirement below has precedence.

On Linux and macOS, replacement inspection and termination SHALL bind and validate both the controller and supervisor native birth identities plus the supervisor's reserved process-group identity. After daemon or controller loss, an exact old scope SHALL receive bounded graceful and forced group cleanup, while a reused or unverifiable identity SHALL receive zero signals. Closed SHALL be reported only after the exact controller and process group are both absent.

#### Scenario: Linux replacement closes a resistant descendant group
- **WHEN** a Linux controller or daemon dies while its exact supervisor group contains a termination-resistant descendant
- **THEN** replacement termination validates the recorded native identities, closes the exact reserved group within the bound, and reports scope-empty

#### Scenario: macOS replacement closes a resistant descendant group
- **WHEN** a macOS controller or daemon dies while its exact supervisor group contains a termination-resistant descendant
- **THEN** replacement termination validates the corrected kernel birth identities, closes the exact reserved group within the bound, and reports scope-empty

#### Scenario: Same PID with different birth is never signalled
- **WHEN** either POSIX platform presents the recorded controller or supervisor PID with a different native birth identity
- **THEN** replacement control reports foreign or uncertain, sends no signal to that process or group, and retains authority for diagnosis

#### Scenario: Controller is gone but the old group remains reserved
- **WHEN** the exact controller and supervisor leader have exited while descendants still keep the original process group alive
- **THEN** replacement control identifies the still-reserved old group without accepting a different-birth leader, terminates its members, and observes group absence before reporting closed

### Requirement: Every post-PREPARED control phase is bounded and uncertainty preserves authority

PREPARE, ACTIVATE, prepared abort, live terminate, inspect, and scope-empty observation SHALL each have a finite configured control deadline and exactly one typed outcome. If ACTIVATE or abort times out, the outcome SHALL identify the control phase and uncertainty; the host SHALL retain every opaque reference and ownership fact whose closure was not observed and SHALL NOT automatically retry activation.

#### Scenario: ACTIVATE acknowledgement is withheld
- **WHEN** the controller accepts, delays, or drops ACTIVATE without returning the required acknowledgement before the deadline
- **THEN** activation settles within the bound as typed `process-control-timeout` uncertainty, the published authority remains durable, and no second ACTIVATE is sent automatically

#### Scenario: Prepared abort acknowledgement is withheld
- **WHEN** a prepared scope is aborted after publication failure or shutdown and the controller withholds termination or scope-empty acknowledgement
- **THEN** abort settles within the bound with an uncertain termination receipt and the host retains the reference and writer authority for later exact reconciliation

#### Scenario: Control succeeds before the deadline
- **WHEN** ACTIVATE or abort returns its exact acknowledgement before the deadline
- **THEN** its timer is cleared once and the operation reports one successful state transition without a later timeout mutation

#### Scenario: Timed-out control is reconciled later
- **WHEN** a later daemon start inspects a reference retained after a control timeout
- **THEN** it either observes exact scope-empty and releases authority, controls the exact live scope, or preserves typed foreign/uncertain state without redispatching work

### Requirement: Packaged helper integrity and provenance claims match the evidence

Every supported helper artifact SHALL be resolved adjacent to the installed package and exact-match a closed manifest entry for helper protocol, platform, architecture, capabilities, length, SHA-256, compiler identity, and source digest. The package SHALL describe these fields as integrity and build-input provenance. It SHALL claim byte-reproducible source rebuilds only when two isolated source-identical clean builds on that platform produce identical bytes; unequal builds SHALL be reported honestly and SHALL NOT invalidate the adjacent artifact's independently verified hash.

#### Scenario: Adjacent helper matches its manifest
- **WHEN** the runtime resolves a regular adjacent helper whose protocol, platform, architecture, capabilities, length, and SHA-256 match the manifest
- **THEN** that exact artifact is eligible for preparation and its source/compiler fields are reported as build-input provenance

#### Scenario: Helper or manifest differs
- **WHEN** the helper is missing, outside the adjacent package root, a symlink escape, the wrong platform or architecture, or differs in protocol, capability, length, or hash
- **THEN** preparation fails with `helper-integrity-failed` before backend activation and no fallback helper is selected

#### Scenario: Two clean builds differ
- **WHEN** two isolated clean builds from identical source and pinned toolchain inputs produce different helper bytes
- **THEN** verification records the unequal digests, authoritative artifacts make no byte-reproducibility claim, and each packaged artifact must still match its own manifest entry exactly

#### Scenario: Two clean builds are identical
- **WHEN** two isolated clean builds on one platform produce identical bytes
- **THEN** the equality is recorded as platform-specific evidence and does not become a cross-platform reproducibility claim without the same proof on each supported release OS

### Requirement: Existing containment, migration, and fallback safety remain intact

The closure SHALL preserve Windows suspended Job-at-create with one non-inherited last-handle owner, the publish-before-activate discriminator, registry v2 opaque references, and fail-closed treatment of live or uncertain v1 PID records. Production resolution SHALL use only the verified packaged helper; runtime compile, download, PATH lookup, shell, PowerShell Job assignment, generic PID-tree termination, and `ps lstart` signal authority SHALL remain unavailable for durable hosted generations.

**Decision-13 note.** The Windows suspended Job-at-create / kill-on-last-handle
containment named below is retained as the win32 best-effort tier's mechanism -
its terminals are now re-declared unproven at the scope seam, but the Job
mechanics and the daemon-death teardown are unchanged and receipted (cutover
7.1/7.2). The migration, publish-before-activate, and no-weak-fallback
obligations are unchanged 0.2.0 acceptance.

#### Scenario: Windows controller dies after activation
- **WHEN** only the native Windows controller is killed after a root and detached descendant are active
- **THEN** closing the unique Job handle kernel-terminates every contained member while an unrelated process remains alive

#### Scenario: Duplicate Job handle mutation is detected
- **WHEN** a test mutation duplicates or inherits the Windows Job handle outside the controller
- **THEN** the controller-death discriminator fails, while the production topology passes with exactly one owning handle

#### Scenario: Activation occurs before publication mutation
- **WHEN** a test mutation activates the inner supervisor before the host publishes its opaque reference
- **THEN** the inertness discriminator fails, while the production topology creates no backend marker before activation

#### Scenario: Live v1 PID facts are encountered
- **WHEN** registry migration sees a v1 record with live or uncertain numeric process authority
- **THEN** the original bytes are preserved, no strong v2 reference is invented, and hosted mutation remains fail-closed until exact absence or manual retirement is established

#### Scenario: Packaged native capability is absent
- **WHEN** no exact verified helper is available for the current supported platform and architecture
- **THEN** durable hosting fails before activation without compiling, downloading, searching PATH, invoking PowerShell, or falling back to sampled process identity

### Requirement: Provider-complete integration closure precedes local delivery and platform acceptance precedes support claims

The common authority foundation MAY complete before any macOS architecture decision and the Linux and Windows provider Changes MAY proceed after that common contract is terminal. This Change SHALL remain non-terminal until the Linux, Windows, and explicitly selected macOS provider Changes are all terminal. It SHALL then integrate those providers, close every retained security/lifecycle Blocker and Major through fresh independent security plus code/spec review, and only then local-ship/archive without a child push or PR. Cross-target and injected results SHALL be labelled compile-only or deterministic evidence. ECP-8 SHALL execute the first clean-branch real Windows/Linux/macOS acceptance matrix and SHALL block release and corresponding platform-support claims if any real-OS oracle is absent or fails.

**Decision-13 / Replan-6 re-scope.** The "integrate the three providers' frozen
contracts" acceptance is revised: decision 13 parks the Linux/Windows/macOS
authority crates WHOLE to the upgrade path and ships instead the declared
best-effort tier (`ecp-hosted-best-effort-cutover`, archived). Closure depends on
Linux and Windows only (`dependsOn: [linux, windows]`, Replan 4); the macOS edge
is not re-added. Closure's delivered integration is the best-effort ProcessScope
plus the host wiring plus closing the retained security/lifecycle findings, not a
kernel-enforced provider integration. The three-OS ECP-8 acceptance matrix and the
"no support claim from cross-compilation" rule are unchanged; the Windows Job
daemon-death teardown receipt is delivered, and the Linux zero-orphan leg is
superseded into declared best-effort honesty (decision 11 revised).

#### Scenario: macOS decision remains deferred
- **WHEN** the common foundation and Linux/Windows provider work are complete but no macOS authority has been explicitly selected
- **THEN** this Change remains non-terminal and non-runnable, records the exact unresolved provider frontier, and makes no macOS support claim
- **AND** common, Linux, and Windows evidence remains valid rather than being reset or represented as final cross-platform closure

#### Scenario: Independent closure is clean
- **WHEN** all three platform providers are terminal, their contracts are integrated, retained S1-S5/`RC-001..005`/`SEC-001..003` regressions and affected gates pass, and fresh non-author security and code/spec reviews have no Blocker or Major finding
- **THEN** the Change may local-ship and archive as the ECP-7 prerequisite without pushing or opening a PR

#### Scenario: ECP-8 runs final release assurance
- **WHEN** ECP-8 transfers the cumulative 0.2.0 delta to its clean delivery branch
- **THEN** final CI executes the recorded Windows/Linux/macOS ProcessCapsule oracles on their actual operating systems rather than treating cross-target or deterministic ECP-7 evidence as runtime proof
- **AND** any missing or failed platform oracle blocks release and the corresponding support claim and routes the defect back for repair

#### Scenario: Original host child remains a separate gate
- **WHEN** this closure Change reaches its local terminal state
- **THEN** the original `ecp-durable-agent-session-host` retains its prior escalation history and must still pass an explicit post-remediation verify/review/ship/archive lifecycle before later ECP-7 children run

### Requirement: Supported platforms use a non-escapable recoverable process authority

The system SHALL activate durable backend work only after a platform `ProcessAuthorityProvider` has published an opaque reference to a boundary that descendants cannot leave using workload-accessible APIs. The authority SHALL provide exact inspect, natural-empty, recursive terminate and abort outcomes; SHALL remain recoverable or independently retained after one controller/daemon authority death; and SHALL report unavailable, identity-drift, event-gap and timeout outcomes as typed uncertainty while retaining the reference. PID/PGID sampling SHALL NOT be a fallback.

**Parked to the upgrade path by decision 13.** This kernel-enforced authority
contract - a non-escapable boundary with exact inspect / natural-empty / recursive
terminate / abort and one-authority-death recovery - is NOT 0.2.0 acceptance. It
moves WHOLE to the upgrade path with the two frozen authority crates (Linux
`89f6c1d5`, Windows `fc49a7c2` / helper `367666f6`) and their evidence, and is
retained here verbatim as the resumption contract. The 0.2.0 hosted backend
instead declares best-effort on all three OSes (`scopeEmptyProof: false`,
`exactCancel: false`); the `setsid()`/`setpgid()` escape this requirement's Linux
scenario proves is the declared, known limitation of that tier, not a defect the
0.2.0 tier must close (its disproof is load-bearing for the declaration and is
preserved, not archived away). No scenario below is a 0.2.0 gate.

#### Scenario: Linux descendant creates a new session and process group

- **WHEN** a real Linux workload recursively forks, calls `setsid()`/`setpgid()`, and creates a nested PID namespace where permitted
- **THEN** every descendant remains inside the parent PID-namespace authority, exact termination closes the namespace, and an unrelated process survives

#### Scenario: Linux user namespaces are unavailable

- **WHEN** PREPARE proves that kernel configuration or distribution policy rejects the unprivileged user+PID namespace construction
- **THEN** activation fails with typed `authority-unavailable` unless an authenticated installed broker has created an equivalent PID-namespace authority and non-migratable cgroup-v2 leaf
- **AND** the system never falls back to a process group or writable same-UID cgroup

#### Scenario: Linux daemon or broker restarts

- **WHEN** a daemon/controller or installed broker restarts while a namespace guardian remains live
- **THEN** replacement revalidates boot/start identity, PID-namespace inode and any broker/cgroup token before inspecting or signalling
- **AND** absence or drift remains uncertain unless namespace-init death proves kernel-recursive termination

#### Scenario: macOS provider has no selected architecture

- **WHEN** the owner has deferred the macOS decision and has approved neither Endpoint Security nor VM/support-matrix behavior
- **THEN** the macOS provider remains decision-gated, activates no durable backend, and publishes no platform-support claim
- **AND** research fixtures for either candidate do not count as provider acceptance

#### Scenario: Future macOS authority is selected

- **WHEN** a later explicit Direction decision selects a macOS authority and distribution contract
- **THEN** the macOS provider Change adds architecture-specific non-escape, exact-empty, recursive-kill, one-authority-death/recovery, unavailable/uncertain, packaging, and real-macOS acceptance scenarios before implementation begins
- **AND** neither the old PGID candidate nor unapproved research silently becomes the selected contract

#### Scenario: Windows authority is preserved

- **WHEN** a Windows workload attempts nested spawn or breakaway and the controller later loses its last owning handle
- **THEN** suspended pre-activation Job assignment and disabled breakaway retain all descendants and kill-on-last-handle closes them while an unrelated process survives

### Requirement: Architecture and distribution decisions precede implementation closure

The platform-neutral authority contract SHALL be owned by `ecp-platform-process-authority-foundation`; Linux, Windows, and macOS implementations SHALL be owned by separate provider Changes. The common foundation SHALL NOT make an OS support claim. Linux and Windows providers MAY become runnable only after the common foundation is terminal. The macOS provider SHALL remain decision-gated until the product owner records a later explicit architecture/distribution choice. The current Change SHALL depend on all three providers and remain non-terminal until each is terminal. ECP-8 SHALL still run the first clean-branch actual Windows/Linux/macOS acceptance matrix; cross-compilation and injected events SHALL NOT establish platform support.

**Decision-13 / Replan-6 re-scope.** The provider-ownership graph above stands,
but the Linux/Windows/macOS authority implementations it names are frozen and
parked to the upgrade path (decision 13); the 0.2.0 acceptance they were to
satisfy is met by the shipped best-effort tier, not by their kernel-enforced
authority. Closure depends on Linux and Windows only; macOS stays decision-gated.
The common foundation and the ECP-8 three-OS acceptance matrix are unchanged.

#### Scenario: No macOS distribution decision exists

- **WHEN** neither macOS 27 signed/entitled Endpoint Security support nor the VM/support-matrix alternative has explicit approval
- **THEN** the common foundation remains runnable and its terminal state may unblock Linux and Windows provider work
- **AND** the macOS provider and this final integration closure remain non-runnable and no macOS support or release claim is made

#### Scenario: Common foundation completes

- **WHEN** the platform-neutral provider/opaque-reference/dispatch contract passes its independent gates
- **THEN** Linux and Windows providers may run in parallel against the frozen seam
- **AND** macOS remains decision-gated until a later explicit owner decision

#### Scenario: ECP-8 receives the authority implementation

- **WHEN** the foundation and this integration closure are review-clean and ECP-8 begins release assurance
- **THEN** ECP-8 runs real `setsid()` escape, owner-death/recovery, exact natural-empty, exact terminate, authority-unavailable and unrelated-process-survival oracles on each claimed operating system

