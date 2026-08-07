# Section 12 - daemon-lifetime teardown, re-freeze and re-bind

Date: 2026-08-07\
Author: implementer (Section 12 post-freeze native wave), leaf worker.\
Tasks: 12.1 implementation, 12.2 tests plus actual-kernel oracle and mutation receipt, 12.3
re-freeze and re-bind.

Requirement this wave serves: `Scope lifetime equals the owning daemon's lifetime`
(`specs/linux-process-authority-provider/spec.md`), scenario `Owning daemon dies while the scope is
live`. The requirement's `execution-lost` clause is owed by `ecp-frozen-action-session-executor`
and is not touched here. R7's retained per-operation identity checks are not altered by this wave:
no reopen, revalidation or drift-refusal code was changed, and the guardian writes no terminal
record on teardown precisely so that the retained positive-empty-proof path stays the only route to
an exact-empty verdict.

## Freeze transition, stated first

```text
superseded   087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59   26 files
NEW FROZEN   89f6c1d5270c3ad301f84edde1ae1f67541ac81ca271eb8eaef7871715aba643   26 files
lineage      826fa048 -> a568f53b -> 087d87a5 -> 89f6c1d5
```

The file count is unchanged because the wave edited two existing files and added no source file.
The new value was produced twice by two independent implementations of the digest convention: by
`scripts/build-linux-process-authority.mjs` itself (`sourceSha256` in its emitted release input),
and by a separate reimplementation read off that script - `hash.update(name)`, `NUL`,
`hash.update(bytes)`, `NUL`, over `Cargo.lock`, `Cargo.toml`, `THIRD_PARTY.md` and every regular
file under `src/`, sorted, with `tests/` excluded. Both produced `89f6c1d5...`. The same
reimplementation reproduced `087d87a5...` on the pre-wave tree before any edit, which is what makes
its agreement here worth anything.

## 12.1 - what was built

Two source files changed, both inside `native/linux-process-authority/`:

| File | Change |
| --- | --- |
| `src/primary.rs` | daemon-lifetime endpoint threaded from prepare into the guardian; guardian answers end-of-file by leaving |
| `src/main.rs` | optional `--daemon-lifetime-fd <n>` on the `prepare` operation |

**The mechanism.** The owning daemon creates a channel and keeps one endpoint for the scope's whole
life. It hands the peer endpoint to the short-lived prepare helper by inheritance; the helper
transfers it to the namespace guardian across `clone` and holds no copy of the daemon's end. The
guardian polls it. When the daemon exits for any reason its endpoint closes, the guardian reads
end-of-file and calls `_exit`. Because the guardian is PID 1 of the scope's PID namespace, the
kernel then `SIGKILL`s every remaining member. Nothing cooperates: no surviving daemon, controller
or helper participates in the teardown.

Concrete seams:

- `prepare_primary_with_daemon_lifetime_ms(request, artifact, source, deadline_ms, endpoint)` -
  new public entry. `DAEMON_LIFETIME_ENDPOINT_ABSENT` (`-1`) prepares an unbound scope, which is
  what every pre-existing caller gets, so no existing behaviour moved.
- `validate_daemon_lifetime_endpoint` refuses anything below descriptor 3 or any descriptor that is
  not open, before a namespace is built. A caller that intends the binding cannot be handed a scope
  whose binding is vacuous.
- `child_main` adds the endpoint to the guardian's keep-set so `strict_close_except` spares it, and
  refuses a value that collides with a construction descriptor.
- `Guardian::check_daemon_lifetime` is the single decision point, called at the top of each loop
  iteration and again immediately after `poll` returns, before any control, output or reaping work.
  `POLLHUP`/`POLLERR`/`POLLNVAL` tear down; `POLLIN` is read, and only a zero-length read is
  end-of-file. Unexpected traffic on the endpoint is drained and ignored, so it can never become a
  second control channel.
- `daemon_lifetime_teardown` calls `libc::_exit(73)`. Not a return through the guardian loop: the
  teardown must not depend on any further code succeeding, and **no terminal journal record is
  written**. This scope did not reach a proven-empty terminal state by observation, and fabricating
  one would let a later reader claim positive emptiness that nothing measured.

**The endpoint is a pipe, not `PR_SET_PDEATHSIG`.** A reviewer grepping the crate will still find
two `PR_SET_PDEATHSIG` calls at `src/primary.rs:968` and `:991`. They are the pre-existing
*construction-time* coupling: `install_parent_death_coupling` binds the forming guardian to the
short-lived prepare helper, and `release_parent_death_coupling` clears it before the guardian
begins its loop. They cannot carry a daemon lifetime and are not claimed to - which is the reason
the pipe exists.

The workload never inherits the endpoint: `spawn_root`'s `prepared_descriptors` set does not
include it, so `strict_close_except` closes it in the workload child. Measured indirectly - the
resistant workload in 12.2 runs to completion and cannot influence the teardown.

**Teardown latency** is bounded by the guardian's own loop: 25 ms of `poll` timeout in the common
case, and at worst one `CONTROL_TIMEOUT` (2 s) if the guardian is mid-way through serving a control
stream when the daemon dies. Measured runs settled far inside the 6 s window used by the oracle.

**Residue after teardown**: the scope's runtime directory is left on disk, exactly as it is after
any guardian forced death (task 7.7's retained half). No cleanup was added, because a cleanup step
would be cooperation by a process that the requirement says must not be needed.

## 12.2 - the oracle, and the receipt that makes it mean something

New file: `native/linux-process-authority/tests/linux_daemon_lifetime_contract.rs`. It is a real
three-process topology, not a stand-in:

```text
TEST  ->  DAEMON (owns one endpoint, nothing else holds it)
             -> HELPER (inherits the peer endpoint on fd 3, prepares + activates, then exits)
                  -> GUARDIAN  (PID 1 of the scope PID namespace, sole holder of the endpoint)
                       -> workload root
                            -> setsid descendant
                            -> double-forked, re-setsid'd grandchild
                            -> nested user+PID namespace: nested init + its own child
TEST  ->  UNRELATED bystander, outside the scope entirely
```

The helper exits before the teardown is triggered, so the guardian is already orphaned and nothing
about process parenthood can explain what follows.

Both triggers required by the task were run:

| Oracle | Trigger | Result |
| --- | --- | --- |
| `owning_daemon_death_tears_down_every_resistant_descendant` | `SIGKILL` the owning daemon | zero orphans |
| `closing_only_the_daemon_endpoint_tears_down_every_resistant_descendant` | daemon closes only its endpoint and stays alive | zero orphans, daemon still running |

The second variant is the one that isolates the mechanism. The daemon is alive when the scope dies,
so neither its death nor any parent-death signal can be the cause; a `PR_SET_PDEATHSIG`-shaped
implementation would not fire at all.

**Positive control.** Every absence assertion is preceded by a liveness assertion: the run does not
proceed to the trigger until the root, the `setsid` descendant, the double-forked grandchild, the
nested init and the nested child have each recorded that they are alive, and until none has already
recorded an escape. An empty result produced by a workload that never ran would fail here.

**Unrelated-process survival**: the bystander records its survival *after* the teardown and that
record is required to exist, which separates "the scope was torn down" from "something killed
everything in sight".

### Two facts about this codebase that the oracle had to be built around

Both were discovered by the oracle failing, not by reading:

1. **The workload holds no capabilities.** `drop_workload_privileges` (`src/primary.rs:2168`) drops
   the whole capability bounding set, `capset`s empty sets and sets `NO_NEW_PRIVS` before the
   workload is launched, so `unshare(CLONE_NEWPID)` alone returns `EPERM`. The nested branch must
   go through an unprivileged user namespace, which needs no capability - the shape the crate's own
   comment names as retained. Any future test that assumes a privileged workload will be wrong.
2. **Inside that nested user namespace the process is unmapped and cannot create files** in the
   marker directory. Writing an identity map was tried and refused (`EPERM` on
   `/proc/self/uid_map`). The oracle instead opens the nested pair's report files *before* the
   `unshare` and writes to the descriptors afterwards, because filesystem permission is decided at
   `open`. Their state is therefore the file's **content**, never its existence.

### Discriminating mutation receipt

An unmutated guard proves nothing on this codebase, so the mutant is a real rebuild of a real
teardown-disabled program, not a flag.

- The crate was copied to `/home/sayo/.local/share/rasen-build/s12-mutant`, **outside the
  repository**. No repository file was modified for the mutation.
- Exactly one operator was inverted, in `Guardian::check_daemon_lifetime`:
  `if self.daemon_lifetime == DAEMON_LIFETIME_ENDPOINT_ABSENT { return; }` became `!=`. A bound
  endpoint is then never answered. Nothing else differs, and the mutant compiles with no dead code
  or unused-value warnings, so it is a program that plausibly could have been written.
- The mutant was rebuilt and the **same** test file run against it.

```text
unmutated crate   8 passed  0 failed
mutant crate      6 passed  2 failed

closing_only_the_daemon_endpoint_...  workload processes outlived the owning daemon:
    ["escaped-root", "escaped-setsid", "escaped-doublefork",
     "nested-init.state", "nested-child.state"]
owning_daemon_death_...               workload processes outlived the owning daemon:
    ["escaped-root", "escaped-setsid", "escaped-doublefork", "nested-init.state"]
```

Both oracles went RED with named live orphans in every resistance category. The two deterministic
endpoint-contract tests stayed GREEN under the mutant, which is the check that the mutation is
targeted rather than a blanket breaker: a mutant that reddens everything would show only that the
build changed.

The kill variant listed four orphan categories and the close variant five. The difference is the
nested *child*'s escape write, which is racy relative to its parent's; the nested *init* survived
in both, which is the claim that matters. Recorded rather than smoothed over.

### Deterministic state-machine coverage

- `a_malformed_daemon_lifetime_endpoint_is_refused_before_any_namespace_is_built` - descriptors 0,
  2 and a closed descriptor are each refused with the exact stated reason, and the runtime root is
  verified to contain no scope state afterwards.
- `an_absent_endpoint_leaves_the_existing_lifecycle_unchanged` - an unbound scope still prepares,
  reports the native `inert` state, aborts and reaches `exact-scope-empty`. This is what makes the
  binding something a caller opts into rather than a change to the existing lifecycle.

### Runs, with the gating named

The WSL oracle env gate `RASEN_ACTUAL_WSL_ORACLE=1` gates the **TypeScript** oracle file
(`test/core/session-host/linux-process-authority-wsl-oracles.test.ts`) and is **not** used here.
This wave's oracles are native crate integration tests, which cannot compile on a non-Linux target
at all (`#![cfg(target_os = "linux")]`), so there is no silent-skip path: on Windows they do not
exist, and under WSL they run. Every result below was produced by `cargo test` executing on the
actual WSL2 Linux kernel.

```text
kernel      5.15.167.4-microsoft-standard-WSL2
toolchain   cargo 1.88.0 (873a06493 2025-05-10) / rustc 1.88.0 (6b00bc388 2025-06-23)
RUSTUP_HOME /home/sayo/.local/share/rasen-rustup-1.28.2
CARGO_HOME  /home/sayo/.local/share/rasen-cargo-1.28.2
linker      private `cc` wrapper at /home/sayo/.local/share/rasen-build/lead2-track-a-cc
            (delegates to zig 0.16.0; no package was installed)
target dir  /home/sayo/.local/share/rasen-build/s12-target  (outside the repository)
command     cargo test --test linux_daemon_lifetime_contract -- --test-threads=1 --nocapture
```

### Focused native regression, same wave

`src/primary.rs` is the file every primary receipt depends on, so the surrounding suites were run
against the changed crate:

```text
cargo fmt --check                    clean
lib (unit)                           10 passed
linux_primary_contract               29 passed
linux_primary_topology_contract       5 passed
lifecycle_contract                    6 passed
authority_contract                    4 passed
protocol_contract                     5 passed
linux_journal_contract                2 passed
linux_identity_contract               3 passed
linux_runtime_contract                3 passed
```

Zero failures, zero skips. The broker suites were not run: they are `[MOVES-0.3.0-BROKER]` and
`linux_broker_service_contract` carries the `TMPDIR`/`SUN_LEN` hazard; not running them is recorded
here as a gap rather than presented as coverage.

### One flake, found and fixed rather than re-rolled

The first regression pass reported `closing_only_the_daemon_endpoint_...` failing on "the daemon did
not survive closing its own endpoint", after the same test had passed. The cause was in the test,
not the product: the daemon recorded its survival after `ESCAPE_AFTER + ESCAPE_SLACK` measured from
its own close, while the assertion was taken `ESCAPE_AFTER + ESCAPE_SLACK` after the *trigger* - the
two deadlines coincided. Fixed by recording survival after `ESCAPE_AFTER`, strictly inside the
assertion deadline and on the same clock the orphan candidates use, and by adding a race-free
`try_wait()` check that the daemon process has genuinely not exited (a bare signal probe would be
answered by a zombie).

```text
after the fix, three consecutive full runs
repeat 1   8 passed  0 failed   22.85s
repeat 2   8 passed  0 failed   22.82s
repeat 3   8 passed  0 failed   22.90s
```

Three passes is evidence of stability, not proof of it; the flake is recorded so a future failure
here is read as a returning known cause rather than a new one.

The crate source digest was re-measured after these test edits and is unchanged at `89f6c1d5...`
over 26 files, which is the practical confirmation that `sourceDigest()` excludes `tests/` and that
further test work cannot move the new freeze.

## 12.3 - re-emitted manifest

Emitted by the authoritative route, `scripts/build-linux-process-authority.mjs
--target x86_64-unknown-linux-musl`, into isolated build roots outside the repository. The
repository's own `dist/` and `native/**/target/` were not written.

```text
evidenceClassification    package-integrity-non-runtime
sourceSha256              89f6c1d5270c3ad301f84edde1ae1f67541ac81ca271eb8eaef7871715aba643
releaseInputSha256        959c17cd6dc829a7552894eb5307e20cf362787d54f1e03b14badf09b0d8b941
compiler                  rustc 1.88.0 (6b00bc388 2025-06-23)
privilegedBrokerIncluded  false

helper         dist/native/linux-x64/rasen-linux-process-authority-helper
               length 579912   sha256 a37d6c4b59434beaaf6a4a8b4d2400b5649d8d11984c85063e34d8bce1705564
               mode user-pidns, provider rasen.linux.user-pidns, protocol 1, reference 1
broker-client  dist/native/linux-x64/rasen-linux-process-authority-broker-client
               length 620104   sha256 0fdfa27f953455a88f0d9d38a7683bd31ca9042817bf0b69da9a667329fbfc66
               mode broker-pidns-cgroupv2, provider rasen.linux.broker-pidns-cgroupv2
```

Against the superseded values: the helper was `4835b1bb...` at 578312 bytes; it is now
`a37d6c4b...` at 579912. `F-L2-14`'s lesson applies in reverse here - the length moved as well as
the bytes, but a moved length is not what identifies the build; the digest is.

`releaseInputSha256` also moved (`14f041c7...` -> `959c17cd...`). That is **not** attributable to
the source change alone: the superseded receipt records that this value varies with the host linker
wrapper's path, and this wave used a different wrapper path from the run that produced
`14f041c7...`. Stated as unresolved rather than explained away.

**F-L2-15 re-taken, not merely re-bound.** Two builds of the new frozen source into roots whose
names differ by 35 characters (50 vs 85) produced **byte-identical** helper and broker-client
artifacts. The reproducibility property survives the change:

```text
IDENTICAL  rasen-linux-process-authority-helper
IDENTICAL  rasen-linux-process-authority-broker-client
```

## 12.3 - full re-bind table

Enumerated by grepping the digest string across the **whole repository** (excluding
`node_modules/`, `target/` and `dist/`), not by walking this Change's directory. That distinction
is load-bearing: the only executable guard bound to the digest lives in a different Change and a
directory-scoped sweep would have reported a complete enumeration that was not one. **29 files, 96
occurrences.** Every one is listed below; nothing is extrapolated from a prefix or a tail.

### In-change: this Change's own evidence and artifacts

| # | Receipt / occurrence | Disposition |
| --- | --- | --- |
| 1 | `evidence/wsl-native-build-manifest-lead2.md` (9), `-results.md` (6) - task 7.2's manifest receipt | **RE-TAKEN.** Superseded in full by the re-emit above. Its artifact rows now name a binary that no longer builds from the frozen tree. |
| 2 | `evidence/f-l2-15-reproducible-build-verification.md` (6) - byte-reproducibility across build roots | **RE-TAKEN.** Two-root byte-identical result reproduced against `89f6c1d5`, above. |
| 3 | `evidence/lead2-implementation-wave-findings.md` (11) - artifact identity table at :261-262, plus findings prose | **SPLIT.** The two artifact rows are RE-TAKEN by the re-emit. The findings prose is a dated record of what was true at `087d87a5` and stays as history. |
| 4 | `evidence/wsl-ts-oracles-lead2.md` (14) - tasks 7.8 / 7.9 / 7.10 actual-kernel TypeScript oracles, bound to package-root helper `94002604...` | **RE-BOUND, NOT RE-TAKEN - honest gap.** Re-running them needs a packaged `dist/`, and building it is forbidden in this wave (`build.js` wipes `dist/`, which concurrent work depends on). Task **11.3** already owes a fresh run of the whole Section 7 matrix; these rows are re-bound to `89f6c1d5` *as owed by 11.3*, not as taken. |
| 5 | `evidence/review-report-linux-oracles-nonauthor.md` (2) - non-author re-derivation of the digest; stages `PKG-P5` | **RE-BOUND.** The re-derivation it performed was of `087d87a5`; the equivalent for `89f6c1d5` was performed twice in this wave but by the author, so the non-author re-derivation is **owed again**. `PKG-P5`'s closure now depends on the new digest. |
| 6 | `evidence/section-9-broker-gate-run-lead2.md` (2) - broker gate run | **RE-BOUND, deliberately not re-taken.** Section 9 is `[MOVES-0.3.0-BROKER]` and unreachable on this host by construction. The broker-client artifact identity above is re-emitted, so 0.3.0 picks up a current binary. |
| 7 | `evidence/f-l2-17-linux-escape-demonstration.md` (1) - records the freeze was unmoved when the escape demo ran | **RE-BOUND.** The demonstrated property (a workload reaching the host session bus) is untouched by this wave. Not re-taken; nothing in it depends on the teardown. |
| 8 | `evidence/direction-replan-input-broker-to-0-3-0.md` (1), `evidence/step1-obligation-tasks.md` (1), `evidence/step1-task-ledger-retier.md` (1) | **HISTORICAL.** Dated planning records that state the freeze as it stood. Correct as written; not receipts. |
| 9 | `handoff/lead-2.md` (2, incl. the lineage line), `lead-4.md` (1), `lead-5.md` (1) | **HISTORICAL.** The lineage is extended by this document; the handoffs are not rewritten. |
| 10 | `tasks.md` (3) - Section 12's own text naming the digest it supersedes | **STAYS.** The task text is *about* superseding `087d87a5`; replacing the value would erase what the wave paid for. |

### Cross-change: needs someone else to act

I did not edit any of these. The LEAD routes them.

| # | Occurrence | What it owes |
| --- | --- | --- |
| 11 | `test/core/session-host/windows-process-authority-package-ci.test.ts:20` - `FROZEN_LINUX_SOURCE_DIGEST`, asserted at "leaves the frozen Linux native tree at its recorded source digest" | **FAILING NOW**, correctly, as a direct result of this authorised freeze break. Windows Change task **10.7**. The constant must become `89f6c1d5270c3ad301f84edde1ae1f67541ac81ca271eb8eaef7871715aba643`. Owner: the worker in the Windows crate. Until then a `windows-latest` CI run reports this as tampering. |
| 12 | `rasen/changes/ecp-windows-process-authority-provider/`: `proposal.md:32`, `design.md:35`, `tasks.md:5`, `evidence/lead2-apply-wave-accounting.md:657`, `evidence/win-crate-freeze-marker.md:138`, `evidence/win-crate-lf-refreeze.md` (10) | Boundary statements of the form "the Linux tree is frozen at `087d87a5`". Their *intent* (that Change must not modify the Linux tree) is unaffected and still holds; the value they quote is stale. Currency update, not a re-take. |
| 13 | `rasen/changes/process-authority-scope-semantics-wording/`: `proposal.md:39`, `design.md:32`, `tasks.md:5` | Says "the Linux `087d87a5` freeze stays intact, so no re-freeze and no re-bind". Still true **of that Change** - it broke nothing. The quoted value is stale. Currency update. |
| 14 | `.rasen/changes/ecp-linux-process-authority-provider/ephemera/auto-run.json` (12), and the `ecp-windows-...` (2) and `process-authority-scope-semantics-wording` (2) equivalents | The freeze markers themselves, including this Change's `implementationFreeze` and its recorded test-file digests. **I am forbidden to write `.rasen/**`.** The Linux marker must be updated to `89f6c1d5` with new test-file digests, or the run-state asserts a freeze the tree does not have. Highest-value cross-change row after #11. |
| 15 | `.gitattributes:26` - a comment reading "frozen digest 087d87a5 held only because this working tree happens to be all-LF" | The LF pin rule itself is unaffected and still correct. Comment carries a stale value. Shared file with concurrent Windows work, so left untouched deliberately. |

### What ECP-8 may consume

Per task 12.3, ECP-8's zero-orphan receipt consumes only evidence bound to `89f6c1d5`. As of this
document that is: this file's 12.2 oracle results and mutation receipt, and the re-emitted manifest.
It is **not** the Section 7 TypeScript oracle rows (#4), which are re-bound-as-owed and must come
through task 11.3.

## Not claimed

1. **The production daemon does not pass the endpoint.** The property is established at the native
   seam and is exercised end-to-end by a real daemon process in the oracle, but
   `src/core/session-host/process-authority/linux/native-assembly.ts` still spawns `prepare`
   without `--daemon-lifetime-fd`, so a scope created by the Node daemon today is **unbound**. The
   remaining work is precise: `spawnPinned` already passes `stdio: ['pipe','pipe','pipe', fd3]`, so
   slot 4 is free for a `'pipe'`; Node must retain `child.stdio[4]` per scope for the scope's whole
   life and release it on a terminal outcome. It was deliberately not done in this wave - it is a
   session-host lifecycle change whose failure mode is *killing a live scope early*, and it cannot
   be verified here without a packaged `dist/`, which this wave is forbidden to build. **Until it
   lands, no production Linux scope has the daemon-lifetime property**, and no receipt here says
   otherwise.
2. **`--daemon-lifetime-fd` is optional, by decision.** Making it mandatory would have broken every
   current caller, including production `prepare`, in a wave that cannot run the TypeScript suites.
   The cost is that an unwired caller silently gets an unbound scope; that is stated here rather
   than hidden, and item 1 is the fix.
3. **Reversed polarity is untested.** If a daemon passed the *write* end instead, Linux would report
   `POLLERR` and `check_daemon_lifetime` would tear down. That path is coded for and never
   exercised.
4. **No claim about `execution-lost`** typing or committed-frontier resume. Owed by
   `ecp-frozen-action-session-executor`.
5. **No claim about the broker path**, cgroup-v2, Section 9, packaging, install, CI, ProcessScope or
   SessionHost integration, production default selection, Change closure, or ECP-8 release truth.
6. **The broker native suites were not run** against the changed crate (see the regression section).
7. **Author == verifier throughout.** Nothing here has been reproduced by anyone else. The
   non-author re-derivation of the new digest (#5 above) is owed.
