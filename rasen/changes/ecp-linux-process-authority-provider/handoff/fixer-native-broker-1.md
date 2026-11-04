# Handoff: ecp-linux-process-authority-provider - native broker round-2 fixer

## Position

The round-2 broker fixer pass is source-complete and verification-green. All production fixes for
`BRK-R2-B01` through `BRK-R2-B07` and `BRK-R2-M01` are present in the shared ECP worktree. The
durable evidence is `evidence/review-fix-native-broker-round-2.md`. No task checkbox or run-state
was changed. The next stage is fresh non-author review, not more self-certification.

## Completed

- Added durable pre-readiness guardian construction reference persistence and exact pidfd fallback
  recovery through the approved minimal primary ready-hook seam.
- Made prepare response loss replayable with bounded durable request records and exact pending
  prepare reconciliation.
- Bound publication to the explicit canonical common publisher record; activation cannot publish.
- Serialized per-token lifecycle transitions across threads/restarts and serialized same-request
  daemon transactions with fixed 256-shard domains.
- Persisted exact closed terminal journals or explicit EventGap in authenticated tombstones.
- Split zero-grace termination policy from the absolute monotonic phase deadline.
- Added the service-domain cgroup administrative lock and replacement-during-remove regression.
- Added strict authenticated terminal-state cleanup for the root-only uninstaller command.
- Fixed Linux-only compile/test issues found while running fresh integration gates.

## Current receipts

- Windows host default parallel: 58/58.
- Windows broker serial: 44/44; Linux-only peer test selected out.
- Linux GNU all-target cross-check: pass, no warnings.
- Pinned WSL Rust 1.88 whole-crate rustfmt: pass.
- Fresh static-musl 18-ELF WSL matrix: 93/93.
- WSL broker subset: 45/45; primary ready-hook focused: 1/1.
- TypeScript focused suites: 49/49; typecheck and focused ESLint: pass.
- Installer/uninstaller `sh -n`: pass; scripts were not executed with privilege.
- Current dual-binary check-only build: pass; source digest
  `2cf6d54e8c05164c54b5800c3e2e1213865eb400c43c8eef73983f38d24bd151`.
- Strict Change validation: 1/1 valid, zero issues.

## Cross-ownership seam

Current primary hashes:

```text
primary.rs                40d5231a99f1582b82123fd6758a084d7730b0840fc2c5b9fc89587868dda6ea
linux_primary_contract.rs 741df44df9dfdb5e0cc5e1c5b7b6609e830b436f5be0fc742950b8235838403b
```

The only intended primary semantic delta is the additive
`prepare_primary_with_ready_hook(...)` seam plus the hook-failure regression. Existing
`prepare_primary(...)` remains a no-op-hook wrapper. Fresh primary delta review must use the
current hashes; do not claim that older native findings were reopened.

## Remaining

1. LEAD records this handoff in the single-writer run-state and dispatches a fresh non-author
   broker re-review over B01-B07/M01.
2. LEAD dispatches a separate fresh non-author primary delta review over the minimal seam.
3. Package reviewer may now rerun its integration gate: the private-field GNU compile blocker is
   fixed and the current `--check-only` dual-binary build passes.
4. Keep Section 9 and terminal Linux support open. No authorized writable unified cgroup-v2/root
   environment was used, and arbitrary external root pathname mutation is outside the in-process
   administrative mutex.

## Retained build evidence

The fresh static-musl build remains at
`E:\tmp\rpa-broker-r2-20260806-2`; its Rust temp root is
`E:\tmp\rpa-broker-r2-temp-20260806-2`. They were not deleted so a fresh reviewer can inspect or
rerun the exact ELFs. Older temporary targets were not overwritten or removed.

## Durable findings

- Absolute monotonic deadlines and durable replay must stay end-to-end; replacing either with a
  per-call timeout reopens prepared-response control loss.
- Cleanup tombstones are authenticated lifecycle evidence, not disposable emptiness markers;
  replay must retain the exact closed journal or explicit EventGap.
- Cgroup pathname safety is proven only inside the trusted service management domain until the
  privileged replacement-during-remove gate runs.
