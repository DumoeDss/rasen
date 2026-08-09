# Handoff: ecp-linux-process-authority-provider — LEAD #1

## Original intent

User goal: complete the full Change-level ECP (0.2.0) by driving the ECP-7 portfolio's
session-execution-and-self-hosting Slice to genuine, evidence-backed completion. Execution order
changed to implementation-first batch: each Change runs planner -> implementer only, then the LEAD
advances to the next Change; no verify/review-loop/ship/archive until all non-deferred Changes are
implementation-frozen. After that, a unified review wave begins.

The user also confirmed Linux and Windows providers remain serial (not parallel) because both
consume the same frozen common contract in a shared cumulative worktree, and the Direction policy
explicitly mandates serial execution.

## Position

Pipeline: small-feature. Completed stages: propose (done). Current stage: apply (in_progress).

Change: `ecp-linux-process-authority-provider` — 70/93 tasks done, 23 open.

Portfolio `ecp-session-execution-and-self-hosting`:
- `ecp-platform-process-authority-foundation`: done, shipped, archived.
- `process-authority-prepare-unavailability-outcome`: done, shipped, archived.
- `ecp-linux-process-authority-provider`: in_progress (apply wave).
- `ecp-windows-process-authority-provider`: pending (next after Linux frozen).
- `ecp-macos-process-authority-provider`: escalated, decision-deferred.
- `ecp-native-process-capsule-closure`: escalated (depends on all three providers).
- `ecp-durable-agent-session-host`: escalated (depends on closure).
- `ecp-frozen-action-session-executor`: pending.
- `ecp-session-policy-and-control-parity`: pending.
- `ecp-session-self-hosting-vertical-proof`: pending.

Execution policy recorded in portfolio-run.json, parent auto-run.json, and Linux auto-run.json:
`executionPolicy.mode = "implementation-first"`, serial, Linux then Windows.

## Done / Remaining

Done in this session (apply implementation wave):
- 7.2: WSL native build receipt (round 5) with locked Rust 1.88.0, source-owned build script,
  adjacent manifest verification, and same-kernel helper execution.
- 3.1/3.7/10.1/10.4: native build, isolated export seams, locked build script, Windows path
  cross-target package evidence.
- 8.1-8.10: full broker provider/client protocol, installation, lease store, cgroup lifecycle,
  activation, reopen, terminate/abort, broker-death, and mutations — all in source.
- 4.7: 18-point construction failure matrix and post-R revalidation implemented in primary.rs;
  still needs focused WSL run to tick.
- 5.8: root-status corruption matrix, terminal-record crash matrix, final-child race oracle
  implemented in Rust tests; still needs focused WSL run to tick.
- 7.9: 4-row seccomp unavailable-configuration matrix implemented in linux_primary_contract.rs.
- 7.8/7.10: published-inert abort and controller-replacement windows implemented in TypeScript
  WSL oracle test and controller fixture; still needs fresh WSL run to tick.
- Package/CI: resolver/package 27/27, locked helper+client cross-build classified non-runtime.

Remaining (23 tasks):
- 4.7: needs focused WSL cargo test to verify the construction failure matrix passes.
- 5.8: needs focused WSL cargo test to verify the lifecycle/crash matrices pass.
- 7.8: needs fresh actual-WSL run of natural empty, exact code/signal exit, root-exit-with-live-
  descendant, recursive force, prepared/published abort oracles.
- 7.9: needs fresh actual-WSL run of identity-drift and unavailable-configuration mutations.
- 7.10: needs fresh actual-WSL run of commit-before-ack and ack-before-activate controller windows.
- 9.1-9.7: broker cgroup-v2 gate — requires a dedicated writable unified cgroup-v2 runner with
  root/admin authority. Current WSL is hybrid cgroup without writable v2 controllers. This is an
  environment gate, not an implementation gap. Must not be ticked without the real runner.
- 11.1-11.11: verify/review/ship/archive lifecycle — deferred to the unified review wave per
  executionPolicy; no implementation work here.

Known open findings (11, all from historical review-loop, preserved):
- Blocker: BRK-R2-B06 (prepare/activation can exceed absolute deadline).
- Major: NATIVE-SEAM-R1-M01, R1-M02, WSL-R4-M00, M01, M04, M05, M06, BRK-R2-B01, BRK-R2-B02-M03.
- Minor: PKG-P5 (stale source digest).
These remain open until the unified review wave; the implementation wave does not close them.

## Key decisions (and why)

- Implementation-first batch: user explicitly changed the workflow to reduce context churn. Each
  Change runs planner -> implementer only, then advances. Review/verify/ship/archive are batched
  after all non-deferred Changes are frozen.
- Serial, not parallel: Linux and Windows providers are contract-independent but share a cumulative
  worktree; the Direction plan mandates serial to avoid native/package fixture collisions.
  The implementer's suggestion to parallelize was rejected by the LEAD.
- macOS is decision-deferred: no proposal, apply, or implementation until a Direction decision.
  This blocks closure, host, executor, policy/control, self-hosting, and ECP-8 three-OS release
  truth.
- Compaction is not a handoff trigger: automatic context compaction alone does not create a handoff.
  Only genuine recall degradation, stated budget exhaustion, or explicit runtime failure may.
- Section 9 is an environment gate: the broker cgroup-v2 runner is not available on the current
  machine (hybrid WSL). It must not be ticked without a real writable unified cgroup-v2 environment.
  The change stays non-terminal if this gate is unmet.

## Dead ends & gotchas

- The implementer repeatedly answered "can Linux and Windows run in parallel?" instead of focusing
  on structured DONE returns. The LEAD must not treat its final-text answers as structured returns.
- A known failing test in broker_cgroup (`pinned_leaf_descriptor_never_writes_to_a_path_replacement`)
  produces `pinnedall` vs `pinnedement` mismatch. The lifecycle subagent confirmed it did not own
  that area. This needs investigation in the review wave.
- `cargo fmt --all --check` fails because concurrent edits left formatting differences in
  `linux_primary_contract.rs`. Owned-file formatting passes.
- The WSL TS oracle test imports from the wrong path (public index vs direct module); gap map
  subagent identified 6 corrections needed for 7.8-7.10 evidence to be trustworthy.
- 429 rate-limit errors killed the implementer mid-session twice. These are infra/transient deaths
  and do NOT consume handoff budget. The disk work was preserved each time.
- The build-authority circular trust issue in TS WSL tests: `buildIdentity()` reconstructs from
  the same manifest being verified. Must use `dist/core/session-host/process-authority/linux/build-authority.js`.

## Eliminated hypotheses

- "Linux and Windows can be safely parallelized" — rejected: shared cumulative worktree, shared
  native/package fixtures, and the Direction policy explicitly mandates serial.
- "Section 9 can use injected cgroup fixtures" — rejected: the task spec explicitly forbids it and
  the change must report non-terminal if the environment is unavailable.
- "Compaction should trigger handoff" — rejected: user explicitly disabled this; only genuine
  recall degradation, budget, or runtime failure may trigger a handoff.

## Working set

Key files modified (untracked):
- `native/linux-process-authority/` (entire crate: src, tests, Cargo.lock)
- `src/core/session-host/process-authority/linux/` (TS provider, assembly, build-authority)
- `scripts/build-linux-process-authority.mjs`
- `test/core/session-host/linux-process-authority-*.test.ts` (9 test files)
- `test/fixtures/linux-process-authority-wsl-controller.mjs`
- `rasen/changes/ecp-linux-process-authority-provider/` (proposal, design, tasks, evidence, handoff)
- `.rasen/changes/ecp-linux-process-authority-provider/ephemera/auto-run.json`
- `.github/workflows/linux-process-authority.yml`
- `rust-toolchain.toml`

Run-state files updated:
- `portfolio-run.json`: executionPolicy added.
- Parent `auto-run.json`: executionPolicy added.
- Linux `auto-run.json`: executionPolicy + worker pointer added.

Focused test commands for remaining work:
```sh
# In WSL, from project root:
cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu --lib \
  partial_construction_failure_matrix_reaps_guardian_and_keeps_workload_inert

cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu --test lifecycle_contract

cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu --test linux_primary_contract

cargo test --locked --manifest-path native/linux-process-authority/Cargo.toml \
  --target x86_64-unknown-linux-gnu --test linux_journal_contract
```

```sh
# TypeScript WSL oracles (from project root on Windows):
npx vitest run test/core/session-host/linux-process-authority-wsl-oracles.test.ts
```

## Next action

1. Resume the Linux apply implementer with a clean-context worker. It should:
   a. Run the 4 focused WSL cargo test suites listed above to verify 4.7, 5.8 source matrices pass.
   b. Fix the 6 TS WSL oracle corrections identified by the gap-map subagent (import path, circular
      build-authority, durable write helper, coordinator inspect, try/finally cleanup, subprocess
      fixture for seccomp).
   c. Run the corrected TS WSL oracle test to verify 7.8-7.10.
   d. Fix the `pinnedall`/`pinnedement` broker_cgroup test failure.
   e. Run `cargo fmt --all --check` and fix formatting.
   f. Tick 4.7, 5.8, 7.8, 7.9, 7.10 ONLY after evidence is recorded.
   g. Leave 9.1-9.7 unchecked (environment gate unavailable).
   h. Leave 11.1-11.11 unchecked (deferred to review wave).
2. After Linux is implementation-frozen (70 + 5 = 75/93, with 9.1-9.7 and 11.x honestly deferred),
   record the frozen marker in auto-run.json and advance to the Windows provider planner.
3. Windows provider: run planner -> implementer only.
4. After Windows is frozen, start the unified review wave for both providers.
