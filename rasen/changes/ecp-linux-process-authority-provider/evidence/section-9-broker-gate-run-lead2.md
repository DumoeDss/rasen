# Section 9 actual cgroup-v2 broker gate — run record (Track C, LEAD #2)

Date: 2026-08-07
Worktree HEAD: `140115ced9df814f6adf3190b47171202d964a5e`
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`

## Verdict

**The Section 9 gate did NOT run. It cannot run on this host.** Not because of the isolation
relaxation that was pre-authorised, but because the broker's own fail-closed startup probe demands a
cgroup-v2 resource controller this kernel cannot supply in cgroup v2, and because the hardcoded
install layout points its cgroup service subtree at a read-only tmpfs.

| Task | Status | Basis |
| --- | --- | --- |
| 9.1 | **NOT MET** | Runner is not dedicated (recorded relaxation below) **and** lacks required cgroup-v2 controllers/operations. The second half is not waivable. |
| 9.2 | **PARTIAL** | Build of the exact source-owned broker/helper: DONE with receipts. Install + ownership/mode/key-identity/peer-credential verification: **NOT RUN** — no install was performed. Unprivileged-refusal proofs: DONE. |
| 9.3 | **NOT RUN** | Requires a prepared broker lease. `prepare_leaf` cannot succeed on this host, and independently cannot succeed on *any* real kernel (Blocker D1). |
| 9.4 | **NOT RUN** | Requires a running installed broker holding a populated lease. |
| 9.5 | **NOT RUN** | Requires a durable lease with a broker-issued token. Cgroup-inode drift mutations were exercised at the kernel layer only (see Part C/M), which is not the task. |
| 9.6 | **NOT RUN** | `cgroup.kill` and populated-to-empty convergence were exercised at the kernel layer only. The lifecycle oracles (natural empty, root-exit-with-live-descendants, prepared/published abort) require the guardian + lease path and were not reached. |
| 9.7 | **NOT PUBLISHABLE** | 9.7 forbids marking the broker terminal while any named actual gate is skipped. Six of seven are skipped. The independent security review is **outstanding** and is not mine to write. |

Nothing in this file closes a Section 9 task. Every checkbox in Section 9 must stay unchecked.

**A production Blocker was found and fixed during this run.** Running the source-owned
`FsCgroupKernel` against the real kernel showed that `place_guardian` could never succeed on any real
cgroup filesystem — the broker's prepare path was dead. It was reported before any freeze marker was
cut and fixed on the LEAD's explicit authorisation. Details, the regression guard and its mutation
proof are in "Defect D1"; the resulting `sourceDigest` change is in Part A. That fix is the most
consequential outcome of this run, and it is a direct consequence of the gate being attempted at all
even though it could not complete.

## 9.1 — explicit relaxation statement, and the finding that supersedes it

### The relaxation that was authorised

Task 9.1 requires "a dedicated reconfigured WSL, Linux VM, or runner with ... isolation from the
ordinary WSL environment". The operator explicitly authorised running this gate inside their
**daily** WSL distribution `Ubuntu-24.04` instead of a dedicated one.

- **What was relaxed:** the word *dedicated*, and the clause *isolation from the ordinary WSL
  environment*. The runner used is the operator's everyday distro, shared with their normal work,
  their running systemd, and their user session.
- **Compensating controls applied:** every cgroup created lived under one dedicated subtree
  `/sys/fs/cgroup/unified/rasen-broker-gate.slice`; every build artefact lived under one dedicated
  ext4 prefix `/home/sayo/.local/share/rasen-build/lead2-track-c/`; the gate harness was built and
  kept **outside the repository**; no package was installed; no `/etc/wsl.conf` change; no systemd
  unit created, modified, or enabled; no cgroup hierarchy mounted, unmounted, or reconfigured; no
  process signalled that this harness did not fork; full removal and post-run verification of
  absence (Part F).
- **The review wave may challenge this relaxation.** It is a real weakening of the task text and is
  recorded here rather than papered over.
- Task 9.1's prohibition on injected cgroup fixtures as terminal evidence is **unaffected and was
  honoured**. No fixture output appears in this file as terminal evidence.

### The finding that makes the relaxation moot

Relaxing isolation does not unblock anything. 9.1 also requires "writable unified cgroup v2,
required controllers/operations". This host fails that half, and the failure is structural:

```text
/proc/cgroups (excerpt)
#subsys_name    hierarchy  num_cgroups  enabled
memory          5          73           1
pids            12         51           1
cpu             227        14           1
```

`pids` is bound to cgroup **v1** hierarchy 12 with 51 live cgroups. A controller bound to a v1
hierarchy cannot appear in cgroup v2 anywhere in the system, and mount namespaces do not change
that — controller binding is global. Making `pids` available to v2 requires unmounting the v1 `pids`
hierarchy, which would strip pids accounting from 51 of the operator's live systemd cgroups. That
operation was forbidden and was not attempted.

An earlier availability determination
(`section-9-broker-cgroup-gate-availability-lead2.md`) concluded that resource controllers are not
required, reading `design.md:134-136`. **That reading is correct about the design document and wrong
about the implementation.** See Blocker D2.

## Environment

```text
uname -a       Linux Sayo 5.15.167.4-microsoft-standard-WSL2 #1 SMP Tue Nov 5 00:21:55 UTC 2024 x86_64
distribution   Ubuntu 24.04.1 LTS   (WSL2 distro "Ubuntu-24.04", the operator's daily instance)
PID 1          systemd
privileged     wsl.exe -u root  -> uid=0(root)   (no password)
unprivileged   wsl.exe          -> uid=1000(sayo)

findmnt -no SOURCE,FSTYPE,OPTIONS /sys/fs/cgroup
tmpfs    tmpfs    ro,nosuid,nodev,noexec,size=4096k,nr_inodes=1024,mode=755
findmnt -no SOURCE,FSTYPE,OPTIONS /sys/fs/cgroup/unified
cgroup2  cgroup2  rw,nosuid,nodev,noexec,relatime,nsdelegate

stat -f -c %T /sys/fs/cgroup            -> tmpfs
stat -f -c %T /sys/fs/cgroup/unified    -> cgroup2fs
/sys/fs/cgroup/unified/cgroup.controllers      -> []   (empty)
/sys/fs/cgroup/unified/cgroup.subtree_control  -> []   (empty)
cgroup v1 controller mounts: 15
```

Toolchain (pinned; ambient cargo/rustc/cc were not used — none exist on this host):

```text
rustc 1.88.0 (6b00bc388 2025-06-23)
cargo 1.88.0 (873a06493 2025-05-10)
RUSTUP_HOME  /home/sayo/.local/share/rasen-rustup-1.28.2
CARGO_HOME   /home/sayo/.local/share/rasen-cargo-1.28.2
linker       private `cc` wrapper delegating to zig 0.16.0
             (/home/sayo/.local/share/rasen-build/lead2-track-c/cc/cc)
             clang version 21.1.0, Target: x86_64-unknown-linux5.10.0-gnu2.39.0
```

The host has **no C linker** (`cc`, `gcc`, `clang`, `musl-gcc` all absent). The established
zig-delegating wrapper was used rather than installing a compiler, which would have modified the
operator's machine.

## Part A — 9.2 build half (source-owned broker and helper)

```sh
export RUSTUP_HOME=/home/sayo/.local/share/rasen-rustup-1.28.2
export CARGO_HOME=/home/sayo/.local/share/rasen-cargo-1.28.2
export PATH="$CARGO_HOME/bin:/home/sayo/.local/share/rasen-build/lead2-track-c/cc:$PATH"
export CARGO_TARGET_DIR=/home/sayo/.local/share/rasen-build/lead2-track-c/target
cd native/linux-process-authority
cargo build --locked --release --target x86_64-unknown-linux-gnu \
  --bin rasen-linux-process-authority-broker \
  --bin rasen-linux-process-authority-broker-client \
  --bin rasen-linux-process-authority
```

The build was performed twice: once before the Blocker in Part E was found, and once after the fix
in "Defect D1" below was applied and authorised. **Only the second set is current.**

```text
Finished `release` profile [optimized] target(s)

rasen-linux-process-authority-broker         size=853008  sha256=1c6ef020ac5e8259d8f12927d68943e9d4b2e36b32a773bfd8254463243daa9d
rasen-linux-process-authority-broker-client  size=546920  sha256=7a74c0a991b86ce3ee2a4efaafbe8b2632c634293242bd8b1a2b6eba774ce8a6
rasen-linux-process-authority                size=503608  sha256=a73c39e820a985c84e0a877dc59f0ab3d9c0f2097121661293f2645f22506324

ELF 64-bit LSB pie executable, x86-64, dynamically linked, stripped   (all three)
```

`sourceDigest()` as defined by `scripts/build-linux-process-authority.mjs:98-103`:

```text
sourceDigest = 087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
inputs       = 26 files (Cargo.lock, Cargo.toml, THIRD_PARTY.md, src/**)
```

Digest history on this change, so no receipt binds to a stale value:

| Digest | Meaning |
| --- | --- |
| `826fa048...` | Quoted in the Track C briefing. Already stale when Track C started; never corresponded to any artifact here. |
| `a568f53b...` | The pre-fix tree. Track C's first build and its first harness run correspond to this. Superseded. |
| `087d87a5...` | **Current.** The D1 fix plus its regression test. All artifact hashes above, and every post-fix receipt in this file, correspond to this. |

Superseded pre-fix artifacts, recorded only so the earlier receipts remain attributable:
`broker 2ebdb20b...`, `broker-client 46716656...`, `helper 3bdeffd6...`.

## Part B — unprivileged and uninstalled refusals (9.2, partial)

Real built broker binary, uid 1000:

```text
$ rasen-linux-process-authority-broker probe
rasen Linux authority broker failed closed: installed broker must run as uid 0
exit=69

$ rasen-linux-process-authority-broker serve
rasen Linux authority broker failed closed: installed broker must run as uid 0
exit=69

$ rasen-linux-process-authority-broker clean-uninstall-state
rasen Linux authority broker failed closed: broker uninstall-state cleanup must run as uid 0
exit=69

$ rasen-linux-process-authority-broker --fault=inject-migration-failure
rasen Linux authority broker failed closed: usage: rasen-linux-process-authority-broker <probe|serve|clean-uninstall-state>
exit=69

$ rasen-linux-process-authority-broker
rasen Linux authority broker failed closed: usage: rasen-linux-process-authority-broker <probe|serve|clean-uninstall-state>
exit=69
```

The fourth line is the closed-argv check: the binary accepts exactly three operations and no fault
selector. Unprivileged attempts to create install or lease state:

```text
mkdir: cannot create directory '/usr/libexec/rasen': Permission denied
mkdir: cannot create directory '/etc/rasen': Permission denied
mkdir: cannot create directory '/var/lib/rasen': Permission denied
mkdir: cannot create directory '/run/rasen': Permission denied
mkdir: cannot create directory '/usr/lib/systemd/system/rasen-test.service': Permission denied
mkdir: cannot create directory '/sys/fs/cgroup/rasen-linux-process-authority': Read-only file system
mkdir: cannot create directory '/sys/fs/cgroup/unified/rasen-unpriv-probe': Permission denied
```

Same binary as root, with no installation present — refuses rather than self-installing:

```text
$ rasen-linux-process-authority-broker probe
rasen Linux authority broker failed closed: No such file or directory (os error 2)
exit=69

$ rasen-linux-process-authority-broker clean-uninstall-state
rasen Linux authority broker failed closed: No such file or directory (os error 2)
exit=69

install roots present on this host?
  /usr/libexec/rasen                                                     absent
  /etc/rasen                                                             absent
  /var/lib/rasen                                                         absent
  /run/rasen                                                             absent
  /usr/lib/systemd/system/rasen-linux-process-authority-broker.service   absent
```

**No installation was performed.** Therefore 9.2's root-ownership, mode, key-identity and service
peer-credential verifications are **NOT RUN**, and 9.2 stays PARTIAL. Installing would have required
creating `/usr/libexec/rasen`, `/etc/rasen`, `/var/lib/rasen`, `/run/rasen`, a systemd unit file, and
a dedicated system group (`InstalledBroker::load` refuses `service_gid == 0`) on the operator's daily
machine, to buy a partial receipt for a gate that cannot complete. That trade was refused.

Note also that the briefing's `/opt/rasen-broker-gate/` install-prefix rule is **not satisfiable**:
`BrokerInstallLayout::validate` (`broker_install.rs:253-258`) hard-requires `state_directory` under
`/var/lib/rasen`, `socket` under `/run/rasen`, and `cgroup_subtree` under `/sys/fs/cgroup`.

## Part C — gate harness against the real kernel

The harness lives outside the repository at
`/home/sayo/.local/share/rasen-build/lead2-track-c/gate-harness/` and links the production crate by
path. It drives the production `FsCgroupKernel` and `BrokerCgroupAuthority` against the running
kernel. It is a disposable gate driver, not a shipped test, and it is not an injected fixture.

Run as root, `timeout --signal=KILL 180`, exit 0.

### A — the source-owned install layout against this host

```text
STEP A0 | BrokerInstallLayout::system_default().validate() | Ok(())
     binary               = /usr/libexec/rasen/rasen-linux-process-authority-broker
     public_key_manifest  = /etc/rasen/linux-process-authority/broker-public-key.manifest
     private_key          = /var/lib/rasen/linux-process-authority/broker.key
     state_directory      = /var/lib/rasen/linux-process-authority/leases
     socket               = /run/rasen/linux-process-authority/broker.sock
     service_unit         = /usr/lib/systemd/system/rasen-linux-process-authority-broker.service
     cgroup_subtree       = /sys/fs/cgroup/rasen-linux-process-authority
STEP A1 | FsCgroupKernel::new("/sys/fs/cgroup", layout.cgroup_subtree) | Ok
STEP A2 | ensure_service_subtree() on the hardcoded layout | Err(kind=Unsupported errno=None "cgroup mount is not unified cgroup v2")
STEP A3 | BrokerCgroupAuthority::probe() on the hardcoded layout | Err(kind=Unsupported errno=None "cgroup mount is not unified cgroup v2")
```

A2/A3 are the daemon's exact construction (`bin/rasen-linux-process-authority-broker.rs:275-279`).
The installed broker cannot start on this host.

### B — real cgroup-v2 mount, dedicated gate subtree

```text
STEP B0 | probe_namespace_operations() | Ok(())
STEP B1 | ensure_service_subtree() on the dedicated gate subtree | Ok(())
STEP B1b | gate subtree | exists uid=0 gid=0 mode=755 dev=21 ino=7429
STEP B2 | gate subtree cgroup.controllers | []
STEP B3 | BrokerCgroupAuthority::probe() with broker_default() = ["pids"] | Err(kind=Unsupported errno=None "required cgroup v2 controller is unavailable")
STEP B4 | CgroupRequirements{required_controllers: []}.validate()  (can the demand be waived?) | Err(kind=InvalidInput errno=None "cgroup controller requirements are malformed")
STEP B5 | BrokerCgroupAuthority::create_leaf() (production entry; probe-gated) | Err(kind=Unsupported errno=None "required cgroup v2 controller is unavailable")
```

B4 is the decisive one: the controller demand **cannot be waived by configuration**, because an empty
requirement list is rejected as malformed. The broker structurally requires at least one cgroup-v2
resource controller. This host has zero.

Fail-closed behaviour is confirmed correct: B5 shows the production entry point refusing **before**
any leaf is created and therefore before any workload activation.

### C — kernel-facing layer with real processes

Part C deliberately bypasses the production availability gate that correctly refused this host at
B3/B5, in order to exercise the kernel-facing code that the gate would have exercised. **It proves
the kernel-facing layer only. It is not the Section 9 installed-broker gate and must not be read as
closing any Section 9 task.**

```text
STEP C1 | create_unique_leaf() | Ok(CgroupLeafIdentity { device: 21, inode: 7442 })
STEP C1b | leaf directory | .../rasen-broker-gate.slice/lease-9a112c3d4e5f60718293a4b5c6d7e8f9 -> exists uid=0 gid=0 mode=755 dev=21 ino=7442
STEP C2 | workload pid (double-forked, setsid, setpgid, uid 1000) | 16841  sid/pgid: sid=16840 pgid=16841 PPid:	16833 (harness pid=16838)
STEP C2b | unrelated uid-1000 control process pid | 16842
STEP C3 | place_guardian(leaf, workload) | Err(kind=InvalidInput errno=Some(22) "Invalid argument (os error 22)")
STEP C4 | populated(leaf) after placement | Ok(true)
STEP C5 | workload /proc/<pid>/cgroup | 0::/rasen-broker-gate.slice/lease-9a112c3d4e5f60718293a4b5c6d7e8f9
STEP C5b | unrelated /proc/<pid>/cgroup | 0::/init.scope
```

C3 above is the **pre-fix** run, kept because it is how the Blocker was discovered. After the D1 fix
the same step on the same host returns:

```text
STEP C3 | place_guardian(leaf, workload) | Ok(())
STEP C4 | populated(leaf) after placement | Ok(true)
STEP C5 | workload /proc/<pid>/cgroup | 0::/rasen-broker-gate.slice/lease-9a112c3d4e5f60718293a4b5c6d7e8f9
STEP C5b | unrelated /proc/<pid>/cgroup | 0::/init.scope
```

C2 confirms the topology by kernel fact, not sampling: the workload has its own session
(`sid=16840` differs from the harness), its own process group (`pgid=16841`), and `PPid: 16833` — it
was reparented away from the harness (`pid=16838`) by the double fork. C5 versus C5b shows exact
membership: the workload is in the leaf, the unrelated process is not.

C3 is a production defect, isolated in Part E — see Blocker D1.

The non-migratability property, from uid 1000 inside the exact root-owned leaf:

```text
STEP C6 | workload escape attempts as uid 1000 from inside the exact leaf |
       E1 migrate self to the cgroup-v2 root -> refused: PermissionDenied errno=Some(13)
       E2 migrate self within the leaf -> refused: PermissionDenied errno=Some(13)
       E3 migrate self to the gate subtree -> refused: PermissionDenied errno=Some(13)
       E4 kill the exact leaf -> refused: PermissionDenied errno=Some(13)
       E5 create a child cgroup in the leaf -> refused: PermissionDenied errno=Some(13)
```

### Mutation / RED proofs

Each oracle below was mutated so that a broken implementation would be caught.

```text
STEP M1 | cleanup_leaf() while populated (must refuse) | Err(kind=WouldBlock errno=None "populated cgroup leaf cannot be removed")
STEP M2 | populated() with a drifted inode (must not answer) | Err(kind=PermissionDenied errno=None "identity-drift")
STEP M3 | recursive_kill() with a drifted inode (must not kill) | Err(kind=PermissionDenied errno=None "identity-drift")
STEP M3b | workload alive after the drifted kill | kill(16841,0)=0 errno=None /proc/16841=present
STEP M4 | place_guardian_exact(leaf, 0) via production authority | Err(kind=InvalidInput errno=None "broker guardian pid is zero")
STEP M5 | reopen_leaf() with a drifted inode | Err(kind=PermissionDenied errno=None "identity-drift")
```

M3 + M3b together are the meaningful pair: a destructive control aimed at a drifted identity is
refused **and** the real process is still alive afterwards. A `recursive_kill` that silently targeted
the path instead of the pinned identity would have killed the workload and M3b would have gone red.

### Termination

```text
STEP T1 | recursive_kill(leaf) | Ok(())
STEP T2 | populated=0 convergence via cgroup.events poll (no sleeps) | Ok(false) after 1 poll rounds
STEP T3 | workload after cgroup.kill | kill(16841,0)=-1 errno=Some(3) /proc/16841=absent
STEP T4 | unrelated control process after cgroup.kill | kill(16842,0)=0 errno=None /proc/16842=present
STEP T5 | repeated recursive_kill(leaf) on the empty leaf (idempotent) | Ok(())
STEP T6 | cleanup_leaf(leaf) after exact empty | Ok(())
STEP T7 | leaf directory after cleanup | absent (NotFound)
STEP T8 | reopen_leaf(leaf) after cleanup (binding released) | Err(kind=PermissionDenied errno=None "identity-drift")
STEP T9 | harness reaped its own unrelated control process | waitpid status=9, kill(16842,0)=-1 errno=Some(3) /proc/16842=absent
```

Convergence used the production `wait_for_populated_change` oracle, which polls `POLLPRI` on
`cgroup.events`. No sleeps and no PID-tree sampling were used anywhere in this harness. T3 versus T4
is the survival pair: the leaf member died, the unrelated process did not.

These receipts cover the *cgroup mechanics* of tasks 9.3 and 9.6 at the kernel layer. They do **not**
close those tasks, which require the same behaviour through an installed, authenticated broker
holding a durable lease and a namespace guardian.

### E — `place_guardian` defect isolation

Pre-fix:

```text
STEP E1 | production place_guardian() -- writeln!(procs, "{pid}") | Err(kind=InvalidInput errno=Some(22) "Invalid argument (os error 22)")
STEP E1b | but /proc/<pid>/cgroup says | 0::/rasen-broker-gate.slice/lease-b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0
STEP E1c | and populated(leaf B) | Ok(true)
STEP E2 | same migration as ONE write(2): write_all(b"<pid>\n") | Ok(())
STEP E2b | /proc/<pid>/cgroup | 0::/rasen-broker-gate.slice/lease-c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0
STEP E2c | populated(leaf C) | Ok(true)
STEP E3 | the second fragment on its own: write_all(b"\n") to cgroup.procs | Err(kind=InvalidInput errno=Some(22) "Invalid argument (os error 22)")
STEP E4 | writeln!(file, "{pid}") on an already-member pid (the form that shipped) | Err(kind=InvalidInput errno=Some(22) "Invalid argument (os error 22)")
STEP E5b | teardown leaf B | Ok(()) reaped=9 kill(16844,0)=-1 errno=Some(3) /proc/16844=absent
STEP E5c | teardown leaf C | Ok(()) reaped=9 kill(16845,0)=-1 errno=Some(3) /proc/16845=absent
```

E2 versus E4 is the RED/GREEN pair: identical intent, identical target file, identical payload — the
single-`write(2)` form succeeds and the form that shipped fails.

Post-fix, same host, same harness:

```text
STEP E1 | production place_guardian() (now write_control_command, one write) | Ok(())
STEP E1b | /proc/<pid>/cgroup | 0::/rasen-broker-gate.slice/lease-b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0
STEP E1c | populated(leaf B) | Ok(true)
STEP E2 | same migration as ONE write(2): write_all(b"<pid>\n") | Ok(())
STEP E3 | the second fragment on its own: write_all(b"\n") to cgroup.procs | Err(kind=InvalidInput errno=Some(22) "Invalid argument (os error 22)")
STEP E4 | writeln!(file, "{pid}") on an already-member pid (the form that shipped) | Err(kind=InvalidInput errno=Some(22) "Invalid argument (os error 22)")
```

#### The proof structure — read this as one argument, not three result lines

A bare "it passes now" cannot distinguish a real fix from three rival explanations: that the kernel
behaved differently on the second run, that the harness drifted, or that the leaf was somehow
already in the desired state. This run rules all three out, because the same binary, in the same
process, against the same kernel, holds **one control and one variable** side by side:

| Step | What it exercises | Pre-fix | Post-fix | Reads as |
| --- | --- | --- | --- | --- |
| E1 | production `place_guardian` | `Err(EINVAL)` | **`Ok(())`** | the variable — this is what changed |
| E3 | harness's own bare `"\n"` write | `Err(EINVAL)` | `Err(EINVAL)` | control — kernel still rejects a fragment |
| E4 | harness's own `writeln!` write | `Err(EINVAL)` | `Err(EINVAL)` | control — the shipped form still fails |

E3 and E4 are red **by design and must stay red**. They are the harness's own direct reproductions of
the fragmented write, not production code. Had the kernel changed, or the harness drifted, or the
environment shifted, E3/E4 would have moved with E1. They did not. The only thing that moved is the
production call path, which is the thing that was changed.

If E3 or E4 ever goes green on a future runner, the harness has stopped reproducing the defect and
E1's green means nothing until that is explained.

## Defects for the review wave

### D1 — Blocker: `place_guardian` could never succeed against a real cgroup filesystem — FIXED, filed as `F-L2-10`

`native/linux-process-authority/src/broker_cgroup.rs:662` was:

```rust
writeln!(procs, "{guardian_pid}")?;
```

`Write::write_fmt` on an unbuffered `std::fs::File` emits the formatted argument and the trailing
newline as two separate `write(2)` calls. `cgroup.procs` parses each write independently: the first
migrated the process, the second — a bare `"\n"` — was parsed as an empty pid and rejected `EINVAL`.
The function therefore **reported failure after having already performed the migration**.

Blast radius: `place_guardian` → `BrokerCgroupAuthority::place_guardian_exact` → `prepare_leaf`. The
broker could not prepare a lease on any real kernel. The failure path additionally ran
`cleanup_partial_exact_leaf` against a leaf that was by then populated.

The same defect class existed at `broker_cgroup.rs:541`, `writeln!(control, "+{required}")` against
`cgroup.subtree_control`. Those two were the only `writeln!`/`write!` sites in `src/`.

**Resolution — reported to the LEAD before any freeze marker was cut, and fixed on the LEAD's
explicit authorisation** (freezing a broker whose prepare path cannot work on any real kernel would
have baked the defect into the frozen digest and every receipt bound to it). Both sites now route
through one helper:

```rust
/// Writes one cgroup control command as exactly one `write(2)`.
fn write_control_command(file: &mut File, command: &str) -> io::Result<()> {
    file.write_all(format!("{command}\n").as_bytes())
}
```

Nothing else in either function changed. `src/` now contains no `writeln!`/`write!` outside the new
regression test's deliberate reproductions.

**Regression guard** — `broker_cgroup::linux::tests::a_control_command_reaches_the_kernel_as_exactly_one_write`,
added to the module's existing inline `#[cfg(test)] mod tests`. It is unprivileged, hermetic and
deterministic: a regular file cannot witness the defect, because one write and two writes leave
identical bytes behind, so the test writes through an **`O_DIRECT` packet-mode pipe**, where each
`write(2)` becomes one packet and each `read(2)` returns exactly one packet. It asserts the
production helper produces one packet, and — so the oracle is provably able to see the defect — that
the two forms that shipped produce two and three packets respectively.

Mutation proof that the guard is not a test that cannot fail: `write_control_command` was reverted
to `writeln!(file, "{command}")`, the test was rerun, and it failed with

```text
assertion `left == right` failed
  left: [[52, 50, 52, 50], [10]]     <- "4242", "\n"  : two writes
 right: [[52, 50, 52, 50, 10]]       <- "4242\n"      : one write
```

The mutation was then reverted and `src/broker_cgroup.rs` confirmed byte-identical to its pre-mutation
state (`sha256 ed4a9e0b76460063b28e4e6396bc9faa40acc1aa15a01ae4dc2fbe91a3f6ba08`).

Writing that guard also caught an error in Track C's own first reproduction: the initial assertion
used `writeln!(file, "4242")`, a bare literal with no format argument, which `write_fmt` emits as a
**single** write and which therefore does not reproduce the defect at all. Only the argument-carrying
form does. The test failed, and that failure is why the distinction is now stated explicitly in the
test's own comment.

End-to-end confirmation on the real kernel is in Part C/E above: `place_guardian` moved from
`Err(EINVAL)` to `Ok(())` while the harness's direct fragmented-write reproductions stayed `Err`.

### D2 — Major: the design says controllers are unnecessary; the code requires one — filed as `F-L2-06`

`design.md:134-136` describes the broker as using only `cgroup.procs`, `cgroup.kill`,
`cgroup.events`, leaf inode identity and root ownership. `broker_cgroup.rs:16-19` sets
`broker_default()` to `required_controllers: vec!["pids"]`, the installed daemon uses exactly that
(`bin/rasen-linux-process-authority-broker.rs:293`), and `FsCgroupKernel::probe`
(`broker_cgroup.rs:523-531`) fails closed if it is absent. `CgroupRequirements::validate` rejects an
empty list, so the demand cannot be configured away.

Either the design understates the requirement or the code overstates it. Whichever is authoritative,
`design.md:15`'s account of the WSL deficiency and the earlier availability determination both need
correcting, and any future Section 9 runner must supply cgroup-v2 `pids`.

Deliberately left unresolved by Track C: resolving it by editing `broker_default()` so that a gate
passes would be exactly backwards. Recorded by the LEAD as `F-L2-06` and routed to the review wave as
a product decision.

### D3 — Major: the real cgroup implementation has no test coverage at all — filed as `F-L2-09`

```text
$ grep -rn "FsCgroupKernel" native/linux-process-authority/tests/
(no matches)
```

Every broker cgroup test drives `FixtureKernel` in
`tests/linux_broker_cgroup_contract.rs`, whose `place_guardian` records the pid into a `Mutex` and
whose `probe()` asserts only `required_controllers == ["pids"]` before returning `Ok(())`. The
~580-line `broker_cgroup::linux` module — the only code that ever touches a real cgroup — is
exercised by nothing. D1 and D2 were both invisible for this reason. This is the "test that cannot
fail" failure mode at module scale.

**Demonstrated, not merely argued.** `linux_broker_cgroup_contract` reports `9 passed; 0 failed`
**both before and after** the D1 fix. The suite was run in both states. A suite that is equally green
against a broker whose prepare path cannot work on any real kernel, and against one where it can, is
not measuring the thing its name claims. This also means **the cgroup suite must not be cited as
evidence for D1** in any freeze or closure record — it cannot see D1. What validates D1 is the new
lib guard plus the real-kernel proof structure in Part C/E.

D1's regression guard narrows this by one function; it does **not** close D3. The module's leaf
creation, guardian placement against a real `cgroup.procs`, `cgroup.kill`, `cgroup.events` polling
and identity pinning still have no automated coverage, because none of it is constructible
unprivileged. The review wave should treat "which production types are exercised only by fixtures" as
a first-class audit question on this change. A TypeScript sibling of this pattern on the primary path
is recorded separately as `F-L2-11`.

### D4 — Minor: the briefed install prefix is unsatisfiable

`BrokerInstallLayout::validate` (`broker_install.rs:253-258`) hard-requires `/var/lib/rasen`,
`/run/rasen` and `/sys/fs/cgroup` prefixes, so a gate cannot be installed under a neutral dedicated
prefix such as `/opt/rasen-broker-gate/`. Any future dedicated runner must accept the real system
paths, which is another reason the runner must not be a daily machine.

### D5 — Minor: the broker service tests build Unix socket paths without bounding them to `SUN_LEN`

`cargo test` initially reported two failures in `linux_broker_service_contract`:

```text
shipping_daemon_observes_client_hup_and_prevents_late_prepare_mutation
  -> Err { kind: InvalidInput, message: "path must be shorter than SUN_LEN" }   (tests/...:2061)
client_and_daemon_process_loss_recover_and_ack_one_prepared_delivery
  -> Err { kind: TimedOut, "process fixture marker did not arrive: .../daemon-ready" }   (tests/...:1868)
```

Neither is a code regression. Both are caused by `TMPDIR` being long: the fixtures compose a socket
path under `TMPDIR` and exceed the 108-byte `sockaddr_un` limit, and the second failure is the first
one's downstream effect (the daemon could not bind, so its readiness marker never appeared). With
`TMPDIR=/tmp/rasen-c` the whole suite is green. Worth a bounded-path assertion so the failure names
its own cause instead of surfacing as a timeout.

The reason this is worth carrying rather than shrugging off: the *visible* symptom is a timeout in a
test that is not the broken one. That is the shape of a defect that gets closed as flake. The LEAD is
carrying it and has warned Track B in case it surfaces during 7.2.

### D6 — Process finding: on this codebase, an unmutated guard test should be assumed non-discriminating

Two independent instances in a single implementation wave:

1. **Track C, this run.** The first draft of the D1 regression guard asserted that
   `writeln!(file, "4242")` produces two packets. It produces one: a bare literal carries no format
   argument, so `write_fmt` emits a single write. The assertion was testing a form that does not
   reproduce the defect it was written to catch. It surfaced only because the guard was run against
   the mutated implementation.
2. **Track A, same evening.** The same experience with their P3 guard (recorded on their side).

Neither guard was written carelessly, and both authors believed they were correct. What caught both
was mutation, not review and not intent.

This sits directly on top of `F-L2-09`. That finding says a production type here was covered only by
a stand-in that could not fail; this one says the *guards written to fix such gaps* are themselves
prone to being non-discriminating on first draft. The corollary for the review wave: **a guard test
on this change that has not been shown to go red against the defect it names should be treated as
unverified, regardless of how specific its assertion looks.**

Concretely for D1's guard, the discriminating power is asserted inside the test itself — it pins that
the shipped forms produce `["4242", "\n"]` and `["+", "pids", "\n"]`, and its comment states
explicitly that the bare-literal form does **not** reproduce the defect. That note is load-bearing:
without it, anyone "simplifying" the assertion to a literal would silently convert the guard into
another cell that cannot fail.

## Part G — verification after the D1 fix

```text
cargo fmt --check                                        exit 0
cargo test --locked --target x86_64-unknown-linux-gnu    129 passed, 0 failed, 1 ignored
```

Per-target: lib 10, `src/main.rs` 1, broker bin 0, broker-client bin 0, `authority_contract` 4,
`lifecycle_contract` 6, `linux_broker_admin_contract` 7, `linux_broker_cgroup_contract` 9,
`linux_broker_install_contract` 4, `linux_broker_lease_contract` 13, `linux_broker_peer_contract` 1,
`linux_broker_protocol_contract` 6, `linux_broker_service_contract` 21 (+1 pre-existing ignored),
`linux_identity_contract` 3, `linux_journal_contract` 2, `linux_primary_contract` 29,
`linux_primary_topology_contract` 5, `linux_runtime_contract` 3, `protocol_contract` 5.

The one ignored test is pre-existing and was not introduced or altered by this fix.
`linux_primary_contract`'s 29 is subject to the accounting caveat in `F-L2-07`: it is 21 asserting
tests plus 8 gated fixture entrypoints, not 29 assertions.

## Part F — cleanup verification

Removals performed by the harness itself, then verified by an independent post-run sweep as root:

```text
STEP T6 | cleanup_leaf(leaf) after exact empty | Ok(())
STEP T7 | leaf directory after cleanup | absent (NotFound)
STEP D1 | rmdir the dedicated gate subtree | Ok(())
STEP D2 | gate subtree after cleanup | absent (NotFound)

== post-run sweep ==
ls -d /sys/fs/cgroup/unified/rasen-broker-gate.slice
  -> No such file or directory
ps -eo pid,uid,args | grep rasen-broker-gate-harness
  -> no surviving harness processes
```

An earlier harness run hung on a pipe-EOF bug in the harness itself. Its three processes
(harness, workload, control child) and its cgroups were identified individually, matched against
`/proc/<pid>/cmdline` before signalling, killed, and verified gone; both cgroups were removed and
verified absent. No process outside that set was signalled.

State of the machine after all work:

```text
/usr/libexec/rasen                                                     absent
/etc/rasen                                                             absent
/var/lib/rasen                                                         absent
/run/rasen                                                             absent
/usr/lib/systemd/system/rasen-linux-process-authority-broker.service   absent
/sys/fs/cgroup/rasen-linux-process-authority                           absent (never creatable; ro tmpfs)
/sys/fs/cgroup/unified/rasen-broker-gate.slice                         absent
```

No package installed. No `/etc/wsl.conf` change. No systemd unit created, modified, or enabled. No
system group added. No cgroup hierarchy mounted, unmounted, or reconfigured. No file under
`/home/sayo` modified except inside the dedicated build prefix
`/home/sayo/.local/share/rasen-build/lead2-track-c/` and the short test scratch dir `/tmp/rasen-c`,
both of which are inert and deletable.

Repository files modified by Track C, in full:

```text
native/linux-process-authority/src/broker_cgroup.rs   the D1 fix (2 call sites + 1 helper)
                                                      plus its inline regression test
rasen/changes/.../evidence/section-9-broker-gate-run-lead2.md   this file
```

Nothing else. In particular Track C did not touch `tasks.md`, `.rasen/**`,
`test/core/session-host/**`, `test/fixtures/linux-process-authority-wsl-controller.mjs`, `dist/**`,
or `tests/linux_primary_contract.rs` (Track A's surface — the regression test was added to
`src/broker_cgroup.rs`'s own inline test module rather than to any file owned by another track). The
git index was left as found; the only staging operation was a `git add -N` on this evidence file to
run `git diff --check`, immediately reset.

## 9.7 — independent security review is OUTSTANDING

Task 9.7 requires an independent security review alongside the gate summary. **It has not been
performed and it is not written here.** The author of this run must not be its verifier. The LEAD
commissions it separately.

Independently of that review, 9.7 cannot be satisfied while 9.1 and 9.3-9.6 are unrun. The broker
provider and this Change must not be marked terminal.
