# Section 9: oracle discrimination and the anti-vacuity gate

Date: 2026-08-07\
Author: implementer (Section 9), single leaf worker\
Host: Windows 11 Pro 10.0.26200, x64, native, no WSL\
Toolchain: `rustc 1.88.0 (6b00bc388 2025-06-23)` / `cargo 1.88.0 (873a06493 2025-05-10)`,
`x86_64-pc-windows-msvc`. Node `v24.14.0`.

Section 9's inline header is the standard everything below is held to: **every task produces a
RED/GREEN pair, and a green assertion with no demonstrated failing counterpart does not close its
gate.**

The headline result is not a count. It is that **three separate oracles that were already green
did not discriminate**, and one of them was the Section 8 gate row for the very defect it was
written to pin. Details in the row table and in `S9-F1`.

## Bindings, and one interruption that has to be stated first

Every kernel receipt below binds crate source\
`2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377`, and every row that executes a
binary additionally binds the **packaged** helper\
`2aebab6987f6b59b7ffef95d61681165082e9f5b039beb3a095ecc0260dd9cf0`, 258560 B, with guardian
`d571f148a96c9415859f2d7d16329bf86a7db009c5d7d396f2d7fab86a125f2f`, 254464 B.

`target/release/` was never used; it still holds the superseded pair embedding the dead
`b44c5e25`.

### The freeze was broken mid-section, deliberately and temporarily, and then restored

Task 9.6 cannot be answered without executing instrumentation inside the crate (see below). The
method was mutate to measure, then restore byte-exact. That cycle completed twice, and the
session was interrupted by an infrastructure fault during the third, leaving the instrumented
`src/sys.rs` in the tree. The LEAD committed that state as `beeee1b8` and stripped trailing
whitespace from it.

It has since been restored and re-measured:

```text
pristine src/sys.rs            26130 B  2690be0c82e90e56fee6177d53c10540133d0f8f853de22ea4bf292ebaa5a5a4
crate sourceSha256 after       2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377   <- the freeze
crate sourceSha256 while
  instrumented+stripped        523bb379c9820c843ec833cb374a398d38371e85eb47b8721de75ced77b361cc
```

**No receipt in this file is bound to an instrumented tree except the 9.6 coverage measurement,
which is labelled as such and is bound to nothing else.** The instrumentation is measurement
scaffolding: 56 forwarding wrappers and a file-writing recorder that takes a mutex inside calls
as ordinary as `CloseHandle`. It must not survive into the re-frozen source. The durable form is
the generator, which reproduces the instrumented tree from pristine source in one command.

### `S8-F2` reproduced a third time, during this session

`dist/native/win32-x64/` was **gone** when this section opened, and
`dist/core/session-host/process-authority/windows/build-authority.js` was back to the empty
placeholder. A concurrent TypeScript build at 17:44 wiped them, exactly as `S8-F2` predicts.
Every binary-executing row here therefore binds the retained snapshot at
`C:/Users/Sayo/AppData/Local/Temp/rasen-s8-artifacts`, verified byte-identical to the frozen
pair. This is the third recorded instance and the first that cost this section anything.

## Row-by-row verdicts

| Task | RED demonstrated | GREEN | Contract vs observed | Verdict |
| --- | --- | --- | --- | --- |
| 9.1 | `JOB_OBJECT_LIMIT_BREAKAWAY_OK` set: a genuine **descendant** creates a process that is **not** a member (`escaped=21876`, alive when asked) | same fixture, mask exact: `child-breakaway=refused os-error=5`, and the descendant itself **is** a member | contract: membership is inherited at creation and cannot be renounced from anywhere in the tree. Pre-existing oracle only had the **root** attempt it; the transitive claim rested on documentation | DONE |
| 9.2 | `guardian::red_duplicating_the_job_handle_lets_members_survive_the_guardian` -- corroboration withdrawn, root survives guardian death | `guardian::actual_guardian_death_destroys_the_authority_and_terminates_every_member` | contract: exact-empty by guardian absence is sound **only** under the sole-handle invariant. Pre-existing pair is genuinely discriminating; re-run and confirmed, not re-authored | DONE |
| 9.3 | `kernel::red_a_member_that_exits_before_the_port_is_associated_is_lost_and_empty_never_arrives` -- permanently silent stream | `kernel::actual_natural_empty_...` delivers `ACTIVE_PROCESS_ZERO` for the same workload | **contract text does not reproduce**: `design.md` Decision 3 says late association loses a live member's `NEW_PROCESS`; measured, the kernel announces live members at association time. The real loss is a member that *departed* first | DONE, with the design correction restated |
| 9.4 | wait-before-status: `kernel::red_reading_the_status_without_a_completed_wait_...`. Fidelity: sign-extended rendering `-1073741819`, 16-bit truncation `5`, short payload rejected, and all three illegal branch tags rejected | real kernel `exit /b -1073741819` -> `0xC0000005` -> `"3221225477"` through the production codec | contract: unsigned exact, null signal branch, both-or-neither is control-loss. The fidelity half previously had **no** failing counterpart | DONE |
| 9.5 | the cached tuple still reports the original identity in full after the target changed; the product's reread reports the change | healthy authority: reread equals the pre-open tuple | contract: the complete tuple is re-read through open handles and must be unchanged before any control. **Boundary found**: the reread proves identity, never liveness -- see `S9-F4` | DONE, boundary recorded |
| 9.6 | recorder defect 1 and defect 2 each produced a plausible wrong answer (53/56) that was falsified before it was reported | **56 of 56** declared foreign items called at least once against the real kernel, across 34 traced processes | contract (`design.md` Decision 1): every hand-declared item is exercised by a real call. Static census separately shows 0 dead declarations | DONE |
| 9.7 | -- (audit, not an oracle) | per-module table below | **the production TypeScript factory is crossed by three tests, every one of which asserts it does nothing** | DONE, exhaustive |
| 9.8 | -- | see the leg table below | the native legs run end to end; the TypeScript lifecycle leg is **structurally impossible** | PARTIAL -- see below |
| 9.9 | `windows_section8_gate.rs:827` demonstrated non-discriminating **and unstable** | rewrite list below | -- | DONE |
| 9.10 | -- | counts below | -- | DONE |

## 9.6 -- every declared foreign item, and the two ways the measurement lied first

`self-identity` reports `declaredForeignItems 56`. The pre-existing suite test
`every_declared_foreign_item_that_this_suite_reaches_is_named_in_the_declared_list` compares
names against a list; it is a **naming** guard and proves no execution.

**Static half, exhaustive.** All 56 declarations parsed out of `src/sys.rs` and every call site
enumerated across `src/**` and `tests/**`:

```text
declared foreign items                     56   (39 kernel32, 16 advapi32, 1 ntdll)
with at least one call site in src/**      56
declared but never called anywhere          0
reachable only from tests/**                0
```

**Dynamic half.** Static reachability is not execution, and 9.6 asks for execution. There is no
way to observe an `extern "system"` import executing from inside the process without wrapping
the declarations, hooking the import table, or attaching a debugger. Wrapping is the only one
that is in-process, deterministic, and survives the guardian being force-killed -- which several
rows do. So the three `extern` blocks were moved verbatim into a private `mod imports` and 56
forwarding wrappers were emitted at the original public paths, each recording its first call.

Result, over the full suite plus `dogfood`, `dogfood --abort` and `self-identity`:

```text
processes traced                34
distinct declared items called  56 / 56
never called                    0
```

**Both earlier runs of this measurement returned 53/56 and named the same three items --
`GetCurrentThread`, `OpenThreadToken`, `RevertToSelf` -- as unexercised.** That answer was
coherent, specific, and wrong twice, for two different reasons:

1. **Concurrent-open loss.** The recorder opened the trace file per record. Several guardian
   threads open the same path at once, Windows refuses the second open with a sharing violation,
   and the already-set HIT bit meant the item was never retried. Fixed with a serialising lock
   and by setting HIT only after the line is on disk. Still 53/56.
2. **Blind inside the impersonation window.** All three missing items sit between
   `ImpersonateNamedPipeClient` and `RevertToSelf` in `win::named_pipe_client_sid`. In that
   window the thread carries an **identification-level** token, which permits identity queries
   and no file access at all, so every open failed. Fixed by opening the sink **once** and
   reusing it: the access check happens at open time, so writes through an already-open handle
   survive impersonation.

What made the wrong answer detectable was not inspection. It was that the reported answer
contradicted the code: `guardian.rs:1121` makes an unauthenticated session fail immediately,
`dogfood` authenticated and completed, therefore the token had been read, therefore
`OpenThreadToken` had run. The trace and the control flow could not both be true.

**The near-miss is worth more than the number.** The false answer -- "the guardian's symmetric
client authentication never reads a token" -- would have been a Blocker-shaped security finding
against `design.md` Decision 6, written up with a trace to back it. It was an artifact of the
instrument twice over.

## 9.7 -- per-module audit: what actually crosses each production entry point

**This sweep is EXHAUSTIVE, not sampled.** Every module under
`src/core/session-host/process-authority/windows/` and every module in
`native/windows-process-authority/src/` is listed. The TypeScript column was built by reading
every import in all 8 Windows test files plus the fixture helper; the crate column by the
foreign-call trace (which proves execution, not reachability) plus the integration tests'
imports.

### TypeScript -- `src/core/session-host/process-authority/windows/`

| Module | Production entry point | What crosses it | Verdict |
| --- | --- | --- | --- |
| `contracts.ts` | `WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR`, `createWindowsProcessAuthorityProviderManifest` | real assertions on the real constants, no stand-in | crossed |
| `outcomes.ts` | `mapWindowsNativeObservation`, `mapWindowsNativeControlOutcome` | direct calls, but **inputs are hand-written literals**; no real native observation has ever been fed to it | crossed by literals only |
| `private-reference.ts` | `createWindowsPrivateAuthorityReference`, `decodeWindowsPrivateAuthorityReference` | direct calls from fixture constants; **plus** Section 8's 8.14 built one from a real prepare attestation | crossed, including once with real data |
| `recovery.ts` | `classifyWindowsAuthorityRecovery`, `parseWindowsAuthorityIdentityProbe` | fixture probe strings only, until 9.8 Leg D fed it a real `RWA1-PROBE` line | see Leg D |
| `publication-ledger.ts` | `createWindowsAuthorityPublicationLedger`, `createWindowsAuthorityPublicationPublisher` | direct calls; Section 8's 8.14 drove the **production module** across six real processes and two crash windows | crossed with real data |
| `artifact-resolver.ts` | `inspectWindowsProcessAuthorityArtifact`, `resolveWindowsProcessAuthorityArtifact` | **the production pair is crossed by exactly one test, which asserts it fails** (`has an empty production build-authority table until packaging generates one`). Every substantive resolver assertion uses the `...ForTesting` twin | production entry crossed only by its own failure |
| `build-authority.ts` | `WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES` | checked-in value is `[]`; only packaging writes a real table, and a `tsc` run overwrites it back to `[]` | inert in-repo by construction |
| `provider.ts` (seam) | `createWindowsProcessAuthorityProviderBundleWithTransport` | the whole provider suite and the shared conformance fixture -- **all through `createWindowsProviderHarness`, a recording stand-in** | crossed only by a recording stand-in |
| `provider.ts` (production) | `createWindowsProcessAuthorityProviderBundle` | **three tests, and all three assert unavailability**: prepare returns `authority-unavailable`; every control verb retains; production options forbid injection | crossed, but only to confirm it does nothing |
| `index.ts` | barrel | re-exports only; **no `src/**` consumer imports it** | uncrossed, no consumer |

The `...ForTesting` delta is **named and bounded**, which is what Decision 12.2 asks: production
and testing variants call the identical `inspectWithBuildAuthority` / `resolveWithBuildAuthority`
and differ in exactly one argument, the build-authority table. The delta is not the risk. The
risk is that the production table is empty, so the production entry point can only ever fail,
and every behavioural assertion belongs to the twin.

**The aggregate sentence, which is the one 9.7 exists to force out:** on the TypeScript side, no
production entry point below `contracts.ts` and the pure codecs has ever been crossed by
anything that reached a Windows kernel, because the only thing that could -- the native assembly
-- does not exist.

### Rust crate -- `native/windows-process-authority/src/`

Execution here is not inferred from imports; the foreign-call trace records it directly.

| Module | Kernel-facing | Crossed by | Verdict |
| --- | --- | --- | --- |
| `job.rs` | yes | real Job creation, mask read-back, port association, terminate, in 4 integration files | crossed, real kernel |
| `activation.rs` | yes | suspended creation, pre-resume proof, wait-then-status, terminate-until-empty | crossed, real kernel |
| `win.rs` | yes | every SID, token, pipe, overlapped and handle path; trace confirms execution | crossed, real kernel |
| `endpoint.rs` | yes | real named pipe, real connect, real impersonation (proved by trace) | crossed, real kernel |
| `boot.rs` | yes | both candidate sources probed on this host | crossed, real kernel |
| `journal.rs` | yes | durable terminal records read back across processes | crossed, real kernel |
| `cli.rs` | yes | every Section 8 row, `dogfood`, and 9.8 | crossed, real kernel |
| `guardian.rs` | via helper | only ever as a **separate real process** launched by the helper; no in-process test drives it | crossed, real kernel, never in-process |
| `stateroot.rs` | yes | real reparse-point, wrong-owner and uncreatable-root probes | crossed, real kernel |
| `attestation.rs` | no | unit tests + every helper run decodes a real attestation | crossed |
| `construction.rs` | no | 6 injected checkpoints through the real helper | crossed **only through injected failure points** |
| `protocol.rs` | no | unit tests + every real frame on the wire | crossed |
| `launch.rs` | no | unit tests + every real activation | crossed |
| `encoding.rs`, `sha256.rs` | no | unit tests + real payloads | crossed |
| `main.rs`, `bin/...guardian.rs` | entry points | executed by every helper/guardian run; contain no `#[test]` | crossed, real kernel |

`construction.rs` is the one row on this side worth a reviewer's attention: its reconciliation
paths are reached **only** by deliberately injected failure checkpoints, never by a naturally
occurring failure, because no naturally occurring failure is reachable on this host (Section
8's 8.15 census).

## 9.8 -- production against the real kernel, with no test harness in the loop

No vitest, no cargo test, no fixture, no injected transport, no recording stand-in. Each leg is
the shipped helper or a shipped TypeScript module invoked the way a caller would invoke it, from
a plain Node driver whose only job is to start processes and read their output.

| Leg | What ran | Result |
| --- | --- | --- |
| A | `dogfood` -- prepare, replacement reopen, capability, inspect, runtime bridge, activate, stream, converge | **PASS.** `inspect phase=1` (prepared-inert), real workload output, `root-exited code=0 signal=null`, `RWA1-OBSERVATION 0407...`, `exact-scope-empty reached` |
| B | `dogfood --abort` -- prepared abort | **PASS.** `abort frame=exact-scope-empty`, workload never ran |
| C | replacement recovery + inspect + terminate, 8 independent authorities, one fresh process per step | see below |
| D | the production TypeScript modules | **STRUCTURALLY IMPOSSIBLE for the lifecycle; the parts that could run, ran** |

### What running production found that no test found

1. **`S9-F1` -- the lost termination receipt is a race, not an ordering rule.** No test found this
   because the test that covers the row *asserted the defect*, so the majority behaviour (the
   receipt arriving correctly) read as a test failure and the minority behaviour read as a pass.
   Only running the row repeatedly, outside its assertion, showed the distribution.
2. **The production TypeScript factory is inert on a host whose kernel supports the authority in
   full.** `createWindowsProcessAuthorityProviderBundle({ stateRoot })` validated its state root,
   built a real ledger, and returned
   `{"state":"authority-unavailable","diagnostic":"selected provider prerequisites unavailable"}`
   -- on the same machine where `dogfood` completed a full lifecycle seconds earlier. The
   diagnostic is a lie of omission: the prerequisites are present; the assembly is absent. No
   test could find this, because the three tests that cross the factory assert exactly that
   return value.
3. **The production artifact resolver cannot succeed for any input in a source checkout.**
   `WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES` is `[]` in `src/`, and `resolveWindows-
   ProcessAuthorityArtifact` returned `Windows process-authority artifact helper is missing.`
   Both halves of the failure are live at once: no packaged artifact (`S8-F2` wiped it) and no
   build authority.
4. **Nothing converts the helper's probe output into the object the production parser consumes.**
   `parseWindowsAuthorityIdentityProbe` takes an **object**; the helper emits a flat
   `RWA1-PROBE key=value ...` line. The only producer of that object anywhere is the test
   fixture's `windowsPresentIdentityProbe`. So the production recovery classifier has never been
   fed anything a Windows kernel produced, and cannot be until the missing adapter exists.
   Recorded precisely because the first attempt to demonstrate it was **my** error: the driver
   passed the raw line, the parser correctly returned `undefined`, and that is a fixture-shaped
   mistake, not a product defect. The product gap is the absent adapter, not the parser.

### Legs that were structurally impossible, and exactly why

- **The TypeScript lifecycle leg cannot run end to end.** `provider.ts:746` wires
  `unavailableNativeAssembly()` with placeholder digests `'e'.repeat(64)` / `'f'.repeat(64)`,
  there is no `windows/native-assembly.ts`, and nothing in `src/` calls the factory. There is no
  code path from the TypeScript provider to the helper, so `prepare`, `activate`, `inspect`,
  `terminate`, `abort` and recovery cannot be exercised through it at all. This was known before
  the section opened (`S8-F7`) and is reconfirmed by execution rather than by reading.
- **Consequence for the gates 9.8 feeds, stated plainly:** 9.8 is closed **for the native
  provider** and **not closed for the TypeScript provider**. Any later claim that "the provider
  was run end to end against the real kernel" is true only of the crate and the helper CLI. The
  row is therefore PARTIAL, and 9.8 stays unticked.

### Method note

The first attempt at Leg C reported `never activated` eight times out of eight against a helper
that was activating correctly every time: the driver polls synchronously, so Node's event loop
never ran and the piped `stderr` handler never fired. Fixed by writing the controller's stderr to
a file and polling the file. Recorded because it is the same class as `S8-F5` -- a harness defect
that produces a full column of plausible negative results.

A second harness defect was caught by control: `cmd /c echo hello` appeared to fail with a
command-syntax error under the instrumented build. Re-run against the packaged helper with an
explicit argv array, **every workload shape succeeds** (`echo hello`, with and without `PATH`,
`ping`, `> nul` redirect, `exit /b 7` returning 7). The failures came from MSYS rewriting the
`/c` argument as a path inside a POSIX shell script -- the identical trap that invalidated
Section 8's first 8.15 attempt with `/b`. **Not a product defect, and it would have been reported
as one without the control run.**

## 9.9 -- rewrite list

The sweep covered every assertion in the four crate integration test files and all eight Windows
TypeScript test files. It is **exhaustive over the crate tests** and **exhaustive over the
TypeScript files' production-entry-point assertions**.

| Location | What it asserted | What the contract requires | Action |
| --- | --- | --- | --- |
| `windows_section8_gate.rs:827` | the **defect**: `!terminate.ok && stderr contains "unexpected frame root-exited"` | terminate drives the authority to `ACTIVE_PROCESS_ZERO` and returns that receipt; expiry returns typed `timeout` with authority retained. An ad-hoc `unexpected frame <name>` is neither | **REWRITTEN** to the contract form. Measured: the old assertion was red 6 runs in 7 -- it was failing because the product behaved *better* than it demanded |
| `windows_authority_kernel.rs:792` | that late port association announces live members | nothing -- this is a **kernel** property, not a product obligation, and it exists to correct `design.md` Decision 3 | **KEPT, re-read.** The acceptance weight for 9.3 rests on its sibling RED (a member that departed before association is lost forever), which is a product obligation. Recorded here so no reviewer mistakes the kernel fact for the oracle |
| `windows-process-authority-provider.test.ts` -- 3 production-factory assertions | that production `prepare` returns `authority-unavailable` and every control verb retains | on a host whose prerequisites are present, prepare returns `prepared-inert`. The current assertions restate the **wiring**, not the contract | **NOT rewritten, and this is a deliberate exception.** They cannot be made contract-form without a native assembly existing, and rewriting them to a form that must fail would leave a permanently red TypeScript suite for an unimplemented task (4.8). Recorded as owed, with the exact rewrite named: the assertion should read "inert until a Windows native assembly exists", not "unavailable", so it cannot be mistaken for evidence that the production path behaves correctly |

**One already-recorded row is invalidated by this.** Section 8 recorded `120 passed, 0 failed`.
That does not reproduce: the same command on the same digests gives **119 passed, 1 failed**, and
the failure is 8.12's own gate row. 8.12 was already unticked, so no tick is protected by saying
so -- but the count in Section 8's evidence should be read as superseded.

## 9.10 -- counts, separated and bound

```text
crate source digest for every count below   2b3fabd9
packaged helper for binary-executing rows   2aebab69   (guardian d571f148)

native suite, all targets                   124 tests
  91  lib unit tests (src/**, 19 files)
  15  windows_authority_kernel
   6  windows_guardian_lifecycle
   8  windows_section8_gate
   4  windows_section9_discrimination   <- new in this section
   0  the two binary targets

asserting tests                             121
gated entry points                            3, all named:
   fixture_entrypoint       (RWPA_FIXTURE)     windows_authority_kernel
   s8_fixture_entrypoint    (RWPA_S8_FIXTURE)  windows_section8_gate
   s9_fixture_entrypoint    (RWPA_S9_FIXTURE)  windows_section9_discrimination
  each early-returns when its variable is unset, panics on a set-but-unrecognised role, and is
  excluded from the asserting count. Their consumers assert on fixture OUTPUT, so a fixture that
  never runs fails its consumer loudly rather than silently.

tests that execute a helper BINARY            7   (5 guardian-lifecycle + 2 gate)
tests that execute no binary                117

TypeScript Windows suites                     8 files, 114 `it` blocks
  of which cross the production provider factory   3, all asserting unavailability
  of which cross the production artifact resolver  1, asserting it cannot succeed
```

**Artifact byte length is not a change signal on this change family** -- three recorded instances
(`F-L2-14`), including two different programs at identical length 258560. Every identity above is
a SHA-256.

**The suite is not green, and the count above must not be read as if it were.** See `S9-F1`.

## Findings

### `S9-F1` (Major, supersedes the mechanism half of `S8-F1`) -- the lost termination receipt is a **race**, not an ordering rule

Section 8 recorded `S8-F1` as deterministic: terminating a live authority "necessarily kills the
root first, so the guardian emits `RootExited` before `ExactScopeEmpty`". **Measured, it is
neither deterministic nor rare, and the two ways of driving it disagree.** All rows below use the
identical packaged helper `2aebab69` and crate source `2b3fabd9`, with
`windows_section8_gate.rs` byte-identical to its freeze-marker digest `ba540903`:

```text
driven through the Section 8 gate row's sequence
  packaged helper, 7 runs (1 in-suite + 6 isolated)     LOST  1 / 7
  debug-profile helper, 3 runs                          LOST  2 / 3

driven directly by a plain driver, no test harness
  9.8 Leg C, chatty workload, 8 runs                    LOST  8 / 8
  rate probe, silent workload (`> nul`), 6 runs         LOST  6 / 6
  rate probe, chatty workload, 6 runs                   LOST  5 / 6
                                                 total  LOST 19 / 20
```

In every one of those 20 direct runs the authority **did** converge: the root was gone
afterwards, `converged: 8` in Leg C, so the receipt is lost for a termination that succeeded.

The mechanism, read from the code rather than inferred: `guardian.rs:673 deliver_root_exit`
broadcasts `RootExited` on the **shared session writer**, from the root-waiter thread, at most
once per authority. `guardian.rs:1218` sends `ExactScopeEmpty` on the same writer from the
terminate handler. `cli.rs:643` reads exactly one frame. Whichever thread writes first decides
what the replacement controller reads.

**The contradiction is reported, not reconciled.** Two hypotheses for why the gate row loses the
receipt 1 time in 7 while a direct driver loses it 19 times in 20 were tested and **both
refuted**:

- *Workload output volume.* A silent `> nul` root and a chatty one behave the same (6/6 and 5/6
  lost), so the guardian's output relay is not the third writer deciding the race.
- *Harness retry masking.* `run_helper_retrying` retries **only** on `ERROR_PIPE_BUSY`
  (`os error 231`) and returns any other failure immediately, so it cannot be converting a lost
  receipt into a pass.

What remains is that the gate row interposes five extra helper processes and two deliberately
refused sessions between killing the controller and terminating, and something in that sequence
usually avoids the race. **That mechanism is not identified, and no causal claim is made here.**

The practical reading is the direct-driver number, because that is how a caller drives it:
**terminating a live authority loses its receipt almost always.** That is worse than `S8-F1`
recorded, not better.

The correct generalisation is bigger than the terminate verb: **the guardian broadcasts
unsolicited frames into a control session that has no reader for them.** Any request/response
verb on a session that receives a broadcast is desynchronised by it, not just `terminate`.

Consequences that change how earlier evidence reads:

- The fix stands as the LEAD specified -- drain in a loop as `run_workload` does, do not
  special-case `RootExited` -- and that fix is correct for the general form too.
- Section 8's "120 passed, 0 failed" **does not reproduce**. Measured here: 119 passed, 1 failed,
  and the failing row is 8.12's own gate test.
- The severity conditions in `S8-F1` still hold, but the reasoning under them was wrong: the verb
  does not fail closed *reliably*; it fails closed *sometimes* and succeeds *usually*. An
  intermittent lost receipt is harder to find than a deterministic one, not easier.

### `S9-F2` (method, no product impact) -- an instrument that produced a plausible security finding twice

Recorded in full under 9.6. The lesson that generalises: **a coverage instrument is a guard test
and owes its own falsification.** Both defects produced the same specific, coherent, wrong answer
naming the same three items. Neither was visible by reading the recorder.

### `S9-F3` (boundary, not a defect) -- `design.md` Decision 3's stated mechanism still does not reproduce

Restated rather than re-litigated, because 9.3's RED depends on getting it right. Associating the
completion port to a Job that already has **live** members announces each of them at association
time on this kernel. The loss that is real is a member that **departed** before association: it
cannot be announced retroactively, its `ACTIVE_PROCESS_ZERO` transition has already happened, and
the exact-empty oracle can never fire for that authority. The design sentence should be corrected
to the measured mechanism; the requirement it protects is unchanged.

### `S9-F4` (boundary, minor) -- the post-open reread proves identity, never liveness

Measured under 9.5. Destroying the endpoint **object** while its server **process** stays alive
leaves the reread answering exactly as before: `GetNamedPipeServerProcessId` still names the live
server through the retained handle and the owner SID is still readable. This is correct against
the contract, which is about identity, but it is the same trap as `S8-F6`: a retained handle keeps
a dead thing resolvable. **Anyone writing a recovery expectation against "the endpoint is gone"
must not expect the reread to be the step that reports it.**

### `S9-F5` (Major, reproduces `S8-F7` from the other direction)

Recorded under 9.7 and 9.8 Leg D.

### `S9-F6` (process) -- `S8-F2` recurred a third time and cost this section its `dist/` tree

Recorded under Bindings. For task 10.5 this remains an ordering hazard: packaging must run after
the TypeScript build or the shipped tree cannot resolve its own artifact.

## The post-freeze wave: two fixes, one re-freeze, one re-bind

Authorised by the operator and sequenced by the LEAD: break the freeze **once**, fix everything
known, re-freeze once, re-bind once.

### The new freeze

```text
crate sourceSha256   fc49a7c2c5f9642fa976d16f06e167a39bdbe3c751686f417722273aea891c27
  supersedes         2b3fabd916dd0106038557ea54b694b4cb76e4d73ff785dcd0584e6b92a45377
packaged helper      367666f6d4151b5092b528abd2c8256d48fd96d73436184b54ae1897e55d8a6b   258560 B
  supersedes         2aebab6987f6b59b7ffef95d61681165082e9f5b039beb3a095ecc0260dd9cf0   258560 B
packaged guardian    d571f148a96c9415859f2d7d16329bf86a7db009c5d7d396f2d7fab86a125f2f   254464 B  (unchanged)
releaseInputSha256   1daa062dffdf8b6d39e90d62e3904dc3ee30717a277e3103f61dc9263c9f8056
```

**The helper is a different program at exactly the same byte length, 258560.** That is the
**fourth** recorded instance of `F-L2-14` on this change family and the second at this precise
length. Anyone diffing by size will conclude nothing changed.

### Fix 1 -- `S8-F1` / `S9-F1`, with a measured RED/GREEN

`cli.rs`'s `abort`/`terminate` branch now drains frames in a loop exactly as `run_workload` does.
`RootExited` is **not** special-cased: any frame that is not the authority's own verdict is
drained, so a broadcast added later cannot reintroduce the defect. The loop honours the deadline
and returns typed `native-operation-timeout` on expiry.

Same driver, same workloads, same machine:

```text
RED   helper 2aebab69 / source 2b3fabd9    LOST 19 / 20   (receipt lost for a converged authority)
GREEN helper 367666f6 / source fc49a7c2    RECEIPT 12 / 12  (6 silent + 6 chatty workloads)
```

Task **8.12 is now ticked**: a replacement controller authenticates, rereads, inspects **and**
obtains a termination receipt.

### Fix 2 -- task 4.8, the availability transaction

`design.md:202-204` promised typed `authority-unavailable` for eight enumerated prerequisites and
`S8-F3` measured that no probe produced it. The mapping now exists in `provider.ts`, with a
bounded one-sentence diagnostic naming the cause and the code, carrying no path, SID, scope id or
native string. Attested facts are revalidated **before** the private-reference codec.

Two implementation defects were caught by the tests rather than by review, and both are the kind
this section exists to surface:

1. The first revalidation ran **after** the codec and was unreachable dead code -- the codec
   already rejects a wrong mask, by throwing "private reference is malformed", which is the wrong
   verdict for a failed prerequisite.
2. The first revalidation fired on **absent** fields too, which turned "the helper omitted a
   value" into "this host cannot run the authority" and broke the pre-existing
   `refuses to invent an attested value the helper did not supply` test. Each check now fires
   only when the field is present and wrong.

The discriminating assertion is the one that proves the set is **closed**: an unrecognised native
code is still rejected as malformed, not widened into "prerequisites unavailable".

### Re-bind sweep -- full enumeration, by grepping the digest repo-wide

Swept with `grep -rl 2b3fabd9` across the whole repository rather than by walking this change's
directory. **12 files across four changes plus portfolio run-state**, which is materially wider
than this change's evidence directory:

| File | Kind | Action |
| --- | --- | --- |
| `evidence/win-crate-freeze-marker.md` | the authoritative marker | **owed**: new digest, lineage entry `fc49a7c2`, new helper hash, fourth `testFiles` entry for `windows_section9_discrimination.rs` |
| `evidence/section-8-actual-kernel-gate.md` | 21 rows bound to the old pair | **re-taken**: the full native suite passes at the new pair (124/124). Its recorded `120 passed, 0 failed` is superseded twice over -- see 9.9 |
| `evidence/section-9-oracle-discrimination.md` | this file | re-bound in place; every row states which digest it used |
| `evidence/win-crate-lf-refreeze.md` | historical record of how `2b3fabd9` was derived | **not rewritten** -- it records an event, and rewriting it would falsify that record. Owes a superseded-by note |
| `evidence/lead2-apply-wave-accounting.md` | historical planning record | same treatment |
| `ecp-linux-process-authority-provider/handoff/lead-2.md` | **cross-change** | LEAD-owned |
| `ecp-linux-process-authority-provider/handoff/lead-3.md` | **cross-change** | LEAD-owned |
| `ecp-linux-process-authority-provider/handoff/lead-5.md` | **cross-change** | LEAD-owned |
| `.rasen/changes/ecp-windows-process-authority-provider/ephemera/auto-run.json` | run-state | LEAD-owned; this worker must not write `.rasen/**` |
| `.rasen/changes/ecp-linux-process-authority-provider/ephemera/auto-run.json` | run-state, **cross-change** | LEAD-owned |
| `.rasen/changes/process-authority-scope-semantics-wording/ephemera/auto-run.json` | run-state, **cross-change** | LEAD-owned |
| `.rasen/changes/ecp-session-execution-and-self-hosting/ephemera/portfolio-run.json` | **portfolio** run-state | LEAD-owned |

**No code asserts the Windows digest.** Verified by grepping `*.ts`, `*.rs`, `*.mjs`, `*.js` and
`*.yml`: the single hit was a prose comment in `windows_section8_gate.rs`, updated. This is the
opposite of the Linux situation, where `windows-process-authority-package-ci.test.ts:295` asserts
`087d87a5` in code -- that assertion is untouched by this re-freeze and still holds.

### Counts at the new freeze

```text
native suite, all targets   124 passed, 0 failed, 0 ignored   @ 367666f6 / fc49a7c2
Windows TypeScript suites   161 passed, 0 failed              (7 files; +7 new for task 4.8)
```

## Tasks ticked, and what each tick rests on

Ticked in Section 9: **9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.9, 9.10.**
Ticked by the post-freeze wave: **4.8** (implemented and tested here) and **8.12** (its blocker,
S8-F1, is fixed and the receipt is now obtained 12 times in 12).

**Not ticked: 9.8**, because its TypeScript lifecycle leg is structurally impossible and closing
it on the native leg alone would let a narrower receipt close a broader gate -- which task 1.7
exists to forbid. It becomes closable when a Windows `native-assembly.ts` exists.

## What Section 9 does NOT establish

- **9.8 is not closed.** The native provider runs end to end against the real kernel. The
  TypeScript provider cannot be run at all. Do not read any receipt here as evidence about the
  TypeScript production path.
- **9.2 and 9.3 were confirmed, not authored.** Their RED/GREEN pairs pre-existed and are
  genuinely discriminating; this section re-ran them and checked the mutations reach the property
  each names. That is weaker than having produced them independently.
- **The 9.6 coverage number is bound to an instrumented tree, not to `2b3fabd9`.** The
  instrumented tree is pristine source plus forwarding wrappers that change no signature, link
  name, constant or call site, but it is not the frozen program and its receipt says so. A
  reviewer wanting 9.6 bound to the shipped artifact would need a different technique
  (import-table hooking of the packaged helper), which was not attempted.
- **9.6 proves each declared item was called at least once. It does not prove any call was
  correct.** A wrong struct layout or constant that still executes is invisible to this
  measurement. Decision 1's read-back obligations, not this trace, carry that weight.
- **9.5 does not simulate process-id reuse.** It changes the identity the reference names to a
  genuinely different live process, which is the same shape, and it does not force a real
  identifier to be recycled. Forcing that deterministically was not attempted.
- **The `S9-F1` rate is a sample, not a distribution.** 1 in 7 on the packaged helper and 2 in 3
  on the debug build, on one machine, on one day, under this session's load. It establishes that
  the defect is intermittent and load-dependent. It does not establish a rate anyone should
  quote as a probability.
- **No Section 11 work was done**, and **10.4 remains open and untouched** -- the VS Build Tools
  ARM64 component is still absent.
- **The TypeScript suites were not re-run**, and the three production-factory assertions named in
  9.9's rewrite list are recorded as owed rather than fixed.
- **Author == verifier for everything in this file.** One worker wrote the new tests, wrote the
  mutations that falsify them, built the 9.6 instrument, found and fixed two defects in that
  instrument, ran everything and graded it. Nothing here has been reproduced by a second agent.
  That matters more than usual for `S9-F1`, whose whole content is a measured rate, and for the
  9.6 result, whose first two answers were confidently wrong.
- **Nothing was committed, pushed, or written under `.rasen/**`.** The repository changes from
  this unit are: one new test file, one rewritten assertion in an existing test file, this
  evidence file, the tick edits in `tasks.md`, and the restoration of `src/sys.rs` to its frozen
  bytes.
