## Context

ECP-7's architecture replan disproved POSIX process-group containment empirically: a workload leaves a PGID with `setsid()`/`setpgid()`. The correction is not a better sampler but a kernel-enforced recursive scope per platform. The archived `ecp-platform-process-authority-foundation` Change now supplies a manifest-bound `ProcessAuthorityProvider`, a sensitive versioned reference envelope, publish-before-activate coordination, typed retained failures, and one provider-neutral conformance suite. This Change implements the Windows authority behind that frozen boundary; it does not change the common contract.

Windows already has the right primitive. A Job Object is a kernel container: every process created by a member is automatically a member, and membership cannot be renounced from inside unless the Job itself permits breakaway. The legacy cross-platform helper at `native/process-capsule/src/main.rs:337-800` already creates an unnamed Job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assigns a supervisor at creation through `PROC_THREAD_ATTRIBUTE_JOB_LIST`, and restricts inherited handles; `src/core/session-host/process-capsule/resolver.ts:143` already requires an `unnamed-job-kill-on-close` capability on every `win32` artifact. What that helper does **not** have is the set of properties the frozen contract now demands: it never asserts that breakaway is disabled, it proves emptiness by polling `JOBOBJECT_BASIC_ACCOUNTING_INFORMATION.ActiveProcesses` on a 10 ms timer rather than from a complete event stream, it has no durable identity that a replacement controller can reopen, and it shares a protocol and manifest that still advertise the disproven `process-group` capability on other platforms. Reinterpreting it as exact authority would preserve a disproven claim and would mix platform implementation with the later atomic ProcessScope integration.

The Windows provider therefore needs an additive native seam and artifact identity, mirroring the Linux sibling's separation. The existing helper stays readable as migration input and remains legacy until `ecp-native-process-capsule-closure` removes or hard-disables it.

The frozen provider API intentionally has `prepare().activate()` but no provider-side publish hook. A native helper can prove only `inert`, not whether the common reference has been durably published. That matters in the crash windows after the publication record is committed and before its acknowledgement or the subsequent activation call. As on Linux, the design projects that durable common phase through the existing `publish(binding, context)` publisher seam and a concrete provider-owned ledger, without inventing a hidden `PUBLISH` frame and without treating `activate` as publication.

Direction source is `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/session-execution-and-self-hosting/`; `plan.md:291-292` assigns this Change the Job Object adapter, suspended assign-before-run, breakaway-disabled/last-handle invariants, and real Windows mutations, and `plan.md:262-266` names Windows breakaway/last-handle as gates that must survive. The controlling architecture evidence is `rasen/changes/ecp-native-process-capsule-closure/evidence/architecture-replan.md`; the common contract and its terminal evidence are archived under `rasen/changes/archive/2026-08-05-ecp-platform-process-authority-foundation/`.

The evidence environment is materially better than the Linux sibling's. The development host **is** Windows 11 x64, so every named actual-kernel oracle runs natively against the real kernel with no virtualization layer, no provisioned toolchain inside a guest, and no privileged installation. There is consequently **no environment-unavailability excuse for any Windows runtime gate in this Change**. The one honest asymmetry is architecture: Windows arm64 has no hardware here and stays cross-build evidence only.

This Change is also written against a specific failure record. `rasen/changes/ecp-linux-process-authority-provider/evidence/lead2-implementation-wave-findings.md` documents what went wrong on the sibling: a ~580-line real kernel-facing type with zero tests while every test drove a recording fixture (`F-L2-09`), a production assembly factory crossed by zero tests while its `...ForTesting` twin was exercised (`F-L2-11`), a Blocker that no test could ever have found and that surfaced only by running production code against the real kernel (`F-L2-10`), four guard tests in one wave that did not discriminate until someone mutated the product (`F-L2-13`), and two false "nothing changed" readings produced by equal artifact lengths and equal test counts (`F-L2-14`, `F-L2-07`). Several decisions below exist specifically to make those recurrences hard.

## Goals / Non-Goals

**Goals:**

- Implement a manifest-bound Windows provider that satisfies the accepted common contract without editing the common conformance suite.
- Make an unnamed, breakaway-disabled, kill-on-job-close Job Object the recursive authority, entered by the workload root before its first instruction executes.
- Make the Job's lifetime strictly bounded by the last open handle, held solely by a source-owned guardian, so no reachable state has a live scope with no controllable authority.
- Prove root exit and exact scope empty as different facts, including surviving detached descendants, nested Jobs, and processes created during teardown.
- Make abort, recursive terminate, guardian death, and replacement recovery exact or typed fail-closed; never infer authority from a parent/child snapshot, a toolhelp traversal, `taskkill /T`, WMI, or console control events.
- Bind every durable reference to sufficient Windows identity that process-id reuse, boot change, endpoint squatting, or guardian replacement can never become destructive authority.
- Preserve prepared-versus-published inert recovery across publication-acknowledgement crashes using an exact trusted durable ledger, without changing the frozen provider interface.
- Produce actual-Windows mutation receipts, each bound to the exact helper hash and crate source digest that produced it, and keep architecture, packaging, closure, and release claims separately gated.

**Non-Goals:**

- Do not select a macOS authority strategy or make any macOS support statement.
- Do not modify the frozen `process-authority-provider` capability, its main spec, or its shared conformance suite.
- Do not switch ProcessScope, SessionHost, or production defaults to this provider, and do not remove or hard-disable the legacy PGID path or the legacy capsule's Windows path in this Change. `ecp-native-process-capsule-closure` owns that atomic integration.
- Do not edit `native/linux-process-authority/**` or `rasen/changes/ecp-linux-process-authority-provider/**`. The Linux tree is frozen at sourceDigest `087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59`.
- Do not claim Windows arm64 runtime support, general Windows-edition support, install/packaging readiness, npm/release readiness, or ECP-8 completion.
- Do not solve remote/multi-host authority, and do not migrate existing legacy ProcessRefs into strong provider references.

## Decisions

### 1. Add a Windows-only provider helper instead of extending the legacy ProcessCapsule authority mode

Create a sibling source-owned Rust crate, `native/windows-process-authority`, with a closed Windows-only protocol and separate helper and guardian entry points. A TypeScript provider adapter under `src/core/session-host/process-authority/windows/` resolves the adjacent helper, implements the frozen provider interface, and exposes the provider-backed runtime opener the existing ProcessScope adapter needs. The artifact is built only for Windows x64/arm64 and does not share the legacy ProcessCapsule v2 reference, protocol, or claim identifiers.

The common provider manifest gains exactly one Windows selection: `rasen.windows.job-object` / `rasen-recursive-process-scope/1` / protocol `1`, common-contract version `1`, provider-reference version `1`. Unlike Linux, Windows needs **no second privileged provider**: Job Object creation, breakaway control, completion-port association, and `TerminateJobObject` are all available to an ordinary interactive user token, so there is no policy-disabled configuration that a broker would rescue. A separate closed native-artifact manifest binds platform, architecture, helper path, byte length, SHA-256, compiler, crate source digest, protocol, and declared mode; the common manifest points `artifactPath` at that exact artifact and is otherwise unchanged.

The crate takes **no external dependencies**. Windows ABI access is hand-declared `extern "system"` against `kernel32`, `advapi32`, and `ntdll`, following the legacy helper's existing precedent (`native/process-capsule/src/main.rs:464-540`). This keeps the supply chain empty and the provenance trivially auditable, but it moves the burden onto verification: every hand-declared signature, struct layout, and constant is a place where a silent ABI mistake can pass all fixture tests. The acceptance therefore requires that **every declared foreign item is exercised by a real call against the real kernel**, and that no struct used across the FFI boundary is accepted on the basis of a fixture round-trip alone. This is the direct answer to `F-L2-09`.

Alternative: add a Windows authority mode to `native/process-capsule/src/main.rs`. Rejected because it couples new authority to a protocol and manifest that still advertise `process-group` on Linux and macOS, makes platform acceptance impossible to isolate, and overlaps closure-owned production integration and removal.

Alternative: depend on `windows-sys`/`windows` crates. Rejected for this Change because it adds a large generated dependency surface to a security-critical minimal artifact, and because a generated binding would weaken rather than strengthen the "every declared item is proven against the real kernel" obligation that `F-L2-09` demands.

### 2. The authority is one unnamed Job Object whose limit flags are asserted, not assumed

Prepare creates the Job with `CreateJobObjectW(NULL, NULL)` — unnamed, so there is no kernel-namespace name to squat and no pre-existing object to hijack — and sets exactly one extended limit mask:

- `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` set;
- `JOB_OBJECT_LIMIT_BREAKAWAY_OK` clear;
- `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK` clear;
- every other limit clear.

`SetInformationJobObject` succeeding is not evidence. The preparer immediately reads the mask back with `QueryInformationJobObject(JobObjectExtendedLimitInformation)` and requires bit-exact equality with the expected mask, and it records the observed mask in the prepare attestation so a later reviewer can see the actual value rather than the intended one. Any difference is a typed prepare failure, not a warning.

With breakaway cleared, a member that calls `CreateProcessW` with `CREATE_BREAKAWAY_FROM_JOB` fails with `ERROR_ACCESS_DENIED` and no process is created; with silent breakaway cleared, no child is quietly created outside the Job. `DETACHED_PROCESS`, `CREATE_NEW_CONSOLE`, `CREATE_NEW_PROCESS_GROUP`, `setsid`-equivalent console detachment, and double-forking through an intermediate process do not affect Job membership at all — membership is inherited at process creation by the kernel and is not a property of the console, the session, or the parent link.

Nested Jobs (Windows 8+) do not create an escape either: a member may create its own Job and assign descendants to it, but the nested Job is a child of ours, the effective limits are the intersection, `IsProcessInJob(descendant, ourJob)` remains true, and `TerminateJobObject(ourJob)` terminates the hierarchy. This is a claim the acceptance must demonstrate on the real kernel, not assert from documentation.

Alternative: a named Job Object so a replacement can reopen it by name. Rejected: a name is squattable, is a cross-session collision surface, and would make the reference's authority a string rather than a proven handle. The durable identity problem is solved by the guardian instead (Decision 4).

### 3. Suspended assign-before-run: the root enters the Job before it can execute

The workload root is created **by the guardian, at activation, in one `CreateProcessW` call** with:

- `CREATE_SUSPENDED`, so the initial thread never runs;
- `EXTENDED_STARTUPINFO_PRESENT` with `PROC_THREAD_ATTRIBUTE_JOB_LIST` naming the Job, so the kernel places the process in the Job **as part of process creation**, before any user-mode instruction — including `ntdll` loader initialization and any static-import `DLL_PROCESS_ATTACH` — can execute;
- `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` naming exactly the three standard I/O handles, so nothing else is inherited;
- `CREATE_NO_WINDOW`, a server-resolved absolute executable, an absolute working directory, and a fully materialised environment block. No PATH search, no shell, no caller-supplied handle, no caller-supplied Job or process id.

Only after `IsProcessInJob(rootHandle, jobHandle)` returns TRUE, the Job's limit mask has been re-read and still matches, and the completion port has delivered `JOB_OBJECT_MSG_NEW_PROCESS` for that exact process id, does the guardian call `ResumeThread`. If any of those checks fails, the guardian calls `TerminateProcess` on the still-suspended root and returns a typed failure: the workload has executed nothing.

Two orderings are load-bearing and both are asserted:

- **Job-list assignment before creation completes.** `AssignProcessToJobObject` after `CreateProcessW` would leave a window in which the process exists; even suspended, that is a weaker claim, and it is the classic Windows containment bug. `PROC_THREAD_ATTRIBUTE_JOB_LIST` removes the window entirely. `CREATE_SUSPENDED` is retained anyway as defence in depth and as the mechanism that makes activation a distinct, exactly-once act.

  **This is a deliberate divergence from the Direction plan's literal wording, and a reviewer comparing the two will see it.** `plan.md:291-292` assigns this Change "suspended assign-before-run", which reads as `CREATE_SUSPENDED` → `AssignProcessToJobObject` → `ResumeThread`. That sequence is the weaker form: the process object exists, unassigned, between the create and the assign. The design implements the stronger construction — membership applied *as part of* creation — and keeps suspension for the two reasons above. The plan's intent is satisfied; its call sequence is not reproduced. Recorded here so the divergence is visible in the artifact rather than only in a handoff message.
- **Completion-port association before the first member exists.** `JOBOBJECT_ASSOCIATE_COMPLETION_PORT` must be set on the empty Job during prepare. Associating after a member exists silently loses that member's `NEW_PROCESS` message and permanently corrupts the event stream the exact-empty oracle depends on. Prepare therefore associates the port while `ActiveProcesses == 0` and records that fact in the attestation.

**Prepare creates no workload process object at all.** The Job, the completion port, the private control endpoint, the guardian, the immutable launch snapshot, and the durable runtime root all exist and are proven at `prepared-inert`; the root does not. This keeps the frozen scenario "the workload has not started" literally true rather than argued.

Alternative: create the root suspended during prepare so that assignment is proven earlier. Rejected: it makes a suspended workload process object exist during `prepared-inert`, holds an image-section reference on the target executable across the whole publish window, and turns every prepare-abort path into a process-termination path — all for no additional containment, since `PROC_THREAD_ATTRIBUTE_JOB_LIST` already makes assignment atomic with creation whenever creation happens.

### 4. A guardian process holds the sole Job handle; that is the durable authority

Windows has no reopenable name for an unnamed Job, and `KILL_ON_JOB_CLOSE` means the Job dies when its last handle closes. A Node controller therefore cannot be the handle holder: its exit would destroy the scope, and no replacement could ever recover one. Conversely, dropping `KILL_ON_JOB_CLOSE` is worse — a Job whose last handle closes without that flag is destroyed while **its processes keep running**, producing exactly the orphaned, uncontainable scope this Change exists to prevent.

The resolution is a source-owned guardian process, created during prepare, that lives **outside** the Job and holds:

- the **only** handle to the Job, created non-inheritable, never duplicated, never placed in any `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`, and never sent across any endpoint;
- the completion port associated with that Job;
- the root process handle once activation has occurred;
- the private control endpoint and the durable event journal.

This yields the two properties the Direction plan names. **Last-handle:** if the guardian dies for any reason, its handles close, it was the sole holder, and the kernel terminates every Job member — a crashed or killed controller stack cannot leave a live uncontrolled scope. **Recoverability:** the guardian survives its controller, so a replacement controller can reopen the same authority.

The sole-handle property is an invariant, not an observation, and the acceptance must show it is load-bearing rather than incidental: the mutation duplicates the Job handle into a second process (the legacy helper already carries exactly this mutation switch at `native/process-capsule/src/main.rs:651,759-773`), kills the guardian, and must observe descendants **surviving**. A guard that cannot produce that RED is not evidence for the invariant.

The guardian is not the workload's parent in any authority-bearing sense; parentage is irrelevant to Job membership. It is the handle holder, the event-stream owner, and the identity anchor.

### 5. Durable reference identity binds the guardian, the endpoint, and the boot

The provider-private reference is a closed, length-bounded binary payload carried only inside the common sensitive envelope. Windows v1 contains:

- exact provider path discriminator and protocol/reference versions;
- native-generated random one-use scope id (which also names the control endpoint), common generation, and two independent 256-bit capabilities (scope and control). TypeScript validates and preserves those attested bytes and **never generates or backfills them**;
- preparation operation id and immutable launch-snapshot digest, used by the publication ledger;
- boot identity (below);
- guardian process id **and** its exact process creation `FILETIME` from `GetProcessTimes`, which is the Windows analogue of `/proc/<pid>/stat` start ticks and the mechanism that makes process-id reuse detectable;
- the expected owner SID of the control endpoint and of the trusted state root;
- the attested Job limit mask and the sole-handle attestation;
- native artifact source digest and helper protocol identity.

It never contains a Job handle, a raw handle value, an arbitrary executable path, or a caller-selected process id. Paths are derived from the provider's trusted state root plus the bounded scope id.

**Boot identity is required, not optional.** A reference that cannot be disambiguated across a reboot must never be minted, so if no exact boot-unique value can be obtained, prepare returns typed `authority-unavailable` before anything is created. The source is selected by a probe over an enumerated candidate list, in order: (a) `NtQuerySystemInformation(SystemBootEnvironmentInformation)` → `BootIdentifier` GUID; (b) the boot-scoped identity the implementation demonstrates to be exact and constant within a boot on this host. Values derived from tick arithmetic (`GetTickCount64`, unbiased interrupt time, or system-time subtraction) are explicitly rejected as inexact: sleep, hibernate, and clock adjustment move them. The selected source, and the fact that it was probed rather than assumed, is recorded in the prepare attestation.

Boot identity has an independent second proof that costs nothing: the control endpoint is a named pipe whose name embeds the 128-bit scope id, and the Windows object namespace does not survive a reboot. A prior-boot reference therefore finds no endpoint. **The two proofs are kept separate in the code and in the evidence so that neither silently substitutes for the other, and a later simplification that collapses them into one is a regression, not a cleanup.** They fail in different ways: the boot-identity value can be unobtainable on an edition where the candidate source is denied, while the endpoint proof can be defeated only by an attacker who already holds the scope id. Merging them would leave one failure mode silently uncovered.

**Decided by Direction (2026-08-07): the reboot-crossing receipt is routed to closure/ECP-8, not to this Change.** Within-boot exactness, the injected boot-drift mutation (task 8.13), and fail-closed unavailability when no source is obtainable (task 4.4) are all gated here. An actual receipt proving a prior-boot reference is rejected after a real reboot requires restarting the operator's machine, which will not be scheduled as a side effect of an implementation wave. Recorded here so a later reviewer reads the absence as a routing decision rather than an omission.

Alternative: bind only process id plus creation time. Rejected: creation time makes reuse *within* a boot detectable, but a prior-boot reference has no anchor at all, and "the timestamps would practically never collide" is exactly the class of probabilistic argument this Change family has been burned by.

### 6. The control endpoint is a squat-proof, impersonation-proof named pipe

Prepare creates a named pipe `\\.\pipe\rasen-wpa-<scope-id-hex>` with `FILE_FLAG_FIRST_PIPE_INSTANCE` (so an attacker cannot pre-create the name and receive our connections), `PIPE_REJECT_REMOTE_CLIENTS`, and an explicit DACL granting only the creating user's SID — no inherited ACEs, no `Everyone`, no `NULL` DACL. Creation failing because the name already exists is a typed prepare failure, never a reuse.

Clients connect with `SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION`, so a hostile pipe server cannot impersonate the connecting controller. Before sending anything, the client authenticates the server: `GetNamedPipeServerProcessId` must return the referenced guardian process id; `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE)` on that id must succeed and `GetProcessTimes` must return the exact recorded creation `FILETIME`; the pipe's owner SID from `GetSecurityInfo` must equal the recorded owner SID. The guardian authenticates the client symmetrically with `GetNamedPipeClientProcessId` and an impersonated token SID check, and additionally requires the control capability from the reference. A pipe name, a process id, or a successful connection alone is never identity.

The private reference, the capabilities, and the endpoint path are never logged, never placed in argv or environment, and never written to project files. Diagnostics use the common redacted tuple plus a one-way reference digest and non-secret state codes.

### 7. Exact empty comes from the completion port; root exit comes from the root handle

These are two different oracles reading two different objects, and the design keeps them apart on purpose.

**Root exit.** The guardian waits on the root process handle. Only after `WaitForSingleObject` returns `WAIT_OBJECT_0` does it call `GetExitCodeProcess`. The ordering matters: `GetExitCodeProcess` returns `STILL_ACTIVE` (259) for a running process, and a process that legitimately exits with code 259 is indistinguishable from a running one if the exit code is read without a completed wait. That is a real, classic Windows defect and the acceptance treats it as a first-class oracle.

The exit status is a `DWORD`. It is carried to the common contract as an **unsigned** number: `0xC0000005` must arrive as `3221225477`, not as `-1073741819`, and not truncated. Windows has no signals, so the provider always emits the `{ code: number, signal: null }` branch of the frozen `root-exited` union and **never synthesizes a signal name** — not for `TerminateJobObject` kills, not for `0xC000013A` (Ctrl-C), not for access violations. A helper result carrying both branches, neither branch, or a sign-extended code is rejected as `control-loss`; the provider does not repair it.

Root exit is recorded exactly once and does **not** imply emptiness. Descendants created by the root, detached descendants, and members of nested Jobs all keep the scope live.

**Exact empty.** The Job's completion port carries a message sequence: `JOB_OBJECT_MSG_NEW_PROCESS` per member, `JOB_OBJECT_MSG_EXIT_PROCESS` / `JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS` per departure, and `JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO` when the Job becomes empty. `exact-scope-empty` is emitted **only** on `ACTIVE_PROCESS_ZERO` with a complete, monotonically-sequenced message history for that Job. A `QueryInformationJobObject` accounting read is permitted only as corroboration recorded alongside the event, never as the oracle: the legacy helper's 10 ms `ActiveProcesses == 0` poll (`native/process-capsule/src/main.rs:596-618`) is precisely the sampled evidence the frozen contract's `event-completeness` semantic forbids. A missing, duplicated, reordered, or unexplained message makes the observation `event-gap`; a broken port or dead guardian makes it `control-loss`; neither is ever rewritten as empty.

`ActiveProcesses` and `TotalProcesses` are different fields with different meanings and the corroboration must read the former; reading the latter would report a long-finished scope as populated forever.

The guardian emits `prepared`, `activated`, `root-exited`, and `exact-scope-empty` into a monotonic, closed-vocabulary journal, flushes its terminal record durably before exiting, and only then exits — closing the last Job handle after the Job is already empty.

### 8. Abort and terminate act on the Job, and converge under a create storm

Prepared or published **abort** never resumes the root — there is no root — and destroys the authority by terminating the Job and then closing it. Because prepare created no workload process, an abort receipt is an exact-empty receipt as soon as the port reports `ACTIVE_PROCESS_ZERO` for a Job that never had a member, or immediately from the attested never-activated state; the workload command remains unexecuted.

Activated **terminate** may, when `intent.graceMs > 0`, perform one bounded best-effort graceful step: close the root's standard input and wait up to `graceMs` for the port to report `ACTIVE_PROCESS_ZERO` naturally. Graceful delivery is explicitly **not authoritative** and cannot produce an empty receipt by itself. Windows has no `SIGTERM`; `GenerateConsoleCtrlEvent` requires a shared console and a process group, which is the very mechanism ECP-7 disproved, and window messages only reach GUI applications. Neither is used.

The exact operation is `TerminateJobObject`, followed by convergence on `ACTIVE_PROCESS_ZERO`. A member that had already called `CreateProcessW` when the sweep ran can produce a `NEW_PROCESS` message after the terminate; the guardian therefore runs a **bounded re-terminate loop** — on any `NEW_PROCESS` observed after a terminate request, re-issue `TerminateJobObject` — until `ACTIVE_PROCESS_ZERO` arrives or the common deadline expires. Deadline expiry returns `timeout` for the exact phase with authority retained; it never returns empty. Individual descendant process ids are never enumerated and never signalled. Repeated terminate/abort is idempotent through the common generation/tombstone contract plus the guardian's terminal record.

Every destructive control is preceded by the full reopen-and-revalidate sequence of Decision 9.

### 9. Replacement recovery revalidates before it observes, and again after every handle opens

To inspect or control after replacement, the provider, in this order: decodes and bounds-checks the envelope and private reference; verifies the provider tuple and reference version; verifies current boot identity against the bound value; derives the endpoint path from the trusted root and the bound scope id (never from a path in the reference); opens the guardian with `OpenProcess`; reads its creation `FILETIME`; connects the pipe with `SECURITY_IDENTIFICATION`; verifies `GetNamedPipeServerProcessId` and the pipe owner SID; and **then re-reads process id, creation time, server process id, and owner SID again after every handle is open** and requires the complete tuple to be unchanged. Only that exact stable tuple may authenticate the control capability, and only an authenticated endpoint may observe or control. This closes the TOCTOU window in which the referenced process exits between lookup and use and a new process takes its id.

The distinct states are kept distinct and none of them is allowed to collapse into another:

| Observation | Classification |
| --- | --- |
| Guardian alive, full tuple stable, endpoint authenticated | proceed to observe/control |
| Guardian process id absent, endpoint absent, boot unchanged, durable terminal record present and exact | `exact-scope-empty` from the record |
| Guardian process id absent, endpoint absent, boot unchanged, no terminal record | `exact-scope-empty` only from the last-handle rule with the sole-handle attestation present; otherwise `authority-uncertain` |
| Guardian process id present but creation time differs | `identity-drift`, no control issued |
| Endpoint present but server process id or owner SID differs | `identity-drift`, no control issued |
| Boot identity differs | `identity-drift` or `authority-unavailable`, never a matching-id match |
| Endpoint present, authentication fails or capability rejected | `control-loss` |
| Any handle opens then the re-read tuple differs | `identity-drift`, no control issued |
| Envelope/reference malformed, out of bounds, or future-versioned | fail closed before any native call; reference bytes preserved |

The second row's dependence on the sole-handle attestation is deliberate and is why Decision 4's mutation matters: the "guardian died therefore the kernel emptied the Job" inference is sound **only** because the guardian held the last handle. If that invariant were ever broken, the inference would silently fabricate exact-empty receipts for live workloads. The acceptance requires the RED demonstration.

### 10. A trusted durable publication ledger projects the common inert phase

This mirrors the archived foundation's ledger option rather than amending the frozen provider interface. The Windows provider bundle supplies a concrete `WindowsAuthorityPublicationLedger` and the matching publisher callback for the existing common `publish(binding, context)` seam. The publisher validates the exact binding, atomically commits the canonical record, and only then returns the acknowledgement. The record binds the full reference digest, preparation operation id, publication version, provider tuple and reference generation, and the immutable launch-snapshot digest.

Durability on Windows is written out explicitly because it is not the POSIX recipe: write the record to a temporary file in the same directory, `FlushFileBuffers` the file handle, `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` over the target, then `FlushFileBuffers` a directory handle opened with `FILE_FLAG_BACKUP_SEMANTICS`. The state root lives under the trusted provider/host state root, not under the workload's working directory, is not inherited, is not exposed through argv or environment, carries an owner-only DACL with inheritance disabled, and is rejected if any component is a reparse point or if the owner SID differs from the expected one — the Windows analogue of the Linux symlink/ownership checks.

The provider reconstructs the canonical full-reference digest from the descriptor plus private reference (the common encoding is canonical and deterministic), then queries the exact record:

- native `inert` plus no record → `prepared-inert`;
- native `inert` plus exactly one exact durable record → `published-inert`;
- unavailable, malformed, conflicting, wrong-generation, wrong-operation, or wrong-launch ledger state → retained `authority-uncertain`, `event-gap`, or `control-loss`.

`ProviderPreparedAuthority.activate()` verifies the exact durable record **before** it tells the guardian to create and resume the root. It writes no publication state, and the helper protocol has no `PUBLISH` frame. A crash after commit but before acknowledgement, or after acknowledgement but before activate, still yields `published-inert` on replacement inspection; the recovery owner reconciles or aborts rather than silently activating.

### 11. Availability is decided by a complete construction rehearsal, never by a single probe

The provider's availability decision is made by performing the entire prepare construction — Job creation, exact limit mask set and read back, completion-port association on an empty Job, boot-identity acquisition, trusted state root validation, first-instance named pipe creation with its DACL, guardian launch, and guardian attestation — and returning typed `authority-unavailable` if any step is denied or unsupported. No workload code runs on any failure path, and every partial object is closed and every partial process terminated and waited before the failure returns.

The known Windows unavailability causes are enumerated rather than discovered: the host process is already inside an ambient Job that refuses nesting, so `CreateProcessW` with `PROC_THREAD_ATTRIBUTE_JOB_LIST` fails with `ERROR_ACCESS_DENIED`; Job Object creation is denied by policy or token restriction; completion-port association is unavailable; the boot-identity source is unobtainable; the pipe name cannot be created as a first instance; the trusted state root is missing, wrongly owned, or reparse-pointed; the resolved artifact fails its manifest identity check. `IsProcessInJob(GetCurrentProcess(), NULL, ...)` is used to *record* ambient-Job membership in diagnostics, but membership by itself is not an unavailability verdict — nested Jobs are supported and the only honest test is the real construction.

This decision is written against `F-L2-05`'s failure mode on the sibling, where two opposite environment verdicts were issued from narrow probes. Any availability verdict in this Change's evidence must enumerate the entry points it tried and cite the consuming code's fail-closed path, not design prose.

Unavailability never selects another provider, never falls back to a process group, a toolhelp snapshot, `taskkill`, WMI, or the legacy capsule helper, and never starts workload code.

### 12. Verification is designed against the sibling's failure record

Six obligations are structural, not stylistic, and they are carried into `tasks.md` as explicit requirements rather than left to reviewer discretion.

1. **No fixture-only acceptance path.** Every production type that faces the kernel — the Job authority, the completion-port reader, the guardian, the pipe transport, the process-identity reader, the ledger — must be exercised by tests that run it against the real Windows kernel. A recording or in-memory stand-in may exist for fault injection, but no acceptance row may rest on one alone, and the acceptance must state, per module, which tests cross the production entry point. `F-L2-09` and `F-L2-11` were both invisible for months precisely because that statement was never required.
2. **Production entry points, not `...ForTesting` twins.** The TypeScript production assembly factory must be crossed by real tests. Where a testing variant exists, the delta between it and production must be named, bounded, and itself covered.
3. **RED before GREEN, per significant oracle.** Every oracle in the acceptance list must be demonstrated to fail against a deliberately broken product — breakaway enabled, sole handle duplicated, completion port associated late, exit code read before the wait completes, exit code sign-extended, re-read skipped after handle open. A green assertion with no RED demonstration is treated as non-discriminating (`F-L2-13`, four instances in one sibling wave).
4. **One task exists solely to run production code against the real kernel** with no test harness in the loop, because that is how the sibling's Blocker was actually found (`F-L2-10`) and no test would have found it.
5. **Receipts are bound to a source digest.** Every runtime receipt records the helper SHA-256 and the crate source digest that produced it. Artifact byte length is explicitly not a change signal — the sibling produced two byte-different builds of identical length (`F-L2-14`). Test counts must state asserting tests separately from headline counts, because gated fixture entrypoints inflate the headline (`F-L2-07`). The build script's source digest must follow the existing convention including the trailing NUL per file (`scripts/build-linux-process-authority.mjs:115`); a recomputation that omits it will disagree with the build.
6. **Current behaviour is never asserted as correct behaviour.** Where an oracle records what the system does, the acceptance must separately state what the contract requires and show the assertion discriminates between them.

The provider's conformance fixture imports `test/helpers/process-authority-provider-conformance.ts` unchanged, supplies the concrete durable publisher required by the archived "fixture's real publication boundary" requirement, and keeps all Windows-specific fault injection outside both the shared suite and the production factory. A hash assertion guards the shared suite and the main `process-authority-provider` spec against accidental edits during this Change.

### 13. Containment has one honest boundary, and it is evidence, not prose

A Job Object contains every process the workload creates, directly or transitively. It does **not** contain work a pre-existing out-of-Job service performs on the workload's behalf: a member that asks Task Scheduler, WMI `Win32_Process.Create`, the Service Control Manager, or a DCOM launcher to start a process gets a process parented by that service, outside the Job. The same class of hole exists on Linux via a reachable service socket; neither provider closes it, and closing it needs a different mechanism (restricted tokens, AppContainer, or endpoint denial) than recursive scoping.

This Change states that boundary explicitly, requires an oracle that **demonstrates** it on the real kernel rather than describing it, and requires that the demonstrated escape does not corrupt any authority claim: the proxied process is outside the authority, the provider must not count it, and `exact-scope-empty` for the Job must remain exact for what the Job actually contains. Whether the frozen `workload-non-escape` semantic should be tightened to cover proxied creation is a Direction question, recorded in Open Questions, not resolved here.

### 14. Evidence is partitioned by what the environment can actually prove

Four evidence classes are recorded independently:

1. Platform-neutral TypeScript unit/manifest/protocol/codec evidence and cross-target compilation. Shape and buildability only.
2. **Actual Windows x64 runtime receipts on this host's real kernel.** Breakaway, detached/double-fork descendants, nested Jobs, suspended assign-before-run, completion-port ordering, guardian death under the last-handle rule, sole-handle mutation, root exit distinction and exit-code fidelity, natural empty, recursive kill under a create storm, prepared/published abort, replacement recovery, identity drift, and unavailable configurations. **No task in this class may be closed on environment-unavailability grounds** — the environment is present.
3. Windows arm64 cross-build and package-shape evidence, explicitly labelled non-runtime.
4. Clean distribution/install/package matrix and ECP-8 release receipts. Later gates, never inferred from classes 1-3.

Each receipt records Windows build and edition, kernel version, Node and pnpm versions, rustc/cargo versions and target triple, the helper SHA-256, the crate source digest, and the exact command. Installing or building a toolchain is setup evidence, not a passing oracle. Any skipped actual-Windows test leaves its named acceptance gate open and the Change non-terminal.

## Risks / Trade-offs

- **[Risk] The guardian is a new long-lived process per authority.** → It is small, source-owned, dependency-free, holds no privilege beyond the caller's token, exits on exact empty, and its death is fail-safe by the last-handle rule rather than fail-open.
- **[Risk] The sole-handle invariant is invisible until it is broken, and breaking it silently converts uncertainty into fabricated exact-empty receipts.** → Make it an attested prepare fact, forbid duplication structurally, and require the duplicate-handle RED mutation as acceptance rather than an argument.
- **[Risk] Hand-declared FFI can be subtly wrong in struct layout or constant value and still pass every fixture test.** → Require every declared foreign item to be exercised by a real call, read back every value that was set, and record observed values in attestations so reviewers see actuals.
- **[Risk] Completion-port association ordering is easy to get wrong and the resulting event stream looks healthy.** → Associate on an empty Job during prepare, attest that fact, and make late association a demonstrated RED mutation rather than a code comment.
- **[Risk] `GetExitCodeProcess` before a completed wait silently reports a real exit code 259 as still-running.** → Wait first, then read; make code 259 a mandatory oracle.
- **[Risk] `TerminateJobObject` races processes created during its sweep.** → Bounded re-terminate loop driven by `NEW_PROCESS` messages, converging on `ACTIVE_PROCESS_ZERO`, with deadline expiry retained as `timeout` rather than reported as empty.
- **[Risk] Boot identity may have no exact, publicly documented source on every Windows edition.** → Probe an enumerated candidate list, reject tick arithmetic, fail closed with typed `authority-unavailable` rather than mint an undisambiguatable reference, and keep the pipe-namespace non-persistence proof independent.
- **[Risk] Proxied process creation through Task Scheduler/WMI/SCM/DCOM leaves the Job.** → State the boundary, demonstrate it, keep the exact-empty claim scoped to actual Job membership, and escalate the semantic question to Direction rather than redefining it here.
- **[Risk] Windows arm64 cannot be exercised.** → Keep it a separate evidence class, label cross-build results non-runtime, and leave the arm64 runtime gate explicitly open.
- **[Risk] The worktree contains concurrent unrelated changes and a frozen Linux tree.** → Touch only this Change's named files, use targeted status and diffs, never normalize other sessions' work, and never write under `native/linux-process-authority/**` or the Linux change directory.
- **[Trade-off] A second native helper duplicates framing, journal, and build code.** → The duplicate is bounded and preserves ownership: Windows authority evolves independently while closure integrates it later without carrying the legacy protocol forward.
- **[Trade-off] Prepare creates a guardian process before any workload is published.** → The cost is one small process per prepared authority; the benefit is that assignment, breakaway, port association, and endpoint identity are all proven before publication rather than during activation.

## Migration Plan

1. Add failing provider descriptor, private-reference codec, durable publication-ledger, artifact resolver, and shared-conformance fixture tests without registering any production default.
2. Add the source-owned Windows crate, the Job authority, the guardian, the completion-port reader, and the private endpoint; close the actual-Windows primary matrix on this host's real kernel.
3. Add replacement recovery, identity-drift, abort/terminate, and create-storm convergence; close their actual-kernel matrix including every RED mutation.
4. Add additive build/package/CI assembly, arm64 cross-build shape evidence, and verify legacy ProcessCapsule behaviour is unchanged in meaning. Do not rewrite existing legacy ProcessRefs or session registry entries.
5. Strictly verify this Change. Hand the exact provider tuple, manifest, runtime opener, evidence paths, and remaining gates to `ecp-native-process-capsule-closure`.
6. Rollback before closure is removal of the unregistered provider registration and artifacts; no production default or durable legacy state has changed. After closure selects it, rollback is closure-owned and must fail closed rather than revive a process-group claim.

## Open Questions

1. **Does the frozen `workload-non-escape` semantic cover proxied process creation?** OPEN, escalated. A Job Object (and a Linux PID namespace) contains what the workload creates, not what a pre-existing out-of-scope service creates on its behalf. Both platform providers have this boundary and neither closes it. Whether the common capability should narrow its wording, or a later Change should add token/AppContainer restriction, is a Direction and closure question. This Change documents and demonstrates the boundary (task 8.16) and makes no claim beyond actual Job membership.

   Tracked cross-platform as **`F-L2-17` (Major, contract-level)** in the Linux change's findings file. Note the asymmetry a reviewer must not misread: this Change requires the escape to be *demonstrated* on the real kernel, while the Linux sibling has no equivalent demonstration and adding one would break its freeze. The absence of Linux evidence is a freeze consequence, not a finding that Linux is unaffected.

2. **Which boot-identity source is authoritative on every supported Windows edition?** OPEN, but implementation-discovered rather than design-blocking: the probe order and the fail-closed behaviour are fixed by Decision 5, and task 4.4 records which source was selected and that it was probed rather than assumed. The receipt-routing half of this question is **resolved** — see Decision 5: the reboot-crossing receipt belongs to closure/ECP-8 by Direction decision of 2026-08-07.

macOS strategy, the final supported Windows edition/architecture matrix, and release activation remain explicit Direction/ECP-8 gates rather than implementation choices for this provider.
