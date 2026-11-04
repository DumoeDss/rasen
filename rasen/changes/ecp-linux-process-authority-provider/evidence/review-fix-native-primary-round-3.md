# Native Linux primary authority review fix — round 3

Date: 2026-08-06\
Mode: fresh non-author test-evidence fixer\
Finding: `NATIVE-B005`\
Verdict: **CLOSED at the test/evidence boundary**

## Scope

The fix changes only the Linux primary integration test's helper locator. It does not change the
primary helper, guardian, lifecycle, protocol, broker, TypeScript adapter, package assembly,
tasks, or run-state. The product closures for `NATIVE-B003`, `NATIVE-B004`, and `NATIVE-M005`
therefore remain untouched.

Owned source and evidence:

- `native/linux-process-authority/tests/linux_primary_contract.rs`
- `rasen/changes/ecp-linux-process-authority-provider/evidence/review-fix-native-primary-round-3.md`
- `rasen/changes/ecp-linux-process-authority-provider/handoff/fixer-native-primary-test-1.md`

Final test-source SHA-256:

```text
227b1f32f9fcb75ce650cd935222ab772db865f006577e5363718921a8d3b565
```

## RED — reproduced foreign build-host path failure

The first fresh attempt correctly failed before compilation because the Windows C drive and its
default Rust temp directory had zero free bytes. That setup failure is not counted as RED. The
rerun used new E-drive target and temp roots:

```text
CARGO_TARGET_DIR=E:\tmp\rpa-b005-red-20260806-2
TEMP=E:\tmp\rpa-b005-rust-temp-20260806-2
TMP=E:\tmp\rpa-b005-rust-temp-20260806-2
RUSTFLAGS=-C linker=rust-lld

rustup run 1.88.0 cargo test --locked \
  --target x86_64-unknown-linux-musl --no-run \
  --manifest-path native/linux-process-authority/Cargo.toml
```

The pre-fix `linux_primary_contract` ELF had SHA-256
`a9e5986fd48ff189d5fb79cdc4197edcee32346f91bd74e715391330c5ba93a7`. `strings` found the exact
embedded build-host helper path:

```text
E:\tmp\rpa-b005-red-20260806-2\x86_64-unknown-linux-musl\debug\rasen-linux-process-authority
```

The unmodified ELF was then run directly on WSL with no PATH alias or mount/path compatibility
mapping:

```text
/mnt/e/tmp/rpa-b005-red-20260806-2/x86_64-unknown-linux-musl/debug/deps/\
linux_primary_contract-1de3b0aeba4c2f07 \
  --exact guardian_forced_death_proves_teardown_without_fabricating_root_status \
  --nocapture --test-threads=1

result: 0 passed, 1 failed, 20 filtered out
exit: 101
failure: Os { code: 2, kind: NotFound, message: "No such file or directory" }
```

This independently reproduces the round-3 review: the oracle reached the build-host path lookup
and failed with `ENOENT` before helper inspection.

## Fix

The test now derives the helper only from the running Linux test executable's Cargo layout:

```text
<target>/<triple>/<profile>/deps/linux_primary_contract-<hash>
                                      |
                                      +-- resolve deps/..
                                          -> exact sibling rasen-linux-process-authority
```

The locator and its rejection oracle are at
`native/linux-process-authority/tests/linux_primary_contract.rs:72`, `:74`, `:117`, and `:134`;
the guardian test consumes it at `:505`.

The test-only validator requires all of the following before `Command::new`:

- the current test executable is in an exact `target/<profile>/deps` layout;
- the candidate name is exactly `rasen-linux-process-authority`;
- the candidate is a regular, non-symlink, executable file;
- the canonical candidate remains an exact child of the canonical Cargo profile directory;
- the file is 64-bit little-endian ELF;
- the ELF machine matches the running Linux test architecture (`x86_64` or `aarch64`).

The new mutation test rejects a directory, an executable non-ELF file, and a symlink. The runtime
locator never reads `PATH`, never accepts a PATH alias, never accepts a caller-supplied helper
path, and does not weaken the product's no-PATH resolver constraint.

## GREEN — fresh exact 18-ELF WSL matrix

Fresh roots, not reused from RED:

```text
CARGO_TARGET_DIR=E:\tmp\rpa-b005-green-20260806-1
TEMP=E:\tmp\rpa-b005-rust-temp-green-20260806-1
TMP=E:\tmp\rpa-b005-rust-temp-green-20260806-1
RUSTFLAGS=-C linker=rust-lld
```

Cargo `--message-format=json-render-diagnostics` identified exactly the 18 artifacts whose
`profile.test` was `true`; the three production-bin artifacts in `deps` were not miscounted as
test ELFs. The exact helper used by the WSL oracle was:

```text
/mnt/e/tmp/rpa-b005-green-20260806-1/x86_64-unknown-linux-musl/debug/rasen-linux-process-authority
type: regular file
file: ELF 64-bit LSB PIE, x86-64, static-pie linked
length: 10087976
SHA-256: 6c7018cae4a9292eb12b0d4ee06fdfe1809e424770f64aa0bff5398297be5dda
```

The DrvFs view reported synthesized mode `0777`; file type, canonical sibling containment,
execute permission, ELF class/endianness, and x86-64 machine identity were all validated at test
runtime. The fresh primary test ELF had length `13453768` and SHA-256
`f4037a882ebd71450e9ab33f8c8f9fdd84547952568b6c49264aa007690882f2`.

`strings` confirmed that the fresh test ELF does **not** contain the build-host helper path
`E:\tmp\rpa-b005-green-20260806-1\x86_64-unknown-linux-musl\debug\rasen-linux-process-authority`.

Focused WSL receipts:

```text
runtime_helper_locator_rejects_wrong_type_and_identity
  1 passed, 0 failed, 21 filtered out

guardian_forced_death_proves_teardown_without_fabricating_root_status
  1 passed, 0 failed, 21 filtered out
```

All 18 exact freshly built musl test ELFs were then executed directly on WSL, each with
`--test-threads=1`, without a helper alias or path mapping:

| Test group | Passed | Failed | Ignored |
|---|---:|---:|---:|
| `linux_primary_contract` | 22 | 0 | 0 |
| broker integration contracts | 39 | 0 | 0 |
| other integration contracts | 21 | 0 | 0 |
| library/binary unit harnesses | 4 | 0 | 0 |
| **18-ELF total** | **86** | **0** | **0** |

Environment:

```text
Ubuntu 24.04.1 LTS
Linux 5.15.167.4-microsoft-standard-WSL2 x86_64
Windows rustc 1.88.0 / cargo 1.88.0
WSL rustc 1.88.0 / cargo 1.88.0 / rustfmt 1.8.0-stable
```

## Additional gates

```text
rustup run 1.88.0 cargo test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml
  Windows host: 52 passed, 0 failed, 0 ignored

rustup run 1.88.0 cargo check --locked --all-targets \
  --target x86_64-unknown-linux-gnu \
  --manifest-path native/linux-process-authority/Cargo.toml
  passed, no warnings (Windows cross-target compile evidence only)

rustup run stable cargo fmt --manifest-path \
  native/linux-process-authority/Cargo.toml --all -- --check
  passed on Windows

WSL pinned Rust 1.88 cargo fmt --manifest-path \
  native/linux-process-authority/Cargo.toml --all -- --check
  passed
```

The final three owned files strictly decode as UTF-8 and have no UTF-8 BOM. No task checkbox,
run-state, commit, or product file was changed.

## Durable finding disposition

- `NATIVE-B005`: **closed**. A foreign-target test ELF no longer executes its build-host
  `CARGO_BIN_EXE_*` absolute path. It resolves and validates the exact runtime sibling instead.
- `NATIVE-B003`, `NATIVE-B004`, `NATIVE-M005`: not reopened; no product seam was changed.
- The 18-ELF WSL receipt is actual-kernel evidence for these reached tests. It is not a
  native-in-WSL build, installed broker/cgroup-v2, package/install, general distribution,
  ProcessScope/SessionHost closure, production-default, macOS, or ECP-8 release claim.
- The C-drive free-space exhaustion is an environment constraint. All successful fresh builds
  used explicit E-drive target and Rust temp roots; those roots remain available for independent
  re-review.
