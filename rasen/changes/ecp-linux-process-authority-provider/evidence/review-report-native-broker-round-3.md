# Native Linux broker review report - round 3

Date: 2026-08-06
Reviewer role: fresh non-author, dispatched report-only
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
Review snapshot HEAD: `140115ced9df814f6adf3190b47171202d964a5e`
Authoritative live source SHA-256: `2cf6d54e8c05164c54b5800c3e2e1213865eb400c43c8eef73983f38d24bd151`

## Verdict

**FAIL - 2 Blocker, 1 Major.**

The current source closes the hidden activation-time publication write, lease transition races,
terminal-history fabrication, zero-grace rejection, trusted-management-domain cgroup removal,
and post-use authenticated tombstone cleanup. It does not close the end-to-end prepare response
loss transaction or the absolute-deadline contract. A daemon request can still commit a prepared
lease after its only client has timed out, and activation can still start the workload after the
common coordinator has settled timeout. The ready-hook source ordering is correct, but its
production fsync/worker is not deadline-supervised and its focused regression does not prove that
the durable reference precedes final readiness.

This verdict is limited to source plus the reached Windows and non-privileged WSL paths. It is not
a Section 9, root-installed broker, writable unified cgroup-v2, general-distribution, package
release, or terminal Linux-support verdict. Section 9 remains **OPEN**.

Scope Check: **REQUIREMENTS MISSING**

- Intent: an explicitly selected, authenticated, recoverable broker whose durable request and
  lifecycle transactions honor one common absolute deadline and whose cgroup leaf is exact.
- Delivered: exact publisher binding, durable request records, serialized lease transitions,
  authentic terminal tombstones/EventGap, zero grace, management-domain removal serialization,
  and authenticated uninstall cleanup.
- Missing: a controller-recoverable prepared response after client-process loss, server-side
  deadline supervision/cancellation for prepare and activation, and an ordering-sensitive
  construction regression. The real Section 9 matrix is also unavailable and remains open.
- No new broker-scope feature creep was found.

## Standards axis

Result: **FAIL - 2 Blocker, 1 Major.** Worst issue: a timed-out activation may continue in the
detached daemon and start workload code after the common operation has already settled timeout.

## Spec axis

Result: **FAIL - 2 Blocker, 1 Major.** The implementation still violates the bounded-operation and
late-result scenarios in `spec.md:205-221`, and the response-loss path still cannot be recovered
by a replacement controller that does not possess the broker client's ephemeral request id.

## Findings

### BRK-R2-B02 - Blocker - prepared response replay is keyed by an ephemeral client request id and prepare can commit after deadline

Evidence:

- The broker client generates a fresh random request id inside each process invocation
  (`rasen-linux-process-authority-broker-client.rs:308-330`). Its one retry preserves that id only
  while the same process still has remaining deadline (`:278-300`); no request id is returned to
  TypeScript on timeout/control loss.
- The daemon persists the completed response, removes the provisional recovery through
  `complete_prepared_delivery`, and only then writes the response to the socket
  (`rasen-linux-process-authority-broker.rs:435-443`). If that write is lost or the client was
  killed, the lease remains but a later client invocation creates a different request id.
- `BrokerServiceCore::handle` checks the absolute deadline only on entry
  (`broker_service.rs:282-303`). `prepare` then calls the recoverable guardian and completes the
  cgroup/lease transaction without a post-prepare deadline check (`:341-458`).
- The regression `prepared_response_loss_replays_the_same_durable_authority` manually reuses the
  same in-memory `BrokerRequest` (`linux_broker_service_contract.rs:750-795`). It does not kill the
  production client, cross the deadline, or prove discovery from a new controller process.

Impact: a slow valid prepare or response-loss boundary can make the common coordinator return
timeout/control loss while the daemon commits a durable inert guardian, cgroup, lease, and replay
record that the controller cannot name. This is retained process authority with no reachable
reference, not durable replay from the caller's perspective.

Required fix: make the replay/recovery identity durably derivable from a controller-known
preparation operation id (or add an explicit delivery acknowledgement/recovery protocol), and
supervise prepare against the request's absolute deadline. On expiry or client loss, either deliver
the same discoverable prepared reference or exactly abort/reconcile it; never retire the only
recovery record behind an undisclosed random request id. Add actual broker-client/daemon process
death, delayed prepare, deadline expiry, and response-loss regressions.

### BRK-R2-B06 - Blocker - zero grace is fixed, but mutating daemon work is not governed by the absolute deadline

Evidence:

- Zero grace is now accepted by the codec (`broker_protocol.rs:641-660,694-706`) and termination
  skips grace while retaining the cgroup deadline (`broker_service.rs:557-619`). That sub-issue is
  closed.
- The TypeScript wrapper kills only its broker-client child when the common signal aborts
  (`native-assembly.ts:431-462`). The installed daemon handles the already authenticated request
  in an independent detached thread (`rasen-linux-process-authority-broker.rs:75-87`). Client death
  does not cancel that daemon transaction.
- Service dispatch checks the deadline once before routing (`broker_service.rs:282-303`).
  `activate` performs durable `ActivationPending`, calls `guardian.activate`, then commits
  `Activated` with no remaining-deadline check (`:487-516`). The primary guardian activation seam
  receives no deadline (`broker_guardian.rs:482-486`). Prepare has the same unbounded shape.
- The production construction hook performs record rewrite plus `sync_all`
  (`broker_guardian.rs:546-606`), while the caller-mapped parent uses blocking child-result read and
  `waitpid(..., 0)` (`:357-405,707-724`). No absolute deadline supervises those waits.
- Fresh primary seam review independently reported the same temporal defect as
  `NATIVE-SEAM-R1-M01`; current hashes are unchanged.

Impact: a request admitted just before expiry can activate after expiry, so workload code may
start after the common coordinator has returned timeout. Prepare can likewise keep an inert
authority and worker alive past settlement. Late mutation is not quarantined by the common
coordinator because the destructive work occurs in the separate daemon.

Required fix: thread the absolute monotonic deadline through daemon dispatch, recoverable guardian
prepare, activation, inspection, runtime-open, publication, and every blocking socket/fsync/wait.
Before any irreversible transition, recheck remaining time. On expiry, cancel/supervise the worker
and reconcile the exact durable state; activation must not open the gate after deadline. Add
production daemon/client tests for activation at the boundary, stalled guardian/fsync, delayed
response, greater-than-two-second success within budget, zero grace, and late-result quarantine.

### BRK-R2-B01 - Major residual - construction ordering is correct in source, but deadline supervision and the defining ordering oracle remain absent

Evidence:

- Current source constructs/validates the exact attestation, invokes the ready hook, and only then
  writes the guardian identity and waits for final `R` readiness (`primary.rs:429-478`). The broker
  hook fsyncs the exact encoded client reference (`broker_guardian.rs:546-560`). On an ordinary hook
  error, the existing path kills/reaps the exact guardian and cleans the scope.
- This source ordering closes the original direct after-attestation/before-readiness death window.
  The source hashes remain `primary.rs=40d5231...dda6ea` and
  `broker_guardian.rs=0d22e99...cf7472`.
- The hook/fsync and caller-mapped worker remain unbounded as described in `BRK-R2-B06`; a stalled
  construction can outlive the request deadline before a complete durable reference is available.
- `pre_readiness_hook_failure_reaps_the_exact_inert_guardian` proves error cleanup but does not
  observe that final readiness is blocked while the hook is held. Moving the hook after final `R`
  would leave its assertions green (`linux_primary_contract.rs:217-250`). Fresh seam finding
  `NATIVE-SEAM-R1-M02` confirms this exact gap.

Impact: the current ordering is reviewable and correct, but the safety-critical invariant is not
locked by a regression and its production persistence step is not bounded. A future reorder would
reopen the original control-loss window silently; a present fsync/worker stall already violates
bounded prepare.

Required fix: retain the current ordering, add a barrier-based test that holds the hook and proves
the guardian cannot complete final readiness or accept control before persistence, then releases
it and proves prepare completes. Separately supervise the worker/hook with the absolute deadline
and add distinct worker/daemon death injections before fork, after clone, after native `N`, during
construction-record commit, and before `GuardianPrepared` replacement.

## Round-2 closure matrix

| Finding | Round-3 status | Fresh current-source disposition |
|---|---|---|
| `BRK-R2-B01` construction death window | **PARTIAL - Major residual** | Source ordering is correct and the exact reference is fsynced before final readiness, but deadline supervision and an ordering-sensitive/death-injection oracle are absent. `NATIVE-SEAM-R1-M01/M02` affect closure, not the observed source digest. |
| `BRK-R2-B02` prepared response loss | **OPEN - Blocker** | Completed replay is reachable only with the broker client's undisclosed random request id; prepare can commit after deadline and retire recovery before socket delivery. |
| `BRK-R2-B03` explicit publication binding | **CLOSED in source + reached paths** | The publisher first commits the exact TypeScript ledger and then calls the dedicated broker `recordPublication` seam before returning acknowledgement (`provider.ts:372-392`). The client sends the closed full binding (`broker-client.rs:180-223`); service persists it only as Prepared -> Published, and activation requires Published/ActivationPending (`broker_service.rs:461-516`). Activate contains no publication write. |
| `BRK-R2-B04` transaction locking | **CLOSED in source + reached paths** | All token lifecycle routes use `with_request_token` (`broker_service.rs:304-338`). The store combines a fixed in-process shard mutex and root-owned fd `flock` (`broker_lease.rs:653-699`), so compare/rename is serialized across threads and broker restarts. Fresh concurrent publish/abort and activate/terminate tests passed. |
| `BRK-R2-B05` authentic terminal history | **CLOSED in source + reached paths** | Exact closed journals or explicit EventGap are persisted in the authenticated terminal lease (`broker_lease.rs:115-152,188-199`); replay returns that journal or EventGap without synthesizing Prepared -> Empty (`broker_service.rs:600-632`). |
| `BRK-R2-B06` zero grace / absolute deadline | **PARTIAL / OPEN - Blocker** | Zero grace is closed. Absolute end-to-end deadline and late daemon mutation remain open for prepare/activate and other non-termination routes. |
| `BRK-R2-B07` cgroup removal identity | **CLOSED only in the trusted source management domain; Section 9 OPEN** | Create/bind/remove pathname mutation shares the `FsCgroupKernel` administrative mutex; removal validates name/inode under that mutex through `unlinkat` (`broker_cgroup.rs:456-490,598-634,684-708`). The daemon/uninstaller singleton excludes a second legitimate service owner. Arbitrary external root mutation is outside this mutex, and the regression is fixture-only; no root/cgroup-v2 terminal claim is made. |
| `BRK-R2-M01` authenticated uninstall cleanup | **CLOSED in source + reached non-privileged paths; privileged execution OPEN** | The stopped-service singleton invokes a root-only installed binary, which validates install/key/store provenance and refuses construction, recovery, pending, retained, or malformed state. Only authenticated `CleanupComplete + ExactEmpty` leases, completed request records, and validated shard locks are removed (`uninstall.sh:15-31,90-106`; daemon `:92-138`; `broker_lease.rs:824-901`). The script was syntax-checked, not run as root. |

## Coverage map

```text
BROKER CODE PATH COVERAGE
=========================
[+] construction reference
    +-- [STATIC/CORRECT] exact fsync before final readiness
    +-- [WSL TESTED] hook error reaps inert guardian
    +-- [GAP/MAJOR] no ordering-sensitive barrier or full process-death matrix
[+] prepared delivery
    +-- [TESTED/FIXTURE] same-request-id recovery replay
    +-- [GAP/BLOCKER] new controller cannot recover undisclosed request id
[+] publication / activation
    +-- [TESTED] explicit exact binding and no activation publication write
    +-- [GAP/BLOCKER] activation can mutate after absolute deadline
[+] durable lifecycle
    +-- [TESTED] cross-thread publish/abort and activate/terminate convergence
    +-- [TESTED] closed journal or EventGap terminal replay
[+] cgroup / administration
    +-- [STATIC + FIXTURE] management-domain removal lock and identity validation
    +-- [TESTED] authenticated tombstone cleanup contract and shell syntax
    +-- [OPEN -> SECTION 9] installed root daemon, real leaf migration/removal,
        cgroup.kill, populated restart, and unrelated-cgroup survival

TERMINAL COVERAGE
=================
Windows default-parallel source gate: PASS
Fresh WSL static-musl test ELF execution: PASS, non-privileged reached paths only
Actual root-installed writable unified cgroup-v2 broker gate: NOT RUN / OPEN
Release, production default, and terminal Linux support: NOT CLAIMED
```

## Verification receipts

### Windows host default-parallel gate

Environment:

```text
CARGO_TARGET_DIR=E:\tmp\rpa-broker-r3-win-20260806
TEMP/TMP=E:\tmp\rpa-broker-r3-win-temp-20260806
cargo 1.88.0 (873a06493 2025-05-10)
rustc 1.88.0 (6b00bc388 2025-06-23)
```

Command: `cargo test --locked` from `native/linux-process-authority` with default parallelism.

Result: **PASS - 58 passed, 0 failed, 0 ignored** across 18 test binaries/doc tests. The formerly
flaky service selection passed 11/11.

### Fresh WSL matrix

Fresh build roots:

```text
CARGO_TARGET_DIR=E:\tmp\rpa-broker-r3-wsl-20260806
TEMP/TMP=E:\tmp\rpa-broker-r3-wsl-temp-20260806
RUSTFLAGS=-C linker=rust-lld
target=x86_64-unknown-linux-musl
```

Commands:

1. `cargo test --locked --target x86_64-unknown-linux-musl --no-run`
2. Re-query Cargo JSON and select only `compiler-artifact` entries with `profile.test=true`.
3. Execute each selected ELF directly on `wsl.exe -d Ubuntu-24.04 -- <elf> --test-threads=1`.

Result: **PASS - exactly 18 test ELFs, 93 passed, 0 failed, 0 ignored**. Broker-named subset:
45/45. Primary contract: 23/23. WSL kernel:
`5.15.167.4-microsoft-standard-WSL2`, x86_64. The sorted ELF manifest
`<basename>\t<byteLength>\t<sha256>\n` has SHA-256
`004296d11e0196efa3a1d5548b3cb79c158f2ef6b626bb6426eaaf5d1bf3dd12`.

This is Windows-built static-musl code executed as Linux processes on WSL. It reaches real Linux
peer credentials and primary namespace/pidfd oracles plus broker fixtures; it does not reach an
installed root broker or real broker cgroup-v2 authority.

### Static, format, TypeScript, and Change gates

- `cargo check --locked --all-targets --target x86_64-unknown-linux-gnu` with fresh E-drive
  target/temp: **PASS**, no warnings; cross-target compile evidence only.
- `cargo +stable fmt --all -- --check`: **PASS**.
- `pnpm exec vitest run` for provider, artifact-resolver, boundary-guards, and package-CI suites:
  **4 files, 49 passed, 0 failed**.
- `pnpm exec tsc --noEmit --pretty false`: **PASS**.
- Focused ESLint for native assembly/provider and their boundary/provider tests: **PASS**.
- WSL `sh -n install.sh` and `sh -n uninstall.sh`: **PASS**; neither script ran with privilege.
- `node scripts/build-linux-process-authority.mjs --check-only --target
  x86_64-unknown-linux-gnu` with only `TEMP/TMP` on E: **PASS**,
  `runtimeAccepted=false`, source before/after
  `2cf6d54e8c05164c54b5800c3e2e1213865eb400c43c8eef73983f38d24bd151`.
  A prior diagnostic invocation with `CARGO_TARGET_DIR` was rejected by the script's intentional
  build-environment guard and was not counted as a gate.
- `node bin/rasen.js validate ecp-linux-process-authority-provider --strict --json`:
  **PASS - 1/1 valid, 0 issues**.

### Section 9 environment gate

Read-only WSL audit:

```text
uid=1000
/sys/fs/cgroup: tmpfs, mounted read-only, reviewer not writable
/sys/fs/cgroup/unified: cgroup2, directory mode dr-xr-xr-x, reviewer not writable
cgroup.controllers: present but empty/read-only to reviewer
cgroup.subtree_control and cgroup.procs: present but read-only to reviewer
cgroup.events: absent
cgroup.kill: absent
```

No root install, systemd service mutation, cgroup creation/migration/kill/remove, or administrative
state change was performed. Tasks 9.1-9.7 and 11.4 remain **OPEN**.

## Source hashes at final review snapshot

```text
primary.rs                                      40d5231a99f1582b82123fd6758a084d7730b0840fc2c5b9fc89587868dda6ea
broker_guardian.rs                              0d22e991ad54e2a6f63fe0f7ae922e09641ec90a259b2045ae700ebb13cf7472
broker_protocol.rs                              880ee32da6f0a28ab7fcf1b4d2fd1900c6b9bf55364a5591bb49aafab8aa06f3
broker_lease.rs                                 cbf9ce4049d355b9a1f064f846b9d9787d6a8ba07e4334ff995e62a3ca6ec9cd
broker_service.rs                               1fc7cff8a3344e73ef09be16a2be02766bc6a6d55c89296e08c60ae0acee6579
broker_cgroup.rs                                4504dfe100c89c0346c005a40817c99fcf71b91c5f076fa22f8b3cd3ed2af2f1
rasen-linux-process-authority-broker.rs          79e0bbaf20c5a196d2adbe29a5ac73bbdcbae74307f7e7c359e57759d2593ff1
rasen-linux-process-authority-broker-client.rs   b87bc6b411bbfe9de9cf00f6ed26240bb5f786805eab1e1c419ca05deb8be795
uninstall.sh                                    0175e50d2ddd5651da4dc3421a412d326bc2c00ff6a09be167230aed406a9794
native-assembly.ts                              411ad3663706d54bb02fcc00d009e434ed65a299f7c29cc1304f045b74398706
provider.ts                                     530b284b1a0e8e8778da8693ec73e7167de9db05d155c21619e9662b48b12985
linux_broker_service_contract.rs                80f2acd839b7982d9d243ed3674cebefe5a178af3392040b91caa115bea3c211
linux_primary_contract.rs                       741df44df9dfdb5e0cc5e1c5b7b6609e830b436f5be0fc742950b8235838403b
```

All reviewed text files and this report were strictly decoded as UTF-8. The report is UTF-8
without BOM.

## Durable findings

1. Do not mark the broker implementation terminal until `BRK-R2-B02`, `BRK-R2-B06`, and the
   residual `BRK-R2-B01` proof/boundedness gap are independently fixed and re-reviewed.
2. Preserve the exact publisher-owned `recordPublication` ordering, fd-backed token locks, and
   authentic closed-journal/EventGap tombstones; weakening any reopens round-2 Blockers.
3. Cgroup pathname deletion is source-clean only inside the broker's singleton trusted management
   domain. External-root replacement and the actual kernel remove oracle remain Section 9 work.
4. Section 9 must stay open until an authorized root-installed broker runs on writable unified
   cgroup v2 with `cgroup.events`, `cgroup.kill`, restart/death, non-migration, drift, natural-empty,
   recursive-kill, abort, uninstall, and unrelated-authority survival receipts.
5. The fresh Windows/WSL/static/strict gates do not prove installation, release packaging,
   production default selection, or general Linux distribution support.
