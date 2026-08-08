# Process Authority Architecture Replan

Date: 2026-08-04

Status: macOS decision explicitly deferred; common/Linux/Windows work may proceed, while macOS, final closure, and three-OS release remain decision-gated

## Trigger and preserved findings

Review round 1 disproved the Change's POSIX process-group premise. A workload can call
`setsid()` or move a descendant into another process group, after which the controller's
reserved PGID is neither a containment boundary nor an exact empty/kill authority. The
following findings remain open and keep the Change non-terminal:

- `RC-001` Blocker: POSIX descendants can escape the claimed process-group authority.
- `RC-002` Blocker: the supervisor zombie prevents truthful natural-empty observation.
- `RC-003` Blocker: controller-live/group-empty can be reported as closed while authority remains.
- `RC-004` Major: one-shot parser/callback failure is not safely contained.
- `RC-005` Minor: completed clients can remain in the client map.
- `SEC-001` Blocker: transport loss can become a clean host detach.
- `SEC-002` Blocker: an ancestor junction can redirect helper resolution.
- `SEC-003` Blocker: cwd resolution can be retargeted between validation and spawn.

The previous implementation and reviews are evidence, not completion. In particular, no
additional PID/PGID/birth-time validation can turn a process group into a recursive
non-escapable authority.

## Required invariant

A supported platform authority must satisfy all of these properties before backend work is
activated:

1. descendants cannot escape the authority using APIs available to the workload;
2. exact live/empty and exact recursive kill do not depend on a sampled PID tree;
3. replacement after daemon/controller death can re-open or independently retain authority;
4. loss or unavailability is typed and fail-closed, never translated to `closed`;
5. the real escape, owner-death, recovery, natural-empty and terminate oracles run on the
   actual operating system before a support or release claim.

## Primary OS/API evidence

### Linux

- Linux PID namespaces isolate process-number membership. The namespace init is PID 1; if it
  terminates, the kernel terminates all processes in that namespace, and child PID namespaces
  cannot escape to an ancestor namespace. Source: Linux man-pages
  [`pid_namespaces(7)`](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).
- An unprivileged process can create a user namespace and then a PID namespace with capabilities
  scoped to that user namespace, subject to kernel configuration and distribution policy.
  Availability failures such as `EPERM`, `EINVAL` and namespace limits are normal probe results,
  not permission to fall back to PGID. Sources: Linux man-pages
  [`user_namespaces(7)`](https://man7.org/linux/man-pages/man7/user_namespaces.7.html) and
  [`unshare(2)`](https://man7.org/linux/man-pages/man2/unshare.2.html).
- cgroup v2 provides recursive `cgroup.events populated` observation and `cgroup.kill`. Delegation
  must prevent the workload from migrating outside the delegated subtree; a same-UID writable
  cgroup is therefore not an authority. A privileged broker can retain a root-owned leaf and use
  `CLONE_INTO_CGROUP` where supported. Sources: Linux kernel
  [cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html) and Linux man-pages
  [`clone(2)`](https://man7.org/linux/man-pages/man2/clone.2.html).

Conclusion: use an unprivileged user+PID namespace as the smallest primary authority. Run a
minimal namespace PID 1 guardian, activate the workload only after the namespace and durable
identity are published, reap until natural empty, and terminate by signalling that exact PID 1
from its ancestor. `setsid()`, `setpgid()` and nested PID namespaces remain inside the parent PID
namespace. Probe the whole construction during PREPARE. When policy disables it, fail closed or
use a separately installed authenticated privileged broker that creates the same namespace and
retains a non-migratable cgroup-v2 leaf; never use PGID as fallback.

After daemon restart, re-open the outer guardian using exact boot/start identity plus PID-namespace
inode (and broker token/cgroup inode on the broker path), then obtain a pidfd and revalidate. If the
guardian is absent, kernel PID-namespace teardown already provides the kill result. If identity or
broker state is uncertain, retain the opaque reference and return `authority-unavailable` or
`authority-uncertain`; do not restart work.

### Windows

Windows Job Objects already provide the intended kernel boundary: child processes remain in the
Job unless breakaway was explicitly enabled, and closing the last handle with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminates all associated processes. Source: Microsoft
[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

Conclusion: retain the unnamed Job, assign the suspended supervisor before activation, forbid
breakaway, and keep exactly one non-inherited owning handle in the controller. This platform does
not need a new containment primitive, only the common authority-provider contract and regression
oracles.

### macOS

- `NOTE_TRACK`, `NOTE_TRACKERR` and `NOTE_CHILD` have been deprecated and unsupported since macOS
  10.5; they are not a viable replacement. Source: Apple XNU
  [`event.h`](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/event.h).
- `es_new_descendants_client` recursively observes a caller and descendants created after client
  creation, but it is currently Beta and available starting with macOS 27. It requires the Endpoint
  Security entitlement. Source: Apple
  [`es_new_descendants_client`](https://developer.apple.com/documentation/endpointsecurity/es_new_descendants_client(_:_:)).
- `es_sync_client`, also Beta and available starting with macOS 27, gives a queue marker after
  earlier messages. A destroyed client also releases sync waiters, so completion is not by itself
  proof that the client remained authoritative. Source: Apple
  [`es_sync_client`](https://developer.apple.com/documentation/endpointsecurity/es_sync_client(_:_:)).
- Fork and exit are notification events rather than a hard fork authorization gate. Global sequence
  gaps identify dropped events and must invalidate any completeness claim. Sources: Apple
  [`ES_EVENT_TYPE_NOTIFY_FORK`](https://developer.apple.com/documentation/endpointsecurity/es_event_type_notify_fork)
  and [`global_seq_num`](https://developer.apple.com/documentation/endpointsecurity/es_message_t/global_seq_num).
- Endpoint Security distribution requires Apple entitlement approval and signed distribution;
  the stable global-client form normally carries app/system-extension installation and user approval
  obligations. Sources: Apple [Endpoint Security](https://developer.apple.com/documentation/endpointsecurity),
  [System Extensions](https://developer.apple.com/system-extensions/), and
  [Apple's Endpoint Security sample](https://developer.apple.com/documentation/endpointsecurity/monitoring-system-events-with-endpoint-security).

The smallest plausible macOS 27 design uses two already-active descendants clients: guardian `G`
creates its client before spawning controller `C`; `C` creates its client before spawning the
workload. Either single authority death forces the survivor into degraded termination rather than
continued execution. The survivor repeatedly exact-SIGSTOPs every known live descendant, calls
`es_sync_client`, incorporates any earlier fork/exit events, and repeats to a no-new-process fixed
point. Only a live client, no sequence gaps, exact birth identities and bounded convergence permit
recursive SIGKILL and an empty receipt. Any gap, dead client, identity drift or deadline is typed
uncertainty. Real macOS 27 tests must prove lineage remains visible after either guardian or
controller death and that the stop/sync fixed point closes a nested fork storm. The workload must
also be unable to kill both authorities; signal authorization or privilege separation is part of
the design, not a prompt convention.

A stable privileged/global Endpoint Security broker could extend support to older macOS versions,
but it adds installation, root/TCC or system-extension lifecycle, signing, entitlement and broker
restart concerns, and it lacks the macOS 27 descendants/sync proof seam. It is not an automatic
fallback until independently specified and proven.

## Complete designs compared

### Design A — native per-OS authority with an installed fallback broker (research-preferred; not product-approved for macOS)

- Windows: existing suspended-assignment, kill-on-last-handle Job.
- Linux: user+PID namespace guardian primary; installed authenticated broker creates the same
  namespace plus a root-owned cgroup-v2 leaf when unprivileged namespaces are unavailable.
- macOS 27+: signed/entitled dual descendants-client guardian/controller with a bounded stop/sync
  termination barrier. Older macOS is unavailable unless a separately proven installed privileged
  Endpoint Security broker is added.
- Common seam: `ProcessAuthorityProvider.prepare/activate/inspect/terminate/abort`, a versioned
  opaque authority reference, typed availability/uncertainty, and no weak fallback.

This design keeps native process and workspace semantics and is the smallest path compatible with
the current Session host. Its blocking cost is real: the current npm/Rust helper release builds
unsigned adjacent binaries and has no Apple entitlement, signing/notarization, installed broker, or
macOS 27 real-runner path. Choosing it therefore changes the declared minimum macOS/support matrix
and release/distribution pipeline.

### Design B — VM authority on macOS; native authority on Windows/Linux (research alternative; not product-approved)

- Windows and Linux remain as in Design A.
- macOS runs each capsule inside an Apple Virtualization VM. VM stop is the destructive containment
  operation, so guest `setsid()`/`setpgid()` cannot escape the VM boundary. Source: Apple
  [Virtualization](https://developer.apple.com/documentation/virtualization) and
  [`VZVirtualMachine.stop`](https://developer.apple.com/documentation/virtualization/vzvirtualmachine/stop(completionhandler:)).
- The product must own a guest image/kernel, boot and update chain, credentials, workspace transfer
  or sharing, resource limits, agent installation, crash recovery and virtualization entitlement.

This is the stronger coarse containment object, but it materially changes execution semantics,
package size, provisioning, performance and security ownership. It is not credible inside the
present 0.2.0 adjacent-helper release horizon without an explicit product decision and a separate
delivery program.

## Decision and exact boundary

Design A was the architecture review's technical preference, but it is not a product approval.
There is no implementable and honestly testable **macOS** authority, final cross-platform closure,
or three-OS release path until the product owner chooses the macOS support/distribution contract.
The platform-neutral provider contract plus the Linux and Windows authorities do not depend on
that product choice and may proceed independently.

The blocking decision is:

1. authorize macOS 27 as the minimum for native durable ProcessCapsule support, authorize use of
   Beta descendants/sync Endpoint Security APIs, and fund Apple entitlement, Developer ID
   signing/notarization plus a real macOS 27 acceptance runner; optionally scope an installed broker
   for older macOS as a later explicit support extension; or
2. require the current macOS range/no-installed-authority distribution, in which case Design A is
   unavailable and 0.2.0 must explicitly choose the VM program or change the platform-support
   promise. Neither choice may be represented as a silent `unsupported` fallback.

The product owner has explicitly deferred that decision and asked the other work to continue.
This is not approval of either option, silent unsupported, a minimum macOS version, entitlement/
signing work, or a macOS support claim. Until a later decision is recorded, macOS implementation,
final ProcessCapsule closure and ECP-8 three-OS release remain paused. Cross-compilation, injected
events and the old PGID tests cannot close that gate.

## Revised ownership and DAG

Split the prerequisite work inside the existing ECP-7 Slice so the deferred macOS choice does not
block independent contract, Linux, or Windows work. Do not create a new Slice; the user result
remains Session execution and self-hosting.

```text
ecp-platform-process-authority-foundation       [common only; initial runnable frontier]
  ├─> ecp-linux-process-authority-provider      [after foundation]
  ├─> ecp-windows-process-authority-provider    [after foundation; parallel with Linux]
  └─> ecp-macos-process-authority-provider      [decision-deferred; not runnable]

linux + windows + macos providers
  -> ecp-native-process-capsule-closure         [existing; failed-review history preserved]
       -> ecp-durable-agent-session-host        [prior escalation preserved]
            -> ecp-frozen-action-session-executor
                 -> ecp-session-policy-and-control-parity
                      -> ecp-session-self-hosting-vertical-proof
```

`ecp-frozen-action-session-executor` continues to depend explicitly on both closure and host so a
future run-state projection cannot mistake transitive history for delivery.

The common foundation owns only `ProcessAuthorityProvider`, the versioned opaque-reference envelope,
provider dispatch/registry, bounded lifecycle, typed availability/uncertainty and closed capability
negotiation. Linux owns its namespace/guardian/broker/cgroup authority and actual Linux oracles.
Windows owns its Job adapter and actual Windows mutations. The macOS node owns only the future
decision and later-selected implementation fault domain; neither Endpoint Security nor VM is
selected by this record.

The existing closure resumes only after all three provider Changes are terminal and owns integration
with ProcessScope/host plus `SEC-001..003`, `RC-002..005`, removal of the PGID claim/fallback, final
independent review and local lifecycle. ECP-8 still owns the first clean-branch actual Windows,
Linux and macOS acceptance/release matrix and must block release for an absent platform receipt.

No prior task, evidence, counter or finding is deleted. The 56 previously checked tasks remain
historical implementation evidence; they do not establish the newly required authority.

## Decision-defer projection semantics

The portfolio run-state schema has no `decision-gated` child status. Its schema-valid non-runnable
human-attention state is `escalated`; an invented raw status normalizes to `unknown`, while `pending`
can become runnable when dependencies are satisfied. The LEAD projection must therefore use:

- common foundation: `pending`, `dependsOn: []`, sole initial runnable child;
- Linux and Windows: `pending`, each depending on the common foundation, same parallel cohort only
  after foundation terminal;
- macOS: `escalated` with an exact `decision-deferred` note and replan evidence;
- existing closure: `escalated`, explicitly depending on all three providers, with apply/verify,
  review round 1, fixer no-op, eight open findings and counters preserved;
- original host: prior escalation preserved; executor: explicit dependency on closure plus host.

A future owner decision changes only the macOS planning/node through another explicit Direction
replan. It does not reset Linux/Windows/common evidence. After all three providers are terminal,
the LEAD grants the closure a fresh bounded integration/re-review budget while retaining its prior
history. This record authorizes planning only; it does not create Changes or mutate run-state.
