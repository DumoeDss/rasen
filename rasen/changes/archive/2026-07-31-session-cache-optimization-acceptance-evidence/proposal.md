## Why

The reusable-session portfolio now has separately owned host, registry, CLI,
and scheduler implementations, but it is not complete until the integrated
tree proves the full lifecycle, real cache-retention boundary, documentation
contract, and native Windows/POSIX behavior on one exact delivered commit.
This final child turns those cross-child promises into durable, auditable
acceptance evidence without hiding implementation gaps inside the evidence
slice.

## What Changes

- Add integration, end-to-end, durability, and evidence harnesses for the full
  create → repeated wake → scheduled touch → retire lifecycle, including
  concurrent and retired rejection, durable registry/transcript agreement,
  host-loss recovery, and correctness while the daemon is absent.
- Exercise all six reconciler-supported built-in pipelines:
  `bug-fix`, `small-feature`, `full-feature`, `goal-loop-measure`,
  `goal-loop-evaluate`, and `goal-loop-research`; retain
  `auto-decompose` as an expected fail-closed
  `execution_profile_unavailable` case.
- Record a real wall-clock cache observation around the production cadence and
  retention boundary. Deterministic fake-clock tests remain local diagnostics,
  but cannot substitute for the approximately 50-minute touch observation,
  the 55-minute cache-hit control, or the 65-minute cache-miss control.
- Fill the reserved session-execution-layer section in
  `docs/architecture/executable-composite-pipelines.md` with the delivered
  ownership, execution, recovery, and placeholder-value contract.
- Define exact-tree delivery evidence: after local implementation, review, and
  archive sequencing is complete, only the parent may authorize the single
  portfolio commit/push or PR. The acceptance record then binds the exact
  commit SHA to GitHub run URLs and successful `linux-bash`,
  `linux-bash-node24`, and every Windows PowerShell shard.
- Store final remote evidence in the canonical external work directory and/or
  immutable CI artifacts associated with the tested SHA, so recording the
  evidence does not create a new commit and invalidate the SHA it proves.
- Complete every repository-local protocol/test/documentation fix, obtain a
  clean non-author review, finish task/spec/local-delivery/archive state, and
  include every parent-selected repository mutation before freezing the exact
  tracked delivery index/tree. Real 50/55/65-minute and remote CI outcomes then
  advance external terminal gates only; they never edit a checkbox or other
  byte in the tested tree.
- Treat every superseded physical/CI attempt as immutable failed or
  inconclusive history. A new candidate starts with clean observation paths,
  pending CI, no inherited success, and no live host left from the old attempt.
- Eliminate shared mutable observer state instead of repairing acceptance lock
  recovery. Every launch creates an immutable content-addressed or UUID attempt
  generation; observers write disjoint arm directories only, the launcher is
  the sole writer of its intent/summary, and no observer writes the canonical
  acceptance ledger.
- Preserve every prior attempt as immutable history. A new attempt may reuse a
  completed control arm only through bounded validation plus an immutable
  copy/reference under the new candidate. Scheduler-arm reuse is prohibited;
  every selected scheduler result must be native to its target attempt and
  carry that attempt's immutable checkpoint chain. Old failed/incomplete
  ledgers, checkpoints, and results are never renamed, deleted, overwritten, or
  silently selected.
- Preserve legacy `acceptance-run.json` in place and make
  `acceptance-run-v2.json` the only canonical selected-attempt record for the
  immutable protocol. Remove every seed/preselection writer. The controlled E1
  finalizer alone creates or exact-idempotently validates v2 after selecting
  one complete attempt and cross-validating all arm paths, checkpoints, and
  candidate identities.
- Prove competing launch admission through the real management
  server/router/service/registry/coordinator and actual CLI/HTTP path with two
  real launcher/observer processes. A fake Claude executable is allowed only at
  the agent-binary boundary; no test-private capacity or dispatch gate may
  substitute for the durable product fence.
- Bind the real scheduler result through one causal chain: an ordered
  start/eligibility/touch/settlement/deadline/application/end envelope, exact
  transcript-derived scheduler-touch digest and assistant/result lines, the
  durable wake record, preterminal owner history, and production-valid
  terminal owner absence/reason.
- Bind result and checkpoint tolerances directly to immutable
  `OBSERVATION_ARMS` constants: 5 minutes for cadence and 10 minutes for
  deadline application. Jointly tampered result/checkpoint values cannot
  substitute for those constants.
- Make final closure re-open its dependencies: current ledger CI state must
  agree with real GitHub workflow/jobs REST evidence, and all five canonical
  local output/exit pairs must still match their recorded sizes and hashes.
- Route every product implementation gap back to its owning child; this child
  owns acceptance tests, fixtures, harnesses, documentation, and evidence
  records, not opportunistic repairs to host, registry, CLI, or scheduler
  product files.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-host-lifecycle`: Add portfolio-level integrated acceptance,
  real-retention observation, architecture-documentation, and exact-SHA native
  CI evidence requirements without changing the already-synchronized runtime
  behavior contract.

## Impact

- Adds acceptance-owned integration/E2E/durability test fixtures and a
  resumable long-observation harness.
- Updates the reserved session execution layer in
  `docs/architecture/executable-composite-pipelines.md`.
- Adds child-local protocol artifacts plus external work-directory evidence;
  it does not add a runtime API or dependency.
- Defines the candidate from the exact audited tracked delivery index/tree,
  excluding the pre-existing untracked `packages/ui/package-lock.json` and
  every other incidental untracked file.
- Defers all remote mutation to a separately authorized parent delivery step.
  No child push, PR, or CI run is implied by this proposal.
