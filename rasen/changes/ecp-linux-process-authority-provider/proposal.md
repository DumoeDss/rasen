## Why

Linux ProcessCapsule execution still treats a PID/process group as recursive process authority, but a workload can escape that boundary with `setsid()` or `setpgid()`. ECP-7 now has a frozen common `ProcessAuthorityProvider` contract, so Linux needs a real, recoverable containment provider before the native capsule and session host can honestly close.

## What Changes

- Add an exact Linux process-authority provider whose primary path uses a user and PID namespace guardian to keep every descendant inside one kernel-enforced scope, preserve prepare-before-publish inertness, distinguish root exit from exact scope empty, and support exact abort and recursive termination.
- Add replacement-safe provider references and recovery that bind the machine boot, guardian process birth, and PID namespace identity, then reopen with pidfd and immediate identity revalidation before observation or control.
- Preserve prepared-versus-published inert recovery through the existing common publisher seam: one trusted durable ledger commits before acknowledgement and is revalidated before activation, so acknowledgement-loss or pre-activation crashes cannot be mistaken for a fresh prepare or hidden activation.
- Probe the complete primary construction before publication. Systems that cannot create the required unprivileged namespaces return typed `authority-unavailable` without starting workload code and without falling back to a process group or sampled PID tree.
- Add a separately selected, explicitly installed and authenticated privileged-broker path for environments whose policy disables unprivileged namespaces. Its authority is additionally bound to a broker-issued token and a non-migratable cgroup-v2 leaf; it is never an implicit fallback from the primary provider.
- Add actual-Linux mutation oracles for session/group escape, nested PID namespaces, guardian or broker owner death, natural empty, root-exit-with-live-descendants, recursive kill, pre-publication abort, recovery, identity drift, and unavailable configurations. Windows cross-target builds and injected fixtures remain build/contract evidence only.
- Extend native-helper build, manifest, integrity, and package checks additively for the Linux provider artifact. Final clean-distribution, installed-broker/cgroup-v2, multi-OS package, and release claims remain separately gated where their required runners exist.

## Capabilities

### New Capabilities

- `linux-process-authority-provider`: Exact Linux recursive process authority, lifecycle, replacement recovery, availability, optional installed-broker selection, and actual-kernel verification.

### Modified Capabilities

None. The accepted `process-authority-provider` common contract remains unchanged and is consumed as the provider-neutral boundary.

## Impact

- Affects Linux native authority code, the manifest-bound provider registry adapter, helper resolution/integrity, build and package assembly, Linux runtime oracles, and the shared provider conformance fixture.
- Depends on the archived `ecp-platform-process-authority-foundation` contract and the ECP-7 architecture replan. It does not integrate the provider into the production ProcessScope/host path or remove the legacy PGID path; those atomic integration responsibilities remain with `ecp-native-process-capsule-closure`.
- WSL2 with working user/PID namespaces and pidfd can supply actual-kernel evidence for the primary path after a pinned Rust toolchain is provisioned inside WSL. Its current hybrid cgroup layout lacks the required v2 controllers and `cgroup.kill`, so broker evidence requires a dedicated reconfigured WSL/VM/runner; WSL evidence still cannot establish general-distribution/install, packaging-matrix, or ECP-8 release truth.
- Direction source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/session-execution-and-self-hosting/`.
