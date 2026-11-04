# Direction replan input — move the Linux authenticated broker / cgroup-v2 path to 0.3.0

Prepared by: LEAD #2, 2026-08-07
Status: **input for a Direction decision, not a Direction decision.** Nothing here is authorised until
Direction records it. No run-state was changed on the strength of this document.

Operator decision being staged: **the authenticated installed-broker plus non-migratable cgroup-v2
path moves out of 0.2.0 and becomes a 0.3.0 research/delivery item. Linux 0.2.0 delivers the primary
user+PID-namespace provider only.**

This follows the same shape as Architecture Replan 4's macOS handover: remove a sub-scope whose
blocking cost is infrastructure rather than design, cut exactly one edge, and relax no gate that
remains in scope.

## 1. Why this is separable — it was designed to be

The broker was never an implicit degradation of the primary path. From this Change's own
`proposal.md:11`:

> Add a separately selected, explicitly installed and authenticated privileged-broker path for
> environments whose policy disables unprivileged namespaces. **Its authority is additionally bound to
> a broker-issued token and a non-migratable cgroup-v2 leaf; it is never an implicit fallback from the
> primary provider.**

The separation is already structural, not aspirational:

- **Two distinct provider tuples exist and are already emitted.** The generated build-authority table
  pins `rasen.linux.user-pidns` and `rasen.linux.broker-pidns-cgroupv2` as separate identities with
  separate artifacts (`rasen-linux-process-authority-helper` and
  `rasen-linux-process-authority-broker-client`).
- **The common contract already has the right outcome for "neither authority exists"**: typed
  `authority-unavailable`, delivered by the archived
  `process-authority-prepare-unavailability-outcome` Change.
- **The broker is selected, never fallen back into.** Removing it therefore changes what is
  *available*, not how anything *degrades*.

## 2. What is blocking, and why it is infrastructure rather than design

Section 9 (tasks 9.1-9.7) requires an actual installed broker on a runner with a unified cgroup-v2
hierarchy and root authority. Determined and recorded in
`evidence/section-9-broker-cgroup-gate-availability-lead2.md`:

- `broker_default()` hard-requires the `pids` cgroup-v2 controller
  (`native/linux-process-authority/src/broker_cgroup.rs:16-20`). This host binds `pids` to cgroup-v1
  hierarchy 12 with 51 live cgroups, and controller-to-hierarchy binding is global.
- `CgroupRequirements { required_controllers: [] }` is **rejected as malformed**, so the requirement
  cannot be waived by configuration. The gate is unreachable here **by construction, not by policy**.
- `BrokerInstallLayout::system_default()` hardcodes `/sys/fs/cgroup/rasen-linux-process-authority`
  and `validate()` forces the `/var/lib/rasen`, `/run/rasen` and `/sys/fs/cgroup` prefixes; on this
  host `/sys/fs/cgroup` is a read-only tmpfs, not cgroup2fs.
- The repository's **own** CI already encodes the required environment: the
  `broker-privileged-manual` job in `.github/workflows/linux-process-authority.yml` demands a
  `[self-hosted, linux, x64, rasen-cgroup-v2-broker]` runner, a protected environment, passwordless
  sudo, root-level `cgroup.controllers`/`cgroup.kill`/`cgroup.events`, and a **pre-installed** broker
  with a live socket. Decisively, that job's own final step preserves Section 9 as open — so even the
  designed CI path does not close it.
- On this machine the only lever that would surface cgroup-v2 controllers is
  `.wslconfig`'s `kernelCommandLine=systemd.unified_cgroup_hierarchy=1`, which is **global to the WSL2
  VM** and would change the operator's daily distribution's cgroup layout. A second distro does not
  help, because the lever is not per-distro.

So closing Section 9 is a provisioning programme — a protected self-hosted runner, an install
pipeline, a repository variable and a protected GitHub environment — not a design or implementation
gap. That is 0.3.0-shaped work.

## 3. What is already proven, and therefore is not being abandoned

This matters: the handover is not walking away from unverified work. Recorded in
`evidence/section-9-broker-gate-run-lead2.md`, all against the real kernel with production types:

- **The broker's central security property holds.** From uid 1000, inside the exact root-owned leaf,
  five distinct escape attempts were all refused EACCES: migrate to the v2 root, migrate within the
  leaf, migrate to the service subtree, write `cgroup.kill`, and mkdir a child cgroup.
- `cleanup_leaf` refuses a populated leaf; drifted-inode `populated` / `recursive_kill` /
  `reopen_leaf` all return `identity-drift` **without acting**; `cgroup.kill` plus `cgroup.events`
  polling converged to `populated 0` with an unrelated control process untouched.
- **A Blocker was found and fixed** (`F-L2-10`): `place_guardian` used `writeln!`, which `File`'s
  `write_fmt` emits as two `write(2)` calls, so `cgroup.procs` received the pid and then a bare
  newline — parsed as an empty pid and rejected EINVAL **after** the migration had already succeeded.
  The broker could never have prepared a lease on any real cgroup filesystem. Fixed with a
  single-write helper and a hermetic packet-counting regression guard whose discriminating power is
  proven inside the test itself.
- **Production fail-closed behaviour is captured verbatim** for the unavailable case, which is
  positive evidence for the "prepare fails closed before workload activation" invariant.

What remains unproven is exactly the actual-runner half: an installed service, an authenticated
client, live lifecycle mutations, and an independent security receipt.

## 4. Edges cut, and what stays

**Cut:** `Section 9 (9.1-9.7)` as a precondition of `ecp-linux-process-authority-provider` reaching
terminal.

**Consequential:** the broker half of closure task `11.6` ("authenticated installed-broker fallback
that retains an equivalent namespace and root-owned non-migratable cgroup-v2 leaf"), and the broker
clause of `11.5` ("a forged/stale broker token"). Direction should decide whether these are struck,
narrowed to the primary path, or carried to 0.3.0 with the broker.

**Unchanged and explicitly not relaxed:**

- Every primary-path gate in this Change. Sections 1-8 and 10-11 stand as written.
- Typed `authority-unavailable` must still be returned when no authority exists, and must **never**
  silently reroute. A Linux host with unprivileged namespaces disabled gets a declared hosted
  unavailability — structurally the same answer Replan 4 gives macOS, which is a useful symmetry
  rather than a new concession.
- The broker must not become an implicit fallback in 0.3.0 either. It remains separately selected.
- Replan 4's `in-tool` / `hosted` grading is untouched by this.

## 5. Open findings: what moves, and the one that must not

Of the 11 pre-existing open findings, **3 are broker-path — and they include the Change's only
Blocker.**

| Finding | Severity | Path | Disposition |
| --- | --- | --- | --- |
| `BRK-R2-B01` | Major | broker | moves to 0.3.0 |
| `BRK-R2-B02-M03` | Major | broker | moves to 0.3.0 |
| `BRK-R2-B06` | **Blocker** | broker | moves to 0.3.0 — **but see the carve-out below** |
| `NATIVE-SEAM-R1-M01/M02` | Major ×2 | primary | stays |
| `WSL-R4-M00/M01/M04/M05/M06` | Major ×5 | primary | stays (all five now have wave evidence) |
| `PKG-P5` | Minor | packaging | stays; being closed by the 7.2 re-emit |

### Carve-out — `BRK-R2-B06` must not move whole

`F-L2-01` established that `BRK-R2-B06` is **probably under-scoped**. It is filed against the broker
daemon, and its required fix enumerates "activation, inspection, runtime-open" — but the **primary**
helper CLI had the identical defect on exactly those three verbs, validating `--deadline-ms` with
`bounded_u32` and then discarding the value. The finding as written does not cover the primary path
at all.

So if `BRK-R2-B06` moves to 0.3.0 unqualified, **a live primary-path defect leaves 0.2.0 with it**.
Direction should split it: the broker instance moves, and a primary-path sibling stays open in 0.2.0,
carrying `F-L2-01`, `F-L2-02` (`after_ms` re-anchors the budget rather than delivering an absolute
end-to-end deadline) and `F-L2-03` (`inspect`, `open-runtime` and `terminate` still discard their
deadline — knowingly left, not signed off).

`F-L2-16` is downstream of the same mechanism and stays: the fixed 2-second `CONTROL_TIMEOUT` makes
`linux_primary_contract` flake at roughly 33% under parallel execution, which is why every receipt in
this Change is bound to `--test-threads=1`.

Two further broker-side findings from this wave move with the broker: `F-L2-06` (design says the
broker leaf needs only core interface files; code hard-requires `pids`) and `F-L2-09`
(`FsCgroupKernel`, the ~580-line real kernel-facing type the shipped daemon uses, has **zero**
references in `tests/` — every broker cgroup test drives `FixtureKernel`). `F-L2-09` is the reason
`F-L2-10` stayed invisible through every prior review round, and 0.3.0 should inherit it as a
starting condition rather than rediscover it.

## 6. What this unblocks

With Section 9 no longer gating terminal, `ecp-linux-process-authority-provider` can reach terminal
on the primary path, which unblocks the chain Replan 4 already freed from macOS:

```text
linux (primary-only, terminal) + windows  ->  ecp-native-process-capsule-closure
   -> ecp-durable-agent-session-host
      -> ecp-frozen-action-session-executor
         -> ecp-session-policy-and-control-parity
            -> ecp-session-self-hosting-vertical-proof
```

Combined with Replan 4, this removes the last remaining infrastructure blocker above ECP-7.

## 7. Task-ledger consequence

Current state is **75/93 checked**, Change NON-TERMINAL, frozen at
`sourceSha256 087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59`.

If Direction accepts this, 9.1-9.7 leave the ledger rather than remaining unchecked, and the
denominator changes. Direction should state whether the seven tasks are struck from this Change's
`tasks.md` or retained with an explicit moved-to-0.3.0 marker. **The LEAD's recommendation is
retained-with-marker**, matching the discipline applied to the macOS child in run-state, where
`skipped` carries `statusRaw: moved-out-to-0.3.0` and a note stating that the status records scope
removal only. Striking them would erase the evidence that the work was scoped, attempted, and
determined unreachable — which is the more useful record for whoever picks it up in 0.3.0.

## 8. Not approved by this document

Nothing about macOS. Nothing about relaxing any primary-path gate. No change to typed
`authority-unavailable` semantics. No permission for the broker to become an implicit fallback in any
version. No claim that 0.2.0 Linux supports hosts with unprivileged namespaces disabled — that
becomes a declared unavailability requiring the same honest evidence Replan 4 demands of macOS.

Also unaffected and still open for a separate Direction decision: `F-L2-17`, the cross-platform
`workload-non-escape` definitional gap, now demonstrated with a kernel receipt on **both** Linux and
Windows. It is a primary-path and contract-level question, not a broker one, and it does not move.
