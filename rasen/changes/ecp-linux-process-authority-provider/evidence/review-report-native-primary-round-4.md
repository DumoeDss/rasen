# Native Linux primary authority delta review — round 4

Date: 2026-08-06\
Mode: fresh independent, dispatched/report-only\
Verdict: **CLEAN for `NATIVE-B005` — 0 open findings (0 Blocker, 0 Major, 0 Minor, 0 Trivial)**

## Scope and integrity

This pass reviewed only the test-runtime helper locator that fixes `NATIVE-B005`, its rejection
oracle, and the exact current-tree gates needed to prove that the foreign-target test executes the
fresh Linux helper without a build-host path alias. It did not re-review broker semantics, the
broker-authored primary readiness hook, TypeScript, packaging, tasks, run-state, production
defaults, or any other shared-worktree delta. No product, test, task, run-state, commit, stash, or
external administrative state was modified.

Current scoped test-source identity:

```text
741df44df9dfdb5e0cc5e1c5b7b6609e830b436f5be0fc742950b8235838403b  native/linux-process-authority/tests/linux_primary_contract.rs
```

Current production identities observed for boundary accounting:

```text
primary.rs   40d5231a99f1582b82123fd6758a084d7730b0840fc2c5b9fc89587868dda6ea
linux.rs     5541526feeda8cd5ee05a492f1cbf5b67d5210a85d3061d072e3489f391d07e5
protocol.rs  d84d86c4390a633f2c8b316ab449b2bd16aa7ad45e9d1742b3fccffdea0c0ca8
lifecycle.rs 1d3102ea6815de86a067f1c7ab060332a9cfec100562ceeae0f0d1d046f5241c
main.rs      d1969c503dac2743fc5894fe1231746644582b4be52b2be19df6eee521f3fdd1
runtime.rs   4a9376195ca3e50705a844130091018e3d4d29ba9a551a070b576d63b1e889d7
journal.rs   56ece3ba19409550ac01bcf824442d23f79fd56c8ebb65d94e2a79482b5a7a27
```

`primary.rs` is no longer the round-3 product snapshot: a concurrent broker fixer added the
separate ready-hook seam required by `BRK-R2-B01`. That after-snapshot product delta is explicitly
outside this report and requires its own fresh non-author review. This report therefore closes
only `NATIVE-B005`; it does not certify the complete current primary product delta.

## Finding disposition

### `NATIVE-B005` — CLOSED

The exact current locator in
`native/linux-process-authority/tests/linux_primary_contract.rs:71-135` derives the helper only
from canonical `current_exe()` and the expected `deps/..` Cargo profile layout. Before returning
the candidate it requires:

- the exact binary name `rasen-linux-process-authority`;
- a regular, non-symlink, executable file;
- canonical candidate parent equality with the canonical profile directory;
- ELF64 little-endian identity; and
- ELF machine 62 for `x86_64` or 183 for `aarch64`.

It does not consume `CARGO_BIN_EXE_*`, `PATH`, caller arguments, or environment-provided helper
paths. The mutation at lines 137-161 rejects a directory, an executable non-ELF, and a symlink.
The forced-guardian-death oracle consumes this locator at lines 544-560 before decoding the
helper's exact-empty evidence.

A fresh Windows cross-build produced a new primary test ELF whose bytes do not contain the exact
Windows target-root path. On WSL, the locator resolved the canonical sibling helper and the full
primary contract passed 23/23, including both named tests:

```text
runtime_helper_locator_rejects_wrong_type_and_identity
guardian_forced_death_proves_teardown_without_fabricating_root_status
```

No compatibility alias, PATH shim, caller-supplied path, or build-host-to-WSL mapping was used.

Standards result: **clean.**\
Spec result: **`NATIVE-B005` is closed at the test/evidence boundary.**

## Fresh verification receipts

Fresh E-drive roots:

```text
CARGO_TARGET_DIR=E:\tmp\rpa-b005-review-r4-final-20260806-1
TEMP/TMP=E:\tmp\rpa-b005-review-r4-final-temp-20260806-1
RUSTFLAGS=-C linker=rust-lld
Windows rustc/cargo 1.88.0
```

`cargo test --locked --target x86_64-unknown-linux-musl --no-run
--message-format=json` succeeded. Cargo JSON identified exactly 18 artifacts with
`profile.test=true`; the three ordinary production-bin artifacts in `deps` were not counted as
test ELFs.

Fresh helper:

```text
path: /mnt/e/tmp/rpa-b005-review-r4-final-20260806-1/x86_64-unknown-linux-musl/debug/rasen-linux-process-authority
canonical parent: exact canonical Cargo profile directory
type: regular file, non-symlink
DrvFs mode: 0777
length: 10751928
SHA-256: 4c6591dc8e0b518cc9bc2316d22ba7d516dd7bdea3c03511f6738737764bf5c4
file: ELF 64-bit LSB PIE, x86-64, static-pie linked
```

Fresh primary test ELF:

```text
length: 14215992
SHA-256: d89014aae77855621b27d226a89d42b703aa88177264f00102eb556c7bb6358f
file: ELF 64-bit LSB PIE, x86-64, static-pie linked
embedded exact Windows target-root path: false
```

All 18 exact test ELFs were executed directly and serially on Ubuntu 24.04.1 LTS / WSL2 kernel
`5.15.167.4-microsoft-standard-WSL2 x86_64`:

| Group | Passed | Failed | Ignored |
| --- | ---: | ---: | ---: |
| `linux_primary_contract` | 23 | 0 | 0 |
| broker integration contracts | 45 | 0 | 0 |
| other integration contracts | 21 | 0 | 0 |
| library/binary unit harnesses | 4 | 0 | 0 |
| **18-ELF total** | **93** | **0** | **0** |

Additional current-tree gates:

```text
rustup run 1.88.0 cargo test --locked
  Windows host: 58 passed, 0 failed, 0 ignored

rustup run 1.88.0 cargo check --locked --all-targets \
  --target x86_64-unknown-linux-gnu
  passed, no warnings (Windows cross-target compile evidence only)

rustup run stable cargo fmt --all -- --check
  passed on Windows

WSL pinned Rust 1.88 cargo fmt --all -- --check
  passed
```

The scoped test file and this report strictly decode as UTF-8 and have no UTF-8 BOM.

## Coverage and retained boundaries

```text
NATIVE-B005 COVERAGE
  [★★★ TESTED] canonical current-test-executable -> deps/.. -> exact sibling helper
  [★★★ TESTED] directory / non-ELF / symlink candidates fail closed
  [★★★ TESTED] helper is executable ELF64 little-endian x86-64
  [★★★ TESTED] foreign-target test ELF contains no exact Windows target-root path
  [★★★ TESTED] forced guardian death reaches helper inspection and exact-empty evidence

MANDATORY CURRENT-TREE WSL MATRIX: 93/93 green
GATE: CLEAN FOR NATIVE-B005
```

These ELFs were cross-built on Windows and actually executed as Linux processes on the WSL
kernel. This is actual-kernel evidence for the reached paths, not native-in-WSL build proof,
root-installed broker/writable-cgroup-v2 proof, package/install proof, general-distribution proof,
or release proof.

`NATIVE-B003`, `NATIVE-B004`, and `NATIVE-M005` are not reopened: the locator fix did not change
their product seams. The current broker-authored ready-hook seam remains separate and unreviewed
by this report. Installed broker/cgroup-v2 acceptance, ProcessScope/SessionHost closure,
production-default switching, legacy PGID removal, macOS strategy, ECP-8 release truth, ship, and
archive all remain outside this verdict.

## Durable findings for LEAD

1. `NATIVE-B005` may be removed from `openFindings`; its current-tree fresh matrix is 93/93.
2. Route the new `primary.rs` ready-hook seam to a separate fresh non-author reviewer before
   claiming the complete current native-primary delta clean.
3. Preserve the evidence wording: Windows-cross-built ELFs actually executed on WSL; this is not
   native-build, installed-broker, package, or release proof.
