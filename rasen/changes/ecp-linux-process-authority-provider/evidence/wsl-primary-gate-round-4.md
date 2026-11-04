# WSL primary actual-kernel closure audit — round 4

Date: 2026-08-06\
Mode: fresh independent, dispatched/report-only\
Verdict: **PARTIAL / NOT TERMINAL — 6 CLOSED candidates, 9 OPEN tasks; 0 Blocker and 9 Major task-closure gaps (7 audited here, 2 retained from the ready-hook review)**

## Scope and evidence boundary

This report audits only Tasks `2.3`, `4.7`, `5.7`, `5.8`, `7.2` through `7.11`, and
`11.3` against the current source-stable tree. It consumes the proposal, design, delta spec,
tasks, native-primary implementation evidence, WSL gate rounds 1–3, native-primary review rounds
2–4, the separate ready-hook seam review, and fresh current-tree WSL execution.

It does not edit task checkboxes or certify package, installed broker/cgroup-v2, ProcessScope,
SessionHost, production-default, distribution, macOS, ECP-8, ship, or archive state. No product,
test, task, run-state, portfolio, commit, stash, or external administrative state was modified.

Current identities used for this audit:

```text
40d5231a99f1582b82123fd6758a084d7730b0840fc2c5b9fc89587868dda6ea  src/primary.rs
4fbaacb0db872cdca591b1bb83c0ad42f8965293cb882a01cf1b4c7460a4d08a  tests/authority_contract.rs
7dc5a8249442f30de328f6cab0e8dd21c1f2ae16098f613f9cc5deae9974d252  tests/lifecycle_contract.rs
e3b92a8e22e7eee98312c031d7247a616a3bc67c43834b3a0d0a8c896b76f09a  tests/linux_identity_contract.rs
ab7d19331269d96c779ac6d74e841305eda68f7817e5f71d52097e6351f560af  tests/linux_journal_contract.rs
741df44df9dfdb5e0cc5e1c5b7b6609e830b436f5be0fc742950b8235838403b  tests/linux_primary_contract.rs
```

## Task accounting

| Task | Audit result | Exact evidence and limitation |
| --- | --- | --- |
| `2.3` | **CLOSED candidate** | `authority_contract` 4/4 executed on WSL. `prepared_attestation_is_closed_versioned_and_round_trips` binds protocol version, scope id, independent scope/control capabilities, operation, launch/artifact/source digests, boot id, guardian PID/start ticks, and PID-namespace device/inode; trailing, zero, conflated capability, and conflated digest mutations fail closed. Current actual prepare also returns and exercises that exact attestation. |
| `4.7` | **OPEN** | Wrong-artifact cleanup, private-socket partial cleanup, the pre-readiness hook error, and abort-response loss have evidence, but there is no deterministic injection matrix for mapping, child `N` readiness, proc/namespace/pidfd revalidation, identity transfer, and final `R` readiness. The current broker ready-hook also retains `NATIVE-SEAM-R1-M01` and `M02`. |
| `5.7` | **CLOSED candidate** | Fresh `guardian_forced_death_proves_teardown_without_fabricating_root_status` kills the exact namespace guardian, reopens through a new helper process, observes kernel-proven exact empty, preserves root-result loss as `event-gap`, proves the namespace member marker remains absent, and proves an unrelated process survives. Round-3 source review independently verified the pidfd/identity domination and retained-error path. |
| `5.8` | **OPEN** | Activation replay, exact root code/signal, descendant survival, event-gap encoding, terminal corruption, nested namespace, guardian death, and abort response loss have individual tests. The required final-child race matrix, exhaustive root-status corruption state-machine mutations, and all terminal-record crash points are not present. |
| `7.2` | **OPEN — package-owned integration hold** | Round 3 proved a historical native-in-WSL locked build/test and staged ELF execution. The current source has changed, and no current source-owned build/export receipt yet binds the adjacent canonical manifest's exact current length/hash/source/compiler/mode/provider/protocol/reference fields. This remains owned by package final integration and is not a native product finding. |
| `7.3` | **CLOSED candidate** | `actual_namespace_prepare_is_inert_then_aborts_or_activates_to_exact_empty` executes real user/PID/mount namespace construction, namespace-correct proc, pidfd identity, prepare-before-activation, inert abort, and exact-empty paths on WSL. |
| `7.4` | **OPEN** | The current nested command executes `unshare --user --pid --fork --mount-proc` and a background `setsid` shell, but it waits for that child to finish. No actual detached double-fork descendant is kept alive and then recursively killed by namespace authority. |
| `7.5` | **CLOSED candidate** | `setpgid_orphan_keeps_scope_live_until_exact_pidfd_force` forks a descendant, moves it into a new process group, ignores `SIGTERM`, proves root exit does not imply empty, then terminates through exact guardian pidfd authority and proves the resistant descendant cannot write its delayed escape marker. |
| `7.6` | **OPEN** | A real nested PID namespace executes and reaches exact empty, but the `unshare`/shell path waits for nested work. It does not prove the specifically required ordering where the authority root exits while a nested init/descendant remains live before eventual exact empty. |
| `7.7` | **CLOSED candidate** | The forced-death test uses a replacement helper process to inspect the durable authority after guardian death; identity tests reopen the exact pidfd and reject boot/PID/start/namespace replacements; the death oracle proves kernel teardown and unrelated-process survival. |
| `7.8` | **OPEN** | Natural empty, exact code exit, exact `SIGTERM` exit, root-exit-with-live-`setpgid` descendant, force, prepared abort, and abort-response loss execute on WSL. There is no actual-WSL publisher-led `published-inert` abort path; the native machine intentionally has no `Published` event, so native-only tests cannot satisfy this item. |
| `7.9` | **OPEN** | Actual WSL identity tests mutate boot, PID, start ticks, namespace device/inode, capabilities, and an unrelated nondumpable replacement without destructive control. No actual unavailable-configuration matrix exercises denied/missing namespace, proc, pidfd, or mapping prerequisites and proves typed fail-closed behavior. |
| `7.10` | **OPEN** | No current actual-WSL test replaces the controller in both publication commit-before-ack and acknowledgement-before-activate windows while proving the trusted ledger reports `published-inert` and native workload activation remains closed. The native helper has no publication transition by design; this requires the TypeScript publisher/ledger plus real helper. |
| `7.11` | **CLOSED candidate by this artifact** | This round-4 summary names the exact commands, environment, receipts, task mapping, fixture-count caveat, and open package/broker/distribution/closure/ECP-8 boundaries. |
| `11.3` | **OPEN** | The current exact 18-ELF suite is 93/93, but it is not the complete Section 7 matrix while `7.4`, `7.6`, `7.8`, `7.9`, and `7.10` remain open. A green implemented suite cannot substitute for missing named acceptance oracles. |

The LEAD may check only the six **CLOSED candidate** rows after independently confirming no newer
source delta invalidated these hashes. Every **OPEN** row must remain unchecked.

## Canonical Major findings

### Retained, not duplicated

- **`NATIVE-SEAM-R1-M01` — Major:** broker ready-hook/fsync work is not bounded by the absolute
  prepare deadline and can outlive it with the inert guardian alive.
- **`NATIVE-SEAM-R1-M02` — Major:** the current hook-error test proves cleanup but remains green if
  the hook is moved after final readiness; it does not prove the defining pre-readiness ordering.

Both are documented in `review-report-native-primary-seam-round-1.md`. They keep `4.7` open and
must be fixed and independently re-reviewed; this report does not self-close them.

### Newly audited acceptance gaps

1. **`WSL-R4-M00` — Major — Task 4.7 lacks the full partial-construction failure matrix.** The
   implementation has one injected after-attestation hook plus several incidental failures, not
   deterministic mutations spanning every construction stage through final revalidation.
2. **`WSL-R4-M01` — Major — Task 5.8 lacks required final-child race and terminal crash-point
   state-machine coverage.** Existing lifecycle/journal tests cover useful cases but not the whole
   enumerated matrix.
3. **`WSL-R4-M02` — Major — Task 7.4 has no detached double-fork recursive-kill oracle.** The
   current `setsid` command waits naturally and therefore cannot prove recursive control over a
   detached surviving tree.
4. **`WSL-R4-M03` — Major — Task 7.6 does not hold nested work live after root exit.** Root exit is
   observed before exact empty, but only after the nested command has waited for its descendants.
5. **`WSL-R4-M04` — Major — Task 7.8 lacks actual-WSL published-abort evidence.** Native inert
   state alone cannot prove publisher/ledger behavior.
6. **`WSL-R4-M05` — Major — Task 7.9 lacks actual unavailable-configuration mutations.** Identity
   drift is strong and green, but denied/missing namespace/proc/pidfd/mapping cases are absent.
7. **`WSL-R4-M06` — Major — Task 7.10 has no actual publisher-window controller-replacement
   oracle.** Neither publication window is exercised against the real helper and trusted ledger.

These are missing required acceptance paths, not reproduced destructive product failures. They
block task/Change terminal status and should be routed to an implementer; every fix requires a
fresh non-author WSL re-review.

## Fresh current-tree execution

Environment:

```text
WSL distribution: Ubuntu 24.04.1 LTS
kernel: Linux 5.15.167.4-microsoft-standard-WSL2 x86_64
Windows cross-build rustc/cargo: 1.88.0
target: x86_64-unknown-linux-musl, static PIE, rust-lld
```

The current source was freshly cross-built on Windows with E-drive roots:

```text
CARGO_TARGET_DIR=E:\tmp\rpa-b005-review-r4-final-20260806-1
TEMP/TMP=E:\tmp\rpa-b005-review-r4-final-temp-20260806-1
RUSTFLAGS=-C linker=rust-lld

rustup run 1.88.0 cargo test --locked \
  --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-musl --no-run --message-format=json
```

Cargo JSON identified exactly 18 artifacts with `profile.test=true`. Every one was executed
directly on WSL with `--test-threads=1`: **93 passed, 0 failed, 0 ignored**. This is reached-path
actual-kernel evidence because the ELF processes really ran on the WSL kernel; it is not native
build, manifest/package, installed broker, general distribution, or release evidence.

This auditor then reran the exact current artifacts by name:

```text
wsl.exe -d Ubuntu-24.04 -- <authority_contract ELF> --test-threads=1
  4 passed, 0 failed, 0 ignored, 0 filtered

wsl.exe -d Ubuntu-24.04 -- <lifecycle_contract ELF> --test-threads=1
  5 passed, 0 failed, 0 ignored, 0 filtered

wsl.exe -d Ubuntu-24.04 -- <linux_identity_contract ELF> --test-threads=1
  3 passed, 0 failed, 0 ignored, 0 filtered

wsl.exe -d Ubuntu-24.04 -- <linux_journal_contract ELF> --test-threads=1
  1 passed, 0 failed, 0 ignored, 0 filtered

wsl.exe -d Ubuntu-24.04 -- <linux_primary_contract ELF> --test-threads=1
  23 passed, 0 failed, 0 ignored, 0 filtered

focused total: 36 passed, 0 failed, 0 ignored, 0 filtered
```

The primary ELF and sibling helper identities match the round-4 review:

```text
primary test ELF: 14215992 bytes
  d89014aae77855621b27d226a89d42b703aa88177264f00102eb556c7bb6358f
helper ELF: 10751928 bytes
  4c6591dc8e0b518cc9bc2316d22ba7d516dd7bdea3c03511f6738737764bf5c4
```

### Zero-hidden-skip accounting

No Rust test is marked ignored and the focused runs reported zero ignored/filtered. However, seven
functions in `linux_primary_contract` are subprocess fixture entry points that return immediately
when their private environment selector is absent. Their top-level `ok` lines are **not counted as
independent acceptance oracles**. Six are exercised with selectors by parent tests, which assert
their observable effects; `recursive_workload_fixture` is explicitly a zero-side-effect retained
harness selector. All task conclusions above rely on the parent oracle and its assertions, not on
inflating coverage from those seven fixture `ok` lines.

## Historical native-build receipt and current limitation

Round 3 genuinely compiled and ran 23 tests natively inside WSL with pinned Rust 1.88 and an
isolated Zig 0.16 linker/sysroot, and executed a staged static PIE. That historical receipt remains
useful proof of the build route. It does not close current Task `7.2`: the current source includes
later primary/broker changes, and the final source-owned build/export/adjacent-manifest receipt has
not yet been produced for this frozen tree. The package integration owner must emit and verify that
receipt; this reviewer does not relabel the current cross-build as native package proof.

## Durable findings for LEAD

1. Close only `2.3`, `5.7`, `7.3`, `7.5`, `7.7`, and `7.11`; keep the other audited tasks open.
2. Do not use 93/93 as proof of `11.3`: the implemented suite has zero failures but omits five
   named Section 7 acceptance paths.
3. Count parent oracles, not fixture entry-point `ok` lines, when claiming actual mutation
   coverage.
4. Preserve the boundary wording: Windows-cross-built ELFs actually executed on WSL provide
   reached-path kernel evidence; only current source-owned native build/export/manifest evidence
   can close `7.2`.
