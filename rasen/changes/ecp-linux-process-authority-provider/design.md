## Context

ECP-7's architecture replan demonstrated that the current POSIX ProcessCapsule `pidfd + reserved process group` implementation is not a recursive authority boundary: a workload can call `setsid()` or `setpgid()` and leave the group. The archived `ecp-platform-process-authority-foundation` Change now supplies a manifest-bound `ProcessAuthorityProvider`, a sensitive versioned reference envelope, publish-before-activate coordination, typed retained failures, and one provider-neutral conformance suite. This Change implements the Linux authority behind that frozen boundary; it does not change the common contract.

The current native seam is a single cross-platform Rust binary at `native/process-capsule/src/main.rs`. Its protocol v2, resolver, manifest, build script, and package tests explicitly advertise Linux `pidfd` plus `process-group`. Reinterpreting that helper as exact authority would preserve the disproven claim and would mix platform implementation with the later atomic ProcessScope integration. The Linux provider therefore needs an additive native seam and artifact identity. The existing helper stays readable as migration input but remains legacy until `ecp-native-process-capsule-closure` removes or hard-disables its PGID Linux path.

The frozen provider API intentionally has `prepare().activate()` but no provider-side publish hook. Consequently, a native helper can prove only `inert`, not whether the common reference has been durably published. This matters in the crash windows after the publication record is committed and before its acknowledgement or the subsequent activation call. The design must project that durable common phase without inventing a hidden `PUBLISH` frame or treating `activate` as publication.

Direction source is `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/session-execution-and-self-hosting/`. The controlling architecture evidence is `rasen/changes/ecp-native-process-capsule-closure/evidence/architecture-replan.md`; the common contract and its terminal evidence are archived under `rasen/changes/archive/2026-08-05-ecp-platform-process-authority-foundation/`.

Available evidence environments are asymmetric:

- Windows has the Rust Linux target installed, but a cross-target binary is build evidence only.
- WSL2 Ubuntu 24.04 runs Linux 5.15, Node 22.21.0, and pnpm 9.15.9. Unprivileged user namespaces, nested PID namespaces, and Python `pidfd_open` probes succeed, so it can produce actual-kernel primary-path evidence after a pinned Rust toolchain and C linker are provisioned inside WSL.
- That WSL instance uses a hybrid hierarchy: the root `/sys/fs/cgroup` is a read-only tmpfs and `/sys/fs/cgroup/unified` is a writable cgroup-v2 mount, but it exposes no usable controllers, `cgroup.events`, or `cgroup.kill`. The current configuration cannot validate the installed broker/cgroup leaf; a dedicated reconfigured WSL, VM, or runner with the exact required v2 operations is needed. It also cannot establish general-distribution/install policy, release packaging, or ECP-8 support claims.

## Goals / Non-Goals

**Goals:**

- Implement a manifest-bound Linux provider that satisfies the accepted common contract without editing the common conformance suite.
- Make a user/PID/mount namespace guardian the primary recursive authority, with a fully inert prepare and kernel-enforced non-escape.
- Prove root exit and exact scope empty as different facts, including surviving descendants and nested PID namespaces.
- Make abort, recursive terminate, owner death, and replacement recovery exact or typed fail-closed; never infer authority from a PGID, PID tree, or sampled descendant set.
- Preserve prepared-versus-published inert recovery across publication acknowledgement crashes using an exact trusted durable ledger, without changing the frozen provider interface.
- Provide a separately installed and explicitly selected broker provider for hosts that prohibit unprivileged namespace creation, using authenticated broker identity and a root-owned non-migratable cgroup-v2 leaf.
- Bind every durable private reference to sufficient Linux identity to prevent PID, namespace, broker-token, or cgroup reuse from becoming destructive authority.
- Produce actual-Linux mutation receipts and clearly separate WSL primary evidence, real cgroup-v2 broker evidence, cross-build/package evidence, and later release truth.

**Non-Goals:**

- Do not select a macOS authority strategy or make any macOS support statement.
- Do not modify the frozen `process-authority-provider` capability or its shared conformance suite.
- Do not switch ProcessScope, SessionHost, or production defaults to this provider and do not remove the old PGID path in this Change. `ecp-native-process-capsule-closure` owns that atomic integration.
- Do not treat an unprivileged-primary failure as permission to contact or install a broker. Provider selection is explicit before prepare.
- Do not claim general Linux distribution support, install support, npm/release readiness, or ECP-8 completion from WSL or Windows cross-compilation.
- Do not solve remote/multi-host authority or migrate existing legacy ProcessRefs into strong provider references.

## Decisions

### 1. Add a Linux-only provider helper instead of extending the legacy ProcessCapsule authority mode

Create a sibling source-owned Rust helper, `native/linux-process-authority`, with a closed Linux-only protocol. A TypeScript provider adapter under `src/core/session-host/process-authority/linux/` resolves the adjacent helper, implements the frozen provider interface, and exposes the provider-backed runtime opener required by the existing ProcessScope adapter. The helper is built only for Linux x64/arm64 artifacts. It does not share the current ProcessCapsule v2 reference or claim identifiers.

The new crate uses a locked `libc` dependency for Linux ABI constants/syscalls rather than copying architecture-specific numbers through the implementation. The installed broker uses a locked, audited Ed25519 implementation to sign client challenges; the TypeScript client verifies those signatures with Node's built-in crypto API. Dependency versions and licenses are committed through the Cargo lockfile and included in source/provenance review.

The common provider manifest contains two distinct, exact selections:

- `rasen.linux.user-pidns` / `rasen-recursive-process-scope/1` / protocol `1`
- `rasen.linux.broker-pidns-cgroupv2` / `rasen-recursive-process-scope/1` / protocol `1`

Both use common contract version 1 and provider-reference version 1, but each has a unique provider id and explicit selection. A separate closed native-artifact manifest binds Linux platform/architecture, helper path, byte length, SHA-256, compiler, source digest, protocol, and declared mode. The common manifest remains unchanged and points its `artifactPath` at the exact resolved native provider artifact; the companion artifact manifest supplies integrity fields the frozen common schema intentionally does not contain.

Alternative: add Linux namespace modes to `native/process-capsule/src/main.rs`. Rejected because it couples new authority to a protocol and manifest that still advertise PGID, makes platform acceptance harder to isolate, and overlaps closure-owned production integration/removal.

Alternative: implement namespace operations through shell commands such as `unshare`. Rejected because PATH, shell parsing, distribution-specific flags, and child command replacement would enter the authority boundary.

### 2. The primary authority is a namespace PID 1 guardian created completely during prepare

Primary prepare creates a private runtime directory outside the workload cwd with restrictive ownership, a Unix socket, activation gate, and immutable launch snapshot. The native preparer then creates a new user namespace, mount namespace, and child PID namespace; maps only the invoking uid/gid (including `setgroups=deny`), makes mount propagation private, mounts a PID-namespace-correct `/proc`, and starts the guardian as PID 1. The guardian inherits the already-created listening/control descriptors, but it does not exec or fork workload code until activation.

Before returning `prepared-inert`, the provider proves all required facts in one bounded prepare transaction: exact uid/gid mappings, namespace ownership, proc mount, guardian readiness, activation gate closure, outer guardian PID and start time, boot id, PID namespace device/inode, pidfd availability, private endpoint ownership/mode, and helper protocol/manifest identity. Any partial construction is killed and reaped before prepare returns a typed failure. No workload command is invoked during a failed prepare.

On activation, the guardian forks the root workload inside its PID namespace from the immutable absolute command/cwd/env snapshot and releases it only once. `setsid()` and `setpgid()` can change session/group membership but cannot move a process to an ancestor PID namespace. A workload-created nested PID namespace is still visible as descendant membership from the guardian's parent PID namespace and cannot cross outward.

Alternative: use PGID, session id, `/proc` traversal, subreaper snapshots, or repeated descendant sampling. Rejected because none prevents escape and none can prove an exact empty set under concurrent fork/exit.

Alternative: create the namespace only during activate. Rejected because publication would persist a reference before the authority exists and activation failure could start code outside a proven boundary.

### 3. A trusted durable publication ledger projects common inert phase

Choose the foundation-compatible ledger option rather than amending the provider interface. The Linux provider bundle supplies a concrete `LinuxAuthorityPublicationLedger` and matching publisher callback for the existing common `publish(binding, context)` seam. The publisher validates the exact binding, atomically commits and fsyncs a canonical record, and only then returns the common publication acknowledgement. The record binds the full reference digest, preparation operation id, publication version, provider tuple/reference generation, and immutable launch-snapshot digest. Its state root, ownership, file type, bounds, digest chain, and operation identity are verified through concrete source-owned code; the production provider does not accept a structurally similar caller object as publication truth.

The provider-private reference includes the preparation operation id and launch-snapshot digest. Because common reference encoding is canonical and deterministic for an exact descriptor plus private reference, the provider can reconstruct the full reference digest during activate or recovered inspect without receiving new common API fields. The provider then queries the exact ledger record:

- native `inert` plus no record is `prepared-inert`;
- native `inert` plus one exact durable record is `published-inert`;
- unavailable, malformed, conflicting, wrong-generation, wrong-operation, or wrong-launch ledger state is retained `authority-uncertain`, `event-gap`, or `control-loss`.

`ProviderPreparedAuthority.activate()` verifies the exact durable published record before opening the native activation gate. It does not write publication state and the helper protocol has no `PUBLISH` command. If the process crashes after ledger commit but before acknowledgement, or after acknowledgement but before activate, replacement inspection still yields `published-inert`; the recovery owner may terminate/abort and regrant rather than silently activate. The current common recovery API does not activate an arbitrary recovered reference, so this Change does not invent that power.

The unprivileged primary ledger lives in the trusted provider/host state root that is not inherited, exposed through argv/env, or reachable from workload cwd. Broker publication state is additionally committed in the root-owned lease store. Closure later wires the same concrete publisher/ledger instance into the host's durable authority publication callback; it does not change the ledger semantics.

Alternative: send `PUBLISH` to the helper from `activate`. Rejected because it collapses two ordered phases and leaves the acknowledgement-before-activate crash window unclassifiable.

Alternative: add `markPublished` to the common provider API. Rejected for this Change because the exact durable ledger closes the Linux recovery seam without changing the accepted provider-neutral contract; any future generic amendment must be a separate explicit foundation decision and delta spec.

### 4. Guardian reaping is the primary exact membership oracle

The guardian is namespace PID 1 and continuously reaps. The activated root's exact `waitid` result is recorded once as either `(code, null)` or `(null, signal)` and exposed as `root-exited`; it does not imply scope empty. Descendants orphaned by any parent are reparented to namespace PID 1. Only after the root has exited and a nonblocking reap/child check proves `ECHILD` does the guardian atomically publish `exact-scope-empty`, fsync its final record, close the runtime bridge, and exit.

Natural empty therefore has a positive guardian record plus kernel child-set proof. If the guardian is killed unexpectedly, Linux's PID-namespace-init rule terminates all processes in that namespace. An observer already holding the revalidated pidfd may use pidfd completion plus same-boot identity as the kernel teardown proof. A replacement that finds the expected PID absent may use the authentic fresh reference, unchanged boot id, and absence of a conflicting PID identity to classify exact empty; any conflicting live PID/start/namespace tuple is `identity-drift`, not a release receipt. Missing/corrupt final records or syscall ambiguity remain retained when the kernel proof cannot be completed.

The guardian event journal has a monotonic sequence and closed event vocabulary (`prepared`, `activated`, `root-exited`, `exact-scope-empty`). A gap, duplicate conflict, or invalid transition becomes `event-gap` or `control-loss`; it cannot be rewritten as empty.

Alternative: exit the guardian when the root exits. Rejected because live descendants would be killed and natural root-exit semantics would be conflated with requested recursive termination.

Alternative: treat pidfd readiness for the root as empty. Rejected because pidfd is exact for one process, not namespace membership.

### 5. Abort and terminate act on the namespace authority, not observed descendants

Prepared or published abort sends no activation and destroys the guardian through its revalidated pidfd. Guardian exit invokes kernel PID-namespace teardown; the provider waits for the pidfd and exact teardown/final-state oracle before returning `exact-scope-empty`. Activated terminate first asks the guardian for bounded graceful root delivery when policy permits, then force-kills the guardian through `pidfd_send_signal(SIGKILL)` if the scope remains populated. It never enumerates or individually signals descendant PIDs.

Before every destructive primary control, the provider performs the reference-reopen sequence below. A deadline, control-channel loss, ambiguous syscall result, or identity mismatch returns the corresponding retained common outcome. Repeating a completed terminate/abort is idempotent through the common generation/tombstone contract and the provider's terminal record.

Alternative: kill the root then scan `/proc` until no descendants remain. Rejected because concurrent forks and reparenting create unprovable gaps.

### 6. Private references are versioned capabilities bound to Linux birth and namespace identity

The provider-private reference is a closed, length-bounded binary payload carried only inside the common sensitive envelope. Primary v1 contains:

- exact provider path discriminator and protocol/reference versions;
- native-generated random one-use scope id/common generation plus independent 256-bit scope and control capabilities; TypeScript validates and preserves those attested bytes but never generates or backfills them;
- preparation operation id and immutable launch-snapshot digest used by the exact publication ledger;
- host boot id;
- outer guardian PID and `/proc/<pid>/stat` start ticks;
- guardian PID namespace device and inode;
- native artifact source digest and helper protocol identity.

Broker v1 contains every applicable guardian field plus broker installation identity, broker-issued lease token, authenticated broker key id, and cgroup-v2 leaf device/inode. It never contains an arbitrary executable path, socket path, cgroup path, or caller-selected PID. Paths are derived from the provider's trusted runtime/install roots and the bounded scope id.

To inspect or control after replacement, the provider decodes the exact version, verifies the common envelope, verifies current boot id, opens `/proc/<guardian>/ns/pid` and a pidfd, reads start ticks and namespace inode, then rereads all fields after the pidfd is open. Only an exact stable tuple may open/authenticate the control endpoint or receive a signal. PID absence and PID reuse are different states. Unknown/future versions, malformed fields, changed boot, changed start, changed namespace inode, token mismatch, or cgroup inode replacement do not trigger control.

The private reference and broker token are never logged or put in argv/env/project files. Diagnostics use the common redacted tuple/digest projection plus non-secret state codes.

Alternative: bind only PID plus boot id. Rejected because PID reuse within a boot remains possible. Alternative: persist a pidfd. Rejected because an fd is not a durable restart reference.

### 7. The broker is a separate installed authority, never a fallback

Hosts that disable unprivileged user/PID namespaces may install and explicitly configure `rasen.linux.broker-pidns-cgroupv2`. The primary provider never probes for or contacts it. Selection of the broker tuple must already be present in the frozen execution configuration and exact manifest-bound registry; absence produces `authority-unavailable`.

The broker runs as a separately installed root-owned service. Its install manifest and public authentication key live under a root-owned, non-user-writable path. On every connection the client validates socket type/owner/mode, verifies peer credentials, sends a fresh challenge, and verifies the broker signature against the pinned install key. The broker also authenticates the caller's uid and request capability. A pathname, uid, or socket connection alone is not broker identity.

For each lease, the broker creates the same user/PID/mount namespace guardian and a unique cgroup-v2 leaf below a root-owned service subtree. The leaf and membership-control files remain non-writable by the workload uid; the workload receives no initial-user-namespace capability or delegated parent that could move itself. The broker moves the guardian into the leaf before workload activation and proves the leaf inode and `cgroup.events` state before returning prepared. Recursive force uses `cgroup.kill`; exact empty uses `cgroup.events populated=0` plus stable leaf inode. The broker deletes the leaf only after exact empty.

Broker lease metadata is durable in a root-owned bounded store so an authenticated broker restart can reopen the exact token, guardian identity, and cgroup inode. Broker death while populated retains authority and leaves the root-owned cgroup intact. Replacement succeeds only after the authenticated broker reopens and revalidates the same lease; a new leaf at the same path is identity drift. If cgroup v2, `cgroup.kill`, writable service ownership, namespace creation, durable lease storage, or broker authentication is unavailable, prepare fails closed before workload activation.

Alternative: automatically escalate to the broker after `EPERM`. Rejected because it changes the authority source without a frozen selection and turns local policy changes into implicit privilege escalation.

Alternative: privileged namespace creation without a non-migratable cgroup leaf. Rejected because broker/guardian failure would lack an independently reopenable exact membership and kill boundary.

### 8. Provider lifecycle and error mapping stay inside the frozen common vocabulary

The TypeScript adapter maps native results only to the existing common observations and controls. Availability probe failure is `authority-unavailable`; unstable identity is `identity-drift`; journal discontinuity is `event-gap`; an authenticated but inconclusive native result is `authority-uncertain`; deadline expiration is `timeout` for the exact phase; broken transport/protocol is `control-loss`. None of these releases the reference or fabricates an exact-empty receipt.

All native frames, paths, argument/environment counts, journal records, tokens, and responses have fixed schemas and explicit size/count bounds. Operations observe the common deadline and abort signal. Late native results are quarantined by the common coordinator and cannot settle a later generation.

The new provider-specific conformance fixture imports `test/helpers/process-authority-provider-conformance.ts` unchanged. Provider-specific fault injection lives in a test-only helper build or injected adapter dependency that the production factory cannot select. A source-diff/hash assertion prevents accidental edits to the shared suite during this Change.

### 9. Evidence is partitioned by what the environment can actually prove

Four evidence classes are recorded independently:

1. Platform-neutral TypeScript/unit/manifest/protocol and Windows cross-target compilation. These prove shape and buildability only.
2. Actual WSL2 Linux primary-path receipts after provisioning pinned Rust 1.88.0 plus a native linker inside WSL. These cover user/PID/mount namespace construction, pidfd, setsid/setpgid, nested PID namespace, owner death, root-exit distinction, natural empty, recursive kill, abort, recovery, identity drift, and unavailable mutations on the running Linux kernel.
3. Actual non-WSL (or suitably configured VM/runner) cgroup-v2 and installed-broker receipts. These cover authenticated install identity, root-owned non-migratable leaf, broker restart/death, token/inode drift, `cgroup.kill`, and populated-to-empty convergence. They are mandatory before the broker provider can be terminal.
4. Clean distribution/install/package matrix and ECP-8 release receipts. These remain later gates and are not inferred from classes 1-3.

WSL evidence records kernel, WSL, Node, pnpm, cargo, rustc, linker, namespace sysctl/probes, and exact test command. Installing a toolchain is setup evidence, not a passing oracle. Any skipped actual-Linux test leaves its named acceptance gate open.

### 10. Packaging is additive and support activation is deferred

The Linux provider build script uses locked source, pinned Rust, isolated output roots, source digests, and adjacent artifacts, mirroring the current ProcessCapsule provenance discipline without editing its meaning. Package tests reject missing, symlinked, wrong platform/arch/protocol/version/capability/hash/length/source artifacts and reject PATH, download, install-time compiler, or shell fallback.

This Change may add CI jobs that compile and run Linux-provider tests on Linux, but it does not change the production default selection or declare Linux ECP support complete. Closure later consumes the exact provider manifest, switches the ProcessScope runtime bridge, and removes the old Linux PGID claim in one reviewed Change. ECP-8 later rebuilds and exercises clean claimed distributions and release packages.

## Risks / Trade-offs

- **[Risk] User namespaces are disabled by host policy.** → The primary returns typed unavailable before workload code; only an explicitly selected, installed, authenticated broker can serve that host.
- **[Risk] Namespace PID 1 reaping or final-record ordering is subtly wrong.** → Use a small native state machine, `waitid`-based actual-kernel mutations, fsynced monotonic journal records, and independent review; root exit never aliases empty.
- **[Risk] Publication is committed but the acknowledgement or activation caller crashes.** → Reconstruct the canonical reference digest from the private reference, require the concrete durable ledger on activate/recovery, and map native inert through the exact ledger record; never infer publication from helper liveness.
- **[Risk] PID or namespace identity changes between lookup and signal.** → Open pidfd, bind boot/start/ns inode, reread after open, and signal only the proven pidfd; drift retains without destructive action.
- **[Risk] Killing namespace PID 1 has kernel-version or WSL-specific behavior.** → Treat WSL as evidence for its actual kernel only, preserve retained failure outcomes, and rerun the oracle on supported release kernels in ECP-8.
- **[Risk] A privileged broker expands installation and security surface.** → Keep it a distinct provider and service, authenticate both peer and challenge, bind leases to cgroup inode/token, require root-owned non-writable state, and require a dedicated security review plus actual cgroup-v2 runner.
- **[Risk] The current worktree contains concurrent unrelated changes.** → Implementation and planning touch only this Change's named files, use targeted status/diffs, and never normalize or overwrite other session work.
- **[Trade-off] A new helper duplicates some framing/build code.** → The duplicate is bounded and preserves ownership: Linux authority can evolve independently while closure later integrates it without carrying the PGID protocol forward.
- **[Trade-off] Broker completion cannot be proven in the present WSL instance.** → Keep WSL primary tasks and broker/cgroup tasks separate; do not mark the Change terminal until the mandatory broker gate has real evidence, or Direction explicitly removes the broker capability in a new scope decision.

## Migration Plan

1. Add failing provider descriptor, private-reference codec, durable publication-ledger, artifact resolver, and shared-conformance fixture tests without registering a production default.
2. Add the source-owned Linux helper and primary namespace guardian; provision the pinned native WSL toolchain and close the WSL primary actual-kernel matrix.
3. Add the separately installed broker/client, durable lease store, and cgroup-v2 path; close its actual configured-Linux matrix and security review on an appropriate runner.
4. Add additive build/package/CI assembly and verify legacy ProcessCapsule behavior is unchanged. Do not rewrite existing legacy ProcessRefs or session registry entries.
5. Strictly verify this Change. Hand the exact provider tuples, manifests, runtime opener, evidence paths, and remaining ECP-8 gates to `ecp-native-process-capsule-closure`.
6. Rollback before closure consists of removing the unselected provider registrations/artifacts; no production default or durable legacy state has changed. After closure selection changes, rollback is owned by closure and must fail closed rather than revive PGID authority.

## Open Questions

None inside this Change. macOS strategy, final supported Linux distribution matrix, and release activation are explicit Direction/ECP-8 gates rather than implementation choices for this provider.
