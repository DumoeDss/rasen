# Strategy attempt 1: opaque ProcessScope with native ProcessCapsule adapters

Status: **DESIGN SELECTED; IMPLEMENTATION AND FRESH NON-AUTHOR REVIEW PENDING**.

This artifact records the first bounded strategy attempt after the Round 3
independent review left two Major findings open. It does not claim either
finding resolved and does not change task, pipeline, ship, or archive state.

## Problem

The Round 3 implementation improved admission ordering and retained authority,
but its process authority is still assembled from several shallow mechanisms:

- Session host and ownership code exchange a root PID and process-start text.
- `agent-cli-process.ts` creates an inert Node supervisor, then starts a
  PowerShell Job controller which assigns the already-created supervisor.
- Windows tree termination still has PID/task-tree escape paths outside the
  Job lifetime.
- the remaining-POSIX identity hashes second-resolution `ps -o lstart=` text.

Independent real-Windows probes killed the direct Job controller while the
admitted root and detached descendant remained alive. Independent review also
proved that two remaining-POSIX processes started in the same second can have
the same persisted identity. Consequently, PID plus a sampled attribute is not
a durable signalling capability, and a user-space watchdog is not a substitute
for kernel containment.

The replacement must satisfy all of these constraints:

1. A capable backend cannot run before its exact process scope is durable.
2. Session host never signals a PID, PGID, Job, controller, or OS handle.
3. Controller, daemon, and inert-supervisor failure have explicit outcomes.
4. Windows controller death closes the last non-inherited Job handle and
   kernel-kills the admitted root plus detached descendants.
5. Linux and macOS never authorize a signal from a reused numeric PID.
6. Production and deterministic tests use two adapters at one real seam.
7. Unsupported native capability fails closed before activation; there is no
   production fallback to PowerShell assignment or `ps lstart` authority.

## Three designs considered

### A. Minimal opaque ProcessScope

Design A minimized the interface to one lifecycle module. Session host receives
an opaque `ProcessRef`, publishes it, activates it, observes it, and closes it.
PID is optional display data only. This provides the best external depth and
prevents OS vocabulary from escaping into host lifecycle logic.

Its weakness alone is that it does not prescribe how production adapters prove
Windows last-handle ownership, portable helper integrity, or real-OS test
coverage.

### B. ProcessCapsule ports and adapters

Design B put spawn identity, containment, activation, observation, and
termination behind `ProcessCapsulePort`. A packaged native helper is the
production adapter and a scripted in-memory implementation is the deterministic
adapter. Version/hash/capability checks are part of the adapter contract, and
runtime download or weak fallback is forbidden.

This maximizes locality for OS variation and supplies a real second adapter,
but its first form exposed more launch/runtime concepts than the common Session
host caller needed to learn.

### C. Daemon-owned controller topology

Design C optimized the normal caller and failure topology. Every generation has
one daemon-owned native controller outside containment and one inert supervisor
inside containment. The controller establishes authority, the host publishes
it, and only then is the supervisor activated. It explicitly covers
controller/daemon/supervisor death instead of treating all process closes as
the same event.

Its weakness alone is that controller topology can leak into callers and can
encourage a second daemon-held Job handle, which would defeat Windows
last-handle close.

### Comparison

| Design | Depth | Locality | Seam placement | Main risk |
| --- | --- | --- | --- | --- |
| A: opaque ProcessScope | Highest external leverage: four lifecycle operations and no OS facts | Host logic remains clean | Exactly between Session lifecycle and process authority | Too abstract to force a safe production implementation |
| B: ProcessCapsule | Highest adapter leverage across Windows/Linux/macOS and deterministic tests | All OS code, helper protocol, and capability probing live together | Internal runtime seam beneath backend transport | Interface can become wider than the Session host needs |
| C: native controller topology | Best default-call ordering and failure matrix | Per-generation authority is easy to audit | Topology spans daemon/controller/supervisor | Multiple handle owners or topology leakage can weaken the invariant |

## Selected hybrid

Use A as the external interface, B as the internal adapter/package contract,
and C as the production topology. The seam exposed to Session host is the
minimal opaque `ProcessScope`; the native helper, OS identity, controller,
supervisor, handle and signal mechanics remain private to `ProcessCapsule`.

```ts
declare const processRefBrand: unique symbol;
type ProcessRef = string & { readonly [processRefBrand]: true };

interface ProcessScope {
  prepare(input: ProcessPrepareInput): Promise<PreparedProcessScope>;
  inspect(ref: ProcessRef): Promise<ProcessObservation>;
  terminate(ref: ProcessRef, intent: TerminationIntent): Promise<TerminationReceipt>;
}

interface PreparedProcessScope {
  /** Bounded/versioned and opaque to Session host. */
  readonly ref: ProcessRef;
  /** Optional observability only; never authority. */
  readonly displayPid?: number;
  activate(): Promise<LiveProcessScope>;
  abort(reason: string): Promise<TerminationReceipt>;
}

interface LiveProcessScope {
  readonly ref: ProcessRef;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly closed: Promise<CloseReceipt>;
}

type ProcessObservation =
  | { state: 'prepared' | 'live'; controllable: true }
  | { state: 'closed'; controllable: false }
  | { state: 'foreign'; controllable: false }
  | { state: 'uncertain'; controllable: false; diagnostic: string };

interface TerminationReceipt {
  state: 'closed' | 'retained' | 'uncertain';
  gracefulAttempted: boolean;
  forced: boolean;
  diagnostic?: string;
}
```

`AgentSessionBackend.prepare()` uses the private ProcessCapsule launcher and
returns `PreparedProcessScope` with protocol I/O attached. Session host performs
this ordering and nothing OS-specific:

```text
claim generation
  -> backend.prepare() returns inert ProcessRef
  -> registry CAS + fsync ProcessRef
  -> activate()
  -> stream protocol
```

On daemon replacement, host passes the opaque ref back to `inspect` or
`terminate`. It never decodes the ref and never calls `process.kill`, `taskkill`,
or negative-PGID signalling itself.

Registry schema v2 records `{ generation, ownerToken, runtimeRef, displayPid?,
preparedAt }`. `displayPid` is never accepted by a control method.

## Interface invariants

1. **Contained before capable:** `prepare` returns only after kernel/process
   containment exists and the inner supervisor is inert.
2. **Publish before activate:** `activate` is unavailable to Session host until
   the exact `ProcessRef` has been atomically published under the current
   generation/revision CAS.
3. **Opaque authority:** only the adapter may decode `ProcessRef`; PID/PGID and
   timestamps are diagnostics, never a control argument.
4. **Exactly one controller:** one generation has one native controller outside
   containment. On Windows it uniquely owns the only non-inherited Job handle.
5. **Exactly-once activation:** repeated activation, CAS loss, abort, shutdown,
   or controller loss cannot execute the backend twice.
6. **Observed tree close:** a `closed` termination receipt is legal only after
   the adapter proves the whole scope empty. Timeout or lost observation retains
   registry and writer authority.
7. **Fail-closed identity:** `foreign` or `uncertain` never causes a signal,
   claim release, or automatic restart.
8. **Control-plane loss is explicit:** daemon, controller, supervisor, backend,
   and control-pipe closes are distinct observations.
9. **No secret surface:** helper input may include server-resolved executable,
   argv, cwd and an environment allowlist, but never prompt text, credentials,
   signing material, Run/Action payload, or arbitrary client argv.
10. **No weak production fallback:** helper unavailable, hash/version mismatch,
    or missing exact identity fails before activation.

## Production topology and OS adapters

### Shared native helper contract

The package ships a source-built helper and a manifest binding helper protocol
version, platform/architecture, file length and SHA-256. The runtime resolves
only the helper adjacent to the installed Rasen package, verifies it before
spawn, then performs a bounded framed handshake. There is no PATH lookup,
postinstall compilation, runtime download, shell, PowerShell, or `ps` fallback.

The controller is a daemon child outside the containment scope. The inert
supervisor/backend is inside the scope. A private control channel carries
`PREPARE`, `ACTIVATE`, `TERMINATE`, and close receipts. Backend stdin/stdout/
stderr use separate inherited handles selected by an explicit allowlist.

The death matrix is normative:

| Failure | Required result |
| --- | --- |
| daemon dies / control EOF | controller closes/terminates the scope; unfinished turn remains ambiguous |
| controller dies before activation | inert scope is closed; backend marker is never created |
| controller dies after activation on Windows | last Job handle closes; root and detached descendants die in kernel |
| inert supervisor dies before backend exec | controller reports failed-before-activation; no backend child |
| inert supervisor dies after backend descendants exist | containment remains authoritative and controller reaps the full scope |
| backend root dies with descendants | scope remains live until all descendants close or are terminated |

### Windows adapter

The native controller creates an unnamed Job, applies
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and uses `CreateProcessW` with
`CREATE_SUSPENDED`, `EXTENDED_STARTUPINFO_PRESENT`,
`PROC_THREAD_ATTRIBUTE_JOB_LIST`, and an explicit
`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`. Thus the inner supervisor belongs to the
Job at creation and cannot run before activation. The Job handle is neither
named, inherited, duplicated into the daemon, nor passed to the backend.

Before returning PREPARED the controller verifies Job limits and membership.
After durable publication, ACTIVATE resumes the inner supervisor. Graceful
close may use backend protocol/control, but forced close uses the Job and only
reports closed after `QueryInformationJobObject` observes no active members.
Killing the controller necessarily closes the last Job handle and invokes the
kernel kill-on-close behavior. A second daemon-held handle is forbidden because
it would make controller death non-terminal.

### Linux adapter

The controller creates a gated process-group/session leader, captures boot ID
and `/proc/<pid>/stat` start ticks, and obtains a pidfd while the child is still
inert. The live controller uses pidfd observation/signal for the exact root and
the reserved process group for descendants. After restart, PID plus boot/start
facts must be revalidated around pidfd acquisition; mismatch is `foreign`, and
failure to acquire exact authority is `uncertain`. A kernel without required
pidfd support is an explicit capability failure for durable hosting.

### macOS adapter

The native adapter creates a gated process-group/session leader and captures a
real process birth identity through `proc_pidinfo`: prefer
`PROC_PIDUNIQIDENTIFIERINFO` (`p_uniqueid` plus `p_idversion`); an adapter may
use the microsecond `PROC_PIDTBSDINFO` birth fields only when it can prove the
exact supported-host contract. If the exact source is unavailable, prepare
fails closed before activation. Generic second-resolution `ps -o lstart=` is
deleted as signal authority. Other POSIX platforms are unsupported rather than
silently routed through that fallback.

## Helper trust and supply chain

- Helper source lives in this repository; binaries are built in the actual
  Windows/Linux/macOS release matrix, never downloaded at runtime.
- The npm artifact includes a generated signed/hash manifest and only supported
  platform/architecture helpers. The helper protocol version is exact-match.
- CI records compiler version, target, source digest, binary digest, SBOM and
  artifact provenance. macOS binaries require signing/notarization before
  release; Windows signing is required when the release process supports it.
- Runtime verifies regular-file placement, no symlink escape, owner/ACL policy,
  expected length/hash, protocol version, and platform/architecture before
  sending launch facts.
- A small memory-safe helper is preferred. Its parsing surface is a bounded
  length-prefixed protocol rather than general JSON. Third-party dependency
  count is kept minimal and exactly locked.

## Failure taxonomy

All codes are platform-neutral and may be mapped to the existing host outcome
shape without disclosing an OS mechanism:

- `containment-unsupported`: required native capability is absent.
- `helper-integrity-failed`: helper placement/hash/version is invalid.
- `containment-prepare-failed`: no inert scope was created.
- `containment-not-established`: scope exists but membership/identity proof is
  incomplete; activation is forbidden.
- `authority-persist-failed`: ProcessRef publication lost CAS or failed I/O;
  abort the inert scope.
- `activation-failed`: durable authority exists but activation was not
  observed; retain/ref reconcile.
- `process-identity-foreign`: durable ref resolves to a different instance;
  never signal it.
- `process-authority-uncertain`: exact identity or controller state cannot be
  proven; retain authority.
- `process-control-lost`: controller/control channel vanished without a proven
  close.
- `process-termination-unobserved`: termination was requested but scope-empty
  was not observed.
- `containment-breach`: an invariant says the scope must be empty but a member
  remains, including a Windows tree surviving controller death.

`foreign`, `uncertain`, `control-lost`, `termination-unobserved`, and breach all
forbid release/restart. They are not normalized into ordinary backend failure.

## Rejected framings

- **More PID fields:** adding CIM creation time, executable path, parent PID,
  nonce, or a higher-resolution `ps` value still produces sampled identity,
  not a control capability.
- **PowerShell controller plus watchdog:** a watchdog can detect controller
  death but cannot make Job handle lifetime atomic. Multiple watchdog/daemon
  handles also defeat last-handle close.
- **Daemon and controller both hold the Job:** rejected because killing the
  controller would leave the daemon's handle open and preserve the exact Round
  3 escape.
- **Generic `killProcessTree` as durable authority:** PID enumeration and
  `taskkill /T` cannot contain detached descendants or close PID-reuse races.
- **`sysctl`/`ps` as the macOS default:** lower portability and weaker identity
  than the native proc unique identifier; diagnostic fallback must not become
  signal authority.
- **Linux pidfd as the public model:** pidfd is an excellent Linux adapter
  primitive but does not express Windows tree containment or macOS identity.
- **Runtime compilation/download:** expands the install and supply-chain trust
  boundary and makes correctness depend on local toolchains/network.

## Exact RED and real-OS test oracle

The first implementation slice must add these tests before product changes:

```text
test/core/session-host/process-scope-contract.test.ts
  prepare_is_inert_until_published_activation
  activate_is_exactly_once
  cas_loss_aborts_without_backend_marker
  foreign_or_uncertain_never_signals_or_releases
  termination_retains_authority_until_scope_empty
  controller_daemon_supervisor_death_matrix

test/core/session-host/process-capsule-package.test.ts
  rejects_missing_wrong_hash_wrong_protocol_wrong_arch_and_symlink_escape
  performs_no_path_lookup_runtime_download_or_shell_fallback

test/core/session-host/process-capsule-migration.test.ts
  v1_live_pid_facts_never_become_v2_process_ref
  v1_idle_or_terminal_records_migrate_without_spawn
  rollback_preserves_unknown_v2_bytes
```

Exact focused command:

```text
pnpm exec vitest run test/core/session-host/process-scope-contract.test.ts test/core/session-host/process-capsule-package.test.ts test/core/session-host/process-capsule-migration.test.ts --maxWorkers=1 --minWorkers=1
```

Before implementation it must fail because the current backend exposes
`processAdmission.commit(rootPid)`, has no opaque ProcessRef/package contract,
and cannot produce the required controller-death result.

Adapter conformance tests then run the same contract against deterministic and
native adapters. The actual-host oracles are:

**Windows**

1. PREPARED inner supervisor is already in the unnamed Job and remains inert.
2. Kill only the native controller before activation: no backend marker and no
   survivor.
3. Activate the production fixture, identify root plus detached/unref
   descendant, kill only the controller, and observe every member dead at
   bounded checkpoints.
4. Repeat for daemon force-death/control EOF and inner-supervisor death.
5. Attempt child breakaway and verify it cannot escape.
6. Audit that no backend/daemon handle duplicates the Job. A mutation which
   deliberately duplicates the handle must make the controller-death oracle
   RED.

**Linux**

1. pidfd continues to name the original task across PID churn and never the
   replacement.
2. injected same PID/different boot-start identity yields foreign and zero
   signal.
3. root plus resistant descendant close through pidfd/process-group control.
4. pidfd-unavailable capability path fails before activation.

**macOS**

1. start several processes within one second: the old `ps lstart` discriminator
   collides while each native unique id/birth identity differs.
2. injected same PID/different unique id yields foreign and zero signal.
3. exact-source-unavailable path fails before activation and never runs `ps`.
4. real group, descendant, controller and daemon-death cases close or retain
   authority exactly as the matrix requires.

ECP-8 must execute this native matrix on actual Windows, Linux and macOS. An
injected platform branch is not real-OS evidence.

## Migration and deletion list

1. Add registry schema `rasen-session-host-registry/2` with opaque
   `runtimeRef`; keep a read-only v1 parser.
2. Add ProcessScope contracts and deterministic adapter; make the contract
   suite RED before production integration.
3. Add helper source/build manifest/resolver and capability probe.
4. Implement Windows, Linux and macOS adapters behind the same port.
5. Change backend `open(processAdmission)` to `prepare -> publish -> activate`.
6. Route startup reconcile, cancel, retire and shutdown through opaque refs.
7. Delete durable-host use of:
   - `WINDOWS_JOB_CONTROLLER_SOURCE` and PowerShell Job assignment;
   - `BackendOpenInput.processAdmission.commit(rootPid)`;
   - `SessionHostWriterClaim.bindWorker/inspectWorker` PID authority;
   - `HostedProcessFacts.processInstanceId` as a host-visible signal token;
   - generic `capturePosixProcessInstance` / second-resolution `ps lstart`;
   - `killProcessTree(rootPid)` from durable hosted generation control.
8. Legacy one-shot Management Sessions may retain their existing kill-tree
   behavior because they are not durable recovery authority.

For v1 migration, terminal or no-live-process records may advance to v2.
Records containing live/uncertain PID facts must become
`legacy-containment-uncertain`; they are never re-labelled as a strong
ProcessRef. Resume may proceed only after exact absence/manual retirement is
established.

## Rollback

- Older binaries encountering schema v2 fail closed and preserve bytes; they
  must not invent an empty registry.
- Rolling back disables new durable mutation but leaves Session/backend ids
  available for a later upgraded binary to inspect or retire.
- There is no production `legacy` runtime switch. A test-only deterministic
  adapter is injected by construction, not selected from client input.
- If native helper validation fails after upgrade, no new generation activates;
  existing ProcessRefs remain retained for the matching binary/version.

## Implementation slices

1. **Interface/RED:** ProcessScope types, v2 registry model, deterministic
   adapter, exact contract/migration RED suite.
2. **Package trust:** helper protocol, adjacent resolver, hash/version/capability
   validation, build manifest and negative package tests.
3. **Windows closure:** atomic Job-at-create/suspended activation, exclusive
   handle ownership, real controller-death oracle.
4. **Linux/macOS closure:** pidfd/boot-start and proc unique-birth adapters;
   remove generic POSIX signal authority.
5. **Host integration:** backend prepare/publish/activate, reconciliation,
   cancel/retire/shutdown, v1 migration and legacy deletion.
6. **Independent closure:** focused/full gates, actual three-OS matrix, fresh
   non-author code/spec and CSO review. Only this slice may claim the findings
   resolved.

## Material-change proof

This is not an interface rename. It changes the facts that can authorize work
and termination:

- Current code can activate after publishing a PID token; the selected design
  can activate only after publishing an opaque scope created under containment.
- Current Windows controller is assigned after supervisor creation and can die
  without closing the tree; the selected controller creates the inner process
  in an unnamed Job while suspended and is the unique last handle owner.
- Current remaining-POSIX signal path can classify same-second PID reuse as the
  same process; the selected adapters use pidfd or native unique birth identity
  and fail before activation when they cannot prove it.
- Current Session host knows how to bind, inspect and signal a worker PID; after
  migration it can only pass an opaque ProcessRef back to ProcessScope.

The deletion test confirms the seam is deep: deleting ProcessScope would force
Job handle ownership, pidfd/proc identity, activation gates, termination
receipts, helper integrity, restart reconciliation and test fault injection
back into Session host, backend, ownership, daemon and shutdown callers.

**STRATEGY ATTEMPT 1 VERDICT: DESIGN SELECTED; ROUND 3 MAJORS REMAIN OPEN UNTIL IMPLEMENTATION AND FRESH REVIEW**

## Strategy attempt 1 implementation result (author evidence)

Implementation completed in the isolated ECP worktree on 2026-08-04. This is
author evidence, not the fresh independent review required by tasks 9.8 and
9.9. The historical Round 3 findings remain open until a non-author reviewer
re-runs their discriminators and records a new verdict.

The selected A+B+C hybrid is now present in product code:

- `SessionHost` and `AgentSessionBackend` receive only opaque
  `ProcessScope`/`ProcessRef` authority. Durable-host process inspection and
  termination no longer accept a PID, PGID, Job, or controller handle.
- The source-owned Rust `ProcessCapsule` helper is built by the normal build,
  pinned by `rust-toolchain.toml`, and resolved only through an adjacent,
  closed-schema manifest with exact protocol/platform/architecture/length/
  hash/capability checks. There is no install-time compile, download, PATH,
  shell, PowerShell, or weak production fallback.
- Windows uses a native controller outside an unnamed non-inherited
  kill-on-close Job. The controller creates the inner supervisor suspended
  with the Job in the creation attribute list, proves membership, publishes
  PREPARED, and resumes it only after ACTIVATE.
- Linux uses boot/start facts plus pidfd signalling and process-group empty
  observation. macOS uses native kernel birth identity and fails closed when
  it cannot establish exact identity. The remaining durable-host
  `ps -o lstart` authority was removed.
- Registry schema v2 stores the opaque runtime reference. Owner-free v1 state
  migrates on mutation; live/uncertain v1 PID facts and unknown rollback
  schemas preserve bytes and fail closed.
- Host create/recovery now follows prepare -> durable CAS -> activate. A CAS
  loss aborts without activation. If abort/close cannot be observed, the host
  retains the prepared authority and writer claim for retry instead of
  reporting a clean stop.

The first complete focused rerun exposed two CLI fixture failures: the new
production environment allowlist correctly stopped inheriting test-only
`RASEN_SESSION_FIXTURE_*` variables. The no-network replay fixture was changed
to read its test configuration from the test cwd. Production forwarding was
not widened. The isolated CLI suite then passed 3/3 and the complete focused
set passed 136/136.

Fresh author gates after the final build:

| Gate | Result |
| --- | --- |
| ProcessScope/package/migration/native suite | 4 files, 17/17 pass |
| Real Windows controller-death oracle | root and detached descendant close when only the controller dies |
| Windows duplicate-Job-handle mutation | default passes; mutation is detected |
| Windows early-activation mutation | default remains inert; mutation is detected |
| Focused durable host/Management/daemon/CLI set | 20 files, 136/136 pass |
| Real CLI resident create/wake/cancel/restart/retire | 3/3 pass |
| `pnpm exec tsc --noEmit` | pass |
| `pnpm run lint` | pass |
| stable `cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` | pass |
| `node bin/rasen.js validate ecp-durable-agent-session-host --strict` | valid |
| `npm pack --dry-run --json` | pass; package includes manifest and win32-x64 helper |
| Packaged Windows helper SHA-256 | `e762d0ce60b8ebe4370d202f536527b842a16b12f25b4f8405ebc1854e6472cb` |
| Linux target compile check | `x86_64-unknown-linux-gnu` pass |
| macOS target compile check | `aarch64-apple-darwin` pass |
| Post-test helper process audit | no `rasen-process-capsule` residue |

The Linux and macOS results above are compile checks from Windows, not actual
runtime evidence. The real three-OS CI matrix remains the ECP-8 delivery gate
specified by tasks 9.6 and 10.6.

**STRATEGY ATTEMPT 1 IMPLEMENTATION VERDICT: IMPLEMENTED; AWAITING FRESH NON-AUTHOR SECURITY AND CODE/SPEC REVIEW**

## Independent non-author confirmation (2026-08-04)

The fresh review confirms that this attempt genuinely fixes the historical
Windows controller-death escape: the real controller-death oracle and both
topology mutations pass. It does **not** confirm overall strategy success.

- Historical R3-V5-B remains open because the macOS `UniqueInfo` declaration is
  40 bytes while Apple's `proc_uniqidentifierinfo` ABI is 56 bytes.
- A real Windows root-exit probe proved that backend `EXIT` resolves whole-scope
  `closed` and permits SessionHost to clear authority while a detached
  descendant and the native controller/supervisor remain live.
- Linux/macOS replacement termination validates and kills only the old
  controller; without Windows Job semantics it does not reap the exact
  supervisor process group after controller loss.
- Native activation and prepared abort waits have no bounded control deadline.
- Repeated source-identical helper builds produced different binary hashes;
  each adjacent manifest was internally correct, but byte-reproducible
  provenance is not established.

Fresh gates passed: 21 focused files / 140 tests, the 4-file native subset /
17 tests, build, lint, TypeScript, Rust fmt/clippy, Linux/macOS cross-target
checks, strict Change validation, and npm dry-run packaging with an independently
matching helper length/hash. These greens do not exercise the missing semantic
paths above.

**INDEPENDENT STRATEGY ATTEMPT 1 VERDICT: EXHAUSTED (PARTIAL) — R3-V5-A CLOSED; R3-V5-B OPEN; Blocker:0 Major:4 Minor:1 Trivial:0**
