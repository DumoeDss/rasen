## Context

The escalated `ecp-durable-agent-session-host` strategy attempt already introduced the important architectural break: durable Session code sees only an opaque `ProcessRef`; a source-owned native ProcessCapsule prepares one inert contained supervisor, the registry publishes that authority before activation, Windows places the suspended supervisor in an unnamed kill-on-close Job at process creation, Linux uses boot/start identity plus pidfd, macOS attempts a kernel birth identity, and registry schema v2 refuses to strengthen live or uncertain v1 PID facts. Those are historical inputs, not work newly originated by this Change.

Fresh non-author review proved the Windows controller-death discriminator and the package's adjacent binary integrity, then found five residual defects:

- S1: the hand-declared macOS `proc_uniqidentifierinfo` struct is 40 bytes while the XNU ABI is 56 bytes, so the real capability fails closed;
- S2: backend-root `EXIT` resolves the public `closed` promise and the host releases `runtimeRef` and writer authority before a detached descendant leaves the scope;
- S3: replacement termination on Linux/macOS controls the exact old controller but cannot reap the surviving supervisor process group after controller loss;
- S4: ACTIVATE and prepared abort await controller acknowledgements without the configured control deadline;
- S5: each generated manifest matches its adjacent helper, but repeated source-identical Windows builds do not establish byte-reproducible output.

All five sit on one fault boundary: when a durable process capability may be considered live, uncertain, or closed. The Change therefore keeps `ProcessScope` as the deep module boundary and changes only its internal native implementation plus the smallest host integration needed to retain authority. Node.js 20.19+, Rust 1.88.0, Windows, Linux, and macOS remain the target contract. Actual operating-system behavior is evidence only when the oracle runs on that OS; cross-target compilation proves buildability, not runtime semantics. Under the locked portfolio policy, unavailable Linux/macOS runtime evidence is recorded for ECP-8's first clean-branch acceptance matrix rather than fabricated or made an unreachable child-local prerequisite.

## Goals / Non-Goals

**Goals:**

- Close S1-S5 with RED-first discriminators and fresh non-author security and code/spec evidence.
- Preserve an opaque, small Session-host interface while making root exit, control loss, scope-empty observation, and replacement cleanup distinct facts.
- Ensure every control phase is bounded and that timeout or uncertainty retains the exact durable capability until closure is positively observed.
- Preserve the proven Windows Job-at-create/last-handle invariant, early-activation mutation oracle, registry v2 fail-closed migration, helper adjacency/integrity checks, and lack of weak runtime fallback.
- Make package provenance claims no stronger than the evidence and require the real-OS semantic oracles in ECP-8 final CI before corresponding platform support is claimed.

**Non-Goals:**

- Replacing or re-owning the full durable Session host delivered by the escalated child.
- Frozen Action admission/execution, private signer custody, trusted completion, EvidenceStore publication, or canonical Run/Record mutation.
- Session reuse/handoff/touch policy, backend capacity, public CLI/API/Canvas/Operations control parity, or self-hosting acceptance.
- ECP-8 version/changelog/tag/legacy-retirement/clean-branch/PR work or any 0.3.0 Issue, Execution Plan, Dispatch, portfolio-runtime, or `auto-decompose` migration.
- Claiming release support from injected branches, cross-compilation, a manifest hash alone, or a Windows-only run.

## Decisions

### 1. Keep the opaque ProcessScope boundary and deepen its close semantics

`ProcessRef` remains the sole control capability passed to Session host and the backend adapter. PID, PGID, controller identity, supervisor identity, pidfd, Job handle, and native birth data remain private to ProcessCapsule. The host may display a PID but never supplies it to inspect or terminate.

The current `LiveProcessScope.closed` conflates a backend-root event with whole-scope close. It will instead settle successfully only from a native `SCOPE_EMPTY` terminal receipt. A backend-root exit becomes a distinct `ROOT_EXIT` event carrying the backend status; it may end the protocol turn, but it does not clear the scope capability. Controller/control-pipe loss before `SCOPE_EMPTY` rejects or settles as typed uncertainty and leaves `runtimeRef`, the writer claim, and the retained local controller/prepared reference available for reconciliation.

The state machine is:

```text
PREPARING
  -> PREPARED_INERT
       -> ACTIVATING
            -> LIVE_ROOT
                 -> LIVE_DESCENDANTS_ONLY   (ROOT_EXIT, scope non-empty)
                 -> TERMINATING
            -> CONTROL_UNCERTAIN            (activation deadline/control loss)
       -> ABORTING
            -> SCOPE_EMPTY
            -> CONTROL_UNCERTAIN             (abort deadline/control loss)

LIVE_ROOT | LIVE_DESCENDANTS_ONLY | CONTROL_UNCERTAIN
  -> TERMINATING -> SCOPE_EMPTY | TERMINATION_UNCERTAIN
```

Only `SCOPE_EMPTY` authorizes host detachment, registry `process` removal, writer-claim release, restart, capacity release, or a clean shutdown claim. `ROOT_EXIT`, controller exit, a closed pipe, timeout, `foreign`, and `uncertain` never do.

Alternative considered: make Claude transport independently poll `inspect(ref)` after every root exit. Rejected because each backend would reproduce authority ordering and a polling race could still let shallow callers treat a protocol close as scope close. Scope-empty belongs to ProcessScope once, below every backend.

### 2. Extend the existing native controller protocol instead of adding a second broker

Two material repair paths were compared:

| Path | Shape | Advantages | Costs and risks |
| --- | --- | --- | --- |
| A: extend ProcessCapsule | Add explicit root-exit/scope-empty receipts, persist controller+supervisor+group identity in the opaque ref, and let one-shot replacement control validate and reap that exact scope | Smallest ownership change; preserves the reviewed opaque seam, package, registry v2, Windows topology, and existing tests | Requires careful POSIX reserved-group and PID-reuse discrimination; native protocol version must change atomically |
| B: new resident broker / privileged OS containment service | Move all scopes into a separate service using Linux cgroups/subreaping and a macOS service-specific containment model | Strong central inventory and richer future policy | New daemon, permissions, install lifecycle, authentication, migration, and release dependency; macOS has no equivalent unprivileged cgroup primitive; much larger than the residual ECP-7 fault domain |

Select Path A. One native controller already owns the lifecycle. Protocol v2 will name root exit and exact scope-empty separately and encode all replacement authority inside the integrity-verified helper's opaque ref. Session host continues to call only `prepare`, `inspect`, and `terminate`.

The Windows implementation keeps the current unnamed Job, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, suspended Job-at-create, explicit inherited-handle list, and unique non-inherited controller ownership. The existing duplicate-handle and early-activation mutation modes remain mandatory discriminators. No daemon-held Job handle is introduced.

Alternative considered: retain protocol v1 and reinterpret `EXIT` by polling. Rejected because old and new binaries could disagree on the only terminal signal. Helper protocol and manifest capability must fail exact-match when the semantics change.

### 3. Correct macOS birth identity with the complete ABI and explicit capability failure

The macOS adapter will use a complete `#[repr(C)]` declaration generated from or checked against the pinned XNU `proc_uniqidentifierinfo` layout, including both trailing 64-bit reserve fields. Compile-time size and alignment assertions require 56 bytes before a macOS artifact can build. `proc_pidinfo` must return the full size and a non-zero unique id; otherwise prepare/inspect is `process-authority-uncertain` or `containment-unsupported` and no signal is authorized.

Two implementation routes are acceptable at coding time, in order of preference:

1. a committed generated binding with its XNU header/version provenance and a size assertion; or
2. a minimal source declaration containing the complete fields plus the same compile-time assertion and a link-level `proc_pidinfo` declaration.

ECP-7 implementation closure is established by the complete sourced ABI declaration, compile-time size/alignment assertions, deterministic foreign/unavailable discriminators, `aarch64-apple-darwin` cross-target build, and fresh independent source/spec/security review. These gates can close the S1 code/spec Major, but they do not prove macOS runtime behavior. ECP-8 must run the same-second collision, exact same-process, same-PID/different-birth zero-signal, and unavailable-source fail-closed oracles on actual macOS before the release may claim macOS support.

Alternative considered: fall back to microsecond BSD birth time or `ps lstart`. Rejected for this closure because the selected contract is kernel unique birth, and a fallback would reopen the signal-authority ambiguity.

### 4. Make POSIX replacement cleanup an exact controller-plus-supervisor operation

The opaque native ref will continue to carry an exact controller birth identity and will also bind the supervisor PID, exact native supervisor birth identity, and its reserved process-group id. On Linux the replacement helper opens/revalidates pidfds where available; on macOS it re-reads the corrected kernel unique id immediately before control. A different birth identity is `foreign` and produces zero signal.

For a positively identified old scope:

1. inspect the controller identity; if it is still exact, ask/terminate it through the platform-exact path;
2. validate the supervisor identity and reserved group relationship before group signalling;
3. if the supervisor leader exited but its group remains, treat the group id as reserved by the surviving old members, while checking immediately before each signal that no different-birth leader now owns the id;
4. send graceful then forced group signals under bounded deadlines;
5. report `closed` only after both controller and group are absent; identity drift or unobservable membership reports `foreign`/`uncertain` and retains authority.

This covers controller death, daemon replacement, root exit, resistant descendants, and PID reuse without exposing negative-PGID control to TypeScript. ECP-7 closes the implementation contract through deterministic adapter/protocol discriminators, source inspection, cross-target builds, current-host Windows topology oracles, and independent review. ECP-8 must then run the platform-gated Linux and macOS oracles that kill the controller/daemon, retain a resistant descendant, run replacement terminate, and prove both zero-signal foreign mutation and exact group cleanup.

Alternative considered: signal only the surviving supervisor. Rejected because descendants can outlive that process. Alternative considered: signal the group after checking only a numeric PGID. Rejected because an empty group id can later be reused.

### 5. Give every post-PREPARED control a shared bounded deadline and typed uncertainty

One internal control helper will race each expected acknowledgement against `controlTimeoutMs`, controller error/close, and cancellation. It covers PREPARE, ACTIVATE, prepared ABORT, live TERMINATE, INSPECT, and scope-empty observation; each timer is cleared exactly once.

ACTIVATE timeout returns a new typed `process-control-timeout` error with phase `activate`; the caller cannot know whether activation occurred, so it retains the published `runtimeRef` and claim. Prepared abort timeout returns a `TerminationReceipt` with `state: 'uncertain'`, phase `abort`, and `process-control-timeout`; it never reports closed. A later inspect/terminate or next-start reconciliation uses the same ref. Host mapping preserves a typed interrupted/busy outcome and never turns uncertainty into ordinary backend failure.

The deterministic adapter gains hung-controller modes for activation and abort. Tests use small injected deadlines and assert bounded settlement, one outcome, no duplicate activation/termination, and durable authority retention.

Alternative considered: kill the controller when an acknowledgement times out and assume Windows Job cleanup. Rejected because POSIX controller death is not itself scope closure and because a lost acknowledgement cannot distinguish "not executed" from "executed but unobserved."

### 6. Narrow provenance to artifact integrity unless reproducibility is actually proved

Two repair options were evaluated:

- enforce reproducible bytes with pinned compiler/linker flags, path remapping, stable build roots, timestamps/build-id controls, and a two-clean-build equality gate on every release OS;
- state the smaller truth: the manifest binds this adjacent artifact to platform, architecture, protocol, length, SHA-256, compiler string, and source digest, but does not claim a source-identical rebuild must reproduce the same bytes.

Select the second option for this Change. Byte reproducibility is not required for runtime containment, and forcing undocumented platform linker behavior would enlarge the fault domain. The build/test contract still performs two isolated clean builds. If bytes differ, the gate confirms that all authoritative proposal/design/spec/docs/manifest fields describe per-artifact integrity and input provenance rather than deterministic rebuild provenance. If future release tooling makes every platform byte-identical, that stronger property may be added in a later explicit Change.

The manifest remains closed-schema, adjacent-only, regular-file/no-symlink, exact protocol/platform/architecture/length/hash/capability checked. Runtime build, download, PATH lookup, shell, PowerShell, and weak helper fallback remain forbidden.

### 7. Separate ECP-7 implementation closure from ECP-8 platform acceptance

This child may reach local review-clean when every S1-S5 implementation contract is present and a fresh non-author review confirms no remaining code/spec/security Blocker or Major using: real current-host Windows controller/root/descendant oracles; deterministic ProcessScope and native-protocol fault discriminators; sourced macOS ABI/layout assertions; Linux/macOS cross-target builds; focused/static/package/migration gates; and truthful evidence labelling. This closes the implementation fault domain without turning a cross-target build into an actual Linux/macOS runtime pass.

Linux/macOS runtime remains a mandatory ECP-8 platform acceptance and release gate because ECP-8 alone creates the clean delivery branch, pushes the unique PR, and can run the real three-OS CI matrix. Until those jobs execute successfully, the release evidence must say Linux/macOS runtime is unverified and Rasen must not claim corresponding runtime support. If an actual Linux or macOS oracle fails, ECP-8 fails, the release stays blocked, and the concrete defect routes back for repair; it is never waived as a platform exception.

The child therefore records exact platform-gated test names/commands and expected receipts as durable release obligations, then may local-ship/archive without push or PR after its implementation review is clean. ECP-8 consumes and executes those obligations rather than inventing a different matrix.

## Risks / Trade-offs

- **[POSIX group identity changes between probe and signal]** -> Keep controller and supervisor birth identity in the opaque ref, use pidfd where the OS provides it, revalidate immediately around each group operation, require real PID-reuse mutations, and return uncertainty instead of signalling on any drift.
- **[Root exit with noisy or long-lived descendants keeps a Session non-terminal]** -> Expose typed root-exited/scope-live diagnostics and allow exact terminate; correctness deliberately outweighs optimistic cleanup.
- **[Control deadline fires after the controller acted]** -> Treat timeout as an unknown outcome, retain authority, and reconcile by exact ref; never retry activation automatically.
- **[Protocol v2 helper and TypeScript client are mixed]** -> Exact manifest protocol/capability matching rejects the pair before launch; no compatibility guessing.
- **[Committed macOS binding drifts from XNU]** -> Record source provenance, assert layout at compile time, independently review it, and make the actual macOS runtime oracle a mandatory ECP-8 acceptance gate.
- **[Narrow provenance is less ambitious than reproducible builds]** -> State it consistently and test two clean builds; runtime artifact integrity and release evidence remain exact.
- **[No child-local Linux/macOS runner]** -> Close only the implementation/code-spec verdict, record exact unexecuted runtime obligations, forbid platform-support claims, and require ECP-8 to fail the release if either real-OS gate fails.

## Migration Plan

1. Add RED discriminators for S1-S5 while retaining the current green Windows Job and migration mutation tests.
2. Rev the private helper protocol/manifest capability for root-exit versus scope-empty and typed control outcomes; update native helper, resolver, and ProcessScope client atomically.
3. Correct macOS ABI/binding and implement exact POSIX controller+supervisor/group replacement control.
4. Update the smallest backend/host close observer so only scope-empty releases registry and writer authority; keep registry schema v2 unless the opaque ref encoding requires an internal version that old helpers reject.
5. Narrow package provenance text and manifest semantics, run the two-clean-build discriminator, and keep adjacent integrity enforcement.
6. Run focused/static/package/native gates, current-host Windows real-process oracles, deterministic platform discriminators and Linux/macOS cross-target builds; then obtain fresh independent security plus code/spec review and record exact ECP-8 real-OS obligations.
7. After review-clean, local ship and archive only. The original host child is then explicitly replanned and freshly reverified by the LEAD; this Change does not mark it delivered.

Rollback is fail-closed. An older helper/client pair rejects the new protocol/capability. Existing registry v2 bytes and opaque refs remain preserved; a binary unable to interpret a ref cannot mutate or clear it. Operators return to the matching upgraded binary to inspect/terminate the retained scope. No project, Action, Run, EvidenceStore, or UI data migration occurs.

## Architecture replan after review round 1 (2026-08-04)

Decisions 2 and 4 above, and every later risk/migration statement that treats a POSIX process group as the exact authority, are **superseded**. They remain in this document only as provenance for the implementation and failed review. `setsid()`/`setpgid()` is a real escape oracle, not a PID-reuse edge case that can be repaired with more birth checks.

Two complete replacements were evaluated in [`evidence/architecture-replan.md`](./evidence/architecture-replan.md): native OS authorities with an installed broker fallback, and a macOS VM authority combined with native Windows/Linux authorities. That comparison is research evidence, not an accepted macOS design. Windows Job and the Linux user+PID namespace/authenticated-broker direction can proceed behind a platform-neutral seam; neither macOS 27 Endpoint Security nor the VM path is selected.

The design boundary moves into four prerequisite Changes. `ecp-platform-process-authority-foundation` owns only the common `ProcessAuthorityProvider`, versioned opaque-reference envelope, provider dispatch, bounded lifecycle and typed uncertainty contract. Separate Linux and Windows provider Changes own their OS implementations and real oracles after the common contract freezes. `ecp-macos-process-authority-provider` remains decision-gated and non-runnable until a later Direction decision chooses an architecture. This Change depends on all three providers and then resumes to integrate them with ProcessScope/host and close the still-open security and lifecycle findings. No PGID fallback is permitted.

## Open Questions

One material product decision remains open: choose the macOS authority and distribution contract. The owner has explicitly deferred that choice. The defer is not authorization for macOS 27 Beta `es_new_descendants_client`/`es_sync_client`, Endpoint Security entitlement, Developer ID signing/notarization, the VM program, silent unsupported status, or a support-matrix change. It blocks the macOS provider, this Change's final integration closure and ECP-8's three-OS release, but not the common foundation or the Linux/Windows provider work. Cross-target compilation remains non-runtime evidence.

## Decision-defer execution design (2026-08-04)

The safe execution graph separates platform-neutral contracts from platform policy:

```text
common foundation
  ├─> Linux provider ────┐
  ├─> Windows provider ──┼─> this integration closure
  └─> macOS provider ────┘    (decision-gated until a later owner decision)
```

The common foundation publishes no platform capability and contains no OS fallback. Its output is
a closed provider contract and dispatch seam against which platform adapters can be reviewed
independently. Linux and Windows may be implemented in parallel only after that seam is terminal.
The macOS placeholder cannot define acceptance or implementation before the future decision.

The current closure review history remains intact and non-runnable while providers are incomplete.
Once all three provider Changes are terminal, a LEAD replan resumes this Change with a fresh bounded
integration/re-review budget. It consumes the common/provider contracts, atomically revs the private
protocol/manifest as required, removes the PGID authority, and closes `SEC-001..003` plus
`RC-002..005`. Provider completion and closure review do not replace ECP-8's actual clean-branch
Windows/Linux/macOS acceptance matrix.
