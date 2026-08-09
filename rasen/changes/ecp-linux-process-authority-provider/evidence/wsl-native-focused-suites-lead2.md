# WSL native focused cargo suites — Track A receipt (LEAD 2)

Date: 2026-08-07

## Boundary

This receipt closes ONLY the native test matrices behind tasks 4.7 and 5.8. It does NOT close:

- Section 9 (installed-broker cgroup-v2 gate);
- Section 7 actual-kernel oracles;
- package install support;
- production default selection of the Linux provider;
- ECP-8 release truth.

It is a same-kernel test receipt for the crate at
`native/linux-process-authority`, nothing wider.

## Reproducible environment

- WSL distribution: `Ubuntu 24.04.1 LTS`.
- Kernel: `Linux Sayo 5.15.167.4-microsoft-standard-WSL2 #1 SMP Tue Nov 5 00:21:55 UTC 2024 x86_64 x86_64 x86_64 GNU/Linux`.
- `rustc 1.88.0 (6b00bc388 2025-06-23)`, LLVM `20.1.5`.
- `cargo 1.88.0 (873a06493 2025-05-10)`.
- `RUSTUP_HOME=/home/sayo/.local/share/rasen-rustup-1.28.2`
- `CARGO_HOME=/home/sayo/.local/share/rasen-cargo-1.28.2`
- `CARGO_TARGET_DIR=/home/sayo/.local/share/rasen-build/lead2-track-a-target` (WSL ext4; `/mnt/e` was
  deliberately avoided because it had only 27G free while ext4 `/` had 946G).
- Target triple: `x86_64-unknown-linux-gnu`.

### Linker provisioning (unprivileged, no system mutation)

The isolated WSL Rust installation has no host C linker: `cc`, `gcc`, `clang`, `musl-gcc`, and
`x86_64-linux-gnu-gcc` are all absent, and `/usr/lib/x86_64-linux-gnu/crt1.o` does not exist. `sudo`
requires a password and was not available, so no package was installed.

Host build scripts and the final link were served by a private build-owned `cc` wrapper delegating to
the already-present Zig toolchain, matching the round-5 build manifest convention:

```text
/home/sayo/.local/share/rasen-build/lead2-track-a-cc/cc
  -> exec /home/sayo/.local/share/zig-x86_64-linux-0.16.0/zig cc "$@"
```

- Zig version: `0.16.0`.
- Zig caches were redirected to ext4 via `ZIG_GLOBAL_CACHE_DIR` / `ZIG_LOCAL_CACHE_DIR`.
- The wrapper lives outside the repository, was prepended to `PATH` for the build child only, and no
  shell profile, system path, or system package was modified.

## Command 1 — `--lib` partial-construction matrix (task 4.7)

```text
cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu --lib \
  partial_construction_failure_matrix_reaps_guardian_and_keeps_workload_inert
```

```text
running 1 test
test primary::construction_matrix_tests::partial_construction_failure_matrix_reaps_guardian_and_keeps_workload_inert ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out; finished in 7.79s
```

Coverage check performed on the source rather than trusting the name: `ConstructionCheckpoint`
(`src/primary.rs:436-455`) declares exactly 18 variants, and the matrix array
(`src/primary.rs:2492-2511`) injects a failure at all 18, in declaration order — from `ScopeCreated`
through `FinalParentRevalidation`. That is "runtime-directory creation through final revalidation"
as task 4.7 words it.

The fault seam is test-only: production prepare uses `NoopConstructionObserver`
(`src/primary.rs:465-484`), and the injecting `FailingObserver` is defined inside the
`#[cfg(test)] mod construction_matrix_tests`. No fault selector exists in the helper argv, env, or
frame schemas.

## Command 2 — `--test lifecycle_contract` (task 5.8)

```text
cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu --test lifecycle_contract
```

```text
running 6 tests
test activation_is_exactly_once_and_publication_is_not_a_native_event ... ok
test prepared_abort_reaches_exact_empty_without_activation_or_root_exit ... ok
test root_exit_is_exact_and_does_not_imply_empty ... ok
test root_exit_is_journaled_before_a_separate_kernel_empty_proof ... ok
test event_sequences_and_root_status_are_closed ... ok
test root_status_corruption_matrix_is_retained_and_never_empty ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
```

## Command 3 — `--test linux_primary_contract` (tasks 4.7 and 5.8)

```text
cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu --test linux_primary_contract
```

```text
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.84s
```

This suite FAILED on the first run and was fixed; see the defect section below.

## Command 4 — `--test linux_journal_contract` (task 5.8)

```text
cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu --test linux_journal_contract
```

```text
running 2 tests
test journal_fsyncs_monotonic_events_and_atomic_terminal_state ... ok
test terminal_record_crash_matrix_reopens_without_optimistic_state ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.59s
```

## Defect found and fixed — `guardian_forced_death_proves_teardown_without_fabricating_root_status`

### Observed

The test failed, reproducibly and in isolation under `--test-threads=1`:

```text
thread 'guardian_forced_death_proves_teardown_without_fabricating_root_status' panicked at
tests/linux_primary_contract.rs:938:5:
helper inspect returned failure
```

Instrumenting a throwaway ext4 copy of the crate (never the worktree) captured the helper's exact
response:

```text
status = ExitStatus(unix_wait_status(17920))     -> exit code 70
stdout = 525041310001ff0000000003000109
stderr = <empty>
```

That frame decodes as `RPA1`, protocol version 1, `FrameKind::Failure`, payload `00 01 09` —
`NativeFailureCode::StateRetained` (`src/protocol.rs:94`, `:217`).

### Root cause — test defect, not a product defect

The helper's control-argument contract requires every control operation to carry `--deadline-ms`.
`runtime_root()` (`src/main.rs:36-44`) rejects any argv whose length is not `3 + extra`, and
`inspect` passes `extra = 2` (`src/main.rs:104`), so the accepted form is exactly:

```text
inspect --runtime-root <root> --deadline-ms <ms>
```

The test spawned the helper with only `["inspect", "--runtime-root", <root>]`. The helper therefore
failed argument validation with `io::ErrorKind::InvalidInput`, which
`NativeFailureCode::from_control_error` maps to `StateRetained` (`src/protocol.rs:178`), and exited
70 — before reaching any guardian-death classification code.

The production contract is correct and uniform, and the production TypeScript caller already builds
the right argv: `controlArguments()` in
`src/core/session-host/process-authority/linux/native-assembly.ts:573-582` emits
`[operation, '--runtime-root', runtimeRoot, '--deadline-ms', String(deadlineMs)]`. So the product
was right and only the Rust test's invocation was wrong.

This was a vacuity defect, not merely a red test: the test named the behaviour
"proves teardown without fabricating root status" but bounced off argument parsing and never
exercised that behaviour at all.

### Fix

`native/linux-process-authority/tests/linux_primary_contract.rs` — two lines added to the helper
argv so the invocation matches the production contract:

```rust
            "inspect",
            "--runtime-root",
            runtime.to_str().expect("short test runtime is utf8"),
            "--deadline-ms",
            "5000",
```

No assertion was weakened, added, or removed. This is the only source change in this receipt.

### Proof the fixed test is load-bearing

Passing after an argv fix is not by itself proof the test now checks anything, so the fixed test was
run against a deliberately mutated product in a throwaway ext4 copy. The mutation makes
`kernel_exact_empty_evidence` (`src/primary.rs:335-357`) fabricate a root result the kernel never
proved, by pushing a `RootExited` event in the `Prepared | Activated` arm before the exact-empty
event:

```text
thread 'guardian_forced_death_proves_teardown_without_fabricating_root_status' panicked at
tests/linux_primary_contract.rs:950:5:
helper fabricated a root result after guardian death

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 28 filtered out
```

The test detects root-status fabrication. Before the argv fix it could not have detected it, because
it never got past the helper's argument validation. The mutated copy and its target directory were
deleted afterwards; the worktree never held the mutation.

## `pinned_leaf_descriptor_never_writes_to_a_path_replacement` investigation

The historical report of a `pinnedall` vs `pinnedement` mismatch does NOT reproduce on the current
source. The test passes as written:

```text
cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu --lib \
  pinned_leaf_descriptor_never_writes_to_a_path_replacement
```

```text
running 1 test
test broker_cgroup::linux::tests::pinned_leaf_descriptor_never_writes_to_a_path_replacement ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out; finished in 0.00s
```

No product change and no test change were made. The existing `b"pinnedal"` expectation is correct:
`b"pinned"` (6 bytes) written at offset 0 with `O_WRONLY` and no `O_TRUNC` over `b"original"`
(8 bytes) leaves `b"pinnedal"` in the renamed-away `held/cgroup.kill`.

Because "it passes" is not evidence that it would catch the defect it exists to catch, the test was
run against a mutated `openat_file` (`src/broker_cgroup.rs:808-821`) in a throwaway copy, changed to
resolve the control file by NAME through the parent directory instead of through the pinned leaf
descriptor — exactly the path-replacement attack the test is named for:

```text
assertion `left == right` failed
  left: [111, 114, 105, 103, 105, 110, 97, 108]     ("original")
 right: [112, 105, 110, 110, 101, 100, 97, 108]     ("pinnedal")

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 8 filtered out
```

Under the mutation the write landed in the freshly created replacement leaf and `held/cgroup.kill`
kept its original bytes, so the test failed. The pinned-fd behaviour is genuinely enforced by
`openat_file`, and the test genuinely proves it.

## `cargo fmt --all --check`

CLEAN, both before and after the one-line-pair test fix.

```text
cd native/linux-process-authority && cargo fmt --all --check
EXIT=0
```

Zero `Diff in ...` lines were emitted, so `cargo fmt --all` was NOT run and rewrote nothing. The
reported pre-existing formatting difference in `tests/linux_primary_contract.rs` does not exist on
the current tree — either it was already resolved before this receipt, or the earlier check ran from
a directory without a Cargo manifest (there is no workspace `Cargo.toml` at the repository root;
this crate is standalone, so `cargo fmt` must be run from the crate directory or with
`--manifest-path`).

A separate scan confirmed every `.rs` file under `native/linux-process-authority` is pure LF with
zero trailing whitespace, so the CI `git diff --check` gate has nothing to catch here.

## Zero hidden skips

- There is NO `#[ignore]` attribute anywhere in `native/linux-process-authority` (src or tests).
  Every reported result line above shows `0 ignored`.
- No test was filtered away silently. The `8 filtered out` in the two `--lib` runs is the expected
  consequence of passing a name filter: the lib target holds exactly 9 unit tests
  (`cargo test --lib -- --list` reports `9 tests, 0 benchmarks`), so a single-name filter leaves 8.
  The other 8 are real, runnable tests: `broker_guardian::tests::broker_prepare_and_reference_codecs_are_closed_and_bounded`,
  `broker_supervisor::tests::authenticated_client_hup_cancels_the_worker_before_commit`,
  `broker_supervisor::tests::authenticated_client_pidfd_death_cancels_the_worker_before_commit`,
  `broker_supervisor::tests::deadline_kills_and_reaps_the_exact_worker_before_late_mutation`,
  `broker_supervisor::tests::operation_longer_than_two_seconds_succeeds_under_the_original_deadline`,
  `journal::tests::atomic_write_crash_checkpoints_reopen_retained_or_authentic_terminal`,
  `primary::actual_fd_tests::proc_fallback_closes_high_fd_after_nofile_limit_is_lowered`, and
  `broker_cgroup::linux::tests::pinned_leaf_descriptor_never_writes_to_a_path_replacement`.
  This receipt does not claim those 8 as run.
- The three `--test` suites each report `0 filtered out`; nothing was excluded.

### Honest qualification on the `29 passed` headline

9 of the 29 tests in `linux_primary_contract` are `*_fixture` entrypoints that the suite re-executes
as child processes. As top-level tests they early-return when their gate environment variable is
absent, so they contribute a pass without asserting anything at top level. They are NOT `#[ignore]`d
and they DO perform their real work — but only inside the child process their parent test spawns.
The gated fixtures are `workload_cannot_reach_authority_state_fixture` (`RPA_ATTACK_RUNTIME_ROOT`),
`guardian_death_workload_fixture` (`RPA_GUARDIAN_DEATH_MARKER`),
`nonreading_full_output_workload_fixture` (`RPA_BACKPRESSURE_FIXTURE`),
`nondumpable_replacement_fixture` (`RPA_NONDUMPABLE_GATE`),
`inherited_high_fd_is_closed_fixture` (`RPA_EXPECT_CLOSED_FD`),
`final_child_order_fixture` (`RPA_FINAL_CHILD_GATE`),
`unavailable_configuration_fixture` (`RPA_UNAVAILABLE_SELECTOR`), and
`setpgid_resistant_descendant_fixture` (`RPA_SETPGID_MARKER`).

`recursive_workload_fixture` (`tests/linux_primary_contract.rs:1791`) is different and worth naming:
its body is empty under all conditions. It is documented as a retained harness-selection oracle, but
as a test it asserts nothing and can never fail. It is an unconditional vacuous pass inside the
`29 passed` count.

So the honest reading of command 3 is: 20 top-level asserting tests passed, plus 9 fixture
entrypoints, of which 8 do real work only as spawned children and 1 is empty.

## Open items routed to the review wave

1. `inspect`, `activate`, and `open-runtime` require `--deadline-ms` and validate it via
   `bounded_u32`, but then discard the parsed value (`src/main.rs:116`, `:136`, `:147` — the call
   result is not bound). Only `abort` and `terminate` consume their deadline. The argument is load-
   bearing for argv-shape validation but inert for behaviour, which is what let the malformed test
   invocation look like a state-retained control failure instead of a usage error.
2. The 18-checkpoint matrix array in `partial_construction_failure_matrix_...` is a hand-maintained
   literal with no compile-time link to `enum ConstructionCheckpoint`. It is exhaustive today, but a
   19th variant would silently escape the matrix while task 4.7 still claims "every injected failure
   point". A match-based exhaustiveness binding would make that regression impossible.
3. `recursive_workload_fixture` is an empty test body (see above).

## Verdict

- Task 4.7 native matrix: VERIFIED on this WSL kernel.
- Task 5.8 native matrices: VERIFIED on this WSL kernel.

Both verdicts are scoped strictly to "the named native suites executed to completion and passed on
kernel 5.15.167.4-microsoft-standard-WSL2". Whether those suites are a sufficient proof of the task
text remains a review-wave judgement, not a claim of this receipt.

# Follow-up round — P1, P2, P3 (LEAD assignment)

Same environment as above. Appended rather than filed separately, per the LEAD.

## P1 — `recursive_workload_fixture`: leftover, not a prop. No ticked task is affected.

**It has zero callers.** A repo-wide search for `recursive_workload_fixture` across `*.rs`, `*.ts`,
`*.mjs`, and `*.md` returns only its own definition and prose references in evidence files. No test
spawns it, and no proof depends on it.

The real nested-PID-namespace proof is a genuine, barrier-based test inside
`actual_namespace_prepare_is_inert_then_aborts_or_activates_to_exact_empty`
(`tests/linux_primary_contract.rs:556-616`). It runs

```text
/usr/bin/unshare --user --pid --fork --mount-proc /bin/sh -c
  "setsid /bin/sh -c 'sleep 0.2; printf nested' & wait"
```

and asserts that the `nested` bytes reached the workload output (the detached, `setsid`-escaped,
nested-namespace descendant was actually awaited), that `ExactScopeEmpty` was never emitted before
`RootExited`, that the root exit is exactly `Code(0)`, and that inspect reports `exact-scope-empty`.
That is kernel-fact and barrier based, with no sleep-sampling and no PID-tree traversal.

**Task accounting.** Task 5.3 ("nested PID-namespace processes") is genuinely backed by that test,
which is inside verified suite [3]. Ticked task 7.4 (`setsid()` plus detached double-fork
survival/recursive-kill, PGID independence) is backed by
`setpgid_orphan_keeps_scope_live_until_exact_pidfd_force` and `setpgid_resistant_descendant_fixture`,
neither of which is the empty fixture. Task 7.8 is not ticked. **Nothing needs unticking.**

**The LEAD's instruction to "fix the fixture so it does the real work" cannot be carried out, and
should not be.** The fixture is a test-harness entrypoint, and creating a user namespace in-process
is impossible there. Probed directly rather than assumed:

```text
PROBE unshare(CLONE_NEWUSER) rc=-1 errno=EINVAL (os error 22) Threads: 2   [default harness]
PROBE unshare(CLONE_NEWUSER) rc=-1 errno=EINVAL (os error 22) Threads: 2   [--test-threads=1]
```

`CLONE_NEWUSER` requires a single-threaded caller, and the Rust test harness always carries a second
thread even at `--test-threads=1`. The original author's routing through `/usr/bin/unshare` is
therefore correct engineering, not a shortcut.

**Action taken:** the empty fixture was deleted, and its one piece of real knowledge — why the nested
namespace is created by `/usr/bin/unshare` rather than in-process — was moved to a comment at the
real test site, where it is actionable. `linux_primary_contract` dropped 29 -> 28 and stayed green.

## P2 — compile-time exhaustiveness binding: DONE and proven

`src/primary.rs` now carries `CONSTRUCTION_CHECKPOINTS: [ConstructionCheckpoint; 18]` plus
`checkpoint_position()`, a wildcard-free match from variant to matrix index, both inside
`#[cfg(test)] mod construction_matrix_tests`. The matrix test additionally asserts that every array
entry maps back to its own index, which catches duplication or reordering.

Proven by adding a 19th variant (`LateSandboxSealed`) to a throwaway copy:

```text
error[E0004]: non-exhaustive patterns: `primary::ConstructionCheckpoint::LateSandboxSealed` not covered
    --> src/primary.rs:2522:15
error: could not compile `rasen-linux-process-authority` (lib test) due to 1 previous error
```

A new checkpoint is now a build failure, not a silent coverage hole. Nothing was added to production
argv, env, or frame schemas.

Residual, stated honestly: the compile error fires on the match. If an author resolved it by adding
an index without extending `CONSTRUCTION_CHECKPOINTS`, the array-length mismatch is what would stop
them next. Rust has no variant enumeration without a derive macro, and adding a dependency to this
deliberately minimal pinned crate was out of scope, so the compile error plus the doc comment on the
array are the forcing function.

## P3 — verdict (a): a real product bug. Fixed for `activate`; the rest routed back.

**Verdict: (a) a real bug — specifically an incomplete wiring, not an argv-uniformity choice.**

Four independent pieces of evidence:

1. `AuthorityClient::activate_until(deadline)` (`src/primary.rs:118`) is `pub` and, before this fix,
   had **no caller anywhere** except `activate()` itself. A deadline-accepting public method with no
   production caller is unfinished wiring, not a design decision. (The `activate_until` names in
   `broker_guardian.rs` / `broker_service.rs` are different methods on different types.)
2. The CLI validated the value with `bounded_u32` and discarded it. Validating an argument you intend
   to ignore is not a uniformity choice.
3. The caller genuinely computes a budget: `remainingBudgetMs()`
   (`native-assembly.ts:209-215`) returns `min(300_000, deadline - now)` and throws at `<= 0`.
4. The bounds line up exactly. TS can emit `[1, 300_000]`; `AbsoluteMonotonicDeadline::after_ms`
   rejects `0` and anything above `MAX_BROKER_PHASE` = 300s. The TS clamp and the native bound were
   designed for each other; only `main.rs` failed to connect them.

Consequence of the bug: the caller's budget was silently replaced by the fixed 2-second
`CONTROL_TIMEOUT`. It fails early rather than late, so it is not a security hole, but it made
`--deadline-ms` a lie on that path and is a plausible source of later "WSL flake" misdiagnosis.

**Fix applied** (`src/main.rs`): the `activate` arm now calls
`client.activate_until(AbsoluteMonotonicDeadline::after_ms(bounded_u32(&arguments[4])?)?)`. This
introduces no new deadline implementation — it uses the existing one that was already built for this
purpose.

**Deliberately NOT fixed:** `inspect`, `open-runtime`, and `terminate` still discard their deadline.
Honouring them requires new `_until` seams threaded through `control` / `control_on` /
`inspect_evidence`, which would be a second deadline implementation in the control path — the exact
thing this change's invariants forbid. That is a scope decision for the LEAD and the review wave, not
something to do unilaterally during a freeze.

### The first guard test was vacuous; recording that, because it nearly shipped

The first version of the regression test asserted only `!output.status.success()` plus
`frame.kind == Failure`. It passed against the reverted product — a false guard. The cause is that a
CLI `activate` against an in-process-prepared scope **always** fails, because the control capability
is one-use and cannot be replayed from another process. Measured directly:

```text
FIXED     OUT_OF_BOUND (999999999)  -> 525041310001ff0000000003000109   code 09 StateRetained
FIXED     VALID        (5000)       -> 525041310001ff0000000003000107   code 07 ReferenceInvalid
REVERTED  OUT_OF_BOUND (999999999)  -> 525041310001ff0000000003000107   code 07 ReferenceInvalid
```

The failure *code* is the discriminator; the exit status is not. The test
`cli_activate_rejects_a_deadline_outside_the_broker_phase_bound`
(`tests/linux_primary_contract.rs`) now asserts `NativeFailureCode::StateRetained` exactly, and is
load-bearing:

```text
assertion `left == right` failed: activation deadline was discarded instead of bounded
  left: ReferenceInvalid
 right: StateRetained
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 28 filtered out
```

This is the same defect class the review record keeps catching — an assertion that holds for a reason
unrelated to the property it claims to test — and it is recorded here rather than quietly corrected.

## Post-follow-up state

```text
lib matrix (4.7)        test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out
lib pinned_leaf         test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out
full --lib              test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
lifecycle_contract      test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
linux_primary_contract  test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
linux_journal_contract  test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
cargo fmt --all --check EXIT=0
```

`linux_primary_contract` reads 29 again, but the composition changed and is now cleaner: 29 = 21
asserting tests + 8 gated fixture entrypoints. The unconditionally-empty ninth fixture is gone and a
real deadline test replaced it. The 8 remaining fixtures still contribute a top-level pass without
asserting anything, and still do their real work only inside the child processes their parents spawn.

## Source digest impact

`sourceDigest()` covers `Cargo.lock`, `Cargo.toml`, `THIRD_PARTY.md`, and `src/**`, and excludes
`tests/`. P2 and P3 both touched `src/`, so the crate digest moved:

```text
before follow-up: 826fa04851d152f3bedc60dffc5e0f1a8895d55bdf26422fa12197b1f87dfc6f
after  follow-up: a568f53bffb6046dfce499522790d88479e1883cbcb908097cf665a63b183a42
```

Any helper built from `826fa048…` is stale. Track B was notified directly, including the behavioural
note that `activate` now honours the caller budget.

## Files changed in the follow-up

- `native/linux-process-authority/src/main.rs` — P3 fix plus one import.
- `native/linux-process-authority/src/primary.rs` — P2 binding, test-module only.
- `native/linux-process-authority/tests/linux_primary_contract.rs` — P1 deletion, relocated comment,
  P3 regression test, one import.

Nothing outside `native/linux-process-authority/**` was touched. All throwaway mutation copies and
their target directories were deleted; the worktree never held a mutation.

# PRODUCTION BEHAVIOURAL CHANGE — explicit callout

The P3 fix is **not** a test fix. It changes how the shipped helper behaves. Recording it plainly.

## What changed

`src/main.rs`, the `activate` arm. Before, the helper parsed `--deadline-ms` with `bounded_u32` and
threw the value away, then called `client.activate()`, which hardcodes the internal 2-second
`CONTROL_TIMEOUT`. After, it calls
`client.activate_until(AbsoluteMonotonicDeadline::after_ms(bounded_u32(&arguments[4])?)?)`.

Observable differences for any caller:

| Caller budget | Before | After |
| --- | --- | --- |
| greater than 2s (the normal case) | silently capped at 2s | full caller budget honoured |
| less than 2s (possible near budget exhaustion) | silently widened to 2s | caller budget honoured, stricter |
| `0`, or greater than `MAX_BROKER_PHASE` (300s) | silently replaced by 2s | fails closed, `StateRetained` |

The TypeScript caller can only emit `[1, 300_000]` (`remainingBudgetMs` returns
`min(300_000, remaining)` and throws at `<= 0`), which sits entirely inside the valid range of
`after_ms`, so no legitimate caller value is newly rejected.

## Why activate was wrong before

`AuthorityClient::activate_until(deadline)` (`src/primary.rs:118`) is `pub`, accepts an explicit
deadline, and before this fix had no caller anywhere except `activate()` itself. The CLI validated
the caller's budget and discarded it. The TS clamp at 300_000 and the native `MAX_BROKER_PHASE` of
300s were plainly designed for each other. That is an unfinished wire, not a design decision.

## Why `inspect` and `open-runtime` were NOT also fixed — they are NOT "correct as-is"

Stating this precisely because it would be easy to misread the split as a judgement that the other
routes are fine. They are not fine. `inspect` (`src/main.rs:~148`), `open-runtime` (`~117`), and the
deadline argument of `terminate` still parse their budget and discard it, and that is the same defect
as the one fixed for `activate`.

They were left alone for one reason: honouring them requires new `_until` seams threaded through
`control`, `control_on`, and `inspect_evidence`, which would introduce **a second deadline
implementation in the control path** — the exact thing this change's invariants forbid. Fixing
`activate` needed no new plumbing because the deadline-accepting method already existed. Extending
the pattern does need new plumbing, so it is a scope decision for the LEAD and the review wave, not
something to take unilaterally during a freeze.

So the split is deliberate as a *stopping point*, and is not work in progress in the sense of being
half-finished and unattended. But the remaining routes are known-defective and are hereby recorded as
such, not signed off.

## Interaction with the open Blocker `BRK-R2-B06`

**The ground moved slightly, in the same direction, on an adjacent path. This does NOT close
`BRK-R2-B06`, and no closure is claimed** — closing findings is review-wave work.

What `BRK-R2-B06` is (`review-report-native-broker-round-3.md:82-115`): mutating **broker daemon**
work is not governed by the absolute deadline. Its evidence cites `broker_service.rs:282-303,487-516`,
`broker_guardian.rs:482-486,546-606`, and the detached daemon thread in the broker binary. Its
required fix is to thread the absolute monotonic deadline through daemon dispatch, recoverable
guardian prepare, activation, inspection, runtime-open, publication, and every blocking
socket/fsync/wait, rechecking remaining time before any irreversible transition.

How this change relates:

1. **Different path.** The fix is in the primary user-pidns helper CLI and `AuthorityClient`, not in
   the installed privileged broker daemon where `BRK-R2-B06` is filed. Nothing in the broker path
   changed.
2. **Same defect class, and this is the part the review wave should note.** `BRK-R2-B06`'s required
   fix explicitly enumerates "activation, inspection, runtime-open". The primary helper CLI was
   discarding its deadline on exactly `activate`, `inspect`, and `open-runtime`. The temporal defect
   documented for the broker path therefore has a direct analogue on the primary path, which the
   finding as written does not cover. **`BRK-R2-B06` may be under-scoped.** Flagging, not reranking.
3. **Partial, on the analogue only.** Primary-path `activate` is now bounded by the caller's budget
   instead of a fixed 2s. Primary-path `inspect` and `open-runtime` are still unbounded by the
   caller. No boundary, stalled-guardian, delayed-response, or late-result-quarantine tests were
   added, and `BRK-R2-B06`'s required fix demands them.
4. **It does not deliver an *absolute* deadline, which is what the Blocker is actually about.**
   `after_ms` re-anchors the budget to the moment the helper child reaches that line, so process
   spawn, argv validation, and the stdin frame read all happen before the clock starts. The caller's
   end-to-end absolute deadline is still not represented natively; the value crossing the boundary is
   a remaining-time delta, re-anchored later. For a bounded-operation improvement that is fine; for
   `BRK-R2-B06`'s "absolute monotonic deadline threaded end to end" it is not sufficient.

Net: treat this as a small improvement to an adjacent path plus one new piece of information for the
Blocker's scope. `BRK-R2-B06` remains OPEN.

# Hands-off state

No further edits will be made under `native/linux-process-authority/**`.

```text
src/main.rs                     mtime 2026-08-07 00:59:26 +0800
src/primary.rs                  mtime 2026-08-07 00:56:05 +0800
tests/linux_primary_contract.rs mtime 2026-08-07 01:06:56 +0800
                                sha256 7d56ca4e5169967a8c6877c1a9b37cfaaf552bd90d44dc3d0e56521305b192b1

final sourceSha256 (26 files: Cargo.lock, Cargo.toml, THIRD_PARTY.md, src/**)
a568f53bffb6046dfce499522790d88479e1883cbcb908097cf665a63b183a42
```

Confirming run taken after the tree went still, so every line below binds to `a568f53b…` and to the
test source hash above:

```text
--lib (all 9)           test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
lifecycle_contract      test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
linux_primary_contract  test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
linux_journal_contract  test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
cargo fmt --all --check EXIT=0
```

Earlier receipts in this file were taken against intermediate trees (`826fa048…` and `137402cb…`) and
are superseded by the block above for binding purposes. The intermediate results are retained rather
than deleted because the defects they exposed are the substance of this receipt.
