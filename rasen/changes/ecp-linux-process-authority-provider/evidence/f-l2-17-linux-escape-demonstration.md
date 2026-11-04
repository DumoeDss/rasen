# F-L2-17 — Linux `workload-non-escape` escape, demonstrated on the real kernel

Date: 2026-08-07

## Verdict

**DEMONSTRATED. Unprivileged.** A workload confined inside an authority-shaped user + PID + mount
namespace caused a process to be created **outside** that authority — outside its PID namespace,
outside its cgroup scope, parented to a host service — by asking the host `systemd --user` manager to
spawn it over the session bus. The spawned process is invisible to the authority's emptiness oracle
and survives the authority's complete teardown. No root, no privilege escalation, no package install,
no configuration change.

This confirms `F-L2-17` on Linux with a kernel-fact receipt, matching the demonstration the Windows
sibling change carries. The `workload-non-escape` semantic in the frozen common contract is not
achieved against a reachable out-of-scope spawning service.

## Boundary

Scratch experiment, entirely outside the repository, on WSL ext4. It edits nothing under
`native/linux-process-authority/**`; `primary.rs` was read, never written. The frozen source digest
is unchanged: `087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59` (26 files), verified
after the experiment. This receipt establishes only the escape fact; it closes no task and reranks
no finding. `F-L2-17` is a Direction-level, cross-platform, contract-level question for the operator.

## Environment

```text
uname -a     Linux Sayo 5.15.167.4-microsoft-standard-WSL2 #1 SMP Tue Nov 5 00:21:55 UTC 2024 x86_64
distro       Ubuntu 24.04.1 LTS  (WSL2)
identity     uid=1000(sayo), unprivileged throughout; no sudo, no `wsl -u root`
session bus  /run/user/1000/bus   (srw-rw-rw-, systemd --user running)
tools        util-linux unshare 2.39.3; gdbus (GLib GDBus); python3
```

## Fidelity — the reproduction namespace matches the real authority

The real authority builds its namespace at `primary.rs:603`
(`CLONE_NEWUSER | CLONE_NEWPID | CLONE_NEWNS | SIGCHLD`) and configures the mount namespace in
`configure_child_namespace()` (`primary.rs:2072-2101`) with exactly two operations:

```text
mount("/",  MS_REC | MS_PRIVATE)                          -- private propagation
mount("proc", "/proc", MS_NOSUID | MS_NOEXEC | MS_NODEV)  -- proc for the new pidns
```

It does **not** `pivot_root`, does **not** unmount or hide `/run`, `/run/user/1000`, or the session
bus socket, and does **not** construct a minimal mount tree. So `/run/user/1000/bus` remains reachable
from inside the real workload exactly as in the reproduction.

The reproduction namespace is therefore faithful, not looser:

```text
unshare --user --map-current-user --pid --fork --mount-proc --propagation private
        |________________________|  |____|  |____|  |__________|  |___________________|
         CLONE_NEWUSER + 0->1000     NEWPID   fork    NEWNS+proc    MS_REC|MS_PRIVATE on /
```

`--map-current-user` maps inner uid 0..1 to outer 1000, i.e. the workload runs as the same
unprivileged uid the real authority maps. The escape does not depend on the mapping shape.

## The vector

`systemd --user` (the per-user service manager, PID owned outside the namespace) exposes
`org.freedesktop.systemd1.Manager.StartTransientUnit` on the session bus at the well-known path
`$XDG_RUNTIME_DIR/bus` = `/run/user/<uid>/bus`. A process that can reach that socket can ask the
manager to fork/exec an arbitrary program. The manager runs the program in **its own** cgroup and PID
namespace, not the caller's.

### `sd-bus` is not the boundary — a false lead ruled out

`systemd-run --user` and `busctl` (both sd-bus clients) fail from inside the PID namespace with
`Failed to connect to bus: No data available`, and succeed from a user-namespace-only shell. That
could be mistaken for a kernel protection. It is not:

- A raw `AF_UNIX` connect to the bus socket from inside the full namespace succeeds
  (kernel permits it).
- A hand-rolled D-Bus `EXTERNAL` auth from inside the full namespace returns `OK <guid>`
  (the daemon accepts the peer credentials across the namespace boundary).
- A hand-rolled D-Bus `Hello` from inside the full namespace returns a unique name
  (`HELLO: OK -- D-Bus session fully open from inside the namespace`).

So the D-Bus channel is fully open through the PID namespace; the sd-bus failure is a client-library
artifact under PID namespaces, not a security property. Using GDBus (`gdbus`, a different D-Bus
implementation) the escape completes cleanly. Reporting "blocked" on the sd-bus symptom would have
been wrong.

## The demonstration — kernel facts, read not inferred

Guardian = PID 1 of the authority namespace. From inside it, the workload issued one `gdbus`
`StartTransientUnit`. Captured facts:

```text
HOST_pidns             pid:[4026532287]
authority_inner_pidns  pid:[4026532340]     (distinct new pidns)
inner_uid              1000                  (unprivileged)
gdbus_exit             0                     (job created: /org/freedesktop/systemd1/job/113)

escapee_host_pid       38846
escapee_pidns          pid:[4026532287]      == HOST pidns, != authority pidns
escapee_userns         user:[4026531837]     == host initial userns
escapee_ppid           376  (comm = systemd) == the host user manager, not the guardian
escapee_cgroup         .../user@1000.service/app.slice/rasen-escape-capture.service
```

Three independent kernel facts each place the spawned process **outside** the authority:

1. **PID namespace.** `readlink /proc/38846/ns/pid` = `pid:[4026532287]` (host), not the authority's
   `pid:[4026532340]`. `VERDICT_ns=DIFFERENT`.
2. **cgroup scope.** The process lives in the host user manager's tree
   `/user.slice/user-1000.slice/user@1000.service/app.slice/rasen-escape-capture.service`, not in any
   scope the authority created or controls.
3. **Parentage.** `PPid = 376`, whose `comm` is `systemd` — the host `--user` manager — not the
   guardian.

### The authority cannot see it, and would report empty while it lives

The guardian's PID-namespace roster (its `proc` mount, the basis for the `ECHILD`-based
"exact-scope-empty" oracle in task 5.5) contains only itself:

```text
--- processes visible inside the authority pidns ---
innerpid=1 comm=inner_guardian.
```

The escapee does not appear. The authority's emptiness proof is "root exited **plus** `ECHILD` proves
no workload process remains" — but `ECHILD` is evaluated in the guardian's PID namespace, where the
escapee was never a child. **The authority would emit `exact-scope-empty` while the escaped process
is still running.** That is the consequence that matters: not merely an un-reaped process, but a
truthful-looking terminal state that is false.

### It survives the authority's complete teardown

Killing guardian PID 1 tears the whole authority namespace down. The escapee is unaffected:

```text
AFTER_TEARDOWN: escapee pid 38846 STILL ALIVE -> authority teardown did not reap it
AFTER_TEARDOWN_cgroup=.../user@1000.service/app.slice/rasen-escape-capture.service
```

The authority's recursive kill (`pidfd_send_signal` on the guardian, `cgroup.kill` on its own scope)
targets only what it owns. The user manager's cgroup is not its scope, so nothing it does reaches the
escapee.

## Robustness — not an environment leak

To rule out "the escape only worked because the harness leaked `DBUS_SESSION_BUS_ADDRESS`", the
workload was re-run under `env -i PATH=/usr/bin:/bin` and reconstructed the bus address itself from
its own uid (`/run/user/$(id -u)/bus`, a well-known path):

```text
cleared-env? PATH=/usr/bin:/bin  (reconstructed bus=unix:path=/run/user/1000/bus)
inner_pidns=pid:[4026532340] uid=1000
(objectpath '/org/freedesktop/systemd1/job/132',)   gdbus_exit=0
escapee MainPID 38892, ActiveState active,
  cgroup .../user@1000.service/app.slice/rasen-escape-noenv.service
```

An adversarial workload needs nothing from its environment; the socket path is fixed by the uid.

## What would make this conclusion wrong (falsifiers, each checked)

- **escapee in the authority pidns** — would mean containment, not escape. Checked: host pidns, not
  `4026532340`. Fails the falsifier: it is an escape.
- **escapee in the authority's cgroup scope** — would mean containment. Checked: user manager's tree.
- **required root** — would be a much weaker finding. Checked: uid 1000 throughout, no privilege.
- **died on authority teardown** — would mean transitive containment. Checked: survived.
- **only worked via leaked env** — checked: works under `env -i` with a reconstructed path.
- **reproduction namespace looser than the real authority** — checked against `primary.rs:603` and
  `primary.rs:2072-2101`: the real authority uses the identical namespace set and does not hide the
  bus socket.

If any single one of these had gone the other way, the correct report would have been "not
demonstrated" or "blocked". They did not.

## Scope of the mitigation, and why the finding is contract-level not vector-level

This specific `systemd --user` instance depends on a reachable session bus. It would close if the
authority ran the workload in a mount namespace that hides `/run/user/<uid>` (e.g. a `pivot_root` to a
minimal root), or as a uid with no running user manager. The authority does neither today, so the
`systemd` vector is live — but even a full mount-hiding fix would not close `F-L2-17`, because the
gap is any **reachable out-of-scope spawner**, of which `systemd --user` is one instance. The system
bus, any socket-activated launcher, an `at`/`cron`-like daemon, or any service reachable by abstract
or pathname socket that execs on request presents the same shape. The frozen contract lists
`workload-non-escape` as an indivisible semantic without defining it against a spawning service on
either platform; that definitional gap is the finding. It is a Direction-level decision, not an
implementer's call.

## Cleanup

All transient units stopped and `reset-failed`; no stray probe `sleep` processes remain; scratch
lives only under `/home/sayo/.local/share/rasen-build/lead2-f-l2-17/` on ext4. Frozen tree untouched.
