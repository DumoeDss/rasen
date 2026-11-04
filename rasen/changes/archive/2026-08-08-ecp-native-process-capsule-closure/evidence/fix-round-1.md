# Review fix round 1: design boundary

## Outcome

**PAUSED — architectural Blocker, no product-code fix applied.** RC-001 proves
that the selected POSIX process-group authority cannot satisfy the authored
whole-scope contract. The current helper puts the supervisor in one process
group, and every empty/terminate decision is made against that group. A backend
or descendant can call `setsid()` (or create another group with `setpgid()`),
leave the reserved group, and remain alive after the helper emits
`SCOPE_EMPTY`. Patching RC-002/RC-003 inside that model would therefore make an
already incomplete authority more internally consistent without making it
correct.

The round stopped at the explicit clean-boundary exception in the fixer brief:
when RC-001 requires privileged or broker-owned containment, preserve the
finding and hand off a design-level replan rather than weaken the specification,
poll a process tree, or mark Linux/macOS supported without containment.

## Kernel/API evidence and eliminated hypotheses

1. **A POSIX process group is not containment.** Linux `setsid(2)` creates a new
   session and a new process group containing only the caller; the documented
   reliable pattern is fork, parent exit, then `setsid()`. Apple documents the
   same macOS behavior. This is exactly the escape available to a detached Node
   child.
   - Linux man-pages project: <https://man7.org/linux/man-pages/man2/setsid.2.html>
   - Apple macOS `setsid(2)`: <https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setsid.2.html>
2. **Parent/session/PGID birth facts cannot revoke that syscall.** The current
   opaque ref can prove that the original controller and supervisor are exact,
   but it contains no kernel object that automatically acquires descendants
   after they change session/group. Re-reading PIDs, PPIDs, sessions, or groups
   is discovery after the escape, not durable containment, and reparenting/PID
   reuse prevents it from being an exact authority.
3. **Linux has a suitable authority only when a cgroup-v2 subtree is owned or
   delegated correctly.** Kernel documentation says children are born into the
   parent's cgroup, a delegated subtree can prevent migration out, recursive
   `cgroup.events: populated` is the exact live/empty fact, and `cgroup.kill`
   kills the whole subtree while handling concurrent forks and protecting
   against migrations. Creating and owning that subtree requires an explicit
   delegation/service contract; the current adjacent unprivileged helper has
   none.
   - Kernel cgroup-v2 API: <https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html>
4. **macOS has no public cgroup/Job-equivalent in the current dependency shape.**
   Endpoint Security can report fork/exit events, but Apple requires an entitled,
   privileged client packaged as a daemon/system extension. A plain adjacent
   Rust helper is neither entitled nor privileged. Event observation by itself
   also needs a separately proved termination/barrier design before it can be
   called exact containment.
   - Endpoint Security overview: <https://developer.apple.com/documentation/EndpointSecurity>
   - Client privilege/entitlement requirements: <https://developer.apple.com/documentation/endpointsecurity/client>
   - Fork event: <https://developer.apple.com/documentation/endpointsecurity/es_event_type_notify_fork>
5. **A VM is a real macOS containment alternative but a product architecture,
   not a small helper patch.** Apple's Virtualization framework exposes one VM
   object with start/stop state and requires the virtualization entitlement; it
   introduces a guest image, filesystem-sharing, tool/runtime, signing, and
   installation contract.
   - Virtualization framework: <https://developer.apple.com/documentation/virtualization>
   - `VZVirtualMachine`: <https://developer.apple.com/documentation/virtualization/vzvirtualmachine>

Eliminated approaches:

- reserving a PGID and checking exact controller/supervisor births;
- keeping the administrative supervisor alive or reaping it earlier;
- repeated `/proc`, `proc_pidinfo`, PPID, SID, or PGID enumeration;
- signalling one process group after `ROOT_EXIT`;
- treating an escaped process as a documented exception or redefining
  "detached";
- cross-target compilation or injected frame tests as runtime containment
  evidence;
- an unentitled macOS Endpoint Security observer as a drop-in helper feature.

## Finding-by-finding delta

| Finding | Round-1 code/test delta | Status and next exact proof |
| --- | --- | --- |
| SEC-001 Blocker | None. | Still open. After containment architecture is selected, add a public host-seam RED where `live.closed` rejects, then later reconciles to exact empty; registry `process`, writer claim, capacity and restart exclusion must remain until that later exact receipt. |
| SEC-002 Major | None. | Still open. Add source-root and dist-root ancestor junction/reparse/symlink REDs, then canonicalize and validate every trust-root component under the canonical package root before opening the manifest/helper. |
| SEC-003 Major | None. | Still open. Bind the prepared cwd by inherited/open filesystem authority. The current controller already starts in the canonical cwd; the broker/helper must carry that identity into backend activation without resolving `spec.cwd` again. Add a publication-barrier rename/retarget RED. |
| RC-001 Blocker | Source/API proof only; no product patch. | **Architecture blocker.** Linux needs broker-owned/delegated cgroup-v2 authority (or an equally strong namespace/service design). macOS needs a separately proved privileged system-extension/broker or VM authority. A process group cannot close this finding. |
| RC-002 Blocker | None. | Still open in the current implementation, but likely superseded by cgroup/other kernel-empty observation. If the interim PGID controller remains, `PosixContainment::is_empty` must mutably `try_wait` the exact supervisor before testing group absence and emit one terminal receipt. |
| RC-003 Blocker | None. | Still open in the current implementation, but likely superseded by broker authority. Until then, exact controller + empty group is live/retained; termination must close controller and group before `closed`. |
| RC-004 Major | None. | Still open. Add one-shot public protocol REDs for oversized, truncated, duplicate, unknown, error-then-observation and observation-then-extra frames; catch parser callbacks and accept exactly one ordered observation as a typed bounded outcome. |
| RC-005 Minor | None. | Still open. Delete only the map entry whose exact client reaches `SCOPE_EMPTY`; retain control-lost, foreign and uncertain entries for reconciliation. |

No reviewer report was overwritten and no orchestration-owned task was ticked.

## Viable architecture options for the replan

### Option A — OS-specific containment broker (recommended direction to spike)

- Keep the existing Windows Job-object adapter.
- On Linux, have an installed broker own a cgroup-v2 parent, create one leaf per
  opaque scope, move the inert supervisor into it before publication/activation,
  keep workload processes unable to write the ancestor migration boundary,
  observe recursive `populated=0`, and terminate via `cgroup.kill` (with a
  separately defined graceful phase).
- On macOS, perform a bounded spike for an entitled/root Endpoint Security
  system extension or daemon that maintains exact audit-token/birth lineage and
  proves a no-fork termination barrier. Do not assume notifications alone are
  containment. If that proof fails, select the VM option.
- Make broker installation, authentication, version negotiation, restart
  recovery, opaque ref integrity, availability, upgrade/rollback, user consent,
  and package signing first-class requirements.

### Option B — VM-backed capsule on macOS

Run the backend and all of its descendants inside one controlled VM, expose only
the approved workspace/tool channels, and use VM stopped state as the terminal
authority. This is the clearest non-escapable public macOS primitive found, but
it is a large runtime/distribution change and needs product acceptance for
latency, disk/memory, guest image updates, networking, credentials, and host
filesystem semantics.

### Option C — change the supported-platform contract

Ship 0.2.0 ProcessCapsule support only where a non-escapable OS authority is
implemented, failing closed elsewhere. The fixer brief explicitly says merely
marking Linux/macOS unsupported is not closure for the locked ECP-8 target, so
this option requires an explicit Direction/product decision and cannot be made
inside this round.

## Commands and evidence classification

- `git branch --show-current` — current-host repository fact; result
  `wip/ecp-shared-bounded-loop-lifecycle-resume`.
- `node bin/rasen.js status --change ecp-native-process-capsule-closure --json`
  and `node bin/rasen.js instructions apply --change
  ecp-native-process-capsule-closure --json` — repo-local planning facts; 56/63
  tasks before and after this round.
- Complete Change artifacts/evidence/reviewer reports and the concrete Rust,
  resolver, one-shot, transport and host paths were read — source-analysis
  evidence.
- Kernel, Linux man-pages, and Apple documentation above — primary API/design
  evidence; not an implementation or runtime pass.
- No focused, static, native, cross-target, package, full-root, UI, Linux, or
  macOS gate was run because no product code changed and the blocking authority
  design is unresolved.

## Files changed, residue, and exact re-review delta

Files changed by this fixer only:

- `rasen/changes/ecp-native-process-capsule-closure/evidence/fix-round-1.md`
- `rasen/changes/ecp-native-process-capsule-closure/handoff/fixer-1.md`

There is no product-code/test delta to re-review. After a Direction/Change
replan, the next non-author review must start from the successor's complete
diff against this exact boundary and must include real `setsid()` escape oracles
on Linux and macOS, not the prior in-group resistant-child fixture.

Read-only residue audit found no reason to reap a test-owned process or remove a
temp root. No process was started and no existing temp/run-state/stash path was
modified or deleted.

## Unresolved risk

All eight review findings remain open. In particular, the current evidence must
not be described as locally review-clean, and ECP-8 must not run the old POSIX
acceptance command as though it could prove containment. The release remains
blocked until the platform authority is replanned, implemented, and reviewed.
