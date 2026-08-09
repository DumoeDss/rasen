## Why

Windows ProcessCapsule execution still treats a helper-held handle plus a sampled accounting poll as recursive process authority, and the disproven POSIX result — a workload leaves a process group with `setsid()`/`setpgid()` — has the same shape on Windows wherever containment is inferred from a parent/child snapshot rather than enforced by the kernel. ECP-7 now has a frozen common `ProcessAuthorityProvider` contract, so Windows needs a real, recoverable, kernel-enforced containment provider before the native capsule and session host can honestly close.

## What Changes

- Add an exact Windows process-authority provider whose authority is an unnamed Job Object with breakaway disabled and kill-on-job-close set, held as the sole handle by a source-owned guardian process so that no descendant can leave the scope and no crashed controller can orphan a live scope.
- Make the workload root enter the Job before it executes its first instruction: the guardian creates it with `CREATE_SUSPENDED` and an at-creation `PROC_THREAD_ATTRIBUTE_JOB_LIST` assignment, proves membership with `IsProcessInJob`, and only then resumes the initial thread at activation. A root that cannot be proven in-Job is terminated while still suspended and never runs.
- Preserve prepare-before-publish inertness: prepare builds and proves the complete authority with no workload process object in existence, publication commits through the existing common publisher seam into a concrete durable Windows ledger, and `activate` performs the one resume with no publication side effect and no hidden publish frame.
- Make `root-exited` and `exact-scope-empty` separate, positively-proven facts: root exit comes from the root process handle plus its exact unsigned exit status, while exact empty comes only from the Job's I/O completion port reporting `JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO` with a complete message sequence. A closed transport, a quiet interval, or a sampled active-process count never substitutes for that proof.
- Add replacement-safe references bound to durable Windows identity — guardian process id with its exact creation time, the boot-scoped random scope id that names the private control endpoint, the boot identity, the Job's sole-handle attestation, and helper protocol/source identity — revalidated in full after each handle is opened and before any observation or destructive control, so process-id reuse can never target the wrong process.
- Add exact abort and recursive termination that act on the Job authority itself (`TerminateJobObject` plus completion-port convergence under a bounded re-terminate loop for processes created during teardown), never on an enumerated or sampled process tree, and never through `taskkill /T`, toolhelp snapshots, WMI, or console control events.
- Return typed `authority-unavailable` when Windows cannot supply the guarantee — Job creation denied, nested-Job assignment refused by an ambient Job, completion-port association unavailable, boot identity unobtainable, or the private endpoint unobtainable — with no silent fallback to a process group, a process tree, or the legacy capsule helper.
- Add actual-Windows mutation oracles, run natively on this host, for breakaway attempts, detached and double-forked descendants, nested Jobs, guardian death under the last-handle rule, sole-handle-invariant defeat, root-exit-with-live-descendants, exact natural empty, recursive kill under a create storm, prepared and published abort, replacement recovery, identity drift, and unavailable configurations.
- Extend native-helper build, manifest, integrity, and package checks additively for the Windows provider artifact. Windows x64 is a native runtime gate; Windows arm64 remains cross-build evidence only until real arm64 hardware exists.

## Capabilities

### New Capabilities

- `windows-process-authority-provider`: Exact Windows recursive process authority through a breakaway-disabled, kill-on-job-close Job Object with suspended assign-before-run activation, sole-handle guardian lifetime, completion-port exact-empty proof, replacement recovery, availability, and actual-Windows verification.

### Modified Capabilities

None. The accepted `process-authority-provider` common contract remains unchanged and is consumed as the provider-neutral boundary.

## Impact

- Affects Windows native authority code (`native/windows-process-authority`), the manifest-bound provider registry adapter under `src/core/session-host/process-authority/windows/`, helper resolution/integrity, build and package assembly, Windows runtime oracles, and the shared provider conformance fixture.
- Depends on the archived `ecp-platform-process-authority-foundation` contract and the ECP-7 architecture replan. It does not integrate the provider into the production ProcessScope/host path, does not switch any production default, and does not remove or hard-disable the legacy PGID path or the legacy capsule's Windows Job path; those atomic integration responsibilities remain with `ecp-native-process-capsule-closure`.
- Unlike the Linux sibling, this Change needs no virtualization layer: the development host is Windows, so every named actual-kernel gate is directly reachable and no gate may be left open on environment-unavailability grounds. Windows arm64 runtime truth, clean-distribution/install truth, packaging-matrix truth, and release claims remain separately gated.
- Does not touch `native/linux-process-authority/**` or `rasen/changes/ecp-linux-process-authority-provider/**`; the Linux tree is frozen at sourceDigest `087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59`.
- Makes no macOS statement. macOS remains decision-deferred by explicit Direction decision.
- Direction source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/session-execution-and-self-hosting/`.
