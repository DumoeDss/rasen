# Handoff: ecp-linux-process-authority-provider — implementer-native-broker #2

## Original intent

Continue the single-agent Tier C review cycle for the native Linux process-authority broker, resolve every round-1 Blocker and Major finding with RED/GREEN regression evidence, and do not claim terminal support until the independent gates and dedicated privileged Linux acceptance matrix pass.

## Position

Pipeline: `small-feature`. Completed stages: `propose`; TypeScript implementation/review is clean and native-primary fixes are separately under review. Current stage: `review-loop` (broker round 1 remediation inside the still-in-progress `apply` stage).

## Done / Remaining

Done: read the fresh non-author broker report; confirmed `BRK-B01` through `BRK-B07` plus `BRK-M01`; audited the public primary/runtime/authority/protocol boundaries; fixed the implementation order as cgroup/deadline, recovery/replay, production routing, then administration/restart.

Remaining: add a RED mutation for every finding; implement fd-pinned cgroup control, per-lease serialization, and monotonic deadlines; implement provisional/quarantine recovery and terminal tombstone replay; implement caller-mapped production guardian, pinned client, all-operation daemon routing, runtime duplex, root-exit, and exact-empty flows; harden install/uninstall/singleton/stale-socket recovery; run scoped locked tests, Linux all-target checks, pinned formatting, script syntax, strict UTF-8, strict Change validation, and the Tier C gate+diff closure.

## Key decisions (and why)

- Start with `BRK-B04` and `BRK-M01` — recovery and production routing must build on an exact pinned target and one real wall-clock deadline, not duplicate unsafe pathname/read-count behavior.
- Follow with `BRK-B02` and `BRK-B03` — prepare and terminal cleanup need explicit durable phases before the daemon can safely expose lifecycle operations.
- Wire `BRK-B01` only after those invariants are real — a larger fixture-only core does not satisfy the installed-provider finding.
- Preserve the primary helper's public boundary and keep broker work under `native/linux-process-authority` — the primary work unit is independently owned and already stabilized.
- Treat the privileged Section 9 environment as a final acceptance gate, not as a substitute for deterministic RED/GREEN contract tests.

## Dead ends & gotchas

- The summary-reported handoff path did not exist after compaction; this document reconstructs it from the durable review report and run-state.
- `rasen pipeline show review-cycle --for-execution --json` is invalid because `review-cycle` is a skill/stage kind, not a registered pipeline. The active run-state pipeline is `small-feature`.
- `rasen agent context --latest --runtime codex --json` cannot find a rollout whose recorded cwd is this sibling worktree; occupancy is unavailable rather than zero.
- The worktree is intentionally very dirty with multiple concurrent/change-owned files. Limit edits to the broker-owned native files, broker tests/assets, and this change's evidence/handoff/run-state.

## Eliminated hypotheses (MANDATORY for fixer/debugger roles)

- "Repeated pathname revalidation is enough for exact destructive cgroup control" — ruled out by `BRK-B04`: replacement can occur between validation and the later pathname open/write/remove. Current best hypothesis: pin the directory fd, open control files relative to it, serialize per lease, and revalidate the pinned handle.
- "A bounded number of `cgroup.events` reads implements `timeout_ms`" — ruled out by `BRK-M01` and the protocol's millisecond contract. Current best hypothesis: carry one monotonic absolute deadline through guardian and cgroup phases with bounded waits.
- "Persist terminal, remove leaf, then delete the lease is crash-safe and replayable" — ruled out by `BRK-B03`: leaf removal before record deletion leaves an unreopenable record, while deletion loses response-replay identity. Current best hypothesis: separate durable cleanup phases and retain a bounded idempotent tombstone.
- "Best-effort rollback before the first committed lease is safe" — ruled out by `BRK-B02`: ambiguous rollback can leave live authority with no durable reference. Current best hypothesis: commit a provisional/quarantine recovery record before unprovable state exists and delete it only after positive cleanup proof.
- "The authenticated probe daemon plus service-core fixtures closes lifecycle wiring" — ruled out by `BRK-B01` and the daemon's explicit non-probe rejection. Current best hypothesis: one production `BrokerServiceCore` must own all routed operations and the installed client/guardian/runtime path.

## Working set

Primary inputs: `rasen/changes/ecp-linux-process-authority-provider/evidence/review-report-native-broker-round-1.md`, `design.md`, `tasks.md`, and the delta spec. Implementation focus: `native/linux-process-authority/src/broker_cgroup.rs`, `broker_service.rs`, `broker_lease.rs`, `broker_transport.rs`, `broker_protocol.rs`, `broker_install.rs`, `broker_admin.rs`, the broker binary, install assets, and matching `tests/linux_broker_*` contract targets.

## Next action

Read the current cgroup/service traits and their contract tests side by side, then add the smallest mutation tests that prove pathname re-entry and read-count timeout behavior before changing production code.
