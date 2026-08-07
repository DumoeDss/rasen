# WSL actual-kernel TypeScript publisher/ledger oracle receipt — lead 2

Date: 2026-08-07
Mode: implementer receipt; TypeScript oracle track (Batch 3 of the WSL primary oracle remediation plan)
Scope: Section 7 rows `7.8`, `7.9`, `7.10` only

## Boundary

This receipt closes only the named Section 7 rows below, and only to the extent stated in
"Per-row accounting". It makes **no** claim about:

- Section 9 (installed broker / cgroup-v2 actual gate) — that environment is unavailable on this machine.
- Package install support, distribution, or the packaging matrix.
- Production default provider selection or `ProcessScope`/`SessionHost` integration.
- macOS or Windows providers.
- Change closure, `11.3`, or ECP-8 release truth.
- Task `7.2`: the round-5 native build/manifest receipt is **stale** against the current tree (see
  "Native source identity" below). This receipt does not re-close `7.2`.

## Environment

```text
WSL distribution:   Ubuntu 24.04.1 LTS
kernel:             Linux 5.15.167.4-microsoft-standard-WSL2 #1 SMP Tue Nov 5 00:21:55 UTC 2024 x86_64
node (inside WSL):  /usr/bin/node v22.21.0
vitest:             3.2.6
pnpm:               9.15.9
rustc / cargo:      rustc 1.88.0 (6b00bc388 2025-06-23) / cargo 1.88.0 (873a06493 2025-05-10)
RUSTUP_HOME:        /home/sayo/.local/share/rasen-rustup-1.28.2
CARGO_HOME:         /home/sayo/.local/share/rasen-cargo-1.28.2
host build-script linker: /home/sayo/.local/share/rasen-build/lead2-track-a-cc/cc -> zig 0.16.0 cc
final musl linker:  the pinned Rust sysroot's rust-lld
```

Disk: WSL ext4 `/` had 946G free; `/mnt/e` 27G. Every build root, staging root, cargo target root and
temp root used ext4 under `/home/sayo/.local/share/rasen-build/`. No root was placed on `/mnt/e`.

### How `node_modules` was resolved

The worktree `node_modules/` was installed on Windows. Running vitest under WSL against it fails
deterministically:

```text
Error: Cannot find module @rollup/rollup-linux-x64-gnu
  at .../node_modules/.pnpm/rollup@4.46.2/node_modules/rollup/dist/native.js:64:9
```

`node_modules/.pnpm` contains only `@esbuild+win32-x64@0.25.8` and
`@rollup+rollup-win32-x64-msvc@4.46.2`. The shared Windows `node_modules` was **not** deleted,
reinstalled, or otherwise modified. An isolated Linux install was staged on ext4 instead:

```sh
D=/home/sayo/.local/share/rasen-build/ts-oracles-nm
cp <worktree>/package.json <worktree>/pnpm-lock.yaml "$D/"
cd "$D"
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY
export npm_config_store_dir=/home/sayo/.local/share/rasen-build/pnpm-store
pnpm install --frozen-lockfile --ignore-scripts
# -> Done in 2m 19.9s using pnpm v9.15.9
```

Running the ext4 `vitest` binary with the worktree as cwd still fails, because `vitest.config.ts`
imports `vitest/config`, which Node resolves from the **config file's** directory and therefore lands
back on the Windows `node_modules`. So the run tree itself was staged on ext4:

```sh
T=/home/sayo/.local/share/rasen-build/ts-oracles-tree
rsync -a --exclude=node_modules --exclude=.git --exclude=dist --exclude=artifacts \
  --exclude=.rasen --exclude=coverage --exclude=target <worktree>/ "$T/"
ln -s /home/sayo/.local/share/rasen-build/ts-oracles-nm/node_modules "$T/node_modules"
```

Byte identity of the run tree against the worktree was verified immediately before and after every
run reported here, and the run tree was re-synced before each rebuild:

```sh
find src test vitest.config.ts vitest.setup.ts package.json tsconfig.json -type f \
  | sort | xargs sha256sum | sha256sum
# 00cc85daeac4a5e48304838271401f2bd599bddc701df536c492b020657a0939
```

That TypeScript manifest digest was **unchanged for the entire session**, across every run below.
Individual oracle inputs:

```text
4c7f84c83bb6fb42891171db953d72e6c37226cbee9edf96bb381a3dfbb88aa0  test/core/session-host/linux-process-authority-wsl-oracles.test.ts
8d7821b9e65e5f76092a3603e6b84bb08af6cac19018db6e25b7652df3919fbf  test/fixtures/linux-process-authority-wsl-controller.mjs
```

The vitest `globalSetup` builds the CLI, so the run tree was built once with the pinned toolchain on
`PATH`.

### Native source identity, and the concurrency caveat that bounds this receipt

The native crate digest was computed exactly as `scripts/build-linux-process-authority.mjs`
`sourceDigest()` does (`Cargo.lock`, `Cargo.toml`, `THIRD_PARTY.md`, plus every file under `src/`,
sorted, each hashed as `name \0 bytes \0`). The parallel native track was editing the crate
throughout this session, so the digest moved three times:

```text
00:26 - 00:50   826fa04851d152f3bedc60dffc5e0f1a8895d55bdf26422fa12197b1f87dfc6f   (stable window 1)
00:56           137402cbaa76e5559353be397fadd0fb5eb7bd66771a839d8b69770389c4c7cc
01:00 - 01:22   a568f53bffb6046dfce499522790d88479e1883cbcb908097cf665a63b183a42   (stable window 2)
01:38 - 01:40   087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59   FINAL / FROZEN
```

The first two transitions are accounted for by edits to files inside the digest set, not by test
churn:

```text
2026-08-07 00:56:05  native/linux-process-authority/src/primary.rs
2026-08-07 00:59:26  native/linux-process-authority/src/main.rs
```

Durable property worth carrying forward (raised by the native track and independently confirmed
against `sourceFileList()` at `scripts/build-linux-process-authority.mjs:98-103`): the digest input
set is exactly `Cargo.lock`, `Cargo.toml`, `THIRD_PARTY.md` and `src/**`. **`tests/` is excluded.**
So a moving test file can never invalidate a helper build or a package manifest — it can only break
the binding between a test *result* and a single test-source digest. That is exactly the gap the
rebind pass below was run to close, and it is why a freeze marker for this wave must record the
`tests/**` hashes and not only `sourceSha256`.

The native track subsequently identified what the two `src/` edits were:
`src/primary.rs` gained a `#[cfg(test)]`-only exhaustiveness binding (no production behavior change),
and `src/main.rs` carries a **real production change** — the helper CLI's `activate` arm previously
parsed `--deadline-ms` and discarded it, always using the internal 2-second `CONTROL_TIMEOUT`; it now
routes the caller's value into `activate_until`.

Blast radius on the three oracles in this receipt: **none, by construction.** `WSL-R4-M04` and
`WSL-R4-M06` never activate — proving that the workload stays unactivated is their entire purpose.
The only control operations they issue are `prepare`, `publish`, `inspect` and `abort`; the string
`activate` appears in this test file only as the window name `ack-before-activate` and in a comment.
Independently of that, the final run below was rebuilt and executed against the frozen `087d87a5`,
which contains the `main.rs` change. So this receipt is bound to the post-fix helper either way.

The last transition, `a568f53b` -> `087d87a5`, is the broker `place_guardian` Blocker fix
(`F-L2-10`): `writeln!` into a cgroup control file issues one `write(2)` per format fragment, so the
bare `"\n"` arrives as a separate, empty, `EINVAL`-returning write after the migration already
succeeded. **Independently bounded by this track before re-running:** grepping `writeln!` and
`write!(` across `native/linux-process-authority/src/` finds **exactly two sites, both in
`broker_cgroup.rs` (541, 662), and zero anywhere in the primary path.** The primary path therefore
cannot be affected, and the prediction that this pass would reproduce the previous verdicts exactly
was made before the run and held: every result line below is identical to the `a568f53b` pass.

`wsl-native-build-manifest-round-5.md` (Task `7.2`) records
`sourceSha256 49c327ca968e7b2f40ea4a23f0a2cf3cd014732635afec8b3112d3d3c1146540`, which matches none of
these. That receipt no longer describes the current source and `7.2` must not be treated as closed on
its basis. This was reported to the native track and the LEAD.

The **final authoritative run** is the frozen rebind pass, executed inside stable window 3 against
`087d87a5`. An earlier pass in stable window 2 (`a568f53b`) is retained below as history because its
verdicts are identical and the comparison is itself evidence.

One file moved inside window 2, which is what made that pass non-terminal:

```text
native/linux-process-authority/tests/linux_primary_contract.rs
  f0acbaec00a2ef2c92b212cad6d52651b9ff1ce6d82b3c84f12313ba09523dca   (window open)
  b34e7c8c35781f60429b82f7d9ef4e239c694593e7311ff54ac7849b1e1a150a   (window close)

native/linux-process-authority/tests/linux_identity_contract.rs
  e3b92a8e22e7eee98312c031d7247a616a3bc67c43834b3a0d0a8c896b76f09a   (unchanged all session)
```

At the time of the first pass this left the `linux_primary_contract` results green but unbindable to a
single test-source digest. **That gap is now closed by the rebind pass below**, which was executed
after the native track declared itself hands-off, with every input digest measured immediately before
and after and confirmed unchanged.

### Package roots — five independently built helpers, no historical digest reused

| Run | Package root | Helper sha256 | Length | Target | Bound source |
| --- | --- | --- | --- | --- | --- |
| **final** | `/home/sayo/.local/share/rasen-build/track-b-pkg-r4` | `94002604da1fc98a109463c2b98935977ef8e3ae72055772ce5c8e677e9bb8f6` | 578440 | musl static PIE | **`087d87a5` (frozen)** |
| 4 | `/home/sayo/.local/share/rasen-build/track-b-pkg-r3` | `05bd786644ee1b6dd160ab66ba07ce9bbf0026db310696916eb506bf2333d4ba` | 578440 | musl static PIE | `a568f53b` |
| 3 | `/home/sayo/.local/share/rasen-build/track-b-pkg-r2` | `21f3c805ac138265f7f3834cc9f9f8d489ee7a315f5ef239be8efcab40bd10af` | 578472 | musl static PIE | `137402cb` |
| 2 | `/home/sayo/.local/share/rasen-build/ts-oracles-pkg-gnu/package` | `0d9b443f05bf2dc5fd7623ef0c4c497c4bb2f0750b3487149be3cf7d04467e09` | 503528 | gnu dynamic PIE | `826fa048` |
| 1 | `/home/sayo/.local/share/rasen-build/rasen-linux-apply-freeze-r1/package` | `1725648ba3be37cc9556ff15a39d2a65791796ec580f00a719763335554c5025` | 578504 | musl static PIE | `826fa048` |

All were emitted by the source-owned route, all carry `compiler rustc 1.88.0 (6b00bc388 2025-06-23)`,
mode `0755`, and an adjacent canonical manifest plus
`dist/core/session-host/process-authority/linux/build-authority.js`. Roots 2, 3 and the final root
were built by this track in this session; root 1 was the existing current-source staging at the time.
The final root was produced by:

```sh
export RASEN_LINUX_PROCESS_AUTHORITY_BUILD_ROOT=/home/sayo/.local/share/rasen-build/track-b-pkg-r4
export RASEN_LINUX_PROCESS_AUTHORITY_TEMP_ROOT=/home/sayo/.local/share/rasen-build/track-b-pkg-r4-tmp
node scripts/build-linux-process-authority.mjs --target x86_64-unknown-linux-musl
```

Incidental observation worth a line: the `a568f53b` and `087d87a5` musl helpers are both exactly
578440 bytes with different hashes, and both differ from the `137402cb` helper at 578472. Equal length
across a source change is not evidence of an unchanged binary; only the hash is.

Pointing the oracle at the run tree's own `dist/` directly was **rejected** by the product guard:

```text
TypeError: Linux process-authority artifact package root ownership or mode is not trusted.
  at validateOwnedPath src/core/session-host/process-authority/linux/artifact-resolver.ts:155
```

That is the guard working as designed: `rsync -a` carried DrvFS `0777` modes onto the copied tree and
`validateOwnedPath` requires `(mode & 0o022) === 0`. Every staged root above was mode-normalised to
`0755`/`0644` before use. This is recorded because it is the same DrvFS mode-semantics hazard the
remediation plan already noted for build roots.

## The definitive corrections table

The prior hand-off named six corrections without detail. They were re-derived from the code and the
remediation plan, and each was checked against the current source.

| # | Correction | Status | Code location |
| --- | --- | --- | --- |
| C1 | Test-only seams must be imported from their direct modules, never from the Linux public index, and must stay absent from that index | **already correct** | test imports `createLinuxPrimaryNativeAssemblyForTesting` from `linux/native-assembly.js` and `createLinuxPrimaryProcessAuthorityProviderBundleForTesting` from `linux/provider.js`; `src/core/session-host/process-authority/linux/index.ts` exports no `*ForTesting` symbol; the common Interface (`ProcessAuthorityProviderRegistry`, `createProcessAuthorityCoordinator`) still comes from the public `process-authority/index.js` |
| C2 | Build authority must not be reconstructed from the manifest under verification | **already correct** | `trustedBuildIdentity()` imports `dist/core/session-host/process-authority/linux/build-authority.js` from the staged package root and passes it into `resolveLinuxProcessAuthorityArtifactForTesting(options, authority)`; `artifact-resolver.ts:274 requireBuildAuthority(...)` then checks the parsed manifest **against** that independent identity. Non-circular |
| C3 | Durable write helper: barrier and reference must be fsynced (file + parent directory) before the parent may observe them | **already correct** | `durableBarrier()` in `test/fixtures/linux-process-authority-wsl-controller.mjs:11-26`; used for both the reference file (0600) and each window barrier |
| C4 | Replacement must inspect across the common coordinator, not only the provider | **already correct** | `replacementAbortsPublished()` asserts `replacementCoordinator.inspect(...)` **and** `replacement.provider.inspect(...)`, and re-asserts the coordinator after abort |
| C5 | `try/finally` cleanup so a failed oracle still reaps the controller and aborts the real guardian | **already correct** | both tests wrap in `try/finally` with `killAndReapController` + `bestEffortExactAbort`; the private root is removed only once exact-empty is proven, so a failure retains state for diagnosis |
| C6 | A subprocess fixture that installs a process-local `no_new_privs` seccomp filter (`WSL-R4-M05`) | **not applicable to this track** | The remediation plan places this in `native/linux-process-authority/tests/linux_primary_contract.rs`. Node cannot install a seccomp BPF filter, and the helper is a static PIE so no loader-based interception exists. It is implemented in the Rust crate at `linux_primary_contract.rs:1417` (`unavailable_configuration_matrix_fails_closed_without_global_mutation`) and `:1709` (`unavailable_configuration_fixture`). Owned by the native track |

### One assertion added by this track

The remediation plan's `WSL-R4-M04` step 3 requires the replacement to observe "real native `inert`
plus authentic ledger lookup to report `published-inert`", and states the native journal must contain
no `Published` transition. The replacement path asserted only the provider/coordinator view. The
direct native observation was added in `replacementAbortsPublished()`:

```ts
await expect(current.transport.inspect(
  decodeLinuxPrivateAuthorityReference(decoded.providerReference),
  context('inspect', 'actual-wsl-native-publication-blindness')
)).resolves.toEqual({ state: 'inert' });
```

Honest limitation: this is a **direct positive observation**, not an independently isolated failure
detector. Mutations that make the native machine claim publication are already caught one assertion
earlier by `mapLinuxNativeObservation` (mutations C and D below), so the added line corroborates the
invariant rather than being the sole thing that would go red.

## Commands and verbatim results

All commands ran inside WSL. `RASEN_ACTUAL_WSL_ORACLE=1` is mandatory: without it the suite is
`describe.skip`, so a Windows-side invocation proves nothing.

### Earlier oracle run, superseded by the frozen rebind below (native src `a568f53b`, helper `05bd7866`)

```sh
cd /home/sayo/.local/share/rasen-build/ts-oracles-tree
RASEN_ACTUAL_WSL_ORACLE=1 \
RASEN_LINUX_PROCESS_AUTHORITY_PACKAGE_ROOT=/home/sayo/.local/share/rasen-build/track-b-pkg-r3 \
node node_modules/vitest/vitest.mjs run \
  test/core/session-host/linux-process-authority-wsl-oracles.test.ts \
  --pool=forks --maxWorkers=1 --reporter=verbose
```

```text
 RUN  v3.2.6 /home/sayo/.local/share/rasen-build/ts-oracles-tree

 ✓ test/core/session-host/linux-process-authority-wsl-oracles.test.ts > Linux process authority actual WSL product oracles > actual_wsl_published_inert_abort_keeps_workload_closed 1283ms
 ✓ test/core/session-host/linux-process-authority-wsl-oracles.test.ts > Linux process authority actual WSL product oracles > commit-before-ack: actual_wsl_replacement_recovers_commit_before_ack_as_published_inert 3083ms
 ✓ test/core/session-host/linux-process-authority-wsl-oracles.test.ts > Linux process authority actual WSL product oracles > ack-before-activate: actual_wsl_replacement_recovers_ack_before_activate_as_published_inert 6836ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  01:03:23
   Duration  12.69s (transform 657ms, setup 47ms, collect 617ms, tests 11.21s, environment 1ms, prepare 235ms)
```

**Skip accounting: 0 skipped.** Vitest reports `3 passed (3)` with no `skipped` count, and the verbose
reporter names each of the three parent oracles individually.

The same three oracles were also green against the three earlier helpers, each with `Tests 3 passed
(3)` and zero skips:

```text
helper 1725648b (musl, src 826fa048):  ✓ published-abort 173ms  ✓ commit-before-ack 1600ms  ✓ ack-before-activate 1286ms
helper 0d9b443f (gnu,  src 826fa048):  ✓ published-abort 144ms  ✓ commit-before-ack 1558ms  ✓ ack-before-activate 1607ms
helper 21f3c805 (musl, src 137402cb):  ✓ published-abort 555ms  ✓ commit-before-ack 3364ms  ✓ ack-before-activate 2002ms
```

Four distinct helper binaries, two link targets, three source revisions, twelve green oracle
executions, zero skips.

### Native suites executed first-hand, inside the same window

Built read-only from the worktree into an isolated ext4 target. No native source file was modified by
this track.

```sh
export CARGO_TARGET_DIR=/home/sayo/.local/share/rasen-build/track-b-native-target
export TMPDIR=/home/sayo/.local/share/rasen-build/track-b-native-tmp
cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu \
  --test linux_identity_contract --test linux_primary_contract -- --test-threads=1
```

```text
Running tests/linux_identity_contract.rs
running 3 tests
test boot_pid_start_and_namespace_drift_never_target_a_replacement ... ok
test pidfd_reopen_revalidates_the_complete_current_identity ... ok
test proc_stat_parser_handles_spaces_and_closing_parentheses_in_comm ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s

Running tests/linux_primary_contract.rs
running 29 tests
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 59.86s
```

An earlier execution of the same two ELFs printed every `linux_primary_contract` name; all 29 were
`ok`, including `unavailable_configuration_matrix_fails_closed_without_global_mutation`,
`actual_namespace_prepare_is_inert_then_aborts_or_activates_to_exact_empty`,
`actual_root_signal_is_preserved_inside_the_closed_linux_range`,
`setpgid_orphan_keeps_scope_live_until_exact_pidfd_force`,
`final_child_exit_orders_root_status_before_exact_empty`,
`guardian_forced_death_proves_teardown_without_fabricating_root_status`, and
`nondumpable_namespace_drift_with_broken_endpoint_never_signals_replacement`.

Zero-hidden-skip accounting for `linux_primary_contract`: 9 of the 29 `ok` lines are subprocess
fixture entry points that return immediately without their private selector and are **excluded** from
acceptance counts — `final_child_order_fixture`, `guardian_death_workload_fixture`,
`inherited_high_fd_is_closed_fixture`, `nondumpable_replacement_fixture`,
`nonreading_full_output_workload_fixture`, `recursive_workload_fixture`,
`setpgid_resistant_descendant_fixture`, `unavailable_configuration_fixture`,
`workload_cannot_reach_authority_state_fixture`. 20 parent oracles remain.

### Supporting TypeScript suites (Linux, but not actual-kernel oracles)

```sh
node node_modules/vitest/vitest.mjs run \
  test/core/session-host/linux-process-authority-provider.test.ts \
  test/core/session-host/linux-process-authority-publication-ledger.test.ts \
  test/core/session-host/process-authority-lifecycle.test.ts \
  test/core/session-host/linux-process-authority-boundary-guards.test.ts \
  --pool=forks --maxWorkers=1
```

```text
 ✓ linux-process-authority-provider.test.ts (15 tests)
 ✓ process-authority-lifecycle.test.ts (18 tests)
 ✓ linux-process-authority-publication-ledger.test.ts (13 tests)
 ✓ linux-process-authority-boundary-guards.test.ts (2 tests)
 Test Files  4 passed (4)
      Tests  48 passed (48)
```

The plan-named mapping test was also run by name:

```text
 ✓ Linux process-authority provider bundle > surfaces native prerequisite denial as a typed prepare-unavailable result 6ms
      Tests  1 passed | 14 skipped (15)
```

These use a substituted transport. They are **supporting** evidence for the TypeScript failure-code
mapping only; the terminal actual-kernel denial oracle is the native `WSL-R4-M05` matrix.

### Static checks

```sh
node node_modules/typescript/bin/tsc --noEmit                       # exit 0, no output
node node_modules/eslint/bin/eslint.js \
  src/core/session-host/process-authority/linux \
  test/core/session-host/linux-process-authority-wsl-oracles.test.ts \
  test/fixtures/linux-process-authority-wsl-controller.mjs          # exit 0, no output
```

## Mutation receipts — the oracles can actually fail

Each mutation was applied to the run tree only, executed against helper `1725648b`, then reverted;
every product file was re-hashed against the worktree afterwards and confirmed identical. The mutated
code is TypeScript, whose digest never moved this session, so these receipts remain valid.

| Mutation | Injected defect | Result |
| --- | --- | --- |
| A | `LinuxAuthorityPublicationLedger.commit()` becomes a silent no-op (durable publication never written) | **RED 3/3** — `expected { state: 'prepared-inert' } to deeply equal { state: 'published-inert' }` in all three oracles |
| B | `provider.abort()` returns `exact-scope-empty` without contacting the native transport | **RED 3/3** — `expected { state: 'published-inert' } to deeply equal { state: 'exact-scope-empty' }`; the final coordinator inspect catches the faked teardown |
| C | native transport `inspect` maps inert to `published-inert` (a native machine claiming publication) | **RED 3/3** — `expected { state: 'control-loss' } to deeply equal { state: 'published-inert' }` |
| D | mutation C plus `isExactNativeInert()` widened to accept `published-inert` | **RED 3/3** — still `control-loss`; `mapLinuxNativeObservation` fails closed before the added native assertion is reached |

Mutation A is the important one: it proves all three oracles genuinely depend on the authentic durable
ledger commit rather than passing vacuously. Mutations C and D establish the honest limit of the added
native-blindness assertion recorded above.

## Rebind pass against the frozen tree

The Linux implementation wave is frozen at `087d87a5`; all six test files are byte-identical to the
preceding pass, so this is a pure re-bind.
This pass re-ran every Section 7 row this receipt touches, with all inputs measured immediately
before and immediately after:

Every frozen coordinate was re-measured at the start (01:38:00) and at the end (01:40:37) of the
pass, byte lengths included. **All seven were identical at both ends**, and all seven match the
coordinates the LEAD published for the freeze marker:

```text
sourceDigest (26 files)                    087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
tests/linux_primary_contract.rs            7d56ca4e5169967a8c6877c1a9b37cfaaf552bd90d44dc3d0e56521305b192b1    65505
tests/lifecycle_contract.rs                57dbddcbfcd48b600d45c7ef868251c12d0e6ff1fd782118f0cc58ac1b8fa4aa     8833
tests/linux_journal_contract.rs            acbc80e1dfa5c4bebfccdd034f96b1182eaa5e8fc9402a247c347c45a433e6a0     7916
tests/linux_identity_contract.rs           e3b92a8e22e7eee98312c031d7247a616a3bc67c43834b3a0d0a8c896b76f09a     1988
linux-process-authority-wsl-oracles.test.ts  4c7f84c83bb6fb42891171db953d72e6c37226cbee9edf96bb381a3dfbb88aa0  12536
linux-process-authority-wsl-controller.mjs   8d7821b9e65e5f76092a3603e6b84bb08af6cac19018db6e25b7652df3919fbf   4693
TS manifest                                00cc85daeac4a5e48304838271401f2bd599bddc701df536c492b020657a0939
```

Nothing moved. Every row below is therefore bound to that exact set.

Author/verifier separation: the four Rust suites were authored by the native track and executed here
by this track, so `author != verifier` holds for them. The three TypeScript oracles are authored and
executed by this track; their independent check is the mutation matrix recorded above, and they remain
owed a non-author review in the unified wave.

The helper was rebuilt for this pass, because the earlier `track-b-pkg-r3` binary was built from the
superseded `a568f53b`:

```text
package root  /home/sayo/.local/share/rasen-build/track-b-pkg-r4
helper        dist/native/linux-x64/rasen-linux-process-authority-helper
sha256        94002604da1fc98a109463c2b98935977ef8e3ae72055772ce5c8e677e9bb8f6
length        578440    mode 0755    x86_64-unknown-linux-musl static PIE
sourceSha256  087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59
compiler      rustc 1.88.0 (6b00bc388 2025-06-23)
```

The pass covers the whole native contract surface plus the TypeScript oracles:

```text
lifecycle_contract       ok.  6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
linux_identity_contract  ok.  3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
linux_journal_contract   ok.  2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
linux_primary_contract   ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 27.94s

 ✓ ... > actual_wsl_published_inert_abort_keeps_workload_closed 187ms
 ✓ ... > commit-before-ack: actual_wsl_replacement_recovers_commit_before_ack_as_published_inert 1439ms
 ✓ ... > ack-before-activate: actual_wsl_replacement_recovers_ack_before_activate_as_published_inert 1326ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

Counts and verdicts are identical to the `a568f53b` pass, as predicted from the source-level blast
radius. Only timings differ.

Ignored and filtered counts are **0 in every native suite**, and the vitest run reports no `skipped`
count at all. Note for anyone comparing against round 4: `lifecycle_contract` was 5 there and is 6
here, and `linux_journal_contract` was 1 and is 2 — the native track added coverage, so those counts
are expected to differ.

**The `linux_primary_contract` count is 29 both before and after the freeze, but the composition
changed** — do not read the two 29s as the same suite. The native track deleted an unconditionally
empty fixture (`recursive_workload_fixture`) and added a real test
(`cli_activate_rejects_a_deadline_outside_the_broker_phase_bound`). Restated zero-hidden-skip
accounting for the frozen suite: 8 of the 29 `ok` lines are subprocess fixture entry points excluded
from acceptance counts — `final_child_order_fixture`, `guardian_death_workload_fixture`,
`inherited_high_fd_is_closed_fixture`, `nondumpable_replacement_fixture`,
`nonreading_full_output_workload_fixture`, `setpgid_resistant_descendant_fixture`,
`unavailable_configuration_fixture`, `workload_cannot_reach_authority_state_fixture`. **21 parent
oracles remain**, up from 20 before the freeze — the acceptance count rose because a vacuous fixture
was removed and a real oracle added.

## Per-row accounting

Legend: **bound** = green, on the actual WSL kernel, with a receipt bound to source, test-source and
TypeScript digests all measured unchanged across the run window.

### Task 7.8 — natural empty, exact code exit, exact signal exit, root-exit-with-live-descendant, recursive force, prepared abort, published abort

| Row | Oracle | Result |
| --- | --- | --- |
| natural empty | `linux_primary_contract::actual_namespace_prepare_is_inert_then_aborts_or_activates_to_exact_empty` (asserts `RootExit::Code(0)` then `exact-scope-empty`) | **bound** |
| exact code exit | same oracle, `RootExit::Code(0)` branch | **bound** |
| exact signal exit | `linux_primary_contract::actual_root_signal_is_preserved_inside_the_closed_linux_range` | **bound** |
| root-exit-with-live-descendant | `linux_primary_contract::setpgid_orphan_keeps_scope_live_until_exact_pidfd_force`; also the recursive branch of the base oracle, which asserts empty is never emitted before the exact root status | **bound** |
| recursive force | `setpgid_orphan_keeps_scope_live_until_exact_pidfd_force` (exact guardian pidfd force) and the terminate branch of the base oracle | **bound** |
| prepared abort | base oracle, inert `abort(5_000)` with the workload marker proven absent | **bound** |
| published abort | **`actual_wsl_published_inert_abort_keeps_workload_closed`** (this track, `WSL-R4-M04`) | **bound** to frozen src `087d87a5` (helper `94002604`), and independently green against four earlier helpers |

The published-abort row that `WSL-R4-M04` was raised for is closed. The six pre-existing native rows
are green on the actual kernel but their file moved mid-window.

### Task 7.9 — identity drift and unavailable configuration

| Row | Oracle | Result |
| --- | --- | --- |
| boot / PID / start-ticks / PID-namespace drift never targets a replacement | `linux_identity_contract::boot_pid_start_and_namespace_drift_never_target_a_replacement` | **bound** (test source `e3b92a8e`, unchanged all session) |
| pidfd reopen revalidates the complete current identity | `linux_identity_contract::pidfd_reopen_revalidates_the_complete_current_identity` | **bound** |
| reference identity drift (scope capability, control capability, start ticks) rejected | the base oracle's three mutated-attestation `AuthorityClient::inspect()` rejections | **bound** |
| nondumpable unrelated replacement never signalled | `linux_primary_contract::nondumpable_namespace_drift_with_broken_endpoint_never_signals_replacement` | **bound** |
| unavailable configuration: namespace `clone` EPERM, mapping `openat` write-flag EACCES, `mount` EPERM, `pidfd_open` ENOSYS | `linux_primary_contract::unavailable_configuration_matrix_fails_closed_without_global_mutation` driving `unavailable_configuration_fixture` under `PR_SET_NO_NEW_PRIVS` + a bounded seccomp BPF filter, one disposable process per row; each row asserts `NativeFailureCode::Unavailable`, an empty runtime root, an absent workload marker, `waitpid(-1, WNOHANG) == ECHILD`, and an unrelated `/usr/bin/sleep` still alive | **bound** |
| TypeScript mapping of a native prerequisite denial | `surfaces native prerequisite denial as a typed prepare-unavailable result` | green, substituted transport — supporting only |

No global WSL state was changed: the seccomp filters are process-local to disposable fixture
processes, and no sysctl, `/proc` remount, `.wslconfig` edit, or `sudo` was used. Every 7.9 oracle is
authored by the native track; this track executed them and authored none of them.

### Task 7.10 — commit-before-ack and acknowledgement-before-activate replacement windows

| Row | Oracle | Result |
| --- | --- | --- |
| commit-before-ack | `actual_wsl_replacement_recovers_commit_before_ack_as_published_inert` — the controller's wrapper publisher drives the authentic `bundle.publishAuthority` to completion, fsyncs `ledger-committed`, then blocks before returning the acknowledgement to `prepared.publish`; the parent SIGKILLs and reaps the real controller process at that barrier | **bound** to frozen src `087d87a5` (helper `94002604`), and independently green against four earlier helpers |
| acknowledgement-before-activate | `actual_wsl_replacement_recovers_ack_before_activate_as_published_inert` — the controller completes `prepared.publish(bundle.publishAuthority)`, requires the returned `published-inert`, fsyncs `acknowledged`, then blocks without calling `activate` | **bound** to frozen src `087d87a5` (helper `94002604`), and independently green against four earlier helpers |

In both windows the replacement opens the same state root, ledger and exact helper reference; the
coordinator reports `published-inert`; the same real inert native guardian answers `inert`; the
workload marker is absent; and abort reaches `exact-scope-empty`, after which the coordinator reports
`exact-scope-empty`. The controller **process**, not merely a JavaScript object, is replaced
(`expect(child.kill('SIGKILL')).toBe(true)`, exit asserted as `{ code: null, signal: 'SIGKILL' }`).
The persisted reference file mode is asserted to be exactly `0600`.

## Invariants held

- The publisher oracles cross the common publisher Interface (`prepared.publish` plus the bundle's
  `publishAuthority`) and the authentic `LinuxAuthorityPublicationLedger`. No test writes ledger files
  directly.
- Replacement recovers only `published-inert` and may abort/reconcile; no recovery activation
  capability was added.
- No `PUBLISH` frame, native `Published` transition, PGID authority, process-tree authority, or
  descendant signalling was added by any test or source change.
- Topology is proven with fsynced barrier files and kernel facts (exit codes, signals, pidfd, event
  ordering). `waitForFile` uses a bounded 30s deadline as a timeout, never as the oracle.
- Ordinary `prepare_primary` keeps its external Interface; no broker permit/deadline logic entered
  ordinary primary behavior.
- Test-only seams remain absent from `src/core/session-host/process-authority/linux/index.ts`.

## Production source changes

None. The only source edit by this track is to
`test/core/session-host/linux-process-authority-wsl-oracles.test.ts` (a test file): the added native
publication-blindness assertion, the `transport` field on the internal `ActualBundle` shape, and the
two imports those require.

## Required follow-up

1. **Done** — `native/linux-process-authority/**` is frozen at
   `087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59`, and the rebind pass above
   re-ran this file's three oracles plus `lifecycle_contract`, `linux_identity_contract`,
   `linux_journal_contract` and `linux_primary_contract` against it, with all seven input digests
   confirmed unchanged across the window. All `7.8`, `7.9` and `7.10` rows in this receipt are bound.
2. **Open, assigned to this track:** re-emit the Task `7.2` native build/manifest receipt against
   `087d87a5`. The round-5 receipt (`49c327ca…`) is four revisions stale. The freeze marker for this
   wave must record the `tests/**` hashes alongside `sourceSha256`, because `sourceDigest()` excludes
   `tests/` and a marker carrying only the source digest certifies nothing about the test files whose
   churn was the actual binding blocker here.
3. **Still open:** `inspect`, `open-runtime` and `terminate` in the helper CLI still parse
   `--deadline-ms` and discard it, using the internal 2-second `CONTROL_TIMEOUT` instead. Only
   `activate` was fixed. The native track deliberately left these because the fix needs new `_until`
   plumbing that would constitute a second deadline implementation, which the remediation plan's
   review invariants forbid. This is a design decision for the LEAD and should be carried into the
   unified review wave as an open finding rather than silently left — the TypeScript layer computes
   and sends a deadline that three of four control operations ignore.

Reusable roots left in place: run tree `/home/sayo/.local/share/rasen-build/ts-oracles-tree` (with its
ext4 `node_modules` symlink), cargo target
`/home/sayo/.local/share/rasen-build/track-b-native-target`, staged frozen-source package root
`/home/sayo/.local/share/rasen-build/track-b-pkg-r4`.
