# Native Linux primary ready-hook seam review — round 1

Date: 2026-08-06
Mode: fresh independent, dispatched/report-only
Verdict: **FAIL — 2 open findings (0 Blocker, 2 Major, 0 Minor, 0 Trivial)**

## Scope and integrity

This pass reviewed only the broker-fixer-introduced primary ready-hook seam, its direct production
caller, and its focused regression. It is distinct from the already reviewed `NATIVE-B005`
foreign-target helper locator and does not claim any Section 9 installed-broker/cgroup-v2 terminal
evidence. No product source, test, task, run-state, portfolio, commit, or other report was modified.

Reviewed source hashes remained stable through the pass:

```text
primary.rs                    40d5231a99f1582b82123fd6758a084d7730b0840fc2c5b9fc89587868dda6ea
linux_primary_contract.rs     741df44df9dfdb5e0cc5e1c5b7b6609e830b436f5be0fc742950b8235838403b
broker_guardian.rs            0d22e991ad54e2a6f63fe0f7ae922e09641ec90a259b2045ae700ebb13cf7472
broker_service.rs             1fc7cff8a3344e73ef09be16a2be02766bc6a6d55c89296e08c60ae0acee6579
main.rs                       d1969c503dac2743fc5894fe1231746644582b4be52b2be19df6eee521f3fdd1
lib.rs                        d8d250ce7c4a849d818cee4935441c21fe24b568aaf3c68a8b30b91055f393c0
```

## Standards axis

### `NATIVE-SEAM-R1-M01` — Major — production ready-hook work can outlive the absolute prepare deadline indefinitely

**Locations:** `native/linux-process-authority/src/primary.rs:339-347,457-478`;
`native/linux-process-authority/src/broker_guardian.rs:357-405,546-564,582-606,707-724`;
`native/linux-process-authority/src/broker_service.rs:282-303,341-373`

`prepare_primary_with_ready_hook` accepts only an unbounded `FnOnce` and calls it inline. The
production hook performs `write_all` plus `File::sync_all()`. The broker validates that the request
deadline has not already expired, but neither passes the deadline into preparation nor supervises
the caller-mapped worker: the parent performs blocking `read_exact` and blocking `waitpid(..., 0)`.
A stalled filesystem write/fsync can therefore keep prepare and its inert guardian alive after the
one absolute request deadline has expired. This violates the spec requirement that every prepare
honor the common deadline/abort context and settle once. The ordinary primary CLI remains
unaffected because it supplies the immediate no-op hook, but the seam's intended production broker
consumer is not time-bounded.

**Required fix:** thread the absolute monotonic deadline into recoverable preparation and supervise
the caller-mapped worker/result fd with the remaining budget. On expiry, kill/reap the worker and
reconcile the exact construction record/guardian before returning `timeout`; do not rely on a
deadline check before entering an uninterruptible fsync.

### `NATIVE-SEAM-R1-M02` — Major — the focused oracle does not prove the defining pre-readiness ordering

**Locations:** `native/linux-process-authority/src/primary.rs:429-478,499-535`;
`native/linux-process-authority/tests/linux_primary_contract.rs:217-250`

The current source ordering is correct: the child emits `N` and blocks reading its identity;
the parent builds and validates the exact attestation, invokes the hook, and only after hook success
writes that identity; the child then creates/binds the durable journal and emits final `R` readiness.
Hook failure is also routed through the exact existing `kill_and_reap` plus scope cleanup path.

However, `pre_readiness_hook_failure_reaps_the_exact_inert_guardian` observes only that the hook saw
an attestation and that, after an injected error, the guardian is absent and the runtime directory
is empty. Moving the hook to immediately after `expect_byte(..., b'R', ...)` would leave every
assertion green while reopening the exact after-readiness/before-durable-reference construction
death window this seam exists to close. The test is meaningful cleanup evidence, but it is not a
meaningful oracle for the seam's defining ordering invariant.

**Required fix:** add a deterministic barrier-based mutation that holds the hook open while another
test thread proves the guardian has not completed final readiness/cannot serve an authenticated
control operation, then releases the hook and proves prepare completes. Retain the current
hook-error cleanup oracle as a separate assertion, preferably with a workload marker proving the
failed prepare never executed workload code.

Standards result: **2 findings; worst Major.**

## Spec axis

The seam preserves the existing primary entry point and current production behavior:

- `prepare_primary(...)` is still the ordinary API and delegates only to an immediate no-op hook
  (`primary.rs:331-337`).
- The production helper CLI imports and calls only `prepare_primary(...)`; no argv, environment,
  protocol frame, launch field, or caller-controlled value selects an arbitrary hook
  (`main.rs:8-10,61-81`).
- The only production non-no-op caller is the statically compiled broker closure. Before invoking
  it, the worker drops to the authenticated caller uid/gid, verifies that transition, closes all
  unrelated descriptors, and clears its environment (`broker_guardian.rs:517-546`).
- The hook is `FnOnce` and receives only `&PreparedPrimary`; it cannot mutate the returned exact
  attestation. The broker persists a bounded encoded clone and later requires byte-identical output
  (`broker_guardian.rs:550-578`).

Thus the hook is not test-only, but its activation and data authority are statically bounded: no
untrusted runtime input can inject a closure or switch the ordinary helper onto this path. The
remaining spec failure is temporal boundedness (`NATIVE-SEAM-R1-M01`), plus the missing regression
oracle for the safety-critical ordering (`NATIVE-SEAM-R1-M02`).

Spec result: **current call/order/trust behavior is correct; deadline compliance and proof coverage
are incomplete, so the seam is non-terminal.**

## Verification receipts

All build and Rust temp roots were explicitly placed on `E:`.

```text
CARGO_TARGET_DIR=E:\tmp\rpa-primary-seam-review-r1-win
TEMP/TMP=E:\tmp\rpa-primary-seam-review-r1-temp
rustup run 1.88.0 cargo test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml
result: PASS — Windows host 58 passed, 0 failed, 0 ignored
```

Fresh static-musl primary test build:

```text
CARGO_TARGET_DIR=E:\tmp\rpa-primary-seam-review-r1-musl
TEMP/TMP=E:\tmp\rpa-primary-seam-review-r1-musl-temp
RUSTFLAGS=-C linker=rust-lld
rustup run 1.88.0 cargo test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-musl \
  --test linux_primary_contract --no-run
result: PASS

test ELF:
  E:\tmp\rpa-primary-seam-review-r1-musl\x86_64-unknown-linux-musl\debug\deps\linux_primary_contract-1de3b0aeba4c2f07
  length: 14215992
  SHA-256: d89014aae77855621b27d226a89d42b703aa88177264f00102eb556c7bb6358f

helper ELF:
  E:\tmp\rpa-primary-seam-review-r1-musl\x86_64-unknown-linux-musl\debug\rasen-linux-process-authority
  length: 10751928
  SHA-256: 4c6591dc8e0b518cc9bc2316d22ba7d516dd7bdea3c03511f6738737764bf5c4
```

Actual WSL execution of that fresh ELF:

```text
WSL distribution: Ubuntu-24.04
kernel: Linux 5.15.167.4-microsoft-standard-WSL2 x86_64

/mnt/e/tmp/rpa-primary-seam-review-r1-musl/x86_64-unknown-linux-musl/debug/deps/\
linux_primary_contract-1de3b0aeba4c2f07 \
  --exact pre_readiness_hook_failure_reaps_the_exact_inert_guardian \
  --nocapture --test-threads=1
result: PASS — 1 passed, 0 failed, 22 filtered out

same fresh ELF --test-threads=1
result: PASS — primary matrix 23 passed, 0 failed, 0 ignored
```

Additional compile/format checks:

```text
rustup run 1.88.0 cargo check --locked --all-targets \
  --target x86_64-unknown-linux-gnu \
  --manifest-path native/linux-process-authority/Cargo.toml
result: PASS, no warnings (Windows cross-target compile evidence only)

rustup run 1.88.0 cargo fmt ... --check
result: unavailable — cargo-fmt is not installed for the pinned Windows toolchain

rustup run stable cargo fmt --manifest-path \
  native/linux-process-authority/Cargo.toml --all -- --check
result: PASS
```

## Coverage diagram

```text
READY-HOOK SEAM
  [★★★ TESTED] ordinary primary no-op-hook path -> fresh WSL primary matrix 23/23
  [★★★ TESTED] hook returns Err -> exact guardian absent + scope directory empty
  [★★  STATIC] hook receives immutable exact attestation before identity write in current source
  [★★  STATIC] no argv/env/protocol path can inject or select the hook
  [GAP/MAJOR] stalled production hook/fsync is not bounded by the absolute prepare deadline
  [GAP/MAJOR] test stays green if hook moves after final guardian readiness

CURRENT PRODUCT ORDER: correct
CURRENT FOCUSED TEST: cleanup oracle only
TERMINAL SEAM GATE: FAIL
```

## Durable findings and retained gates

- Preserve the no-op wrapper and the absence of any runtime hook-selection surface.
- The durable construction write must remain before final guardian readiness, and the regression
  must fail if that order is reversed—not merely prove cleanup after an injected hook error.
- Broker/Section 9 actual cgroup-v2 authority, package/install support, ProcessScope/SessionHost
  closure, production-default selection, macOS, and ECP-8 release truth remain outside this report.
