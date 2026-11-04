# Section 9 broker cgroup-v2 gate — availability determination (LEAD #2)

Date: 2026-08-07

## Boundary

This receipt determines ONLY whether the Section 9 actual broker cgroup-v2 gate environment exists.
It closes no Section 9 task. It is not evidence for the primary provider, package install support,
production default selection, closure, or ECP-8 release truth.

**Verdict: the gate environment does NOT exist on this machine and cannot be improvised on it.
Tasks 9.1-9.7 remain unchecked and the Change is reported non-terminal, per tasks 9.7 and 11.4.**

This file reached two earlier verdicts, both wrong, in opposite directions. They are recorded in
"Determination history" below rather than deleted, because the method errors matter more than the
conclusions and both belong in the review wave.

## Environment

```text
uname -a      Linux Sayo 5.15.167.4-microsoft-standard-WSL2 #1 SMP Tue Nov 5 00:21:55 UTC 2024 x86_64
distribution  Ubuntu 24.04.1 LTS  (WSL2 distro "Ubuntu-24.04", the operator's daily instance)
PID 1         systemd
unprivileged  uid=1000(sayo); `sudo -n true` -> "sudo: a password is required"
privileged    `wsl.exe -u root` -> uid=0(root), no password required
```

```text
findmnt /sys/fs/cgroup           tmpfs   ro,nosuid,nodev,noexec,size=4096k,mode=755
findmnt -t cgroup2               cgroup2 /sys/fs/cgroup/unified  rw,nsdelegate
stat -f /sys/fs/cgroup           fstype = tmpfs        (NOT cgroup2fs)
stat -f /sys/fs/cgroup/unified   fstype = cgroup2fs
cgroup v1 controller mounts      15
/sys/fs/cgroup/unified/cgroup.controllers      empty
/sys/fs/cgroup/unified/cgroup.subtree_control  empty
/proc/cgroups                    pids -> hierarchy 12, num_cgroups 51, enabled 1
```

Hybrid layout. `pids` is bound to cgroup-v1 hierarchy 12 with 51 live cgroups. Controller-to-
hierarchy binding is global, not per-namespace, so `pids` cannot appear in cgroup-v2 anywhere on this
host while that v1 hierarchy is mounted.

## Why the gate is unavailable — two blockers, both verified in source

### Blocker 1 — the broker hard-requires the `pids` resource controller

`native/linux-process-authority/src/broker_cgroup.rs:16-20`:

```rust
pub fn broker_default() -> Self {
    Self {
        required_controllers: vec!["pids".to_owned()],
    }
}
```

The installed daemon uses exactly that
(`src/bin/rasen-linux-process-authority-broker.rs:293`,
`BrokerCgroupAuthority::new(kernel, CgroupRequirements::broker_default())`).

`FsCgroupKernel::probe` reads the service subtree's `cgroup.controllers` and returns
`unavailable("required cgroup v2 controller is unavailable")` when a required controller is missing,
before it ever reaches `cgroup.procs`, `cgroup.kill` or `cgroup.events`. It then also attempts to
write `+pids` into `cgroup.subtree_control` and fails with
`unavailable("required cgroup v2 controller did not enable")` if that does not take.

Making `pids` available to cgroup-v2 on this host would require unmounting the v1 `pids` hierarchy,
stripping pids accounting from 51 live systemd cgroups on the operator's daily machine. That is out
of scope and was explicitly forbidden.

**The requirement cannot be waived by configuration.** Confirmed by running the production types
against the real kernel:

```text
STEP A2 | ensure_service_subtree() on the hardcoded layout | Err("cgroup mount is not unified cgroup v2")
STEP B3 | probe() with broker_default() = ["pids"]         | Err("required cgroup v2 controller is unavailable")
STEP B4 | CgroupRequirements { required_controllers: [] }  | Err("cgroup controller requirements are malformed")
STEP B5 | create_leaf() (production entry, probe-gated)    | Err("required cgroup v2 controller is unavailable")
```

`B4` is the decisive one: an empty requirements list is rejected as malformed, so the broker
structurally demands at least one cgroup-v2 resource controller and this hybrid host has zero.
Section 9 is therefore unreachable here **by construction, not by policy** — no configuration,
relaxation, or operator authorisation can make it reachable on this machine.

### Blocker 2 — the install layout is hardcoded onto a read-only tmpfs here

`native/linux-process-authority/src/broker_install.rs`, `BrokerInstallLayout::system_default()`
hardcodes, with no argv override (the daemon's argv is closed by invariant):

```text
binary          /usr/libexec/rasen/rasen-linux-process-authority-broker
private_key     /var/lib/rasen/linux-process-authority/broker.key
state_directory /var/lib/rasen/linux-process-authority/leases
socket          /run/rasen/linux-process-authority/broker.sock
service_unit    /usr/lib/systemd/system/rasen-linux-process-authority-broker.service
cgroup_subtree  /sys/fs/cgroup/rasen-linux-process-authority
```

and `validate()` refuses any layout that does not keep `state_directory` under `/var/lib/rasen`,
`socket` under `/run/rasen`, and `cgroup_subtree` under `/sys/fs/cgroup`.

On this host `/sys/fs/cgroup` is a read-only tmpfs, not cgroup2fs, so `validate_cgroup2`'s statfs
magic check fails and creating the service subtree returns EROFS. Relocating the install to a
scratch prefix is refused by `validate()`. Editing `system_default()` would make the gate prove a
modified broker rather than the source-owned one, which is not evidence.

## The repository's own CI already defines the intended environment — and still leaves Section 9 open

`.github/workflows/linux-process-authority.yml` contains a `broker-privileged-manual` job that
encodes exactly what this gate needs:

```yaml
runs-on: [self-hosted, linux, x64, rasen-cgroup-v2-broker]
environment: linux-process-authority-broker
if: workflow_dispatch && repository == 'DumoeDss/rasen'
    && inputs.broker_gate_authority == 'writable-cgroup-v2+sudo'
```

Its authority preconditions require passwordless `sudo`, root-level `/sys/fs/cgroup/cgroup.controllers`,
`cgroup.kill` and `cgroup.events` — i.e. a **unified** cgroup-v2 layout, not this hybrid one — and a
**pre-installed** broker at the system paths above, including a live `broker.sock`.

Decisively, that job's final step is titled `Preserve the actual installed-broker gate as open` and
records:

> This manual job validates protected-runner wiring and broker contracts only. Section 9 still
> requires the exact installed service, authenticated client, lifecycle mutations, and independent
> security receipt.

So even the repository's own privileged CI job does not close Section 9 by design. Section 9 needs a
provisioned, dedicated, self-hosted runner with a unified cgroup-v2 hierarchy, passwordless sudo, the
broker installed at its system paths, pinned Rust 1.88.0, the `rasen-cgroup-v2-broker` label, a
protected GitHub environment, and the `RASEN_BROKER_GATE_AUTHORITY` repository variable. That is
infrastructure provisioning, not a command that can be run here.

## Review-wave finding: design/code divergence on required controllers

`design.md:134-136` describes the broker leaf in terms of `cgroup.procs`, `cgroup.kill`,
`cgroup.events`, leaf inode identity and root ownership/mode only. It never mentions a resource
controller. The code additionally hard-requires `pids`. Either the design under-specifies the
broker's real dependency or the code over-constrains the gate.

This is recorded neutrally and deliberately left unresolved: it is a product decision, and resolving
it by editing `broker_default()` to make a gate pass would be exactly backwards. Route to the review
wave.

## Determination history — two wrong verdicts and the method error behind both

**Wrong verdict 1 — "unavailable" for the wrong reasons.** Concluded no root authority from
`sudo -n true` failing, and concluded no usable cgroup-v2 from a `mkdir` denial and a migration
failure. All three were probing artefacts: WSL grants passwordless root via `wsl.exe -u root`; the
`mkdir` denial was an unprivileged probe; and the migration failure was cgroup-v2 delegation
containment, because the probing shell sat in `/init.scope` whose `cgroup.procs` uid 1000 cannot
write. From inside a systemd user scope, unprivileged leaf creation, migration and `populated 1` all
succeed in the delegated `user@1000.service` subtree.

**Wrong verdict 2 — "available" for the wrong reasons.** After a root probe showed a root-owned
`755` leaf, working `cgroup.procs`/`cgroup.kill`/`cgroup.events`, real migration, an unprivileged
write refused with `Permission denied`, and `populated 1` -> `populated 0`, this file declared the
gate available and reduced the remaining gap to 9.1's isolation clause. That conclusion validated
against `design.md` prose instead of the broker's actual fail-closed startup probe. The code demands
things the design text never mentions.

**The method error, common to both:** an environment verdict was reached by generalising from a
narrow probe, without enumerating the privilege entry points in the first case and without reading
the consuming code path in the second. For an environment gate, the authority is the code's own
fail-closed probe plus the full set of entry points — not a single command's exit status and not the
design prose. Both wrong verdicts were expensive: the first abandoned seven tasks as unreachable, the
second nearly authorised installing a privileged root broker and a systemd unit on the operator's
daily machine to buy a receipt for a gate that provably cannot complete.

Also corrected in passing: `design.md:15` claims this WSL "exposes no usable controllers,
`cgroup.events`, or `cgroup.kill`". The controllers half is right; the rest is wrong. Both files
exist on all 23 non-root cgroups here and are absent only at the cgroup-v2 root, which the kernel
documents as expected for non-root-only files.

## Cleanup and safety

Every probe cgroup created during this determination was removed and verified absent; every probe
process was reaped. No package was installed, no broker or systemd unit was installed, no cgroup
hierarchy was mounted, unmounted or reconfigured, and no global WSL, service, or network state was
modified.
