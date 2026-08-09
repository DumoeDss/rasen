# Broker actual-gate environment audit - round 2

Date: 2026-08-06 (Asia/Shanghai)

Change: `ecp-linux-process-authority-provider`

Review snapshot: `140115ced9df814f6adf3190b47171202d964a5e` on
`wip/ecp-shared-bounded-loop-lifecycle-resume`

## Verdict

**UNAVAILABLE.** There is no immediately usable terminal environment that proves every
Section 9 prerequisite. Tasks 9.1-9.7 and 11.4 must remain open. The running ordinary WSL
distribution can exercise the unprivileged namespace path, but it is not a unified,
writable cgroup-v2 broker environment. No ready Hyper-V VM, container daemon, Kubernetes
context, or self-hosted GitHub runner supplies the missing terminal.

This was a bounded environment audit. It did not reconfigure WSL or cgroups, invoke
`sudo`, start or stop a distribution/service/VM, create a container or runner, trigger a
workflow, install software, log in, or change repository state. One unprivileged
`unshare` process created user/PID/mount namespaces and exited immediately; it changed no
persistent host state. Credential values were not recorded.

## Authoritative current evidence

### WSL and Linux kernel

`wsl.exe --list --verbose` (decoded explicitly as UTF-16LE) reported:

- `Ubuntu-24.04`: WSL 2, **Running**.
- `docker-desktop`: WSL 2, **Stopped**.

Read-only probes in the already-running `Ubuntu-24.04` reported:

- Distribution: Ubuntu 24.04.1 LTS.
- Kernel: `Linux 5.15.167.4-microsoft-standard-WSL2 x86_64`.
- PID 1: systemd.
- Calling identity: uid/gid 1000 (`sayo`), not direct root. The `sudo` executable and
  `sudo` group membership exist, but administrative authority was deliberately not
  exercised and is not claimed.
- An ephemeral `unshare --user --map-root-user --pid --mount --fork` probe succeeded and
  observed euid 0 inside the new user namespace. This confirms the unprivileged
  user/PID/mount namespace construction capability only; namespaced euid 0 is not initial
  namespace root and does not authorize installed-broker administration.
- `/proc/self/cgroup` lists v1 controller hierarchies plus `0::/init.scope`. The only v2
  mount is `/sys/fs/cgroup/unified`, so the machine remains hybrid rather than unified.
- `findmnt` reports that v2 mount as `cgroup2 rw,...`, but the invoking identity cannot
  write the mount root, `cgroup.procs`, or `cgroup.subtree_control`.
- `cgroup.controllers` exists but is empty. The broker's current default requirement is
  the `pids` controller, so even the minimum declared controller is absent.
- `cgroup.events` and `cgroup.kill` are absent at the v2 mount root.

The mount's superblock `rw` flag does not make it a valid gate: the required controller
and control files are absent, the caller lacks a writable root-owned service subtree, and
the overall hierarchy is not unified. Reconfiguration or a privileged fixture would not
turn this ordinary shared WSL instance into the required isolated terminal without a new
environment decision.

### Windows virtualization and local providers

Current Windows read-only inventory reported:

- Windows 11 Pro build 26200; hypervisor present; approximately 63.3 GiB physical memory.
- The current Windows process is not elevated.
- CIM optional-feature state is enabled for Hyper-V, Virtual Machine Platform, and WSL.
- Hyper-V CIM returned zero virtual machines. The host can support a VM, but no existing
  Linux VM is ready to use.
- Docker CLI 28.3.2 and the `desktop-linux` context exist, but Docker Desktop's daemon pipe
  is absent and `com.docker.service` is stopped. No server cgroup facts can be proved.
- Podman, nerdctl, Multipass, Vagrant, QEMU, libvirt, Minikube, Kind, and `act` are absent.
  `kubectl` has no configured context. None supplies a current terminal.

A generic privileged container would remain a preflight unless it independently proves
the exact writable host cgroup authority, isolation, ownership, installed service, and
restart semantics required by Section 9.

### Repository, GitHub Actions, and runner capacity

Sanitized repository metadata reported:

- Remote: `origin` -> `https://github.com/DumoeDss/rasen.git`.
- Local branch/HEAD: `wip/ecp-shared-bounded-loop-lifecycle-resume` at `140115ce...`, six
  commits ahead of its upstream at audit time.
- GitHub CLI 2.93.0 is authenticated through the local keyring; repository metadata says
  `DumoeDss/rasen` is public and the current viewer has `ADMIN` permission.
- Remote workflows `CI`, `Docs site`, and `Release` are active.
- The repository runner API reports **zero self-hosted runners**.

The current `CI` workflow has a manual `workflow_dispatch` trigger, `contents: read`, and
ordinary `ubuntu-latest` jobs. A repository search finds no self-hosted label, broker job,
cgroup prerequisite probe, privileged install, or Section 9 matrix. Therefore the
workflow as authored does **not** carry the terminal gate.

The Actions surface can structurally host a new explicit manual-only job, but a
GitHub-hosted Ubuntu runner is not an already acquired terminal. Its cgroup namespace and
privileged operations must be probed first, and hosted-runner policy may reject the gate.
An environment probe failure is an open gate, not a skip or pass.

## Environment qualification table

| Candidate | Current result | Terminal? | Decisive reason |
| --- | --- | --- | --- |
| Ordinary Ubuntu WSL | Live kernel and unprivileged namespaces available | No | Hybrid hierarchy; empty controller list; no `cgroup.events`/`cgroup.kill`; no writable service subtree; not isolated |
| `docker-desktop` / Docker | Distribution and daemon stopped | No | No running server or cgroup authority |
| Hyper-V | Platform enabled, zero VMs | No | Capability exists, but no configured Linux guest/root authority |
| Other local VM/container providers | Absent or unconfigured | No | No runnable isolated Linux authority |
| GitHub self-hosted runner | Runner count 0 | No | No dedicated runner exists |
| GitHub-hosted `ubuntu-latest` | Workflow capacity exists; not probed for this gate | Not yet | Requires a committed dedicated job, manual execution, and successful prerequisite probe |

## Minimum external authorization

Preferred option - GitHub Ubuntu dedicated gate:

1. Authorize a narrowly scoped, manual-only broker gate workflow/job. It must reject
   pull-request/fork execution, bind the trusted repository and exact commit, use no
   implicit fallback, and make the first step fail closed unless unified writable cgroup
   v2, `pids`, `cgroup.events`, `cgroup.kill`, namespace operations, and runner `sudo`
   authority are all actually available.
2. Authorize the workflow edit to be committed and pushed, the exact revision to be
   dispatched, source-owned broker/helper installation under runner `sudo`, and receipt
   retrieval. No ordinary or forked CI job should acquire that privilege.
3. If and only if the probe passes, run Sections 9.2-9.6 and publish the Section 9.7
   receipts plus an independent security review. A successful probe alone does not close
   the gate.

Fallback - dedicated Hyper-V Linux VM:

- Explicitly authorize Windows elevation, an approved Linux image and VM/storage/network
  targets, VM creation/start, unified-cgroup configuration, root toolchain/service
  installation, and isolated gate execution. This path is more controllable but has more
  local external-state impact. No such authority was exercised in this audit.

Reconfiguring the ordinary WSL instance is lower priority because WSL configuration and
shutdown are shared/global and the result would still need a defensible isolation model.

## Evidence that remains non-terminal

WSL primary-path receipts, a successful unprivileged `unshare`, Windows cross-builds,
mock or injected cgroup fixtures, host Rust tests, static installer checks, an empty v2
mount, a Docker client/context, generic CI success, and a GitHub prerequisite probe do not
close Section 9. **WSL mocks and cross-build artifacts explicitly do not count as terminal
broker evidence.**

The existing round-1 broker review independently reports a probe-only installed daemon
and 7 Blocker plus 1 Major findings at the reviewed snapshot. Concurrent broker fixes are
not acceptance evidence until a fresh independent review passes. Environment acquisition
and product review are separate gates: obtaining a runner cannot close missing broker
behavior, and fixing broker behavior cannot substitute for the real cgroup-v2 matrix.

## Durable findings

- Immediate terminal availability: **unavailable**.
- Ordinary WSL is suitable only for the primary namespace gate under its recorded limits.
- No local VM/container or self-hosted runner currently supplies Section 9 authority.
- Existing CI can be extended but is not currently a privileged broker gate.
- The smallest next external-state authorization is a trusted manual GitHub Ubuntu probe
  and dedicated broker job; the deterministic fallback is an explicitly authorized
  Hyper-V Linux VM.
- Until one path produces all named actual receipts, tasks 9.1-9.7 and 11.4 remain open
  and the Linux Change is non-terminal.
